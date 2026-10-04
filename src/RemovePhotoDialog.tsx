import { useEffect, useRef } from 'react';
import { Trash2 } from 'lucide-react';

export default function RemovePhotoDialog({
  name,
  onCancel,
  onRemove,
}: {
  name: string;
  onCancel: () => void;
  onRemove: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        ref={dialog}
        className="modal photo-remove-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="photo-remove-title"
        aria-describedby="photo-remove-description"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
          if (e.key === 'Tab') {
            const buttons = dialog.current!.querySelectorAll('button');
            const first = buttons[0],
              last = buttons[buttons.length - 1];
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <h2 id="photo-remove-title">라이브러리에서 삭제</h2>
        <p className="photo-remove-name">{name}</p>
        <p id="photo-remove-description">
          이 사진과 보정 내역을 앱 작업 공간에서 제거합니다. 사진 보관함이나 파일에 있는 원본은
          삭제하지 않습니다.
        </p>
        <div className="photo-remove-actions">
          <button onClick={onCancel}>취소</button>
          <button className="photo-remove-confirm" onClick={onRemove}>
            <Trash2 size={17} /> 삭제
          </button>
        </div>
      </div>
    </div>
  );
}
