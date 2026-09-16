import { deflateSync } from 'node:zlib';
import exifr from 'exifr';
import piexif from 'piexifjs';
// Rebuild standard metadata: camera-specific offsets and RAW pixel strips cannot
// be copied into a PNG/JPEG TIFF directory. The original stays in the project.
export async function rawExif(input, decoder, width, height, colorSpace = 'srgb') {
  const camera = decoder.getIParams(),
    other = decoder.getImgOther(),
    lens = decoder.getLensInfo();
  let tags = {};
  try {
    tags = (await exifr.parse(input, { translateValues: false, reviveValues: false })) || {};
  } catch {}
  const zeroth = {
    [piexif.ImageIFD.Orientation]: 1,
    [piexif.ImageIFD.ImageWidth]: width,
    [piexif.ImageIFD.ImageLength]: height,
    [piexif.ImageIFD.Software]: 'Hinana Studio Image',
  };
  const exif = {
    [piexif.ExifIFD.PixelXDimension]: width,
    [piexif.ExifIFD.PixelYDimension]: height,
    [piexif.ExifIFD.ColorSpace]: colorSpace === 'display-p3' ? 65535 : 1,
  };
  const string = (target, id, value) => {
    if (typeof value === 'string' && value.trim())
      target[id] = value.slice(0, 1000).replace(/[^\x20-\x7e]/g, '?');
  };
  const rational = (target, id, value) => {
    if (Number.isFinite(value) && value > 0 && value < 40000) {
      const denominator = Math.min(1000000, Math.floor(0xffffffff / value));
      target[id] = [Math.round(value * denominator), denominator];
    }
  };
  string(zeroth, piexif.ImageIFD.Make, tags.Make || camera.make);
  string(zeroth, piexif.ImageIFD.Model, tags.Model || camera.model);
  string(zeroth, piexif.ImageIFD.Artist, tags.Artist || other.artist);
  string(zeroth, piexif.ImageIFD.Copyright, tags.Copyright);
  string(exif, piexif.ExifIFD.LensModel, tags.LensModel || lens.Lens);
  string(exif, piexif.ExifIFD.DateTimeOriginal, tags.DateTimeOriginal);
  string(exif, piexif.ExifIFD.DateTimeDigitized, tags.CreateDate);
  rational(exif, piexif.ExifIFD.ExposureTime, tags.ExposureTime ?? other.shutter);
  rational(exif, piexif.ExifIFD.FNumber, tags.FNumber ?? other.aperture);
  rational(exif, piexif.ExifIFD.FocalLength, tags.FocalLength ?? other.focal_len);
  const iso = tags.ISO ?? other.iso_speed;
  if (Number.isFinite(iso) && iso > 0 && iso <= 65535)
    exif[piexif.ExifIFD.ISOSpeedRatings] = Math.round(iso);
  const gps = {};
  for (const name of ['GPSLatitude', 'GPSLongitude', 'GPSTimeStamp']) {
    if (
      Array.isArray(tags[name]) &&
      tags[name].length === 3 &&
      tags[name].every((v) => Number.isFinite(v) && v >= 0 && v < 360)
    )
      gps[piexif.GPSIFD[name]] = tags[name].map((v) => [Math.round(v * 1000000), 1000000]);
  }
  for (const name of ['GPSLatitudeRef', 'GPSLongitudeRef', 'GPSDateStamp'])
    string(gps, piexif.GPSIFD[name], tags[name]);
  rational(gps, piexif.GPSIFD.GPSAltitude, tags.GPSAltitude);
  if (tags.GPSAltitude === 0) gps[piexif.GPSIFD.GPSAltitude] = [0, 1];
  if (tags.GPSAltitudeRef === 0 || tags.GPSAltitudeRef === 1)
    gps[piexif.GPSIFD.GPSAltitudeRef] = tags.GPSAltitudeRef;
  return Buffer.from(piexif.dump({ '0th': zeroth, Exif: exif, GPS: gps }).slice(6), 'binary');
}
export function attachPngExif(png, tiff) {
  return attachPngChunk(png, 'eXIf', tiff);
}
export function attachPngICC(png, icc) {
  return attachPngChunk(
    png,
    'iCCP',
    Buffer.concat([Buffer.from('Display P3\0\0'), deflateSync(icc)]),
  );
}
function attachPngChunk(png, type, tiff) {
  const body = Buffer.concat([Buffer.from(type), tiff]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const size = Buffer.alloc(4),
    checksum = Buffer.alloc(4);
  size.writeUInt32BE(tiff.length);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([png.subarray(0, 33), size, body, checksum, png.subarray(33)]);
}
