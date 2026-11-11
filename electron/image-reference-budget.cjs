'use strict';

const MAX_PATHS = 5;
const MAX_BYTES = 8 * 1024 * 1024;
const CELL = 1024;
const HEADER = 40;
const DIGITS = [
  '111101101101111',
  '010110010010111',
  '111001111100111',
  '111001111001111',
  '101101111001001',
  '111100111001111',
  '111100111101111',
  '111001001001001',
  '111101111101111',
  '111101111001111',
];

function electronCodec() {
  const { nativeImage } = require('electron');
  return {
    fit(bytes, maxWidth, maxHeight) {
      let image = nativeImage.createFromBuffer(bytes);
      if (image.isEmpty()) throw new Error('无法解码参考图。');
      const { width, height } = image.getSize();
      const scale = Math.min(1, maxWidth / width, maxHeight / height);
      if (scale < 1)
        image = image.resize({
          width: Math.max(1, Math.round(width * scale)),
          height: Math.max(1, Math.round(height * scale)),
          quality: 'best',
        });
      return { ...image.getSize(), bitmap: image.toBitmap() };
    },
    encode: (bitmap, width, height) =>
      nativeImage.createFromBitmap(bitmap, { width, height, scaleFactor: 1 }).toPNG(),
  };
}

/** Keep the first four references untouched; bundle the remaining sources without cropping.
 * Source numbers stay stable, including the motion/identity ranges in existing prompts.
 * The codec uses native bitmap channels consistently; only neutral black/white labels are drawn.
 */
function fitImageReferenceBudget(sources, codec) {
  if (sources.length <= MAX_PATHS) return { sources, mapping: '' };
  if (sources.length > 12) throw new Error('参考图片过多，无法安全整理为五个图像附件。');
  codec ??= electronCodec();
  const tail = sources.slice(MAX_PATHS - 1);
  const columns = Math.min(2, tail.length);
  const rows = Math.ceil(tail.length / columns);
  const width = columns * CELL,
    height = rows * (CELL + HEADER);
  const bitmap = Buffer.alloc(width * height * 4);
  const map = [];
  tail.forEach((source, index) => {
    const image = codec.fit(source.bytes, CELL - 24, CELL - 24);
    if (
      !Number.isInteger(image.width) ||
      !Number.isInteger(image.height) ||
      image.width < 1 ||
      image.height < 1 ||
      image.width > CELL - 24 ||
      image.height > CELL - 24 ||
      !Buffer.isBuffer(image.bitmap) ||
      image.bitmap.length !== image.width * image.height * 4
    )
      throw new Error('参考图整理失败，未发送图像生成请求。');
    const number = index + MAX_PATHS;
    const column = index % columns,
      row = Math.floor(index / columns);
    const left = column * CELL,
      top = row * (CELL + HEADER);
    // A solid neutral header with the original source number; all art is kept below it.
    for (let y = top; y < top + HEADER; y++)
      bitmap.fill(255, (y * width + left) * 4, (y * width + left + CELL) * 4);
    [...String(number)].forEach((digit, d) => {
      const glyph = DIGITS[Number(digit)],
        scale = 5;
      for (let y = 0; y < 5; y++)
        for (let x = 0; x < 3; x++)
          if (glyph[y * 3 + x] === '1') {
            for (let yy = 0; yy < scale; yy++)
              for (let xx = 0; xx < scale; xx++) {
                const offset = ((top + 7 + y * scale + yy) * width + left + 12 + d * 22 + x * scale + xx) * 4;
                bitmap.fill(0, offset, offset + 3);
              }
          }
    });
    const x = left + Math.floor((CELL - image.width) / 2);
    const y = top + HEADER + Math.floor((CELL - image.height) / 2);
    for (let line = 0; line < image.height; line++)
      image.bitmap.copy(
        bitmap,
        ((y + line) * width + x) * 4,
        line * image.width * 4,
        (line + 1) * image.width * 4,
      );
    map.push(
      `source image ${number} = attachment 5, row ${row + 1}, column ${column + 1}, labeled ${number}`,
    );
  });
  const bytes = codec.encode(bitmap, width, height);
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_BYTES)
    throw new Error('合并参考图超过 8 MB，未发送图像生成请求。');
  return {
    sources: [...sources.slice(0, MAX_PATHS - 1), { name: 'reference-board-5.png', bytes }],
    mapping: `Reference attachment map: there are ${sources.length} logical source images in FIVE physical attachments. Every image number and image range in the drawing instructions refers to the original SOURCE numbers, not attachment positions. Source images 1–4 are attachments 1–4 unchanged. Attachment 5 is a reference board: ${map.join('; ')}. Use every labeled source for its originally specified role. The board's labels, empty spacing and layout are reference-only; never copy them into the generated image. Do not substitute a board for the output frame layout.`,
  };
}

module.exports = { fitImageReferenceBudget, MAX_PATHS };
