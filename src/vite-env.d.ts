/// <reference types="vite/client" />
interface Window {
  hinana?: {
    platform: string;
    nativeGeometry(
      request: import('../electron/native-gpu-types').NativeGeometryRequest,
    ): Promise<Float32Array>;
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
    decodeHDRSource(
      source: string,
    ): Promise<{ hdr: boolean; peak?: number; png?: string; preview?: string }>;
    decodeRaw(file: File): Promise<{ src: string; original: string }>;
    onMenuAction(
      callback: (action: 'undo' | 'redo' | 'about' | 'project-open' | 'project-save') => void,
    ): () => void;
  };
}
