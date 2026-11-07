'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createServices } = require('../electron/services.cjs');
const { validateSkin } = require('../electron/store.cjs');
const { referencePack } = require('../electron/references.cjs');
const directions = require('../shared/pet-candidate-directions.json');
const fixture = require('./fixtures/pet-images.cjs');
const stamp = '2026-10-23T00:00:00.000Z';
const settings = { imageBaseUrl: 'https://directions.example/v1', imageModel: 'fixture-image' };
const credentials = { imageKey: 'isolated-direction-key' };
const character = {
  id: 'directions-character',
  name: '角色',
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
  visualReferences: [
    { id: 'identity', name: '角色原图', image: fixture.url(fixture.image()), createdAt: stamp },
  ],
};
const styleReference = {
  id: 'style-guide',
  name: '画风示例',
  image: fixture.url(fixture.image(true)),
  createdAt: stamp,
};
const bytes = (url) => Buffer.from(url.split(',')[1], 'base64');
function transport() {
  const calls = [];
  return {
    calls,
    services: createServices(async (url, init) => {
      const images = init.body.getAll('image[]').length
        ? init.body.getAll('image[]')
        : [init.body.get('image')];
      calls.push({
        prompt: init.body.get('prompt'),
        images: await Promise.all(images.map(async (image) => Buffer.from(await image.arrayBuffer()))),
      });
      return new Response(JSON.stringify({ data: [{ b64_json: fixture.image().toString('base64') }] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  };
}

test('explore candidates use three distinct saved design briefs with the exact same identity and style inputs', async () => {
  const { services, calls } = transport();
  for (const [index, id] of ['balanced', 'bold', 'soft'].entries()) {
    const result = await services.generateSkin(
      {
        character,
        style: 'pixel',
        styleReference,
        candidateVariation: 'explore',
        candidateIndex: index + 1,
      },
      settings,
      credentials,
    );
    assert.equal(result.generation.candidateDirection, id);
    assert.equal(validateSkin(result).generation.candidateDirection, id);
    assert.ok(calls[index].prompt.includes(directions[id].prompt));
    assert.deepEqual(
      calls[index].images,
      [character.visualReferences[0].image, styleReference.image].map(bytes),
    );
    assert.deepEqual(result.generation.referenceIds, ['identity']);
    assert.equal(result.generation.referenceDigest, referencePack(character).digest);
  }
  assert.equal(calls.length, 3);
  assert.equal(new Set(calls.map((call) => call.prompt)).size, 3);
  assert.match(calls[2].prompt, /not through blur or smoothing/);
});

test('original-medium exploration uses conservative original briefs and never the transformed-medium brief', async () => {
  const { services, calls } = transport();
  for (const [index, id] of ['balanced', 'bold', 'soft'].entries()) {
    const result = await services.generateSkin(
      {
        character,
        style: 'original',
        candidateVariation: 'explore',
        candidateIndex: index + 1,
      },
      settings,
      credentials,
    );
    assert.equal(result.generation.candidateDirection, id);
    assert.ok(calls[index].prompt.includes(directions[id].originalPrompt));
    assert.equal(calls[index].prompt.includes(directions[id].prompt), false);
    assert.deepEqual(calls[index].images, [bytes(character.visualReferences[0].image)]);
  }
});

test('legacy and subtle candidates keep unlabelled provenance while corrections inherit a chosen direction', async () => {
  const { services, calls } = transport();
  for (const option of [{}, { candidateVariation: 'subtle' }]) {
    const legacy = await services.generateSkin(
      { character, style: 'chibi', candidateIndex: 2, ...option },
      settings,
      credentials,
    );
    assert.equal(legacy.generation.candidateDirection, undefined);
    assert.doesNotMatch(calls.at(-1).prompt, /Candidate design direction/);
  }
  const base = await services.generateSkin(
    { character, style: 'chibi', candidateVariation: 'explore', candidateIndex: 2 },
    settings,
    credentials,
  );
  const corrected = await services.revisePetBase(
    { character, skin: base, referenceDigest: referencePack(character).digest, feedback: '修正手指' },
    settings,
    credentials,
  );
  assert.equal(corrected.generation.candidateDirection, 'bold');
  assert.doesNotMatch(calls.at(-1).prompt, /Candidate design direction/);
  await services.generatePetSheet(
    { character, skin: corrected, motion: 'wave', referenceDigest: referencePack(character).digest },
    settings,
    credentials,
  );
  assert.deepEqual(
    calls.at(-1).images,
    [corrected.images.neutral, character.visualReferences[0].image].map(bytes),
  );
  assert.doesNotMatch(calls.at(-1).prompt, /Candidate design direction/);
  assert.equal(calls.length, 5);
  assert.throws(() =>
    validateSkin({ ...corrected, generation: { ...corrected.generation, candidateDirection: 'unknown' } }),
  );
});

test('unknown exploration modes and invalid indices cannot issue image requests', async () => {
  const { services, calls } = transport();
  for (const change of [
    { candidateVariation: 'unknown' },
    { candidateIndex: 0 },
    { candidateIndex: 4 },
    { candidateIndex: '2' },
    { candidateIndex: 1.5 },
  ])
    await assert.rejects(
      services.generateSkin(
        { character, style: 'chibi', candidateVariation: 'explore', candidateIndex: 1, ...change },
        settings,
        credentials,
      ),
    );
  assert.equal(calls.length, 0);
});

test('sticker style travels through real generation, correction and motion requests with identity bytes', async () => {
  const { services, calls } = transport();
  const base = await services.generateSkin(
    { character, style: 'sticker', styleReference },
    settings,
    credentials,
  );
  assert.equal(base.style, 'sticker');
  assert.match(base.name, /清爽贴纸/);
  assert.match(calls[0].prompt, /TWO heads tall/);
  assert.match(calls[0].prompt, /one hard-edged shadow/);
  assert.deepEqual(calls[0].images, [character.visualReferences[0].image, styleReference.image].map(bytes));
  const corrected = await services.revisePetBase(
    { character, skin: base, referenceDigest: referencePack(character).digest, feedback: '保留帽子上的标记' },
    settings,
    credentials,
  );
  assert.equal(validateSkin(corrected).style, 'sticker');
  await services.generatePetSheet(
    { character, skin: corrected, motion: 'blink', referenceDigest: referencePack(character).digest },
    settings,
    credentials,
  );
  assert.match(calls[2].prompt, /clean flat-color chibi sticker/);
  assert.deepEqual(
    calls[2].images,
    [corrected.images.neutral, character.visualReferences[0].image].map(bytes),
  );
});

test('activity requests use eight poses, consistent props and the exact chosen master despite four-frame default', async () => {
  const { services, calls } = transport();
  const base = await services.generateSkin({ character, style: 'sticker' }, settings, credentials);
  for (const motion of ['read', 'gaming']) {
    await services.generatePetSheet({ character, skin: base, motion, frameCount: 4, referenceDigest: referencePack(character).digest }, settings, credentials);
    const call = calls.at(-1);
    assert.match(call.prompt, /EIGHT complete full-body frames/);
    assert.match(call.prompt, /1536x1024/);
    assert.match(call.prompt, /regular 4-by-2 grid/);
    assert.match(call.prompt, /ACTIVITY with entrance, loop and exit/);
    assert.match(call.prompt, /Frames 4 and 6 must match/);
    assert.deepEqual(call.images, [base.images.neutral, character.visualReferences[0].image].map(bytes));
  }
});
