'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateAnimation, parseAseprite } = require('../electron/sprites.cjs');
const animation = {
  width: 32,
  height: 48,
  frames: [
    { rect: [0, 0, 32, 48], duration: 100 },
    { rect: [32, 0, 32, 48], duration: 140 },
  ],
  clips: { idle: { frames: [0], loop: true }, wave: { frames: [0, 1, 0], durations: [100, 200, 100] } },
};
test('sprite manifests reject invalid timing, coordinates, indices and palettes', () => {
  assert.equal(validateAnimation(animation, { width: 64, height: 48 }).clips.wave.frames.length, 3);
  assert.throws(() => validateAnimation(animation, { width: 40, height: 48 }), /边界/);
  for (const a of [
    { ...animation, width: 0 },
    { ...animation, frames: [{ rect: [-1, 0, 1, 1], duration: 100 }] },
    { ...animation, clips: { idle: { frames: [2] } } },
    { ...animation, clips: { idle: { frames: [0], durations: [0] } } },
    { ...animation, clips: { idle: { frames: [0], durations: [] } } },
    { ...animation, palette: ['<script>'] },
    { ...animation, clips: { arbitraryCode: { frames: [0] } } },
  ])
    assert.throws(() => validateAnimation(a));
});
test('Aseprite import preserves cels, durations and ping-pong direction', () => {
  const source = {
    frames: Array.from({ length: 3 }, (_, i) => ({
      frame: { x: i * 32, y: 0, w: 32, h: 48 },
      duration: 100 + i * 20,
      trimmed: false,
      rotated: false,
    })),
    meta: { image: 'pet.png', frameTags: [{ name: 'wave', from: 0, to: 2, direction: 'pingpong' }] },
  };
  const parsed = parseAseprite(source);
  assert.deepEqual(parsed.animation.clips.wave.frames, [0, 1, 2, 1]);
  assert.equal(parsed.animation.frames[2].duration, 140);
  assert.deepEqual(parsed.animation.clips.idle.frames, [0]);
  assert.throws(
    () => parseAseprite({ ...source, frames: [{ ...source.frames[0], trimmed: true }] }),
    /关闭 trim/,
  );
});

test('sprite import embeds local bytes and rejects traversals and escaped symlinks', async (t) => {
  const fs = require('node:fs/promises'),
    path = require('node:path'),
    os = require('node:os');
  const { readSprite } = require('../electron/sprites.cjs');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mori-sprite-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'pack');
  await fs.mkdir(root);
  const png = await fs.readFile('public/art/cyrene-chibi-v6-reference.png');
  await fs.writeFile(path.join(root, 'pet.png'), png);
  const file = path.join(root, 'pet.json');
  const write = (image) => fs.writeFile(file, JSON.stringify({ version: 1, image, animation }));
  await write('pet.png');
  const imported = await readSprite(file, 'cyrene', '8bit', () => ({ width: 1536, height: 1024 }));
  assert.equal(imported.characterId, 'cyrene');
  assert.deepEqual(Buffer.from(imported.images.neutral.split(',')[1], 'base64'), png);
  const aseprite = {
    frames: [{ frame: { x: 0, y: 0, w: 32, h: 48 }, duration: 100 }],
    meta: { image: 'pet.png', frameTags: [] },
  };
  await fs.writeFile(file, JSON.stringify(aseprite));
  assert.equal(
    (await readSprite(file, 'cyrene', 'watercolor', () => ({ width: 1536, height: 1024 }))).sprite.pixelated,
    false,
  );
  assert.equal(
    (await readSprite(file, 'cyrene', '8bit', () => ({ width: 1536, height: 1024 }))).sprite.pixelated,
    true,
  );
  for (const image of ['../outside.png', '/tmp/outside.png', 'https://example.org/a.png']) {
    await write(image);
    await assert.rejects(readSprite(file, 'cyrene', '8bit', () => ({ width: 1536, height: 1024 })));
  }
  await fs.writeFile(path.join(dir, 'outside.png'), png);
  await fs.symlink(path.join(dir, 'outside.png'), path.join(root, 'escape.png'));
  await write('escape.png');
  await assert.rejects(
    readSprite(file, 'cyrene', '8bit', () => ({ width: 1536, height: 1024 })),
    /同一目录/,
  );
  await write('pet.png');
  await assert.rejects(
    readSprite(file, 'cyrene', '8bit', () => ({ width: 8193, height: 1024 })),
    /尺寸/,
  );
});
