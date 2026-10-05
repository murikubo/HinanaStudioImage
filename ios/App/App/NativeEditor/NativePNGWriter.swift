import CoreImage
import Foundation
import ImageIO
import UniformTypeIdentifiers
import zlib

/// PNG output uses a fixed number of rows, rather than a full-resolution pixel allocation.
final class NativePNGWriter {
  private let handle: FileHandle
  private var stream = z_stream()
  private var finished = false
  private let compressedSize = 65_536

  init(url: URL, width: Int, height: Int, depth: Int, profile: Data?, hdr: Bool, exif: Data?) throws
  {
    FileManager.default.createFile(atPath: url.path, contents: nil)
    handle = try FileHandle(forWritingTo: url)
    guard deflateInit_(&stream, 6, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size)) == Z_OK else {
      throw NativeImageError.invalid("PNG 압축기를 시작하지 못했습니다.")
    }
    try handle.write(contentsOf: Data([137, 80, 78, 71, 13, 10, 26, 10]))
    var header = Data()
    header.appendInteger(UInt32(width))
    header.appendInteger(UInt32(height))
    header.append(contentsOf: [UInt8(depth), 6, 0, 0, 0])
    try chunk("IHDR", header)
    if let profile {
      var capacity = compressBound(uLong(profile.count))
      var bytes = Data(count: Int(capacity))
      let status = bytes.withUnsafeMutableBytes { output in
        profile.withUnsafeBytes { input in
          compress2(
            output.bindMemory(to: Bytef.self).baseAddress!, &capacity,
            input.bindMemory(to: Bytef.self).baseAddress!, uLong(profile.count), 6)
        }
      }
      guard status == Z_OK else { throw NativeImageError.invalid("색상 프로필 압축 실패") }
      bytes.count = Int(capacity)
      try chunk("iCCP", Data("Hinana\0\0".utf8) + bytes)
    }
    if hdr { try chunk("cICP", Data([9, 16, 0, 1])) }
    if let exif { try chunk("eXIf", exif) }
  }
  deinit {
    deflateEnd(&stream)
    try? handle.close()
  }
  private func chunk(_ name: String, _ bytes: Data) throws {
    let type = Data(name.utf8)
    var count = Data()
    count.appendInteger(UInt32(bytes.count))
    var checksum = crc32(0, nil, 0)
    checksum = type.withUnsafeBytes {
      crc32(checksum, $0.bindMemory(to: Bytef.self).baseAddress!, uInt(type.count))
    }
    checksum = bytes.withUnsafeBytes {
      crc32(checksum, $0.bindMemory(to: Bytef.self).baseAddress, uInt(bytes.count))
    }
    var crc = Data()
    crc.appendInteger(UInt32(checksum))
    try handle.write(contentsOf: count)
    try handle.write(contentsOf: type)
    try handle.write(contentsOf: bytes)
    try handle.write(contentsOf: crc)
  }
  private func compress(_ input: Data, finish: Bool) throws {
    try input.withUnsafeBytes { source in
      stream.next_in = UnsafeMutablePointer(mutating: source.bindMemory(to: Bytef.self).baseAddress)
      stream.avail_in = uInt(input.count)
      repeat {
        var bytes = Data(count: compressedSize)
        let status = bytes.withUnsafeMutableBytes { output -> Int32 in
          stream.next_out = output.bindMemory(to: Bytef.self).baseAddress
          stream.avail_out = uInt(compressedSize)
          return deflate(&stream, finish ? Z_FINISH : Z_NO_FLUSH)
        }
        guard status == Z_OK || status == Z_STREAM_END else {
          throw NativeImageError.invalid("PNG 압축 실패")
        }
        bytes.count = compressedSize - Int(stream.avail_out)
        if !bytes.isEmpty { try chunk("IDAT", bytes) }
        if status == Z_STREAM_END { break }
      } while stream.avail_in > 0 || (finish && stream.avail_out == 0)
      stream.next_in = nil
      stream.next_out = nil
    }
  }
  func row(_ bytes: Data) throws { try compress(Data([0]) + bytes, finish: false) }
  func finish() throws {
    guard !finished else { return }
    try compress(Data(), finish: true)
    try chunk("IEND", Data())
    try handle.synchronize()
    try handle.close()
    finished = true
  }
  private static func normalizedExif(_ input: Data, properties: [String: Any]) -> Data {
    var data = input
    guard data.count >= 8 else { return data }
    let little = data[0] == 73
    func read(_ offset: Int, _ count: Int) -> Int {
      guard offset >= 0, offset + count <= data.count else { return 0 }
      var value = 0
      for i in 0..<count { value |= Int(data[offset + i]) << (8 * (little ? i : count - 1 - i)) }
      return value
    }
    func write(_ value: Int, _ offset: Int, _ count: Int) {
      for i in 0..<count {
        data[offset + i] = UInt8((value >> (8 * (little ? i : count - 1 - i))) & 255)
      }
    }
    let exif = properties[kCGImagePropertyExifDictionary as String] as? [String: Any] ?? [:]
    let width = (exif[kCGImagePropertyExifPixelXDimension as String] as? NSNumber)?.intValue
    let height = (exif[kCGImagePropertyExifPixelYDimension as String] as? NSNumber)?.intValue
    var visited = Set<Int>()
    func patch(_ start: Int) {
      guard start > 0, start + 2 <= data.count, visited.count < 8, visited.insert(start).inserted
      else { return }
      let count = read(start, 2)
      guard count <= 1024, start + 2 + count * 12 <= data.count else { return }
      for i in 0..<count {
        let at = start + 2 + i * 12
        let tag = read(at, 2)
        let type = read(at + 2, 2)
        let n = read(at + 4, 4)
        if tag == 34665 || tag == 34853 { patch(read(at + 8, 4)) }
        if n == 1, type == 3 || type == 4,
          let value =
            (tag == 274
              ? 1
              : (tag == 256 || tag == 40962) ? width : (tag == 257 || tag == 40963) ? height : nil)
        {
          write(value, at + 8, type == 3 ? 2 : 4)
        }
      }
    }
    patch(read(4, 4))
    return data
  }
  static func exif(_ properties: [String: Any]) -> Data? {
    // ImageIO serializes its complete EXIF/TIFF/GPS dictionaries into a small JPEG's APP1.
    let pixel = CIImage(color: .black).cropped(to: CGRect(x: 0, y: 0, width: 1, height: 1))
    guard let image = NativeRenderEngine.shared.srgb.createCGImage(pixel, from: pixel.extent) else {
      return nil
    }
    let data = NSMutableData()
    guard
      let destination = CGImageDestinationCreateWithData(
        data, UTType.jpeg.identifier as CFString, 1, nil)
    else { return nil }
    CGImageDestinationAddImage(destination, image, properties as CFDictionary)
    guard CGImageDestinationFinalize(destination) else { return nil }
    let bytes = data as Data
    var index = 2
    while index + 4 <= bytes.count {
      guard bytes[index] == 255 else { break }
      let marker = bytes[index + 1]
      if marker == 0xDA || marker == 0xD9 { break }
      let length = Int(bytes[index + 2]) * 256 + Int(bytes[index + 3])
      guard length >= 2, index + 2 + length <= bytes.count else { break }
      if marker == 0xE1, length >= 8,
        bytes.subdata(in: index + 4..<index + 10) == Data("Exif\0\0".utf8)
      {
        return normalizedExif(
          bytes.subdata(in: index + 10..<index + 2 + length), properties: properties)
      }
      index += 2 + length
    }
    return nil
  }
}
extension Data {
  fileprivate mutating func appendInteger(_ value: UInt32) {
    var big = value.bigEndian
    Swift.withUnsafeBytes(of: &big) { append(contentsOf: $0) }
  }
}
