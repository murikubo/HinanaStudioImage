import CoreImage
import MetalKit
import SwiftUI

struct NativeCanvas: UIViewRepresentable {
  @ObservedObject var library: NativeLibrary
  var compare: Bool
  var proofSDR: Bool
  var maskID: String
  var liquify: Bool
  var brushRadius: Double
  var brushStrength: Double
  var onLiquify: ([String: Any]?, Bool) -> Void
  var maskTool: String
  var overlay: Bool
  var zoomRequest: Double
  var zoomRevision: Int
  var onZoom: (String) -> Void
  var onHistogram: ([[Int]]) -> Void
  var onPoints: ([NativePoint]) -> Void
  func makeUIView(context: Context) -> NativeMetalCanvas { NativeMetalCanvas() }
  func updateUIView(_ view: NativeMetalCanvas, context: Context) {
    view.onZoom = onZoom
    view.onHistogram = onHistogram
    view.onPoints = onPoints
    view.maskTool = maskTool
    view.liquify = liquify && !compare
    view.brushRadius = brushRadius
    view.brushStrength = brushStrength
    view.onLiquify = onLiquify
    view.load(
      library: library, compare: compare, proofSDR: proofSDR, maskID: maskID, overlay: overlay)
    view.applyZoom(zoomRequest, revision: zoomRevision)
  }
}
final class NativeMetalCanvas: MTKView, UIGestureRecognizerDelegate {
  private let engine = NativeRenderEngine.shared
  private var source: NativeSource?
  private var image: CIImage?
  private var file = "", settings = NativeSettings()
  private var serial = 0
  private let pendingLock = NSLock()
  private var pendingToken = 0
  private var previous: NativeSettings?
  private var flags = ""
  private var zoomRevision = 0
  var onZoom: ((String) -> Void)?
  var onHistogram: (([[Int]]) -> Void)?
  private var zoom = 1.0, pan = CGPoint.zero, panStart = CGPoint.zero
  private var scaleStart = 1.0, pinchAnchor = CGPoint.zero
  private var drawing: [NativePoint] = []
  private var activeMask: NativeMask?
  private var overlayImage: CIImage?
  var liquify = false, brushRadius = 0.1, brushStrength = 0.5
  var onLiquify: (([String: Any]?, Bool) -> Void)?
  private var warp: NativeLiquify?
  private var warpStart: [String: Any]?
  private var warpPoint: NativePoint?
  private var warpTime = 0.0
  private var warpChanged = false
  private let brushOutline = CAShapeLayer()
  var maskTool = "ai"
  var onPoints: (([NativePoint]) -> Void)?
  override init(frame: CGRect, device: MTLDevice?) {
    super.init(frame: frame, device: NativeRenderEngine.shared.device)
    setup()
  }
  convenience init() { self.init(frame: .zero, device: NativeRenderEngine.shared.device) }
  required init(coder: NSCoder) {
    super.init(coder: coder)
    device = engine.device
    setup()
  }
  func setup() {
    brushOutline.fillColor = UIColor.clear.cgColor
    brushOutline.strokeColor = UIColor(red: 0.81, green: 0.87, blue: 0.7, alpha: 1).cgColor
    brushOutline.lineWidth = 1.5
    layer.addSublayer(brushOutline)
    framebufferOnly = false
    colorPixelFormat = .rgba16Float
    (layer as? CAMetalLayer)?.colorspace = CGColorSpace(name: CGColorSpace.extendedLinearDisplayP3)
    isPaused = true
    enableSetNeedsDisplay = true
    backgroundColor = UIColor(red: 0.07, green: 0.08, blue: 0.085, alpha: 1)
    let pinch = UIPinchGestureRecognizer(target: self, action: #selector(pinched))
    pinch.delegate = self
    addGestureRecognizer(pinch)
    let move = UIPanGestureRecognizer(target: self, action: #selector(moved))
    move.maximumNumberOfTouches = 1
    move.delegate = self
    addGestureRecognizer(move)
    let tap = UITapGestureRecognizer(target: self, action: #selector(tapped))
    addGestureRecognizer(tap)
    let fit = UITapGestureRecognizer(target: self, action: #selector(fitted))
    fit.numberOfTapsRequired = 2
    tap.require(toFail: fit)
    addGestureRecognizer(fit)
    accessibilityLabel = "사진 편집 미리보기"
    accessibilityHint = "두 손가락 확대·축소, 한 손가락 이동, 두 번 탭하여 맞춤"
    if #available(iOS 16.0, *) { (layer as? CAMetalLayer)?.wantsExtendedDynamicRangeContent = true }
    NotificationCenter.default.addObserver(
      self, selector: #selector(memoryWarning),
      name: UIApplication.didReceiveMemoryWarningNotification, object: nil)
  }
  deinit { NotificationCenter.default.removeObserver(self) }
  @objc func memoryWarning() {
    engine.p3.clearCaches()
    engine.srgb.clearCaches()
    NativeLibrary.shared.work.async { self.engine.clearMaskCache() }
  }
  func load(library: NativeLibrary, compare: Bool, proofSDR: Bool, maskID: String, overlay: Bool) {
    guard let photo = library.current else {
      image = nil
      source = nil
      file = ""
      setNeedsDisplay()
      return
    }
    let changed = file != photo.file
    let nextFlags = "\(compare)/\(proofSDR)/\(maskID)/\(overlay)"
    if !changed, flags == nextFlags, let previous,
      NSDictionary(dictionary: previous.values).isEqual(to: photo.settings.values)
    {
      return
    }
    previous = photo.settings
    flags = nextFlags
    if changed {
      zoom = 1
      pan = .zero
      file = photo.file
      source = nil
    }
    settings = photo.settings
    if #available(iOS 16.0, *) {
      (layer as? CAMetalLayer)?.wantsExtendedDynamicRangeContent = settings.hdr && !proofSDR
    }
    activeMask = compare ? nil : settings.masks.first { $0.id == maskID }
    serial += 1
    let token = serial
    pendingLock.lock()
    pendingToken = token
    pendingLock.unlock()
    let cached = source
    let url = library.url(photo)
    let a = settings
    let selectedMask = activeMask
    let interactiveWarp = warp != nil
    library.work.async {
      self.pendingLock.lock()
      let latest = self.pendingToken == token
      self.pendingLock.unlock()
      guard latest else { return }
      do {
        let source = try cached ?? self.engine.source(url)
        let image = try self.engine.render(source.image, a, compare: compare, sdr: proofSDR)
        var coverage: CIImage?
        if overlay, let mask = selectedMask {
          var selection = try self.engine.maskImage(mask, extent: source.image.extent)
          if mask.inverted { selection = selection.applyingFilter("CIColorInvert") }
          if !mask.enabled || mask.points.isEmpty {
            selection = CIImage(color: .black).cropped(to: source.image.extent)
          }
          selection = selection.applyingFilter(
            "CIColorMatrix",
            parameters: [
              "inputRVector": CIVector(x: mask.opacity, y: 0, z: 0, w: 0),
              "inputGVector": CIVector(x: 0, y: mask.opacity, z: 0, w: 0),
              "inputBVector": CIVector(x: 0, y: 0, z: mask.opacity, w: 0),
            ])
          coverage = try self.engine.geometry(selection, a)
        }
        var histogram: [[Int]]?
        if !interactiveWarp {
          let histogramImage = image.transformed(
            by: CGAffineTransform(scaleX: 64 / image.extent.width, y: 64 / image.extent.height))
          var pixels = [UInt8](repeating: 0, count: 64 * 64 * 4)
          pixels.withUnsafeMutableBytes {
            self.engine.context(a).render(
              histogramImage, toBitmap: $0.baseAddress!, rowBytes: 64 * 4,
              bounds: CGRect(x: 0, y: 0, width: 64, height: 64), format: .RGBA8,
              colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
          }
          var bins = [[Int]](repeating: [Int](repeating: 0, count: 64), count: 3)
          for i in stride(from: 0, to: pixels.count, by: 4) {
            for channel in 0..<3 { bins[channel][Int(pixels[i + channel]) / 4] += 1 }
          }
          histogram = bins
        }
        DispatchQueue.main.async {
          guard self.serial == token else { return }
          self.source = source
          self.image = image
          self.overlayImage = coverage
          self.clampPan()
          self.reportZoom()
          if let histogram { self.onHistogram?(histogram) }
          self.setNeedsDisplay()
        }
      } catch {
        DispatchQueue.main.async {
          if self.serial == token { library.message = error.localizedDescription }
        }
      }
    }
  }
  private var fitScale: Double {
    guard let image else { return 1 }
    return min(
      Double(bounds.width) / image.extent.width, Double(bounds.height) / image.extent.height)
  }
  private var scale: Double { fitScale * zoom }
  private var origin: CGPoint {
    guard let image else { return .zero }
    return CGPoint(
      x: (Double(bounds.width) - image.extent.width * scale) / 2 + pan.x,
      y: (Double(bounds.height) - image.extent.height * scale) / 2 + pan.y)
  }
  private func clampPan() {
    guard let image else { return }
    let x = max(0, (image.extent.width * scale - Double(bounds.width)) / 2)
    let y = max(0, (image.extent.height * scale - Double(bounds.height)) / 2)
    pan.x = max(-x, min(x, pan.x))
    pan.y = max(-y, min(y, pan.y))
  }
  override func layoutSubviews() {
    super.layoutSubviews()
    clampPan()
    setNeedsDisplay()
  }
  override func draw(_ rect: CGRect) {
    guard let drawable = currentDrawable, let command = engine.queue.makeCommandBuffer() else {
      return
    }
    let pixels = CGRect(origin: .zero, size: drawableSize)
    var output = CIImage(color: CIColor(red: 0.07, green: 0.08, blue: 0.085)).cropped(to: pixels)
    if var picture = image {
      if let coverage = overlayImage {
        let tint = CIImage(color: CIColor(red: 1, green: 0.15, blue: 0.4, alpha: 0.32)).cropped(
          to: picture.extent)
        picture = tint.applyingFilter(
          "CIBlendWithMask",
          parameters: [kCIInputBackgroundImageKey: picture, kCIInputMaskImageKey: coverage])
      }
      let ratio = drawableSize.width / max(1, bounds.width)
      let s = scale * ratio
      let o = origin
      let transform = CGAffineTransform(scaleX: s, y: s).concatenating(
        CGAffineTransform(
          translationX: o.x * ratio,
          y: drawableSize.height - (o.y + picture.extent.height * scale) * ratio))
      output = picture.transformed(by: transform).composited(over: output)
    }
    engine.context(settings).render(
      output, to: drawable.texture, commandBuffer: command, bounds: pixels,
      colorSpace: CGColorSpace(name: CGColorSpace.extendedLinearDisplayP3)!)
    command.present(drawable)
    command.commit()
  }
  func applyZoom(_ percent: Double, revision: Int) {
    guard revision != zoomRevision else { return }
    zoomRevision = revision
    zoom = percent == 0 ? 1 : percent / 100 / max(fitScale, 0.0001)
    pan = .zero
    clampPan()
    setNeedsDisplay()
    DispatchQueue.main.async { self.reportZoom() }
  }
  private func reportZoom() {
    onZoom?(abs(zoom - 1) < 0.0001 ? "맞춤" : String(format: "%.0f%%", scale * 100))
  }
  @objc func fitted() {
    zoom = 1
    pan = .zero
    reportZoom()
    setNeedsDisplay()
  }
  @objc func pinched(_ recognizer: UIPinchGestureRecognizer) {
    guard image != nil else { return }
    let p = recognizer.location(in: self)
    if recognizer.state == .began {
      cancelLiquify()
      scaleStart = zoom
      let o = origin
      pinchAnchor = CGPoint(x: (p.x - o.x) / scale, y: (p.y - o.y) / scale)
      drawing = []
    }
    zoom = max(
      0.01 / max(fitScale, 0.0001), min(4 / max(fitScale, 0.0001), scaleStart * recognizer.scale))
    if recognizer.state == .ended || recognizer.state == .cancelled { reportZoom() }
    guard let image else { return }
    pan = CGPoint(
      x: p.x - pinchAnchor.x * scale - (Double(bounds.width) - image.extent.width * scale) / 2,
      y: p.y - pinchAnchor.y * scale - (Double(bounds.height) - image.extent.height * scale) / 2)
    clampPan()
    setNeedsDisplay()
  }
  private func point(_ location: CGPoint) -> NativePoint? {
    guard let image, let source else { return nil }
    let o = origin
    let display = CGPoint(x: (location.x - o.x) / scale, y: (location.y - o.y) / scale)
    guard display.x >= 0, display.y >= 0, display.x <= image.extent.width,
      display.y <= image.extent.height
    else { return nil }
    let angle = settings["rotation"] * Double.pi / 180
    let c = cos(angle).rounded()
    let s = sin(angle).rounded()
    let x = (display.x - image.extent.width / 2) * (settings.flip ? -1 : 1)
    let y = display.y - image.extent.height / 2
    return NativePoint(
      x: max(0, min(1, 0.5 + (c * x + s * y) / source.image.extent.width)),
      y: max(0, min(1, 0.5 + (-s * x + c * y) / source.image.extent.height)))
  }
  @objc func tapped(_ recognizer: UITapGestureRecognizer) {
    if activeMask?.kind == "subject", maskTool == "ai" || maskTool == "ai-erase",
      let p = point(recognizer.location(in: self))
    {
      onPoints?([p])
    }
  }
  private func cancelLiquify() {
    if warpChanged { onLiquify?(warpStart, false) }
    brushOutline.path = nil
    warpChanged = false
    warp = nil
    warpPoint = nil
  }
  @objc func moved(_ recognizer: UIPanGestureRecognizer) {
    if liquify {
      if recognizer.state == .began {
        warpStart = settings.values["liquify"] as? [String: Any]
        warp = try? NativeLiquify(warpStart)
        let location = recognizer.location(in: self)
        let delta = recognizer.translation(in: self)
        warpPoint = point(CGPoint(x: location.x - delta.x, y: location.y - delta.y))
        warpTime = 0
        warpChanged = false
      }
      if recognizer.state == .cancelled {
        cancelLiquify()
        return
      }
      let location = recognizer.location(in: self)
      let brushSize =
        brushRadius * min(source?.image.extent.width ?? 1, source?.image.extent.height ?? 1) * scale
      brushOutline.path =
        UIBezierPath(
          ovalIn: CGRect(
            x: location.x - brushSize, y: location.y - brushSize, width: brushSize * 2,
            height: brushSize * 2)
        ).cgPath
      let now = CACurrentMediaTime()
      if now - warpTime >= 1.0 / 30 || recognizer.state == .ended,
        let p = point(recognizer.location(in: self)), let from = warpPoint, let source
      {
        if hypot(p.x - from.x, p.y - from.y) > 0.000001 { warpChanged = true }
        warp?.push(
          from: from, to: p, radius: brushRadius, strength: brushStrength,
          width: source.image.extent.width, height: source.image.extent.height)
        warpPoint = p
        warpTime = now
        if warpChanged { onLiquify?(warp?.dictionary, recognizer.state == .ended) }
      } else if recognizer.state == .ended, warpChanged {
        onLiquify?(warp?.dictionary, true)
      }
      if recognizer.state == .ended {
        warp = nil
        warpPoint = nil
        brushOutline.path = nil
        warpChanged = false
      }
      return
    }
    if let mask = activeMask, mask.kind != "subject" || (maskTool != "ai" && maskTool != "ai-erase")
    {
      if recognizer.state == .began { drawing = [] }
      if let p = point(recognizer.location(in: self)), drawing.count < 1024 { drawing.append(p) }
      if recognizer.state == .ended {
        onPoints?(drawing)
        drawing = []
      }
      if recognizer.state == .cancelled { drawing = [] }
      return
    }
    if recognizer.state == .began { panStart = pan }
    let delta = recognizer.translation(in: self)
    pan = CGPoint(x: panStart.x + delta.x, y: panStart.y + delta.y)
    clampPan()
    setNeedsDisplay()
  }
}
