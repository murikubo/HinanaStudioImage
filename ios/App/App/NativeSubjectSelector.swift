import Foundation
import Vision
import ImageIO

struct NativeMaskPoint { let x: Double; let y: Double; let exclude: Bool }
struct NativeMaskResult { let width: Int; let height: Int; let data: Data }
@available(iOS 17.0, macOS 14.0, *)
enum NativeSubjectSelector {
    static func select(image: CGImage, points: [NativeMaskPoint], request: VNGenerateForegroundInstanceMaskRequest) throws -> NativeMaskResult {
                let handler = VNImageRequestHandler(cgImage: image, orientation: .up)
                try handler.perform([request])
                guard let observation = request.results?.first else { throw NativeImageError.invalid("피사체를 찾지 못했습니다.") }
                let labels = observation.instanceMask
                CVPixelBufferLockBaseAddress(labels, .readOnly)
                var instances = IndexSet()
                var foregroundFound = false
                let width = CVPixelBufferGetWidth(labels), height = CVPixelBufferGetHeight(labels), row = CVPixelBufferGetBytesPerRow(labels)
                guard CVPixelBufferGetPixelFormatType(labels) == kCVPixelFormatType_OneComponent8, let address = CVPixelBufferGetBaseAddress(labels) else {
                    CVPixelBufferUnlockBaseAddress(labels, .readOnly)
                    throw NativeImageError.invalid("지원하지 않는 피사체 마스크 형식입니다.")
                }
                for point in points {
                    let x = min(width - 1, Int((point.x) * Double(width)))
                    let y = min(height - 1, Int((point.y) * Double(height)))
                    let instance = Int(address.load(fromByteOffset: y * row + x, as: UInt8.self))
                    if instance == 0 { continue }
                    if point.exclude { instances.remove(instance) } else { instances.insert(instance); foregroundFound = true }
                }
                CVPixelBufferUnlockBaseAddress(labels, .readOnly)
                guard foregroundFound else { throw NativeImageError.invalid("선택점에서 피사체를 찾지 못했습니다. 인물이나 물건 위에 선택점을 놓아 주세요.") }
                var coverage = Data(count: image.width * image.height)
                if !instances.isEmpty {
                    let mask = try observation.generateScaledMaskForImage(forInstances: instances, from: handler)
                    CVPixelBufferLockBaseAddress(mask, .readOnly)
                    defer { CVPixelBufferUnlockBaseAddress(mask, .readOnly) }
                    guard let pixels = CVPixelBufferGetBaseAddress(mask), CVPixelBufferGetWidth(mask) == image.width, CVPixelBufferGetHeight(mask) == image.height else { throw NativeImageError.invalid("피사체 마스크 크기가 올바르지 않습니다.") }
                    let stride = CVPixelBufferGetBytesPerRow(mask), format = CVPixelBufferGetPixelFormatType(mask)
                    guard format == kCVPixelFormatType_OneComponent32Float || format == kCVPixelFormatType_OneComponent8 else { throw NativeImageError.invalid("지원하지 않는 피사체 마스크 형식입니다.") }
                    coverage.withUnsafeMutableBytes { output in
                        let bytes = output.bindMemory(to: UInt8.self)
                        for y in 0..<image.height { for x in 0..<image.width {
                            let value: UInt8 = format == kCVPixelFormatType_OneComponent32Float ? UInt8(max(0, min(1, pixels.load(fromByteOffset: y * stride + x * 4, as: Float.self))) * 255) : pixels.load(fromByteOffset: y * stride + x, as: UInt8.self)
                            bytes[y * image.width + x] = value
                        } }
                    }
                }
        return NativeMaskResult(width: image.width, height: image.height, data: coverage)
    }
}
