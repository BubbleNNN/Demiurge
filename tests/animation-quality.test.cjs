'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const {
  validateFrameReview,
  assertPoseRelease,
  animationDigest,
} = require('../electron/animation-quality.cjs');
const { layoutFrames, assertAtlasBytes } = require('../electron/atlas-layout.cjs');
const { poseRegions } = require('../electron/pose-regions.cjs');
function load(file, modules = {}) {
  const exports = {};
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function('exports', 'require', output)(
    exports,
    (name) => modules[name] || require('node:module').createRequire(path.resolve(file))(name),
  );
  return exports;
}
const resolution = load('src/animation/resolution.ts');
const sprites = load('src/animation/sprites.ts', { './resolution': resolution });
test('visual review requires every unique frame, anatomy, identity, continuity and current image digest', () => {
  const animation = {
    width: 10,
    height: 10,
    frames: Array.from({ length: 5 }, () => ({ rect: [0, 0, 10, 10], duration: 100 })),
    clips: { idle: { frames: [0] } },
  };
  const review = {
    imageDigest: 'current-pixels',
    animationDigest: animationDigest(animation),
    frames: [4, 3, 2, 1, 0],
    anatomy: true,
    identity: true,
    continuity: true,
  };
  assert.deepEqual(validateFrameReview(animation, review.imageDigest, review).frames, [0, 1, 2, 3, 4]);
  for (const invalid of [
    undefined,
    { ...review, imageDigest: 'old' },
    { ...review, frames: [0, 1, 2, 3] },
    { ...review, frames: [0, 1, 2, 3, 3] },
    { ...review, frames: [0, 1, 2, 3, 8] },
    { ...review, anatomy: false },
    { ...review, identity: false },
    { ...review, continuity: false },
    { ...review, anatomy: 'true' },
  ])
    assert.throws(() => validateFrameReview(animation, review.imageDigest, invalid));
  assert.throws(
    () =>
      validateFrameReview({ ...animation, clips: { idle: { frames: [1, 3] } } }, review.imageDigest, review),
    /变化/,
  );
});
test('publisher rejects changed, rejected or unreviewed pixels for any artwork', () => {
  const records = [{ sha256: 'one' }, { sha256: 'two' }],
    review = records.map((r) => ({
      ...r,
      status: 'approved',
      anatomy: true,
      identity: true,
      continuity: true,
    }));
  assert.doesNotThrow(() => assertPoseRelease(records, review));
  assert.throws(() => assertPoseRelease(records, review.slice(0, 1)));
  assert.throws(() => assertPoseRelease(records, [review[0], { ...review[1], status: 'rejected' }]));
  assert.throws(() => assertPoseRelease([{ sha256: 'changed' }, records[1]], review));
});
test('illustrated textures keep native pixels even with tiny logical size or differing aspect ratio; pixel art keeps its grid', () => {
  const frame = { rect: [0, 0, 1024, 1536] };
  assert.deepEqual(resolution.spriteCellSize({ width: 128, height: 192 }, frame), {
    width: 1024,
    height: 1536,
  });
  assert.deepEqual(resolution.spriteCellSize({ width: 48, height: 64, pixelated: true }, frame), {
    width: 48,
    height: 64,
  });
  const square = resolution.spriteCellSize({ width: 384, height: 512 }, { rect: [0, 0, 512, 512] });
  assert.ok(
    square.width >= 512 && square.height >= 512,
    'Letterboxing must preserve original pixels instead of stretching or shrinking',
  );
});
test('preparation and Retina drawing use native source pixels and report enlargement; hostile memory sizes fail before decoding', () => {
  const old = { document: global.document, devicePixelRatio: global.devicePixelRatio };
  const calls = [];
  global.document = {
    createElement: () => ({ getContext: () => ({ drawImage: (...args) => calls.push(args) }) }),
  };
  global.devicePixelRatio = 3;
  try {
    const animation = {
      width: 128,
      height: 192,
      frames: [{ rect: [0, 0, 1024, 1536], duration: 100 }],
      clips: { idle: { frames: [0] } },
    };
    const cell = sprites.prepareSpriteFrames({ naturalWidth: 1024, naturalHeight: 1536 }, animation)[0];
    assert.equal(cell.width, 1024);
    assert.equal(cell.height, 1536);
    assert.deepEqual(calls[0].slice(-2), [1024, 1536]);
    const canvas = {
      width: 0,
      height: 0,
      dataset: {},
      getBoundingClientRect: () => ({ width: 800, height: 1000 }),
      getContext: () => ({ clearRect() {}, drawImage: (...args) => calls.push(args) }),
    };
    sprites.drawSpriteFrame(canvas, cell, false);
    assert.deepEqual([canvas.width, canvas.height], [2400, 3000]);
    assert.equal(canvas.dataset.sourceSize, '1024x1536');
    assert.ok(Number(canvas.dataset.upscale) > 1);
    assert.throws(
      () =>
        sprites.prepareSpriteFrames(
          {},
          { ...animation, frames: Array.from({ length: 100 }, () => animation.frames[0]) },
        ),
      /内存/,
    );
  } finally {
    global.document = old.document;
    global.devicePixelRatio = old.devicePixelRatio;
  }
});
test('trimmed frames decode only their stored pixels and draw back at their place in the full canvas', () => {
  const old = { document: global.document, devicePixelRatio: global.devicePixelRatio };
  const made = [];
  global.document = {
    createElement: () => {
      const canvas = { getContext: () => ({ drawImage() {} }) };
      made.push(canvas);
      return canvas;
    },
  };
  global.devicePixelRatio = 1;
  try {
    // 177 frames whose full canvases total 38M pixels but whose visible pixels total 15M:
    // the shape of a complete twenty-motion pack.
    const frame = { rect: [0, 0, 300, 290], duration: 100, cell: [360, 480], offset: [30, 170] };
    const animation = { width: 384, height: 512, frames: Array.from({ length: 177 }, () => frame), clips: { idle: { frames: [0] } } };
    const cells = sprites.prepareSpriteFrames({ naturalWidth: 300, naturalHeight: 290 }, animation);
    assert.equal(cells.length, 177);
    assert.deepEqual([made[0].width, made[0].height], [300, 290], 'only the stored piece is allocated');
    assert.deepEqual([cells[0].width, cells[0].height, cells[0].x, cells[0].y], [360, 480, 30, 170]);
    const draws = [];
    const canvas = {
      width: 0,
      height: 0,
      dataset: {},
      getBoundingClientRect: () => ({ width: 360, height: 480 }),
      getContext: () => ({ clearRect() {}, drawImage: (...args) => draws.push(args) }),
    };
    const placement = sprites.drawSpriteFrame(canvas, cells[0], false);
    const [, dx, dy, dw, dh] = draws[0];
    assert.ok(Math.abs(dx - (placement.x + 30 * placement.scale)) < 1e-9, 'piece keeps its horizontal place');
    assert.ok(Math.abs(dy - (placement.y + 170 * placement.scale)) < 1e-9, 'piece keeps its vertical place');
    assert.ok(Math.abs(dw - 300 * placement.scale) < 1e-9 && Math.abs(dh - 290 * placement.scale) < 1e-9, 'no stretching');
    assert.equal(canvas.dataset.sourceSize, '360x480', 'the frame still reports its full canvas');
  } finally {
    global.document = old.document;
    global.devicePixelRatio = old.devicePixelRatio;
  }
});
test('physical shelf packing retains different frame resolutions and never silently downgrades oversized HD atlases', () => {
  const layout = layoutFrames([
    { width: 1024, height: 1536 },
    { width: 512, height: 768 },
  ]);
  assert.deepEqual(layout.rects, [
    [0, 0, 1024, 1536],
    [1024, 0, 512, 768],
  ]);
  assert.equal(layout.width, 1536);
  assert.equal(layout.height, 1536);
  assert.throws(() => layoutFrames([{ width: 8193, height: 1 }]), /不会自动降/);
  assertAtlasBytes({ length: 8 * 1024 * 1024 + 1 });
  assert.throws(() => assertAtlasBytes({ length: 32 * 1024 * 1024 + 1 }), /不会自动降/);
});
test('alpha crops retain whole figures straddling nominal cells and reject joined or cut-off figures', () => {
  const width = 400,
    height = 400,
    pixels = Buffer.alloc(width * height * 4);
  const rect = (x, y, w, h) => {
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) pixels[(yy * width + xx) * 4 + 3] = 255;
  };
  for (const y of [30, 230]) for (const x of [170, 285]) rect(x, y, 50, 90);
  const regions = poseRegions(pixels, width, height, 2, 2);
  assert.deepEqual(regions[0], { x: 169, y: 29, width: 52, height: 92 });
  assert.ok(
    regions[0].x + regions[0].width > 200,
    'The whole hand/outline beyond the nominal split survives',
  );
  rect(220, 50, 65, 1);
  assert.throws(() => poseRegions(pixels, width, height, 2, 2), /分开|相连/);
  const cut = Buffer.alloc(100 * 100 * 4);
  for (let y = 10; y < 90; y++) for (let x = 0; x < 50; x++) cut[(y * 100 + x) * 4 + 3] = 255;
  assert.throws(() => poseRegions(cut, 100, 100, 1, 1), /裁切/);
});
test('all bundled animations have pixel-bound release review and portable source-resolution metadata', () => {
  const pack = require('../shared/cyrene-motion-pack.json');
  assert.equal(pack.entries.length, 1);
  for (const entry of pack.entries) {
    const review = require('../' + pack.reviewFile);
    assert.doesNotThrow(() => validateFrameReview(entry.animation, entry.sha256, review));
    assert.equal(review.animationDigest, animationDigest(entry.animation));
    for (const page of [{file:entry.file,sha256:entry.sha256}, ...review.pages]) {
      assert.equal(require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join('public/art',page.file))).digest('hex'),page.sha256);
    }
  }
});

