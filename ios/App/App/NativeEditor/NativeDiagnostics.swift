#if DEBUG
  import Foundation
  import CoreImage
  import ImageIO

  enum NativeDiagnostics {
    static func run() {
      guard ProcessInfo.processInfo.arguments.contains("--native-self-test") else { return }
      NativeLibrary.shared.work.async {
        var report: [[String: Any]] = []
        do {
          let engine = NativeRenderEngine.shared
          let url = Bundle.main.url(forResource: "editor-reference", withExtension: "json")!
          let cases =
            try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [[String: Any]]
          for item in cases {
            var input = (item["input"] as! [Double]).map { Float($0) }
            let width = item["width"] as? Int ?? 1
            let height = item["height"] as? Int ?? 1
            let outputWidth = item["outputWidth"] as? Int ?? width
            let outputHeight = item["outputHeight"] as? Int ?? height
            let data = input.withUnsafeMutableBytes { Data($0) }
            let source = CIImage(
              bitmapData: data, bytesPerRow: width * 16, size: CGSize(width: width, height: height),
              format: .RGBAf,
              colorSpace: CGColorSpace(name: CGColorSpace.extendedLinearDisplayP3)!)
            let a = NativeSettings(item["adjustments"] as! [String: Any])
            let image = try engine.render(source, a)
            let cs = CGColorSpace(
              name: a.string("colorSpace") == "display-p3"
                ? CGColorSpace.extendedLinearDisplayP3 : CGColorSpace.extendedLinearSRGB)!
            var output = [Float](repeating: 0, count: outputWidth * outputHeight * 4)
            output.withUnsafeMutableBytes {
              engine.context(a).render(
                image, toBitmap: $0.baseAddress!, rowBytes: outputWidth * 16,
                bounds: CGRect(x: 0, y: 0, width: outputWidth, height: outputHeight),
                format: .RGBAf, colorSpace: cs)
            }
            let expected = item["expected"] as! [Double]
            let error = zip(output, expected).map { abs(Double($0.0) - $0.1) }.max()!
            report.append([
              "name": item["name"]!, "actual": output.map { Double($0) }, "expected": expected,
              "error": error, "pass": error < 0.006,
            ])
          }
          let pattern = CIImage(color: CIColor(red: 1, green: 0, blue: 0)).cropped(
            to: CGRect(x: 0, y: 1, width: 2, height: 1)
          ).composited(
            over: CIImage(color: CIColor(red: 0, green: 0, blue: 1)).cropped(
              to: CGRect(x: 0, y: 0, width: 2, height: 2)))
          let patternData = try engine.png(
            pattern, space: "srgb", depth: 16,
            properties: [
              kCGImagePropertyTIFFDictionary as String: [
                kCGImagePropertyTIFFMake as String: "Native fixture"
              ]
            ])
          let patternSource = CGImageSourceCreateWithData(patternData as CFData, nil)!
          let props = CGImageSourceCopyPropertiesAtIndex(patternSource, 0, nil) as! [String: Any]
          let decoded = CIImage(data: patternData)!
          var color = [Float](repeating: 0, count: 4)
          color.withUnsafeMutableBytes {
            engine.p3.render(
              decoded, toBitmap: $0.baseAddress!, rowBytes: 16,
              bounds: CGRect(x: 0, y: 1, width: 1, height: 1), format: .RGBAf,
              colorSpace: CGColorSpace(name: CGColorSpace.extendedLinearSRGB)!)
          }
          report.append([
            "name": "png-orientation-exif", "actual": color.map { Double($0) }, "properties": props,
            "pass": color[0] > 0.99 && color[2] < 0.01
              && (props[kCGImagePropertyTIFFDictionary as String] as? [String: Any])?[
                kCGImagePropertyTIFFMake as String] as? String == "Native fixture"
              ,
          ])
          let alphaImage = CIImage(color: CIColor(red: 1, green: 0, blue: 0, alpha: 0.5)).cropped(
            to: CGRect(x: 0, y: 0, width: 1, height: 1))
          let alphaPNG = try engine.png(alphaImage, space: "srgb", depth: 16, properties: [:])
          var alphaColor = [Float](repeating: 0, count: 4)
          alphaColor.withUnsafeMutableBytes {
            engine.p3.render(
              CIImage(data: alphaPNG)!, toBitmap: $0.baseAddress!, rowBytes: 16,
              bounds: alphaImage.extent, format: .RGBAf,
              colorSpace: CGColorSpace(name: CGColorSpace.extendedLinearSRGB)!)
          }
          report.append([
            "name": "png-alpha", "actual": alphaColor.map { Double($0) },
            "pass": abs(alphaColor[0] - 0.5) < 0.003 && abs(alphaColor[3] - 0.5) < 0.003,
          ])
          var hdrInput: [Float] = [4, 0.4, 0.2, 1]
          let hdrData = hdrInput.withUnsafeMutableBytes { Data($0) }
          let hdrImage = CIImage(
            bitmapData: hdrData, bytesPerRow: 16, size: CGSize(width: 1, height: 1), format: .RGBAf,
            colorSpace: CGColorSpace(name: CGColorSpace.extendedLinearDisplayP3)!)
          let hdrSettings = NativeSettings([
            "colorSpace": "display-p3", "precision": "float", "dynamicRange": "hdr",
            "hdrPeak": 2000,
          ])
          let hdrPNG = try engine.png(
            hdrImage, space: "hdr", depth: 16, properties: [:], settings: hdrSettings)
          var hdrOptions: [CIImageOption: Any] = [:]
          if #available(iOS 17.0, *) { hdrOptions[.expandToHDR] = true }
          let hdrFixture = FileManager.default.temporaryDirectory.appendingPathComponent(
            "native-hdr-fixture.png")
          try hdrPNG.write(to: hdrFixture)
          let automatic = try engine.source(hdrFixture)
          report.append(["name": "hdr-auto-import", "pass": automatic.hdr])
          let hdrDecoded = automatic.image
          var hdrPixel = [Float](repeating: 0, count: 4)
          hdrPixel.withUnsafeMutableBytes {
            engine.p3.render(
              hdrDecoded, toBitmap: $0.baseAddress!, rowBytes: 16, bounds: hdrImage.extent,
              format: .RGBAf, colorSpace: CGColorSpace(name: CGColorSpace.extendedLinearDisplayP3)!)
          }
          report.append([
            "name": "hdr-pq-roundtrip", "actual": hdrPixel.map { Double($0) },
            "pass": zip(hdrInput, hdrPixel).allSatisfy { abs($0 - $1) < 0.03 },
          ])
          let root = FileManager.default.temporaryDirectory.appendingPathComponent(
            "NativeEditorChecks")
          let library = NativeLibrary(root: root)
          let source = CIImage(color: CIColor(red: 0.4, green: 0.2, blue: 0.1)).cropped(
            to: CGRect(x: 0, y: 0, width: 640, height: 480))
          let png = try engine.png(source, space: "display-p3", depth: 16, properties: [:])
          let file = root.appendingPathComponent("fixture.png")
          try png.write(to: file)
          let photo = try library.copyPhoto(file)
          photo.checkpoint()
          photo.settings["exposure"] = 0.7
          photo.checkpoint()
          let archived = try photo.history.map { try NativeUndoArchive.encode($0.values) }
          let restored = try archived.map { try NativeUndoArchive.decode($0) }
          report.append([
            "name": "undo-archive",
            "pass": restored.count == 2 && restored[0]["exposure"] == 0
              && restored[1]["exposure"] == 0.7,
          ])
          library.photos = [photo]
          library.selected = photo.id
          library.persist()
          library.flushSaves()
          let restoredLibrary = NativeLibrary(root: root)
          report.append([
            "name": "undo-workspace-restore",
            "pass": restoredLibrary.current?.history.count == 2
              && restoredLibrary.current?.cursor == 1
              && restoredLibrary.current?.history[0]["exposure"] == 0,
          ])
          let project = try library.writeProject()
          let json =
            try JSONSerialization.jsonObject(with: Data(contentsOf: project)) as! [String: Any]
          let records = json["photos"] as! [[String: Any]]
          let record = records[0]
          report.append([
            "name": "project",
            "pass": json["version"] as? Int == 5 && record["src"] as? String != nil
              && (record["adjustments"] as? [String: Any])?["exposure"] as? Double == 0.7,
          ])
          for format in ["jpeg", "png", "png16", "hdr-png", "webp"] {
            let export = try engine.export(
              photo, url: library.url(photo), format: format, space: "display-p3",
              maxSide: .infinity, quality: 0.9, preserve: true)
            let imageSource = CGImageSourceCreateWithURL(export as CFURL, nil)!
            let properties =
              CGImageSourceCopyPropertiesAtIndex(imageSource, 0, nil) as! [String: Any]
            let depth = properties[kCGImagePropertyDepth as String] as? Int ?? 0
            let outputExif =
              properties[kCGImagePropertyExifDictionary as String] as? [String: Any] ?? [:]
            report.append([
              "name": format + "-exif-dimensions",
              "pass": (outputExif[kCGImagePropertyExifPixelXDimension as String] as? NSNumber)?
                .intValue == 640
                && (outputExif[kCGImagePropertyExifPixelYDimension as String] as? NSNumber)?
                  .intValue == 480
                ,
            ])
            report.append([
              "name": format, "depth": depth,
              "pass": depth == (format == "png16" || format == "hdr-png" ? 16 : 8),
            ])
          }
        } catch {
          report.append(["name": "exception", "error": error.localizedDescription, "pass": false])
        }
        let target = NativeLibrary.shared.root.appendingPathComponent("native-diagnostics.json")
        try? JSONSerialization.data(withJSONObject: report, options: .prettyPrinted).write(
          to: target, options: .atomic)
        NSLog(
          "NATIVE_EDITOR_DIAGNOSTICS %@",
          report.allSatisfy { $0["pass"] as? Bool == true } ? "PASS" : "FAIL")
      }
    }
  }
#endif
