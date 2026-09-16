# Hinana Studio Image 설계

## 목표

기존 Hinana Studio의 데스크톱 기술 구성을 유지하면서, 사진 한 장을 불러와 보정하고 원본과 비교한 뒤 파일로 저장하는 전체 흐름을 완성한다. 사진 원본은 수정하지 않고 편집 매개변수만 변경한다.

## 구성

```text
electron/main.ts       창, 앱 생명 주기, 메뉴, 내비게이션 제한
electron/preload.ts    허용된 메뉴 명령만 renderer에 전달하는 bridge
src/App.tsx            라이브러리, 편집 화면, 프로젝트 및 내보내기 UI
src/engine.ts          순수 픽셀 보정, 기하 변환, 히스토그램, 이미지 입출력
src/metadata.ts        EXIF 추출 및 exifr 기반 표시 데이터 정규화
src/exif-export.ts     JPEG/PNG/WebP EXIF 컨테이너, 방향/치수 갱신
src/app-info.ts        package.json 기반 버전과 앱 정보
src/retouch.ts         피부색 소프트 선택, 윤곽 유지 평활화, 붉은 기/밝기 보정
src/storage.ts         프로젝트 스키마 검증과 IndexedDB 영속화
src/styles.css         다크 테마, 3열 작업 화면, 필름 스트립
public/samples/        네트워크 없이 사용할 수 있는 샘플 사진
```

Electron renderer는 `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`로 실행한다. 사진 처리 자체는 브라우저 API로 구현하여 Electron과 웹 미리보기에서 공통으로 동작한다.

## 데이터와 실행 취소

`Photo`는 고유 ID, 파일명, 원본 data URL, 원본 치수, 별점, 보정값, 편집 이력, 이력 커서를 보유한다. `Adjustments`는 수치 보정값과 회전·반전·자르기 비율이다.

슬라이더를 움직이는 중에는 현재 보정값만 변경한다. 포인터를 놓거나 키 조작이 끝나면 하나의 이력으로 확정한다. 새 편집을 확정하면 커서 이후의 redo 이력은 삭제하고 최근 60개 상태를 유지한다. 프리셋/초기화/기하 변환도 동일한 방식으로 기록한다. 별점과 사진 추가/제거는 보정 이력에 포함하지 않는다.

## 렌더링

1. 원본 이미지를 디코딩하여 사진 ID 기준으로 캐시한다.
2. 회전 후 크기를 계산하고 지정 비율로 가운데를 자른다.
3. Canvas에 회전/반전을 적용한 원본을 그린다.
4. 원본 색상에서 피부색 선택과 피부 보정을 적용한 뒤, 픽셀 배열에 노출 → 명암 영역 보정 → 대비/화이트밸런스 → 채도/생동감 → 페이드/비네팅 순서로 적용한다.
5. 미리보기 Canvas에 기록하고 RGB 히스토그램을 계산한다.

`renderPhoto`는 미리보기와 내보내기의 공통 진입점이다. 맞춤 미리보기는 긴 변 1600px로 제한하고 내보내기는 원본 또는 사용자가 지정한 최대 크기를 사용한다. 원본 비교는 기하 변환을 유지한 채 색상 보정값만 기본값으로 대체한다.

현재 CPU/8비트 Canvas 구현은 구조를 이해하기 쉽고 환경 의존성이 낮다. 대형 사진에서 메인 스레드가 잠시 멈출 수 있으므로 후속 버전에서는 아래 작업을 우선한다.

## 저장

- 자동 저장: 변경 후 650ms 지연하여 전체 작업 공간을 IndexedDB에 저장한다. 트랜잭션 완료 후에만 저장 완료로 표시한다.
- 프로젝트 파일: 버전 1 JSON에 원본 data URL과 보정값을 함께 포함한다. 경로 의존성이 없어 다른 작업 공간으로 옮길 수 있다.
- 열기: 버전, 사진 수, ID 중복, 이미지 MIME, 숫자 타입/범위, 자르기 비율, 회전값을 검증하고 실제 이미지 디코딩을 확인한다.
- 내보내기: 별도 Canvas에 보정 결과를 만들고 지정 MIME/품질의 Blob을 저장한다. 기본적으로 원본 EXIF를 포함하며 사용자 선택으로 제외할 수 있다.

JSON과 data URL은 구현이 단순하지만 원본 바이너리보다 약 33% 크다. 큰 라이브러리용 영구 카탈로그 형식은 아니다. 사진 제거/프로젝트 교체는 사용자 확인을 거친다. 가져온 원본 파일 자체를 삭제하거나 덮어쓰지 않는다.

