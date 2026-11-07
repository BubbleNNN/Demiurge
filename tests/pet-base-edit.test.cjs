'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createPetPipeline } = require('../electron/pet-pipeline.cjs');
const { referencePack, imageDigest } = require('../electron/references.cjs');
const fixture = require('./fixtures/pet-images.cjs');
const stamp = '2026-10-23T00:00:00.000Z';
const settings = { imageBaseUrl: 'https://base-edit.example/v1', imageModel: 'fixture-image' };
const character = {
  id: 'base-edit-character',
  name: '修图测试',
  work: '',
  summary: '',
  personality: [],
  speakingStyle: '',
  appearance: '',
  quotes: [],
  sources: [],
  unknowns: [],
  behavior: { energy: 50, affection: 50, curiosity: 50 },
  createdAt: stamp,
  visualReferences: [{ id: 'original', name: '原图', image: fixture.url(fixture.image()), createdAt: stamp }],
};
function picture(number, opaque = false) {
  const value = fixture.decode(fixture.image(false, { opaque }));
  for (let i = 0; i < value.bitmap.length; i += 4)
    if (value.bitmap[i + 3]) value.bitmap[i] = (value.bitmap[i] + number * 13) % 255;
  return fixture.url(fixture.encode(value.bitmap, value.width, value.height));
}
function master(style, number, opaque = false) {
  const image = picture(number, opaque),
    pack = referencePack(character);
  return {
    id: randomUUID(),
    characterId: character.id,
    name: `候选${number}`,
    style,
    kind: 'image',
    images: { neutral: image },
    generated: true,
    createdAt: stamp,
    generation: {
      referenceIds: ['original'],
      referenceDigest: pack.digest,
      model: settings.imageModel,
      prompt: 'Fixture master',
    },
    review: { status: 'pending', referenceDigest: pack.digest, imageDigest: imageDigest(image) },
  };
}
async function setup(t, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mori-base-edit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const calls = [],
    installed = [];
  const options = {
    root,
    codec: fixture.codec,
    installSkin: async (skin) => installed.push(skin),
    services: {
      prepareSkinGeneration() {},
      async generateSkin(input) {
        calls.push({ kind: 'base', input: structuredClone(input) });
        return master(input.style, calls.length);
      },
      async revisePetBase(input) {
        calls.push({ kind: 'edit', input: structuredClone(input) });
        return overrides.edit ? overrides.edit(input, calls.length) : master(input.style, calls.length);
      },
      async generatePetSheet(input) {
        calls.push({ kind: 'sheet', input: structuredClone(input) });
        return {
          image: fixture.url(fixture.image(true)),
          model: settings.imageModel,
          prompt: 'Fixture motion',
        };
      },
    },
    ...(overrides.io ? { io: overrides.io } : {}),
  };
  const pipeline = createPetPipeline(options);
  return { root, options, pipeline, calls, installed };
}
async function bases(context, count = 1, styles = ['chibi']) {
  let job = await context.pipeline.start(
    character,
    { styles, motions: ['wave'], candidateCount: count },
    settings,
    {},
  );
  for (let i = 0; i < count; i++) job = await context.pipeline.advance(job.id, character, settings, {});
  return job;
}
const editInput = (skin, feedback = '手臂自然一些') => ({ style: skin.style, skinId: skin.id, feedback });
const checkpoint = (context, job) => path.join(context.root, `${job.id}.json`);
const editPath = (context, job, edit, kind = 'asset') =>
  path.join(context.root, `${job.id}.edit-${edit.id}.${kind}.json`);
const editCalls = (context) => context.calls.filter((call) => call.kind === 'edit');

