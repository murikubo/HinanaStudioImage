import CoreImage
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import Vision

struct NativeStudioView: View {
  @ObservedObject var library: NativeLibrary
  @State private var section = "편집"
  @State private var panel = "편집"
  @State private var query = ""
  @State private var stars = false
  @State private var picker = ""
  @State private var about = false
  @State private var exporting = false
  @State private var sharing: URL?
  @State private var removing: NativePhoto?
  @State private var zoomRequest = 0.0
  @State private var zoomRevision = 0
  @State private var zoomLabel = "맞춤"
  @State private var histogram = [[Int]]()
  @State private var compare = false
  @State private var proof = false
  @State private var overlay = true
  @State private var maskID = ""
  @State private var maskTool = "ai"
  @State private var aiExclude = false
  @State private var exportFormat = "jpeg"
  @State private var exportSpace = "srgb"
  @State private var exportSize = 0.0
  @State private var quality = 0.95
  @State private var preserve = true
  private let accent = Color(red: 0.81, green: 0.87, blue: 0.7)
  var body: some View {
    GeometryReader { geometry in
      VStack(spacing: 0) {
        header
        if section == "사진" {
          libraryGrid
        } else if let photo = library.current {
          if geometry.size.width > 700 {
            HStack(spacing: 0) {
              preview(photo)
              controls.frame(width: 340)
            }
          } else {
            preview(photo).frame(maxHeight: geometry.size.height * 0.47)
            controls
          }
        } else {
          Spacer()
          Image(systemName: "photo.on.rectangle.angled").font(.system(size: 42)).foregroundStyle(
            accent)
          Text("사진을 추가해 편집을 시작하세요.").padding()
          Button("사진 추가") { picker = "source" }
          Spacer()
        }
        bottomNavigation
      }.background(Color(red: 0.075, green: 0.085, blue: 0.09)).tint(accent).preferredColorScheme(
        .dark)
    }
    .sheet(isPresented: $about) {
      VStack(spacing: 20) {
        Image("StudioLogo").resizable().frame(width: 80, height: 80)
        Text("HINANA Studio Image").font(.title2.bold())
        Text("개발/제작자 비나래")
        Text("Ver. \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "")")
        Text("Swift · Core Image · Metal 네이티브 편집기").font(.footnote)
        Button("닫기") { about = false }
      }.padding()
    }
    .sheet(isPresented: $exporting) { exportSheet }
    .sheet(item: Binding(get: { sharing.map { SharedFile(url: $0) } }, set: { sharing = $0?.url }))
    { ActivitySheet(url: $0.url) }
    .confirmationDialog(
      "사진 추가", isPresented: Binding(get: { picker == "source" }, set: { if !$0 { picker = "" } }),
      titleVisibility: .visible
    ) {
      Button("사진 보관함에서 선택") { picker = "photos" }
      Button("파일에서 선택") { picker = "images" }
    }
    .sheet(isPresented: Binding(get: { picker == "photos" }, set: { if !$0 { picker = "" } })) {
      PhotoLibraryPicker { urls in
        picker = ""
        library.importFiles(urls)
        section = "편집"
      }
    }
    .sheet(
      isPresented: Binding(
        get: { picker == "images" || picker == "project" }, set: { if !$0 { picker = "" } })
    ) {
      NativeDocumentPicker(project: picker == "project") { urls in
        let project = picker == "project"
        picker = ""
        if project, let url = urls.first {
          library.importProject(url) { section = "편집" }
        } else {
          library.importFiles(urls)
          section = "편집"
        }
      }
    }
    .alert(
      "라이브러리에서 삭제",
      isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } })
    ) {
      Button("취소", role: .cancel) { removing = nil }
      Button("삭제", role: .destructive) {
        if let photo = removing { library.remove(photo.id) }
        removing = nil
      }
    } message: {
      Text("\(removing?.name ?? "")\n사진과 보정 내역을 작업 공간에서 제거합니다. 원본 사진은 유지됩니다.")
    }
    .alert(
      "Hinana Studio Image",
      isPresented: Binding(
        get: { !library.message.isEmpty }, set: { if !$0 { library.message = "" } })
    ) {
      Button("확인") { library.message = "" }
    } message: {
      Text(library.message)
    }
    .overlay {
      if library.busy {
        ZStack {
          Color.black.opacity(0.4)
          ProgressView("처리 중…").padding(25).background(.regularMaterial).clipShape(
            RoundedRectangle(cornerRadius: 14))
        }
      }
    }
  }
  private var header: some View {
    HStack(spacing: 12) {
      Image("StudioLogo").resizable().frame(width: 36, height: 36).clipShape(
        RoundedRectangle(cornerRadius: 8))
      VStack(alignment: .leading, spacing: 2) {
        Text("HINANA").font(.system(size: 13, weight: .bold)).tracking(2)
        Text("Studio Image").font(.system(size: 10)).foregroundStyle(.secondary)
      }
      Spacer()
      Button {
        picker = "project"
      } label: {
        Image(systemName: "folder")
      }.accessibilityLabel("프로젝트 열기")
      Button {
        about = true
      } label: {
        Image(systemName: "info.circle")
      }.accessibilityLabel("프로그램 정보")
      Button {
        saveProject()
      } label: {
        Image(systemName: "square.and.arrow.down")
      }.accessibilityLabel("프로젝트 저장")
      Button {
        if let p = library.current {
          exportSpace = p.settings.string("colorSpace")
          exporting = true
        }
      } label: {
        Image(systemName: "square.and.arrow.up")
      }.accessibilityLabel("내보내기").disabled(library.current == nil)
    }.buttonStyle(.borderless).font(.system(size: 20)).padding(.horizontal, 14).frame(height: 52)
      .background(Color.white.opacity(0.035))
  }
  private func preview(_ photo: NativePhoto) -> some View {
    VStack(spacing: 0) {
      HStack {
        VStack(alignment: .leading) {
          Text(photo.name).font(.subheadline).lineLimit(1)
          Text("\(photo.width) × \(photo.height) · 비파괴 편집").font(.caption2).foregroundStyle(
            .secondary)
        }
        Spacer()
        Text(photo.settings.hdr ? "HDR" : "SDR").font(.caption).foregroundStyle(accent)
      }.padding(.horizontal, 12).padding(.vertical, 6)
      NativeCanvas(
        library: library, compare: compare, proofSDR: proof, maskID: panel == "마스크" ? maskID : "",
        maskTool: maskTool, overlay: overlay, zoomRequest: zoomRequest, zoomRevision: zoomRevision,
        onZoom: { zoomLabel = $0 }, onHistogram: { histogram = $0 }, onPoints: maskPoints)
      HStack {
        Menu {
          ForEach(["original", "1:1", "4:5", "3:2", "16:9"], id: \.self) { crop in
            Button(crop == "original" ? "원본 비율" : crop) {
              library.edit { $0.values["crop"] = crop }
            }
          }
        } label: {
          Image(systemName: "crop")
        }.accessibilityLabel("자르기")
        Button {
          library.edit {
            $0["rotation"] = ($0["rotation"] + 90).truncatingRemainder(dividingBy: 360)
          }
        } label: {
          Image(systemName: "rotate.right")
        }.accessibilityLabel("90도 회전")
        Button {
          library.edit { $0.values["flip"] = (!$0.flip) }
        } label: {
          Image(systemName: "arrow.left.and.right.righttriangle.left.righttriangle.right")
        }.accessibilityLabel("좌우 반전")
        Button {
          library.undo()
        } label: {
          Image(systemName: "arrow.uturn.backward")
        }.accessibilityLabel("실행 취소")
        Button {
          library.undo(true)
        } label: {
          Image(systemName: "arrow.uturn.forward")
        }.accessibilityLabel("다시 실행")
        Menu {
          ForEach([0.0, 10, 25, 50, 100, 200, 400], id: \.self) { value in
            Button(value == 0 ? "맞춤" : "\(Int(value))%") {
              zoomRequest = value
              zoomRevision += 1
            }
          }
        } label: {
          Text(zoomLabel).font(.caption.monospacedDigit())
        }
        Spacer()
        Button {
          compare.toggle()
        } label: {
          Image(systemName: compare ? "eye.fill" : "eye")
        }.accessibilityLabel("원본 비교")
      }.font(.system(size: 17)).padding(10)
    }
  }
  private var bottomNavigation: some View {
    HStack {
      Button {
        picker = "source"
      } label: {
        Label("사진 추가", systemImage: "plus")
      }
      Button {
        section = "사진"
      } label: {
        Label("사진", systemImage: "photo.on.rectangle")
      }
      Button {
        section = "편집"
        panel = "편집"
      } label: {
        Label("편집", systemImage: "slider.horizontal.3")
      }
      Button {
        section = "편집"
        panel = "프리셋"
      } label: {
        Label("프리셋", systemImage: "paintpalette")
      }
    }.labelStyle(NativeTabLabels()).font(.system(size: 22)).buttonStyle(.borderless).frame(
      maxWidth: .infinity
    ).padding(.vertical, 14).background(Color.white.opacity(0.04))
  }
  private var libraryGrid: some View {
    VStack {
      HStack {
        TextField("사진 검색", text: $query).textFieldStyle(.roundedBorder)
        Toggle("별표", isOn: $stars).fixedSize()
      }.padding()
      ScrollView {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 145))]) {
          ForEach(
            library.photos.filter {
              (!stars || $0.rating > 0)
                && (query.isEmpty || $0.name.localizedCaseInsensitiveContains(query))
            }
          ) { photo in
            Button {
              library.selected = photo.id
              section = "편집"
              library.persist()
            } label: {
              VStack(alignment: .leading) {
                NativeThumbnail(url: library.url(photo)).frame(height: 140).clipped()
                Text(photo.name).lineLimit(1).font(.caption)
                Text(String(repeating: "★", count: photo.rating)).font(.caption).foregroundStyle(
                  accent)
              }.padding(6).background(Color.white.opacity(0.04)).clipShape(
                RoundedRectangle(cornerRadius: 8))
            }
            .contextMenu {
              Button(role: .destructive) {
                removing = photo
              } label: {
                Label("라이브러리에서 삭제", systemImage: "trash")
              }
            }
          }
        }.padding(.horizontal)
      }
    }
  }
  private var controls: some View {
    VStack(spacing: 0) {
      NativeHistogramView(bins: histogram).frame(height: 36).padding(.horizontal, 14)
      Picker("편집 도구", selection: $panel) {
        ForEach(["편집", "색상·톤", "마스크", "정보", "프리셋"], id: \.self) { Text($0) }
      }.pickerStyle(.segmented).padding(8)
      ScrollView {
        VStack(alignment: .leading, spacing: 14) {
          if panel == "편집" {
            slider("노출", "exposure", -3...3)
            slider("대비", "contrast")
            slider("하이라이트", "highlights")
            slider("그림자", "shadows")
            slider("흰색", "whites")
            slider("검정", "blacks")
            slider("색온도", "temperature")
            slider("색조", "tint")
            slider("생동감", "vibrance")
            slider("채도", "saturation")
            slider("페이드", "fade", 0...100)
            slider("비네팅", "vignette", 0...100)
            Divider()
            Text("피부 보정").bold()
            slider("피부 부드러움", "skinSmooth", 0...100)
            slider("붉은 기 감소", "skinRedness", 0...100)
            slider("피부 밝기", "skinBrightness", 0...100)
            colorSettings
          } else if panel == "색상·톤" {
            Text("톤 곡선").bold()
            slider("어두운 영역", "curveShadows")
            slider("중간 영역", "curveMidtones")
            slider("밝은 영역", "curveHighlights")
            ForEach(
              Array(zip(NativeSettings.bands, ["빨강", "주황", "노랑", "초록", "청록", "파랑", "보라", "자홍"])),
              id: \.0
            ) { band, name in
              Text(name).bold()
              slider("색상", "mixer_\(band)_hue")
              slider("채도", "mixer_\(band)_saturation")
              slider("명도", "mixer_\(band)_luminance")
            }
          } else if panel == "마스크" {
            maskControls
          } else if panel == "정보" {
            information
          } else {
            presetControls
          }
          Divider()
          Button("모든 보정 초기화") { library.edit { $0 = NativeSettings() } }.frame(maxWidth: .infinity)
        }.padding(14)
      }
    }.background(Color.white.opacity(0.035))
  }
  private func slider(_ title: String, _ key: String, _ range: ClosedRange<Double> = -100...100)
    -> some View
  {
    VStack(spacing: 4) {
      HStack {
        Text(title).font(.caption)
        Spacer()
        Text(
          String(format: key == "exposure" ? "%.2f" : "%.0f", library.current?.settings[key] ?? 0)
        ).font(.caption.monospacedDigit()).foregroundStyle(accent)
      }
      Slider(
        value: Binding(
          get: { library.current?.settings[key] ?? 0 }, set: { library.update(key, $0) }),
        in: range,
        onEditingChanged: { editing in
          if !editing, let p = library.current {
            library.update(key, p.settings[key], commit: true)
          }
        }
      ).accessibilityLabel(title)
    }
  }
  private var colorSettings: some View {
    VStack {
      Picker(
        "편집 정밀도",
        selection: Binding(
          get: { library.current?.settings.string("precision") ?? "float" },
          set: { value in
            library.edit {
              $0.values["precision"] = value
              if value == "legacy" { $0.values["dynamicRange"] = "sdr" }
            }
          })
      ) {
        Text("8비트").tag("legacy")
        Text("32비트 부동소수점").tag("float")
      }
      Picker(
        "작업 색공간",
        selection: Binding(
          get: { library.current?.settings.string("colorSpace") ?? "srgb" },
          set: { value in library.edit { $0.values["colorSpace"] = value } })
      ) {
        Text("sRGB").tag("srgb")
        Text("Display P3").tag("display-p3")
      }
      Toggle(
        "HDR 편집",
        isOn: Binding(
          get: { library.current?.settings.hdr ?? false },
          set: { value in
            library.edit {
              $0.values["dynamicRange"] = value ? "hdr" : "sdr"
              $0.values["precision"] = "float"
            }
          }))
      if library.current?.settings.hdr == true {
        Picker(
          "HDR 최대 밝기",
          selection: Binding(
            get: { Int(library.current?.settings["hdrPeak"] ?? 1000) },
            set: { value in library.edit { $0["hdrPeak"] = Double(value) } })
        ) { ForEach([400, 1000, 2000, 4000], id: \.self) { Text("\($0) nit").tag($0) } }
        slider("HDR 하이라이트 확장", "hdrHighlights", 0...100)
        Toggle("SDR 변환 미리보기", isOn: $proof)
      }
      Text("고정밀 GPU 편집 · 원본 파일 유지").font(.caption2).foregroundStyle(.secondary)
    }
  }
  private var presetControls: some View {
    VStack(alignment: .leading, spacing: 16) {
      ForEach(["오리지널", "알파인", "골든 아워", "소프트 필름", "딥 포레스트", "모노크롬"], id: \.self) { name in
        Button(name) { applyPreset(name) }.frame(maxWidth: .infinity, alignment: .leading).padding(
          12
        ).background(Color.white.opacity(0.04)).clipShape(RoundedRectangle(cornerRadius: 8))
      }
    }
  }
  private func applyPreset(_ name: String) {
    let values: [String: [String: Double]] = [
      "알파인": ["contrast": 14, "shadows": 22, "temperature": -9, "vibrance": 18, "highlights": -22],
      "골든 아워": [
        "temperature": 24, "exposure": 0.15, "highlights": -25, "shadows": 15, "fade": 8,
        "vibrance": 12,
      ],
      "소프트 필름": [
        "contrast": -12, "saturation": -16, "fade": 22, "temperature": 10, "shadows": 16,
        "vignette": 16,
      ],
      "딥 포레스트": [
        "exposure": -0.25, "contrast": 22, "highlights": -30, "saturation": -12, "temperature": -6,
        "vignette": 24,
      ], "모노크롬": ["saturation": -100, "contrast": 24, "highlights": -15, "shadows": 12, "fade": 5],
    ]
    library.edit { a in
      let masks = a.masks
      let color = a.string("colorSpace")
      let hdr = a.string("dynamicRange")
      a = NativeSettings()
      a.masks = masks
      a.values["colorSpace"] = color
      a.values["dynamicRange"] = hdr
      a.values["precision"] = "float"
      for (key, value) in values[name] ?? [:] { a[key] = value }
    }
  }
  private var maskControls: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("영역을 선택한 다음 로컬 노출·대비 등을 조절하세요.").font(.caption).foregroundStyle(.secondary)
      Menu("새 마스크 만들기") {
        ForEach(["subject", "brush", "linear", "radial"], id: \.self) { kind in
          Button(NativeMask(kind: kind).name) {
            let mask = NativeMask(kind: kind)
            library.edit { if $0.masks.count < 8 { $0.masks.append(mask) } }
            maskID = mask.id
          }
        }
      }
      ForEach(library.current?.settings.masks ?? []) { mask in
        Button(mask.name) {
          maskID = mask.id
          maskTool = "ai"
        }.foregroundStyle(mask.id == maskID ? accent : .secondary)
      }
      if let mask = library.current?.settings.masks.first(where: { $0.id == maskID }) {
        Toggle("선택 영역 표시", isOn: $overlay)
        if mask.kind == "subject" {
          Picker("피사체 다듬기", selection: $maskTool) {
            Text("AI 선택").tag("ai")
            Text("브러시 추가").tag("add")
            Text("브러시 지우기").tag("erase")
          }.pickerStyle(.segmented)
          if maskTool == "ai" {
            Toggle("탭한 피사체를 선택에서 제외", isOn: $aiExclude)
          }
        }
        Toggle(
          "마스크 사용",
          isOn: Binding(get: { mask.enabled }, set: { value in editMask { $0.enabled = value } }))
        Toggle(
          "선택 영역 반전",
          isOn: Binding(get: { mask.inverted }, set: { value in editMask { $0.inverted = value } }))
        maskSlider("강도", "opacity", 0...1)
        maskSlider("경계 부드러움", "feather", 0...1)
        maskSlider("브러시 크기", "radius", 0.005...0.5)
        maskSlider("로컬 노출", "exposure", -3...3)
        maskSlider("로컬 대비", "contrast", -100...100)
        maskSlider("로컬 채도", "saturation", -100...100)
        maskSlider("로컬 색온도", "temperature", -100...100)
        Button("마스크 삭제", role: .destructive) {
          library.edit { $0.masks.removeAll { $0.id == maskID } }
          maskID = ""
        }
        Text(
          mask.kind == "subject" && maskTool == "ai"
            ? "피사체를 탭해 선택하세요. 두 손가락은 확대·축소에 사용합니다." : "사진 위를 한 손가락으로 드래그하세요. 두 손가락은 확대·축소에 사용합니다."
        ).font(.caption).foregroundStyle(.secondary)
      }
    }
  }
  private func changeMask(_ body: (inout NativeMask) -> Void) {
    guard let p = library.current else { return }
    library.objectWillChange.send()
    if p.history.isEmpty { p.checkpoint() }
    var masks = p.settings.masks
    if let i = masks.firstIndex(where: { $0.id == maskID }) { body(&masks[i]) }
    p.settings.masks = masks
  }
  private func editMask(_ body: (inout NativeMask) -> Void) {
    library.edit { a in
      var masks = a.masks
      if let i = masks.firstIndex(where: { $0.id == maskID }) { body(&masks[i]) }
      a.masks = masks
    }
  }
  private func maskSlider(_ title: String, _ key: String, _ range: ClosedRange<Double>) -> some View
  {
    let mask = library.current?.settings.masks.first { $0.id == maskID }
    func value(_ m: NativeMask?) -> Double {
      guard let m else { return 0 }
      switch key {
      case "opacity": return m.opacity
      case "feather": return m.feather
      case "radius": return m.radius
      case "exposure": return m.exposure
      case "contrast": return m.contrast
      case "saturation": return m.saturation
      default: return m.temperature
      }
    }
    return VStack {
      HStack {
        Text(title).font(.caption)
        Spacer()
        Text(String(format: "%.2f", value(mask))).font(.caption)
      }
      Slider(
        value: Binding(
          get: { value(library.current?.settings.masks.first { $0.id == maskID }) },
          set: { v in
            changeMask { m in
              switch key {
              case "opacity": m.opacity = v
              case "feather": m.feather = v
              case "radius": m.radius = v
              case "exposure": m.exposure = v
              case "contrast": m.contrast = v
              case "saturation": m.saturation = v
              default: m.temperature = v
              }
            }
          }), in: range,
        onEditingChanged: { editing in
          if !editing, let p = library.current {
            p.checkpoint()
            library.persist()
          }
        })
    }
  }
  private func maskPoints(_ points: [NativePoint]) {
    guard !points.isEmpty, let photo = library.current,
      let mask = photo.settings.masks.first(where: { $0.id == maskID })
    else { return }
    if mask.kind == "subject" && maskTool == "ai" {
      guard mask.points.count < 32 else {
        library.message = "선택 지점은 최대 32개입니다."
        return
      }
      guard #available(iOS 17.0, *) else {
        library.message = "피사체 선택은 iOS 17 이상에서 지원합니다."
        return
      }
      library.busy = true
      let url = library.url(photo)
      let id = photo.id
      let mid = mask.id
      let selected = mask.points + points.map { NativePoint(x: $0.x, y: $0.y, exclude: aiExclude) }
      library.work.async {
        do {
          let source = try NativeRenderEngine.shared.source(url)
          let scale = min(1, 1024 / max(source.image.extent.width, source.image.extent.height))
          let image = source.image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
          guard
            let cg = NativeRenderEngine.shared.p3.createCGImage(
              image, from: image.extent, format: .RGBA8,
              colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
          else { throw NativeImageError.invalid("선택 이미지 생성 실패") }
          let result = try NativeSubjectSelector.select(
            image: cg,
            points: selected.map {
              NativeMaskPoint(x: $0.x, y: $0.y, exclude: $0.exclude ?? false)
            }, request: VNGenerateForegroundInstanceMaskRequest())
          DispatchQueue.main.async {
            if library.current?.id == id {
              library.edit { a in
                var masks = a.masks
                if let i = masks.firstIndex(where: { $0.id == mid }) {
                  masks[i].points = selected
                  masks[i].raster = NativeRaster(
                    width: result.width, height: result.height,
                    data: result.data.base64EncodedString())
                }
                a.masks = masks
              }
            }
            library.busy = false
          }
        } catch {
          DispatchQueue.main.async {
            library.busy = false
            library.message = error.localizedDescription
          }
        }
      }
    } else {
      editMask { m in
        if m.kind == "subject" {
          if m.strokes == nil { m.strokes = [] }
          let count = m.strokes?.reduce(0, { $0 + $1.points.count }) ?? 0
          if (m.strokes?.count ?? 0) < 128, count < 4096 {
            m.strokes?.append(
              NativeStroke(
                points: Array(points.prefix(4096 - count)), radius: m.radius, feather: m.feather,
                erase: maskTool == "erase"))
          }
        } else if m.kind == "brush" {
          var ps = points
          ps[0].start = true
          m.points.append(contentsOf: ps.prefix(max(0, 1024 - m.points.count)))
        } else {
          m.points = [points.first!, points.last!]
        }
      }
    }
  }
  private var information: some View {
    VStack(alignment: .leading, spacing: 12) {
      if let photo = library.current {
        Text(photo.name).bold()
        Text("\(photo.width) × \(photo.height)")
        HStack {
          ForEach(1...5, id: \.self) { n in
            Button {
              library.objectWillChange.send()
              photo.rating = photo.rating == n ? 0 : n
              library.persist()
            } label: {
              Image(systemName: photo.rating >= n ? "star.fill" : "star")
            }
          }
        }
        if let source = CGImageSourceCreateWithURL(library.url(photo) as CFURL, nil),
          let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any]
        {
          ForEach(
            [
              kCGImagePropertyTIFFDictionary as String, kCGImagePropertyExifDictionary as String,
              kCGImagePropertyGPSDictionary as String,
            ],
            id: \.self
          ) { key in
            if let dict = props[key] as? [String: Any] {
              ForEach(dict.keys.sorted(), id: \.self) { k in
                HStack {
                  Text(k).font(.caption)
                  Spacer()
                  Text(String(describing: dict[k]!)).font(.caption).lineLimit(2)
                }
              }
            }
          }
        }
        Button("RAW 원본 다시 현상") { library.redevelop(photo) }.disabled(photo.rawFile == nil)
      }
    }
  }
  private var exportSheet: some View {
    NavigationView {
      Form {
        Picker("파일 형식", selection: $exportFormat) {
          Text("JPEG").tag("jpeg")
          Text("PNG · 8비트").tag("png")
          Text("PNG · 16비트").tag("png16")
          Text("PNG · 16비트 HDR PQ").tag("hdr-png")
          Text("WebP").tag("webp")
        }
        if exportFormat == "hdr-png" {
          HStack {
            Text("출력 색공간")
            Spacer()
            Text("Rec.2020 / PQ · HDR").foregroundStyle(.secondary)
          }
        } else {
          Picker("출력 색공간", selection: $exportSpace) {
            Text("sRGB").tag("srgb")
            Text("Display P3").tag("display-p3")
          }
        }
        Picker("이미지 크기", selection: $exportSize) {
          Text("원본 해상도").tag(0.0)
          Text("긴 변 4096px").tag(4096.0)
          Text("긴 변 2048px").tag(2048.0)
        }
        if exportFormat == "jpeg" || exportFormat == "webp" {
          HStack {
            Text("품질")
            Spacer()
            Text("\(Int(quality*100))%")
          }
          Slider(value: $quality, in: 0.1...1) { Text("품질") }
        }
        Toggle("EXIF 메타데이터 보존", isOn: $preserve)
        Button("이미지 저장·공유") { exportImage() }
      }.navigationTitle("내보내기").toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("닫기") { exporting = false } }
      }
    }
  }
  private func saveProject() {
    guard !library.busy else { return }
    library.busy = true
    library.work.async {
      do {
        let url = try library.writeProject()
        DispatchQueue.main.async {
          library.busy = false
          sharing = url
        }
      } catch {
        DispatchQueue.main.async {
          library.busy = false
          library.message = error.localizedDescription
        }
      }
    }
  }
  private func exportImage() {
    guard let photo = library.current, !library.busy else { return }
    exporting = false
    library.busy = true
    let format = exportFormat
    let space = exportSpace
    let size = exportSize
    let q = quality
    let exif = preserve
    let url = library.url(photo)
    library.work.async {
      do {
        let result = try NativeRenderEngine.shared.export(
          photo, url: url, format: format, space: space, maxSide: size == 0 ? .infinity : size,
          quality: q, preserve: exif)
        DispatchQueue.main.async {
          library.busy = false
          sharing = result
        }
      } catch {
        DispatchQueue.main.async {
          library.busy = false
          library.message = error.localizedDescription
        }
      }
    }
  }
}
struct SharedFile: Identifiable {
  let url: URL
  var id: String { url.absoluteString }
}
struct ActivitySheet: UIViewControllerRepresentable {
  let url: URL
  func makeUIViewController(context: Context) -> UIActivityViewController {
    UIActivityViewController(activityItems: [url], applicationActivities: nil)
  }
  func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}
