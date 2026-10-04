import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type SelectHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

// Keep the native select's form/label semantics, but present options inside the app.
export default function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const ref = useRef<HTMLSelectElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, height: 300 });
  const [focused, setFocused] = useState(0);
  const options = Children.toArray(props.children).flatMap((child) =>
    isValidElement<{ value?: string | number; disabled?: boolean; children?: React.ReactNode }>(
      child,
    ) && child.type === 'option'
      ? [
          {
            value: String(child.props.value ?? ''),
            label: child.props.children,
            disabled: !!child.props.disabled,
          },
        ]
      : [],
  );
  const selected = options.findIndex((option) => option.value === String(props.value));
  function show() {
    if (props.disabled) return;
    const rect = host.current!.getBoundingClientRect();
    const height = Math.min(options.length * 48 + 12, 320, window.innerHeight - 32);
    setPosition({
      left: Math.max(12, Math.min(rect.left, window.innerWidth - Math.max(rect.width, 230) - 12)),
      top:
        rect.bottom + height + 8 < window.innerHeight
          ? rect.bottom + 6
          : Math.max(12, rect.top - height - 6),
      width: Math.min(window.innerWidth - 24, Math.max(rect.width, 230)),
      height,
    });
    setFocused(Math.max(0, selected));
    setOpen(true);
  }
  function choose(index: number) {
    if (options[index]?.disabled || !ref.current) return;
    ref.current.value = options[index].value;
    ref.current.dispatchEvent(new Event('change', { bubbles: true }));
    setOpen(false);
    ref.current.focus();
  }
  useEffect(() => {
    if (!open) return;
    list.current?.querySelectorAll<HTMLButtonElement>('[role=option]')[focused]?.focus();
    const outside = (event: PointerEvent) => {
      if (
        !host.current?.contains(event.target as Node) &&
        !list.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const close = () => setOpen(false);
    const scroll = (event: Event) => {
      if (!list.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', scroll, true);
    };
  }, [open, focused]);
  useEffect(() => {
    if (props.disabled) setOpen(false);
  }, [props.disabled]);
  function keys(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      ref.current?.focus();
    } else if (event.key === 'Tab') setOpen(false);
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      if (!open) {
        show();
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        choose(focused);
        return;
      }
      let next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : focused;
      const step = event.key === 'ArrowUp' || event.key === 'End' ? -1 : 1;
      for (let i = 0; i < options.length; i++) {
        if (event.key.startsWith('Arrow') || options[next]?.disabled)
          next = (next + step + options.length) % options.length;
        if (!options[next]?.disabled) break;
      }
      setFocused(next);
    }
  }
  return (
    <div ref={host} className={`app-select ${props.disabled ? 'disabled' : ''}`}>
      <select
        {...props}
        ref={ref}
        className="app-select-native"
        aria-controls={open ? id : undefined}
        aria-expanded={open}
        onPointerDown={(event) => {
          event.preventDefault();
          open ? setOpen(false) : show();
        }}
        onClick={(event) => event.preventDefault()}
        onKeyDown={keys}
        onChange={(event) => {
          props.onChange?.(event);
          setOpen(false);
        }}
      />
      <div className="app-select-face" aria-hidden="true">
        {options[selected]?.label}
        <ChevronDown size={15} />
      </div>
      {open &&
        createPortal(
          <div
            ref={list}
            id={id}
            role="listbox"
            aria-label={props['aria-label'] || '선택 항목'}
            className="app-select-options"
            style={{
              left: position.left,
              top: position.top,
              width: position.width,
              maxHeight: position.height,
            }}
            onKeyDown={keys}
          >
            {options.map((option, index) => (
              <button
                type="button"
                role="option"
                key={option.value}
                disabled={option.disabled}
                aria-selected={index === selected}
                tabIndex={index === focused ? 0 : -1}
                onClick={() => choose(index)}
              >
                <span>{option.label}</span>
                {index === selected && <Check size={17} />}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