for (const count of [1, 3]) {
  test(`${count} original candidates survive refinement, restart and selecting the new pixels`, async (t) => {
    const c = await setup(t),
      p = c.pipeline;
    let job = await bases(c, count);
    const originalSteps = structuredClone(job.steps),
      originals = await p.masters(job.id);
    const originalBytes = await Promise.all(
      originals.map((_, i) => fs.readFile(path.join(c.root, `${job.id}-${i}.asset.json`))),
    );
    job = await p.refineBase(job.id, editInput(originals.at(-1)), character, settings, {});
    assert.deepEqual(job.steps, originalSteps);
    assert.equal(job.baseEdits[0].status, 'done');
    assert.equal(job.awaitingSelection, 'chibi');
    assert.equal(job.selectedBases.chibi, undefined);
    assert.equal(editCalls(c)[0].input.skin.images.neutral, originals.at(-1).images.neutral);
    await assert.rejects(p.advance(job.id, character, settings, {}), /先选择/);
    assert.equal(c.calls.filter((call) => call.kind === 'sheet').length, 0);
    const restarted = createPetPipeline(c.options);
    const candidates = await restarted.masters(job.id),
      revised = candidates.at(-1);
    assert.equal(candidates.length, count + 1);
    assert.equal(revised.generation.parentSkinId, originals.at(-1).id);
    assert.equal((await restarted.load(job.id)).awaitingSelection, 'chibi');
    for (let i = 0; i < count; i++)
      assert.deepEqual(await fs.readFile(path.join(c.root, `${job.id}-${i}.asset.json`)), originalBytes[i]);
    job = await restarted.selectBase(job.id, 'chibi', revised.id);
    job = await restarted.advance(job.id, character, settings, {});
    const sheet = c.calls.find((call) => call.kind === 'sheet');
    assert.equal(sheet.input.skin.id, revised.id);
    assert.equal(sheet.input.skin.images.neutral, revised.images.neutral);
    job = await restarted.advance(job.id, character, settings, {});
    assert.equal(job.status, 'ready');
    const revision = await restarted.revise(
      job.id,
      { style: 'chibi', feedback: '肩膀放松' },
      character,
      settings,
    );
    assert.equal(revision.baseEdits, undefined, 'New revision must not inherit file IDs from its source job');
  });
}

test('completed edits can be the frozen source of a later edit', async (t) => {
  const c = await setup(t),
    p = c.pipeline;
  let job = await bases(c);
  const original = (await p.masters(job.id))[0];
  job = await p.refineBase(job.id, editInput(original), character, settings, {});
  const first = (await p.masters(job.id)).at(-1);
  job = await p.refineBase(job.id, editInput(first, '保留手臂，只修眼睛'), character, settings, {});
  assert.equal(editCalls(c).at(-1).input.skin.images.neutral, first.images.neutral);
  assert.equal(job.baseEdits.at(-1).sourceSkinId, first.id);
  assert.equal((await p.masters(job.id)).at(-1).generation.parentSkinId, first.id);
  assert.equal(
    JSON.parse(await fs.readFile(editPath(c, job, job.baseEdits.at(-1), 'source'))).skin.id,
    first.id,
  );
});

test('failed edit leaves the old candidate selectable and never runs implicitly in advance', async (t) => {
  const c = await setup(t, {
      edit: async () => {
        throw new Error('Network interrupted');
      },
    }),
    p = c.pipeline;
  let job = await bases(c);
  const original = (await p.masters(job.id))[0];
  job = await p.refineBase(job.id, editInput(original), character, settings, {});
  assert.equal(job.baseEdits[0].status, 'uncertain');
  assert.equal(job.awaitingSelection, 'chibi');
  assert.equal((await p.masters(job.id)).length, 1);
  await assert.rejects(p.advance(job.id, character, settings, {}), /先选择/);
  job = await p.selectBase(job.id, 'chibi', original.id);
  assert.equal(job.status, 'queued');
  job = await p.advance(job.id, character, settings, {});
  assert.equal(c.calls.at(-1).input.skin.id, original.id);
  assert.equal(editCalls(c).length, 1);
  await assert.rejects(p.retryBaseEdit(job.id, job.baseEdits[0].id, character, settings, {}), /动作尚未开始/);
  await assert.rejects(p.refineBase(job.id, editInput(original), character, settings, {}), /动作尚未开始/);
  assert.equal(editCalls(c).length, 1);
});

