'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createServices } = require('../electron/services.cjs');
const { validateSkin, validateStyleReference } = require('../electron/store.cjs');
const { referencePack, styleReferencePack, reviewSkin } = require('../electron/references.cjs');
const fixture = require('./fixtures/pet-images.cjs');
const stamp = '2026-10-23T00:00:00.000Z';
const settings = { imageBaseUrl: 'https://style-guide.example/v1', imageModel: 'fixture-image' };
const credentials = { imageKey: 'isolated-style-key' };
function picture(number) {
  const value = fixture.decode(fixture.image());
  for (let i = 0; i < value.bitmap.length; i += 4)
    if (value.bitmap[i + 3]) value.bitmap[i] = (value.bitmap[i] + number * 17) % 255;
  return fixture.url(fixture.encode(value.bitmap, value.width, value.height));
}
const character = {
  id: 'style-service-character',
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
  visualReferences: [1, 2, 3, 4].map((n) => ({
    id: `identity-${n}`,
    name: `角色原图${n}`,
    image: picture(n),
    createdAt: stamp,
  })),
};
const guide = { id: 'style-guide', name: '上色参考.png', image: picture(6), createdAt: stamp };
const bytes = (url) => Buffer.from(url.split(',')[1], 'base64');
function transport(options) {
  const calls = [];
  return {
    calls,
    services: createServices(async (url, init) => {
      const images = init.body.getAll('image[]');
      calls.push({
        url,
        prompt: init.body.get('prompt'),
        headers: init.headers,
        images: await Promise.all(images.map(async (item) => Buffer.from(await item.arrayBuffer()))),
      });
      return new Response(JSON.stringify({ data: [{ b64_json: bytes(picture(8)).toString('base64') }] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }, options),
  };
}

test('four identity originals and a style guide have separate roles, exact bytes and independent provenance', async () => {
  const before = structuredClone(character),
    { services, calls } = transport();
  const identity = referencePack(character),
    style = styleReferencePack(guide);
  const base = await services.generateSkin(
    { character, style: 'chibi', styleReference: guide },
    settings,
    credentials,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://style-guide.example/v1/images/edits');
  assert.equal(calls[0].headers.Authorization, 'Bearer isolated-style-key');
  assert.deepEqual(
    calls[0].images,
    [...character.visualReferences.map((ref) => ref.image), guide.image].map(bytes),
  );
  assert.match(calls[0].prompt, /Images 1 through 4 are the original identity references/);
  assert.match(calls[0].prompt, /Image 5 is a STYLE-ONLY reference, NOT an identity/);
  assert.match(calls[0].prompt, /Do not copy its depicted subject/);
  assert.equal(base.generation.referenceDigest, identity.digest);
  assert.deepEqual(base.generation.referenceIds, ['identity-1', 'identity-2', 'identity-3', 'identity-4']);
  assert.deepEqual(validateSkin(base).generation.styleReference, style.summary);
  assert.deepEqual(reviewSkin(character, base, 'approved').generation.styleReference, style.summary);
  assert.deepEqual(character, before);
});

test('candidate correction attaches frozen style after originals; motions use the selected master without restyling', async () => {
  const { services, calls } = transport();
  const base = await services.generateSkin(
    { character, style: 'pixel', styleReference: guide },
    settings,
    credentials,
  );
  const corrected = await services.revisePetBase(
    {
      character,
      skin: base,
      referenceDigest: referencePack(character).digest,
      styleReference: guide,
      feedback: '清晰的像素轮廓，保留衣服',
    },
    settings,
    credentials,
  );
  assert.deepEqual(
    calls[1].images,
    [base.images.neutral, ...character.visualReferences.map((ref) => ref.image), guide.image].map(bytes),
  );
  assert.match(calls[1].prompt, /Images 2 through 5 are authoritative original identity/);
  assert.match(calls[1].prompt, /Image 6 is a STYLE-ONLY reference/);
  assert.deepEqual(corrected.generation.styleReference, styleReferencePack(guide).summary);
  assert.equal(corrected.generation.parentSkinId, base.id);
  await services.generatePetSheet(
    {
      character,
      skin: corrected,
      motion: 'wave',
      referenceDigest: referencePack(character).digest,
    },
    settings,
    credentials,
  );
  assert.deepEqual(
    calls[2].images,
    [corrected.images.neutral, ...character.visualReferences.map((ref) => ref.image)].map(bytes),
  );
  assert.doesNotMatch(calls[2].prompt, /STYLE-ONLY/);
  assert.equal(calls.length, 3);
});

test('no style input preserves the legacy original-style request and provenance', async () => {
  const { services, calls } = transport();
  const result = await services.generateSkin({ character, style: 'original' }, settings, credentials);
  assert.equal(result.generation.styleReference, undefined);
  assert.deepEqual(
    calls[0].images,
    character.visualReferences.map((ref) => bytes(ref.image)),
  );
  assert.doesNotMatch(calls[0].prompt, /STYLE-ONLY/);
});

test('invalid style data, unavailable decoder and incompatible routes fail before any paid request', async () => {
  const { services, calls } = transport();
  for (const changes of [
    { styleReference: null },
    { styleReference: { ...guide, image: 'https://example.com/image.png' } },
    { styleReference: { ...guide, id: '../outside' } },
    { style: 'original', styleReference: guide },
    { mode: 'program', styleReference: guide },
    { sourceSkin: {}, styleReference: guide },
    { character: { ...character, visualReferences: [] }, styleReference: guide },
  ])
    await assert.rejects(
      services.generateSkin({ character, style: 'chibi', ...changes }, settings, credentials),
    );
  assert.equal(calls.length, 0);
  const undecodable = transport({
    inspectImage: () => {
      throw new Error('Cannot decode style image');
    },
  });
  await assert.rejects(
    undecodable.services.generateSkin(
      { character, style: 'chibi', styleReference: guide },
      settings,
      credentials,
    ),
    /Cannot decode/,
  );
  assert.equal(undecodable.calls.length, 0);
  const excessive = transport({ inspectImage: () => ({ width: 8193, height: 500 }) });
  await assert.rejects(
    excessive.services.generateSkin(
      { character, style: 'chibi', styleReference: guide },
      settings,
      credentials,
    ),
    /8192/,
  );
  assert.equal(excessive.calls.length, 0);
});

test('style summaries validate identifier, digest and name without retaining inline images', () => {
  const { summary } = styleReferencePack(guide);
  assert.deepEqual(validateStyleReference({ ...summary, image: guide.image }), summary);
  for (const change of [{ id: '../outside' }, { name: '' }, { digest: 'invalid' }, { name: 'x'.repeat(301) }])
    assert.throws(() => validateStyleReference({ ...summary, ...change }));
  assert.equal(styleReferencePack(undefined), null);
});
