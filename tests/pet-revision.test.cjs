'use strict';
const { plan: revisionPlan } = require('./fixtures/revision-plan.cjs');
// Inputs the fake chat planner received (user corrections never reach the image fakes directly).
const planned = [];
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createPetPipeline } = require('../electron/pet-pipeline.cjs');
const { referencePack, imageDigest } = require('../electron/references.cjs');
const fixture = require('./fixtures/pet-images.cjs');
const stamp = '2026-10-22T00:00:00.000Z';
const settings = { imageBaseUrl: 'https://revision.example/v1', imageModel: 'revision-fixture' };
const original = fixture.url(fixture.image());
const character = {
  id: 'revision-test',
  name: '修正测试',
  work: '隔离测试',
  summary: '',
  personality: [],
  speakingStyle: '',
  appearance: '',
  quotes: [],
  sources: [],
  unknowns: [],
  behavior: { energy: 50, affection: 50, curiosity: 50 },
  createdAt: stamp,
  visualReferences: [{ id: 'original', name: '角色原图', image: original, createdAt: stamp }],
};
function tinted(sheet, number) {
  const image = fixture.decode(fixture.image(sheet));
  for (let i = 0; i < image.bitmap.length; i += 4)
    if (image.bitmap[i + 3]) image.bitmap[i] = (image.bitmap[i] + number * 13) % 255;
  return fixture.url(fixture.encode(image.bitmap, image.width, image.height));
}
function master(style, number) {
  const pack = referencePack(character),
    image = tinted(false, number);
  return {
    id: randomUUID(),
    characterId: character.id,
    name: `${character.name} ${number}`,
    style,
    kind: 'image',
    images: { neutral: image },
    generated: true,
    createdAt: stamp,
    generation: {
      referenceIds: ['original'],
      referenceDigest: pack.digest,
      model: settings.imageModel,
      prompt: `Fixture candidate ${number}`,
    },
    review: { status: 'pending', referenceDigest: pack.digest, imageDigest: imageDigest(image) },
  };
}
async function setup(t, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mori-pet-revision-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const calls = [],
    installed = [];
  const options = {
    root,
    codec: fixture.codec,
    installSkin: async (skin) => {
      if (!installed.some((s) => s.id === skin.id)) installed.push(skin);
    },
    services: {
      prepareSkinGeneration() {},
      async generateSkin(input) {
        calls.push({ kind: 'base', input: structuredClone(input) });
        return master(input.style, calls.length);
      },
      async planRevision(input) {
        planned.push(structuredClone(input));
        return revisionPlan(input.feedback);
      },
      async revisePetBase(input) {
        calls.push({ kind: 'revision', input: structuredClone(input) });
        return master(input.style, calls.length);
      },
      async generatePetSheet(input) {
        calls.push({ kind: 'sheet', input: structuredClone(input) });
        return {
          image: tinted(true, calls.length),
          prompt: `Fixture sheet ${calls.length}`,
          model: settings.imageModel,
        };
      },
    },
    ...overrides,
  };
  return { root, options, pipeline: createPetPipeline(options), calls, installed };
}
async function complete(pipeline, job) {
  for (let i = 0; i <= job.steps.length && job.status !== 'ready'; i++) {
    assert.equal(job.awaitingSelection, undefined);
    job = await pipeline.advance(job.id, character, settings, {});
    assert.notEqual(job.status, 'attention', JSON.stringify(job.steps));
  }
  assert.equal(job.status, 'ready');
  return job;
}
async function finished(context, motions = ['wave', 'talk', 'blink']) {
  return complete(
    context.pipeline,
    await context.pipeline.start(character, { styles: ['3d'], motions }, settings, {}),
  );
}
const artifactPath = (root, job, motion) =>
  path.join(
    root,
    `${job.id}-${job.steps.findIndex((s) => s.kind === 'sheet' && s.motion === motion)}.asset.json`,
  );

