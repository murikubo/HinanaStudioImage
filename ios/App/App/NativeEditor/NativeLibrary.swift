import Combine
import CoreImage
import Foundation
import ImageIO
import UniformTypeIdentifiers

final class NativeLibrary: ObservableObject {
  static let shared = NativeLibrary()
  @Published var photos: [NativePhoto] = []
  @Published var selected = ""
  @Published var busy = false
  @Published var message = ""
  private let saves = DispatchQueue(label: "studio.hinana.image.native-save", qos: .utility)
  let work = DispatchQueue(label: "studio.hinana.image.native-editor", qos: .userInitiated)
  let root: URL
  var current: NativePhoto? { photos.first { $0.id == selected } }
  var saveURL: URL { root.appendingPathComponent("workspace.json") }
  init(root: URL? = nil) {
    self.root =
      root
      ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("NativeImageLibrary", isDirectory: true)
    try? FileManager.default.createDirectory(at: self.root, withIntermediateDirectories: true)
    restore()
  }
  func restore() {
    guard let data = try? Data(contentsOf: saveURL) else { return }
    do {
      guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
        let items = json["photos"] as? [[String: Any]]
      else { throw NativeImageError.invalid("작업 공간 형식이 올바르지 않습니다.") }
      photos = try items.map { item in
        guard let id = item["id"] as? String, let name = item["name"] as? String,
          let file = item["file"] as? String, URL(fileURLWithPath: file).lastPathComponent == file,
          FileManager.default.fileExists(atPath: root.appendingPathComponent(file).path),
          let w = item["width"] as? Int, let h = item["height"] as? Int
        else { throw NativeImageError.invalid("작업 공간 원본 파일을 읽지 못했습니다.") }
        let p = NativePhoto(
          id: id, name: name, file: file, width: w, height: h, rating: item["rating"] as? Int ?? 0,
          settings: try NativeSettings.validated(item["adjustments"] as? [String: Any] ?? [:]))
        if let frames = item["undo"] as? [String] {
          p.history = try frames.suffix(30).map { try NativeUndoArchive.decode($0) }
          p.cursor = min(p.history.count - 1, max(0, item["undoCursor"] as? Int ?? 0))
        }
        p.rawFile = item["rawFile"] as? String
        if let raw = p.rawFile, URL(fileURLWithPath: raw).lastPathComponent != raw {
          throw NativeImageError.invalid("RAW 경로가 올바르지 않습니다.")
        }
        p.metadata = item["metadata"] as? [String: Any] ?? [:]
        p.rating = min(5, max(0, p.rating))
        return p
      }
      selected = json["selected"] as? String ?? ""
      if current == nil { selected = photos.first?.id ?? "" }
    } catch { message = error.localizedDescription }
  }
  func persist(removing: [String] = []) {
    let retained = Set(photos.flatMap { [$0.file] + [$0.rawFile].compactMap { $0 } })
    let snapshot: [String: Any] = [
      "version": 1, "photos": photos.map(\.manifest), "selected": selected,
    ]
    saves.async {
      do {
        var saved = snapshot
        saved["photos"] = try (snapshot["photos"] as! [[String: Any]]).map { item in
          var record = item
          let frames = record.removeValue(forKey: "undoValues") as? [[String: Any]] ?? []
          record["undo"] = try frames.map { try NativeUndoArchive.encode($0) }
          return record
        }
        try JSONSerialization.data(withJSONObject: saved).write(
          to: self.saveURL, options: .atomic)
        for file in removing
        where !retained.contains(file) && URL(fileURLWithPath: file).lastPathComponent == file {
          try? FileManager.default.removeItem(at: self.root.appendingPathComponent(file))
        }
      } catch {
        DispatchQueue.main.async { self.message = "자동 저장 실패: \(error.localizedDescription)" }
      }
    }
  }
  #if DEBUG
    func flushSaves() { saves.sync {} }
  #endif
  func url(_ p: NativePhoto) -> URL { root.appendingPathComponent(p.file) }
  func update(_ key: String, _ value: Double, commit: Bool = false) {
    guard let p = current else { return }
    objectWillChange.send()
    if p.history.isEmpty { p.checkpoint() }
    p.settings[key] = value
    if commit {
      p.checkpoint()
      persist()
    }
  }
  func edit(_ body: (inout NativeSettings) -> Void) {
    guard let p = current else { return }
    objectWillChange.send()
    if p.history.isEmpty { p.checkpoint() }
    body(&p.settings)
    p.checkpoint()
    persist()
  }
  func undo(_ forward: Bool = false) {
    guard let p = current else { return }
    let next = p.cursor + (forward ? 1 : -1)
    guard p.history.indices.contains(next) else { return }
    objectWillChange.send()
    p.cursor = next
    p.settings = p.history[next]
    persist()
  }
  func remove(_ id: String) {
    // Commit the manifest first; originals are never removed from Photos or external files.
    let removed = photos.filter { $0.id == id }.flatMap {
      [$0.file] + [$0.rawFile].compactMap { $0 }
    }
    photos.removeAll { $0.id == id }
    if current == nil { selected = photos.first?.id ?? "" }
    persist(removing: removed)
    message = "사진을 작업 공간에서 삭제했습니다. 원본은 유지됩니다."
  }
  func importFiles(_ urls: [URL]) {
    guard !busy, !urls.isEmpty else { return }
    guard photos.count < 200 else {
      message = "작업 공간은 최대 200장까지 지원합니다."
      return
    }
    let remaining = min(20, 200 - photos.count)
    busy = true
    work.async {
      var imported: [NativePhoto] = []
      var failures: [String] = []
      for url in urls.prefix(remaining) {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        do {
          let p = try autoreleasepool { try self.copyPhoto(url) }
          imported.append(p)
        } catch { failures.append(error.localizedDescription) }
      }
      DispatchQueue.main.async {
        self.photos.append(contentsOf: imported)
        self.selected = imported.first?.id ?? self.selected
        self.busy = false
        self.message =
          failures.isEmpty ? "\(imported.count)장의 사진을 불러왔습니다." : failures.joined(separator: "\n")
        self.persist()
      }
    }
  }
  func redevelop(_ p: NativePhoto) {
    guard !busy, let raw = p.rawFile else { return }
    busy = true
    work.async {
      do {
        let source = try NativeRenderEngine.shared.source(self.root.appendingPathComponent(raw))
        DispatchQueue.main.async {
          self.objectWillChange.send()
          p.file = raw
          p.width = Int(source.image.extent.width)
          p.height = Int(source.image.extent.height)
          p.history = []
          p.cursor = -1
          p.settings = NativeSettings()
          p.settings.values["precision"] = "float"
          if source.hdr {
            p.settings.values["dynamicRange"] = "hdr"
            p.settings.values["colorSpace"] = "display-p3"
          }
          p.checkpoint()
          self.busy = false
          self.persist()
        }
      } catch {
        DispatchQueue.main.async {
          self.busy = false
          self.message = error.localizedDescription
        }
      }
    }
  }
  func copyPhoto(_ url: URL) throws -> NativePhoto {
    guard
      let source = CGImageSourceCreateWithURL(
        url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
      let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any],
      let w = properties[kCGImagePropertyPixelWidth as String] as? Int,
      let h = properties[kCGImagePropertyPixelHeight as String] as? Int, w > 0, h > 0,
      Double(w) * Double(h) <= 100_000_000
    else { throw NativeImageError.invalid("지원되는 이미지인지 확인해 주세요. 최대 100MP입니다.") }
    let bytes = (try url.resourceValues(forKeys: [.fileSizeKey])).fileSize ?? 0
    guard bytes > 0, bytes <= 256 * 1024 * 1024 else {
      throw NativeImageError.invalid("사진 원본은 256MB 이하를 지원합니다.")
    }
    let file = UUID().uuidString + "." + (url.pathExtension.isEmpty ? "image" : url.pathExtension)
    let destination = root.appendingPathComponent(file)
    try FileManager.default.copyItem(at: url, to: destination)
    do {
      let image = try NativeRenderEngine.shared.source(destination)
      var settings = NativeSettings()
      settings.values["precision"] = "float"
      if image.hdr {
        settings.values["dynamicRange"] = "hdr"
        settings.values["colorSpace"] = "display-p3"
      }
      let p = NativePhoto(
        name: url.lastPathComponent, file: file, width: Int(image.image.extent.width),
        height: Int(image.image.extent.height), settings: settings)
      if image.raw { p.rawFile = file }
      return p
    } catch {
      try? FileManager.default.removeItem(at: destination)
      throw error
    }
  }
  func importProject(_ url: URL, completion: (() -> Void)? = nil) {
    guard !busy else { return }
    busy = true
    work.async {
      let access = url.startAccessingSecurityScopedResource()
      defer { if access { url.stopAccessingSecurityScopedResource() } }
      do {
        guard (try url.resourceValues(forKeys: [.fileSizeKey])).fileSize ?? 0 <= 512 * 1024 * 1024
        else { throw NativeImageError.invalid("프로젝트는 512MB 이하를 지원합니다.") }
        guard let stream = InputStream(url: url) else {
          throw NativeImageError.invalid("프로젝트 파일을 읽지 못했습니다.")
        }
        stream.open()
        defer { stream.close() }
        guard let json = try JSONSerialization.jsonObject(with: stream) as? [String: Any],
          let version = json["version"] as? Int, (1...5).contains(version),
          let items = json["photos"] as? [[String: Any]], items.count <= 200
        else { throw NativeImageError.invalid("지원하지 않는 프로젝트 형식입니다.") }
        var ids = Set<String>()
        var imported: [NativePhoto] = []
        for item in items {
          guard let id = item["id"] as? String, !ids.contains(id),
            let name = item["name"] as? String, let src = item["src"] as? String
          else { throw NativeImageError.invalid("프로젝트 사진이 올바르지 않습니다.") }
          ids.insert(id)
          let parts = src.split(separator: ",", maxSplits: 1)
          guard parts.count == 2,
            ["data:image/png;base64", "data:image/jpeg;base64", "data:image/webp;base64"].contains(
              String(parts[0])), let bytes = Data(base64Encoded: String(parts[1]))
          else { throw NativeImageError.invalid("프로젝트 원본이 올바르지 않습니다.") }
          let file =
            UUID().uuidString
            + (parts[0].contains("png") ? ".png" : parts[0].contains("webp") ? ".webp" : ".jpg")
          let destination = self.root.appendingPathComponent(file)
          try bytes.write(to: destination, options: .atomic)
          let image = try NativeRenderEngine.shared.source(destination)
          let p = NativePhoto(
            id: id, name: name, file: file, width: Int(image.image.extent.width),
            height: Int(image.image.extent.height), rating: item["rating"] as? Int ?? 0,
            settings: try NativeSettings.validated(item["adjustments"] as? [String: Any] ?? [:]))
          if let raw = item["rawSource"] as? String,
            let b64 = raw.split(separator: ",", maxSplits: 1).last,
            let data = Data(base64Encoded: String(b64))
          {
            let rawFile = UUID().uuidString + "." + URL(fileURLWithPath: name).pathExtension
            try data.write(to: self.root.appendingPathComponent(rawFile), options: .atomic)
            p.rawFile = rawFile
          }
          p.metadata = item["metadata"] as? [String: Any] ?? [:]
          p.rating = min(5, max(0, p.rating))
          imported.append(p)
        }
        DispatchQueue.main.async {
          self.photos = imported
          self.selected = json["selected"] as? String ?? imported.first?.id ?? ""
          if self.current == nil { self.selected = imported.first?.id ?? "" }
          self.busy = false
          self.persist()
          completion?()
        }
      } catch {
        DispatchQueue.main.async {
          self.busy = false
          self.message = error.localizedDescription
        }
      }
    }
  }
  func writeProject() throws -> URL {
    let target = FileManager.default.temporaryDirectory.appendingPathComponent(
      "Hinana-Workspace.hinanaimage")
    FileManager.default.createFile(atPath: target.path, contents: nil)
    let handle = try FileHandle(forWritingTo: target)
    defer { try? handle.close() }
    func write(_ string: String) throws { try handle.write(contentsOf: Data(string.utf8)) }
    let escaped = String(
      data: try JSONSerialization.data(withJSONObject: selected, options: .fragmentsAllowed),
      encoding: .utf8)!
    try write("{\"version\":5,\"selected\":\(escaped),\"photos\":[")
    for (index, p) in photos.enumerated() {
      if index > 0 { try write(",") }
      var record = p.manifest
      record.removeValue(forKey: "file")
      record.removeValue(forKey: "rawFile")
      record.removeValue(forKey: "undoValues")
      record.removeValue(forKey: "undoCursor")
      let source = try NativeRenderEngine.shared.source(url(p))
      let original: Data
      if p.file.hasSuffix(".png") || p.file.hasSuffix(".jpg") || p.file.hasSuffix(".jpeg")
        || p.file.hasSuffix(".webp")
      {
        original = try Data(contentsOf: url(p))
      } else {
        original = try NativeRenderEngine.shared.png(
          source.image, space: source.hdr ? "hdr" : "display-p3", depth: 16,
          properties: source.properties)
      }
      let mime =
        p.file.hasSuffix(".webp")
        ? "webp" : p.file.hasSuffix(".jpg") || p.file.hasSuffix(".jpeg") ? "jpeg" : "png"
      record["src"] = "data:image/\(mime);base64," + original.base64EncodedString()
      if let rawFile = p.rawFile {
        record["rawSource"] =
          "data:application/octet-stream;base64,"
          + (try Data(contentsOf: root.appendingPathComponent(rawFile))).base64EncodedString()
      }
      record["history"] = []
      record["cursor"] = 0
      try handle.write(contentsOf: JSONSerialization.data(withJSONObject: record))
    }
    try write("]}")
    return target
  }
}