test('technical rejection preserves evidence and only explicit retry makes one new request', async (t) => {
  let opaque = true;
  const c = await setup(t, { edit: async (input, n) => master(input.style, n, opaque) }),
    p = c.pipeline;
  let job = await bases(c);
  job = await p.refineBase(job.id, editInput((await p.masters(job.id))[0]), character, settings, {});
  const edit = job.baseEdits[0];
  assert.equal(edit.status, 'failed');
  const rejected = await fs.readFile(editPath(c, job, edit));
  assert.equal((await p.masters(job.id)).length, 1);
  opaque = false;
  job = await p.retryBaseEdit(job.id, edit.id, character, settings, {});
  assert.equal(job.baseEdits[0].status, 'done');
  assert.equal(editCalls(c).length, 2);
  const evidence = (await fs.readdir(c.root)).find((name) => name.includes(`.edit-${edit.id}.rejected-`));
  assert.ok(evidence);
  assert.deepEqual(await fs.readFile(path.join(c.root, evidence)), rejected);
  assert.equal(job.awaitingSelection, 'chibi');
});

test('acknowledged pixels recover locally after write failure without keys or current configuration', async (t) => {
  let fail = true;
  const c = await setup(t, {
      io: {
        ...fs,
        rename: async (from, to) => {
          if (fail && /\.edit-.*\.asset\.json$/.test(to)) {
            fail = false;
            throw new Error('Disk full');
          }
          return fs.rename(from, to);
        },
      },
    }),
    p = c.pipeline;
  let job = await bases(c);
  const original = (await p.masters(job.id))[0];
  job = await p.refineBase(job.id, editInput(original), character, settings, {});
  assert.equal(job.baseEdits[0].status, 'unsaved');
  await assert.rejects(p.refineBase(job.id, editInput(original), character, settings, {}), /先恢复/);
  job = await p.retryBaseEdit(
    job.id,
    job.baseEdits[0].id,
    { ...character, visualReferences: [] },
    {},
    undefined,
  );
  assert.equal(job.baseEdits[0].status, 'done');
  assert.equal(editCalls(c).length, 1);
  assert.equal((await createPetPipeline(c.options).masters(job.id)).length, 2);
});

test('a lost completion checkpoint recovers durable pixels on restart without another request', async (t) => {
  let failures = 0;
  const c = await setup(t, {
      edit: async (input, n) => {
        failures = 2;
        return master(input.style, n);
      },
      io: {
        ...fs,
        rename: async (from, to) => {
          if (failures && /^[a-f0-9-]{36}\.json$/.test(path.basename(to))) {
            failures--;
            throw new Error('Checkpoint failed');
          }
          return fs.rename(from, to);
        },
      },
    }),
    p = c.pipeline;
  let job = await bases(c);
  job = await p.refineBase(job.id, editInput((await p.masters(job.id))[0]), character, settings, {});
  assert.equal(job.baseEdits[0].status, 'unsaved');
  assert.equal(JSON.parse(await fs.readFile(checkpoint(c, job))).baseEdits[0].status, 'working');
  const restarted = createPetPipeline(c.options);
  job = await restarted.load(job.id);
  assert.equal(job.baseEdits[0].status, 'unsaved');
  job = await restarted.retryBaseEdit(job.id, job.baseEdits[0].id, character, {}, undefined);
  assert.equal(job.baseEdits[0].status, 'done');
  assert.equal(editCalls(c).length, 1);
});

for (const stage of ['source', 'working checkpoint']) {
  test(`failed ${stage} prevents payment and rolls back the visible job`, async (t) => {
    let armed = false;
    const c = await setup(t, {
        io: {
          ...fs,
          rename: async (from, to) => {
            if (
              armed &&
              (stage === 'source'
                ? /\.source\.json$/.test(to)
                : /^[a-f0-9-]{36}\.json$/.test(path.basename(to)))
            ) {
              armed = false;
              throw new Error('Before-payment write failure');
            }
            return fs.rename(from, to);
          },
        },
      }),
      p = c.pipeline;
    const job = await bases(c),
      original = (await p.masters(job.id))[0];
    const saved = await fs.readFile(checkpoint(c, job));
    armed = true;
    await assert.rejects(
      p.refineBase(job.id, editInput(original), character, settings, {}),
      /Before-payment/,
    );
    assert.equal(editCalls(c).length, 0);
    assert.equal((await p.load(job.id)).baseEdits, undefined);
    assert.equal((await p.load(job.id)).selectedBases.chibi, original.id);
    assert.deepEqual(await fs.readFile(checkpoint(c, job)), saved);
    assert.equal((await createPetPipeline(c.options).load(job.id)).baseEdits, undefined);
  });
}

