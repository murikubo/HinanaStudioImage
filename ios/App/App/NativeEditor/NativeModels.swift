import CoreGraphics
import Foundation
import zlib

struct NativePoint: Codable, Equatable {
  var x: Double
  var y: Double
  var start: Bool?
  var exclude: Bool?
}
struct NativeStroke: Codable, Equatable {
  var points: [NativePoint]
  var radius: Double
  var feather: Double
  var erase: Bool
}
struct NativeRaster: Codable, Equatable {
  var width: Int
  var height: Int
  var data: String
}
struct NativeMask: Codable, Identifiable, Equatable {
  var id = UUID().uuidString
  var name: String
  var kind: String
  var raster: NativeRaster?
  var strokes: [NativeStroke]?
  var points: [NativePoint] = []
  var radius = 0.08, feather = 0.65, opacity = 1.0
  var inverted = false, enabled = true
  var exposure = 0.0, contrast = 0.0, saturation = 0.0, temperature = 0.0
  init(kind: String) {
    self.kind = kind
    if kind == "linear" { points = [NativePoint(x: 0.5, y: 0.25), NativePoint(x: 0.5, y: 0.75)] }
    if kind == "radial" { points = [NativePoint(x: 0.5, y: 0.5), NativePoint(x: 0.75, y: 0.75)] }
    name =
      ["brush": "브러시", "linear": "선형 그라디언트", "radial": "원형 그라디언트", "subject": "피사체"][kind] ?? kind
  }
}