for (const candidateCount of [2, 3])
  test(`${candidateCount} candidates stop before paid actions; the second candidate is durable and actually supplies every sheet`, async (t) => {
    const context = await setup(t),
      p = context.pipeline;
    let job = await p.start(
      character,
      { styles: ['3d'], motions: ['wave', 'talk'], candidateCount },
      settings,
      {},
    );
    for (let i = 0; i < candidateCount; i++) job = await p.advance(job.id, character, settings, {});
    assert.equal(job.awaitingSelection, '3d');
    assert.equal(context.calls.length, candidateCount);
    await assert.rejects(p.advance(job.id, character, settings, {}), /选择角色候选/);
    assert.equal(context.calls.length, candidateCount);
    const candidates = await p.masters(job.id);
    assert.equal(candidates.length, candidateCount);
    assert.notEqual(candidates[0].images.neutral, candidates[1].images.neutral);
    await assert.rejects(p.selectBase(job.id, '3d', randomUUID()), /不属于/);
    const reloaded = createPetPipeline(context.options);
    assert.equal((await reloaded.load(job.id)).awaitingSelection, '3d');
    job = await reloaded.selectBase(job.id, '3d', candidates[1].id);
    assert.equal(job.awaitingSelection, undefined);
    const restarted = createPetPipeline(context.options);
    job = await restarted.load(job.id);
    assert.equal(job.selectedBases['3d'], candidates[1].id);
    await complete(restarted, job);
    assert.equal(context.calls.length, candidateCount + 2);
    for (const call of context.calls.filter((c) => c.kind === 'sheet')) {
      assert.equal(call.input.skin.id, candidates[1].id);
      assert.equal(call.input.skin.images.neutral, candidates[1].images.neutral);
    }
    assert.equal((await restarted.masters(job.id)).length, candidateCount);
  });

test('a single-motion revision spends one image request, copies other sheet bytes and preserves the original task and output', async (t) => {
  const context = await setup(t),
    source = await finished(context),
    p = context.pipeline;
  const sourceFile = path.join(context.root, `${source.id}.json`);
  const previousJobBytes = await fs.readFile(sourceFile);
  const previousSkin = structuredClone(context.installed[0]);
  const requestsBefore = context.calls.length;
  let revision = await p.revise(
    source.id,
    { style: '3d', motion: 'wave', feedback: '手掌保持五指，动作更轻柔。' },
    character,
    settings,
  );
  assert.notEqual(revision.id, source.id);
  assert.equal(revision.steps[0].status, 'done');
  assert.equal(revision.steps.find((s) => s.motion === 'wave').status, 'queued');
  for (const motion of ['talk', 'blink'])
    assert.deepEqual(
      await fs.readFile(artifactPath(context.root, revision, motion)),
      await fs.readFile(artifactPath(context.root, source, motion)),
    );
  revision = await complete(p, revision);
  assert.equal(context.calls.length, requestsBefore + 1);
  const call = context.calls.at(-1);
  assert.equal(call.kind, 'sheet');
  assert.equal(call.input.motion, 'wave');
  // The user's words went to the chat planner with the current motion; the image request carries
  // only the instruction it wrote.
  const asked = planned.at(-1);
  assert.equal(asked.feedback, '手掌保持五指，动作更轻柔。');
  assert.equal(asked.motion, 'wave');
  assert.ok(asked.images.length >= 2, 'the planner sees the current motion and the master');
  assert.equal(call.input.correction, 'Planned correction for: 手掌保持五指，动作更轻柔。');
  assert.equal(call.input.feedback, undefined);
  assert.equal(revision.revision.plan.summary, '理解：手掌保持五指，动作更轻柔。');
  assert.equal(call.input.skin.id, source.selectedBases['3d']);
  assert.notDeepEqual(
    await fs.readFile(artifactPath(context.root, revision, 'wave')),
    await fs.readFile(artifactPath(context.root, source, 'wave')),
  );
  assert.deepEqual(await fs.readFile(sourceFile), previousJobBytes);
  assert.deepEqual(context.installed[0], previousSkin);
  assert.equal(context.installed.length, 2);
  assert.notEqual(context.installed[1].id, previousSkin.id);
  assert.equal(context.installed[1].review.status, 'pending');
  assert.equal((await p.results(source.id))[0].id, previousSkin.id);
});

