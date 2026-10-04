import Foundation
import CoreImage
import ImageIO
import UniformTypeIdentifiers

struct NativeDecodedImage {
    let png: Data
    let hdr: Bool
    let peak: Float
}
enum NativeImageError: LocalizedError {
    case invalid(String)
    var errorDescription: String? { if case .invalid(let message) = self { return message }; return nil }
}
/** The same linear, full-resolution working image is used for import, projects and export. */
@available(iOS 15.0, macOS 12.0, *)
enum NativeImageDecoder {
    static func decode(_ data: Data, raw: Bool) throws -> NativeDecodedImage {
        guard !data.isEmpty, data.count <= (raw ? 120 : 80) * 1024 * 1024,
              let source = CGImageSourceCreateWithData(data as CFData, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any],
              let width = properties[kCGImagePropertyPixelWidth as String] as? Int,
              let height = properties[kCGImagePropertyPixelHeight as String] as? Int,
              width > 0, height > 0, Double(width) * Double(height) <= 32_000_000 else {
            throw NativeImageError.invalid("HEIC/HDR/RAW는 32MP 이하, 이미지 80MB / RAW 120MB 이하를 지원합니다.")
        }
        var gainMap = CGImageSourceCopyAuxiliaryDataInfoAtIndex(source, 0, kCGImageAuxiliaryDataTypeHDRGainMap) != nil
        if #available(iOS 18.0, macOS 15.0, *) {
            gainMap = gainMap || CGImageSourceCopyAuxiliaryDataInfoAtIndex(source, 0, kCGImageAuxiliaryDataTypeISOGainMap) != nil
        }
        let image: CIImage
        if raw {
            guard let filter = CIRAWFilter(imageData: data, identifierHint: nil) else {
                throw NativeImageError.invalid("현재 iOS에서 지원하지 않는 카메라 RAW입니다.")
            }
            filter.scaleFactor = 1
            filter.isDraftModeEnabled = false
            filter.extendedDynamicRangeAmount = 1
            guard let output = filter.outputImage else { throw NativeImageError.invalid("RAW 원본 현상에 실패했습니다.") }
            image = output
        } else {
            var options: [CIImageOption: Any] = [.applyOrientationProperty: true]
            if #available(iOS 17.0, macOS 14.0, *) {
                options[.expandToHDR] = true
            } else if gainMap {
                throw NativeImageError.invalid("Apple HDR 게인맵을 불러오려면 iOS 17 이상이 필요합니다.")
            }
            guard let output = CIImage(data: data, options: options) else { throw NativeImageError.invalid("이미지를 해독하지 못했습니다.") }
            image = output
        }
        let extent = image.extent.integral
        guard extent.width > 0, extent.height > 0, extent.width * extent.height <= 32_000_000 else {
            throw NativeImageError.invalid("고정밀 이미지의 크기가 허용 범위를 초과했습니다.")
        }
        let linearP3 = CGColorSpace(name: CGColorSpace.extendedLinearDisplayP3)!
        let context = CIContext(options: [.cacheIntermediates: false, .workingColorSpace: linearP3, .workingFormat: CIFormat.RGBAf])
        let maximum = image.applyingFilter("CIAreaMaximum", parameters: [kCIInputExtentKey: CIVector(cgRect: extent)])
        var sample = [Float](repeating: 0, count: 4)
        sample.withUnsafeMutableBytes { bytes in
            context.render(maximum, toBitmap: bytes.baseAddress!, rowBytes: 16, bounds: CGRect(x: 0, y: 0, width: 1, height: 1), format: .RGBAf, colorSpace: linearP3)
        }
        let peak = max(1, sample[0], sample[1], sample[2])
        let hdr = gainMap || peak > 1.01 || (image.colorSpace.map { CGColorSpaceUsesITUR_2100TF($0) } ?? false)
        let outputSpace = CGColorSpace(name: hdr ? CGColorSpace.itur_2100_PQ : CGColorSpace.displayP3)!
        guard let rendered = context.createCGImage(image, from: extent, format: .RGBA16, colorSpace: outputSpace) else {
            throw NativeImageError.invalid("고정밀 이미지 렌더링에 실패했습니다.")
        }
        var metadata: [String: Any] = [:]
        for key in [kCGImagePropertyExifDictionary, kCGImagePropertyTIFFDictionary, kCGImagePropertyGPSDictionary] {
            if let value = properties[key as String] { metadata[key as String] = value }
        }
        metadata[kCGImagePropertyOrientation as String] = 1
        var exif = metadata[kCGImagePropertyExifDictionary as String] as? [String: Any] ?? [:]
        exif[kCGImagePropertyExifPixelXDimension as String] = rendered.width
        exif[kCGImagePropertyExifPixelYDimension as String] = rendered.height
        exif[kCGImagePropertyExifColorSpace as String] = 65535
        metadata[kCGImagePropertyExifDictionary as String] = exif
        var tiff = metadata[kCGImagePropertyTIFFDictionary as String] as? [String: Any] ?? [:]
        tiff[kCGImagePropertyTIFFOrientation as String] = 1
        metadata[kCGImagePropertyTIFFDictionary as String] = tiff
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(output, UTType.png.identifier as CFString, 1, nil) else {
            throw NativeImageError.invalid("작업 PNG 생성에 실패했습니다.")
        }
        CGImageDestinationAddImage(destination, rendered, metadata as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw NativeImageError.invalid("작업 PNG 저장에 실패했습니다.") }
        return NativeDecodedImage(png: output as Data, hdr: hdr, peak: peak)
    }
}
