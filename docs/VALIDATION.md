# 검증 결과

2026-09-14, macOS Apple Silicon에서 확인했습니다.

- `npm run build`: React/TypeScript 및 Electron 메인/preload 빌드 통과
- `npm test`: 보정 엔진 테스트 6개 통과
- `node tests/smoke.mjs`: 개발 서버 없이 dist를 읽는 Electron 통합 테스트 통과
- `npm run pack:mac`: Apple Silicon용 `.app` 생성 완료
- `HINANA_TEST_APP=".../Hinana Studio Image.app/Contents/MacOS/Hinana Studio Image" node tests/smoke.mjs`: 패키징된 실제 앱에서 동일 통합 테스트 통과

통합 검증 항목:

1. 오프라인 샘플 불러오기와 실제 Canvas 렌더링
2. 프리셋 적용 전후 픽셀 변화
3. 실행 취소/다시 실행 후 픽셀 복원
4. macOS 네이티브 메뉴의 실행 취소/다시 실행 연결
5. 원본 비교 시 원본 픽셀 복원
6. 1:1 자르기와 비율 복원
7. 별점과 프로젝트 저장 데이터 일치
8. 이미지 다운로드 파일 생성
9. 원본 포함 프로젝트 파일 생성
10. 앱 새로고침 후 보정값 자동 복원
11. 라이브러리 검색과 결과 없음 상태
12. 보정 초기화 후 저장한 프로젝트를 열어 이전 보정값 복원
13. 두 번째 파일 불러오기 및 사진별 보정값 독립성
14. 100% 확대 시 원본 픽셀 크기 사용
15. 90도 회전 시 너비/높이 전환
16. 테스트 중 renderer 예외 없음

`docs/welcome.png`, `docs/editor.png`의 실제 앱 스크린샷도 확인했습니다. 자동 테스트는 임시 프로필을 생성하고 종료 후 정리하며 사용자 작업 공간을 건드리지 않습니다.

RAW 현상, 색상 정확도의 전문 계측, 60MP 경계 성능, Windows/Linux 실행, 코드 서명/공증은 검증 범위에 포함하지 않습니다.

## v0.2.0 추가 검증

- 보정 엔진, 피부색 선택/윤곽 유지/투명도 보존, EXIF 파싱을 포함한 단위 테스트 총 12개 통과.
- 실제 APP1/TIFF EXIF를 넣은 JPEG 픽스처로 카메라, 셔터 1/125s, f/2.8, ISO 400, 현지 촬영 시각을 검증.
- EXIF가 없는 이미지와 손상 데이터의 오류 격리를 검증.
- Electron UI에서 정보 탭 값 표시, 피부 슬라이더, 실행 취소/다시 실행, 프리셋 적용 시 피부 보정 유지, 자동 복원, 프로젝트 재열기를 검증.
- v0.1.0 형식의 새 필드가 없는 프로젝트를 열어 호환성 검증.
- 256px 테스트 이미지에서 실제 내보낸 PNG를 다시 디코딩한 결과와 피부 보정 Canvas의 픽셀 일치를 검증.
- `docs/exif.png`, `docs/skin-retouch.png` 화면을 확인.

피부 보정 품질 검증은 결정적인 합성 색상/텍스처 테스트를 사용했으며 다양한 실사 인물에 대한 정량 품질 평가는 포함하지 않습니다.

## v0.3.0 추가 검증

- 단위 테스트 총 18개 통과. JPEG APP1, PNG eXIf CRC, WebP RIFF/VP8X/패딩, TIFF 양쪽 바이트 순서, 원본 GPS/불투명 항목 오프셋 유지, 방향·치수 정규화 및 오류 처리를 포함합니다.
- 실제 Electron 앱에서 JPEG·PNG·WebP 내보내기 후 다시 불러와 촬영 정보를 확인했습니다. 자른 결과의 이미지 크기와 디코딩도 확인했습니다.
- EXIF 보존 체크 해제 후 내보낸 PNG에 카메라 정보가 제외되는지 확인했습니다.
- 프로그램 정보 버튼과 네이티브 About 메뉴 모두 같은 정보 창을 열며, 이름/Ver. 0.3.0/개발·제작자 비나래와 새 아이콘이 표시됩니다. Escape와 닫기 버튼을 검증했습니다.
- `docs/about.png`의 실제 화면을 확인했습니다. macOS용 패키지 생성 및 패키지 버전/아이콘 리소스를 확인했습니다.