struct NativeDocumentPicker: UIViewControllerRepresentable {
  var project: Bool
  var done: ([URL]) -> Void
  func makeCoordinator() -> Coordinator { Coordinator(done: done) }
  func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
    let vc = UIDocumentPickerViewController(
      forOpeningContentTypes: project ? [.data] : [.image, .rawImage], asCopy: false)
    vc.allowsMultipleSelection = !project
    vc.delegate = context.coordinator
    return vc
  }
  func updateUIViewController(_ vc: UIDocumentPickerViewController, context: Context) {}
  class Coordinator: NSObject, UIDocumentPickerDelegate {
    let done: ([URL]) -> Void
    init(done: @escaping ([URL]) -> Void) { self.done = done }
    func documentPicker(
      _ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]
    ) { done(urls) }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { done([]) }
  }
}
struct PhotoLibraryPicker: UIViewControllerRepresentable {
  var done: ([URL]) -> Void
  func makeCoordinator() -> Coordinator { Coordinator(done: done) }
  func makeUIViewController(context: Context) -> PHPickerViewController {
    var config = PHPickerConfiguration()
    config.filter = .images
    config.selectionLimit = 20
    config.preferredAssetRepresentationMode = .current
    let vc = PHPickerViewController(configuration: config)
    vc.delegate = context.coordinator
    return vc
  }
  func updateUIViewController(_ vc: PHPickerViewController, context: Context) {}
  class Coordinator: NSObject, PHPickerViewControllerDelegate {
    let done: ([URL]) -> Void
    init(done: @escaping ([URL]) -> Void) { self.done = done }
    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
      let group = DispatchGroup()
      let lock = NSLock()
      var urls: [Int: URL] = [:]
      for (i, result) in results.enumerated() {
        let provider = result.itemProvider
        let types = provider.registeredTypeIdentifiers.filter {
          UTType($0)?.conforms(to: .image) == true
        }
        guard
          let type = types.first(where: { UTType($0)?.conforms(to: .rawImage) == true })
            ?? types.first
        else { continue }
        group.enter()
        provider.loadFileRepresentation(forTypeIdentifier: type) { url, _ in
          defer { group.leave() }
          guard let url else { return }
          let directory = FileManager.default.temporaryDirectory.appendingPathComponent(
            UUID().uuidString)
          do {
            try FileManager.default.createDirectory(
              at: directory, withIntermediateDirectories: true)
            let copy = directory.appendingPathComponent(
              (provider.suggestedName ?? "Photo") + "." + url.pathExtension)
            try FileManager.default.copyItem(at: url, to: copy)
            lock.lock()
            urls[i] = copy
            lock.unlock()
          } catch {}
        }
      }
      group.notify(queue: .main) { self.done(urls.keys.sorted().compactMap { urls[$0] }) }
    }
  }
}
struct NativeThumbnail: View {
  let url: URL
  @State private var image: UIImage?
  @State private var visible = false
  var body: some View {
    Group {
      if let image {
        Image(uiImage: image).resizable().scaledToFill()
      } else {
        Color.gray.opacity(0.2)
      }
    }.onAppear {
      visible = true
      DispatchQueue.global(qos: .utility).async {
        if let source = CGImageSourceCreateWithURL(
          url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
          let cg = CGImageSourceCreateThumbnailAtIndex(
            source, 0,
            [
              kCGImageSourceCreateThumbnailFromImageAlways: true,
              kCGImageSourceThumbnailMaxPixelSize: 400,
              kCGImageSourceCreateThumbnailWithTransform: true,
            ] as CFDictionary)
        {
          DispatchQueue.main.async { if visible { image = UIImage(cgImage: cg) } }
        }
      }
    }.onDisappear {
      visible = false
      image = nil
    }
  }
}

struct NativeTabLabels: LabelStyle {
  func makeBody(configuration: Configuration) -> some View {
    VStack(spacing: 4) {
      configuration.icon
      configuration.title.font(.caption2)
    }.frame(maxWidth: .infinity)
  }
}
struct NativeHistogramView: View {
  let bins: [[Int]]
  var body: some View {
    Canvas { context, size in
      let peak = Double(bins.flatMap { $0 }.max() ?? 1)
      for (channel, color) in [Color.red, .green, .blue].enumerated() where channel < bins.count {
        var path = Path()
        path.move(to: CGPoint(x: 0, y: size.height))
        for (index, value) in bins[channel].enumerated() {
          path.addLine(
            to: CGPoint(
              x: Double(index) * size.width / 63,
              y: size.height * (1 - Double(value) / max(1, peak))))
        }
        path.addLine(to: CGPoint(x: size.width, y: size.height))
        path.closeSubpath()
        context.fill(path, with: .color(color.opacity(0.35)))
      }
    }
  }
}
