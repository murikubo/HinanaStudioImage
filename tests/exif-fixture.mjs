/** A real JPEG APP1/TIFF fixture with known camera and exposure fields. */
export function withExif(jpeg) {
  const tiff = Buffer.alloc(400);
  tiff.write('II');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  const entry = (at, tag, type, count, value) => {
    tiff.writeUInt16LE(tag, at);
    tiff.writeUInt16LE(type, at + 2);
    tiff.writeUInt32LE(count, at + 4);
    tiff.writeUInt32LE(value, at + 8);
  };
  tiff.writeUInt16LE(3, 8);
  entry(10, 0x10f, 2, 7, 200);
  tiff.write('Hinana\0', 200);
  entry(22, 0x110, 2, 13, 215);
  tiff.write('Portrait Cam\0', 215);
  entry(34, 0x8769, 4, 1, 60);
  tiff.writeUInt16LE(4, 60);
  entry(62, 0x829a, 5, 1, 240);
  tiff.writeUInt32LE(1, 240);
  tiff.writeUInt32LE(125, 244);
  entry(74, 0x829d, 5, 1, 248);
  tiff.writeUInt32LE(28, 248);
  tiff.writeUInt32LE(10, 252);
  entry(86, 0x8827, 3, 1, 400);
  entry(98, 0x9003, 2, 20, 260);
  tiff.write('2026:09:14 16:30:00\0', 260);
  const payload = Buffer.concat([Buffer.from('Exif\0\0'), tiff]);
  const marker = Buffer.alloc(4);
  marker.writeUInt16BE(0xffe1);
  marker.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), marker, payload, jpeg.subarray(2)]);
}
