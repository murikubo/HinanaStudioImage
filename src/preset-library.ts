import { defaults, type Adjustments } from './engine.ts';
import { colorBands } from './color-tools.ts';
import { parseCube, validateCube } from './cube-lut.ts';
export type PresetKind = 'portrait' | 'color' | 'combined';
export type UserPreset = {
  id: string;
  name: string;
  kind: PresetKind;
  values: Partial<Adjustments>;
  warnings: string[];
};
const excluded = new Set(['rotation', 'hdrPeak', 'hdrHighlights']);
export const presetKeys = Object.keys(defaults).filter(
  (k) => typeof defaults[k as keyof Adjustments] === 'number' && !excluded.has(k),
);
function inGroup(key: string, kind: PresetKind) {
  return (
    kind === 'combined' || (kind === 'portrait' ? key.startsWith('skin') : !key.startsWith('skin'))
  );
}
export function capturePreset(a: Adjustments, kind: PresetKind): Partial<Adjustments> {
  const values = Object.fromEntries(
    presetKeys.filter((k) => inGroup(k, kind)).map((k) => [k, a[k as keyof Adjustments]]),
  );
  if (kind !== 'portrait') values.colorLut = a.colorLut;
  return structuredClone(values) as Partial<Adjustments>;
}
export function validatePreset(value: unknown): UserPreset {
  const v = value as UserPreset;
  if (
    !v ||
    typeof v.id !== 'string' ||
    !v.id.length ||
    v.id.length > 100 ||
    typeof v.name !== 'string' ||
    !v.name.trim() ||
    v.name.length > 100 ||
    !['portrait', 'color', 'combined'].includes(v.kind) ||
    !v.values ||
    Array.isArray(v.values)
  )
    throw Error('프리셋 형식이 올바르지 않습니다.');
  const values: Record<string, unknown> = {};
  for (const [key, n] of Object.entries(v.values)) {
    if (!inGroup(key, v.kind)) throw Error('프리셋 종류와 보정 항목이 다릅니다.');
    if (key === 'colorLut') {
      values[key] = validateCube(n);
      continue;
    }
    if (
      !presetKeys.includes(key) ||
      typeof n !== 'number' ||
      !Number.isFinite(n) ||
      Math.abs(n) > (key === 'exposure' ? 3 : 100) ||
      ((key.startsWith('skin') || key === 'colorLutAmount') && n < 0)
    )
      throw Error('프리셋에 지원하지 않는 보정 값이 있습니다.');
    values[key] = n;
  }
  if (!Object.keys(values).length) throw Error('적용할 보정 값이 없습니다.');
  return {
    id: v.id,
    name: v.name.trim(),
    kind: v.kind,
    values: values as Partial<Adjustments>,
    warnings: Array.isArray(v.warnings)
      ? v.warnings
          .filter((w) => typeof w === 'string')
          .slice(0, 20)
          .map((w) => w.slice(0, 300))
      : [],
  };
}
export function presetValues(preset: UserPreset, amount: number): Partial<Adjustments> {
  const values: Record<string, unknown> = {};
  const strength = Math.max(0, Math.min(100, amount)) / 100;
  if (!strength) return {};
  for (const [key, value] of Object.entries(preset.values)) {
    if (key === 'colorLut') values[key] = value;
    else if (typeof value === 'number') {
      const neutral = defaults[key as keyof Adjustments] as number;
      values[key] = neutral + (value - neutral) * strength;
    }
  }
  if (preset.values.colorLut)
    values.colorLutAmount = (preset.values.colorLutAmount ?? 100) * strength;
  return values as Partial<Adjustments>;
}
const xmpMap: Record<string, string> = {
  Exposure2012: 'exposure',
  Contrast2012: 'contrast',
  Highlights2012: 'highlights',
  Shadows2012: 'shadows',
  Whites2012: 'whites',
  Blacks2012: 'blacks',
  Vibrance: 'vibrance',
  Saturation: 'saturation',
  PostCropVignetteAmount: 'vignette',
};
for (const band of colorBands) {
  const name = band.id[0].toUpperCase() + band.id.slice(1);
  for (const [crs, key] of [
    ['Hue', 'hue'],
    ['Saturation', 'saturation'],
    ['Luminance', 'luminance'],
  ])
    xmpMap[`${crs}Adjustment${name}`] = `mixer_${band.id}_${key}`;
}
export function mapXmp(fields: Record<string, string>): {
  values: Partial<Adjustments>;
  warnings: string[];
} {
  const values: Record<string, unknown> = {},
    unsupported: string[] = [];
  const metadata = new Set([
    'Name',
    'Group',
    'UUID',
    'Version',
    'ProcessVersion',
    'PresetType',
    'SupportsAmount',
    'SupportsColor',
    'SupportsMonochrome',
    'SupportsHighDynamicRange',
    'SupportsNormalDynamicRange',
    'SupportsSceneReferred',
    'SupportsOutputReferred',
    'CameraModelRestriction',
    'Copyright',
    'ContactInfo',
    'Description',
    'HasSettings',
    'AlreadyApplied',
  ]);
  for (const [field, text] of Object.entries(fields)) {
    const key = xmpMap[field];
    if (key) {
      const n = Number(text);
      if (!text.trim() || !Number.isFinite(n)) throw Error(`XMP ${field} 값이 올바르지 않습니다.`);
      const limit = key === 'exposure' ? 3 : 100;
      if (Math.abs(n) > limit) unsupported.push(`${field}: 범위 제한`);
      values[key] = Math.max(-limit, Math.min(limit, key === 'vignette' ? -n : n));
    } else if (field === 'ConvertToGrayscale' && text.toLowerCase() === 'true')
      values.saturation = -100;
    else if (!metadata.has(field) && text && text !== '0' && text !== 'False' && text !== 'false')
      unsupported.push(field);
  }
  if (!Object.keys(values).length)
    throw Error('이 XMP에는 지원하는 기본 색상·HSL 보정이 없습니다.');
  return {
    values: values as Partial<Adjustments>,
    warnings: [
      '색상 엔진 차이로 이보토·Lightroom의 결과와 다를 수 있습니다.',
      ...(unsupported.length ? [`제외된 설정: ${unsupported.join(', ').slice(0, 260)}`] : []),
    ],
  };
}
export function importPreset(text: string, filename: string): UserPreset {
  if (text.length > 24_000_000) throw Error('프리셋 파일은 24MB 이하만 지원합니다.');
  const name = filename.replace(/\.[^.]+$/, '').slice(0, 100) || '가져온 프리셋';
  const base = {
    id: crypto.randomUUID(),
    name,
    kind: 'color' as PresetKind,
    warnings: [] as string[],
  };
  if (/\.cube$/i.test(filename)) {
    const { lut, name: title } = parseCube(text);
    return validatePreset({
      ...base,
      name: title?.slice(0, 100) || name,
      values: { colorLut: lut, colorLutAmount: 100 },
      warnings: [
        '인코딩된 sRGB용 3D LUT로 적용합니다. Log·카메라 전용 LUT는 입력 변환이 필요합니다.',
      ],
    });
  }
  if (/\.xmp$/i.test(filename)) {
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw Error('외부 선언이 있는 XMP는 지원하지 않습니다.');
    const xml = new DOMParser().parseFromString(text, 'application/xml');
    if (xml.querySelector('parsererror')) throw Error('XMP XML 문서가 올바르지 않습니다.');
    const ns = 'http://ns.adobe.com/camera-raw-settings/1.0/';
    const fields: Record<string, string> = {};
    for (const node of Array.from(xml.getElementsByTagName('*'))) {
      for (const attr of Array.from(node.attributes))
        if (attr.namespaceURI === ns) fields[attr.localName] = attr.value;
      if (node.namespaceURI === ns) fields[node.localName] = node.textContent?.trim() || '';
    }
    const mapped = mapXmp(fields);
    return validatePreset({ ...base, name: fields.Name?.slice(0, 100) || name, ...mapped });
  }
  if (!/\.(hinanapreset|json)$/i.test(filename))
    throw Error('Hinana 프리셋·XMP·CUBE 파일을 선택해 주세요.');
  const envelope = JSON.parse(text);
  if (envelope.format !== 'hinana-preset' || envelope.version !== 1)
    throw Error('지원하지 않는 프리셋 파일입니다.');
  return validatePreset({ ...envelope.preset, id: base.id });
}
export function exportPreset(preset: UserPreset): string {
  return JSON.stringify(
    { format: 'hinana-preset', version: 1, preset: validatePreset(preset) },
    null,
    2,
  );
}
export function exportXmp(preset: UserPreset): string {
  const valid = validatePreset(preset);
  const fields = Object.entries(xmpMap)
    .filter(([, key]) => typeof valid.values[key as keyof Adjustments] === 'number')
    .map(
      ([field, key]) =>
        `crs:${field}="${(valid.values[key as keyof Adjustments] as number) * (key === 'vignette' ? -1 : 1)}"`,
    );
  if (!fields.length) throw Error('XMP로 내보낼 기본 색상·HSL 보정이 없습니다.');
  const name = valid.name.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" crs:PresetType="Normal" crs:ProcessVersion="11.0" ${fields.join(' ')}><crs:Name><rdf:Alt><rdf:li xml:lang="x-default">${name}</rdf:li></rdf:Alt></crs:Name></rdf:Description></rdf:RDF></x:xmpmeta>`;
}
export const portraitPresets: UserPreset[] = [
  {
    id: 'portrait-natural',
    name: '내추럴 인물',
    kind: 'portrait',
    values: {
      skinSmooth: 22,
      skinRedness: 18,
      skinBrightness: 5,
      skinUniformity: 20,
      skinShine: 10,
    },
    warnings: [],
  },
  {
    id: 'portrait-matte',
    name: '매트 스킨',
    kind: 'portrait',
    values: {
      skinSmooth: 35,
      skinRedness: 25,
      skinBrightness: 8,
      skinUniformity: 35,
      skinShine: 50,
    },
    warnings: [],
  },
  {
    id: 'portrait-soft',
    name: '소프트 인물',
    kind: 'combined',
    values: {
      skinSmooth: 38,
      skinRedness: 20,
      skinBrightness: 12,
      skinUniformity: 30,
      skinShine: 20,
      contrast: -8,
      highlights: -15,
      shadows: 12,
      temperature: 4,
      saturation: -5,
    },
    warnings: [],
  },
];

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('hinana-preset-library', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('library');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function loadPresets(): Promise<UserPreset[]> {
  const db = await database();
  try {
    const data = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction('library').objectStore('library').get('presets');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (data === undefined) return [];
    if (!Array.isArray(data) || data.length > 100)
      throw Error('프리셋 보관함이 올바르지 않습니다.');
    return data.map(validatePreset);
  } finally {
    db.close();
  }
}
export async function storePresets(presets: UserPreset[]): Promise<void> {
  if (presets.length > 100) throw Error('사용자 프리셋은 최대 100개까지 저장할 수 있습니다.');
  const data = presets.map(validatePreset),
    db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('library', 'readwrite');
      transaction.objectStore('library').put(data, 'presets');
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () =>
        reject(transaction.error || Error('프리셋 저장에 실패했습니다.'));
    });
  } finally {
    db.close();
  }
}
