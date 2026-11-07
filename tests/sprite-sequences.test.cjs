'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { readSequenceFolder } = require('../electron/sprite-sequences.cjs');
// Decoder-independent test bytes. Actual PNG decode/encode is checked in Electron.
function header(width = 2, height = 3, color = 1) {
  const b = Buffer.alloc(25);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(b);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  b[24] = color;
  return b;
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mori-frames-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const frame = async (clip, name, bytes = header()) => {
    await fs.mkdir(path.join(root, clip), { recursive: true });
    await fs.writeFile(path.join(root, clip, name), bytes);
  };
  let packed;
  const codec = {
    decode: (b) => ({
      width: b.readUInt32BE(16),
      height: b.readUInt32BE(20),
      bitmap: Buffer.alloc(b.readUInt32BE(16) * b.readUInt32BE(20) * 4, b[24]),
    }),
    encode: (bitmap, width, height) => {
      packed = { bitmap, width, height };
      return header(width, height);
    },
  };
  return { root, frame, codec, packed: () => packed };
}
test('PNG sequence import preserves authored pixels, natural frame order and per-action timing', async (t) => {
  const f = await fixture(t);
  await f.frame('idle', '001.png', header(2, 3, 5));
  for (const n of [10, 2, 1]) await f.frame('wave', `${n}.png`, header(2, 3, n));
  await fs.writeFile(
    path.join(f.root, 'pet.json'),
    JSON.stringify({
      name: '水彩',
      frameDuration: 120,
      clips: { wave: { durations: [80, 200, 90], loop: false } },
    }),
  );
  const skin = await readSequenceFolder(f.root, 'character', 'watercolor', f.codec),
    atlas = f.packed();
  assert.equal(skin.name, '水彩');
  assert.equal(skin.generated, false);
  assert.equal(skin.generation, undefined);
  assert.equal(skin.sprite.pixelated, false);
  assert.deepEqual(skin.sprite.clips.wave, { frames: [1, 2, 3], durations: [80, 200, 90], loop: false });
  assert.equal(skin.sprite.frames[0].duration, 120);
  assert.equal(skin.sprite.clips.idle.loop, true);
  for (const [i, color] of [5, 1, 2, 10].entries()) {
    const [x, y, w, h] = skin.sprite.frames[i].rect;
    for (let row = 0; row < h; row++)
      assert.deepEqual(
        atlas.bitmap.subarray(((y + row) * atlas.width + x) * 4, ((y + row) * atlas.width + x + w) * 4),
        Buffer.alloc(w * 4, color),
      );
  }
});
test('the same authored animation accepts every art style with appropriate pixel filtering', async (t) => {
  const f = await fixture(t);
  await f.frame('idle', '1.png');
  for (const style of Object.keys(require('../shared/art-styles.json'))) {
    const skin = await readSequenceFolder(f.root, 'c', style, f.codec);
    assert.equal(skin.sprite.pixelated, ['pixel', '8bit'].includes(style));
    assert.deepEqual(skin.sprite.clips.idle.frames, [0]);
  }
});
test('frame folders reject missing idle, cropped canvases and malformed action timing', async (t) => {
  const f = await fixture(t);
  await f.frame('wave', '1.png');
  await assert.rejects(readSequenceFolder(f.root, 'c', 'anime', f.codec), /idle/);
  await f.frame('idle', '1.png', header(3, 3));
  await assert.rejects(readSequenceFolder(f.root, 'c', 'anime', f.codec), /相同画布/);
  await f.frame('idle', '1.png');
  for (const meta of [
    { frameDuration: 0 },
    { clips: { wave: { durations: [] } } },
    { clips: { wave: { loop: 'yes' } } },
    { clips: { execute: {} } },
  ]) {
    await fs.writeFile(path.join(f.root, 'pet.json'), JSON.stringify(meta));
    await assert.rejects(readSequenceFolder(f.root, 'c', 'anime', f.codec));
  }
});
test('frame imports reject escaped files, directories and metadata symlinks', async (t) => {
  const f = await fixture(t);
  await f.frame('idle', '1.png');
  const outside = path.join(f.root, 'outside.png');
  await fs.writeFile(outside, header());
  await fs.symlink(outside, path.join(f.root, 'idle', '2.png'));
  await assert.rejects(readSequenceFolder(f.root, 'c', 'anime', f.codec), /真实 PNG/);
  await fs.unlink(path.join(f.root, 'idle', '2.png'));
  await fs.symlink(path.join(f.root, 'idle'), path.join(f.root, 'wave'));
  await assert.rejects(readSequenceFolder(f.root, 'c', 'anime', f.codec), /真实文件夹/);
  await fs.unlink(path.join(f.root, 'wave'));
  await fs.symlink(outside, path.join(f.root, 'pet.json'));
  await assert.rejects(readSequenceFolder(f.root, 'c', 'anime', f.codec), /pet.json/);
});
test('oversized frame headers and excessive counts fail before native decoding', async (t) => {
  const f = await fixture(t);
  let decoded = 0;
  const codec = {
    ...f.codec,
    decode: (b) => {
      decoded++;
      return f.codec.decode(b);
    },
  };
  await f.frame('idle', '1.png', header(8192, 8192));
  await assert.rejects(readSequenceFolder(f.root, 'c', 'anime', codec), /2048/);
  assert.equal(decoded, 0);
  await f.frame('idle', '1.png');
  for (let i = 2; i <= 257; i++) await f.frame('idle', `${i}.png`);
  await assert.rejects(readSequenceFolder(f.root, 'c', 'anime', codec), /256/);
  assert.equal(decoded, 0);
});
