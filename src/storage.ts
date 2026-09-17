import { validateMasks } from './local-masks.ts';
import { readMetadata, type Metadata } from './metadata';
import { defaults, type Adjustments } from './engine';
export type Photo = {
  id: string;
  name: string;
  src: string;
  width: number;
  height: number;
  rating: number;
  metadata?: Metadata;
  rawSource?: string;
  adjustments: Adjustments;
  history: Adjustments[];
  cursor: number;
};
export type Project = { version: 1 | 2 | 3; photos: Photo[]; selected: string };
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('hinana-image', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('workspace');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
let saveQueue: Promise<void> = Promise.resolve();
export function saveWorkspace(project: Project): Promise<void> {
  const write = saveQueue.catch(() => {}).then(() => persistWorkspace(project));
  saveQueue = write;
  return write;
}
async function persistWorkspace(project: Project) {
  const d = await db();
  try {
    await new Promise<void>((resolve, reject) => {
      const t = d.transaction('workspace', 'readwrite');
      t.objectStore('workspace').put(project, 'current');
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    d.close();
  }
}
export async function restoreWorkspace(): Promise<Project | undefined> {
  const d = await db();
  try {
    const project = await new Promise<Project | undefined>((resolve, reject) => {
      const r = d.transaction('workspace').objectStore('workspace').get('current');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    if (project) {
      for (const photo of project.photos) {
        photo.adjustments = { ...defaults, ...photo.adjustments };
        photo.history = photo.history.map((a) => ({ ...defaults, ...a }));
        photo.metadata = await readMetadata(photo.src);
      }
    }
    return project;
  } finally {
    d.close();
  }
}
export function validateProject(value: unknown): Project {
  const p = value as Project;
  if (
    !p ||
    (p.version !== 1 && p.version !== 2 && p.version !== 3) ||
    !Array.isArray(p.photos) ||
    p.photos.length > 200
  )
    throw new Error('지원하지 않는 프로젝트 형식입니다.');
  const ids = new Set<string>();
  for (const photo of p.photos) {
    if (
      !photo ||
      typeof photo.id !== 'string' ||
      ids.has(photo.id) ||
      typeof photo.name !== 'string' ||
      typeof photo.src !== 'string' ||
      !/^data:image\/(jpeg|png|webp);base64,/.test(photo.src) ||
      !Number.isFinite(photo.width) ||
      !Number.isFinite(photo.height) ||
      photo.width <= 0 ||
      photo.height <= 0
    )
      throw new Error('프로젝트의 사진 데이터가 올바르지 않습니다.');
    if (
      photo.rawSource !== undefined &&
      (typeof photo.rawSource !== 'string' ||
        photo.rawSource.length > 168_000_000 ||
        !/^data:application\/octet-stream;base64,[A-Za-z0-9+/]*={0,2}$/.test(photo.rawSource))
    )
      throw new Error('프로젝트의 RAW 원본 데이터가 올바르지 않습니다.');
    ids.add(photo.id);
    const a = { ...defaults, ...photo.adjustments };
    if (!['srgb', 'display-p3'].includes(a.colorSpace))
      throw new Error('지원하지 않는 작업 색공간입니다.');
    if (
      !['legacy', 'float'].includes(a.precision) ||
      !['sdr', 'hdr'].includes(a.dynamicRange) ||
      ![400, 1000, 2000, 4000].includes(a.hdrPeak) ||
      (a.dynamicRange === 'hdr' && a.precision !== 'float')
    )
      throw new Error('지원하지 않는 정밀도/HDR 설정입니다.');
    for (const key of Object.keys(defaults) as (keyof Adjustments)[])
      if (
        typeof a[key] !== typeof defaults[key] ||
        (typeof a[key] === 'number' && !Number.isFinite(a[key]))
      )
        throw new Error('보정 값이 올바르지 않습니다.');
    if (
      !['original', '1:1', '4:5', '3:2', '16:9'].includes(a.crop) ||
      ![0, 90, 180, 270].includes(a.rotation)
    )
      throw new Error('자르기 값이 올바르지 않습니다.');
    for (const key of Object.keys(a) as (keyof Adjustments)[]) {
      if (typeof a[key] === 'number' && key !== 'rotation' && key !== 'hdrPeak') {
        const limit = key === 'exposure' ? 3 : 100;
        if (
          (key.startsWith('skin') && (a[key] as number) < 0) ||
          Math.abs(a[key] as number) > limit
        )
          throw new Error('보정 값 범위를 초과했습니다.');
      }
    }
    a.masks = validateMasks(a.masks);
    photo.adjustments = a;
    photo.history = [a];
    photo.cursor = 0;
    photo.rating = Number.isInteger(photo.rating) ? Math.max(0, Math.min(5, photo.rating)) : 0;
  }
  p.selected = ids.has(p.selected) ? p.selected : p.photos[0]?.id || '';
  return p;
}
