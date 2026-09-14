import { applyColorTools, colorDefaults, type ColorAdjustments } from './color-tools.ts';
import { retouchSkin } from './retouch.ts';
export type Adjustments = ColorAdjustments & {
  skinSmooth: number;
  skinRedness: number;
  skinBrightness: number;
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  temperature: number;
  tint: number;
  vibrance: number;
  saturation: number;
  fade: number;
  vignette: number;
  rotation: number;
  flip: boolean;
  crop: string;
};
export const defaults: Adjustments = {
  ...colorDefaults,
  skinSmooth: 0,
  skinRedness: 0,
  skinBrightness: 0,
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  temperature: 0,
  tint: 0,
  vibrance: 0,
  saturation: 0,
  fade: 0,
  vignette: 0,
  rotation: 0,
  flip: false,
  crop: 'original',
};
export const presets: {
  id: string;
  name: string;
  description: string;
  color: string;
  values: Partial<Adjustments>;
}[] = [
  {
    id: 'original',
    name: '오리지널',
    description: '있는 그대로의 순간',
    color: '#8c9980',
    values: {},
  },
  {
    id: 'alpine',
    name: '알파인',
    description: '맑고 선명한 공기',
    color: '#819890',
    values: { contrast: 14, shadows: 22, temperature: -9, vibrance: 18, highlights: -22 },
  },
  {
    id: 'golden',
    name: '골든 아워',
    description: '따뜻하게 머무는 빛',
    color: '#c89f64',
    values: {
      temperature: 24,
      exposure: 0.15,
      highlights: -25,
      shadows: 15,
      fade: 8,
      vibrance: 12,
    },
  },
  {
    id: 'film',
    name: '소프트 필름',
    description: '오래 간직한 기억처럼',
    color: '#a48c80',
    values: {
      contrast: -12,
      saturation: -16,
      fade: 22,
      temperature: 10,
      shadows: 16,
      vignette: 16,
    },
  },
  {
    id: 'moody',
    name: '딥 포레스트',
    description: '차분하고 깊은 색감',
    color: '#536c65',
    values: {
      exposure: -0.25,
      contrast: 22,
      highlights: -30,
      saturation: -12,
      temperature: -6,
      vignette: 24,
    },
  },
  {
    id: 'mono',
    name: '모노크롬',
    description: '빛과 그림자의 이야기',
    color: '#90908c',
    values: { saturation: -100, contrast: 24, highlights: -15, shadows: 12, fade: 5 },
  },
];
const clamp = (v: number) => Math.max(0, Math.min(255, v));
/** Pixel pipeline shared by the preview and full-resolution export. Source is never mutated. */
export function adjustPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  a: Adjustments,
): void {
  retouchSkin(data, width, height, a);
  const exp = 2 ** a.exposure,
    contrast = (1 + a.contrast / 100) ** 2;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i] * exp,
      g = data[i + 1] * exp,
      b = data[i + 2] * exp;
    const l = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
    const shadow = (1 - Math.min(1, l)) ** 3,
      high = Math.min(1, l) ** 3;
    const shift =
      a.shadows * shadow * 0.85 +
      a.highlights * high * 0.85 +
      a.whites * high ** 2 * 0.6 +
      a.blacks * shadow ** 2 * 0.6;
    r = (r + shift - 128) * contrast + 128 + a.temperature * 0.65 + a.tint * 0.24;
    g = (g + shift - 128) * contrast + 128 - a.tint * 0.36;
    b = (b + shift - 128) * contrast + 128 - a.temperature * 0.65 + a.tint * 0.24;
    const gray = r * 0.2126 + g * 0.7152 + b * 0.0722;
    const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    const sat = (1 + a.saturation / 100) * (1 + (a.vibrance / 100) * (1 - Math.min(1, chroma)));
    r = gray + (r - gray) * sat;
    g = gray + (g - gray) * sat;
    b = gray + (b - gray) * sat;
    const fade = a.fade / 100;
    let v = 1;
    if (a.vignette) {
      const p = i / 4,
        x = ((p % width) / width) * 2 - 1,
        y = (Math.floor(p / width) / height) * 2 - 1;
      v -= ((Math.min(1, (x * x + y * y) / 1.5) ** 1.5 * a.vignette) / 100) * 0.85;
    }
    data[i] = clamp((r * (1 - fade * 0.5) + fade * 40) * v);
    data[i + 1] = clamp((g * (1 - fade * 0.5) + fade * 40) * v);
    data[i + 2] = clamp((b * (1 - fade * 0.5) + fade * 40) * v);
  }
  applyColorTools(data, a);
}
export function outputSize(width: number, height: number, a: Adjustments): [number, number] {
  if (Math.abs(a.rotation) % 180 === 90) [width, height] = [height, width];
  if (a.crop !== 'original') {
    const [x, y] = a.crop.split(':').map(Number);
    const ratio = x / y;
    if (width / height > ratio) width = Math.round(height * ratio);
    else height = Math.round(width / ratio);
  }
  return [width, height];
}
export function renderPhoto(
  image: HTMLImageElement,
  canvas: HTMLCanvasElement,
  a: Adjustments,
  maxSide = 1600,
) {
  const [w, h] = outputSize(image.naturalWidth, image.naturalHeight, a);
  const scale = Math.min(1, maxSide / Math.max(w, h));
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(a.flip ? -1 : 1, 1);
  ctx.rotate((a.rotation * Math.PI) / 180);
  ctx.drawImage(
    image,
    (-image.naturalWidth * scale) / 2,
    (-image.naturalHeight * scale) / 2,
    image.naturalWidth * scale,
    image.naturalHeight * scale,
  );
  ctx.restore();
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  adjustPixels(pixels.data, canvas.width, canvas.height, a);
  ctx.putImageData(pixels, 0, 0);
  return pixels;
}
export function histogram(data: Uint8ClampedArray) {
  const bins = [
    new Array<number>(64).fill(0),
    new Array<number>(64).fill(0),
    new Array<number>(64).fill(0),
  ];
  for (let i = 0; i < data.length; i += 16) for (let c = 0; c < 3; c++) bins[c][data[i + c] >> 2]++;
  return bins;
}
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error('사진을 읽을 수 없습니다. JPG, PNG, WebP 파일인지 확인해 주세요.'));
    image.src = src;
  });
}
export function readDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
    r.readAsDataURL(blob);
  });
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
