import CoreImage
import Foundation
import ImageIO
import Metal
import UniformTypeIdentifiers
import libwebp

struct NativeSource {
  let image: CIImage
  let properties: [String: Any]
  let hdr: Bool
  let raw: Bool
}
final class NativeRenderEngine {
  static let shared = NativeRenderEngine()
  let device: MTLDevice
  let queue: MTLCommandQueue
  let p3: CIContext, srgb: CIContext
  private var liquifyCache: (String, CIImage, Double)?
  private var kernels: [String: CIKernel] = [:]
  private var maskCache: [String: (shape: NativeMask, size: CGSize, image: CIImage)] = [:]
  init() {
    device = MTLCreateSystemDefaultDevice()!
    queue = device.makeCommandQueue()!
    p3 = CIContext(
      mtlDevice: device,
      options: [
        .workingColorSpace: CGColorSpace(name: CGColorSpace.extendedLinearDisplayP3)!,
        .workingFormat: CIFormat.RGBAf, .cacheIntermediates: false,
      ])
    srgb = CIContext(
      mtlDevice: device,
      options: [
        .workingColorSpace: CGColorSpace(name: CGColorSpace.extendedLinearSRGB)!,
        .workingFormat: CIFormat.RGBAf, .cacheIntermediates: false,
      ])
    do {
      let data = try Data(
        contentsOf: Bundle.main.url(forResource: "default", withExtension: "metallib")!)
      for name in [
        "nativeQuantize", "nativeExposure", "nativeEdit", "nativeSkin", "nativeBilateral",
        "nativeCoverage",
        "nativeLocal", "nativeRange", "nativePQ", "nativeLiquify",
      ] {
        kernels[name] = try CIKernel(functionName: name, fromMetalLibraryData: data)
      }
    } catch { NSLog("Native kernel load failed: %@", error.localizedDescription) }
  }
  func context(_ settings: NativeSettings) -> CIContext {
    settings.string("colorSpace") == "display-p3" ? p3 : srgb
  }
  static func pqPNG(_ url: URL) -> Bool {
    guard let handle = try? FileHandle(forReadingFrom: url) else { return false }
    defer { try? handle.close() }
    guard let signature = try? handle.read(upToCount: 8),
      signature == Data([137, 80, 78, 71, 13, 10, 26, 10])
    else { return false }
    while let header = try? handle.read(upToCount: 8), header.count == 8 {
      let count = header.prefix(4).reduce(0) { $0 * 256 + Int($1) }
      guard count >= 0, count <= 256 * 1024 * 1024 else { return false }
      let type = String(data: header.suffix(4), encoding: .ascii)
      if type == "cICP" {
        return count == 4 && (try? handle.read(upToCount: 4)) == Data([9, 16, 0, 1])
      }
      if type == "IDAT" || type == "IEND" { return false }
      guard let offset = try? handle.offset(),
        (try? handle.seek(toOffset: offset + UInt64(count) + 4)) != nil
      else { return false }
    }
    return false
  }
  func source(_ url: URL) throws -> NativeSource {
    guard
      let source = CGImageSourceCreateWithURL(
        url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
      let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any]
    else { throw NativeImageError.invalid("사진 원본을 읽지 못했습니다.") }
    let raw =
      UTType(filenameExtension: url.pathExtension).map { $0.conforms(to: .rawImage) }
      ?? ["dng", "nef", "cr2", "cr3", "arw", "raf", "rw2", "orf"].contains(
        url.pathExtension.lowercased())
    let pq = Self.pqPNG(url)
    let image: CIImage
    if raw {
      guard let f = CIRAWFilter(imageURL: url), let output = f.outputImage else {
        throw NativeImageError.invalid("이 카메라 RAW를 현상할 수 없습니다.")
      }
      f.extendedDynamicRangeAmount = 1
      f.isDraftModeEnabled = false
      image = f.outputImage ?? output
    } else {
      var options: [CIImageOption: Any] = [
        .applyOrientationProperty: true, .cacheImmediately: false,
      ]
      if #available(iOS 17.0, *) { options[.expandToHDR] = true }
      if #available(iOS 18.0, *), let headroom = properties["Headroom"] as? NSNumber {
        options[.contentHeadroom] = headroom
      }
      if pq { options[.colorSpace] = CGColorSpace(name: CGColorSpace.itur_2100_PQ)! }
      guard let output = CIImage(contentsOf: url, options: options) else {
        throw NativeImageError.invalid("지원하지 않는 사진입니다.")
      }
      image = output
    }
    let extent = image.extent.integral
    guard extent.width > 0, extent.height > 0, extent.width * extent.height <= 100_000_000 else {
      throw NativeImageError.invalid("최대 100MP를 지원합니다.")
    }
    var hdr =
      pq
      || CGImageSourceCopyAuxiliaryDataInfoAtIndex(source, 0, kCGImageAuxiliaryDataTypeHDRGainMap)
        != nil
      || (image.colorSpace.map { CGColorSpaceUsesITUR_2100TF($0) } ?? false)
      || ["PQ", "HLG"].contains(where: {
        (properties[kCGImagePropertyProfileName as String] as? String ?? "").uppercased().contains(
          $0)
      })
    if #available(iOS 18.0, *) {
      hdr =
        hdr
        || CGImageSourceCopyAuxiliaryDataInfoAtIndex(source, 0, kCGImageAuxiliaryDataTypeISOGainMap)
          != nil
    }
    return NativeSource(
      image: image.transformed(by: CGAffineTransform(translationX: -extent.minX, y: -extent.minY)),
      properties: properties, hdr: hdr, raw: raw)
  }
  private func apply(_ name: String, _ extent: CGRect, _ args: [Any], padding: Double = 0) throws
    -> CIImage
  {
    guard let kernel = kernels[name],
      let image = kernel.apply(
        extent: extent, roiCallback: { _, rect in rect.insetBy(dx: -padding, dy: -padding) },
        arguments: args)
    else { throw NativeImageError.invalid("네이티브 보정 엔진을 실행하지 못했습니다: \(name)") }
    return image
  }
  func liquified(_ source: CIImage, _ settings: NativeSettings) throws -> CIImage {
    guard let value = settings.values["liquify"] as? [String: Any],
      let key = value["data"] as? String
    else { return source }
    if liquifyCache?.0 != key {
      let grid = try NativeLiquify(value)
      var pixels = [Float](repeating: 0, count: NativeLiquify.size * NativeLiquify.size * 4)
      var bound = 0.0
      for i in 0..<grid.data.count / 2 {
        pixels[i * 4] = grid.data[i * 2]
        pixels[i * 4 + 1] = grid.data[i * 2 + 1]
        pixels[i * 4 + 3] = 1
        bound = max(bound, Double(abs(grid.data[i * 2])), Double(abs(grid.data[i * 2 + 1])))
      }
      let bytes = pixels.withUnsafeBytes { Data($0) }
      let field = CIImage(
        bitmapData: bytes, bytesPerRow: NativeLiquify.size * 16,
        size: CGSize(width: NativeLiquify.size, height: NativeLiquify.size), format: .RGBAf,
        colorSpace: nil)
      liquifyCache = (key, field, bound)
    }
    let field = liquifyCache!.1.transformed(
      by: CGAffineTransform(
        scaleX: source.extent.width / Double(NativeLiquify.size - 1),
        y: source.extent.height / Double(NativeLiquify.size - 1)
      ).concatenating(
        CGAffineTransform(
          translationX: -source.extent.width / Double((NativeLiquify.size - 1) * 2),
          y: -source.extent.height / Double((NativeLiquify.size - 1) * 2))))
    let padding = liquifyCache!.2 * max(source.extent.width, source.extent.height) + 3
    guard let kernel = kernels["nativeLiquify"],
      let output = kernel.apply(
        extent: source.extent,
        roiCallback: { index, rect in
          index == 0 ? rect.insetBy(dx: -padding, dy: -padding).intersection(source.extent) : rect
        },
        arguments: [source, field, CIVector(x: source.extent.width, y: source.extent.height)])
    else {
      throw NativeImageError.invalid("리퀴파이 GPU 처리를 시작하지 못했습니다.")
    }
    return output
  }
  func geometry(_ image: CIImage, _ a: NativeSettings) -> CIImage {
    let rotation = Int(a["rotation"]) % 360
    var result = image.oriented(
      rotation == 90 ? .right : rotation == 180 ? .down : rotation == 270 ? .left : .up)
    if a.flip { result = result.oriented(.upMirrored) }
    let size = a.dimensions(width: Int(image.extent.width), height: Int(image.extent.height))
    result = result.cropped(
      to: CGRect(
        x: result.extent.midX - size.width / 2, y: result.extent.midY - size.height / 2,
        width: size.width, height: size.height))
    return result.transformed(
      by: CGAffineTransform(translationX: -result.extent.minX, y: -result.extent.minY))
  }
  func render(_ source: CIImage, _ a: NativeSettings, compare: Bool = false, sdr: Bool = false)
    throws -> CIImage
  {
    var image = geometry(compare ? source : try liquified(source, a), a)
    let extent = image.extent
    if compare { return image }
    let legacy = a.string("precision") == "legacy" ? 1.0 : 0.0
    image = try apply(
      legacy == 1 ? "nativeQuantize" : "nativeExposure", extent,
      legacy == 1 ? [image] : [image, a["exposure"], legacy])
    if a["skinSmooth"] != 0 || a["skinRedness"] != 0 || a["skinBrightness"] != 0 {
      var blurred = image
      if a["skinSmooth"] > 0 {
        let radius = max(1, min(12, (min(extent.width, extent.height) * 0.003).rounded()))
        blurred = try apply(
          "nativeBilateral", extent,
          [
            image.clampedToExtent(), image.clampedToExtent(),
            CIVector(x: radius, y: 0, z: a.string("colorSpace") == "display-p3" ? 1 : 0, w: legacy),
          ],
          padding: radius * 2)
        blurred = try apply(
          "nativeBilateral", extent,
          [
            image.clampedToExtent(), blurred.clampedToExtent(),
            CIVector(x: 0, y: radius, z: a.string("colorSpace") == "display-p3" ? 1 : 0, w: legacy),
          ],
          padding: radius * 2)
      }
      image = try apply(
        "nativeSkin", extent,
        [
          image, blurred,
          CIVector(
            x: a["skinSmooth"], y: a["skinRedness"], z: a["skinBrightness"],
            w: a.string("colorSpace") == "display-p3" ? 1 : 0), legacy,
        ])
    }
    if legacy == 1 { image = try apply("nativeExposure", extent, [image, a["exposure"], legacy]) }
    var args: [Any] = [
      image,
      CIVector(x: a["contrast"], y: a["shadows"], z: a["highlights"], w: a["whites"]),
      CIVector(x: a["blacks"], y: a["temperature"], z: a["tint"], w: a["saturation"]),
      CIVector(x: a["vibrance"], y: a["fade"], z: a["vignette"], w: 0),
      CIVector(
        x: extent.width, y: extent.height, z: a.string("colorSpace") == "display-p3" ? 1 : 0,
        w: legacy),
      CIVector(x: a["curveShadows"], y: a["curveMidtones"], z: a["curveHighlights"]),
    ]
    for band in NativeSettings.bands {
      args.append(
        CIVector(
          x: a["mixer_\(band)_hue"], y: a["mixer_\(band)_saturation"],
          z: a["mixer_\(band)_luminance"]))
    }
    image = try apply("nativeEdit", extent, args)
    for mask in a.masks where mask.enabled && mask.opacity > 0 && !mask.points.isEmpty {
      let coverage = try geometry(maskImage(mask, extent: source.extent), a)
      image = try apply(
        "nativeLocal", extent,
        [
          image, coverage,
          CIVector(x: mask.exposure, y: mask.contrast, z: mask.saturation, w: mask.temperature),
          CIVector(
            x: mask.inverted ? 1 : 0, y: mask.opacity,
            z: a.string("colorSpace") == "display-p3" ? 1 : 0),
        ])
    }
    if legacy == 1 { image = try apply("nativeQuantize", extent, [image]) }
    if a.hdr || sdr {
      image = try apply(
        "nativeRange", extent,
        [image, CIVector(x: a.hdr ? a["hdrHighlights"] : 0, y: a["hdrPeak"], z: sdr ? 1 : 0, w: 0)])
    }
    return image
  }
  func clearMaskCache() { maskCache.removeAll() }
  func maskImage(_ mask: NativeMask, extent: CGRect) throws -> CIImage {
    var shape = mask
    shape.exposure = 0
    shape.contrast = 0
    shape.saturation = 0
    shape.temperature = 0
    shape.opacity = 1
    shape.inverted = false
    shape.enabled = true
    shape.name = ""
    if let cached = maskCache[mask.id], cached.shape == shape, cached.size == extent.size {
      return cached.image
    }
    let factor = min(1, 1024 / max(extent.width, extent.height))
    let width = max(1, Int((extent.width * factor).rounded()))
    let height = max(1, Int((extent.height * factor).rounded()))
    let bounds = CGRect(x: 0, y: 0, width: width, height: height)
    let graph = try buildMask(mask, extent: bounds)
    var pixels = [UInt8](repeating: 0, count: width * height * 4)
    pixels.withUnsafeMutableBytes {
      srgb.render(
        graph, toBitmap: $0.baseAddress!, rowBytes: width * 4, bounds: bounds, format: .RGBA8,
        colorSpace: nil)
    }
    let result = CIImage(
      bitmapData: Data(pixels), bytesPerRow: width * 4, size: bounds.size, format: .RGBA8,
      colorSpace: nil
    ).transformed(
      by: CGAffineTransform(scaleX: extent.width / Double(width), y: extent.height / Double(height))
    )
    if maskCache.count >= 8 && maskCache[mask.id] == nil { maskCache.removeAll() }
    maskCache[mask.id] = (shape, extent.size, result)
    return result
  }
  private func buildMask(_ mask: NativeMask, extent: CGRect) throws -> CIImage {
    var result = CIImage(color: .black).cropped(to: extent)
    if let raster = mask.raster, let data = Data(base64Encoded: raster.data),
      data.count == raster.width * raster.height
    {
      let provider = CGDataProvider(data: data as CFData)!
      if let cg = CGImage(
        width: raster.width, height: raster.height, bitsPerComponent: 8, bitsPerPixel: 8,
        bytesPerRow: raster.width, space: CGColorSpaceCreateDeviceGray(),
        bitmapInfo: CGBitmapInfo(rawValue: 0), provider: provider, decode: nil,
        shouldInterpolate: true, intent: .defaultIntent)
      {
        result = CIImage(cgImage: cg, options: [.colorSpace: NSNull()]).transformed(
          by: CGAffineTransform(
            scaleX: extent.width / Double(raster.width), y: extent.height / Double(raster.height)))
      }
    }
    func segment(
      _ a: NativePoint, _ b: NativePoint, _ radius: Double, _ feather: Double, _ kind: Double
    ) throws -> CIImage {
      try apply(
        "nativeCoverage", extent,
        [
          CIVector(
            x: a.x * extent.width, y: (1 - a.y) * extent.height, z: b.x * extent.width,
            w: (1 - b.y) * extent.height),
          CIVector(x: radius * min(extent.width, extent.height), y: feather, z: 0, w: 0), kind,
        ])
    }
    if mask.kind == "linear" || mask.kind == "radial", mask.points.count >= 2 {
      result = try segment(
        mask.points[0], mask.points[1], mask.radius, mask.feather, mask.kind == "linear" ? 1 : 2)
    }
    if mask.kind == "brush" {
      for (i, p) in mask.points.enumerated() {
        let a = p.start == true || i == 0 ? p : mask.points[i - 1]
        let next = try segment(a, p, mask.radius, mask.feather, 0)
        result = next.applyingFilter(
          "CIMaximumCompositing", parameters: [kCIInputBackgroundImageKey: result])
      }
    }
    for stroke in mask.strokes ?? [] {
      var coverage = CIImage(color: .black).cropped(to: extent)
      for (i, p) in stroke.points.enumerated() {
        let next = try segment(
          i == 0 ? p : stroke.points[i - 1], p, stroke.radius, stroke.feather, 0)
        coverage = next.applyingFilter(
          "CIMaximumCompositing", parameters: [kCIInputBackgroundImageKey: coverage])
      }
      if stroke.erase {
        coverage = coverage.applyingFilter("CIColorInvert")
        result = coverage.applyingFilter(
          "CIMultiplyCompositing", parameters: [kCIInputBackgroundImageKey: result])
      } else {
        result = CIImage(color: .white).cropped(to: extent).applyingFilter(
          "CIBlendWithMask",
          parameters: [kCIInputBackgroundImageKey: result, kCIInputMaskImageKey: coverage])
      }
    }
    return result
  }
  func png(
    _ image: CIImage, space: String, depth: Int, properties: [String: Any],
    settings: NativeSettings = NativeSettings(["colorSpace": "display-p3"])
  ) throws -> Data {
    let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(
      UUID().uuidString + ".png")
    defer { try? FileManager.default.removeItem(at: temporary) }
    try writePNG(
      image, url: temporary, space: space, depth: depth, properties: properties, settings: settings)
    return try Data(contentsOf: temporary)
  }
  private func normalizedProperties(_ original: [String: Any], width: Int, height: Int) -> [String:
    Any]
  {
    var result = original
    result[kCGImagePropertyOrientation as String] = 1
    var exif = result[kCGImagePropertyExifDictionary as String] as? [String: Any] ?? [:]
    exif[kCGImagePropertyExifPixelXDimension as String] = width
    exif[kCGImagePropertyExifPixelYDimension as String] = height
    result[kCGImagePropertyExifDictionary as String] = exif
    var tiff = result[kCGImagePropertyTIFFDictionary as String] as? [String: Any] ?? [:]
    tiff[kCGImagePropertyTIFFOrientation as String] = 1
    result[kCGImagePropertyTIFFDictionary as String] = tiff
    return result
  }
  func writePNG(
    _ input: CIImage, url: URL, space: String, depth: Int, properties: [String: Any],
    settings: NativeSettings, opaque: Bool = false
  ) throws {
    let hdr = space == "hdr"
    let color = CGColorSpace(
      name: space == "display-p3" ? CGColorSpace.displayP3 : CGColorSpace.sRGB)!
    let image =
      hdr
      ? try apply(
        "nativePQ", input.extent,
        [
          input,
          CIVector(
            x: settings.string("colorSpace") == "display-p3" ? 1 : 0, y: settings["hdrPeak"]),
        ]) : input
    let width = Int(image.extent.width.rounded())
    let height = Int(image.extent.height.rounded())
    let profile = (hdr ? CGColorSpace(name: CGColorSpace.itur_2100_PQ) : color)?.copyICCData().map {
      $0 as Data
    }
    let writer = try NativePNGWriter(
      url: url, width: width, height: height, depth: depth, profile: profile, hdr: hdr,
      exif: NativePNGWriter.exif(normalizedProperties(properties, width: width, height: height)),
      opaque: opaque)
    let rowSize = width * 4 * (depth == 16 ? 2 : 1)
    for top in stride(from: 0, to: height, by: 128) {
      try autoreleasepool {
        let rows = min(128, height - top)
        let bounds = CGRect(x: 0, y: height - top - rows, width: width, height: rows)
        var bytes = Data(count: rowSize * rows)
        bytes.withUnsafeMutableBytes {
          context(settings).render(
            image, toBitmap: $0.baseAddress!, rowBytes: rowSize, bounds: bounds,
            format: depth == 16 ? .RGBA16 : .RGBA8, colorSpace: hdr ? nil : color)
        }
        for row in 0..<rows {
          var scan = bytes.subdata(in: row * rowSize..<(row + 1) * rowSize)
          scan.withUnsafeMutableBytes { (raw: UnsafeMutableRawBufferPointer) in
            if depth == 16 {
              let values = raw.bindMemory(to: UInt16.self)
              for offset in Swift.stride(from: 0, to: values.count, by: 4) {
                let alpha = UInt64(values[offset + 3])
                for c in 0..<3 {
                  values[offset + c] =
                    alpha == 0
                    ? 0
                    : UInt16(min(65535, (UInt64(values[offset + c]) * 65535 + alpha / 2) / alpha))
                }
              }
              for index in values.indices { values[index] = values[index].bigEndian }
            } else {
              for offset in Swift.stride(from: 0, to: raw.count, by: 4) {
                let alpha = Int(raw[offset + 3])
                for c in 0..<3 {
                  raw[offset + c] =
                    alpha == 0
                    ? 0 : UInt8(min(255, (Int(raw[offset + c]) * 255 + alpha / 2) / alpha))
                }
              }
            }
          }
          if opaque {
            let sampleBytes = depth / 8
            var rgb = Data(count: width * 3 * sampleBytes)
            rgb.withUnsafeMutableBytes { output in
              scan.withUnsafeBytes { input in
                for pixel in 0..<width {
                  output.baseAddress!.advanced(by: pixel * 3 * sampleBytes).copyMemory(
                    from: input.baseAddress!.advanced(by: pixel * 4 * sampleBytes),
                    byteCount: 3 * sampleBytes)
                }
              }
            }
            try writer.row(rgb)
          } else {
            try writer.row(scan)
          }
        }
      }
    }
    try writer.finish()
  }
  func export(
    _ photo: NativePhoto, url: URL, format: String, space: String, maxSide: Double, quality: Double,
    preserve: Bool
  ) throws -> URL {
    let source = try self.source(url)
    let adaptiveHDR = photo.settings.hdr && (format == "jpeg" || format == "heif")
    let sdr = photo.settings.hdr && format != "hdr-png" && !adaptiveHDR
    var image = try render(source.image, photo.settings, sdr: sdr)
    let scale = min(1, maxSide / max(image.extent.width, image.extent.height))
    if scale < 1 { image = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale)) }
    var properties: [String: Any] = [:]
    if preserve {
      for key in [
        kCGImagePropertyExifDictionary, kCGImagePropertyTIFFDictionary,
        kCGImagePropertyGPSDictionary,
      ] { properties[key as String] = source.properties[key as String] }
    }
    properties[kCGImagePropertyOrientation as String] = 1
    var exif = properties[kCGImagePropertyExifDictionary as String] as? [String: Any] ?? [:]
    exif[kCGImagePropertyExifPixelXDimension as String] = Int(image.extent.width)
    exif[kCGImagePropertyExifPixelYDimension as String] = Int(image.extent.height)
    exif[kCGImagePropertyExifColorSpace as String] = space == "srgb" ? 1 : 65535
    properties[kCGImagePropertyExifDictionary as String] = exif
    var tiff = properties[kCGImagePropertyTIFFDictionary as String] as? [String: Any] ?? [:]
    tiff[kCGImagePropertyTIFFOrientation as String] = 1
    properties[kCGImagePropertyTIFFDictionary as String] = tiff
    let ext =
      format.contains("png") ? "png" : format == "webp" ? "webp" : format == "heif" ? "heic" : "jpg"
    let target = FileManager.default.temporaryDirectory.appendingPathComponent(
      URL(fileURLWithPath: photo.name).deletingPathExtension().lastPathComponent + "-edited." + ext)
    if format.contains("png") {
      try writePNG(
        image, url: target, space: format == "hdr-png" ? "hdr" : space,
        depth: format == "png" ? 8 : 16, properties: properties, settings: photo.settings,
        opaque: (source.properties[kCGImagePropertyHasAlpha as String] as? Bool) != true)
    } else if format == "webp" {
      guard image.extent.width * image.extent.height <= 32_000_000 else {
        throw NativeImageError.invalid("32MP 초과 출력은 PNG를 사용해 주세요.")
      }
      let width = Int(image.extent.width)
      let height = Int(image.extent.height)
      let stride = width * 4
      var pixels = Data(count: stride * height)
      let cs = CGColorSpace(
        name: space == "display-p3" ? CGColorSpace.displayP3 : CGColorSpace.sRGB)!
      pixels.withUnsafeMutableBytes {
        context(photo.settings).render(
          image, toBitmap: $0.baseAddress!, rowBytes: stride, bounds: image.extent, format: .RGBA8,
          colorSpace: cs)
      }
      // Core Image bitmap rows are top-down and premultiplied; WebP requires straight alpha.
      pixels.withUnsafeMutableBytes { (raw: UnsafeMutableRawBufferPointer) in
        for offset in Swift.stride(from: 0, to: raw.count, by: 4) {
          let alpha = Int(raw[offset + 3])
          for channel in 0..<3 {
            raw[offset + channel] =
              alpha == 0 ? 0 : UInt8(min(255, Int(raw[offset + channel]) * 255 / alpha))
          }
        }
      }
      var encoded: UnsafeMutablePointer<UInt8>?
      let size = pixels.withUnsafeBytes {
        WebPEncodeRGBA(
          $0.bindMemory(to: UInt8.self).baseAddress!, Int32(width), Int32(height), Int32(stride),
          Float(quality * 100), &encoded)
      }
      guard size > 0, let encoded else { throw NativeImageError.invalid("WebP 저장 실패") }
      defer { WebPFree(encoded) }
      let input = Data(bytes: encoded, count: size)
      let output = try webPMetadata(
        input, profile: cs.copyICCData().map { $0 as Data },
        exif: preserve ? NativePNGWriter.exif(properties) : nil, width: width, height: height)
      try output.write(to: target, options: .atomic)
    } else {
      guard image.extent.width * image.extent.height <= 32_000_000 else {
        throw NativeImageError.invalid("32MP 초과 출력은 PNG를 사용해 주세요.")
      }
      let cs = CGColorSpace(
        name: space == "display-p3" ? CGColorSpace.displayP3 : CGColorSpace.sRGB)!
      var options: [CIImageRepresentationOption: Any] = [
        CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String):
          quality
      ]
      var base = image
      if adaptiveHDR {
        guard #available(iOS 18.0, *) else {
          throw NativeImageError.invalid("HDR JPEG·HEIF 출력에는 iOS 18 이상이 필요합니다. HDR PNG를 선택하세요.")
        }
        if #available(iOS 26.0, *) {
          image = image.settingContentHeadroom(Float(photo.settings["hdrPeak"] / 203))
        }
        options[.hdrImage] = image
        options[.hdrGainMapAsRGB] = true
        base = try render(source.image, photo.settings, sdr: true)
        if scale < 1 { base = base.transformed(by: CGAffineTransform(scaleX: scale, y: scale)) }
      }
      // Attach normalized EXIF to the SDR base; Core Image derives a NEW gain map from the edited HDR image.
      base = base.settingProperties(properties)
      if format == "heif" {
        try context(photo.settings).writeHEIFRepresentation(
          of: base, to: target, format: .RGBA8, colorSpace: cs, options: options)
      } else {
        try context(photo.settings).writeJPEGRepresentation(
          of: base, to: target, colorSpace: cs, options: options)
      }
    }
    return target
  }
  private func webPMetadata(_ input: Data, profile: Data?, exif: Data?, width: Int, height: Int)
    throws -> Data
  {
    guard input.count >= 12 else { throw NativeImageError.invalid("WebP 데이터 오류") }
    var chunks = Data()
    func little(_ value: UInt32) -> Data {
      var n = value.littleEndian
      return withUnsafeBytes(of: &n) { Data($0) }
    }
    func chunk(_ name: String, _ value: Data) {
      chunks.append(Data(name.utf8))
      chunks.append(little(UInt32(value.count)))
      chunks.append(value)
      if value.count % 2 != 0 { chunks.append(0) }
    }
    var hasAlpha = false
    var index = 12
    while index + 8 <= input.count {
      let tag = String(data: input.subdata(in: index..<index + 4), encoding: .ascii) ?? ""
      let count =
        Int(input[index + 4]) + Int(input[index + 5]) * 256 + Int(input[index + 6]) * 65536 + Int(
          input[index + 7]) * 16_777_216
      guard index + 8 + count <= input.count else { throw NativeImageError.invalid("WebP 데이터 오류") }
      if tag == "ALPH" { hasAlpha = true }
      index += 8 + count + (count % 2)
    }
    var extended = Data([
      UInt8((profile != nil ? 0x20 : 0) | (exif != nil ? 0x08 : 0) | (hasAlpha ? 0x10 : 0)), 0, 0,
      0,
    ])
    for dimension in [width - 1, height - 1] {
      extended.append(contentsOf: [
        UInt8(dimension & 255), UInt8((dimension >> 8) & 255), UInt8((dimension >> 16) & 255),
      ])
    }
    chunk("VP8X", extended)
    if let profile { chunk("ICCP", profile) }
    chunks.append(input.subdata(in: 12..<input.count))
    if let exif { chunk("EXIF", exif) }
    return Data("RIFF".utf8) + little(UInt32(chunks.count + 4)) + Data("WEBP".utf8) + chunks
  }

}
