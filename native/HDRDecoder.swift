import Foundation
import ImageIO

@main struct HDRDecoder {
    static func main() {
        guard CommandLine.arguments.count == 4 else { exit(1) }
        do {
            let input = URL(fileURLWithPath: CommandLine.arguments[1])
            let data = try Data(contentsOf: input)
            guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { throw NativeImageError.invalid("사진을 읽지 못했습니다.") }
            var hdr = CGImageSourceCopyAuxiliaryDataInfoAtIndex(source, 0, kCGImageAuxiliaryDataTypeHDRGainMap) != nil
            if #available(macOS 15, *) { hdr = hdr || CGImageSourceCopyAuxiliaryDataInfoAtIndex(source, 0, kCGImageAuxiliaryDataTypeISOGainMap) != nil }
            guard hdr else { print("{\"hdr\":false}"); return }
            guard #available(macOS 14, *) else { throw NativeImageError.invalid("HDR 게인맵은 macOS 14 이상에서 지원합니다.") }
            let result = try NativeImageDecoder.decode(data, raw: false)
            try result.png.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
            try result.preview.write(to: URL(fileURLWithPath: CommandLine.arguments[3]))
            let info: [String: Any] = ["hdr":result.hdr,"peak":result.peak]
            let json = try JSONSerialization.data(withJSONObject: info)
            print(String(data: json, encoding: .utf8)!)
        } catch {
            FileHandle.standardError.write(Data(error.localizedDescription.utf8))
            exit(1)
        }
    }
}
