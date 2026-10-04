import Foundation
import CoreImage
import ImageIO
import UniformTypeIdentifiers
import Vision
@main struct NativeCheck {
 static func main() throws {
  let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
  try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
  let ctx = CIContext(options: [.workingColorSpace: CGColorSpace(name: CGColorSpace.extendedLinearDisplayP3)!])
  let pixels: [Float] = (0..<(512 * 384)).flatMap { i in i % 512 < 256 ? [Float(4), 4, 4, 1] : [Float(0.1), 0.1, 0.1, 1] }
  let hdr = pixels.withUnsafeBytes { CIImage(bitmapData: Data($0), bytesPerRow: 512 * 16, size: CGSize(width: 512, height: 384), format: .RGBAf, colorSpace: CGColorSpace(name: CGColorSpace.extendedLinearDisplayP3)!) }
  let hdrURL = root.appendingPathComponent("pq.heic")
  try ctx.writeHEIF10Representation(of: hdr, to: hdrURL, colorSpace: CGColorSpace(name: CGColorSpace.itur_2100_PQ)!, options: [:])
  let decoded = try NativeImageDecoder.decode(Data(contentsOf: hdrURL), raw: false)
  try decoded.png.write(to: root.appendingPathComponent("pq.png"))
  try decoded.preview.write(to: root.appendingPathComponent("preview.jpg"))
  let previewSource = CGImageSourceCreateWithData(decoded.preview as CFData, nil)!
  let previewImage = CGImageSourceCreateImageAtIndex(previewSource, 0, nil)!
  precondition(previewImage.width == 512 && previewImage.height == 384)
  precondition(decoded.hdr && decoded.peak > 3.8, "PQ highlights were clipped")
  print("PQ native", decoded.hdr, decoded.peak)
  let image = ctx.createCGImage(hdr.applyingFilter("CIExposureAdjust", parameters: [kCIInputEVKey: -2]), from: hdr.extent, format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.displayP3)!)!
  let sdr = NSMutableData()
  let destination = CGImageDestinationCreateWithData(sdr, UTType.heic.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(destination, image, [
    kCGImagePropertyOrientation: 6,
    kCGImagePropertyTIFFDictionary: [kCGImagePropertyTIFFModel: "Hinana Native Test"],
    kCGImagePropertyExifDictionary: [kCGImagePropertyExifFNumber: 1.8],
    kCGImagePropertyGPSDictionary: [kCGImagePropertyGPSLatitude: 37.5, kCGImagePropertyGPSLatitudeRef: "N"]
  ] as CFDictionary)
  precondition(CGImageDestinationFinalize(destination))
  let upright = try NativeImageDecoder.decode(sdr as Data, raw: false)
  precondition(!upright.hdr)
  try upright.png.write(to: root.appendingPathComponent("sdr.png"))
  let properties = CGImageSourceCopyPropertiesAtIndex(CGImageSourceCreateWithData(upright.png as CFData, nil)!, 0, nil)! as NSDictionary
  precondition(properties[kCGImagePropertyPixelWidth] as? Int == 384)
  precondition(properties[kCGImagePropertyPixelHeight] as? Int == 512)
  precondition((properties[kCGImagePropertyTIFFDictionary] as? NSDictionary)?[kCGImagePropertyTIFFModel] as? String == "Hinana Native Test")
  precondition((properties[kCGImagePropertyGPSDictionary] as? NSDictionary)?[kCGImagePropertyGPSLatitude] as? Double == 37.5)
  do { _ = try NativeImageDecoder.decode(Data([1, 2, 3]), raw: true); preconditionFailure("Invalid RAW must fail") } catch { }
  print("SDR HEIC orientation, EXIF/GPS and corrupt RAW rejection passed")
  if #available(macOS 15.0, *) {
    let sdr = hdr.applyingFilter("CIExposureAdjust", parameters: [kCIInputEVKey: -2])
    let gainURL = root.appendingPathComponent("gain.heic")
    try ctx.writeHEIFRepresentation(of: sdr, to: gainURL, format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.displayP3)!, options: [.hdrImage: CIImage(cgImage: ctx.createCGImage(hdr, from: hdr.extent, format: .RGBAh, colorSpace: CGColorSpace(name: CGColorSpace.extendedLinearDisplayP3)!)!, options: [.contentHeadroom: 4])])
    let image = try NativeImageDecoder.decode(Data(contentsOf: gainURL), raw: false)
    try image.png.write(to: root.appendingPathComponent("gain.png"))
    precondition(image.hdr && image.peak > 3.8, "Gain map highlights were lost")
    print("GAIN native", image.hdr, image.peak)
  }
  let icon = CGImageSourceCreateWithURL(URL(fileURLWithPath: CommandLine.arguments[2]) as CFURL, nil)!
  let original = CGImageSourceCreateImageAtIndex(icon, 0, nil)!
  let ci = CIImage(cgImage: original).applyingFilter("CILanczosScaleTransform", parameters: [kCIInputScaleKey: 1024.0 / Double(max(original.width, original.height))])
  let picture = ctx.createCGImage(ci, from: ci.extent, format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)!
  let point = NativeMaskPoint(x: 0.5, y: 0.3, exclude: false)
  let selected = try NativeSubjectSelector.select(image: picture, points: [point], request: VNGenerateForegroundInstanceMaskRequest())
  precondition(selected.data.count == selected.width * selected.height && selected.data.filter { $0 > 128 }.count > 1000)
  let excluded = try NativeSubjectSelector.select(image: picture, points: [point, NativeMaskPoint(x: point.x, y: point.y, exclude: true)], request: VNGenerateForegroundInstanceMaskRequest())
  precondition(excluded.data.allSatisfy { $0 == 0 }, "Removing every instance must yield an empty mask")
  do { _ = try NativeSubjectSelector.select(image: picture, points: [NativeMaskPoint(x: 0, y: 0, exclude: false)], request: VNGenerateForegroundInstanceMaskRequest()); preconditionFailure("Background taps must fail") } catch { }
  print("Vision foreground selection, exclusions and background rejection passed")
 }
}