extension NativeMask {
  var dictionary: [String: Any] {
    func point(_ p: NativePoint) -> [String: Any] {
      var v: [String: Any] = ["x": p.x, "y": p.y]
      if let start = p.start { v["start"] = start }
      if let exclude = p.exclude { v["exclude"] = exclude }
      return v
    }
    var result: [String: Any] = [
      "id": id, "name": name, "kind": kind, "points": points.map(point), "radius": radius,
      "feather": feather, "opacity": opacity, "inverted": inverted, "enabled": enabled,
      "exposure": exposure, "contrast": contrast, "saturation": saturation,
      "temperature": temperature,
    ]
    if let raster {
      result["raster"] = ["width": raster.width, "height": raster.height, "data": raster.data]
    }
    if let strokes {
      result["strokes"] = strokes.map {
        [
          "points": $0.points.map(point), "radius": $0.radius, "feather": $0.feather,
          "erase": $0.erase,
        ] as [String: Any]
      }
    }
    return result
  }
}
struct NativeSettings {
  var values: [String: Any] = NativeSettings.defaults
  private var decodedMasks: [NativeMask] = []
  static let bands = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"]
  static var defaults: [String: Any] {
    var result: [String: Any] = [
      "colorSpace": "srgb", "precision": "legacy", "dynamicRange": "sdr", "hdrPeak": 1000,
      "crop": "original", "flip": false, "masks": [], "liquify": NSNull(),
    ]
    for key in [
      "exposure", "contrast", "highlights", "shadows", "whites", "blacks", "temperature", "tint",
      "vibrance", "saturation", "fade", "vignette", "rotation", "hdrHighlights", "skinSmooth",
      "skinRedness", "skinBrightness", "curveShadows", "curveMidtones", "curveHighlights",
    ] { result[key] = 0.0 }
    for band in bands {
      for channel in ["hue", "saturation", "luminance"] { result["mixer_\(band)_\(channel)"] = 0.0 }
    }
    return result
  }
  init(_ dictionary: [String: Any] = [:]) {
    values = Self.defaults.merging(dictionary) { _, new in new }
    if let masks = values["masks"], let data = try? JSONSerialization.data(withJSONObject: masks) {
      decodedMasks = (try? JSONDecoder().decode([NativeMask].self, from: data)) ?? []
    }
  }
  static func validated(_ dictionary: [String: Any]) throws -> NativeSettings {
    let a = NativeSettings(dictionary)
    _ = try NativeLiquify(a.values["liquify"])
    guard ["srgb", "display-p3"].contains(a.string("colorSpace")),
      ["legacy", "float"].contains(a.string("precision")),
      ["sdr", "hdr"].contains(a.string("dynamicRange")),
      [400.0, 1000, 2000, 4000].contains(a["hdrPeak"]), !a.hdr || a.string("precision") == "float",
      ["original", "1:1", "4:5", "3:2", "16:9"].contains(a.string("crop")),
      [0.0, 90, 180, 270].contains(a["rotation"])
    else { throw NativeImageError.invalid("지원하지 않는 보정 설정입니다.") }
    for (key, value) in Self.defaults where value is NSNumber {
      guard let number = a.values[key] as? NSNumber else {
        throw NativeImageError.invalid("보정 값이 올바르지 않습니다.")
      }
      let n = number.doubleValue
      guard n.isFinite else { throw NativeImageError.invalid("보정 값이 올바르지 않습니다.") }
      if key != "rotation" && key != "hdrPeak" && key != "flip" {
        guard abs(n) <= (key == "exposure" ? 3 : 100),
          !(key.hasPrefix("skin") || key == "hdrHighlights") || n >= 0
        else { throw NativeImageError.invalid("보정 값 범위를 초과했습니다.") }
      }
    }
    guard a.values["flip"] is Bool, let values = a.values["masks"] as? [[String: Any]],
      values.count <= 8
    else { throw NativeImageError.invalid("마스크 형식이 올바르지 않습니다.") }
    let data = try JSONSerialization.data(withJSONObject: values)
    let masks = try JSONDecoder().decode([NativeMask].self, from: data)
    var ids = Set<String>()
    func point(_ p: NativePoint) -> Bool {
      p.x.isFinite && p.y.isFinite && (0...1).contains(p.x) && (0...1).contains(p.y)
    }
    for m in masks {
      guard ids.insert(m.id).inserted, m.id.count <= 80, m.name.count <= 80,
        ["brush", "linear", "radial", "subject"].contains(m.kind), m.points.count <= 1024,
        m.points.allSatisfy(point), (0.005...0.5).contains(m.radius), (0...1).contains(m.feather),
        (0...1).contains(m.opacity), abs(m.exposure) <= 3, abs(m.contrast) <= 100,
        abs(m.saturation) <= 100, abs(m.temperature) <= 100
      else { throw NativeImageError.invalid("마스크 데이터가 올바르지 않습니다.") }
      if m.kind == "linear" || m.kind == "radial" {
        guard m.points.count == 2 else { throw NativeImageError.invalid("그라디언트 좌표가 올바르지 않습니다.") }
      }
      if let r = m.raster {
        guard m.kind == "subject", r.width > 0, r.height > 0, r.width <= 1024, r.height <= 1024,
          r.data.count <= 1_398_104, let b = Data(base64Encoded: r.data),
          b.count == r.width * r.height
        else { throw NativeImageError.invalid("피사체 영역이 올바르지 않습니다.") }
      }
      if m.kind == "subject" {
        guard m.points.count <= 32, m.points.first?.exclude != true,
          m.points.isEmpty || m.raster != nil
        else { throw NativeImageError.invalid("피사체 선택 정보가 올바르지 않습니다.") }
      }
      if let strokes = m.strokes {
        guard m.kind == "subject", m.raster != nil, strokes.count <= 128,
          strokes.reduce(0, { $0 + $1.points.count }) <= 4096,
          strokes.allSatisfy({
            !$0.points.isEmpty && $0.points.allSatisfy(point) && (0.005...0.5).contains($0.radius)
              && (0...1).contains($0.feather)
          })
        else { throw NativeImageError.invalid("브러시 수정 데이터가 올바르지 않습니다.") }
      }
    }
    return a
  }
  subscript(_ key: String) -> Double {
    get { (values[key] as? NSNumber)?.doubleValue ?? 0 }
    set { values[key] = newValue }
  }
  func string(_ key: String) -> String { values[key] as? String ?? "" }
  var flip: Bool { values["flip"] as? Bool ?? false }
  var hdr: Bool { string("dynamicRange") == "hdr" }
  var masks: [NativeMask] {
    get { decodedMasks }
    set {
      decodedMasks = newValue
      values["masks"] = newValue.map(\.dictionary)
    }
  }
  func dimensions(width: Int, height: Int) -> CGSize {
    var w = Double(width)
    var h = Double(height)
    if Int(self["rotation"]) % 180 == 90 { swap(&w, &h) }
    let parts = string("crop").split(separator: ":").compactMap { Double($0) }
    if parts.count == 2, parts[0] > 0, parts[1] > 0 {
      let ratio = parts[0] / parts[1]
      if w / h > ratio { w = (h * ratio).rounded() } else { h = (w / ratio).rounded() }
    }
    return CGSize(width: w, height: h)
  }
}