## 다음 확장 우선순위

1. **렌더러 분리**: Web Worker + OffscreenCanvas 또는 WebGL/WebGPU, 최신 요청만 반영하는 취소 토큰, 원본 디코드 캐시 제한, 대형 이미지 타일 처리.
2. **컴포넌트/상태 분리**: 현재 통합된 App에서 Library, Develop, Filmstrip, AdjustmentPanel, ExportDialog 및 workspace reducer를 분리.
3. **저장 구조 개선**: 이미지 Blob과 메타데이터 분리, 사진별 증분 저장, SQLite/파일 카탈로그, 버전 마이그레이션, 종료 전 저장 보장.
4. **사진 도구 확장**: 자유 크롭과 수평 보정, 채널별/자유 포인트 커브, 선명도/노이즈 제거, 부분 마스크, 편집값 복사/붙여넣기, 일괄 내보내기.
5. **전문 현상**: LibRaw 등 별도 디코더, 16비트/부동소수점 파이프라인, ICC 색상 관리, 카메라 프로파일, EXIF 보존.
6. **배포**: Apple 서명/공증, Windows 테스트, 자동 업데이트와 데이터 복원 정책.

## 검증 전략

순수 보정 함수에서는 기본값의 항등성, 노출 배수, 무채색, 색온도 방향, 회전/크롭 치수, 히스토그램 분포를 검사한다. Electron 통합 테스트는 독립된 임시 프로필을 사용하여 앱 UI를 조작하고 다운로드된 파일까지 확인한다. 사용자 작업 공간은 테스트에 사용하지 않는다.


## v0.2.0: EXIF와 피부 보정

EXIF는 원본 Blob/data URL에서 `exifr`로 읽는다. 촬영 관련 태그만 추출하고 GPS/MakerNote는 파싱하지 않는다. 필드는 길이를 제한한 문자열로 정규화하며 React 텍스트로 표시한다. EXIF 예외를 사진 불러오기 실패로 전파하지 않는다. 자동 복원/프로젝트 열기 때 원본을 다시 파싱하므로 v0.1.0 데이터에도 적용된다.

`skinSmooth`, `skinRedness`, `skinBrightness`는 0–100의 비파괴 보정값이다. YCbCr 색상 범위와 휘도의 smoothstep 가중치로 피부색 영역을 선택한다. 부드럽게 보정은 수평/수직 5탭 양방향 필터를 사용하며 원본 색상 차이로 윤곽을 보호한다. 필터 반경은 출력 이미지 크기에 비례하고 1–12px로 제한한다. 투명도는 변경하지 않는다. 붉은 기는 초과 빨강 성분을 완화하고 밝기는 선택 가중치에 따라 RGB를 올린다. 원본 비교에서는 이 값도 0으로 돌아간다.

이것은 색상 기반 휴리스틱이며 얼굴/인물 세그멘테이션이 아니다. 넓은 피부색 범위를 선택하지만 모든 피부색·조명에서 동일하게 동작한다고 보장하지 않는다. 대형 이미지의 피부 평활화는 메인 스레드와 추가 픽셀 버퍼를 사용한다. 후속 단계는 Worker 처리와 사용자가 선택 영역을 확인·수정할 수 있는 마스크 도구다.


## v0.3.0: EXIF 보존과 데스크톱 외관

`extractExif`는 JPEG APP1, PNG eXIf, WebP EXIF에서 TIFF를 추출한다. `normalizeExif`는 원본 TIFF 바이트/오프셋을 보존한 채 새 IFD0/Exif IFD를 끝에 추가한다. 알 수 없는 태그, GPS, MakerNote의 기존 오프셋은 바뀌지 않는다. Orientation=1, ImageWidth/Height, ExifImageWidth/Height, ColorSpace=sRGB를 설정하며 IFD1 썸네일 연결은 끊는다. MakerNote의 제조사별 내부 필드까지 다시 해석하거나 갱신하지 않는다.

새 Canvas 출력에 JPEG APP1 또는 PNG eXIf(길이와 CRC 포함), WebP EXIF(RIFF 길이, 패딩, VP8X EXIF/알파 플래그 포함)를 기록한다. 이미지 비트스트림은 재압축하지 않는다. EXIF가 없는 파일은 no-op이며 잘못된 EXIF와 JPEG APP1 크기 초과는 사용자에게 오류를 표시한다. 내보내기 체크박스를 해제하면 보존을 시도하지 않는다. XMP/IPTC/ICC는 별도 범위다.

