import CoreImage
import SwiftUI
import UIKit
import WebKit

/// Reads the old origin once. No WebView participates in native editing/rendering.
final class NativeUpgradeController: UIViewController, WKScriptMessageHandler, WKURLSchemeHandler {
  var ready = false
  var onReady: (() -> Void)?
  private var web: WKWebView?
  private var pending: [NativePhoto] = []
  private var photo: NativePhoto?
  private var handle: FileHandle?
  private var selected = ""
  private let library = NativeLibrary.shared
  private let status = UILabel()
  private var selfTest: Bool {
    #if DEBUG
      return ProcessInfo.processInfo.arguments.contains("--native-migration-self-test")
    #else
      return false
    #endif
  }
  private var fixtureScript: String {
    #if DEBUG
      guard selfTest else { return "" }
      let image = CIImage(color: CIColor(red: 0.4, green: 0.2, blue: 0.1)).cropped(
        to: CGRect(x: 0, y: 0, width: 64, height: 80))
      guard
        let png = try? NativeRenderEngine.shared.png(
          image, space: "srgb", depth: 16, properties: [:])
      else { return "" }
      var settings = NativeSettings()
      settings["exposure"] = 0.7
      settings.values["precision"] = "float"
      settings.masks = [NativeMask(kind: "radial")]
      let project: [String: Any] = [
        "version": 5, "selected": "legacy-fixture",
        "photos": [
          [
            "id": "legacy-fixture", "name": "Legacy fixture.dng", "width": 64, "height": 80,
            "rating": 4, "src": "data:image/png;base64," + png.base64EncodedString(),
            "rawSource": "data:application/octet-stream;base64,AQIDBA==",
            "adjustments": settings.values,
            "history": [NativeSettings(["precision": "float"]).values, settings.values],
            "cursor": 1, "metadata": ["make": "Native fixture"],
          ]
        ],
      ]
      guard let data = try? JSONSerialization.data(withJSONObject: project),
        let json = String(data: data, encoding: .utf8)
      else { return "" }
      return
        "await new Promise((resolve,reject)=>{const t=db.transaction('workspace','readwrite');t.objectStore('workspace').put(\(json),'current');t.oncomplete=resolve;t.onerror=()=>reject(t.error)});"
    #else
      return ""
    #endif
  }
  override func viewDidLoad() {
    super.viewDidLoad()
    overrideUserInterfaceStyle = .dark
    view.backgroundColor = UIColor(white: 0.08, alpha: 1)
    guard selfTest || !FileManager.default.fileExists(atPath: library.saveURL.path) else {
      finish()
      return
    }
    status.text = "기존 작업 공간을 네이티브 저장소로 옮기는 중…"
    status.textColor = .white
    status.numberOfLines = 0
    status.textAlignment = .center
    status.frame = view.bounds.insetBy(dx: 30, dy: 100)
    status.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.addSubview(status)
    let config = WKWebViewConfiguration()
    config.setURLSchemeHandler(self, forURLScheme: "capacitor")
    config.userContentController.add(self, name: "nativeMigration")
    let web = WKWebView(frame: .zero, configuration: config)
    self.web = web
    view.addSubview(web)
    web.load(URLRequest(url: URL(string: "capacitor://localhost/native-migration")!))
  }
  private func finish() {
    web?.configuration.userContentController.removeScriptMessageHandler(forName: "nativeMigration")
    web?.stopLoading()
    web?.removeFromSuperview()
    web = nil
    let native = UIHostingController(rootView: NativeStudioView(library: library))
    native.overrideUserInterfaceStyle = .dark
    addChild(native)
    native.view.frame = view.bounds
    native.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.addSubview(native.view)
    native.didMove(toParent: self)
    ready = true
    onReady?()
    onReady = nil
  }
  func userContentController(
    _ userContentController: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    guard message.frameInfo.securityOrigin.protocol == "capacitor",
      message.frameInfo.securityOrigin.host == "localhost",
      let value = message.body as? [String: Any], let kind = value["kind"] as? String
    else { return }
    library.work.async {
      do {
        switch kind {
        case "start": self.selected = value["selected"] as? String ?? ""
        case "photo":
          guard let item = value["photo"] as? [String: Any], let id = item["id"] as? String,
            let name = item["name"] as? String, let w = item["width"] as? Int,
            let h = item["height"] as? Int
          else { throw NativeImageError.invalid("기존 사진 정보가 올바르지 않습니다.") }
          let p = NativePhoto(
            id: id, name: name, file: UUID().uuidString + "." + (value["ext"] as? String ?? "png"),
            width: w, height: h, rating: item["rating"] as? Int ?? 0,
            settings: try NativeSettings.validated(item["adjustments"] as? [String: Any] ?? [:]))
          p.metadata = item["metadata"] as? [String: Any] ?? [:]
          p.cursor = item["cursor"] as? Int ?? -1
          self.photo = p
          let url = self.library.url(p)
          FileManager.default.createFile(atPath: url.path, contents: nil)
          self.handle = try FileHandle(forWritingTo: url)
        case "chunk":
          guard let encoded = value["data"] as? String, encoded.count <= 65536,
            let data = Data(base64Encoded: encoded), let handle = self.handle
          else { throw NativeImageError.invalid("기존 사진 데이터가 올바르지 않습니다.") }
          try handle.write(contentsOf: data)
        case "history":
          if let value = value["adjustments"] as? [String: Any], let p = self.photo,
            p.history.count < 30
          {
            p.history.append(try NativeSettings.validated(value))
          }
        case "raw":
          try self.handle?.close()
          guard let p = self.photo else { throw NativeImageError.invalid("기존 RAW 사진을 읽지 못했습니다.") }
          let ext = URL(fileURLWithPath: p.name).pathExtension
          let file = UUID().uuidString + "." + (ext.isEmpty ? "dng" : ext)
          p.rawFile = file
          let url = self.library.root.appendingPathComponent(file)
          FileManager.default.createFile(atPath: url.path, contents: nil)
          self.handle = try FileHandle(forWritingTo: url)
        case "end":
          try self.handle?.close()
          self.handle = nil
          if let p = self.photo { self.pending.append(p) }
          self.photo = nil
        case "done":
          #if DEBUG
            if self.selfTest {
              let p = self.pending.first
              let pass =
                self.pending.count == 1 && p?.id == "legacy-fixture"
                && p?.settings["exposure"] == 0.7 && p?.rating == 4 && p?.settings.masks.count == 1
                && p?.history.count == 2 && p?.cursor == 1
                && value["oldPreserved"] as? Bool == true
                && (p?.rawFile.flatMap {
                  try? Data(contentsOf: self.library.root.appendingPathComponent($0))
                }) == Data([1, 2, 3, 4])
              try JSONSerialization.data(withJSONObject: ["pass": pass]).write(
                to: self.library.root.appendingPathComponent("migration-diagnostics.json"),
                options: .atomic)
            }
          #endif
          DispatchQueue.main.async {
            self.library.photos = self.pending
            self.library.selected = self.selected
            if self.library.current == nil { self.library.selected = self.pending.first?.id ?? "" }
            self.library.persist()
            self.finish()
          }
          return
        case "failure":
          throw NativeImageError.invalid(value["message"] as? String ?? "기존 작업 공간을 읽지 못했습니다.")
        default: throw NativeImageError.invalid("작업 공간 이전 요청이 올바르지 않습니다.")
        }
        DispatchQueue.main.async { self.web?.evaluateJavaScript("window.nativeAck(null)") }
      } catch {
        try? self.handle?.close()
        self.handle = nil
        DispatchQueue.main.async {
          self.status.text =
            "작업 공간 이전 실패\n\(error.localizedDescription)\n기존 저장소는 그대로 보존되어 있습니다. 앱을 다시 열어 재시도할 수 있습니다."
          self.web?.stopLoading()
        }
      }
    }
  }
  func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
    let script = """
      <!doctype html><meta charset="utf-8"><script>
      let resolveAck;window.nativeAck=(error)=>{if(error)resolveAck.reject(error);else resolveAck.resolve();};
      const send=value=>new Promise((resolve,reject)=>{resolveAck={resolve,reject};webkit.messageHandlers.nativeMigration.postMessage(value)});
      (async()=>{try{
        const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('hinana-image',1);r.onupgradeneeded=()=>r.result.createObjectStore('workspace');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
        \(fixtureScript)
          const project=await new Promise((resolve,reject)=>{const r=db.transaction('workspace').objectStore('workspace').get('current');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});db.close();
        await send({kind:'start',selected:project?.selected||''});
        for(const p of project?.photos||[]){
          const ext=p.src.startsWith('data:image/jpeg')?'jpg':p.src.startsWith('data:image/webp')?'webp':'png';
          await send({kind:'photo',ext,photo:{id:p.id,name:p.name,width:p.width,height:p.height,rating:p.rating,adjustments:p.adjustments,metadata:p.metadata,cursor:Math.max(0,(p.cursor||0)-Math.max(0,(p.history?.length||0)-30))}});
          async function chunks(src){const start=src.indexOf(',')+1;for(let i=start;i<src.length;i+=65536)await send({kind:'chunk',data:src.slice(i,i+65536)})}
          await chunks(p.src);if(p.rawSource){await send({kind:'raw'});await chunks(p.rawSource)}for(const adjustments of (p.history||[]).slice(-30))await send({kind:'history',adjustments});await send({kind:'end'});
          if(!\(selfTest ? "true" : "false")){p.src='';p.rawSource='';p.history=[];}
        }
        let oldPreserved=true;
        if(\(selfTest ? "true" : "false")){
          const original=await new Promise((resolve,reject)=>{const r=indexedDB.open('hinana-image',1);r.onsuccess=()=>{const d=r.result,q=d.transaction('workspace').objectStore('workspace').get('current');q.onsuccess=()=>{d.close();resolve(q.result)};q.onerror=()=>reject(q.error)};r.onerror=()=>reject(r.error)});
          oldPreserved=JSON.stringify(original)===JSON.stringify(project);
        }
        await send({kind:'done',oldPreserved});
      }catch(e){webkit.messageHandlers.nativeMigration.postMessage({kind:'failure',message:String(e)})}})();
      </script>
      """
    let bytes = Data(script.utf8)
    urlSchemeTask.didReceive(
      URLResponse(
        url: urlSchemeTask.request.url!, mimeType: "text/html", expectedContentLength: bytes.count,
        textEncodingName: "utf-8"))
    urlSchemeTask.didReceive(bytes)
    urlSchemeTask.didFinish()
  }
  func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}
