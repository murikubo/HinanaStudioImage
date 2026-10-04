import { Capacitor, registerPlugin } from '@capacitor/core';
import { useEffect, useState } from 'react';
import { addPNGChunk, pngDataURLInfo } from './precision-codec';
import { dataURLBytes } from './image-bytes';
import { readDataURL } from './engine';
import type { MaskPoint } from './local-masks';
export const nativeIOS = Capacitor.getPlatform() === 'ios';
export type ImageCapabilities = {
  heic: boolean;
  raw: boolean;
  subject: boolean;
  appleHDR: boolean;
};
export type NativeDecodeResult = { png: string; preview?: string; hdr: boolean; peak: number };
export const NativeImages = registerPlugin<{
  showHDRPreview(input: { png: string }): Promise<void>;
  capabilities(): Promise<ImageCapabilities>;
  decodeImage(input: { base64: string; raw: boolean }): Promise<NativeDecodeResult>;
  pickImages(input: {
    source: 'photos' | 'files';
  }): Promise<{ files: { uri: string; name: string }[]; failures: string[] }>;
  releaseImports(input: { uris: string[] }): Promise<void>;
  selectSubject(input: {
    png: string;
    points: MaskPoint[];
    requestId: string;
  }): Promise<{ width: number; height: number; data: string }>;
  cancelSubject(input: { requestId: string }): Promise<void>;
}>('HinanaImages');
export function useImageCapabilities() {
  const [capabilities, setCapabilities] = useState<ImageCapabilities>({
    heic: false,
    raw: false,
    subject: false,
    appleHDR: false,
  });
  useEffect(() => {
    let cancelled = false;
    if (nativeIOS)
      void NativeImages.capabilities()
        .then((value) => {
          if (!cancelled) setCapabilities(value);
        })
        .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return capabilities;
}
export async function nativeWorkingPNG(result: NativeDecodeResult) {
  const src = `data:image/png;base64,${result.png}`;
  const { cicp } = pngDataURLInfo(src);
  if (result.hdr) {
    if (cicp && (cicp[0] !== 9 || cicp[1] !== 16 || cicp[2] !== 0 || cicp[3] !== 1))
      throw Error('네이티브 HDR 작업 이미지의 색상 정보가 올바르지 않습니다.');
    if (!cicp) {
      const bytes = addPNGChunk(dataURLBytes(src), 'cICP', new Uint8Array([9, 16, 0, 1]));
      return readDataURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }));
    }
  }
  return src;
}
/** Fetch cache files before releasing native picker copies; projects retain their own bytes. */
export async function pickNativeFiles(source: 'photos' | 'files') {
  const selection = await NativeImages.pickImages({ source });
  try {
    const files: File[] = [];
    for (const item of selection.files) {
      const response = await fetch(Capacitor.convertFileSrc(item.uri));
      if (!response.ok) throw Error('선택한 원본 파일을 읽지 못했습니다.');
      files.push(new File([await response.blob()], item.name));
    }
    return { files, failures: selection.failures };
  } finally {
    await NativeImages.releaseImports({ uris: selection.files.map((item) => item.uri) });
  }
}