test('portable mouth metadata validates frame bounds and participates in review digest', () => {
  const { validateAnimation } = require('../electron/sprites.cjs');
  const animation = {
    width: 16,
    height: 24,
    frames: Array.from({ length: 3 }, () => ({ rect: [0, 0, 16, 24], duration: 100 })),
    clips: { idle: { frames: [0] }, talk: { frames: [0, 1, 2], loop: true } },
    mouthFrames: { closed: 0, small: 1, wide: 2 },
  };
  assert.deepEqual(validateAnimation(animation).mouthFrames, animation.mouthFrames);
  assert.notEqual(
    animationDigest(animation),
    animationDigest({ ...animation, mouthFrames: { closed: 0, small: 2, wide: 1 } }),
  );
  assert.throws(
    () => validateAnimation({ ...animation, mouthFrames: { closed: 0, small: 1, wide: 3 } }),
    /口型索引/,
  );
  assert.throws(() => validateAnimation({ ...animation, mouthFrames: { closed: 0, small: 1 } }), /口型索引/);
  assert.throws(() => validateAnimation({ ...animation, clips: { idle: { frames: [0] } } }), /talk/);
});

test('large source-preserving sheets reflow cells without reducing resolution or relaxing memory limits', () => {
  const { layoutFramesFlexible } = require('../electron/atlas-layout.cjs');
  const sizes = [
    { width: 768, height: 1023 },
    ...Array.from({ length: 60 }, () => ({ width: 385, height: 513 })),
  ];
  assert.throws(() => layoutFrames(sizes), /不会自动降/);
  const layout = layoutFramesFlexible(sizes);
  assert.ok(layout.width <= 8192 && layout.height <= 8192);
  assert.ok(layout.width * layout.height <= 16 * 1024 * 1024);
  assert.equal(layout.rects.length, 61);
  for (let i = 0; i < sizes.length; i++) {
    const [x, y, w, h] = layout.rects[i];
    assert.equal(w, sizes[i].width);
    assert.equal(h, sizes[i].height);
    assert.ok(x + w <= layout.width && y + h <= layout.height);
    for (let j = 0; j < i; j++) {
      const [a, b, c, d] = layout.rects[j];
      assert.ok(x + w <= a || a + c <= x || y + h <= b || b + d <= y, 'Frames may not overlap');
    }
  }
  const small = sizes.slice(0, 3);
  assert.deepEqual(layoutFramesFlexible(small), layoutFrames(small));
  assert.throws(
    () => layoutFramesFlexible(Array.from({ length: 20 }, () => ({ width: 1024, height: 1024 }))),
    /不会自动降/,
  );
});
