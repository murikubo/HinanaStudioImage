import { useEffect, useRef, useState } from 'react';
import {
  MAX_MASKS,
  MAX_MASK_POINTS,
  MAX_REFINE_POINTS,
  MAX_REFINE_STROKES,
  type SubjectTool,
  newMask,
  maskCoverage,
  maskToSource,
  maskToDisplay,
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
  subjectBusy: boolean;
  subjectTool: SubjectTool;
  onSubjectTool: (tool: SubjectTool) => void;
  onCancelSubject: () => void;
  exclude: boolean;
  onExclude: (exclude: boolean) => void;
  onChange: (masks: LocalMask[], commit: boolean) => void;
};
export function MaskPanel({
  masks,
  selected,
  onSelect,
  showOverlay,
  onOverlay,
  disabled,
  subjectBusy,
  subjectTool,
  onSubjectTool,
  onCancelSubject,
  exclude,
  onExclude,
  onChange,
}: Props) {
  const [createOpen, setCreateOpen] = useState(masks.length === 0);
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
      <p>마스크로 영역을 정한 뒤 로컬 보정 값을 조절하세요.</p>
      <div className="mask-new">
        <button
          className="mask-new-toggle"
          aria-expanded={createOpen}
          onClick={() => setCreateOpen(!createOpen)}
        >
          새 마스크 만들기
        </button>
        {createOpen && (
          <>
            <p>
              별도의 보정 영역을 만듭니다. 기존 피사체를 다듬으려면 아래 수정 도구를 사용하세요.
            </p>
            <div className="mask-create">
              {(['subject', 'brush', 'linear', 'radial'] as const).map((kind) => (
                <button
                  key={kind}
                  disabled={
                    disabled || masks.length >= MAX_MASKS || (kind === 'subject' && !window.hinana)
                  }
                  onClick={() => {
                    const m = newMask(kind, crypto.randomUUID());
                    m.name += ` ${masks.length + 1}`;
                    if (kind === 'linear' || kind === 'radial')
                      m.points = [
                        { x: 0.5, y: 0.5 },
                        { x: 0.8, y: 0.8 },
                      ];
                    onChange([...masks, m], true);
                    onSelect(m.id);
                    setCreateOpen(false);
                  }}
                >
                  {kind === 'subject'
                    ? '피사체 마스크'
                    : kind === 'brush'
                      ? '브러시 마스크'
                      : kind === 'linear'
                        ? '선형 마스크'
                        : '원형 마스크'}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      {subjectBusy && (
        <div role="status" className="subject-status">
          피사체 인식 중… <button onClick={onCancelSubject}>인식 취소</button>
        </div>
      )}
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
          <legend className="mask-edit-title">{mask.name} 수정</legend>
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
          {mask.kind === 'subject' && (
            <>
              <p className="mask-tool-note">아래 도구는 현재 마스크 하나의 영역을 수정합니다.</p>
              <div className="subject-tools" role="group" aria-label="현재 피사체 마스크 수정 도구">
                <button
                  aria-pressed={subjectTool === 'ai' && !exclude}
                  onClick={() => {
                    onSubjectTool('ai');
                    onExclude(false);
                  }}
                >
                  AI로 포함
                </button>
                <button
                  disabled={!mask.points.length}
                  aria-pressed={subjectTool === 'ai' && exclude}
                  onClick={() => {
                    onSubjectTool('ai');
                    onExclude(true);
                  }}
                >
                  AI로 제외
                </button>
                <button
                  disabled={!mask.raster}
                  aria-pressed={subjectTool === 'add'}
                  onClick={() => {
                    onSubjectTool('add');
                    onOverlay(true);
                  }}
                >
                  브러시로 더하기
                </button>
                <button
                  disabled={!mask.raster}
                  aria-pressed={subjectTool === 'erase'}
                  onClick={() => {
                    onSubjectTool('erase');
                    onOverlay(true);
                  }}
                >
                  브러시로 지우기
                </button>
              </div>
              <p className="mask-tool-instruction">
                {subjectTool === 'ai'
                  ? exclude
                    ? '제외할 부분을 클릭하세요. AI가 선택 영역을 다시 계산합니다.'
                    : '포함할 피사체를 클릭하세요. AI가 선택 영역을 계산합니다.'
                  : subjectTool === 'add'
                    ? '사진 위를 드래그해 현재 선택 영역에 더하세요.'
                    : '사진 위를 드래그해 현재 선택 영역에서 지우세요.'}
              </p>
              {subjectTool === 'ai' ? (
                <p>AI 선택점 {mask.points.length}/32 · Alt/Option 클릭: 제외</p>
              ) : (
                <p>
                  수동 수정 {mask.strokes?.length || 0}/{MAX_REFINE_STROKES}획 ·{' '}
                  {(mask.strokes || []).reduce((n, s) => n + s.points.length, 0)}/
                  {MAX_REFINE_POINTS}점 · Esc: 현재 획 취소
                </p>
              )}
              <details className="subject-help">
                <summary>수정 초기화 및 사용 안내</summary>
                <div className="mask-actions">
                  <button
                    disabled={!mask.strokes?.length}
                    onClick={() => update({ strokes: undefined }, true)}
                  >
                    수동 수정 초기화
                  </button>
                  <button
                    disabled={!mask.points.length}
                    onClick={() => {
                      update({ points: [], raster: undefined, strokes: undefined }, true);
                      onSubjectTool('ai');
                      onExclude(false);
                    }}
                  >
                    선택 다시 시작
                  </button>
                </div>
                <p>
                  수동 수정 초기화는 브러시 획만 지웁니다. 선택 다시 시작은 AI 선택과 브러시 획을
                  모두 비웁니다.
                </p>
                <p>
                  수동 수정은 반전 전 영역에 적용되며 AI 재인식 후에도 유지됩니다. 브러시
                  크기·부드러움은 새 획에 적용됩니다. Alt/Option을 누르고 그리면 지우기입니다.
                </p>
              </details>
            </>
          )}
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
              ...(mask.kind === 'subject' && subjectTool === 'ai'
                ? []
                : [
                    {
                      key: 'feather',
                      label: mask.kind === 'subject' ? '브러시 경계 부드러움' : '경계 부드러움',
                      min: 0,
                      max: 1,
                      step: 0.01,
                    },
                  ]),
              ...(mask.kind === 'brush' || (mask.kind === 'subject' && subjectTool !== 'ai')
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
  onSubjectPoint,
  disabled = false,
  subjectTool = 'ai',
}: {
  mask?: LocalMask;
  geometry: MaskGeometry;
  show: boolean;
  onChange: (mask: LocalMask) => void;
  onSubjectPoint: (mask: LocalMask, point: MaskPoint) => void;
  disabled?: boolean;
  subjectTool?: SubjectTool;
}) {
  const [draft, setDraft] = useState<LocalMask | null>(null),
    [preview, setPreview] = useState(''),
    [hover, setHover] = useState<MaskPoint | null>(null);
  const dragging = useRef<LocalMask | null>(null);
  useEffect(() => {
    dragging.current = null;
    setDraft(null);
  }, [
    mask,
    subjectTool,
    disabled,
    geometry.rotation,
    geometry.flip,
    geometry.cropWidth,
    geometry.cropHeight,
  ]);
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
    const p = point(e);
    setHover(p);
    const m = dragging.current;
    if (!m) return;
    if (m.kind === 'subject') {
      const strokes = m.strokes!,
        stroke = strokes[strokes.length - 1],
        last = stroke.points[stroke.points.length - 1];
      if (
        strokes.reduce((n, s) => n + s.points.length, 0) >= MAX_REFINE_POINTS ||
        Math.hypot(p.x - last.x, p.y - last.y) < 0.002
      )
        return;
      m.strokes = [...strokes.slice(0, -1), { ...stroke, points: [...stroke.points, p] }];
    } else if (m.kind === 'brush') {
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
        if (e.button !== 0 || !mask.enabled || disabled) return;
        if (mask.kind === 'subject' && subjectTool === 'ai') {
          e.preventDefault();
          onSubjectPoint(mask, { ...point(e), exclude: e.altKey });
          return;
        }
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = point(e);
        if (mask.kind === 'subject') {
          const strokes = mask.strokes || [];
          if (
            !mask.raster ||
            strokes.length >= MAX_REFINE_STROKES ||
            strokes.reduce((n, s) => n + s.points.length, 0) >= MAX_REFINE_POINTS
          )
            return;
          dragging.current = {
            ...mask,
            strokes: [
              ...strokes,
              {
                points: [p],
                radius: mask.radius,
                feather: mask.feather,
                erase: subjectTool === 'erase' || e.altKey,
              },
            ],
          };
          setDraft({ ...dragging.current });
          return;
        }
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
      onPointerLeave={() => setHover(null)}
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
            m.kind === 'subject' ||
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
      {hover && !disabled && mask.enabled && mask.kind === 'subject' && subjectTool !== 'ai' && (
        <ellipse
          cx={maskToDisplay(hover, geometry).x}
          cy={maskToDisplay(hover, geometry).y}
          rx={(mask.radius * Math.min(geometry.width, geometry.height)) / geometry.cropWidth}
          ry={(mask.radius * Math.min(geometry.width, geometry.height)) / geometry.cropHeight}
          fill="none"
          stroke={subjectTool === 'erase' ? '#ff8096' : '#e4f4d4'}
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      )}
      {mask.kind === 'subject' &&
        subjectTool === 'ai' &&
        show &&
        mask.points.map((p, i) => {
          const pos = maskToDisplay(p, geometry);
          return (
            <svg key={i} x={pos.x} y={pos.y} width=".025" height=".04" overflow="visible">
              <circle
                r=".006"
                cx="0"
                cy="0"
                fill={p.exclude ? '#ff5270' : '#b7e794'}
                stroke="white"
                strokeWidth=".002"
              />
            </svg>
          );
        })}
    </svg>
  );
}
