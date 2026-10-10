import { useRef, useState } from 'react';
import { encodeLiquify, liquifyData, newLiquifyData, pushLiquify, type Liquify } from './liquify';
import { maskToSource, type MaskGeometry, type MaskPoint } from './local-masks';
export function LiquifyPanel({
  radius,
  strength,
  onRadius,
  onStrength,
  onReset,
  disabled,
}: {
  radius: number;
  strength: number;
  onRadius: (n: number) => void;
  onStrength: (n: number) => void;
  onReset: () => void;
  disabled: boolean;
}) {
  return (
    <section className="mask-panel">
      <h3>리퀴파이 · 밀기</h3>
      <p>사진 위를 드래그해 변형하세요. 한 획씩 실행 취소할 수 있습니다.</p>
      <label className="mask-slider">
        브러시 크기 <span>{Math.round(radius * 100)}%</span>
        <input
          aria-label="리퀴파이 브러시 크기"
          type="range"
          min="0.05"
          max="0.3"
          step="0.01"
          value={radius}
          disabled={disabled}
          onChange={(e) => onRadius(+e.target.value)}
        />
      </label>
      <label className="mask-slider">
        강도 <span>{Math.round(strength * 100)}%</span>
        <input
          aria-label="리퀴파이 강도"
          type="range"
          min="0.1"
          max="1"
          step="0.05"
          value={strength}
          disabled={disabled}
          onChange={(e) => onStrength(+e.target.value)}
        />
      </label>
      <button disabled={disabled} onClick={onReset}>
        변형만 초기화
      </button>
    </section>
  );
}
export function LiquifyOverlay({
  value,
  radius,
  strength,
  geometry,
  onChange,
}: {
  value: Liquify | null;
  radius: number;
  strength: number;
  geometry: MaskGeometry;
  onChange: (v: Liquify | null, commit: boolean) => void;
}) {
  const stroke = useRef<
    | {
        id: number;
        last: MaskPoint;
        data: Float32Array;
        initial: Liquify | null;
        time: number;
        changed: boolean;
      }
    | undefined
  >(undefined);
  const [hover, setHover] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const point = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return maskToSource(
      { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height },
      geometry,
    );
  };
  const cancel = () => {
    if (stroke.current?.changed) onChange(stroke.current.initial, false);
    stroke.current = undefined;
  };
  return (
    <svg
      className="mask-overlay"
      aria-label="리퀴파이 브러시"
      style={{ touchAction: 'none' }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        if (stroke.current) {
          cancel();
          return;
        }
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        stroke.current = {
          id: e.pointerId,
          last: point(e),
          data: liquifyData(value)?.slice() || newLiquifyData(),
          initial: value,
          time: 0,
          changed: false,
        };
      }}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setHover({ x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height });
        const s = stroke.current;
        if (!s || s.id !== e.pointerId || e.timeStamp - s.time < 33) return;
        e.stopPropagation();
        const p = point(e);
        s.changed ||= Math.hypot(p.x - s.last.x, p.y - s.last.y) > 0.000001;
        pushLiquify(s.data, s.last, p, radius, strength, geometry.width, geometry.height);
        s.last = p;
        s.time = e.timeStamp;
        if (s.changed) onChange(encodeLiquify(s.data), false);
      }}
      onPointerUp={(e) => {
        const s = stroke.current;
        if (!s || s.id !== e.pointerId) return;
        e.stopPropagation();
        const p = point(e);
        s.changed ||= Math.hypot(p.x - s.last.x, p.y - s.last.y) > 0.000001;
        pushLiquify(s.data, s.last, p, radius, strength, geometry.width, geometry.height);
        if (s.changed) onChange(encodeLiquify(s.data), true);
        stroke.current = undefined;
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onPointerLeave={() => setHover(null)}
    >
      {hover && (
        <circle
          cx={hover.x}
          cy={hover.y}
          r={(radius * Math.min(geometry.width, geometry.height) * hover.w) / geometry.cropWidth}
          fill="none"
          stroke="#cfdeb3"
          strokeWidth="1.5"
        />
      )}
    </svg>
  );
}
