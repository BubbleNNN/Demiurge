'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { productionOptions, candidateRecipe } = require('../electron/pet-recipes.cjs');
const directions = require('../shared/pet-candidate-directions.json');
const { createPetPipeline } = require('../electron/pet-pipeline.cjs');
const { referencePack, imageDigest } = require('../electron/references.cjs');
const fixture = require('./fixtures/pet-images.cjs');
const settings = { imageBaseUrl: 'https://directions.example/v1', imageModel: 'fixture' };
const stamp = '2026-10-23T00:00:00.000Z';
const picture = fixture.url(fixture.image());
const character = {
  id: 'candidate-direction-character',
  name: '方向测试',
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
  visualReferences: [{ id: 'original', name: '身份原图', image: picture, createdAt: stamp }],
};
function master(style, direction) {
  const pack = referencePack(character);
  return {
    id: randomUUID(),
    characterId: character.id,
    name: '候选',
    style,
    kind: 'image',
    images: { neutral: picture },
    generated: true,
    createdAt: stamp,
    generation: {
      referenceIds: ['original'],
      referenceDigest: pack.digest,
      model: settings.imageModel,
      prompt: 'Fixture master',
      ...(direction ? { candidateDirection: direction } : {}),
    },
    review: { status: 'pending', referenceDigest: pack.digest, imageDigest: imageDigest(picture) },
  };
}
async function setup(t, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mori-candidate-directions-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const calls = [],
    options = {
      root,
      codec: fixture.codec,
      installSkin: async () => {},
      services: {
        prepareSkinGeneration() {},
        async generateSkin(input) {
          calls.push({ kind: 'base', input: structuredClone(input) });
          return master(input.style, candidateRecipe(input.style, input.candidateIndex, input)?.id);
        },
        async revisePetBase(input) {
          calls.push({ kind: 'edit', input: structuredClone(input) });
          return {
            ...input.skin,
            id: randomUUID(),
            generation: { ...input.skin.generation, parentSkinId: input.skin.id },
          };
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
      ...overrides,
    };
  return { root, calls, options, pipeline: createPetPipeline(options) };
}
const input = (extra = {}) => ({
  styles: ['3d'],
  motions: ['wave'],
  candidateCount: 3,
  candidateVariation: 'explore',
  ...extra,
});

test('old options keep subtle variation while explore is explicit and validated', () => {
  assert.deepEqual(productionOptions(), {
    candidateCount: 1,
    candidateVariation: 'subtle',
    frameCount: 4,
    temperament: 'natural',
    artDirection: '',
  });
  assert.equal(productionOptions({ candidateVariation: 'explore' }).candidateVariation, 'explore');
  for (const value of ['unknown', 'EXPLORE', true, [], {}])
    assert.throws(() => productionOptions({ candidateVariation: value }), /候选变化/);
  assert.equal(candidateRecipe('3d', undefined), null);
  assert.equal(candidateRecipe('original', 3, { candidateVariation: 'subtle' }), null);
});

test('explore recipes have stable named order independent of candidateCount', () => {
  for (const count of [1, 2, 3])
    for (const [index, id] of ['balanced', 'bold', 'soft'].entries())
      assert.deepEqual(
        candidateRecipe('3d', index + 1, { candidateCount: count, candidateVariation: 'explore' }),
        { id, ...directions[id] },
      );
  const original = candidateRecipe('original', 2, { candidateVariation: 'explore' });
  assert.equal(original.originalPrompt, directions.bold.originalPrompt);
  assert.notEqual(original.originalPrompt, original.prompt);
  const changed = candidateRecipe('3d', 1, { candidateVariation: 'explore' });
  changed.label = 'local override';
  assert.equal(
    candidateRecipe('3d', 1, { candidateVariation: 'explore' }).label,
    directions.balanced.label,
  );
});

test('explore rejects unknown styles and invalid indices rather than silently choosing a direction', () => {
  for (const index of [undefined, null, 0, 4, -1, 1.5, '1', NaN])
    assert.throws(() => candidateRecipe('3d', index, { candidateVariation: 'explore' }), /方向编号/);
  assert.throws(() => candidateRecipe('unknown', 1, { candidateVariation: 'explore' }), /画风/);
});

test('restart preserves explore and each base uses its stable index before selection pauses all motion requests', async (t) => {
  const c = await setup(t),
    p = c.pipeline;
  let job = await p.start(character, input(), settings, {});
  assert.equal(job.candidateVariation, 'explore');
  job = await p.advance(job.id, character, settings, {});
  const restarted = createPetPipeline(c.options);
  assert.equal((await restarted.load(job.id)).candidateVariation, 'explore');
  job = await restarted.advance(job.id, character, settings, {});
  job = await restarted.advance(job.id, character, settings, {});
  assert.deepEqual(
    c.calls.map((call) => call.input.candidateIndex),
    [1, 2, 3],
  );
  assert.ok(c.calls.every((call) => call.input.candidateVariation === 'explore'));
  assert.ok(
    c.calls.every(
      (call) =>
        JSON.stringify(call.input.character.visualReferences) === JSON.stringify(character.visualReferences),
    ),
  );
  assert.equal(job.awaitingSelection, '3d');
  await assert.rejects(restarted.advance(job.id, character, settings, {}), /先选择/);
  assert.equal(c.calls.length, 3);
  const candidates = await restarted.masters(job.id);
  assert.deepEqual(
    candidates.map((skin) => skin.generation.candidateDirection),
    ['balanced', 'bold', 'soft'],
  );
  job = await restarted.selectBase(job.id, '3d', candidates[2].id);
  await restarted.advance(job.id, character, settings, {});
  assert.equal(c.calls.at(-1).input.skin.id, candidates[2].id);
  assert.equal(c.calls.at(-1).input.skin.generation.candidateDirection, 'soft');
});

test('legacy jobs with no variation field retain unnamed subtle candidates', async (t) => {
  const c = await setup(t),
    p = c.pipeline;
  const job = await p.start(
    character,
    input({ candidateCount: 1, candidateVariation: undefined }),
    settings,
    {},
  );
  delete job.candidateVariation;
  await fs.writeFile(path.join(c.root, `${job.id}.json`), JSON.stringify(job));
  const restarted = createPetPipeline(c.options);
  await restarted.advance(job.id, character, settings, {});
  assert.equal(c.calls[0].input.candidateVariation, undefined);
  assert.equal(candidateRecipe('3d', c.calls[0].input.candidateIndex, c.calls[0].input), null);
  assert.equal((await restarted.masters(job.id))[0].generation.candidateDirection, undefined);
});

test('invalid variation stops new and resumed jobs before a paid request', async (t) => {
  const c = await setup(t),
    p = c.pipeline;
  await assert.rejects(
    p.start(character, input({ candidateVariation: 'unknown' }), settings, {}),
    /候选变化/,
  );
  const job = await p.start(character, input(), settings, {});
  job.candidateVariation = 'unknown';
  await fs.writeFile(path.join(c.root, `${job.id}.json`), JSON.stringify(job));
  await assert.rejects(createPetPipeline(c.options).advance(job.id, character, settings, {}), /候选变化/);
  assert.equal(c.calls.length, 0);
});

test('sourceSkin keeps its existing direction and does not generate a replacement candidate', async (t) => {
  const c = await setup(t),
    source = master('3d', 'soft');
  let job = await c.pipeline.start(character, input({ sourceSkin: source }), settings, {});
  assert.equal(job.candidateCount, 1);
  assert.equal(job.steps[0].status, 'done');
  job = await c.pipeline.advance(job.id, character, settings, {});
  assert.equal(c.calls.length, 1);
  assert.equal(c.calls[0].kind, 'sheet');
  assert.equal(c.calls[0].input.skin.id, source.id);
  assert.equal(c.calls[0].input.skin.generation.candidateDirection, 'soft');
});

test('refinement and completed base revision inherit the chosen direction without reinterpretation', async (t) => {
  const c = await setup(t),
    p = c.pipeline;
  let job = await p.start(character, input(), settings, {});
  for (let i = 0; i < 3; i++) job = await p.advance(job.id, character, settings, {});
  const original = (await p.masters(job.id))[2];
  job = await p.refineBase(
    job.id,
    { style: '3d', skinId: original.id, feedback: '只修正手指' },
    character,
    settings,
    {},
  );
  const revised = (await p.masters(job.id)).at(-1);
  assert.equal(revised.generation.candidateDirection, 'soft');
  assert.equal(c.calls.at(-1).input.candidateVariation, undefined);
  job = await p.selectBase(job.id, '3d', revised.id);
  job = await p.advance(job.id, character, settings, {});
  job = await p.advance(job.id, character, settings, {});
  assert.equal(job.status, 'ready');
  let followup = await p.revise(job.id, { style: '3d', feedback: '只修正嘴角' }, character, settings);
  followup = await p.advance(followup.id, character, settings, {});
  assert.equal(followup.steps[0].status, 'done');
  const edit = c.calls.at(-1);
  assert.equal(edit.kind, 'edit');
  assert.equal(edit.input.candidateVariation, undefined);
  assert.equal(edit.input.skin.generation.candidateDirection, 'soft');
  assert.equal((await p.masters(followup.id))[0].generation.candidateDirection, 'soft');
});

test('recovering acknowledged candidate pixels preserves its direction without another request', async (t) => {
  let fail = true;
  const c = await setup(t, {
      io: {
        ...fs,
        rename: async (from, to) => {
          if (fail && /-0\.asset\.json$/.test(to)) {
            fail = false;
            throw new Error('Output write failed');
          }
          return fs.rename(from, to);
        },
      },
    }),
    p = c.pipeline;
  let job = await p.start(character, input({ candidateCount: 1 }), settings, {});
  job = await p.advance(job.id, character, settings, {});
  assert.equal(job.steps[0].status, 'unsaved');
  job = await p.advance(job.id, character, settings, {});
  assert.equal(job.steps[0].status, 'done');
  assert.equal(c.calls.length, 1);
  assert.equal((await p.masters(job.id))[0].generation.candidateDirection, 'balanced');
});
