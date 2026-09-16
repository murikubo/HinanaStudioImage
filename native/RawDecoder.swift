import Foundation
import CoreImage
import ImageIO
import UniformTypeIdentifiers

func abortDecode(_ message: String) -> Never {
    FileHandle.standardError.write(Data(message.utf8))
    exit(1)
}
guard CommandLine.arguments.count == 3 else { abortDecode("RAW 디코더 인수가 올바르지 않습니다.") }
let sourceURL = URL(fileURLWithPath: CommandLine.arguments[1])
let destinationURL = URL(fileURLWithPath: CommandLine.arguments[2])
if #available(macOS 12.0, *) {
    autoreleasepool {
        guard let raw = CIRAWFilter(imageURL: sourceURL) else {
            abortDecode("이 카메라의 RAW 형식을 현재 macOS에서 지원하지 않습니다.")
        }
        let native = raw.nativeSize
        guard native.width > 0, native.height > 0, native.width * native.height <= 60_000_000 else {
            abortDecode("60MP 이하의 RAW 사진만 지원합니다.")
        }
        // Full sensor decode; never use embedded previewImage or a thumbnail fallback.
        raw.scaleFactor = 1.0
        raw.isDraftModeEnabled = false
        guard let image = raw.outputImage else { abortDecode("RAW 원본 데이터를 현상할 수 없습니다. 파일 또는 카메라 지원 여부를 확인해 주세요.") }
        let rect = image.extent.integral
        guard rect.width > 0, rect.height > 0, rect.width * rect.height <= 60_000_000 else { abortDecode("RAW 출력 크기가 허용 범위를 초과했습니다.") }
        let colorSpace = CGColorSpace(name: CGColorSpace.displayP3)!
        let context = CIContext(options: [.cacheIntermediates: false])
        guard let rendered = context.createCGImage(image, from: rect, format: .RGBA8, colorSpace: colorSpace) else { abortDecode("RAW 이미지 렌더링에 실패했습니다.") }
        var properties: [String: Any] = [:]
        if let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil), let original = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any] {
            for key in [kCGImagePropertyExifDictionary, kCGImagePropertyTIFFDictionary, kCGImagePropertyGPSDictionary] {
                if let item = original[key as String] { properties[key as String] = item }
            }
        }
        properties[kCGImagePropertyOrientation as String] = 1
        var exif = properties[kCGImagePropertyExifDictionary as String] as? [String: Any] ?? [:]
        exif[kCGImagePropertyExifPixelXDimension as String] = rendered.width
        exif[kCGImagePropertyExifPixelYDimension as String] = rendered.height
        exif[kCGImagePropertyExifColorSpace as String] = 65535
        properties[kCGImagePropertyExifDictionary as String] = exif
        var tiff = properties[kCGImagePropertyTIFFDictionary as String] as? [String: Any] ?? [:]
        tiff[kCGImagePropertyTIFFOrientation as String] = 1
        properties[kCGImagePropertyTIFFDictionary as String] = tiff
        guard let destination = CGImageDestinationCreateWithURL(destinationURL as CFURL, UTType.png.identifier as CFString, 1, nil) else { abortDecode("RAW 작업 이미지를 생성할 수 없습니다.") }
        CGImageDestinationAddImage(destination, rendered, properties as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { abortDecode("RAW 작업 이미지 저장에 실패했습니다.") }
        print("\(rendered.width)x\(rendered.height)")
    }
} else { abortDecode("RAW 현상은 macOS 12 이상에서 지원됩니다.") }