## v0.4.0 추가 검증

- 상단 브랜드 이미지가 새 앱 아이콘을 읽는지 확인했습니다.
- 네이티브 RAW 디코더를 Swift로 빌드하고 macOS 패키지의 `Resources/raw/hinana-raw`에 실행 권한과 함께 포함했습니다.
- Nikon D3S NEF: 4256×2832 전체 해상도, ISO 3200, 카메라명 전달 확인.
- Canon EOS DIGITAL REBEL XTi CR2: 3888×2592 전체 해상도, ISO 100, 카메라명 전달 확인.
- RAW UI 테스트는 프로젝트의 rawSource 바이트를 원본 파일과 비교합니다. 프리셋 적용, 자동 저장 후 재시작 복원, 프로젝트 재열기, EXIF가 포함된 JPEG 내보내기 및 손상 RAW 오류 처리를 검증했습니다.
- 테스트에서 발견한 이전 저장 완료 표시의 경쟁 상태를 수정했습니다. UI가 현재 사진 배열/선택과 실제 저장 스냅샷이 일치할 때만 저장 완료로 표시합니다. IndexedDB 쓰기를 직렬화하고 만료된 요청의 완료 알림을 무시합니다.
- `docs/raw-import.png`에서 실제 RAW 현상 화면과 상단 아이콘을 확인했습니다.
- 단위 테스트 18개와 기존 기능 통합 테스트를 유지합니다. RAW 테스트 명령: `node tests/raw-smoke.mjs /absolute/path/to/photo.NEF`.

실제 RAW 테스트 자료: rawpy 공개 테스트 저장소의 `iss030e122639.NEF`, `M0054341_01_00005.cr2`. 테스트를 위해 임시 다운로드했으며 앱에는 배포하지 않습니다. 전체 카메라 모델, 60MP/120MB 한계 성능, Windows/Linux RAW 디코딩, 16비트 현상 파이프라인은 검증 범위 밖입니다.

## v0.4.1 추가 검증

패키징된 macOS 앱에서 상단 프로젝트 열기 버튼의 실제 파일 선택기를 통해 기존 `.hinana` 파일을 열었습니다. 새 `.hinanaimage` 저장 파일을 네이티브 파일 메뉴로 다시 열어 보정값을 확인했습니다. 프로젝트 드래그 앤 드롭 복원도 검증했습니다. 기존 사진/EXIF/피부 보정/내보내기 통합 테스트를 함께 통과했습니다.

## v0.5.0 추가 검증

- 단위 테스트 23개 통과. 새 HSL의 기본값 무변화, 색상 선택성, 빨강 경계 연속성, 무채색/알파 보존과 톤 커브의 기본값 및 끝점을 검증했습니다.
- 개발 실행과 패키징된 macOS 앱 모두 통합 테스트를 통과했습니다. 오른쪽 프리셋 제거, HSL·톤 커브 픽셀 변화, 실행 취소/다시 실행, 원본 비교, 프로젝트 재열기 및 자동 복원을 확인했습니다.
- 새 보정값을 적용해 내보낸 PNG를 다시 디코딩하고 미리보기 Canvas와 픽셀 일치를 확인했습니다. 기존 EXIF 및 피부 보정 테스트도 통과했으며 renderer 오류가 없었습니다.
- 새 필드가 없는 기존 프로젝트의 기본값 복원을 검증했습니다.
- `docs/color-mixer.png`, `docs/color-tools.png`에서 실제 색상 믹서와 톤 커브 화면을 확인했습니다. 탭 전환 시 스크롤을 맨 위로 초기화합니다.

톤 커브는 세 내부 제어점을 슬라이더로 조절하는 RGB 공통 곡선입니다. 자유 제어점 편집 및 채널별 곡선은 포함하지 않습니다. Adobe와의 픽셀 단위 결과 일치나 색상 정확도 계측은 검증 범위 밖입니다.

## v0.6.0 추가 검증

