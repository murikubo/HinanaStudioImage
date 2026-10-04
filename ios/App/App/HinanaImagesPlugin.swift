import Foundation
import Capacitor
import PhotosUI
import UniformTypeIdentifiers
import Vision
import ImageIO

@objc(HinanaImagesPlugin)
class HinanaImagesPlugin: CAPPlugin, CAPBridgedPlugin, PHPickerViewControllerDelegate, UIDocumentPickerDelegate {
    let identifier = "HinanaImagesPlugin"
    let jsName = "HinanaImages"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "showHDRPreview", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "capabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "decodeImage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickImages", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "releaseImports", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "selectSubject", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelSubject", returnType: CAPPluginReturnPromise)
    ]
    private let work = DispatchQueue(label: "studio.hinana.image.processing", qos: .userInitiated)
    private let lock = NSLock()
    private var requests: [String: VNRequest] = [:]
    private var pickerCall: CAPPluginCall?
    private var importRoot: URL { FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("HinanaImports", isDirectory: true) }

    @objc func capabilities(_ call: CAPPluginCall) {
        var modern = false
        if #available(iOS 17.0, *) { modern = true }
        call.resolve(["heic": true, "raw": true, "subject": modern, "appleHDR": modern])
    }
    @objc func showHDRPreview(_ call: CAPPluginCall) {
        guard #available(iOS 17.0, *) else { call.reject("HDR 화면 보기는 iOS 17 이상에서 지원합니다."); return }
        guard let encoded = call.getString("png"), encoded.utf8.count <= 48_000_000,
              let data = Data(base64Encoded: encoded), let image = UIImage(data: data) else { call.reject("HDR 미리보기 이미지를 읽지 못했습니다."); return }
        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController, presenter.presentedViewController == nil else { call.reject("다른 창을 먼저 닫아 주세요."); return }
            let controller = HinanaHDRPreviewController(image: image)
            controller.modalPresentationStyle = .fullScreen
            presenter.present(controller, animated: true) { call.resolve() }
        }
    }
    @objc func decodeImage(_ call: CAPPluginCall) {
        guard let base64 = call.getString("base64"), base64.utf8.count <= 168_000_000,
              let data = Data(base64Encoded: base64) else { call.reject("원본 이미지 데이터가 올바르지 않습니다."); return }
        let raw = call.getBool("raw") ?? false
        work.async {
            autoreleasepool {
                do {
                    let result = try NativeImageDecoder.decode(data, raw: raw)
                    call.resolve(["png": result.png.base64EncodedString(), "preview": result.preview.base64EncodedString(), "hdr": result.hdr, "peak": Double(result.peak)])
                } catch { call.reject(error.localizedDescription) }
            }
        }
    }
    @objc func pickImages(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.pickerCall == nil, let viewController = self.bridge?.viewController else { call.reject("사진 선택 창이 이미 열려 있습니다."); return }
            self.pickerCall = call
            if call.getString("source") == "files" {
                let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.image, .rawImage], asCopy: false)
                picker.allowsMultipleSelection = true
                picker.delegate = self
                viewController.present(picker, animated: true)
            } else {
                var configuration = PHPickerConfiguration()
                configuration.filter = .images
                configuration.selectionLimit = 20
                configuration.preferredAssetRepresentationMode = .current
                let picker = PHPickerViewController(configuration: configuration)
                picker.delegate = self
                viewController.present(picker, animated: true)
            }
        }
    }
    private func copyImport(_ url: URL, suggestedName: String?) throws -> [String: String] {
        let size = (try url.resourceValues(forKeys: [.fileSizeKey])).fileSize ?? 0
        guard size > 0, size <= 120 * 1024 * 1024 else { throw NativeImageError.invalid("선택한 파일이 120MB를 초과하거나 비어 있습니다.") }
        let folder = importRoot.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let basename = URL(fileURLWithPath: suggestedName ?? url.lastPathComponent).deletingPathExtension().lastPathComponent
        let name = (basename.isEmpty ? "Photo" : basename) + "." + url.pathExtension
        let destination = folder.appendingPathComponent(name)
        do { try FileManager.default.copyItem(at: url, to: destination) }
        catch { try? FileManager.default.removeItem(at: folder); throw error }
        return ["uri": destination.absoluteString, "name": name]
    }
    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard let call = pickerCall else { return }
        pickerCall = nil
        let group = DispatchGroup()
        let resultLock = NSLock()
        var files: [Int: [String: String]] = [:]
        var failures: [String] = []
        for (index, result) in results.enumerated() {
            let provider = result.itemProvider
            let imageTypes = provider.registeredTypeIdentifiers.filter { UTType($0)?.conforms(to: .image) == true }
            let type = imageTypes.first(where: { UTType($0)?.conforms(to: .rawImage) == true })
                ?? imageTypes.first(where: { UTType($0)?.conforms(to: .heic) == true || UTType($0)?.conforms(to: .heif) == true })
                ?? imageTypes.first
            guard let type else { continue }
            group.enter()
            provider.loadFileRepresentation(forTypeIdentifier: type) { url, error in
                defer { group.leave() }
                do {
                    guard let url else { throw error ?? NativeImageError.invalid("선택한 원본을 읽지 못했습니다.") }
                    let file = try self.copyImport(url, suggestedName: provider.suggestedName)
                    resultLock.lock(); files[index] = file; resultLock.unlock()
                } catch { resultLock.lock(); failures.append(error.localizedDescription); resultLock.unlock() }
            }
        }
        group.notify(queue: .main) { call.resolve(["files": files.keys.sorted().compactMap { files[$0] }, "failures": failures]) }
    }
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pickerCall else { return }
        pickerCall = nil
        work.async {
            var files: [[String: String]] = [], failures: [String] = []
            for url in urls.prefix(20) {
                let access = url.startAccessingSecurityScopedResource()
                defer { if access { url.stopAccessingSecurityScopedResource() } }
                do { files.append(try self.copyImport(url, suggestedName: nil)) }
                catch { failures.append(error.localizedDescription) }
            }
            call.resolve(["files": files, "failures": failures])
        }
    }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pickerCall?.resolve(["files": [], "failures": []]); pickerCall = nil
    }
    @objc func releaseImports(_ call: CAPPluginCall) {
        for value in call.getArray("uris", String.self) ?? [] {
            if let url = URL(string: value), url.isFileURL,
               url.standardizedFileURL.path.hasPrefix(importRoot.standardizedFileURL.path + "/") {
                try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
            }
        }
        call.resolve()
    }
    @objc func cancelSubject(_ call: CAPPluginCall) {
        if let id = call.getString("requestId") {
            lock.lock(); requests[id]?.cancel(); lock.unlock()
        }
        call.resolve()
    }
    @objc func selectSubject(_ call: CAPPluginCall) {
        guard #available(iOS 17.0, *) else { call.reject("피사체 선택은 iOS 17 이상에서 지원합니다."); return }
        guard let id = call.getString("requestId"),
              let png = call.getString("png"), png.utf8.count <= 8_000_000,
              let data = Data(base64Encoded: png), let source = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
              image.width > 0, image.height > 0, max(image.width, image.height) <= 1024,
              let points = call.getArray("points", JSObject.self), !points.isEmpty, points.count <= 32,
              points.first?["exclude"] as? Bool != true,
              points.allSatisfy({ point in
                  guard let x = point["x"] as? Double, let y = point["y"] as? Double, point["exclude"] is Bool else { return false }
                  return x.isFinite && y.isFinite && (0...1).contains(x) && (0...1).contains(y)
              }) else { call.reject("피사체 선택 입력이 올바르지 않습니다."); return }
        let request = VNGenerateForegroundInstanceMaskRequest()
        lock.lock(); requests[id] = request; lock.unlock()
        work.async {
            defer { self.lock.lock(); self.requests.removeValue(forKey: id); self.lock.unlock() }
            do {
                let result = try NativeSubjectSelector.select(image: image, points: points.map { NativeMaskPoint(x: $0["x"] as! Double, y: $0["y"] as! Double, exclude: $0["exclude"] as! Bool) }, request: request)
                call.resolve(["width": result.width, "height": result.height, "data": result.data.base64EncodedString()])
            } catch { call.reject(error.localizedDescription) }
        }
    }
}

