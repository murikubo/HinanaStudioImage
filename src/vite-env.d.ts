/// <reference types="vite/client" />
interface Window {
  hinana?: {
    platform: string;
    redevelopRaw(source: string, name: string): Promise<{ src: string; original: string }>;
    decodeRaw(file: File): Promise<{ src: string; original: string }>;
    onMenuAction(
      callback: (action: 'undo' | 'redo' | 'about' | 'project-open' | 'project-save') => void,
    ): () => void;
  };
}