- 단위 테스트 25개 통과. Windows RAW 메타데이터를 PNG로 인코딩/디코딩한 뒤 카메라, 렌즈, 1/8000초 노출, ISO, 방향/치수와 촬영 현지 시각 및 GPS(해발 0 포함)를 검증했습니다.
- macOS에서 공통 UI 통합 테스트를 통과했습니다. 사진 보정, EXIF, 프로젝트, HSL/커브 기능 회귀가 없었습니다.
- Windows에서 사용할 LibRaw WASM 경로를 macOS 개발 실행과 패키징된 앱에서 각각 강제 선택해 NEF 전체 해상도 현상, 원본 RAW 바이트 보존, 프로젝트 복원, EXIF 포함 JPEG 내보내기, 손상 파일 오류 격리를 통과했습니다.
- Canon CR2도 공통 Worker를 통해 PNG 현상을 완료했습니다. 해당 공개 픽스처는 LibRaw가 데이터 손상 경고를 출력하므로 정상 카메라 파일 전체의 품질 보장 근거로 삼지 않습니다.
- Windows CSS를 적용한 상단바를 1000/1250/1540px에서 측정해 브랜드/탭/액션 사이 겹침이 없고 창 제어 버튼 공간이 확보됨을 확인했습니다. `docs/windows-layout.png`는 macOS에서 Windows CSS를 적용한 화면이며 실제 Windows 스크린샷이 아닙니다.
- Windows x64 NSIS 설치 파일 생성을 완료했습니다. macOS 앱도 v0.6.0으로 빌드했습니다.
- `.github/workflows/windows.yml`에 실제 Windows 패키지 UI/RAW/상단바 검증을 구성했습니다. 현재 로컬 환경은 macOS이며 이 워크플로를 원격으로 실행하지 않았습니다. Windows 설치/제거, 네이티브 창 버튼/DPI와 실제 Windows 실행 검증은 아직 남아 있습니다. Windows ARM64 네이티브 빌드와 Linux 배포도 이번 검증 범위에 포함하지 않습니다.

## v0.7.0 Display P3 검증

- 단위 테스트 30개 통과: 중립 P3 픽셀 보존, P3 기준 명도, P3→sRGB 색역 밖 판별, PNG ICC CRC/압축/교체, JPEG APP2와 WebP ICCP 중복 제거/플래그, EXIF 색공간 정규화를 포함합니다.
- 합성 P3 주황/초록 패치를 앱으로 불러와 sRGB 변환 없이 P3 픽셀이 유지되는지 확인했습니다. 색공간 전환/실행 취소, HSL 편집, sRGB 미리보기, 프로젝트 저장/재열기/자동 복원, 색공간 필드가 없는 이전 프로젝트의 sRGB 기본값을 검증했습니다.
- P3 JPEG/PNG/WebP를 내보내고 ICC 원문과 다시 디코딩한 P3 픽셀을 확인했습니다. PNG는 정확히 일치하고 손실 형식은 테스트 색상에서 채널 오차 5 이내였습니다. sRGB 출력은 픽셀이 실제로 변환되고 sRGB ICC가 포함됩니다. EXIF 해제 시에도 ICC가 유지됩니다.
- 기존 통합 테스트의 피부 보정 및 HSL 출력 PNG 픽셀 일치 검증을 같은 색공간의 Canvas에서 비교하도록 보완했습니다. 전체 기존 테스트가 통과했습니다.
- Nikon NEF를 macOS Core Image와 LibRaw WASM으로 각각 현상하고 PNG의 P3 ICC 원색 좌표를 확인했습니다. RAW 원본 보존, EXIF 포함 JPEG, 프로젝트 복원, 저장된 RAW에서 재현상 후 편집값 유지, 손상 RAW 오류 격리를 확인했습니다.
- 패키징된 macOS 앱에서도 P3 전용 UI 테스트와 Windows용 WASM RAW 경로의 현상/재현상 테스트를 통과했습니다. Windows x64 설치 파일도 빌드했습니다. Windows CI에 P3 UI 테스트를 추가했습니다.
- `docs/display-p3.png`에서 색상 관리와 HSL 도구 배치를 확인했습니다. 이 스크린샷은 색도 측정 자료가 아닙니다. 실제 모니터의 색 정확도 계측, HDR/16비트, 모든 카메라 모델 및 Windows 물리 디스플레이는 검증하지 않았습니다.

