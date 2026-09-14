/// <reference types="vite/client" />
interface Window {
  hinana?: {
    platform: string;
    decodeRaw(file: File): Promise<{ src: string; original: string }>;
    onMenuAction(
      callback: (action: 'undo' | 'redo' | 'about' | 'project-open' | 'project-save') => void,
    ): () => void;
  };
}
