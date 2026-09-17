import { dataURLBytes } from './image-bytes.ts';
import exifr from 'exifr';
import { extractExif } from './exif-export.ts';
export type Metadata = {
  status: 'ready' | 'empty' | 'error';
  fields: { label: string; value: string }[];
};
/** Only display camera fields; no maker notes, thumbnails, or remote requests. */
export async function readMetadata(input: Blob | string | Uint8Array): Promise<Metadata> {
  try {
    let raw: Uint8Array;
    if (typeof input === 'string') {
      raw = dataURLBytes(input);
    } else if (input instanceof Blob) raw = new Uint8Array(await input.arrayBuffer());
    else raw = input;
    const tags = await exifr.parse(extractExif(raw) || raw, {
      pick: [
        'Make',
        'Model',
        'LensModel',
        'DateTimeOriginal',
        'OffsetTimeOriginal',
        'ExposureTime',
        'FNumber',
        'ISO',
        'FocalLength',
        'FocalLengthIn35mmFormat',
        'ExposureBiasValue',
        'ExposureProgram',
        'MeteringMode',
        'Flash',
        'WhiteBalance',
        'Software',
        'Artist',
        'Copyright',
        'Orientation',
      ],
      reviveValues: false,
      gps: false,
      makerNote: false,
      userComment: false,
    });
    const fields: Metadata['fields'] = [];
    const add = (label: string, value: unknown) => {
      if (value !== undefined && value !== null && value !== '')
        fields.push({ label, value: String(value).replace(/\0/g, '').slice(0, 300) });
    };
    const number = (key: string): number | undefined =>
      typeof tags?.[key] === 'number' && Number.isFinite(tags[key]) ? tags[key] : undefined;
    if (tags) {
      add('카메라', [tags.Make, tags.Model].filter(Boolean).join(' '));
      add('렌즈', tags.LensModel);
      add(
        '촬영 일시',
        tags.DateTimeOriginal
          ? `${tags.DateTimeOriginal}${tags.OffsetTimeOriginal ? ` ${tags.OffsetTimeOriginal}` : ' (현지 시각)'}`
          : undefined,
      );
      const exposure = number('ExposureTime');
      add(
        '셔터 속도',
        exposure && exposure > 0
          ? `${exposure < 1 ? `1/${Math.round(1 / exposure)}` : exposure} s`
          : undefined,
      );
      const aperture = number('FNumber');
      add('조리개', aperture ? `f/${aperture}` : undefined);
      add('ISO', tags.ISO);
      const focal = number('FocalLength');
      add('초점 거리', focal ? `${focal} mm` : undefined);
      const eq = number('FocalLengthIn35mmFormat');
      add('35mm 환산', eq ? `${eq} mm` : undefined);
      const bias = number('ExposureBiasValue');
      add(
        '노출 보정',
        bias !== undefined ? `${bias > 0 ? '+' : ''}${Math.round(bias * 100) / 100} EV` : undefined,
      );
      for (const [label, key] of [
        ['노출 모드', 'ExposureProgram'],
        ['측광 모드', 'MeteringMode'],
        ['화이트밸런스', 'WhiteBalance'],
        ['플래시', 'Flash'],
        ['원본 방향', 'Orientation'],
        ['소프트웨어', 'Software'],
        ['촬영자', 'Artist'],
        ['저작권', 'Copyright'],
      ])
        add(label, tags[key]);
    }
    return { status: fields.length ? 'ready' : 'empty', fields };
  } catch {
    return { status: 'error', fields: [] };
  }
}
