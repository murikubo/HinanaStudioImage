/// <reference types="vite/client" />
interface Window {
  hinana?: {
    platform: string;
    takeProjectFile(): Promise<{ name: string; text: string } | { error: string } | null>;
    onProjectAvailable(callback: () => void): () => void;
    selectSubject(input: {
      rgba: Uint8ClampedArray;
      width: number;
      height: number;
      points: { x: number; y: number; exclude: boolean }[];
    }): Promise<{ width: number; height: number; data: string }>;
    cancelSubject(): Promise<void>;
    redevelopRaw(source: string, name: string): Promise<{ src: string; original: string }>;
    decodeRaw(file: File): Promise<{ src: string; original: string }>;
    onMenuAction(
      callback: (action: 'undo' | 'redo' | 'about' | 'project-open' | 'project-save') => void,
    ): () => void;
  };
}
