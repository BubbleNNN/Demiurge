'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fitImageReferenceBudget } = require('../electron/image-reference-budget.cjs');
const fixture = require('./fixtures/pet-images.cjs');
const codec = { fit: (bytes) => fixture.decode(bytes), encode: fixture.encode };
function source(number) {
  const bitmap = Buffer.alloc(32 * 48 * 4);
  for (let i = 0; i < bitmap.length; i += 4) {
    bitmap[i] = number * 15;
    bitmap[i + 1] = 70;
    bitmap[i + 2] = 180;
    bitmap[i + 3] = 255;
  }
  return { name: `reference-${number}.png`, bytes: fixture.encode(bitmap, 32, 48) };
}
test('up to five attachments keep original byte objects and skip decoding', () => {
  for (let n = 0; n <= 5; n++) {
    const sources = Array.from({ length: n }, (_, i) => source(i + 1));
    const result = fitImageReferenceBudget(sources, {
      fit() {
        throw Error('must not decode');
      },
    });
    assert.equal(result.sources, sources);
    assert.equal(result.mapping, '');
  }
});
for (const n of [6, 9, 12])
  test(`${n} source images fit five paths without losing a source or renumbering`, () => {
    const sources = Array.from({ length: n }, (_, i) => source(i + 1));
    const result = fitImageReferenceBudget(sources, codec);
    assert.equal(result.sources.length, 5);
    for (let i = 0; i < 4; i++) assert.equal(result.sources[i], sources[i]);
    const board = fixture.decode(result.sources[4].bytes);
    for (let i = 4; i < n; i++) {
      const index = i - 4,
        x = (index % 2) * 1024 + 512,
        y = Math.floor(index / 2) * 1064 + 40 + 512;
      const offset = (y * board.width + x) * 4;
      assert.deepEqual([...board.bitmap.subarray(offset, offset + 4)], [(i + 1) * 15, 70, 180, 255]);
      assert.ok(result.mapping.includes(`source image ${i + 1} = attachment 5`));
    }
    assert.match(result.mapping, /never copy/);
    assert.match(result.mapping, /SOURCE numbers/);
  });
test('invalid or oversized boards fail before model transport', () => {
  const sources = Array.from({ length: 6 }, (_, i) => source(i + 1));
  assert.throws(
    () =>
      fitImageReferenceBudget(sources, {
        ...codec,
        fit: () => ({ width: 3000, height: 1, bitmap: Buffer.alloc(0) }),
      }),
    /未发送/,
  );
  assert.throws(
    () => fitImageReferenceBudget(sources, { ...codec, encode: () => Buffer.alloc(8 * 1024 * 1024 + 1) }),
    /未发送/,
  );
  assert.throws(
    () =>
      fitImageReferenceBudget(
        Array.from({ length: 13 }, () => sources[0]),
        codec,
      ),
    /过多/,
  );
});
