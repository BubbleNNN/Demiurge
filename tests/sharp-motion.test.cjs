'use strict';
// Sharp motion: fewer poses per image, joined into one motion; large packs split into atlas pages
// stored as files next to the state.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const f = require('./fixtures/pet-images.cjs');
const { motionParts, motionRecipe } = require('../electron/pet-recipes.cjs');
const { splitSheet, packFrames } = require('../electron/pet-frames.cjs');
const { validateAnimation } = require('../electron/sprites.cjs');
const { animationDigest } = require('../electron/animation-quality.cjs');
const { imageDigest } = require('../electron/skin-assets.cjs');

const sharp = { transitionVersion: 3, quality: 'sharp' };

const { partImage } = require('./fixtures/pet-parts.cjs');
// Height of the head colour in a frame, and its lowest opaque row.
function measure(frame) {
  let top = Infinity,
    bottom = -1,
    lowest = -1;
  for (let y = 0; y < frame.height; y++)
    for (let x = 0; x < frame.width; x++) {
      const i = (y * frame.width + x) * 4;
      if (frame.bitmap[i + 3] < 128) continue;
      lowest = y;
      if (frame.bitmap[i] === 210 && frame.bitmap[i + 1] === 115) {
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  return { head: bottom - top + 1, lowest };
}

test('sharp quality splits motions into fewer poses per image; standard keeps one sheet', () => {
  assert.equal(motionParts('read', sharp), 3);
  assert.equal(motionParts('sleep', sharp), 3);
  assert.equal(motionParts('blink', sharp), 2);
  assert.equal(motionParts('drag', sharp), 2);
  assert.equal(motionParts('read', { transitionVersion: 3 }), 1);
  assert.throws(() => motionParts('read', { quality: 'sharp' }), /新版动作流程/);
  const loop = motionRecipe('read', { ...sharp, part: 1 });
  assert.deepEqual(
    [loop.count, loop.columns, loop.rows, loop.size, loop.firstFrame],
    [4, 2, 2, '1024x1536', 5],
  );
  assert.equal(motionRecipe('sleep', { ...sharp, part: 0 }).size, '1024x1024', 'lying down needs wide cells');
  const blink = motionRecipe('blink', { ...sharp, part: 1 });
  assert.deepEqual(
    [blink.count, blink.columns, blink.rows, blink.size, blink.firstFrame],
    [2, 2, 1, '1536x1024', 3],
  );
  assert.deepEqual(blink.poses, motionRecipe('blink', sharp).poses.slice(2));
  assert.throws(() => motionRecipe('read', { ...sharp, part: 3 }), /分段/);
});

test('three separately drawn segments become one motion: same floor, sizes matched at the seams', () => {
  // The loop was drawn 10% larger and the exit 5% smaller, each with its own grid drift.
  const parts = [
    partImage({ drift: 6, lift: 4 }),
    partImage({ scale: 1.1, drift: 9, lift: 7 }),
    partImage({ scale: 0.95, drift: 3 }),
  ];
  const { frames, report } = splitSheet(parts, f.codec, 'listen', sharp);
  assert.equal(frames.length, 12);
  assert.equal(report.parts, 3);
  assert.ok(frames.every((frame) => frame.width === frames[0].width && frame.height === frames[0].height));
  const m = frames.map(measure);
  assert.ok(
    Math.max(...m.map((v) => v.lowest)) - Math.min(...m.map((v) => v.lowest)) <= 1,
    `one floor line: ${m.map((v) => v.lowest)}`,
  );
  // Displayed sizes match once each image's factor is applied.
  const shown = m.map((v, i) => v.head * report.scales[i]);
  assert.ok(
    Math.max(...shown) / Math.min(...shown) < 1.06,
    `matched head sizes: ${shown.map((v) => v.toFixed(1))}`,
  );
  assert.ok(
    Math.abs(report.scales[4] - 1 / 1.1) < 0.04 && Math.abs(report.scales[8] - 1 / 0.95) < 0.04,
    `${report.scales}`,
  );
  // A single part is checked on its own, as the pipeline does after each request.
  assert.equal(splitSheet(parts[1], f.codec, 'listen', { ...sharp, part: 1 }).frames.length, 4);
  assert.throws(() => splitSheet(parts.slice(0, 2), f.codec, 'listen', sharp), /3 段/);
});

test('a sharp pack is split into pages: idle and short clips on page 0, activities after; every frame stays on its page', () => {
  const master = f.url(f.image());
  const sheets = {
    blink: [
      partImage({ columns: 2, rows: 1, cell: [192, 256], scale: 0.6 }),
      partImage({ columns: 2, rows: 1, cell: [192, 256], scale: 0.66, arm: 2 }),
    ],
    read: [partImage({}), partImage({ scale: 1.05, arm: 1 }), partImage({ scale: 0.97, arm: 2 })],
    listen: [partImage({ arm: 3 }), partImage({ scale: 1.08 }), partImage({ arm: 1 })],
  };
  const packed = packFrames(master, sheets, 'chibi-pet', f.codec, { ...sharp, pagePixels: 60000 });
  const a = packed.sprite;
  assert.ok(a.pages && a.pages.length >= 2, `pages: ${a.pages?.length}`);
  const pageOf = (i) => a.frames[i].page || 0;
  assert.equal(pageOf(0), 0, 'idle is on page 0');
  assert.ok(
    a.clips.blink.frames.every((i) => pageOf(i) === 0),
    'blink stays next to idle',
  );
  for (const name of ['read', 'listen']) {
    const pages = new Set(
      [...a.clips[`enter_${name}`].frames, ...a.clips[name].frames, ...a.clips[`exit_${name}`].frames].map(
        pageOf,
      ),
    );
    assert.equal(pages.size, 1, `${name} sits on one page`);
    assert.ok(![...pages].includes(0));
  }
  const images = [
    f.decode(Buffer.from(packed.image.split(',')[1], 'base64')),
    ...a.pages.map((p) => f.decode(Buffer.from(p.src.split(',')[1], 'base64'))),
  ];
  a.pages.forEach((p, i) =>
    assert.deepEqual([images[i + 1].width, images[i + 1].height], [p.width, p.height]),
  );
  a.frames.forEach((frame) => {
    const page = images[frame.page || 0];
    assert.ok(frame.rect[0] + frame.rect[2] <= page.width && frame.rect[1] + frame.rect[3] <= page.height);
  });
  assert.deepEqual(validateAnimation(a, { width: images[0].width, height: images[0].height }), a);
});

test('pages are validated, and an atlas counts the same whether embedded or stored as a file', () => {
  const page = f.url(f.image());
  const sprite = {
    width: 384,
    height: 512,
    frames: [
      { rect: [0, 0, 64, 64], duration: 100 },
      { rect: [0, 0, 64, 64], duration: 100, page: 1 },
    ],
    clips: { idle: { frames: [0] }, wave: { frames: [0, 1] } },
    pages: [{ src: page, width: 128, height: 128 }],
  };
  validateAnimation(sprite, { width: 128, height: 128 });
  assert.throws(
    () => validateAnimation({ ...sprite, pages: [{ src: page, width: 99, height: 128 }] }),
    /尺寸/,
  );
  assert.throws(
    () => validateAnimation({ ...sprite, frames: [sprite.frames[0], { ...sprite.frames[1], page: 2 }] }),
    /分页/,
  );
  assert.throws(
    () =>
      validateAnimation({
        ...sprite,
        frames: [sprite.frames[0], { ...sprite.frames[1], rect: [100, 0, 64, 64] }],
      }),
    /边界/,
  );
  assert.throws(
    () =>
      validateAnimation({
        ...sprite,
        pages: [{ src: 'https://example.com/a.png', width: 128, height: 128 }],
      }),
    /本机/,
  );
  const stored = {
    ...sprite,
    pages: [{ src: `mori-asset://skins/${imageDigest(page)}.png`, width: 128, height: 128 }],
  };
  assert.equal(animationDigest(stored), animationDigest(sprite), 'moving a page to a file changes no review');
});

test('atlases move out of the state into digest-named files; reviews stay valid; export inlines them; unused files are removed', async (t) => {
  const { createStore, validateState } = require('../electron/store.cjs');
  const { initialState } = (() => {
    const ts = require('typescript');
    const exports = {};
    const source = require('node:fs').readFileSync(path.resolve(__dirname, '../src/initial.ts'), 'utf8');
    new Function(
      'exports',
      'require',
      ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText,
    )(exports, (name) =>
      name.endsWith('.json') ? require(path.resolve(__dirname, '../src', name)) : require(name),
    );
    return exports;
  })();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mori-assets-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = createStore({ dir, safeStorage: null });
  const base = validateState(initialState());
  const character = base.characters[0];
  const atlas = f.url(f.image());
  const extra = f.url(f.image(true));
  const sprite = {
    width: 384,
    height: 512,
    frames: [
      { rect: [0, 0, 128, 128], duration: 100 },
      { rect: [0, 0, 256, 256], duration: 100, page: 1 },
    ],
    clips: { idle: { frames: [0] }, wave: { frames: [0, 1] } },
    pages: [{ src: extra, width: 256, height: 256 }],
  };
  const digest = animationDigest(sprite);
  const skin = {
    id: 'sharp-pack',
    characterId: character.id,
    name: '清晰动作包',
    style: 'chibi-pet',
    kind: 'image',
    generated: true,
    images: { neutral: atlas },
    sprite,
    createdAt: '2026-11-08T00:00:00.000Z',
    review: {
      status: 'approved',
      referenceDigest: 'a'.repeat(64),
      imageDigest: imageDigest(atlas),
      animationDigest: digest,
      animation: { frames: [0, 1], anatomy: true, identity: true, continuity: true },
      reviewedAt: '2026-11-08T00:00:00.000Z',
    },
  };
  await store.saveState({
    ...base,
    skins: [...base.skins, skin],
    activeSkinId: skin.id,
    activeCharacterId: character.id,
  });
  const raw = JSON.parse(await fs.readFile(path.join(dir, 'state.json'), 'utf8'));
  const saved = raw.skins.find((s) => s.id === skin.id);
  assert.equal(saved.images.neutral, `mori-asset://skins/${imageDigest(atlas)}.png`);
  assert.equal(saved.sprite.pages[0].src, `mori-asset://skins/${imageDigest(extra)}.png`);
  assert.deepEqual(saved.atlasSize, { width: 128, height: 128 });
  assert.ok(
    !JSON.stringify(raw).includes('data:image/png;base64,' + atlas.slice(22, 60)),
    'no embedded atlas left',
  );
  assert.deepEqual(
    await fs.readFile(path.join(dir, 'skin-assets', `${imageDigest(atlas)}.png`)),
    Buffer.from(atlas.split(',')[1], 'base64'),
  );
  // Reloaded and re-validated, the approved review still holds.
  const reopened = createStore({ dir, safeStorage: null });
  const loaded = (await reopened.loadState()).skins.find((s) => s.id === skin.id);
  assert.equal(loaded.review.status, 'approved');
  assert.equal(animationDigest(loaded.sprite), digest);
  require('../electron/persona.cjs');
  // Export puts the images back inside.
  const [inline] = await reopened.inlineAssets([loaded]);
  assert.equal(inline.images.neutral, atlas);
  assert.equal(inline.sprite.pages[0].src, extra);
  assert.equal(inline.atlasSize, undefined);
  // A tampered file is refused.
  await fs.writeFile(path.join(dir, 'skin-assets', `${imageDigest(extra)}.png`), Buffer.from('changed'));
  await assert.rejects(reopened.inlineAssets([loaded]), /损坏/);
  // Files nothing refers to any more are removed once they are old enough.
  const orphan = path.join(dir, 'skin-assets', `${'b'.repeat(64)}.png`);
  await fs.writeFile(orphan, Buffer.from('x'));
  assert.equal(await reopened.collectAssets(), 0, 'a new file is left alone');
  const old = new Date(Date.now() - 3600000);
  await fs.utimes(orphan, old, old);
  await reopened.saveState({ ...(await reopened.loadState()) });
  assert.equal(await reopened.collectAssets(), 1);
  await assert.rejects(fs.stat(orphan));
  await fs.stat(path.join(dir, 'skin-assets', `${imageDigest(atlas)}.png`));
});

test('a sharp task makes one request per image, hands later parts the earlier ones, and packs them as one motion', async (t) => {
  const { createPetPipeline } = require('../electron/pet-pipeline.cjs');
  const { referencePack, imageDigest: digestOf } = require('../electron/references.cjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mori-sharp-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const image = f.url(f.image());
  const character = {
    id: 'sharp-test',
    name: '清晰测试',
    work: '测试',
    summary: '',
    personality: [],
    speakingStyle: '',
    appearance: '',
    quotes: [],
    sources: [],
    unknowns: [],
    behavior: { energy: 50, affection: 50, curiosity: 50 },
    createdAt: '2026-11-08T00:00:00.000Z',
    visualReferences: [{ id: 'ref', name: '原图', image, createdAt: '2026-11-08T00:00:00.000Z' }],
  };
  const settings = { imageBaseUrl: 'https://images.example/v1', imageModel: 'test-images' };
  const requests = [];
  let installed;
  const pipeline = createPetPipeline({
    root,
    codec: f.codec,
    installSkin: async (skin) => {
      installed = skin;
    },
    services: {
      prepareSkinGeneration() {},
      async generateSkin(input) {
        const pack = referencePack(input.character);
        return {
          id: 'master-1',
          characterId: input.character.id,
          name: 'master',
          style: '3d',
          kind: 'image',
          images: { neutral: image },
          generated: true,
          createdAt: character.createdAt,
          generation: { referenceIds: ['ref'], referenceDigest: pack.digest, model: 'test', prompt: 'test' },
          review: { status: 'pending', referenceDigest: pack.digest, imageDigest: digestOf(image) },
        };
      },
      async generatePetSheet(input) {
        requests.push({
          motion: input.motion,
          part: input.part,
          references: input.continuityReferences.map((r) => `${r.motion}:${r.part}`),
        });
        return {
          image: partImage({ arm: input.part || 0, scale: 1 + (input.part || 0) * 0.04 }),
          prompt: 'parts',
          model: 'test-images',
        };
      },
    },
  });
  let job = await pipeline.start(
    character,
    { styles: ['3d'], motions: ['read', 'listen'], ...sharp },
    settings,
    {},
  );
  assert.equal(job.quality, 'sharp');
  assert.deepEqual(
    job.steps.map((s) => (s.kind === 'sheet' ? `${s.motion}${s.part}` : s.kind)),
    ['base', 'read0', 'read1', 'read2', 'listen0', 'listen1', 'listen2', 'pack'],
  );
  while (job.status !== 'ready') job = await pipeline.advance(job.id, character, settings, {});
  assert.equal(requests.length, 6, 'one request per image');
  assert.deepEqual(requests[1].references, ['read:0'], 'the loop sees the entrance');
  assert.deepEqual(requests[2].references, ['read:0', 'read:1'], 'the exit sees both');
  assert.ok(
    requests[3].references.every((r) => !r.startsWith('listen')),
    'a new motion starts from earlier motions',
  );
  assert.equal(installed.sprite.clips.read.frames.length, 4);
  assert.equal(installed.sprite.clips.enter_listen.frames.length, 4);
  assert.equal(installed.sprite.frames.length, 1 + 24);
  // Packing again uses the saved images: no further requests.
  job = await pipeline.repack(job.id);
  while (job.status !== 'ready') job = await pipeline.advance(job.id, character, settings, {});
  assert.equal(requests.length, 6);
});