test('interrupted working marker without pixels requires explicit paid retry after restart', async (t) => {
  let fail = true;
  const c = await setup(t, {
      edit: async (input, n) => {
        if (fail) throw new Error('Connection lost');
        return master(input.style, n);
      },
    }),
    p = c.pipeline;
  let job = await bases(c);
  job = await p.refineBase(job.id, editInput((await p.masters(job.id))[0]), character, settings, {});
  job.baseEdits[0].status = 'working';
  await fs.writeFile(checkpoint(c, job), JSON.stringify(job));
  const restarted = createPetPipeline(c.options);
  job = await restarted.load(job.id);
  assert.equal(job.baseEdits[0].status, 'uncertain');
  assert.equal(editCalls(c).length, 1);
  await assert.rejects(restarted.advance(job.id, character, settings, {}), /先选择/);
  fail = false;
  job = await restarted.retryBaseEdit(job.id, job.baseEdits[0].id, character, settings, {});
  assert.equal(job.baseEdits[0].status, 'done');
  assert.equal(editCalls(c).length, 2);
});

test('same-job requests serialize and readers never mistake an active edit for an interrupted one', async (t) => {
  let release, entered;
  const paused = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const c = await setup(t, {
      edit: async (input, n) => {
        entered();
        await paused;
        return master(input.style, n);
      },
    }),
    p = c.pipeline;
  const job = await bases(c),
    original = (await p.masters(job.id))[0];
  const edit = p.refineBase(job.id, editInput(original), character, settings, {});
  await started;
  assert.equal((await p.load(job.id)).baseEdits[0].status, 'working');
  const advance = assert.rejects(p.advance(job.id, character, settings, {}), /先选择/);
  const selection = p.selectBase(job.id, 'chibi', original.id);
  release();
  await edit;
  await advance;
  assert.equal((await selection).selectedBases.chibi, original.id);
  assert.equal(editCalls(c).length, 1);
  assert.equal(c.calls.filter((call) => call.kind === 'sheet').length, 0);
});

test('invalid source, feedback, character or configuration is rejected without image requests', async (t) => {
  const c = await setup(t),
    p = c.pipeline;
  const job = await bases(c),
    original = (await p.masters(job.id))[0],
    input = editInput(original);
  for (const bad of [
    { ...input, skinId: randomUUID() },
    { ...input, feedback: ' ' },
    { ...input, feedback: '字'.repeat(601) },
    { ...input, style: 'unknown' },
  ])
    await assert.rejects(p.refineBase(job.id, bad, character, settings, {}));
  await assert.rejects(p.refineBase(job.id, input, { ...character, id: 'other' }, settings, {}));
  await assert.rejects(p.refineBase(job.id, input, { ...character, visualReferences: [] }, settings, {}));
  await assert.rejects(p.refineBase(job.id, input, character, { ...settings, imageModel: 'changed' }, {}));
  assert.equal(editCalls(c).length, 0);
  assert.equal((await p.load(job.id)).baseEdits, undefined);
});

test('later styles cannot be edited before the preceding style finishes', async (t) => {
  const c = await setup(t),
    p = c.pipeline;
  let job = await bases(c, 1, ['chibi', '8bit']);
  const original = (await p.masters(job.id))[0];
  await assert.rejects(
    p.refineBase(job.id, { ...editInput(original), style: '8bit' }, character, settings, {}),
    /动作尚未开始/,
  );
  job = await p.advance(job.id, character, settings, {});
  job = await p.advance(job.id, character, settings, {});
  job = await p.advance(job.id, character, settings, {});
  const later = (await p.masters(job.id)).find((skin) => skin.style === '8bit');
  const before = structuredClone(job.steps);
  job = await p.refineBase(job.id, editInput(later), character, settings, {});
  assert.equal(job.baseEdits[0].style, '8bit');
  assert.deepEqual(job.steps, before);
});

