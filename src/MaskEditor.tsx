import { useEffect, useRef, useState } from 'react';
import {
  MAX_MASKS,
  MAX_MASK_POINTS,
  newMask,
  maskCoverage,
  maskToSource,
  type LocalMask,
  type MaskGeometry,
  type MaskPoint,
} from './local-masks';
type Props = {
  masks: LocalMask[];
  selected: string;
  onSelect: (id: string) => void;
  showOverlay: boolean;
  onOverlay: (show: boolean) => void;
  disabled: boolean;
  onChange: (masks: LocalMask[], commit: boolean) => void;
};
export function MaskPanel({
  masks,
  selected,
  onSelect,
  showOverlay,
  onOverlay,
  disabled,
  onChange,
}: Props) {
  const mask = masks.find((m) => m.id === selected) || masks[0];
  const update = (values: Partial<LocalMask>, commit = false) =>
    mask &&
    onChange(
      masks.map((m) => (m.id === mask.id ? { ...m, ...values } : m)),
      commit,
    );
  return (
    <section className="mask-panel" aria-label="로컬 마스킹">
      <h3>선택한 영역만 보정</h3>
      <p>
        마스크를 추가하고 사진 위를 드래그하세요. 영역은 자르기·회전 후에도 원본 위치를 따라갑니다.
      </p>
      <div className="mask-create">
        {(['brush', 'linear', 'radial'] as const).map((kind) => (
          <button
            key={kind}
            disabled={disabled || masks.length >= MAX_MASKS}
            onClick={() => {
              const m = newMask(kind, crypto.randomUUID());
              m.name += ` ${masks.length + 1}`;
              if (kind !== 'brush')
                m.points = [
                  { x: 0.5, y: 0.5 },
                  { x: 0.8, y: 0.8 },
                ];
              onChange([...masks, m], true);
              onSelect(m.id);
            }}
          >
            {kind === 'brush' ? '브러시 추가' : kind === 'linear' ? '선형 추가' : '원형 추가'}
          </button>
        ))}
      </div>
      <div className="mask-list">
        {masks.map((m) => (
          <button
            key={m.id}
            className={mask?.id === m.id ? 'active' : ''}
            aria-pressed={mask?.id === m.id}
            disabled={disabled}
            onClick={() => onSelect(m.id)}
          >
            {m.enabled ? '◉' : '○'} {m.name}
          </button>
        ))}
      </div>
      {mask && (
        <fieldset disabled={disabled}>
          <div className="mask-actions">
            <label>
              <input
                type="checkbox"
                checked={mask.enabled}
                onChange={(e) => update({ enabled: e.target.checked }, true)}
              />
              마스크 사용
            </label>
            <button
              onClick={() =>
                onChange(
                  masks.filter((m) => m.id !== mask.id),
                  true,
                )
              }
            >
              마스크 삭제
            </button>
          </div>
          <label className="mask-toggle">
            <input
              type="checkbox"
              checked={showOverlay}
              onChange={(e) => onOverlay(e.target.checked)}
            />
            선택 영역 표시
          </label>
          <label className="mask-toggle">
            <input
              type="checkbox"
              checked={mask.inverted}
              onChange={(e) => update({ inverted: e.target.checked }, true)}
            />
            선택 영역 반전
          </label>
          {mask.kind === 'brush' && (
            <>
              <p>
                {mask.points.length >= MAX_MASK_POINTS
                  ? '브러시 경로가 가득 찼습니다. 새 마스크를 추가하세요.'
                  : '여러 번 그려 영역을 추가할 수 있습니다.'}
              </p>
              <button onClick={() => update({ points: [] }, true)}>브러시 영역 지우기</button>
            </>
          )}
          {(
            [
              { key: 'opacity', label: '마스크 강도', min: 0, max: 1, step: 0.01 },
              { key: 'feather', label: '경계 부드러움', min: 0, max: 1, step: 0.01 },
              ...(mask.kind === 'brush'
                ? [{ key: 'radius', label: '브러시 반경', min: 0.005, max: 0.5, step: 0.005 }]
                : []),
              { key: 'exposure', label: '로컬 노출', min: -3, max: 3, step: 0.05 },
              { key: 'contrast', label: '로컬 대비', min: -100, max: 100, step: 1 },
              { key: 'saturation', label: '로컬 채도', min: -100, max: 100, step: 1 },
              { key: 'temperature', label: '로컬 색온도', min: -100, max: 100, step: 1 },
            ] as const
          ).map((c) => (
            <label className="mask-slider" key={c.key}>
              {c.label}
              <output>{Number(mask[c.key as keyof LocalMask]).toFixed(c.step < 1 ? 2 : 0)}</output>
              <input
                aria-label={c.label}
                type="range"
                min={c.min}
                max={c.max}
                step={c.step}
                value={Number(mask[c.key as keyof LocalMask])}
                onChange={(e) => update({ [c.key]: Number(e.target.value) })}
                onPointerUp={() => update({}, true)}
                onKeyUp={() => update({}, true)}
                onBlur={() => update({}, true)}
              />
            </label>
          ))}
        </fieldset>
      )}
      <p>
        사진당 최대 {MAX_MASKS}개 · 목록 위에서 아래 순서로 적용됩니다. 마스크 오버레이는 출력되지
        않습니다.
      </p>
    </section>
  );
}
export function MaskOverlay({
  mask,
  geometry,
  show,
  onChange,
}: {
  mask?: LocalMask;
  geometry: MaskGeometry;
  show: boolean;
  onChange: (mask: LocalMask) => void;
}) {
  const [draft, setDraft] = useState<LocalMask | null>(null),
    [preview, setPreview] = useState('');
  const dragging = useRef<LocalMask | null>(null);
  useEffect(() => {
    dragging.current = null;
    setDraft(null);
  }, [mask, geometry.rotation, geometry.flip, geometry.cropWidth, geometry.cropHeight]);
  useEffect(() => {
    const cancel = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dragging.current = null;
        setDraft(null);
      }
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, []);
  const current = draft || mask;
  useEffect(() => {
    if (!current || !show) {
      setPreview('');
      return;
    }
    const scale = 320 / Math.max(geometry.cropWidth, geometry.cropHeight),
      width = Math.max(1, Math.round(geometry.cropWidth * scale)),
      height = Math.max(1, Math.round(geometry.cropHeight * scale));
    const weights = maskCoverage(current, width, height, geometry),
      canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!,
      pixels = ctx.createImageData(width, height);
    for (let p = 0; p < weights.length; p++) {
      pixels.data[p * 4] = 255;
      pixels.data[p * 4 + 1] = 74;
      pixels.data[p * 4 + 2] = 110;
      pixels.data[p * 4 + 3] = weights[p] * 110;
    }
    ctx.putImageData(pixels, 0, 0);
    setPreview(canvas.toDataURL());
  }, [
    current,
    geometry.width,
    geometry.height,
    geometry.cropWidth,
    geometry.cropHeight,
    geometry.rotation,
    geometry.flip,
    show,
  ]);
  if (!mask) return null;
  const point = (e: React.PointerEvent<SVGSVGElement>): MaskPoint => {
    const r = e.currentTarget.getBoundingClientRect();
    const p = maskToSource(
      { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height },
      geometry,
    );
    return { x: Math.max(0, Math.min(1, p.x)), y: Math.max(0, Math.min(1, p.y)) };
  };
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const m = dragging.current;
    if (!m) return;
    const p = point(e);
    if (m.kind === 'brush') {
      const last = m.points[m.points.length - 1]!;
      if (m.points.length >= MAX_MASK_POINTS || Math.hypot(p.x - last.x, p.y - last.y) < 0.002)
        return;
      m.points = [...m.points, p];
    } else m.points = [m.points[0], p];
    setDraft({ ...m });
  };
  return (
    <svg
      className="mask-overlay"
      aria-label="마스크 그리기 영역"
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      onPointerDown={(e) => {
        if (e.button !== 0 || !mask.enabled) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = point(e);
        dragging.current = {
          ...mask,
          points:
            mask.kind === 'brush'
              ? [
                  ...mask.points,
                  ...(mask.points.length < MAX_MASK_POINTS ? [{ ...p, start: true }] : []),
                ]
              : [p, p],
        };
        setDraft({ ...dragging.current });
      }}
      onPointerMove={move}
      onPointerUp={(e) => {
        move(e);
        const m = dragging.current;
        dragging.current = null;
        setDraft(null);
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
        if (
          m &&
          (m.kind === 'brush' ||
            Math.hypot(m.points[1].x - m.points[0].x, m.points[1].y - m.points[0].y) > 0.003)
        )
          onChange(m);
      }}
      onPointerCancel={() => {
        dragging.current = null;
        setDraft(null);
      }}
    >
      {preview && <image href={preview} width="1" height="1" preserveAspectRatio="none" />}
    </svg>
  );
}
