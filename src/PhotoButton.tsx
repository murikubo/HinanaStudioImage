import { useEffect, useRef, type ButtonHTMLAttributes } from 'react';

/** Let scrolling cancel a long press; a normal tap still opens the photo. */
export default function PhotoButton({
  onRemove,
  onClick,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { onRemove: () => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const start = useRef({ x: 0, y: 0 });
  const pressed = useRef(false);
  const clear = () => clearTimeout(timer.current);
  useEffect(() => clear, []);
  return (
    <button
      {...props}
      onPointerDown={(e) => {
        clear();
        pressed.current = false;
        if (e.button !== 0 || !e.isPrimary) return;
        start.current = { x: e.clientX, y: e.clientY };
        timer.current = setTimeout(() => {
          pressed.current = true;
          onRemove();
        }, 550);
      }}
      onPointerMove={(e) => {
        if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) clear();
      }}
      onPointerUp={clear}
      onPointerCancel={clear}
      onPointerLeave={clear}
      onContextMenu={(e) => {
        e.preventDefault();
        clear();
        pressed.current = true;
        onRemove();
      }}
      onKeyDown={(e) => {
        if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
          e.preventDefault();
          onRemove();
        }
      }}
      onClick={(e) => {
        if (pressed.current && e.detail !== 0) {
          e.preventDefault();
          pressed.current = false;
          return;
        }
        onClick?.(e);
      }}
    >
      {children}
    </button>
  );
}