@available(iOS 17.0, *)
private class HinanaHDRPreviewController: UIViewController, UIScrollViewDelegate {
    private let image: UIImage
    private let picture = UIImageView()
    private let scroll = UIScrollView()
    init(image: UIImage) { self.image = image; super.init(nibName: nil, bundle: nil) }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 21/255, green: 23/255, blue: 25/255, alpha: 1)
        picture.image = image
        picture.contentMode = .scaleAspectFit
        picture.preferredImageDynamicRange = .high
        scroll.delegate = self; scroll.minimumZoomScale = 1; scroll.maximumZoomScale = 8
        scroll.addSubview(picture); view.addSubview(scroll)
        let close = UIButton(type: .system)
        close.setTitle("편집으로 돌아가기", for: .normal)
        close.tintColor = UIColor(red: 209/255, green: 223/255, blue: 183/255, alpha: 1)
        close.backgroundColor = UIColor.black.withAlphaComponent(0.7)
        close.layer.cornerRadius = 8
        close.addTarget(self, action: #selector(done), for: .touchUpInside)
        close.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(close)
        NSLayoutConstraint.activate([
            close.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            close.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            close.widthAnchor.constraint(equalToConstant: 165), close.heightAnchor.constraint(equalToConstant: 44)
        ])
    }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        scroll.frame = view.bounds
        if scroll.zoomScale == 1 { picture.frame = scroll.bounds; scroll.contentSize = scroll.bounds.size }
    }
    func viewForZooming(in scrollView: UIScrollView) -> UIView? { picture }
    @objc private func done() { dismiss(animated: true) }
}
