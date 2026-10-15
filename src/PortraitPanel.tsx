import type { Adjustments } from './engine';
import { faceKeys, bodyKeys } from './portrait-ai';
export const portraitLabels = {
  faceWidth: '얼굴 슬림',
  faceJaw: '턱라인 슬림',
  faceEyes: '눈 크기',
  faceNose: '코 폭 슬림',
  bodyWaist: '허리 슬림',
  bodyShoulders: '어깨 폭 슬림',
  bodyHips: '골반 폭 슬림',
};
export default function PortraitPanel({
  a,
  busy,
  disabled,
  onAnalyze,
  onChange,
  onCrop,
}: {
  a: Adjustments;
  busy: boolean;
  disabled: boolean;
  onAnalyze: () => void;
  onChange: (v: Partial<Adjustments>, commit?: boolean) => void;
  onCrop: () => void;
}) {
  const faces = a.portraitLandmarks?.faces.length || 0;
  const poses =
    a.portraitLandmarks?.poses.filter((p) =>
      [11, 12, 23, 24].every((i) => (p[i].visibility || 0) >= 0.65),
    ).length || 0;
  return (
    <details className="portrait-panel" open>
      <summary>얼굴 · 체형 AI</summary>
      <p className="skin-note">
        사진은 업로드하지 않고 이 기기에서 인식합니다. 인식된 얼굴·신체에 보정하며 주변 배경도
        변형될 수 있습니다.
      </p>
      <button disabled={disabled || busy} onClick={onAnalyze}>
        {busy ? '인물 인식 중…' : '얼굴·체형 인식'}
      </button>
      <p role="status" className="portrait-status">
        {a.portraitLandmarks
          ? `얼굴 ${faces}명 · 체형 보정 가능 ${poses}명`
          : '인물 인식 후 보정할 수 있습니다.'}
      </p>
      <div className="sliders">
        {[...faceKeys, ...bodyKeys].map((key) => (
          <label className="slider-control" key={key}>
            <span>
              {portraitLabels[key]}
              <output>{a[key]}</output>
            </span>
            <input
              type="range"
              aria-label={portraitLabels[key]}
              min="-100"
              max="100"
              value={a[key]}
              disabled={disabled || busy || (key.startsWith('face') ? !faces : !poses)}
              onChange={(e) => onChange({ [key]: +e.target.value })}
              onPointerUp={() => onChange({}, true)}
              onKeyUp={() => onChange({}, true)}
              onBlur={() => onChange({}, true)}
              onDoubleClick={() => onChange({ [key]: 0 }, true)}
            />
          </label>
        ))}
      </div>
      <button disabled={disabled || busy || !faces} onClick={onCrop}>
        AI 인물 크롭 · 4:5
      </button>
      <p className="skin-note">
        여러 인물이 인식되면 같은 보정이 모두 적용됩니다. 가려진 신체는 보정하지 않습니다. 인물
        크롭은 가장 큰 얼굴을 기준으로 합니다.
      </p>
    </details>
  );
}
