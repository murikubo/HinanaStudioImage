export const colorBands = [
  { id: 'red', name: '빨강', hue: 0, color: '#e77979' },
  { id: 'orange', name: '주황', hue: 30, color: '#e6a066' },
  { id: 'yellow', name: '노랑', hue: 60, color: '#d9cb68' },
  { id: 'green', name: '초록', hue: 120, color: '#8abd7a' },
  { id: 'aqua', name: '청록', hue: 180, color: '#71c6c0' },
  { id: 'blue', name: '파랑', hue: 240, color: '#739ae0' },
  { id: 'purple', name: '보라', hue: 270, color: '#a58cda' },
  { id: 'magenta', name: '자홍', hue: 300, color: '#d487ba' },
] as const;
export type Band = (typeof colorBands)[number]['id'];
export type MixerKey = `mixer_${Band}_${'hue' | 'saturation' | 'luminance'}`;
export type CurveKey = 'curveShadows' | 'curveMidtones' | 'curveHighlights';
export type ColorAdjustments = Record<MixerKey | CurveKey, number>;
export const colorDefaults = Object.fromEntries([
  ...colorBands.flatMap((b) =>
    ['hue', 'saturation', 'luminance'].map((k) => [`mixer_${b.id}_${k}`, 0]),
  ),
  ['curveShadows', 0],
  ['curveMidtones', 0],
  ['curveHighlights', 0],
]) as ColorAdjustments;
export function curvePoints(a: ColorAdjustments): [number, number][] {
  return [
    [0, 0],
    [0.25, 0.25 + a.curveShadows * 0.002],
    [0.5, 0.5 + a.curveMidtones * 0.002],
    [0.75, 0.75 + a.curveHighlights * 0.002],
    [1, 1],
  ];
}
export function curveLut(a: ColorAdjustments) {
  const points = curvePoints(a);
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    const segment = Math.min(3, Math.floor(x * 4));
    const [x0, y0] = points[segment],
      [x1, y1] = points[segment + 1];
    lut[i] = (y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)) * 255;
  }
  return lut;
}
/** Interpolate adjacent hue bands on the circular hue axis, keeping neutrals neutral. */
export function applyColorTools(data: Uint8ClampedArray | Float32Array, a: ColorAdjustments) {
  const mixerOn = colorBands.some((b) =>
    ['hue', 'saturation', 'luminance'].some((k) => a[`mixer_${b.id}_${k}` as MixerKey]),
  );
  const curveOn = !!(a.curveShadows || a.curveMidtones || a.curveHighlights);
  if (!mixerOn && !curveOn) return;
  const floating = data instanceof Float32Array;
  const points = curvePoints(a);
  const continuousCurve = (v: number) => {
    const x = v / 255,
      segment = Math.max(0, Math.min(3, Math.floor(x * 4)));
    const [x0, y0] = points[segment],
      [x1, y1] = points[segment + 1];
    return Math.max(0, (y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)) * 255);
  };
  const lut = curveOn && !floating ? curveLut(a) : undefined;
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    if (mixerOn) {
      const gain = floating ? Math.max(1, data[i] / 255, data[i + 1] / 255, data[i + 2] / 255) : 1;
      const r = data[i] / (255 * gain),
        g = data[i + 1] / (255 * gain),
        b = data[i + 2] / (255 * gain);
      const max = Math.max(r, g, b),
        min = Math.min(r, g, b),
        d = max - min;
      let l = (max + min) / 2;
      if (d > 0.0001) {
        let h =
          (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
        let s = d / (1 - Math.abs(2 * l - 1));
        let left = 7;
        for (let j = 0; j < 7; j++)
          if (h >= colorBands[j].hue && h < colorBands[j + 1].hue) {
            left = j;
            break;
          }
        const right = (left + 1) % 8;
        const lo = colorBands[left].hue,
          hi = right === 0 ? 360 : colorBands[right].hue;
        const t = (h - lo) / (hi - lo),
          weight = t * t * (3 - 2 * t);
        const value = (kind: string) =>
          a[`mixer_${colorBands[left].id}_${kind}` as MixerKey] * (1 - weight) +
          a[`mixer_${colorBands[right].id}_${kind}` as MixerKey] * weight;
        const dh = value('hue'),
          ds = value('saturation'),
          dl = value('luminance');
        if (dh || ds || dl) {
          h = (h + dh * 0.3 + 360) % 360;
          const chromaWeight = Math.min(1, s / 0.15);
          s = Math.max(0, Math.min(1, s * (1 + ds / 100)));
          l = Math.max(0, Math.min(1, l + dl * 0.0035 * chromaWeight));
          const c = (1 - Math.abs(2 * l - 1)) * s,
            x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
            m = l - c / 2;
          const rgb =
            h < 60
              ? [c, x, 0]
              : h < 120
                ? [x, c, 0]
                : h < 180
                  ? [0, c, x]
                  : h < 240
                    ? [0, x, c]
                    : h < 300
                      ? [x, 0, c]
                      : [c, 0, x];
          data[i] = (rgb[0] + m) * 255 * gain;
          data[i + 1] = (rgb[1] + m) * 255 * gain;
          data[i + 2] = (rgb[2] + m) * 255 * gain;
        }
      }
    }
    if (curveOn && floating) {
      data[i] = continuousCurve(data[i]);
      data[i + 1] = continuousCurve(data[i + 1]);
      data[i + 2] = continuousCurve(data[i + 2]);
    }
    if (lut) {
      data[i] = lut[data[i]];
      data[i + 1] = lut[data[i + 1]];
      data[i + 2] = lut[data[i + 2]];
    }
  }
}