test('an earlier failed edit cannot spend again while a newer output needs local recovery', async (t) => {
  let edits = 0,
    failWrite = false;
  const c = await setup(t, {
      edit: async (input, n) => {
        if (++edits === 1) throw new Error('First interrupted');
        failWrite = true;
        return master(input.style, n);
      },
      io: {
        ...fs,
        rename: async (from, to) => {
          if (failWrite && /\.edit-.*\.asset\.json$/.test(to)) {
            failWrite = false;
            throw new Error('Full disk');
          }
          return fs.rename(from, to);
        },
      },
    }),
    p = c.pipeline;
  let job = await bases(c);
  const original = (await p.masters(job.id))[0];
  job = await p.refineBase(job.id, editInput(original), character, settings, {});
  job = await p.refineBase(job.id, editInput(original, '只改眼睛'), character, settings, {});
  await assert.rejects(p.retryBaseEdit(job.id, job.baseEdits[0].id, character, settings, {}), /先恢复/);
  assert.equal(editCalls(c).length, 2);
});

test('edit count and metadata byte budget are checked before any new payment', async (t) => {
  const c = await setup(t),
    p = c.pipeline;
  let job = await bases(c);
  const original = (await p.masters(job.id))[0];
  for (let i = 0; i < 6; i++) job = await p.refineBase(job.id, editInput(original), character, settings, {});
  await assert.rejects(p.refineBase(job.id, editInput(original), character, settings, {}), /最多修正6次/);
  assert.equal(editCalls(c).length, 6);
  job.baseEdits = [];
  job.padding = '字'.repeat(20500);
  await fs.writeFile(checkpoint(c, job), JSON.stringify(job));
  const restarted = createPetPipeline(c.options);
  await assert.rejects(
    restarted.refineBase(job.id, editInput(original, '字'.repeat(600)), character, settings, {}),
    /容量上限/,
  );
  assert.equal(editCalls(c).length, 6);
  assert.deepEqual((await restarted.load(job.id)).baseEdits, []);
});

test('malformed edit metadata is rejected before source or output paths are used', async (t) => {
  const c = await setup(t),
    p = c.pipeline;
  let job = await bases(c);
  job = await p.refineBase(job.id, editInput((await p.masters(job.id))[0]), character, settings, {});
  for (const changes of [
    { id: '../outside' },
    { style: 'unknown' },
    { status: 'queued' },
    { feedback: '' },
    { sourceSkinId: '../outside' },
    { createdAt: 'not-a-date' },
  ]) {
    const invalid = structuredClone(job);
    Object.assign(invalid.baseEdits[0], changes);
    await fs.writeFile(checkpoint(c, job), JSON.stringify(invalid));
    await assert.rejects(createPetPipeline(c.options).load(job.id), /修图记录无效/);
  }
  assert.equal(editCalls(c).length, 1);
});

test('cancel waits for an active edit, preserves both candidates and cannot resume payment after restart', async (t) => {
  let release, entered;
  const paused = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const c = await setup(t, {
      edit: async (input, n) => {
        entered();
        await paused;
        return master(input.style, n);
      },
    }),
    p = c.pipeline;
  const job = await bases(c),
    original = (await p.masters(job.id))[0];
  const editing = p.refineBase(job.id, editInput(original), character, settings, {});
  await started;
  const cancellation = p.cancel(job.id);
  release();
  await editing;
  const cancelled = await cancellation;
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.baseEdits[0].status, 'done');
  const restarted = createPetPipeline(c.options);
  assert.equal((await restarted.load(job.id)).status, 'cancelled');
  assert.equal((await restarted.masters(job.id)).length, 2);
  await assert.rejects(
    restarted.refineBase(job.id, editInput(original), character, settings, {}),
    /动作尚未开始/,
  );
  await assert.rejects(
    restarted.retryBaseEdit(job.id, cancelled.baseEdits[0].id, character, settings, {}),
    /只能重试/,
  );
  await assert.rejects(restarted.advance(job.id, character, settings, {}), /已结束/);
  assert.equal(editCalls(c).length, 1);
});
