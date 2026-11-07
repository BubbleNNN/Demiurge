'use strict';
const { deflateSync, inflateSync } = require('node:zlib');
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type),
    result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length);
  name.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), result.length - 4);
  return result;
}
function encode(bitmap, width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++)
    bitmap.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function decode(bytes) {
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20),
    pieces = [];
  for (let offset = 8; offset < bytes.length; ) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT')
      pieces.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const rows = inflateSync(Buffer.concat(pieces)),
    bitmap = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    if (rows[y * (width * 4 + 1)] !== 0) throw new Error('Fixture decoder only accepts unfiltered RGBA');
    rows.copy(bitmap, y * width * 4, y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1));
  }
  return { width, height, bitmap };
}
function image(sheet = false, options = {}) {
  const cell = 128,
    columns = sheet && options.frames === 8 ? 4 : 2,
    cellWidth = sheet && options.frames === 8 ? 96 : cell,
    width = sheet ? cellWidth * columns : cell,
    height = sheet ? cell * 2 : cell,
    bitmap = Buffer.alloc(width * height * 4);
  if (options.opaque)
    for (let i = 0; i < bitmap.length; i += 4) {
      bitmap[i] = 240;
      bitmap[i + 1] = 220;
      bitmap[i + 2] = 235;
      bitmap[i + 3] = 255;
    }
  const rect = (ox, oy, x, y, w, h, color) => {
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) {
        const i = ((oy + yy) * width + ox + xx) * 4;
        bitmap[i] = color[0];
        bitmap[i + 1] = color[1];
        bitmap[i + 2] = color[2];
        bitmap[i + 3] = 255;
      }
  };
  for (let n = 0; n < (sheet ? options.frames || 4 : 1); n++) {
    const ox = (n % columns) * cellWidth,
      oy = Math.floor(n / columns) * cell,
      pose = options.identical ? 0 : n;
    rect(ox, oy, 44, 20, 40, 38, [210, 115, 160]);
    rect(ox, oy, 50, 58, 28, 39, [180, 120, 220]);
    rect(ox, oy, 50, 97, 10, 13, [75, 50, 120]);
    rect(ox, oy, 68, 97, 10, 13, [75, 50, 120]);
    rect(ox, oy, 38, 62 - pose * 7, 10, 29, [215, 150, 185]);
    rect(ox, oy, 80, 62, 10, 29, [215, 150, 185]);
    if (options.cropped) rect(ox, oy, 0, 40, 12, 30, [215, 150, 185]);
  }
  return encode(bitmap, width, height);
}
const url = (bytes) => `data:image/png;base64,${bytes.toString('base64')}`;
module.exports = { encode, decode, image, url, codec: { encode, decode } };