test('a character revision edits the chosen master and regenerates every action through the dedicated revision service', async (t) => {
  const context = await setup(t),
    source = await finished(context),
    p = context.pipeline;
  const requestsBefore = context.calls.length;
  let revision = await p.revise(
    source.id,
    { style: '3d', feedback: '眼睛更清晰，保留发饰。' },
    character,
    settings,
  );
  assert.ok(revision.steps.every((step) => step.status === 'queued'));
  const restarted = createPetPipeline(context.options);
  revision = await complete(restarted, revision);
  const calls = context.calls.slice(requestsBefore);
  assert.equal(calls.length, 1 + source.motions.length);
  assert.equal(calls[0].kind, 'revision');
  assert.equal(calls[0].input.skin.id, source.selectedBases['3d']);
  assert.equal(calls[0].input.feedback, '眼睛更清晰，保留发饰。');
  assert.equal(calls.filter((call) => call.kind === 'base').length, 0);
  assert.deepEqual(
    calls.slice(1).map((call) => call.input.motion),
    source.motions,
  );
  assert.ok(calls.slice(1).every((call) => call.input.skin.id === revision.selectedBases['3d']));
  assert.notEqual(revision.selectedBases['3d'], source.selectedBases['3d']);
  assert.equal((await restarted.load(source.id)).status, 'ready');
});

test('unfinished duplicate revisions, changed references/configuration and invalid requests are rejected before generation', async (t) => {
  const context = await setup(t),
    source = await finished(context),
    p = context.pipeline;
  const input = { style: '3d', motion: 'wave', feedback: '动作放缓。' },
    before = context.calls.length;
  for (const change of [
    { feedback: '' },
    { feedback: 'x'.repeat(601) },
    { style: 'anime' },
    { motion: 'bounce' },
  ])
    await assert.rejects(p.revise(source.id, { ...input, ...change }, character, settings));
  await assert.rejects(
    p.revise(
      source.id,
      input,
      { ...character, visualReferences: [{ ...character.visualReferences[0], image: tinted(false, 10) }] },
      settings,
    ),
    /参考或图像服务已变化/,
  );
  await assert.rejects(
    p.revise(source.id, input, character, { ...settings, imageModel: 'changed' }),
    /参考或图像服务已变化/,
  );
  const outcomes = await Promise.allSettled([
    p.revise(source.id, input, character, settings),
    p.revise(source.id, input, character, settings),
  ]);
  assert.equal(outcomes.filter((item) => item.status === 'fulfilled').length, 1);
  assert.match(outcomes.find((item) => item.status === 'rejected').reason.message, /未完成任务/);
  assert.equal(context.calls.length, before);
});

test('acknowledged revision pixels survive a failed local save and retry without another image request', async (t) => {
  let failedArtifact = '';
  const context = await setup(t, {
    io: {
      ...fs,
      rename: async (from, to) => {
        if (to === failedArtifact) {
          failedArtifact = '';
          throw new Error('Fixture revision image disk failure');
        }
        return fs.rename(from, to);
      },
    },
  });
  const source = await finished(context),
    before = context.calls.length,
    p = context.pipeline;
  let revision = await p.revise(
    source.id,
    { style: '3d', motion: 'wave', feedback: '手指更清晰。' },
    character,
    settings,
  );
  failedArtifact = artifactPath(context.root, revision, 'wave');
  revision = await p.advance(revision.id, character, settings, {});
  assert.equal(revision.steps.find((step) => step.motion === 'wave').status, 'unsaved');
  assert.equal(context.calls.length, before + 1);
  revision = await p.advance(revision.id, character, settings, {});
  assert.equal(revision.steps.find((step) => step.motion === 'wave').status, 'done');
  assert.equal(context.calls.length, before + 1);
  await complete(createPetPipeline(context.options), revision);
  assert.equal(context.calls.length, before + 1);
  assert.equal((await p.load(source.id)).status, 'ready');
});

