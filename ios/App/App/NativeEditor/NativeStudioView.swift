import CoreImage
import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers
import Vision

struct NativeStudioView: View {
  @ObservedObject var library: NativeLibrary
  @State private var section = "편집"
  @State private var panel = "편집"
  @State private var query = ""
  @State private var stars = false
  @State private var sourceMenu = false
  @State private var picker: ImportRoute?
  private enum ImportRoute: String, Identifiable {
    case photos, images, project
    var id: String { rawValue }
  }
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
              controls(wide: true).frame(width: 340)
            }
          } else {
            preview(photo).frame(maxHeight: geometry.size.height * 0.47)
            controls(wide: false)
          }
        } else {
          Spacer()
          Image(systemName: "photo.on.rectangle.angled").font(.system(size: 42)).foregroundStyle(
            accent)
          Text("사진을 추가해 편집을 시작하세요.").padding()
          Button("사진 추가") { sourceMenu = true }
          Spacer()
        }
        bottomNavigation
      }.background(Color(red: 0.075, green: 0.085, blue: 0.09)).tint(accent).preferredColorScheme(
        .dark)
    }
    .buttonStyle(StudioOutlineButtonStyle())
    .toggleStyle(StudioCheckboxStyle())
    .blur(radius: about || exporting ? 5 : 0)
    .overlay { if about { aboutDialog } }
    .overlay {
      if exporting {
        ZStack {
          Color.black.opacity(0.6).ignoresSafeArea().onTapGesture { exporting = false }
          exportSheet.frame(maxWidth: 440, maxHeight: 660).padding(12)
        }
      }
    }
    .sheet(item: Binding(get: { sharing.map { SharedFile(url: $0) } }, set: { sharing = $0?.url }))
    { ActivitySheet(url: $0.url) }
    .overlay {
      if sourceMenu {
        ZStack {
          Color.black.opacity(0.6).ignoresSafeArea().onTapGesture { sourceMenu = false }
          VStack(spacing: 18) {
            Text("사진 추가").font(.headline)
            Button("사진 보관함에서 선택") {
              sourceMenu = false
              picker = .photos
            }
            Button("파일에서 선택") {
              sourceMenu = false
              picker = .images
            }
            Button("취소") { sourceMenu = false }
          }.buttonStyle(StudioOutlineButtonStyle()).tint(accent).padding(28).background(
            Color(red: 0.12, green: 0.14, blue: 0.13)
          )
          .clipShape(RoundedRectangle(cornerRadius: 12))
        }
      }
    }
    .sheet(item: $picker) { route in
      if route == .photos {
        PhotoLibraryPicker { urls in
          picker = nil
          library.importFiles(urls)
          section = "편집"
        }
      } else {
        NativeDocumentPicker(project: route == .project) { urls in
          picker = nil
          if route == .project, let url = urls.first {
            library.importProject(url) { section = "편집" }
          } else {
            library.importFiles(urls)
            section = "편집"
          }
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
        picker = .project
      } label: {
        Image(systemName: "folder").frame(width: 38, height: 38).overlay(
          RoundedRectangle(cornerRadius: 5).stroke(Color.white.opacity(0.18)))
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
          exportFormat = p.settings.hdr ? "heif" : "jpeg"
          exporting = true
        }
      } label: {
        Image(systemName: "arrow.down.to.line").foregroundStyle(accent).frame(width: 38, height: 38)
          .background(accent.opacity(0.035)).overlay(
            RoundedRectangle(cornerRadius: 5).stroke(accent.opacity(0.55)))
      }.accessibilityLabel("내보내기").disabled(library.current == nil)
    }.buttonStyle(StudioIconButtonStyle()).foregroundStyle(Color(white: 0.72)).font(
      .system(size: 20)
    ).padding(.horizontal, 12).frame(height: 60)
      .background(Color.white.opacity(0.035))
  }
  private func preview(_ photo: NativePhoto) -> some View {
    VStack(spacing: 0) {
      HStack {
        VStack(alignment: .leading) {
          Text(URL(fileURLWithPath: photo.name).deletingPathExtension().lastPathComponent).font(
            .subheadline
          ).lineLimit(1)
          Text(
            "\(URL(fileURLWithPath: photo.name).pathExtension.uppercased())   ·   \(photo.width) × \(photo.height)   ·   비파괴 편집"
          ).font(.caption2).foregroundStyle(
            .secondary)
        }
        Spacer()
        Text(isEdited(photo) ? "보정됨  •" : "원본").font(.caption).foregroundStyle(accent).padding(
          .horizontal, 10
        ).padding(.vertical, 7).overlay(
          RoundedRectangle(cornerRadius: 4).stroke(accent.opacity(0.22)))
      }.padding(.horizontal, 12).padding(.vertical, 6)
      NativeCanvas(
        library: library, compare: compare, proofSDR: proof, maskID: panel == "마스크" ? maskID : "",
        maskTool: maskTool, overlay: overlay, zoomRequest: zoomRequest, zoomRevision: zoomRevision,
        onZoom: { zoomLabel = $0 }, onHistogram: { histogram = $0 }, onPoints: maskPoints)
      HStack(spacing: 1) {
        Menu {
          ForEach(["original", "1:1", "4:5", "3:2", "16:9"], id: \.self) { crop in
            Button(crop == "original" ? "원본 비율" : crop) {
              library.edit { $0.values["crop"] = crop }
            }
          }
        } label: {
          HStack(spacing: 4) {
            Image(systemName: "crop")
            Text("자르기").font(.system(size: 11))
          }
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
          Image(systemName: "arrow.left.arrow.right")
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
        Spacer(minLength: 0)
        Button {
          compare.toggle()
        } label: {
          HStack(spacing: 4) {
            Image(systemName: "arrow.left.arrow.right")
            Text("원본 비교").font(.system(size: 10))
          }
        }.accessibilityLabel("원본 비교").foregroundStyle(compare ? accent : Color(white: 0.55))
        Button {
          zoomRequest = 0
          zoomRevision += 1
        } label: {
          Image(systemName: "viewfinder")
        }.accessibilityLabel("사진 맞춤")
        Menu {
          ForEach([0.0, 10, 25, 50, 100, 200, 400], id: \.self) { value in
            Button(value == 0 ? "맞춤" : "\(Int(value))%") {
              zoomRequest = value
              zoomRevision += 1
            }
          }
        } label: {
          HStack(spacing: 4) {
            Text(zoomLabel).foregroundStyle(accent)
            Image(systemName: "chevron.down").font(.system(size: 9))
          }
        }
        Button {
          zoomRequest = min(400, (Double(zoomLabel.dropLast()) ?? 25) * 1.5)
          zoomRevision += 1
        } label: {
          Image(systemName: "plus.magnifyingglass")
        }.accessibilityLabel("사진 확대")
      }.buttonStyle(StudioIconButtonStyle()).foregroundStyle(Color(white: 0.58)).font(
        .system(size: 17)
      ).padding(.horizontal, 8).frame(height: 40).overlay(alignment: .bottom) { Divider() }
    }
  }
  private var bottomNavigation: some View {
    HStack(spacing: 0) {
      navigationItem("사진 추가", "plus", active: false) { sourceMenu = true }
      navigationItem("사진", "photo.on.rectangle", active: section == "사진") { section = "사진" }
      navigationItem("편집", "slider.horizontal.3", active: section == "편집" && panel != "프리셋") {
        section = "편집"
        panel = "편집"
      }
      navigationItem("프리셋", "paintpalette", active: section == "편집" && panel == "프리셋") {
        section = "편집"
        panel = "프리셋"
      }
    }.background(Color(white: 0.11)).overlay(alignment: .top) { Divider() }
  }
  private func navigationItem(
    _ title: String, _ icon: String, active: Bool, action: @escaping () -> Void
  ) -> some View {
    Button(action: action) {
      VStack(spacing: 6) {
        Image(systemName: icon).font(.system(size: 22))
        Text(title).font(.system(size: 11))
      }.frame(maxWidth: .infinity).frame(height: 62)
        .foregroundStyle(active ? accent : Color(white: 0.53))
        .background(active ? accent.opacity(0.055) : .clear)
    }.buttonStyle(.plain)
  }
  private func isEdited(_ photo: NativePhoto) -> Bool {
    let defaults = NativeSettings()
    return !photo.settings.masks.isEmpty || photo.settings.flip
      || photo.settings.string("crop") != "original"
      || [
        "exposure", "contrast", "highlights", "shadows", "whites", "blacks", "temperature", "tint",
        "vibrance", "saturation", "fade", "vignette", "skinSmooth", "skinRedness", "skinBrightness",
        "rotation", "hdrHighlights", "curveShadows", "curveMidtones", "curveHighlights",
      ].contains { photo.settings[$0] != defaults[$0] }
      || NativeSettings.bands.contains { band in
        ["hue", "saturation", "luminance"].contains { photo.settings["mixer_\(band)_\($0)"] != 0 }
      }
  }
  private var libraryGrid: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 18) {
        Text("YOUR PERSPECTIVE").font(.system(size: 9, weight: .semibold)).tracking(3)
          .foregroundStyle(accent)
        Text("순간을 모으다.").font(.system(size: 27, weight: .light))
        Text("사진을 선택하고 나만의 시선으로 완성해 보세요.").font(.system(size: 12)).foregroundStyle(.secondary)
        HStack {
          Image(systemName: "magnifyingglass")
          TextField("사진 검색", text: $query)
        }
        .font(.system(size: 13)).padding(12).overlay(
          RoundedRectangle(cornerRadius: 5).stroke(Color.white.opacity(0.15))
        ).padding(.vertical, 10)
        HStack {
          Text("사진을 길게 누르면 삭제할 수 있습니다.").font(.system(size: 11)).foregroundStyle(.secondary)
          Spacer()
          Button {
            stars.toggle()
          } label: {
            Image(systemName: stars ? "star.fill" : "star")
          }.buttonStyle(.plain).accessibilityLabel("별표 사진만")
        }
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 145))], spacing: 16) {
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
              VStack(alignment: .leading, spacing: 12) {
                NativeThumbnail(url: library.url(photo)).frame(height: 145).clipped().clipShape(
                  RoundedRectangle(cornerRadius: 3))
                Text(photo.name).lineLimit(1).font(.system(size: 12)).foregroundStyle(
                  Color(white: 0.8))
                Text("\(photo.width) × \(photo.height)").font(.system(size: 11)).foregroundStyle(
                  .secondary)
              }.padding(8).frame(maxWidth: .infinity, alignment: .leading).background(
                Color(white: 0.13)
              )
              .overlay(
                RoundedRectangle(cornerRadius: 5).stroke(
                  photo.id == library.selected ? accent : Color.white.opacity(0.15))
              )
              .clipShape(RoundedRectangle(cornerRadius: 5))
            }.buttonStyle(.plain).contextMenu {
              Button(role: .destructive) {
                removing = photo
              } label: {
                Label("라이브러리에서 삭제", systemImage: "trash")
              }
            }
          }
        }
      }.padding(12).padding(.top, 12)
    }
  }
  private func controls(wide: Bool) -> some View {
    VStack(spacing: 0) {
      if wide { NativeHistogramView(bins: histogram).frame(height: 60).padding(14) }
      if panel == "프리셋" {
        EmptyView()
      } else {
        HStack(spacing: 0) {
          ForEach(
            Array(
              zip(
                ["편집", "색상·톤", "마스크", "정보"],
                ["slider.horizontal.3", "paintpalette", "circle.inset.filled", "camera"])), id: \.0
          ) { title, icon in
            Button {
              panel = title
            } label: {
              HStack(spacing: 5) {
                Image(systemName: icon)
                Text(title)
              }
              .font(.system(size: 11)).frame(maxWidth: .infinity).frame(height: 44)
              .foregroundStyle(panel == title ? accent : Color(white: 0.53))
              .overlay(alignment: .bottom) {
                if panel == title {
                  Rectangle().fill(accent).frame(height: 2).padding(.horizontal, 12)
                }
              }
            }.buttonStyle(.plain)
          }
        }.overlay(alignment: .bottom) { Divider() }
      }
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

        }.padding(14)
      }
      if panel != "프리셋" {
        Divider()
        Button {
          library.edit { $0 = NativeSettings() }
        } label: {
          Label("모든 보정 초기화", systemImage: "arrow.counterclockwise").frame(maxWidth: .infinity)
        }.padding(.horizontal, 12).padding(.vertical, 7)
      }
    }.background(Color(white: 0.12))
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
      StudioSlider(
        value: Binding(
          get: { library.current?.settings[key] ?? 0 }, set: { library.update(key, $0) }),
        in: range,
        onEditingChanged: { editing in
          if !editing, let p = library.current {
            library.update(key, p.settings[key], commit: true)
          }
        }
      ).frame(height: 28).accessibilityLabel(title)
    }
  }
  private func selectionRow(
    _ title: String, _ selected: String, options: [(String, String)],
    action: @escaping (String) -> Void
  ) -> some View {
    HStack(spacing: 10) {
      Text(title).font(.system(size: 11)).foregroundStyle(accent.opacity(0.85)).frame(
        width: 76, alignment: .leading)
      Menu {
        ForEach(options, id: \.0) { key, label in Button(label) { action(key) } }
      } label: {
        HStack {
          Text(selected).font(.system(size: 13))
          Spacer()
          Image(systemName: "chevron.down").font(.system(size: 10))
        }
        .foregroundStyle(accent).padding(11).frame(maxWidth: .infinity).background(
          Color(red: 0.10, green: 0.12, blue: 0.10)
        )
        .overlay(RoundedRectangle(cornerRadius: 5).stroke(accent.opacity(0.22))).clipShape(
          RoundedRectangle(cornerRadius: 5))
      }.buttonStyle(.plain)
    }
  }
  private var colorSettings: some View {
    VStack(alignment: .leading, spacing: 9) {
      selectionRow(
        "편집 정밀도",
        library.current?.settings.string("precision") == "legacy" ? "기존 8비트" : "32비트 부동소수점",
        options: [("legacy", "기존 8비트"), ("float", "32비트 부동소수점")]
      ) { value in
        library.edit {
          $0.values["precision"] = value
          if value == "legacy" { $0.values["dynamicRange"] = "sdr" }
        }
      }
      selectionRow(
        "밝기 범위", library.current?.settings.hdr == true ? "HDR" : "SDR",
        options: [("sdr", "SDR"), ("hdr", "HDR")]
      ) { value in
        library.edit {
          $0.values["dynamicRange"] = value
          if value == "hdr" { $0.values["precision"] = "float" }
        }
      }
      if library.current?.settings.hdr == true {
        selectionRow(
          "HDR 최대 밝기", "\(Int(library.current?.settings["hdrPeak"] ?? 1000)) nit",
          options: [400, 1000, 2000, 4000].map { (String($0), "\($0) nit") }
        ) { value in library.edit { $0["hdrPeak"] = Double(value) ?? 1000 } }
        slider("HDR 밝은 영역 확장", "hdrHighlights", 0...100)
        Text("HDR 전환은 밝기를 자동으로 높이지 않습니다. SDR 사진의 밝은 영역을 확장하려면 이 값을 올리세요.").font(.system(size: 10))
          .foregroundStyle(.secondary)
        Toggle("SDR 밝기 변환 미리보기", isOn: $proof).font(.system(size: 11))
      }
      selectionRow(
        "작업 색공간",
        library.current?.settings.string("colorSpace") == "display-p3" ? "Display P3" : "sRGB",
        options: [("srgb", "sRGB"), ("display-p3", "Display P3")]
      ) { value in library.edit { $0.values["colorSpace"] = value } }
    }
  }
  private let presetNames = ["오리지널", "알파인", "골든 아워", "소프트 필름", "딥 포레스트", "모노크롬"]
  private let presetCaptions = [
    "있는 그대로의 순간", "맑고 선명한 공기", "따뜻하게 머무는 빛", "오래 간직한 기억처럼", "차분하고 깊은 색감", "빛과 그림자의 이야기",
  ]
  private var presetControls: some View {
    VStack(alignment: .leading, spacing: 14) {
      Button {
        sourceMenu = true
      } label: {
        Label("사진 추가", systemImage: "plus").frame(maxWidth: .infinity, alignment: .leading)
      }
      HStack {
        Text("크리에이티브 프리셋").font(.system(size: 11, weight: .semibold))
        Spacer()
        Text("6").font(.caption).foregroundStyle(.secondary)
      }.padding(.top, 10)
      Text("한 번의 터치로 새로운 분위기").font(.system(size: 10)).foregroundStyle(.secondary)
      LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
        ForEach(Array(presetNames.enumerated()), id: \.offset) { index, name in
          Button {
            applyPreset(name)
          } label: {
            HStack(spacing: 9) {
              Image("StudioSample").resizable().scaledToFill().frame(width: 36, height: 38)
                .clipped().saturation(index == 5 ? 0 : 1).colorMultiply(
                  index == 2 ? Color(red: 1, green: 0.85, blue: 0.65) : .white
                ).clipShape(RoundedRectangle(cornerRadius: 3))
              VStack(alignment: .leading, spacing: 5) {
                Text(name).font(.system(size: 11))
                Text(presetCaptions[index]).font(.system(size: 8)).foregroundStyle(.secondary)
                  .lineLimit(1)
              }
              Spacer(minLength: 0)
              Image(systemName: "chevron.right").font(.system(size: 9)).foregroundStyle(.secondary)
            }.padding(6).frame(maxWidth: .infinity, minHeight: 64).background(
              accent.opacity(selectedPreset == name ? 0.1 : 0)
            ).clipShape(RoundedRectangle(cornerRadius: 5))
          }.buttonStyle(.plain).accessibilityAddTraits(selectedPreset == name ? .isSelected : [])
        }
      }
    }
  }
  private var aboutDialog: some View {
    ZStack {
      Color.black.opacity(0.6).ignoresSafeArea().onTapGesture { about = false }
      VStack(spacing: 20) {
        HStack {
          Spacer()
          Button {
            about = false
          } label: {
            Image(systemName: "xmark")
          }.buttonStyle(.plain).foregroundStyle(.secondary)
        }
        Image("StudioLogo").resizable().frame(width: 86, height: 86).clipShape(
          RoundedRectangle(cornerRadius: 18))
        Text("HINANA STUDIO IMAGE").font(.system(size: 21, weight: .bold)).tracking(1)
          .minimumScaleFactor(0.65).lineLimit(1)
        Text("당신의 시선으로 빛과 색을 다듬는 사진 작업실").font(.system(size: 11)).foregroundStyle(.secondary)
        VStack(spacing: 0) {
          aboutRow("프로그램 명", "Hinana Studio Image")
          aboutRow("개발/제작자", "비나래")
          aboutRow(
            "버전",
            "Ver. \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "")")
        }.padding(.top, 12)
      }.padding(22).padding(.bottom, 4).frame(maxWidth: 440).background(
        Color(red: 0.12, green: 0.12, blue: 0.15)
      )
      .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.white.opacity(0.18))).clipShape(
        RoundedRectangle(cornerRadius: 12)
      ).padding(12)
    }
  }
  private func aboutRow(_ title: String, _ value: String) -> some View {
    VStack(spacing: 0) {
      Divider()
      HStack {
        Text(title).foregroundStyle(.secondary)
        Spacer()
        Text(value).fontWeight(.semibold)
      }.font(.system(size: 12)).padding(.vertical, 16)
    }
  }
  private var presetValues: [String: [String: Double]] {
    [
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
  }
  private var selectedPreset: String? {
    guard let settings = library.current?.settings else { return nil }
    let keys = NativeSettings.defaults.filter { key, value in
      value is NSNumber && !["hdrPeak", "rotation", "flip"].contains(key)
    }.keys
    return presetNames.first { name in
      keys.allSatisfy { key in
        let expected =
          presetValues[name]?[key] ?? (NativeSettings.defaults[key] as? NSNumber)?.doubleValue ?? 0
        return abs(settings[key] - expected) < 0.0001
      }
    }
  }
  private func applyPreset(_ name: String) {
    library.edit { a in
      let masks = a.masks
      let color = a.string("colorSpace")
      let hdr = a.string("dynamicRange")
      a = NativeSettings()
      a.masks = masks
      a.values["colorSpace"] = color
      a.values["dynamicRange"] = hdr
      a.values["precision"] = "float"
      for (key, value) in presetValues[name] ?? [:] { a[key] = value }
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
      StudioSlider(
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
  private var exifLabels: [String: String] {
    [
      "Make": "카메라 제조사", "Model": "카메라", "LensModel": "렌즈", "DateTimeOriginal": "촬영 일시",
      "DateTimeDigitized": "디지털화 일시", "ExposureTime": "노출 시간", "FNumber": "조리개",
      "ISOSpeedRatings": "ISO", "FocalLength": "초점 거리", "ExposureBiasValue": "노출 보정",
      "Software": "소프트웨어", "Artist": "작가", "Copyright": "저작권", "Latitude": "위도", "Longitude": "경도",
      "Altitude": "고도", "PixelXDimension": "가로 픽셀", "PixelYDimension": "세로 픽셀", "ColorSpace": "색공간",
      "Orientation": "방향",
    ]
  }
  private var information: some View {
    VStack(alignment: .leading, spacing: 12) {
      if let photo = library.current {
        Text("\(photo.width) × \(photo.height) px").font(.system(size: 12))
        Divider()
        Text("EXIF 촬영 정보").font(.system(size: 12, weight: .semibold)).foregroundStyle(accent)
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
                VStack(alignment: .leading, spacing: 10) {
                  Text(exifLabels[k] ?? k).font(.system(size: 10)).foregroundStyle(.secondary)
                  Text(String(describing: dict[k]!)).font(.system(size: 12)).lineLimit(3)
                  Divider()
                }.padding(.vertical, 6)
              }
            }
          }
        }
        Button("RAW 원본 다시 현상") { library.redevelop(photo) }.disabled(photo.rawFile == nil)
      }
    }
  }
  private var exportSheet: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 18) {
        HStack {
          Image(systemName: "arrow.down.to.line").font(.system(size: 24)).foregroundStyle(accent)
          Spacer()
          Button {
            exporting = false
          } label: {
            Image(systemName: "xmark")
          }.buttonStyle(.plain)
        }
        Text("THE FINISHING TOUCH").font(.system(size: 9)).tracking(3).foregroundStyle(accent)
          .padding(.top, 10)
        Text("당신의 순간을 내보내세요.").font(.system(size: 23, weight: .light))
        Text("보정이 적용된 새로운 이미지로 저장합니다.").font(.system(size: 11)).foregroundStyle(.secondary)
        selectionRow(
          "파일 형식", exportFormats.first { $0.0 == exportFormat }?.1 ?? "JPEG", options: exportFormats
        ) { exportFormat = $0 }
        if exportFormat == "hdr-png" {
          Text("출력 색공간   Rec.2020 / PQ · HDR").font(.system(size: 12)).foregroundStyle(accent)
        } else {
          selectionRow(
            "출력 색공간", exportSpace == "display-p3" ? "Display P3" : "sRGB",
            options: [("srgb", "sRGB"), ("display-p3", "Display P3")]
          ) { exportSpace = $0 }
        }
        selectionRow(
          "이미지 크기", exportSize == 0 ? "원본 해상도" : "긴 변 \(Int(exportSize))px",
          options: [("0", "원본 해상도"), ("4096", "긴 변 4096px"), ("2048", "긴 변 2048px")]
        ) { exportSize = Double($0) ?? 0 }
        if exportFormat == "jpeg" || exportFormat == "heif" || exportFormat == "webp" {
          HStack {
            Text("압축 품질")
            Spacer()
            Text("\(Int(quality*100))%")
          }.font(.system(size: 11))
          StudioSlider(value: $quality, in: 0.1...1, onEditingChanged: { _ in }).frame(height: 28)
        }
        Text(
          exportFormat.contains("png")
            ? "PNG는 무손실 형식이라 고해상도·16비트 사진의 용량이 큽니다. 작은 HDR 파일은 HEIF 또는 JPEG를 선택하세요."
            : "HDR 편집 시 밝기 정보를 게인 맵으로 함께 저장합니다. SDR 뷰어에서도 열 수 있습니다."
        ).font(.system(size: 10)).foregroundStyle(.secondary)
        Toggle("EXIF 메타데이터 보존", isOn: $preserve).font(.system(size: 12))
        Text("촬영 정보·GPS 등 원본 EXIF 유지 · 방향과 크기는 보정 결과에 맞게 갱신").font(.system(size: 10))
          .foregroundStyle(.secondary).padding(12).background(Color.black.opacity(0.12)).clipShape(
            RoundedRectangle(cornerRadius: 5))
        Button {
          exportImage()
        } label: {
          Label("이미지 저장·공유", systemImage: "arrow.down.to.line").font(
            .system(size: 13, weight: .semibold)
          ).frame(maxWidth: .infinity).padding(13).background(accent).foregroundStyle(
            Color(white: 0.15)
          ).clipShape(RoundedRectangle(cornerRadius: 5))
        }.buttonStyle(.plain)
      }.padding(22)
    }.background(Color(red: 0.12, green: 0.14, blue: 0.13)).clipShape(
      RoundedRectangle(cornerRadius: 12)
    ).overlay(RoundedRectangle(cornerRadius: 12).stroke(accent.opacity(0.2)))
  }
  private var exportFormats: [(String, String)] {
    [
      ("heif", "HEIF · HDR 유지 / 작은 용량"), ("jpeg", "JPEG · HDR 유지"), ("png", "PNG · 8비트 SDR"),
      ("png16", "PNG · 16비트 SDR"),
      ("hdr-png", "PNG · 16비트 HDR PQ"), ("webp", "WebP"),
    ]
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
            ?? types.first(where: {
              $0 == UTType.heic.identifier || $0 == UTType.heif.identifier
            }) ?? types.first
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

private struct StudioIconButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.frame(minWidth: 34, minHeight: 42)
      .background(configuration.isPressed ? Color.white.opacity(0.06) : .clear)
      .clipShape(RoundedRectangle(cornerRadius: 5))
  }
}
private struct StudioOutlineButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.font(.system(size: 13)).padding(.horizontal, 12).padding(.vertical, 10)
      .frame(minHeight: 40).background(Color.white.opacity(configuration.isPressed ? 0.07 : 0.015))
      .overlay(RoundedRectangle(cornerRadius: 5).stroke(Color.white.opacity(0.15), lineWidth: 1))
      .clipShape(RoundedRectangle(cornerRadius: 5))
  }
}
private struct StudioSlider: UIViewRepresentable {
  @Binding var value: Double
  let range: ClosedRange<Double>
  let onEditingChanged: (Bool) -> Void
  init(
    value: Binding<Double>, in range: ClosedRange<Double>,
    onEditingChanged: @escaping (Bool) -> Void
  ) {
    self._value = value
    self.range = range
    self.onEditingChanged = onEditingChanged
  }
  func makeCoordinator() -> Coordinator { Coordinator(self) }
  func makeUIView(context: Context) -> UISlider {
    let slider = StudioThinSlider()
    slider.minimumTrackTintColor = UIColor(white: 0.52, alpha: 1)
    slider.maximumTrackTintColor = UIColor(white: 0.27, alpha: 1)
    let thumb = UIGraphicsImageRenderer(size: CGSize(width: 16, height: 16)).image { ctx in
      UIColor(white: 0.7, alpha: 1).setStroke()
      ctx.cgContext.setLineWidth(2)
      ctx.cgContext.strokeEllipse(in: CGRect(x: 2, y: 2, width: 12, height: 12))
      UIColor(white: 0.13, alpha: 1).setFill()
      ctx.cgContext.fillEllipse(in: CGRect(x: 4, y: 4, width: 8, height: 8))
    }
    slider.setThumbImage(thumb, for: .normal)
    slider.addTarget(
      context.coordinator, action: #selector(Coordinator.changed(_:)), for: .valueChanged)
    slider.addTarget(context.coordinator, action: #selector(Coordinator.begin), for: .touchDown)
    slider.addTarget(
      context.coordinator, action: #selector(Coordinator.end),
      for: [.touchUpInside, .touchUpOutside, .touchCancel])
    return slider
  }
  func updateUIView(_ slider: UISlider, context: Context) {
    context.coordinator.parent = self
    slider.minimumValue = Float(range.lowerBound)
    slider.maximumValue = Float(range.upperBound)
    if !slider.isTracking { slider.value = Float(value) }
  }
  final class Coordinator: NSObject {
    var parent: StudioSlider
    init(_ parent: StudioSlider) { self.parent = parent }
    @objc func changed(_ slider: UISlider) { parent.value = Double(slider.value) }
    @objc func begin() { parent.onEditingChanged(true) }
    @objc func end() { parent.onEditingChanged(false) }
  }
}

private final class StudioThinSlider: UISlider {
  override func trackRect(forBounds bounds: CGRect) -> CGRect {
    let rect = super.trackRect(forBounds: bounds)
    return CGRect(x: rect.minX, y: rect.midY - 1, width: rect.width, height: 2)
  }
}

private struct StudioCheckboxStyle: ToggleStyle {
  func makeBody(configuration: Configuration) -> some View {
    Button {
      configuration.isOn.toggle()
    } label: {
      HStack(spacing: 9) {
        Image(systemName: configuration.isOn ? "checkmark.square.fill" : "square").foregroundStyle(
          configuration.isOn ? Color(red: 0.81, green: 0.87, blue: 0.7) : Color(white: 0.5))
        configuration.label.foregroundStyle(Color(white: 0.7))
        Spacer(minLength: 0)
      }.frame(minHeight: 32)
    }.buttonStyle(.plain).accessibilityValue(configuration.isOn ? "켜짐" : "꺼짐")
  }
}
