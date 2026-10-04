import { useEffect, useRef, useState, type PointerEvent } from 'react';

type Point = { x: number; y: number };
type Pinch = { distance: number; zoom: number; fit: number; anchor: Point };

/** Gestures resize display geometry immediately; pixels render once fingers lift. */
export function usePhotoGestures(
  width: number,
  height: number,
  zoom: number,
  setZoom: (value: number) => void,
  allowPan: boolean,
  photoKey: string,
) {
  const points = useRef(new Map<number, Point>());
  const pinch = useRef<Pinch | null>(null);
  const pan = useRef<{ point: Point; left: number; top: number } | null>(null);
  const animation = useRef(0);
  const [isPinching, setPinching] = useState(false);
  useEffect(() => {
    points.current.clear();
    pinch.current = null;
    pan.current = null;
    setPinching(false);
    return () => cancelAnimationFrame(animation.current);
  }, [photoKey]);
  const pair = () => {
    const [a, b] = [...points.current.values()];
    return {
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  };
  const finish = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'touch') return;
    points.current.delete(e.pointerId);
    if (pinch.current) {
      e.stopPropagation();
      e.preventDefault();
      if (e.currentTarget.hasPointerCapture(e.pointerId))
        e.currentTarget.releasePointerCapture(e.pointerId);
      if (!points.current.size) {
        pinch.current = null;
        pan.current = null;
        setPinching(false);
      }
    } else pan.current = null;
  };
  return {
    isPinching,
    handlers: {
      onPointerDownCapture(e: PointerEvent<HTMLDivElement>) {
        if (e.pointerType !== 'touch') return;
        const area = e.currentTarget;
        points.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (points.current.size === 1) {
          pan.current = {
            point: { x: e.clientX, y: e.clientY },
            left: area.scrollLeft,
            top: area.scrollTop,
          };
          if (allowPan) area.setPointerCapture(e.pointerId);
        } else {
          e.stopPropagation();
          e.preventDefault();
          if (!pinch.current) {
            const canvas = area.querySelector('canvas');
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            const style = getComputedStyle(area);
            const fit =
              Math.min(
                1,
                (area.clientWidth -
                  parseFloat(style.paddingLeft) -
                  parseFloat(style.paddingRight)) /
                  width,
                (area.clientHeight -
                  parseFloat(style.paddingTop) -
                  parseFloat(style.paddingBottom)) /
                  height,
              ) * 100;
            const { distance, center } = pair();
            pinch.current = {
              distance,
              zoom: (rect.width / width) * 100,
              fit,
              anchor: {
                x: Math.max(0, Math.min(1, (center.x - rect.left) / rect.width)),
                y: Math.max(0, Math.min(1, (center.y - rect.top) / rect.height)),
              },
            };
            setPinching(true);
          }
          for (const id of points.current.keys()) area.setPointerCapture(id);
        }
      },
      onPointerMoveCapture(e: PointerEvent<HTMLDivElement>) {
        if (e.pointerType !== 'touch' || !points.current.has(e.pointerId)) return;
        points.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const area = e.currentTarget,
          session = pinch.current;
        if (session) {
          e.stopPropagation();
          e.preventDefault();
          if (points.current.size < 2) return;
          const { distance, center } = pair();
          const next = Math.max(
            session.fit,
            Math.min(400, (session.zoom * distance) / session.distance),
          );
          const value = next <= session.fit * 1.01 ? 0 : Math.max(1, Math.round(next));
          setZoom(value);
          cancelAnimationFrame(animation.current);
          animation.current = requestAnimationFrame(() => {
            if (!value) {
              area.scrollTo(0, 0);
              return;
            }
            const rect = area.getBoundingClientRect(),
              style = getComputedStyle(area);
            area.scrollLeft =
              (session.anchor.x * width * value) / 100 -
              (center.x - rect.left - parseFloat(style.paddingLeft));
            area.scrollTop =
              (session.anchor.y * height * value) / 100 -
              (center.y - rect.top - parseFloat(style.paddingTop));
          });
        } else if (allowPan && zoom && pan.current) {
          e.stopPropagation();
          e.preventDefault();
          area.scrollLeft = pan.current.left - (e.clientX - pan.current.point.x);
          area.scrollTop = pan.current.top - (e.clientY - pan.current.point.y);
        }
      },
      onPointerUpCapture: finish,
      onPointerCancelCapture: finish,
    },
  };
}