기존 Windows CI 실패 로그를 확인한 결과 빌드는 완료되었으나 electron-builder의 자동 Release 게시가 GH_TOKEN 부재로 실패했습니다. 모든 배포/패키징 스크립트에 `--publish never`를 명시해 요청하지 않은 게시를 막고 후속 실행 테스트로 진행하도록 수정했습니다.

### Windows 실제 실행 결과

코드 커밋 `701686c`의 [Windows CI 실행](https://github.com/murikubo/HinanaStudioImage/actions/runs/35089093313)이 전체 성공했습니다. Windows에서 단위 테스트 30개, NSIS 빌드, 패키징된 EXE의 기존 기능 통합 테스트, P3 편집/ICC 출력, 상단바 배치, 실제 NEF 현상/재현상/프로젝트/EXIF 테스트와 산출물 업로드를 완료했습니다. 설치 마법사 수동 완주 및 물리 디스플레이 색도 측정은 이 자동 실행에 포함되지 않습니다.

## v0.8.0 HDR / 고정밀 검증

- 단위 테스트 35개 통과. 16비트 PNG의 4,096단계 그라데이션은 노출 보정 후에도 4,000개 이상의 단계를 유지하며, 중립 sRGB 왕복은 16비트 코드값 오차 1 이내입니다. 원본 불변성, 선형 회전, P3 매트릭스/TRC ICC, EXIF 방향, ST 2084 PQ 기준값과 HDR headroom 왕복을 검증했습니다.
- Electron 앱에서 16비트 PNG 입력·출력, ICC/EXIF, PQ Rec.2020 cICP, HDR 재불러오기, 프로젝트 v2 저장/자동 복원을 확인했습니다. 기존 v1 프로젝트는 8비트 경로로 복원됩니다.
- HDR Canvas API와 float16 픽셀 값 2.0 유지, 앱의 HDR 미리보기 경로 및 SDR 대체 경로를 테스트했습니다. HDR 표시 감지 신호를 강제로 설정하는 테스트는 픽셀 전달만 검증하며 실제 HDR 패널의 휘도 측정은 아닙니다. `docs/hdr-editing.png`는 SDR로 찍은 UI 배치 확인용 그라데이션입니다.
- 기존 전체 UI 및 P3 회귀 테스트를 통과했습니다. macOS Core Image와 Windows용 LibRaw WASM 경로에서 실제 Nikon NEF의 현상 PNG가 16비트이며 P3 ICC를 포함하는 것을 확인했습니다. RAW 원본/EXIF 보존, 재현상, 프로젝트 복원과 손상 파일 격리도 통과했습니다.
- 고정밀 입력의 지원 범위는 RGB 매트릭스/TRC ICC PNG와 PQ Rec.2020 PNG입니다. TIFF, LUT ICC, HLG, gain map, 장면 선형 RAW highlight recovery와 노출 병합은 검증/지원하지 않습니다. 고정밀/새 RAW는 메모리 사용량을 고려해 32MP로 제한합니다.
- 구현 참고: [W3C HDR PQ PNG](https://www.w3.org/TR/png-hdr-pq/), [PNG 3 설명](https://github.com/w3c/PNG-spec/blob/main/Third_Edition_Explainer.md), Chromium의 `CanvasHDR` 전용 기능과 `configureHighDynamicRange`. HDR 입력/출력과 모니터에서의 실제 HDR 표시는 구분합니다.

macOS v0.8.0 패키지에서도 HDR 전용 테스트와 전체 UI 통합 테스트를 통과했습니다. Windows x64 NSIS 설치 파일을 생성했으며 실제 Windows 실행은 추가된 CI에서 확인합니다.

대용량 data URL 변환에서 `Uint8Array.from(string, mapper)`의 중간 배열 생성을 제거했습니다. 8MiB 합성 데이터의 로컬 Node 측정은 284ms → 11ms였고 바이트가 일치했습니다. 실제 RAW 복원에는 디스크/메타데이터/디코딩 시간도 포함됩니다. Windows의 기존 15초 RAW 복원 테스트 제한은 120초로 조정하고 실패 화면 로그를 추가했습니다.

### v0.8.0 Windows 최종 결과

최종 코드 `ecbf52c`의 [Windows CI](https://github.com/murikubo/HinanaStudioImage/actions/runs/35167493263)가 전체 성공했습니다. 단위 테스트 35개, NSIS 빌드, 실제 EXE의 기존 UI/P3/HDR·16비트 테스트, 상단바, Nikon NEF의 16비트 현상·자동 복원·내보내기·프로젝트 재열기·재현상·손상 파일 격리와 산출물 업로드가 모두 통과했습니다. 물리 HDR 패널의 절대 휘도 측정은 포함하지 않습니다.

## v0.9.0 로컬 마스킹 검증

- 단위 테스트 41개: 원형 feather/반전/강도/비활성, 브러시 보간과 획 분리, 자르기·회전·뒤집기의 원본 좌표 왕복, HDR 로컬 노출/알파/미선택 영역 보존, 마스크 프로젝트 데이터 검증을 포함합니다.
- `tests/masks-smoke.mjs`: 실제 UI에서 원형/브러시 생성, 영역 드래그, 로컬 노출, 실행 취소/다시 실행, 비활성, 전체 초기화/복원, 자동 저장과 프로젝트 v3 재열기, 8비트 호환 경로 및 16비트 PNG 출력, 오버레이 미포함을 확인합니다.
- 기존 전체 UI 및 HDR 전용 회귀 테스트를 통과했습니다. Windows CI에 마스킹 UI/출력 검증을 추가했습니다.
- 로컬 Node에서 12MP·100지점 브러시의 coverage 계산은 약 252ms였습니다. 전체 편집/출력 시간을 의미하지 않으며, 큰 반경·많은 마스크·복잡한 획에서는 작업량이 증가합니다.

최종 코드 `91cf8e1`의 [Windows 검증](https://github.com/murikubo/HinanaStudioImage/actions/runs/35184790983)에서 단위 41개, 실제 패키징된 EXE의 기존 UI/P3/HDR/로컬 마스킹·출력 테스트, 상단바, RAW 현상·재현상·프로젝트 복원이 모두 통과했습니다. macOS v0.9.0 패키지에서도 마스킹 및 기존 전체 UI 테스트를 통과했습니다.

## v0.10.0 피사체 선택 검증

- 단위 테스트 43개 통과. 피사체 선택 지도의 JSON 왕복, 잘못된 지도/선택점 거부, 회전·뒤집기·반전·강도, 선택 영역만 선형 HDR 노출을 적용하고 알파/미선택 픽셀을 유지하는 것을 검증합니다.
- 실제 macOS 패키지의 `tests/subject-smoke.mjs`에서 네트워크를 차단하고 실제 SlimSAM 모델로 공개 코기 사진을 선택합니다. 피사체 내부/배경 coverage, 영역 비율, 포함·제외 클릭, 선택만으로 원본 픽셀이 바뀌지 않음, 로컬 노출, 취소 후 재시도/기존 지도 유지, 실행 취소/다시 실행, 자동 저장과 프로젝트 v4 재열기, 16비트 HDR PNG 출력을 확인했습니다. 모델 응답을 모의하지 않습니다.
- 이 개발 Mac의 패키지 테스트에서 첫 인식은 약 2.9초, 추가 제외점 반영은 약 0.18초였습니다. 하나의 사진에 대한 측정이며 다른 하드웨어/사진의 성능이나 정확도를 보장하지 않습니다.
- 추론은 CPU 전용 Electron utility process에서 수행하며 마지막 사진의 특징 하나만 캐시합니다. 취소/종료/120초 유휴 시 프로세스를 해제합니다. Chromium 메모리 할당기와의 충돌을 재현해 ONNX CPU arena 및 memory pattern을 비활성화했고, 별도 프로세스로 앱 종료 전파를 방지했습니다.
- macOS 패키지의 기존 로컬 마스크 및 HDR 테스트도 통과했습니다. Windows CI는 동일한 고정 모델과 사진으로 패키징된 EXE를 테스트합니다.
- 선택 지도는 최대 1024px, 이미지 보정은 기존 8비트/float 경로를 사용합니다. 머리카락/반투명 경계의 정밀 분리, 전경 자동 선택, GPU 가속은 이번 범위에 포함하지 않습니다.
- 테스트 사진 출처: [Transformers.js 문서의 코기 예제](https://huggingface.co/datasets/Xenova/transformers.js-docs/blob/fbe92bd97d48f3ec17779d8d8f2964e1c6bc7634/corgi.jpg). 테스트 다운로드 스크립트에서 revision과 SHA-256을 고정합니다.