final class NativePhoto: Identifiable {
  let id: String
  var name: String
  var file: String
  var rawFile: String?
  var width: Int, height: Int, rating: Int
  var settings: NativeSettings
  var history: [NativeSettings] = []
  var cursor = -1
  var metadata: [String: Any] = [:]
  init(
    id: String = UUID().uuidString, name: String, file: String, width: Int, height: Int,
    rating: Int = 0, settings: NativeSettings = NativeSettings()
  ) {
    self.id = id
    self.name = name
    self.file = file
    self.width = width
    self.height = height
    self.rating = rating
    self.settings = settings
  }
  var manifest: [String: Any] {
    var result: [String: Any] = [
      "id": id, "name": name, "file": file, "width": width, "height": height, "rating": rating,
      "adjustments": settings.values, "metadata": metadata, "undoValues": history.map(\.values),
      "undoCursor": cursor,
    ]
    if let rawFile { result["rawFile"] = rawFile }
    return result
  }
  func checkpoint() {
    if cursor + 1 < history.count { history = Array(history.prefix(cursor + 1)) }
    history.append(settings)
    cursor = history.count - 1
    if history.count > 30 {
      history.removeFirst()
      cursor -= 1
    }
  }
}

/// Undo frames contain settings only. Compression prevents subject rasters from inflating manifests.
enum NativeUndoArchive {
  static func encode(_ values: [String: Any]) throws -> String {
    let input = try JSONSerialization.data(withJSONObject: values)
    var count = compressBound(uLong(input.count))
    var compressed = Data(count: Int(count))
    let result = compressed.withUnsafeMutableBytes { out in
      input.withUnsafeBytes { bytes in
        compress2(
          out.bindMemory(to: Bytef.self).baseAddress!, &count,
          bytes.bindMemory(to: Bytef.self).baseAddress!, uLong(input.count), 6)
      }
    }
    guard result == Z_OK else { throw NativeImageError.invalid("보정 기록 압축 실패") }
    compressed.count = Int(count)
    var size = UInt32(input.count).bigEndian
    let header = withUnsafeBytes(of: &size) { Data($0) }
    return (header + compressed).base64EncodedString()
  }
  static func decode(_ value: String) throws -> NativeSettings {
    guard let bytes = Data(base64Encoded: value), bytes.count >= 4, bytes.count <= 32 * 1024 * 1024
    else { throw NativeImageError.invalid("보정 기록 형식 오류") }
    let size = bytes.prefix(4).reduce(0) { $0 * 256 + Int($1) }
    guard size > 0, size <= 32 * 1024 * 1024 else { throw NativeImageError.invalid("보정 기록 크기 오류") }
    var output = Data(count: size)
    var count = uLongf(size)
    let status = output.withUnsafeMutableBytes { out in
      bytes.withUnsafeBytes { input in
        uncompress(
          out.bindMemory(to: Bytef.self).baseAddress!, &count,
          input.bindMemory(to: Bytef.self).baseAddress!.advanced(by: 4), uLong(bytes.count - 4))
      }
    }
    guard status == Z_OK, count == size,
      let values = try JSONSerialization.jsonObject(with: output) as? [String: Any]
    else { throw NativeImageError.invalid("보정 기록 읽기 실패") }
    return try NativeSettings.validated(values)
  }
}

