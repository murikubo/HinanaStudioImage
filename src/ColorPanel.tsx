import { useState } from 'react';
import { Palette, RotateCcw, Spline } from 'lucide-react';
import {
  colorBands,
  colorDefaults,
  curvePoints,
  type Band,
  type MixerKey,
  type CurveKey,
} from './color-tools';
import type { Adjustments } from './engine';
type Props = {
  adjustments: Adjustments;
  disabled: boolean;
  onChange: (values: Partial<Adjustments>, commit?: boolean) => void;
};
export default function ColorPanel({ adjustments: a, disabled, onChange }: Props) {
  const [band, setBand] = useState<Band>('red');
  const selected = colorBands.find((b) => b.id === band)!;
  const points = curvePoints(a);
  const slider = (key: MixerKey | CurveKey, name: string) => (
    <label className="slider-control" key={key}>
      <span>
        {name}
        <output>
          {a[key] > 0 ? '+' : ''}
          {a[key]}
        </output>
      </span>
      <input
        aria-label={name}
        type="range"
        min={-100}
        max={100}
        value={a[key]}
        disabled={disabled}
        onChange={(e) => onChange({ [key]: Number(e.target.value) })}
        onPointerUp={() => onChange({}, true)}
        onKeyUp={() => onChange({}, true)}
        onBlur={() => onChange({}, true)}
        onDoubleClick={() => onChange({ [key]: 0 }, true)}
      />
    </label>
  );
  return (
    <div className="color-tools-panel">
      <div className="color-tool-heading">
        <Palette size={16} />
        <h2>색상 믹서</h2>
        <button
          className="icon-button"
          title="색상 믹서 초기화"
          disabled={disabled}
          onClick={() =>
            onChange(
              Object.fromEntries(
                Object.entries(colorDefaults).filter(([k]) => k.startsWith('mixer_')),
              ),
              true,
            )
          }
        >
          <RotateCcw size={13} />
        </button>
      </div>
      <p>
        색상별로 색조·채도·밝기를 조절합니다.
        <br />
        인접한 색상은 부드럽게 함께 반영됩니다.
      </p>
      <div className="color-swatches" role="group" aria-label="색상 범위">
        {colorBands.map((b) => (
          <button
            key={b.id}
            title={b.name}
            aria-label={`${b.name} 색상 선택`}
            aria-pressed={band === b.id}
            className={band === b.id ? 'selected' : ''}
            style={{ '--swatch': b.color } as React.CSSProperties}
            onClick={() => setBand(b.id)}
          />
        ))}
      </div>
      <div className="color-selection">
        <span style={{ background: selected.color }} />
        {selected.name}
        <small>HSL</small>
      </div>
      <div className="sliders">
        {slider(`mixer_${band}_hue`, `${selected.name} 색조`)}
        {slider(`mixer_${band}_saturation`, `${selected.name} 채도`)}
        {slider(`mixer_${band}_luminance`, `${selected.name} 명도`)}
      </div>
      <div className="color-tool-heading curve-heading">
        <Spline size={16} />
        <h2>톤 커브</h2>
        <button
          className="icon-button"
          title="톤 커브 초기화"
          disabled={disabled}
          onClick={() => onChange({ curveShadows: 0, curveMidtones: 0, curveHighlights: 0 }, true)}
        >
          <RotateCcw size={13} />
        </button>
      </div>
      <p>
        어두운 영역·중간톤·밝은 영역의 밝기를
        <br />
        각각 조절해 명암을 만듭니다.
      </p>
      <svg className="tone-curve" viewBox="0 0 240 180" role="img" aria-label="톤 커브 그래프">
        {[0.25, 0.5, 0.75].map((n) => (
          <g key={n}>
            <line x1={n * 240} y1="0" x2={n * 240} y2="180" />
            <line x1="0" y1={n * 180} x2="240" y2={n * 180} />
          </g>
        ))}
        <line className="curve-reference" x1="0" y1="180" x2="240" y2="0" />
        <polyline points={points.map(([x, y]) => `${x * 240},${(1 - y) * 180}`).join(' ')} />
        {points.slice(1, 4).map(([x, y]) => (
          <circle key={x} cx={x * 240} cy={(1 - y) * 180} r="3" />
        ))}
      </svg>
      <div className="curve-axis">
        <span>어두움</span>
        <span>밝음</span>
      </div>
      <div className="sliders">
        {slider('curveShadows', '커브 어두운 영역')}
        {slider('curveMidtones', '커브 중간톤')}
        {slider('curveHighlights', '커브 밝은 영역')}
      </div>
      <p className="color-hint">
        슬라이더를 두 번 클릭하면 초기화됩니다.
        <br />
        보정은 원본 비교·실행 취소·저장에 반영됩니다.
      </p>
    </div>
  );
}
