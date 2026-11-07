'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createServices } = require('../electron/services.cjs');
const { createPetPipeline } = require('../electron/pet-pipeline.cjs');
const { referencePack, imageDigest } = require('../electron/references.cjs');
const fixture = require('./fixtures/pet-images.cjs');
const stamp = '2026-10-22T00:00:00.000Z';
const settings = { imageBaseUrl: 'https://review.example/v1', imageModel: 'image-fixture' };
const credentials = { imageKey: 'fixture-image-key', llmKey: 'must-not-send-chat-key' };
function picture(number, sheet = false) {
  const value = fixture.decode(fixture.image(sheet));
  for (let i = 0; i < value.bitmap.length; i += 4)
    if (value.bitmap[i + 3]) value.bitmap[i] = (value.bitmap[i] + number * 11) % 255;
  return fixture.url(fixture.encode(value.bitmap, value.width, value.height));
}
const character = {
  id: 'review-character',
  name: '审查角色',
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
  visualReferences: [1, 2].map((n) => ({
    id: `original-${n}`,
    name: `原图${n}`,
    image: picture(n),
    createdAt: stamp,
  })),
};
function master(number = 3) {
  const pack = referencePack(character),
    image = picture(number);
  return {
    id: randomUUID(),
    characterId: character.id,
    name: '候选',
    style: 'chibi',
    kind: 'image',
    images: { neutral: image },
    generated: true,
    createdAt: stamp,
    generation: {
      referenceIds: pack.references.map((r) => r.id),
      referenceDigest: pack.digest,
      model: settings.imageModel,
      prompt: 'Original candidate',
    },
    review: { status: 'pending', referenceDigest: pack.digest, imageDigest: imageDigest(image) },
  };
}
const bytes = (url) => Buffer.from(url.split(',')[1], 'base64');
function transport(output) {
  const requests = [];
  return {
    requests,
    services: createServices(async (url, init) => {
      const images = init.body.getAll('image[]');
      requests.push({
        url,
        headers: init.headers,
        prompt: init.body.get('prompt'),
        size: init.body.get('size'),
        images: await Promise.all(images.map(async (image) => Buffer.from(await image.arrayBuffer()))),
      });
      return new Response(JSON.stringify({ data: [{ b64_json: bytes(output).toString('base64') }] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  };
}

test('base revision sends the chosen pixels plus every original and subsequent sheets use the new base', async () => {
  const base = master(),
    output = picture(8),
    { services, requests } = transport(output);
  const input = {
    character,
    skin: base,
    referenceDigest: referencePack(character).digest,
    feedback: '只修清晰的眼睛',
  };
  const revised = await services.revisePetBase(input, settings, credentials);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://review.example/v1/images/edits');
  assert.equal(requests[0].headers.Authorization, 'Bearer fixture-image-key');
  assert.deepEqual(
    requests[0].images,
    [base.images.neutral, ...character.visualReferences.map((r) => r.image)].map(bytes),
  );
  assert.match(requests[0].prompt, /只修清晰的眼睛/);
  assert.notEqual(revised.id, base.id);
  assert.equal(revised.images.neutral, output);
  assert.equal(revised.generation.parentSkinId, base.id);
  assert.deepEqual(revised.generation.referenceIds, ['original-1', 'original-2']);
  assert.equal(revised.generation.referenceDigest, referencePack(character).digest);
  assert.equal(revised.review.status, 'pending');
  await services.generatePetSheet(
    { character, skin: revised, motion: 'wave', referenceDigest: input.referenceDigest },
    settings,
    credentials,
  );
  assert.deepEqual(
    requests[1].images,
    [output, ...character.visualReferences.map((r) => r.image)].map(bytes),
  );
  assert.doesNotMatch(requests[1].prompt, /只修清晰的眼睛/);
  assert.equal(base.images.neutral, picture(3));
});

test('motion feedback belongs to its request and never mutates the shared base or later requests', async () => {
  const base = master(),
    snapshot = structuredClone(base),
    { services, requests } = transport(picture(7, true));
  const input = { character, skin: base, referenceDigest: referencePack(character).digest };
  await services.generatePetSheet(
    { ...input, motion: 'wave', feedback: '只调整招手的手指', frameCount: 8 },
    settings,
    credentials,
  );
  await services.generatePetSheet({ ...input, motion: 'talk' }, settings, credentials);
  assert.match(requests[0].prompt, /只调整招手的手指/);
  assert.doesNotMatch(requests[1].prompt, /只调整招手的手指/);
  assert.equal(requests[0].size, '1536x1024');
  assert.equal(requests[1].size, '1024x1024');
  for (const request of requests)
    assert.deepEqual(
      request.images,
      [base.images.neutral, ...character.visualReferences.map((r) => r.image)].map(bytes),
    );
  assert.deepEqual(base, snapshot);
});

test('revision rejects stale identity provenance and invalid feedback before issuing an image request', async () => {
  const base = master(),
    { services, requests } = transport(picture(8));
  const input = {
    character,
    skin: base,
    referenceDigest: referencePack(character).digest,
    feedback: '修改眼睛',
  };
  for (const change of [
    { referenceDigest: '0'.repeat(64) },
    { skin: { ...base, characterId: 'other-character' } },
    { skin: { ...base, generation: { ...base.generation, referenceIds: ['original-2', 'original-1'] } } },
    { skin: { ...base, generation: { ...base.generation, referenceDigest: '0'.repeat(64) } } },
    { feedback: '' },
    { feedback: 'x'.repeat(601) },
  ])
    await assert.rejects(services.revisePetBase({ ...input, ...change }, settings, credentials));
  await assert.rejects(
    services.generatePetSheet({ ...input, motion: 'wave', feedback: {} }, settings, credentials),
  );
  assert.equal(requests.length, 0);
});

test('last-candidate checkpoint recovery does not force premature selection or replace a chosen master', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mori-candidate-review-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let failFinalCandidate = false,
    count = 0;
  const sheets = [];
  const options = {
    root,
    codec: fixture.codec,
    installSkin: async () => {},
    io: {
      ...fs,
      rename: async (from, to) => {
        if (failFinalCandidate && to.endsWith('.json') && !to.endsWith('.asset.json')) {
          const value = JSON.parse(await fs.readFile(from, 'utf8'));
          if (value.steps?.[1].status === 'done') {
            failFinalCandidate = false;
            throw new Error('Last candidate checkpoint unavailable');
          }
        }
        return fs.rename(from, to);
      },
    },
    services: {
      prepareSkinGeneration() {},
      generateSkin: async () => master(++count + 3),
      generatePetSheet: async (input) => {
        sheets.push(input.skin.id);
        return { image: picture(9, true) };
      },
    },
  };
  const pipeline = createPetPipeline(options);
  let job = await pipeline.start(
    character,
    { styles: ['chibi'], motions: ['wave'], candidateCount: 2 },
    settings,
    credentials,
  );
  job = await pipeline.advance(job.id, character, settings, credentials);
  failFinalCandidate = true;
  job = await pipeline.advance(job.id, character, settings, credentials);
  assert.equal(job.steps[1].status, 'unsaved');
  const restarted = createPetPipeline(options);
  job = await restarted.advance(job.id, character, settings, credentials);
  assert.equal(count, 2, 'Recovery must not issue another base request');
  assert.equal(job.awaitingSelection, 'chibi');
  const candidates = await restarted.masters(job.id);
  assert.equal(candidates.length, 2);
  job = await restarted.selectBase(job.id, 'chibi', candidates[0].id);
  job = await restarted.advance(job.id, character, settings, credentials);
  assert.equal(job.selectedBases.chibi, candidates[0].id);
  assert.deepEqual(sheets, [candidates[0].id]);
});

test('normalizing an older cancelled candidate failure cannot revive its task', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mori-cancelled-candidate-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let count = 0;
  const options = {
    root,
    codec: fixture.codec,
    installSkin: async () => {},
    services: {
      prepareSkinGeneration() {},
      generateSkin: async () => master(++count + 3),
      generatePetSheet: async () => assert.fail('A cancelled task cannot generate sheets'),
    },
  };
  const pipeline = createPetPipeline(options);
  let job = await pipeline.start(
    character,
    { styles: ['chibi'], motions: ['wave'], candidateCount: 2 },
    settings,
    credentials,
  );
  job = await pipeline.advance(job.id, character, settings, credentials);
  job = await pipeline.advance(job.id, character, settings, credentials);
  // This is the durable state produced by the older checkpoint bug followed
  // by the user's explicit cancellation. Both returned candidate files exist.
  job.steps[1].status = 'unsaved';
  job.status = 'cancelled';
  await fs.writeFile(path.join(root, `${job.id}.json`), JSON.stringify(job));
  const restarted = createPetPipeline(options);
  assert.equal((await restarted.load(job.id)).status, 'cancelled');
  await assert.rejects(restarted.advance(job.id, character, settings, credentials), /已结束/);
  assert.equal(count, 2);
});