참고 규격: [PNG eXIf](https://www.w3.org/TR/png-3/#11eXIf), [WebP RIFF](https://developers.google.com/speed/webp/docs/riff_container).

Electron은 hidden title bar와 다크 테마를 사용하며 macOS traffic lights 공간을 CSS에 확보한다. 헤더의 빈 공간만 draggable이고 버튼/메뉴는 클릭 가능하게 제외한다. 프로그램 정보는 package.json의 버전을 사용해 버전 표시가 패키지와 달라지지 않게 한다. 메인 프로세스 About 메뉴도 preload의 제한된 메시지 경로로 같은 모달을 연다. 아이콘 원본은 public/app-icon.png와 패키징용 HinanaStudioIcon.png다.


## v0.4.0: macOS RAW 현상

`native/RawDecoder.swift`를 Swift로 컴파일해 macOS 앱 extraResources에 포함한다. renderer는 preload의 `decodeRaw(File)`을 호출하고, preload는 Electron `webUtils.getPathForFile`로 사용자가 선택한 디스크 파일 경로를 얻는다. 메인 프로세스는 확장자/크기/일반 파일 여부를 검증하고 디코더를 shell 없이 별도 프로세스로 실행한다. 한 번에 하나의 RAW만 디코딩하고 120초 제한, 임시 폴더 정리, 오류 메시지 처리를 수행한다.

디코더는 [Apple CIRAWFilter](https://developer.apple.com/documentation/coreimage/cirawfilter)의 `nativeSize`를 확인한 뒤 `scaleFactor=1`, `isDraftModeEnabled=false`와 `outputImage`로 전체 해상도를 현상한다. `previewImage`나 ImageIO 썸네일은 사용하지 않는다. Core Image의 결과를 8비트 sRGB PNG로 만들고 ImageIO의 TIFF/EXIF/GPS 사전을 전달한다. 기존 Canvas 파이프라인은 이 PNG를 사용한다. 카메라 지원은 macOS RAW 엔진의 버전에 의존하며, 센서 선형 데이터에서의 실시간 재현상은 후속 범위다.

`Photo.src`는 현상된 PNG, 선택 필드 `Photo.rawSource`는 원본 RAW의 application/octet-stream data URL이다. 프로젝트와 자동 저장에 두 데이터를 포함하므로 원본 경로에 의존하지 않고 복원할 수 있다. 프로젝트 입력에서 RAW 원본 타입/길이/인코딩을 검사한다. RAW 원본의 제조사 메타데이터는 원본 바이트에 그대로 남지만 출력 PNG/JPEG의 메타데이터는 ImageIO가 인식한 항목으로 제한된다.

대용량 작업 공간은 IndexedDB 저장 완료 순서가 중요하므로 저장 요청을 직렬화한다. React 효과가 만료된 저장 요청은 UI 저장 완료 상태를 변경하지 않는다.


## v0.4.1: 프로젝트 열기

프로젝트 스키마 버전은 1로 유지하고 기본 저장 확장자만 `.hinanaimage`로 변경한다. 입력 선택기는 `.hinanaimage,.hinana`를 모두 허용한다. 상단 버튼, 네이티브 파일 메뉴, Cmd/Ctrl+Shift+O는 동일한 프로젝트 파일 선택기로 연결된다. 드래그 앤 드롭은 프로젝트 확장자를 먼저 분기하여 한 파일일 때 openProject로 전달한다. 파일 내용은 기존 validateProject 검증을 그대로 거친다. 프로젝트를 열면 이전 검색/필터를 해제하고 현상 화면으로 전환한다.


## v0.5.0: 색상 믹서와 톤 커브

오른쪽의 프리셋 UI를 제거하고 `ColorPanel.tsx`로 색상·톤 패널을 분리했다. `color-tools.ts`의 평면 숫자 필드를 Adjustments 기본값에 확장하여 기존 이력/검증/프로젝트 마이그레이션 경로를 사용한다.

HSL은 RGB를 HSL로 변환하고 원래 hue에 인접한 두 색상 앵커 사이를 smoothstep 가중치로 보간한다. red의 360° 경계를 원형으로 처리하며, 선택하지 않은 멀리 떨어진 색상과 무채색을 유지한다. 색조는 최대 ±30°, 채도는 상대 배율, 명도는 채도에 따른 가중 이동이다. 톤 커브는 고정 입력 위치 0, .25, .5, .75, 1에서 세 내부 출력값을 조절하는 piecewise-linear RGB lookup table이다. LUT를 256개 항목으로 만들어 각 채널에 적용한다. 둘 다 기본값이면 이 단계를 통과만 한다.

기존 피부/기본 색상/효과 처리 뒤 같은 픽셀 파이프라인에서 실행하므로 미리보기와 내보내기에 동일하게 적용된다. 전체 reset은 새 필드도 초기화하며, 섹션 reset은 해당 필드만 변경한다. 프리셋은 전체 색상 룩을 설정하므로 새 HSL/커브 값도 기본값으로 재설정한다.

기능 참고: [Adobe Lightroom Color Mixer](https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/color-mixer.html), [Adobe Lightroom 편집 도구](https://helpx.adobe.com/lightroom/desktop/edit-photos/edit-photos.html). Adobe의 처리 엔진을 재현한 것은 아니다.

## v0.6.0 Windows architecture

The renderer, IndexedDB workspace and `.hinanaimage` format are shared. Windows
uses Electron's titleBarOverlay with an explicit caption-button reservation;
its application menu is revealed with Alt and includes an About command.

RAW IPC validates an absolute path, extension and 120MB limit. macOS retains
Core Image by default. Windows/Linux launch a fresh Node Worker using the
bundled, pinned @colorhythm/libraw-wasm 1.1.1 binary. A worker opens the sensor
file, validates dimensions before unpacking, demosaics at full size with camera
white balance, converts to 8-bit sRGB, and encodes PNG. The main process enforces
a 120-second deadline, terminates the worker and removes temporary output.
`HINANA_RAW_ENGINE=wasm` permits testing the portable path on macOS.

Standard EXIF is rebuilt from exifr-readable tags with LibRaw fallback for
camera, lens, exposure, aperture, ISO and focal length. Readable local timestamp,
author/copyright and standard GPS are also carried across. RAW IFD pixel strips
and opaque MakerNote offsets cannot simply be embedded in the PNG and are not
copied. The original RAW remains byte-for-byte in the project. A reopened
project uses its stored PNG, keeping previous rendering consistent across OSes.

The mjs worker and WASM runtime are unpacked from ASAR; pure JS dependencies are
bundled by electron-builder. Runtime and LibRaw notices are included in
`dist/licenses`. Windows uses an x64 NSIS assisted per-user installer. The CI
workflow builds and tests the actual packaged EXE on windows-latest, downloads
a pinned/checksummed public RAW fixture, and retains build artifacts. No release
publishing step is configured.

## v0.7.0 Display P3 pipeline

`Adjustments.colorSpace` is `srgb | display-p3`. Defaults remain sRGB for old
projects/history; new imports use P3 when supported. Original image data URLs
retain their ICC, so Chromium converts from the source profile directly to the
selected working Canvas without an intermediate sRGB Canvas. Canvas contexts
cannot change colorSpace after creation, so the preview is remounted when its
space changes. Both getImageData and Canvas creation explicitly name the space.
P3 tone/saturation weights use the P3 D65 matrix's Y row. Skin-mask selection
converts P3 to sRGB coordinates but applies edits to the original P3 buffer.

Export renders in the working space first, then draws into a new Canvas in the
output space. JPEG/PNG/WebP encoders were verified to retain P3 pixels. `icc.ts`
embeds the matching bundled profile, replacing conflicting source declarations.
PNG uses iCCP/CRC/zlib; JPEG uses APP2 ICC_PROFILE; WebP uses ICCP and VP8X flags.
EXIF opt-out does not strip ICC. EXIF ColorSpace is 65535 for P3 and 1 for sRGB;
old Interop pointers and TIFF ICC entries are dropped to avoid contradicting the
output profile. EXIF sub-IFDs without next-IFD pointers are accepted.

Core Image renders to CGColorSpace.displayP3. LibRaw uses output_color=7, which
its source defines as DCI-P3 **D65** primaries, with gamm[0]=1/2.4 and
gamm[1]=12.92 (the sRGB/Display P3 transfer curve, not cinema gamma 2.6).
The worker embeds the bundled P3 ICC in its PNG. Profiles are unpacked alongside
the worker for packaged runtime access. Existing RAW sources can be reprocessed
via validated, size-limited IPC; only a temporary RAW file is written. Failure
keeps the previous photo. Successful redevelopment preserves edits/rating and
resets history because the backing image has changed.

References:
- https://www.w3.org/TR/css-color-4/#color-conversion-code
- https://github.com/LibRaw/LibRaw/blob/master/src/postprocessing/postprocessing_utils_dcrdefs.cpp
- https://github.com/LibRaw/LibRaw/blob/master/doc/API-datastruct.html
- https://github.com/saucecontrol/Compact-ICC-Profiles
