import { test } from 'node:test';
import assert from 'node:assert/strict';
import exifr from 'exifr';
import { PNG } from 'pngjs';
import piexif from 'piexifjs';
import { rawExif, attachPngExif } from '../electron/raw-exif.mjs';
const decoder = {
  getIParams: () => ({ make: 'Test', model: 'Camera' }),
  getImgOther: () => ({ iso_speed: 3200, shutter: 1 / 8000, aperture: 2.8, focal_len: 50 }),
  getLensInfo: () => ({ Lens: 'Lens 50' }),
};
test('portable RAW metadata fallback survives PNG encoding with exact fast exposure', async () => {
  const tiff = await rawExif(Buffer.from('no tags'), decoder, 2, 1);
  const source = new PNG({ width: 2, height: 1 });
  source.data.fill(255);
  const png = attachPngExif(PNG.sync.write(source), tiff);
  assert.deepEqual(PNG.sync.read(png).data, source.data);
  const tags = await exifr.parse(png, { translateValues: false });
  assert.equal(tags.Model, 'Camera');
  assert.equal(tags.ISO, 3200);
  assert.equal(tags.ExposureTime, 1 / 8000);
  assert.equal(tags.LensModel, 'Lens 50');
  assert.equal(tags.Orientation, 1);
  assert.equal(tags.ExifImageWidth, 2);
});
test('portable RAW metadata retains source camera, local date and GPS including sea level', async () => {
  const input = Buffer.from(
    piexif
      .dump({
        '0th': { 272: 'Original camera' },
        Exif: { 36867: '2026:09:15 10:20:30' },
        GPS: {
          1: 'N',
          2: [
            [37, 1],
            [30, 1],
            [1, 2],
          ],
          3: 'E',
          4: [
            [127, 1],
            [1, 1],
            [0, 1],
          ],
          5: 0,
          6: [0, 1],
        },
      })
      .slice(6),
    'binary',
  );
  const result = await rawExif(input, decoder, 100, 200);
  const tags = await exifr.parse(result, { translateValues: false, reviveValues: false });
  assert.equal(tags.Model, 'Original camera');
  assert.equal(tags.DateTimeOriginal, '2026:09:15 10:20:30');
  assert.deepEqual(tags.GPSLatitude, [37, 30, 0.5]);
  assert.deepEqual(tags.GPSLongitude, [127, 1, 0]);
  assert.equal(tags.GPSAltitude, 0);
});
