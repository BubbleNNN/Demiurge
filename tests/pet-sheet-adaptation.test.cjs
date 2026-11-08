'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { splitSheet, inspectSheet, packFrames } = require('../electron/pet-frames.cjs');
const f = require('./fixtures/pet-images.cjs');

// Non-divisible output with the same equal-cell contract, not a resize of a pet.
function oddSheet({ columns = 2, w = 255, h = 259, clipped = false } = {}) {
  const source = f.decode(f.image(true, { frames: columns * 2 }));
  const sw = source.width / columns,
    sh = source.height / 2;
  const bitmap = Buffer.alloc(w * h * 4);
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < columns; c++) {
      const x0 = Math.floor((c * w) / columns),
        y0 = Math.floor((r * h) / 2);
      const cw = Math.floor(((c + 1) * w) / columns) - x0;
      const ch = Math.floor(((r + 1) * h) / 2) - y0;
      for (let y = 0; y < ch; y++)
        for (let x = 0; x < cw; x++) {
          const to = ((y0 + y) * w + x0 + x) * 4;
          // Distinct hidden RGB at EVERY source pixel proves lossless cell transfer.
          bitmap[to] = (x * 17 + y + c) % 256;
          if (x < sw && y < sh) {
            const from = ((r * sh + y) * source.width + c * sw + x) * 4;
            if (source.bitmap[from + 3]) source.bitmap.copy(bitmap, to, from, from + 4);
          }
          if (clipped && x === 0 && y > 30 && y < 50) bitmap[to + 3] = 255;
        }
    }
  return { width: w, height: h, bitmap };
}
function asUrl(image) {
  return f.url(f.encode(image.bitmap, image.width, image.height));
}

test('non-divisible 4 and 8 frame outputs preserve every cell pixel with transparent padding only', () => {
  for (const columns of [2, 4]) {
    const source = oddSheet(columns === 2 ? {} : { columns, w: 385, h: 259 });
    const input = asUrl(source),
      options = { frameCount: columns * 2 };
    const { frames, report } = splitSheet(input, f.codec, 'wave', options);
    assert.equal(report.padded, true);
    assert.equal(report.distinctFrames, columns * 2);
    assert.equal(frames[0].width / frames[0].height, columns === 2 ? 1 : 0.75);
    for (let n = 0; n < frames.length; n++) {
      const c = n % columns,
        r = Math.floor(n / columns),
        frame = frames[n];
      const x0 = Math.floor((c * source.width) / columns),
        y0 = Math.floor((r * source.height) / 2);
      const cw = Math.floor(((c + 1) * source.width) / columns) - x0;
      const ch = Math.floor(((r + 1) * source.height) / 2) - y0;
      const dx = Math.floor((frame.width - cw) / 2),
        dy = frame.height - ch;
      for (let y = 0; y < ch; y++) {
        const from = ((y0 + y) * source.width + x0) * 4;
        const to = ((y + dy) * frame.width + dx) * 4;
        assert.deepEqual(frame.bitmap.subarray(to, to + cw * 4), source.bitmap.subarray(from, from + cw * 4));
      }
    }
    assert.equal(input, asUrl(source), 'Input bytes remain unchanged');
    const packed = packFrames(f.url(f.image()), { wave: input }, 'sticker', f.codec, options);
    assert.ok(packed.warnings.some((w) => w.includes('补透明留白')));
    assert.equal(packed.sprite.clips.wave.frames.at(-1), 0);
  }
});

test('normalization cannot hide a clipped original cell or silently reinterpret another grid', () => {
  assert.throws(() => inspectSheet(asUrl(oddSheet({ clipped: true })), f.codec, 'wave'), /裁切/);
  assert.throws(() => inspectSheet(f.url(f.image(true)), f.codec, 'wave', { frameCount: 8 }), /八帧/);
  assert.throws(() => inspectSheet(f.url(f.image(true, { frames: 8 })), f.codec, 'wave'), /四帧/);
  assert.equal(inspectSheet(f.url(f.image(true)), f.codec, 'wave').padded, false);
});

function fakeVariation(kind, frames = 4) {
  const image = f.decode(f.image(true, { identical: true, frames }));
  const columns = frames === 8 ? 4 : 2,
    cw = image.width / columns;
  for (let n = 0; n < frames; n++) {
    const ox = (n % columns) * cw,
      oy = Math.floor(n / columns) * 128;
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < cw; x++) {
        const i = ((oy + y) * image.width + ox + x) * 4;
        if (kind === 'hidden' && !image.bitmap[i + 3]) image.bitmap[i] = n * 31;
        if (kind === 'noise' && image.bitmap[i + 3]) image.bitmap[i] += n;
      }
    if (kind === 'single-pixel') image.bitmap[((oy + 70) * image.width + ox + 60) * 4] += n * 20;
  }
  return asUrl(image);
}
test('hidden RGB, tiny color noise and isolated pixel edits cannot pass as authored motion', () => {
  for (const kind of ['hidden', 'noise', 'single-pixel'])
    for (const frameCount of [4, 8])
      assert.throws(
        () => inspectSheet(fakeVariation(kind, frameCount), f.codec, 'blink', { frameCount }),
        /可见变化/,
      );
  // A small mouth/eyelid region is legitimate; requiring a whole-body change would reject it.
  const value = f.decode(f.image(true, { identical: true }));
  for (let x = 60; x < 66; x++) value.bitmap[(40 * value.width + 128 + x) * 4] = 0;
  assert.equal(inspectSheet(asUrl(value), f.codec, 'blink').distinctFrames, 2);
});