test('a revision checkpoint write failure prevents payment and a restart safely resumes', async (t) => {
  let failedCheckpoint = '';
  const context = await setup(t, {
    io: {
      ...fs,
      rename: async (from, to) => {
        if (to === failedCheckpoint) {
          failedCheckpoint = '';
          throw new Error('Fixture revision checkpoint failure');
        }
        return fs.rename(from, to);
      },
    },
  });
  const source = await finished(context),
    p = context.pipeline,
    before = context.calls.length;
  const revision = await p.revise(
    source.id,
    { style: '3d', feedback: '缩小后脸部更清楚。' },
    character,
    settings,
  );
  failedCheckpoint = path.join(context.root, `${revision.id}.json`);
  await assert.rejects(p.advance(revision.id, character, settings, {}), /checkpoint failure/);
  assert.equal(context.calls.length, before);
  const restarted = createPetPipeline(context.options);
  await complete(restarted, await restarted.load(revision.id));
  assert.equal(context.calls.length, before + 1 + source.motions.length);
});

test('failed candidate selection remains selectable and does not silently accept an unpersisted choice', async (t) => {
  let failedCheckpoint = '';
  const context = await setup(t, {
    io: {
      ...fs,
      rename: async (from, to) => {
        if (to === failedCheckpoint) {
          failedCheckpoint = '';
          throw new Error('Fixture selection checkpoint failure');
        }
        return fs.rename(from, to);
      },
    },
  });
  const p = context.pipeline;
  let job = await p.start(
    character,
    { styles: ['3d'], motions: ['wave'], candidateCount: 2 },
    settings,
    {},
  );
  job = await p.advance(job.id, character, settings, {});
  job = await p.advance(job.id, character, settings, {});
  const candidates = await p.masters(job.id);
  failedCheckpoint = path.join(context.root, `${job.id}.json`);
  await assert.rejects(p.selectBase(job.id, '3d', candidates[1].id), /selection checkpoint failure/);
  assert.equal((await p.load(job.id)).awaitingSelection, '3d');
  assert.equal(context.calls.length, 2);
  job = await p.selectBase(job.id, '3d', candidates[1].id);
  assert.equal(job.selectedBases['3d'], candidates[1].id);
  const restarted = createPetPipeline(context.options);
  assert.equal((await restarted.load(job.id)).selectedBases['3d'], candidates[1].id);
});

test('a motion revision plans once: planning failures stop before the image request and retries reuse the plan', async (t) => {
  const context = await setup(t),
    source = await finished(context),
    p = context.pipeline,
    services = context.options.services;
  let revision = await p.revise(source.id, { style: '3d', motion: 'wave', feedback: '挥手更轻' }, character, settings);
  const index = revision.steps.findIndex((s) => s.motion === 'wave');
  const plan = services.planRevision,
    sheet = services.generatePetSheet;
  let plans = 0,
    failPlan = true,
    failSheet = true;
  services.planRevision = async (input) => {
    plans++;
    if (failPlan) throw new Error('修正资料搜索未完成：fixture');
    return plan(input);
  };
  services.generatePetSheet = async (input) => {
    if (failSheet) {
      context.calls.push({ kind: 'failed-sheet' });
      throw new Error('image service down');
    }
    return sheet(input);
  };
  const before = context.calls.length;
  revision = await p.advance(revision.id, character, settings, {});
  assert.equal(revision.steps[index].status, 'failed', 'no automatic retry and no image request after a planning failure');
  assert.equal(revision.steps[index].attempts, undefined);
  assert.equal(context.calls.length, before);
  failPlan = false;
  revision = await p.retry(revision.id, index);
  revision = await p.advance(revision.id, character, settings, {});
  assert.equal(revision.steps[index].status, 'uncertain');
  assert.equal(plans, 2);
  assert.equal(revision.revision.plan.summary, '理解：挥手更轻');
  failSheet = false;
  revision = await p.retry(revision.id, index);
  revision = await complete(p, revision);
  assert.equal(plans, 2, 'the saved plan is reused');
  const drawn = context.calls.filter((call) => call.kind === 'sheet').at(-1);
  assert.equal(drawn.input.correction, 'Planned correction for: 挥手更轻');
});
