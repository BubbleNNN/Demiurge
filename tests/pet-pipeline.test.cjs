'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createPetPipeline } = require('../electron/pet-pipeline.cjs');
const { inspectMaster, inspectSheet, packFrames } = require('../electron/pet-frames.cjs');
const { referencePack, imageDigest } = require('../electron/references.cjs');
const { validateSkin, createBundle } = require('../electron/store.cjs');
const fixture = require('./fixtures/pet-images.cjs');
const image = fixture.url(fixture.image()),
  sheet = fixture.url(fixture.image(true));
const character = {
  id: 'pet-test',
  name: '测试角色',
  work: '独立作品',
  summary: '',
  personality: [],
  speakingStyle: '',
  appearance: '',
  quotes: [],
  sources: [],
  unknowns: [],
  behavior: { energy: 50, affection: 50, curiosity: 50 },
  createdAt: '2026-10-04T00:00:00.000Z',
  visualReferences: [{ id: 'ref', name: '原图', image, createdAt: '2026-10-04T00:00:00.000Z' }],
};
const settings = { imageBaseUrl: 'https://images.example/v1', imageModel: 'test-images' };
function master(style, input = character) {
  const pack = referencePack(input);
  return {
    id: randomUUID(),
    characterId: input.id,
    name: input.name + ' ' + style,
    style,
    kind: 'image',
    images: { neutral: image },
    generated: true,
    createdAt: character.createdAt,
    generation: {
      referenceIds: pack.references.map((r) => r.id),
      referenceDigest: pack.digest,
      model: settings.imageModel,
      prompt: 'Original-reference constrained test image',
    },
    review: { status: 'pending', referenceDigest: pack.digest, imageDigest: imageDigest(image) },
  };
}
async function setup(t, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mori-pet-unit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let calls = 0,
    installed = [];
  const services = {
    prepareSkinGeneration() {},
    async generateSkin(input) {
      calls++;
      return master(input.style, input.character);
    },
    async generatePetSheet() {
      calls++;
      return { image: sheet, prompt: 'Fixture four poses', model: 'test-images' };
    },
    ...overrides.services,
  };
  const options = {
    root,
    services,
    codec: fixture.codec,
    installSkin: async (skin) => {
      if (!installed.some((s) => s.id === skin.id)) installed.push(skin);
    },
    ...overrides,
  };
  options.services = services;
  return {
    pipeline: createPetPipeline(options),
    root,
    options,
    calls: () => calls,
    installed: () => installed,
  };
}
test('transparent frame checks reject opaque backgrounds, clipped limbs and identical frames', () => {
  inspectMaster(image, fixture.codec);
  inspectSheet(sheet, fixture.codec, 'wave');
  assert.throws(
    () => inspectMaster(fixture.url(fixture.image(false, { opaque: true })), fixture.codec),
    /透明背景/,
  );
  assert.throws(
    () => inspectSheet(fixture.url(fixture.image(true, { cropped: true })), fixture.codec, 'wave'),
    /裁切/,
  );
  assert.throws(
    () => inspectSheet(fixture.url(fixture.image(true, { identical: true })), fixture.codec, 'wave'),
    /完全相同/,
  );
  assert.throws(() => inspectSheet(image, fixture.codec, 'wave'), /内容|边缘|裁切/);
});
test('packing supplies only generated gestures, grounded rest and finite authored timing without whole-image motion', () => {
  const packed = packFrames(
    image,
    { wave: sheet, talk: sheet, blink: sheet, sleep: sheet, emotions: sheet },
    'original',
    fixture.codec,
  );
  assert.equal(packed.sprite.pixelated, false);
  assert.equal(packed.sprite.width, 384);
  assert.equal(packed.sprite.height, 512);
  assert.equal(packed.sprite.frames.length, 21);
  assert.equal(packed.sprite.clips.wave.loop, false);
  assert.equal(packed.sprite.clips.wave.frames.at(-1), 0);
  assert.equal(packed.sprite.clips.talk.loop, true);
  assert.deepEqual(packed.sprite.mouthFrames, {
    closed: 0,
    small: packed.sprite.clips.talk.frames[1],
    wide: packed.sprite.clips.talk.frames[2],
  });
  assert.equal(packed.sprite.clips.sleep.loop, true);
  assert.ok(packed.sprite.clips.happy && packed.sprite.clips.sleepy);
  assert.equal(packed.sprite.clips.bounce, undefined);
  const skin = validateSkin({
    ...master('original'),
    images: { neutral: packed.image },
    sprite: packed.sprite,
  });
  assert.deepEqual(createBundle(character, [skin]).skins[0].sprite, packed.sprite);
  assert.equal(packFrames(image, { wave: sheet }, '8bit', fixture.codec).sprite.pixelated, true);
  assert.equal(packFrames(image, { wave: sheet }, 'original', fixture.codec).sprite.mouthFrames, undefined);
});
test('packing retains each source sampling density instead of shrinking every HD master and action to one fixed texture', () => {
  const enlargeFixture = (bytes, factor) => {
    const source = fixture.decode(bytes),
      width = source.width * factor,
      height = source.height * factor;
    const bitmap = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const from = (Math.floor(y / factor) * source.width + Math.floor(x / factor)) * 4;
        source.bitmap.copy(bitmap, (y * width + x) * 4, from, from + 4);
      }
    return fixture.url(fixture.encode(bitmap, width, height));
  };
  const packed = packFrames(
    enlargeFixture(fixture.image(), 8),
    { wave: enlargeFixture(fixture.image(true), 4) },
    'original',
    fixture.codec,
  );
  const master = packed.sprite.frames[0].rect,
    motion = packed.sprite.frames[1].rect;
  assert.ok(master[3] > 720, 'Native 720px character detail must not be squeezed into a 512px canvas');
  assert.ok(
    Math.abs(master[3] / motion[3] - 2) < 0.02,
    '1024px master and 512px motion retain their own densities',
  );
  assert.equal(packed.sprite.width, 384, 'Logical composition remains independent');
});
test('packing stops at the source-preserving file budget without a hidden low-resolution rebuild or new API request', () => {
  let encodes = 0;
  const codec = {
    ...fixture.codec,
    encode() {
      encodes++;
      return Buffer.alloc(8 * 1024 * 1024 + 1);
    },
  };
  assert.throws(() => packFrames(image, { wave: sheet }, 'original', codec), /不会自动降清晰度/);
  assert.equal(encodes, 1);
});
test('two styles run with direct reference provenance, separate masters and automatic pending candidate installation', async (t) => {
  const context = await setup(t),
    p = context.pipeline;
  let job = await p.start(
    character,
    { styles: ['chibi', 'original'], motions: ['wave', 'talk'] },
    settings,
    {},
  );
  assert.equal(context.calls(), 0);
  for (let n = 0; n < job.steps.length; n++) job = await p.advance(job.id, character, settings, {});
  assert.equal(job.status, 'ready');
  assert.equal(context.calls(), 6);
  assert.equal(context.installed().length, 2);
  assert.ok(
    context
      .installed()
      .every((s) => s.review.status === 'pending' && s.sprite.clips.wave && s.sprite.clips.talk),
  );
  const restarted = createPetPipeline(context.options);
  assert.equal((await restarted.list(character.id))[0].status, 'ready');
  const restored = await restarted.results(job.id);
  assert.equal(restored.length, 2);
  for (const skin of restored)
    assert.deepEqual(
      skin.sprite.mouthFrames,
      context.installed().find((s) => s.id === skin.id).sprite.mouthFrames,
    );
  await restarted.advance(job.id, character, settings, {});
  assert.equal(context.calls(), 6);
});
test('acknowledged image write failure recovers locally without another API call or next paid stage', async (t) => {
  let fail = true;
  const context = await setup(t, {
    io: {
      ...fs,
      rename: async (from, to) => {
        if (fail && to.endsWith('-0.asset.json')) {
          fail = false;
          throw new Error('Fixture failed disk write');
        }
        return fs.rename(from, to);
      },
    },
  });
  let job = await context.pipeline.start(character, { styles: ['anime'], motions: ['wave'] }, settings, {});
  job = await context.pipeline.advance(job.id, character, settings, {});
  assert.equal(job.steps[0].status, 'unsaved');
  assert.equal(context.calls(), 1);
  job = await context.pipeline.advance(job.id, character, settings, {});
  assert.equal(job.steps[0].status, 'done');
  assert.equal(job.steps[1].status, 'queued');
  assert.equal(context.calls(), 1);
});
test('completed source files survive restart after checkpoint failure and retry only installs existing packed pixels', async (t) => {
  let failInstall = true,
    installed = 0;
  const context = await setup(t, {
    installSkin: async () => {
      if (failInstall) {
        failInstall = false;
        throw new Error('Fixture installation failed');
      }
      installed++;
    },
  });
  let job = await context.pipeline.start(character, { styles: ['chibi'], motions: ['nod'] }, settings, {});
  job = await context.pipeline.advance(job.id, character, settings, {});
  job = await context.pipeline.advance(job.id, character, settings, {});
  job = await context.pipeline.advance(job.id, character, settings, {});
  assert.equal(job.steps[2].status, 'unsaved');
  assert.equal(context.calls(), 2);
  const restarted = createPetPipeline(context.options);
  job = await restarted.advance(job.id, character, settings, {});
  assert.equal(job.status, 'ready');
  assert.equal(context.calls(), 2);
  assert.equal(installed, 1);
});
test('an interrupted provider request never automatically repeats and changed references/config block before payment', async (t) => {
  const context = await setup(t),
    p = context.pipeline;
  const job = await p.start(character, { styles: ['anime'], motions: ['wave'] }, settings, {});
  await assert.rejects(p.advance(job.id, { ...character, visualReferences: [] }, settings, {}), /参考原图/);
  assert.equal(context.calls(), 0);
  await assert.rejects(
    p.advance(job.id, character, { ...settings, imageModel: 'changed' }, {}),
    /配置已变化/,
  );
  assert.equal(context.calls(), 0);
  const disk = JSON.parse(await fs.readFile(path.join(context.root, job.id + '.json')));
  disk.steps[0].status = 'working';
  disk.status = 'running';
  await fs.writeFile(path.join(context.root, job.id + '.json'), JSON.stringify(disk));
  const restarted = createPetPipeline(context.options);
  const resumed = (await restarted.list(character.id))[0];
  assert.equal(resumed.steps[0].status, 'uncertain');
  await assert.rejects(restarted.advance(job.id, character, settings, {}), /中断/);
  assert.equal(context.calls(), 0);
  await restarted.retry(job.id, 0);
  await restarted.advance(job.id, character, settings, {});
  assert.equal(context.calls(), 1);
});
test('simultaneous creates cannot duplicate a plan and cancelling preserves artifacts while allowing a fresh task', async (t) => {
  const context = await setup(t),
    p = context.pipeline,
    plan = { styles: ['3d'], motions: ['wave'] };
  const results = await Promise.allSettled([
    p.start(character, plan, settings, {}),
    p.start(character, plan, settings, {}),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const job = results.find((r) => r.status === 'fulfilled').value;
  await p.advance(job.id, character, settings, {});
  await p.cancel(job.id);
  assert.equal(context.calls(), 1);
  await assert.rejects(p.advance(job.id, character, settings, {}), /已结束/);
  const fresh = await p.start(character, plan, settings, {});
  assert.notEqual(fresh.id, job.id);
  await assert.rejects(p.load('../private'), /编号/);
});

test('a rejected pose sheet stops the task and explicit retry preserves the completed master', async (t) => {
  let bad = true,
    poseCalls = 0;
  const context = await setup(t, {
    services: {
      async generatePetSheet() {
        poseCalls++;
        return { image: fixture.url(fixture.image(true, { identical: bad })) };
      },
    },
  });
  let job = await context.pipeline.start(character, { styles: ['chibi'], motions: ['wave'] }, settings, {});
  job = await context.pipeline.advance(job.id, character, settings, {});
  job = await context.pipeline.advance(job.id, character, settings, {});
  assert.equal(job.steps[0].status, 'done');
  assert.equal(job.steps[1].status, 'failed');
  assert.match(job.steps[1].error, /完全相同/);
  await assert.rejects(context.pipeline.advance(job.id, character, settings, {}), /完全相同/);
  assert.equal(poseCalls, 1);
  bad = false;
  job = await context.pipeline.retry(job.id, 1);
  job = await context.pipeline.advance(job.id, character, settings, {});
  job = await context.pipeline.advance(job.id, character, settings, {});
  assert.equal(job.status, 'ready');
  assert.equal(context.calls(), 1);
  assert.equal(poseCalls, 2);
  assert.ok((await fs.readdir(context.root)).some((name) => name.includes('.rejected-')));
});

test('an existing same-style master avoids its image request and another style cannot silently use it', async (t) => {
  const context = await setup(t),
    sourceSkin = master('original');
  sourceSkin.review.status = 'approved';
  sourceSkin.review.reviewedAt = character.createdAt;
  const job = await context.pipeline.start(
    character,
    { styles: ['original'], motions: ['wave'], sourceSkin },
    settings,
    {},
  );
  assert.equal(job.steps[0].status, 'done');
  assert.equal(context.calls(), 0);
  await context.pipeline.advance(job.id, character, settings, {});
  const finished = await context.pipeline.advance(job.id, character, settings, {});
  assert.equal(finished.status, 'ready');
  assert.equal(context.calls(), 1);
  await assert.rejects(
    context.pipeline.start(character, { styles: ['chibi'], motions: ['wave'], sourceSkin }, settings, {}),
    /同画风/,
  );
});

test('failed durable request marker stops before provider submission and remains safely resumable', async (t) => {
  let fault = false;
  const context = await setup(t, {
    io: {
      ...fs,
      rename: async (from, to) => {
        if (fault && /^[a-f0-9-]{36}\.json$/.test(path.basename(to))) {
          fault = false;
          throw new Error('Checkpoint unavailable');
        }
        return fs.rename(from, to);
      },
    },
  });
  const job = await context.pipeline.start(character, { styles: ['chibi'], motions: ['talk'] }, settings, {});
  fault = true;
  await assert.rejects(context.pipeline.advance(job.id, character, settings, {}), /Checkpoint/);
  assert.equal(context.calls(), 0);
  assert.equal((await context.pipeline.load(job.id)).steps[0].status, 'queued');
  const restarted = createPetPipeline(context.options);
  await restarted.advance(job.id, character, settings, {});
  assert.equal(context.calls(), 1);
});

test('eight-frame atlas preserves motion phases, sleep poses, mouth mapping and four independent expressions', () => {
  const eight = fixture.url(fixture.image(true, { frames: 8 }));
  inspectSheet(eight, fixture.codec, 'wave', { frameCount: 8 });
  assert.throws(() => inspectSheet(sheet, fixture.codec, 'wave', { frameCount: 8 }), /八帧/);
  assert.throws(() => inspectSheet(eight, fixture.codec, 'wave'), /四帧/);
  const packed = packFrames(
    image,
    { wave: eight, bounce: eight, sleep: eight, talk: eight, emotions: sheet },
    'chibi',
    fixture.codec,
    { frameCount: 8, temperament: 'gentle' },
  );
  assert.equal(packed.sprite.frames.length, 37);
  assert.equal(packed.sprite.clips.wave.frames.length, 9);
  assert.equal(packed.sprite.clips.wave.frames.at(-1), 0);
  assert.equal(packed.sprite.clips.sleep.frames.length, 4);
  assert.equal(packed.sprite.clips.sleep.frames[0], 21);
  assert.equal(packed.sprite.mouthFrames.wide, 28);
  assert.equal(packed.sprite.clips.happy.frames.length, 1);
  assert.notDeepEqual(packed.sprite.clips.bounce.durations, packed.sprite.clips.wave.durations);
  const natural = packFrames(image, { wave: eight }, 'chibi', fixture.codec, { frameCount: 8 });
  assert.ok(packed.sprite.clips.wave.durations[1] > natural.sprite.clips.wave.durations[1]);
  // A jump's higher authored foot position survives packing (one transform per clip).
  assert.equal(packed.sprite.clips.bounce.loop, false);
});

test('new production choices survive restart and base previews are read-only without extra generation', async (t) => {
  const seen = [];
  const f = await setup(t, {
    services: {
      async generateSkin(input) {
        seen.push(input);
        return master(input.style);
      },
      async generatePetSheet(input) {
        seen.push(input);
        return { image: fixture.url(fixture.image(true, { frames: 8 })) };
      },
    },
  });
  let task = await f.pipeline.start(
    character,
    {
      styles: ['chibi'],
      motions: ['wave'],
      frameCount: 8,
      temperament: 'lively',
      artDirection: '  清晰轮廓、柔和颜色  ',
    },
    settings,
    {},
  );
  task = await f.pipeline.advance(task.id, character, settings, {});
  assert.equal(seen.length, 1);
  assert.equal(seen[0].artDirection, '清晰轮廓、柔和颜色');
  assert.equal((await f.pipeline.masters(task.id)).length, 1);
  assert.equal((await f.pipeline.results(task.id)).length, 0);
  assert.equal(f.installed().length, 0);
  const resumed = createPetPipeline(f.options);
  assert.equal((await resumed.load(task.id)).frameCount, 8);
  task = await resumed.advance(task.id, character, settings, {});
  assert.equal(seen[1].frameCount, 8);
  assert.equal(seen[1].temperament, 'lively');
  task = await resumed.advance(task.id, character, settings, {});
  assert.equal(task.status, 'ready');
  assert.equal(f.installed()[0].sprite.frames.length, 9);
});

test('invalid production options fail before any provider call and old tasks remain resumable', async (t) => {
  const f = await setup(t);
  for (const options of [{ frameCount: 12 }, { temperament: 'unknown' }, { artDirection: 'x'.repeat(601) }])
    await assert.rejects(
      f.pipeline.start(character, { styles: ['chibi'], motions: ['wave'], ...options }, settings, {}),
    );
  assert.equal(f.calls(), 0);
  let task = await f.pipeline.start(character, { styles: ['chibi'], motions: ['wave'] }, settings, {});
  for (const key of ['frameCount', 'temperament', 'artDirection']) delete task[key];
  await fs.writeFile(path.join(f.root, task.id + '.json'), JSON.stringify(task));
  const resumed = createPetPipeline(f.options);
  for (let i = 0; i < 3; i++) task = await resumed.advance(task.id, character, settings, {});
  assert.equal(task.status, 'ready');
  assert.equal(f.installed()[0].sprite.frames.length, 5);
});

test('sticker job repairs a slightly rectangular output locally, keeps raw artifacts and restores the reviewed package', async (t) => {
  const src = fixture.decode(fixture.image(true));
  const width = src.width,
    height = src.height + 8,
    bitmap = Buffer.alloc(width * height * 4);
  for (let row = 0; row < 2; row++)
    for (let y = 0; y < 128; y++)
      src.bitmap.copy(
        bitmap,
        (row * 132 + y) * width * 4,
        (row * 128 + y) * width * 4,
        (row * 128 + y + 1) * width * 4,
      );
  const raw = fixture.url(fixture.encode(bitmap, width, height));
  let sheetCalls = 0;
  const context = await setup(t, {
    services: {
      async generatePetSheet() {
        sheetCalls++;
        return { image: raw, prompt: 'raw provider output', model: 'test-images' };
      },
    },
  });
  let job = await context.pipeline.start(character, { styles: ['sticker'], motions: ['wave'] }, settings, {});
  for (let i = 0; i < 3; i++) job = await context.pipeline.advance(job.id, character, settings, {});
  assert.equal(job.status, 'ready');
  assert.equal(sheetCalls, 1, 'Padding must never cause a new request');
  assert.equal(context.calls(), 1, 'Only one master request');
  const saved = JSON.parse(await fs.readFile(path.join(context.root, `${job.id}-1.asset.json`), 'utf8'));
  assert.equal(saved.image, raw, 'The acknowledged raw response is the recovery artifact');
  assert.ok(job.results[0].warnings.some((w) => w.includes('补透明留白')));
  const restarted = createPetPipeline(context.options);
  const [skin] = await restarted.results(job.id);
  assert.equal(skin.style, 'sticker');
  assert.equal(skin.review.status, 'pending');
  assert.ok(skin.sprite.clips.wave);
  const bundle = createBundle(character, [skin]);
  assert.equal(bundle.skins[0].style, 'sticker');
  await restarted.advance(job.id, character, settings, {});
  assert.equal(sheetCalls, 1);
});

test('activity jobs resume with eight-pose assets and retain transition clips in exported bundles', async (t) => {
  const sheetCalls = [];
  const context = await setup(t, { services: { async generatePetSheet(input) {
    sheetCalls.push(input.motion);
    return { image: fixture.url(fixture.image(true, { frames: 8 })), prompt: 'activity poses', model: 'test-images' };
  } } });
  let job = await context.pipeline.start(character, { styles: ['sticker'], motions: ['read', 'gaming'], frameCount: 4 }, settings, {});
  job = await context.pipeline.advance(job.id, character, settings, {});
  job = await context.pipeline.advance(job.id, character, settings, {});
  const restarted = createPetPipeline(context.options);
  job = await restarted.advance(job.id, character, settings, {});
  job = await restarted.advance(job.id, character, settings, {});
  assert.equal(job.status, 'ready');
  assert.deepEqual(sheetCalls, ['read', 'gaming']);
  const [skin] = await restarted.results(job.id);
  assert.equal(skin.sprite.frames.length, 17);
  const exported = createBundle(character, [skin]).skins[0];
  for (const name of ['read', 'gaming', 'enter_read', 'exit_read', 'enter_gaming', 'exit_gaming'])
    assert.deepEqual(exported.sprite.clips[name], skin.sprite.clips[name]);
  assert.equal(skin.review.status, 'pending');
});