/// Fixed-size inverse map: drawing modifies coordinates, never a full-resolution pixel buffer.
struct NativeLiquify {
  static let size = 129
  var data: [Float]
  init(_ value: Any?) throws {
    data = [Float](repeating: 0, count: Self.size * Self.size * 2)
    guard let value, !(value is NSNull) else { return }
    guard let v = value as? [String: Any], v["width"] as? Int == Self.size,
      v["height"] as? Int == Self.size, let text = v["data"] as? String,
      text.count == ((data.count * 4 + 2) / 3) * 4,
      let bytes = Data(base64Encoded: text), bytes.count == data.count * 4
    else {
      throw NativeImageError.invalid("리퀴파이 데이터가 올바르지 않습니다.")
    }
    data = bytes.withUnsafeBytes { raw in
      (0..<data.count).map {
        Float(
          bitPattern: UInt32(
            littleEndian: raw.loadUnaligned(fromByteOffset: $0 * 4, as: UInt32.self)))
      }
    }
    guard data.allSatisfy({ $0.isFinite && abs($0) <= 1 }) else {
      throw NativeImageError.invalid("리퀴파이 변형 범위가 올바르지 않습니다.")
    }
  }
  var dictionary: [String: Any] {
    let bytes = data.withUnsafeBytes { Data($0) }
    return ["width": Self.size, "height": Self.size, "data": bytes.base64EncodedString()]
  }
  func sample(_ x: Double, _ y: Double) -> (Double, Double) {
    let n = Self.size - 1
    let gx = max(0, min(Double(n), x * Double(n)))
    let gy = max(0, min(Double(n), y * Double(n)))
    let ix = min(n - 1, Int(gx))
    let iy = min(n - 1, Int(gy))
    let tx = gx - Double(ix)
    let ty = gy - Double(iy)
    let p = (iy * Self.size + ix) * 2
    func at(_ c: Int) -> Double {
      Double(data[p + c]) * (1 - tx) * (1 - ty) + Double(data[p + 2 + c]) * tx * (1 - ty)
        + Double(data[p + Self.size * 2 + c]) * (1 - tx) * ty + Double(
          data[p + Self.size * 2 + 2 + c]) * tx * ty
    }
    return (at(0), at(1))
  }
  mutating func push(
    from: NativePoint, to: NativePoint, radius: Double, strength: Double, width: Double,
    height: Double
  ) {
    let rx = radius * min(width, height) / width
    let ry = radius * min(width, height) / height
    let steps = min(32, max(1, Int(ceil(hypot((to.x - from.x) / rx, (to.y - from.y) / ry) / 0.2))))
    let n = Self.size - 1
    for step in 1...steps {
      let cx = from.x + (to.x - from.x) * Double(step) / Double(steps)
      let cy = from.y + (to.y - from.y) * Double(step) / Double(steps)
      let dx = (to.x - from.x) * strength / Double(steps)
      let dy = (to.y - from.y) * strength / Double(steps)
      let old = self
      let x0 = max(0, Int(floor((cx - rx) * Double(n))))
      let x1 = min(n, Int(ceil((cx + rx) * Double(n))))
      let y0 = max(0, Int(floor((cy - ry) * Double(n))))
      let y1 = min(n, Int(ceil((cy + ry) * Double(n))))
      guard x0 <= x1 && y0 <= y1 else { continue }
      for y in y0...y1 {
        for x in x0...x1 {
          let px = Double(x) / Double(n)
          let py = Double(y) / Double(n)
          let distance = hypot((px - cx) / rx, (py - cy) / ry)
          if distance >= 1 { continue }
          let weight = pow(1 - distance * distance, 2)
          let qx = max(0, min(1, px - dx * weight))
          let qy = max(0, min(1, py - dy * weight))
          let offset = old.sample(qx, qy)
          let p = (y * Self.size + x) * 2
          data[p] = Float(max(0, min(1, qx + offset.0)) - px)
          data[p + 1] = Float(max(0, min(1, qy + offset.1)) - py)
        }
      }
    }
  }
}
