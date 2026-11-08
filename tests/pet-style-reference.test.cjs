'use strict';
const { plan: revisionPlan } = require('./fixtures/revision-plan.cjs');
// Inputs the fake chat planner received (user corrections never reach the image fakes directly).
const planned = [];
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createPetPipeline } = require('../electron/pet-pipeline.cjs');
const { referencePack, imageDigest, styleReferencePack } = require('../electron/references.cjs');
const fixture = require('./fixtures/pet-images.cjs');
const stamp = '2026-10-23T00:00:00.000Z';
const settings = { imageBaseUrl: 'https://style-reference.example/v1', imageModel: 'fixture-image' };
function picture(number) {
  const image = fixture.decode(fixture.image());
  for (let i = 0; i < image.bitmap.length; i += 4)
    if (image.bitmap[i + 3]) image.bitmap[i] = (image.bitmap[i] + number * 13) % 255;
  return fixture.url(fixture.encode(image.bitmap, image.width, image.height));
}
const character = {
  id: 'style-guide-character',
  name: '画风测试',
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
  visualReferences: [{ id: 'identity', name: '身份原图', image: picture(1), createdAt: stamp }],
};
const guide = { id: 'style-guide', name: '线条与明暗样例', image: picture(2), createdAt: stamp };
function master(input, number) {
  const image = picture(number + 3),
    pack = referencePack(character);
  return {
    id: randomUUID(),
    characterId: character.id,
    name: `候选${number}`,
    style: input.style,
    kind: 'image',
    images: { neutral: image },
    generated: true,
    createdAt: stamp,
    generation: {
      referenceIds: ['identity'],
      referenceDigest: pack.digest,
      model: settings.imageModel,
      prompt: 'Fixture master',
      ...(input.styleReference ? { styleReference: styleReferencePack(input.styleReference).summary } : {}),
      ...(input.skin ? { parentSkinId: input.skin.id } : {}),
    },
    review: { status: 'pending', referenceDigest: pack.digest, imageDigest: imageDigest(image) },
  };
}
async function setup(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mori-style-guide-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'pet-jobs'),
    calls = [];
  const options = {
    root,
    codec: fixture.codec,
    installSkin: async () => {},
    services: {
      prepareSkinGeneration() {},
      async generateSkin(input) {
        calls.push({ kind: 'base', input: structuredClone(input) });
        return master(input, calls.length);
      },
      async planRevision(input) {
        planned.push(structuredClone(input));
        return revisionPlan(input.feedback);
      },
      async revisePetBase(input) {
        calls.push({ kind: 'edit', input: structuredClone(input) });
        if (overrides.edit) return overrides.edit(input, calls.length);
        return master(input, calls.length);
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
  return { directory, root, options, calls, pipeline: createPetPipeline(options) };
}
const input = (extra = {}) => ({ styles: ['3d'], motions: ['wave'], styleReference: guide, ...extra });
const checkpoint = (c, job) => path.join(c.root, `${job.id}.json`);
const guideFile = (c, job) => path.join(c.root, `${job.id}.style-reference.json`);
async function finish(c, job) {
  for (let i = 0; i <= job.steps.length && job.status !== 'ready'; i++)
    job = await c.pipeline.advance(job.id, character, settings, {});
  assert.equal(job.status, 'ready');
  return job;
}

test('style bytes are frozen separately from identity and metadata, and resume supplies the saved guide', async (t) => {
  const c = await setup(t),
    provided = structuredClone(guide);
  let job = await c.pipeline.start(character, input({ styleReference: provided }), settings, {});
  assert.deepEqual(job.styleReference, styleReferencePack(guide).summary);
  assert.equal(job.referenceDigest, referencePack(character).digest);
  const record = await fs.readFile(checkpoint(c, job), 'utf8');
  assert.equal(record.includes('data:image/'), false);
  assert.equal(Buffer.byteLength(record) < 65536, true);
  provided.image = picture(9);
  const restarted = createPetPipeline(c.options);
  assert.deepEqual(await restarted.styleReference(job.id), guide);
  assert.equal(c.calls.length, 0);
  job = await restarted.advance(job.id, character, settings, {});
  assert.deepEqual(c.calls[0].input.styleReference, guide);
  assert.deepEqual(c.calls[0].input.character.visualReferences, character.visualReferences);
  assert.deepEqual((await restarted.masters(job.id))[0].generation.styleReference, job.styleReference);
  await restarted.advance(job.id, character, settings, {});
  assert.equal(c.calls.at(-1).kind, 'sheet');
  assert.equal(c.calls.at(-1).input.styleReference, undefined);
});

test('legacy jobs need no guide artifact and incompatible source/original-only routes fail before requests', async (t) => {
  const c = await setup(t),
    p = c.pipeline;
  const source = master({ style: '3d' }, 1);
  await assert.rejects(p.start(character, input({ sourceSkin: source }), settings, {}), /已有角色基准/);
  await assert.rejects(p.start(character, input({ styles: ['original'] }), settings, {}), /原作画风/);
  await assert.rejects(
    p.start(
      character,
      input({ styleReference: { ...guide, image: 'https://example.com/image.png' } }),
      settings,
      {},
    ),
  );
  assert.equal(c.calls.length, 0);
  const job = await p.start(character, input({ styleReference: undefined }), settings, {});
  assert.equal(job.styleReference, undefined);
  assert.equal(await p.styleReference(job.id), null);
  await assert.rejects(fs.stat(guideFile(c, job)), { code: 'ENOENT' });
  await p.advance(job.id, character, settings, {});
  assert.equal(c.calls[0].input.styleReference, undefined);
});

test('mixed original and transformed styles use the guide only for non-original masters', async (t) => {
  const c = await setup(t),
    p = c.pipeline;
  let job = await p.start(character, input({ styles: ['original', '3d'] }), settings, {});
  const saved = await fs.readFile(guideFile(c, job));
  await fs.rm(guideFile(c, job));
  job = await p.advance(job.id, character, settings, {});
  assert.equal(c.calls[0].input.styleReference, undefined);
  const original = (await p.masters(job.id))[0];
  job = await p.refineBase(
    job.id,
    { style: 'original', skinId: original.id, feedback: '手臂自然' },
    character,
    settings,
    {},
  );
  assert.equal(c.calls.at(-1).input.styleReference, undefined);
  job = await p.selectBase(job.id, 'original', original.id);
  job = await p.advance(job.id, character, settings, {});
  job = await p.advance(job.id, character, settings, {});
  await assert.rejects(p.advance(job.id, character, settings, {}), { code: 'ENOENT' });
  await fs.writeFile(guideFile(c, job), saved);
  job = await p.advance(job.id, character, settings, {});
  assert.deepEqual(c.calls.at(-1).input.styleReference, guide);
  assert.ok(
    c.calls.filter((call) => call.kind === 'sheet').every((call) => call.input.styleReference === undefined),
  );
});

test('missing or tampered frozen guide blocks a fresh base before working marker or payment', async (t) => {
  const c = await setup(t),
    p = c.pipeline;
  const job = await p.start(character, input(), settings, {}),
    originalRecord = await fs.readFile(checkpoint(c, job));
  for (const changes of [{ id: 'other-id' }, { name: 'different-name' }, { image: picture(8) }]) {
    await fs.writeFile(guideFile(c, job), JSON.stringify({ reference: { ...guide, ...changes } }));
    await assert.rejects(p.styleReference(job.id), /不一致/);
    await assert.rejects(p.advance(job.id, character, settings, {}), /不一致/);
    assert.deepEqual(await fs.readFile(checkpoint(c, job)), originalRecord);
  }
  await fs.rm(guideFile(c, job));
  await assert.rejects(p.advance(job.id, character, settings, {}), { code: 'ENOENT' });
  assert.equal(c.calls.length, 0);
  assert.equal((await p.load(job.id)).steps[0].status, 'queued');
});

test('guide artifact and metadata schema limits reject untrusted content without requests', async (t) => {
  const c = await setup(t),
    p = c.pipeline;
  const oversized = Buffer.alloc(8 * 1024 * 1024 + 1);
  fixture.image().copy(oversized);
  await assert.rejects(
    p.start(character, input({ styleReference: { ...guide, image: fixture.url(oversized) } }), settings, {}),
  );
  const job = await p.start(character, input(), settings, {});
  await fs.writeFile(guideFile(c, job), Buffer.alloc(12 * 1024 * 1024 + 1));
  await assert.rejects(p.styleReference(job.id), /过大/);
  for (const changes of [{ id: '../escape' }, { name: '' }, { digest: 'invalid' }]) {
    await fs.writeFile(
      checkpoint(c, job),
      JSON.stringify({ ...job, styleReference: { ...job.styleReference, ...changes } }),
    );
    await assert.rejects(createPetPipeline(c.options).load(job.id));
  }
  assert.equal(c.calls.length, 0);
});

for (const stage of ['guide', 'checkpoint']) {
  test(`failed ${stage} persistence leaves no cached phantom job or paid request`, async (t) => {
    let fail = true;
    const c = await setup(t, {
      io: {
        ...fs,
        rename: async (from, to) => {
          if (
            fail &&
            (stage === 'guide'
              ? to.endsWith('.style-reference.json')
              : /^[a-f0-9-]{36}\.json$/.test(path.basename(to)))
          ) {
            fail = false;
            throw new Error('Snapshot failure');
          }
          return fs.rename(from, to);
        },
      },
    });
    await assert.rejects(c.pipeline.start(character, input(), settings, {}), /Snapshot failure/);
    assert.equal(c.calls.length, 0);
    assert.deepEqual(await c.pipeline.list(character.id), []);
    const job = await c.pipeline.start(character, input(), settings, {});
    assert.deepEqual(await c.pipeline.styleReference(job.id), guide);
  });
}

test('acknowledged base pixels recover without rereading a missing guide', async (t) => {
  let fail = true;
  const c = await setup(t, {
      io: {
        ...fs,
        rename: async (from, to) => {
          if (fail && /-0\.asset\.json$/.test(to)) {
            fail = false;
            throw new Error('Output disk failure');
          }
          return fs.rename(from, to);
        },
      },
    }),
    p = c.pipeline;
  let job = await p.start(character, input(), settings, {});
  job = await p.advance(job.id, character, settings, {});
  assert.equal(job.steps[0].status, 'unsaved');
  await fs.rm(guideFile(c, job));
  job = await p.advance(job.id, character, settings, {});
  assert.equal(job.steps[0].status, 'done');
  assert.equal(c.calls.length, 1);
});

test('base edits use the frozen guide and local recovery ignores its missing file and current configuration', async (t) => {
  let fail = true;
  const c = await setup(t, {
      io: {
        ...fs,
        rename: async (from, to) => {
          if (fail && /\.edit-.*\.asset\.json$/.test(to)) {
            fail = false;
            throw new Error('Edit output failure');
          }
          return fs.rename(from, to);
        },
      },
    }),
    p = c.pipeline;
  let job = await p.start(character, input(), settings, {});
  job = await p.advance(job.id, character, settings, {});
  const source = (await p.masters(job.id))[0];
  job = await p.refineBase(
    job.id,
    { style: '3d', skinId: source.id, feedback: '线条柔和' },
    character,
    settings,
    {},
  );
  assert.deepEqual(c.calls.at(-1).input.styleReference, guide);
  assert.equal(job.baseEdits[0].status, 'unsaved');
  await fs.rm(guideFile(c, job));
  job = await p.retryBaseEdit(job.id, job.baseEdits[0].id, character, {}, undefined);
  assert.equal(job.baseEdits[0].status, 'done');
  assert.equal(c.calls.filter((call) => call.kind === 'edit').length, 1);
  assert.deepEqual((await p.masters(job.id)).at(-1).generation.styleReference, job.styleReference);
});

test('new edits and paid retries validate the guide before mutating their working checkpoint', async (t) => {
  const c = await setup(t, {
      edit: async () => {
        throw new Error('Provider interrupted');
      },
    }),
    p = c.pipeline;
  let job = await p.start(character, input(), settings, {});
  job = await p.advance(job.id, character, settings, {});
  const source = (await p.masters(job.id))[0],
    edit = { style: '3d', skinId: source.id, feedback: '手臂自然' };
  const saved = await fs.readFile(guideFile(c, job));
  await fs.rm(guideFile(c, job));
  await assert.rejects(p.refineBase(job.id, edit, character, settings, {}), { code: 'ENOENT' });
  assert.equal((await p.load(job.id)).baseEdits, undefined);
  await fs.writeFile(guideFile(c, job), saved);
  job = await p.refineBase(job.id, edit, character, settings, {});
  assert.equal(job.baseEdits[0].status, 'uncertain');
  await fs.writeFile(guideFile(c, job), JSON.stringify({ reference: { ...guide, image: picture(9) } }));
  await assert.rejects(p.retryBaseEdit(job.id, job.baseEdits[0].id, character, settings, {}), /不一致/);
  assert.equal((await p.load(job.id)).baseEdits[0].status, 'uncertain');
  assert.equal(c.calls.filter((call) => call.kind === 'edit').length, 1);
});

test('completed revisions copy the guide under the new job id and retain it after restart', async (t) => {
  const c = await setup(t),
    p = c.pipeline;
  const original = await finish(c, await p.start(character, input(), settings, {}));
  const saved = await fs.readFile(guideFile(c, original));
  let revision = await p.revise(original.id, { style: '3d', feedback: '眼睛清晰' }, character, settings);
  assert.notEqual(revision.id, original.id);
  assert.deepEqual(revision.styleReference, original.styleReference);
  assert.deepEqual(await fs.readFile(guideFile(c, revision)), saved);
  await fs.rm(guideFile(c, original));
  const restarted = createPetPipeline(c.options);
  assert.deepEqual(await restarted.styleReference(revision.id), guide);
  revision = await restarted.advance(revision.id, character, settings, {});
  assert.equal(revision.steps[0].status, 'done');
  assert.deepEqual(c.calls.at(-1).input.styleReference, guide);
});

test('missing guide prevents revision creation and failed metadata writes do not leave a cached revision', async (t) => {
  let fail = false;
  const c = await setup(t, {
      io: {
        ...fs,
        rename: async (from, to) => {
          if (fail && /^[a-f0-9-]{36}\.json$/.test(path.basename(to))) {
            fail = false;
            throw new Error('Revision checkpoint failed');
          }
          return fs.rename(from, to);
        },
      },
    }),
    p = c.pipeline;
  const original = await finish(c, await p.start(character, input(), settings, {}));
  const saved = await fs.readFile(guideFile(c, original)),
    count = c.calls.length;
  await fs.rm(guideFile(c, original));
  await assert.rejects(p.revise(original.id, { style: '3d', feedback: '清晰' }, character, settings), {
    code: 'ENOENT',
  });
  assert.equal((await p.list(character.id)).length, 1);
  await fs.writeFile(guideFile(c, original), saved);
  fail = true;
  await assert.rejects(
    p.revise(original.id, { style: '3d', feedback: '清晰' }, character, settings),
    /Revision checkpoint failed/,
  );
  assert.equal((await p.list(character.id)).length, 1);
  await p.revise(original.id, { style: '3d', feedback: '清晰' }, character, settings);
  assert.equal(c.calls.length, count);
});

test('workspace backup restores the frozen guide and task summary together', async (t) => {
  const c = await setup(t),
    p = c.pipeline;
  const job = await p.start(character, input(), settings, {});
  const state = {
    settings: {
      ...settings,
      llmBaseUrl: 'https://example.com/v1',
      llmModel: '',
      demoMode: false,
      proactiveEnabled: false,
    },
    characters: [character],
    skins: [],
    activeCharacterId: character.id,
    activeSkinId: '',
    messages: {},
    memories: [],
  };
  await fs.writeFile(path.join(c.directory, 'state.json'), JSON.stringify(state));
  const backup = require('../electron/workspace-backup.cjs');
  const bytes = await backup.exportWorkspace(c.directory, state);
  const restored = await fs.mkdtemp(path.join(os.tmpdir(), 'mori-style-restored-'));
  t.after(() => fs.rm(restored, { recursive: true, force: true }));
  await backup.importWorkspace(restored, bytes);
  const reopened = createPetPipeline({ ...c.options, root: path.join(restored, 'pet-jobs') });
  assert.deepEqual(await reopened.styleReference(job.id), guide);
  assert.deepEqual((await reopened.load(job.id)).styleReference, job.styleReference);
  await reopened.advance(job.id, character, settings, {});
  assert.deepEqual(c.calls[0].input.styleReference, guide);
});