test('sticker packing clears near-transparent residue only in derivatives; other media keep it', () => {
  const master = f.decode(f.image());
  for (let i = 0; i < master.bitmap.length; i += 4)
    if (!master.bitmap[i + 3]) {
      master.bitmap[i] = 255;
      master.bitmap[i + 3] = 12;
    }
  const original = asUrl(master);
  const alphaValues = (result) => {
    const decoded = f.decode(Buffer.from(result.image.split(',')[1], 'base64'));
    return Array.from(decoded.bitmap).filter((_, i) => i % 4 === 3);
  };
  const sticker = packFrames(original, {}, 'sticker', f.codec);
  const anime = packFrames(original, {}, 'anime', f.codec);
  const partial = (values) => values.filter((a) => a > 0 && a < 24).length;
  assert.ok(partial(alphaValues(anime)) > partial(alphaValues(sticker)) * 5);
  assert.ok(sticker.warnings.some((w) => w.includes('alpha 小于 24/255')));
  assert.ok(!anime.warnings.some((w) => w.includes('alpha')));
  assert.equal(original, asUrl(master));
});

test('poses that drift sideways inside their grid cells are registered by their feet; a jump keeps its height', () => {
  // 2x2 sheet: each pose sits further left in its cell, like imprecise image-model layouts.
  const cell = 128,
    width = cell * 2,
    height = cell * 2,
    bitmap = Buffer.alloc(width * height * 4);
  const rect = (x0, y0, w, h, color) => {
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++) {
        const i = (y * width + x) * 4;
        bitmap[i] = color[0];
        bitmap[i + 1] = color[1];
        bitmap[i + 2] = color[2];
        bitmap[i + 3] = 255;
      }
  };
  const drift = [0, -8, -16, -24],
    lift = [0, 0, 14, 0];
  drift.forEach((dx, n) => {
    const ox = (n % 2) * cell + 49 + dx + 8,
      oy = Math.floor(n / 2) * cell - lift[n];
    rect(ox, oy + 20, 30, 38, [210, 115, 160]);
    rect(ox + 4, oy + 58, 22, 39, [180, 120, 220]);
    rect(ox + 4, oy + 97, 8, 13, [75, 50, 120]);
    rect(ox + 18, oy + 97, 8, 13, [75, 50, 120]);
    // Each pose moves one arm so the frames are distinct.
    rect(ox - 8, oy + 62 - n * 6, 7, 26, [215, 150, 185]);
  });
  const packed = packFrames(
    f.url(f.image()),
    { wave: f.url(f.encode(bitmap, width, height)) },
    'original',
    f.codec,
  );
  const atlas = f.decode(Buffer.from(packed.image.split(',')[1], 'base64'));
  const feet = (index) => {
    const [x0, y0, w, h] = packed.sprite.frames[index].rect;
    const [cw, ch] = packed.sprite.frames[index].cell;
    const [ox, oy] = packed.sprite.frames[index].offset;
    let sum = 0,
      count = 0,
      bottom = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (atlas.bitmap[((y0 + y) * atlas.width + x0 + x) * 4 + 3] > 128) bottom = Math.max(bottom, y);
    for (let y = bottom - 6; y <= bottom; y++)
      for (let x = 0; x < w; x++)
        if (atlas.bitmap[((y0 + y) * atlas.width + x0 + x) * 4 + 3] > 128) {
          sum += x;
          count++;
        }
    return { x: (sum / count + ox) * (packed.sprite.width / cw), y: (bottom + oy) * (packed.sprite.height / ch) };
  };
  const wave = packed.sprite.clips.wave.frames.slice(1, -1).map(feet);
  const xs = wave.map((point) => point.x);
  assert.ok(Math.max(...xs) - Math.min(...xs) < 3, `feet stay in place horizontally: ${xs.map(Math.round)}`);
  // The clip reuses the master as its rest frame, so sheet poses 1-3 follow; pose 2 is the lifted one.
  assert.ok(
    wave[0].y - wave[1].y > 20,
    `the lifted pose keeps its jump height: ${wave.map((p) => Math.round(p.y))}`,
  );
});
