'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { inflateSync } = require('node:zlib');
const { validateProgram, compileProgram, drawFrame } = require('../electron/pixel-program.cjs');
const { createServices } = require('../electron/services.cjs');
const { validateSkin, createBundle, validateBundle } = require('../electron/store.cjs');
const { reviewSkin, approvedBase } = require('../electron/references.cjs');
const { availableActions } = require('../electron/persona.cjs');
const drawing = require('./fixtures/pixel-program.cjs');
const timestamp = '2026-10-01T00:00:00.000Z';
const fixture = compileProgram(drawing(), '8bit');
const character = {
  id: 'program-test',
  name: '像素测试',
  work: '测试作品',
  summary: '',
  appearance: '',
  speakingStyle: '',
  personality: [],
  quotes: [],
  sources: [],
  unknowns: [],
  behavior: { energy: 50, affection: 50, curiosity: 50 },
  createdAt: timestamp,
  visualReferences: [{ id: 'raw-ref', name: 'actual.png', image: fixture.image, createdAt: timestamp }],
};
const settings = {
  llmBaseUrl: 'https://chat.example/custom-entry',
  llmEndpointMode: 'exact',
  llmModel: 'vision-test',
  llmAuthMode: 'bearer',
  imageModel: '',
};
const credentials = { llmKey: 'program-test-secret' };
const response = (value) =>
  new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
test('drawing commands reject executable fields, unbounded geometry, invalid colours and missing joints/faces', () => {
  assert.throws(() => validateProgram({ ...drawing(), script: 'fetch(secret)' }, '8bit'), /未支持/);
  assert.throws(() => validateProgram({ ...drawing(), width: 9000 }, '8bit'), /尺寸/);
  const unsafe = drawing();
  unsafe.parts[0].shapes[0].points[0][0] = Infinity;
  assert.throws(() => validateProgram(unsafe, '8bit'), /范围/);
  assert.throws(() => validateProgram({ ...drawing(), palette: ['javascript:bad'] }, '8bit'), /调色板/);
  assert.throws(() => validateProgram({ ...drawing(), parts: drawing().parts.slice(0, 3) }, '8bit'), /分组/);
  const missing = drawing();
  delete missing.faces.blink;
  assert.throws(() => validateProgram(missing, '8bit'), /绘图分组/);
});
test('program compiles actual transparent PNG pixels into a bounded complete-pose atlas with six actions and eight face states', () => {
  const result = compileProgram(drawing(), '8bit'),
    bytes = Buffer.from(result.image.split(',')[1], 'base64');
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20),
    chunks = [];
  for (let i = 8; i < bytes.length; ) {
    const n = bytes.readUInt32BE(i);
    if (bytes.toString('ascii', i + 4, i + 8) === 'IDAT') chunks.push(bytes.subarray(i + 8, i + 8 + n));
    i += n + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  assert.equal(raw.length, (width * 4 + 1) * height);
  assert.equal(width, 48 * 8);
  assert.ok(height <= 64 * 4);
  assert.equal(raw[4], 0, 'Corner stays transparent');
  const skin = validateSkin({
    id: 'sprite',
    characterId: character.id,
    name: '测试动画',
    style: '8bit',
    kind: 'image',
    images: { neutral: result.image },
    sprite: result.sprite,
    generated: true,
    createdAt: timestamp,
  });
  assert.deepEqual(availableActions(skin), ['idle', 'bounce', 'nod', 'shake', 'sleep', 'wave']);
  for (const name of ['neutral', 'happy', 'thinking', 'sad', 'sleepy', 'surprised', 'blink', 'talk'])
    assert.ok(skin.sprite.clips[name]);
  for (const name of ['wave', 'nod', 'shake', 'bounce'])
    assert.equal(skin.sprite.clips[name].frames.at(-1), 0, 'Gesture returns to the same resting frame');
  const finer = compileProgram(drawing('pixel'), 'pixel');
  assert.equal(finer.sprite.width, 64);
  assert.equal(finer.sprite.height, 96);
});
test('arm and head gestures change only authored groups while preserving the resting body and feet', () => {
  const p = validateProgram(drawing(), '8bit'),
    idle = drawFrame(p),
    wave = drawFrame(p, { rightArm: -70 }),
    nod = drawFrame(p, { head: 7 });
  assert.notDeepEqual(wave, idle);
  assert.notDeepEqual(nod, idle);
  const bottom = (bytes) => bytes.subarray((p.height - 12) * p.width * 4);
  assert.deepEqual(bottom(wave), bottom(idle));
  assert.deepEqual(bottom(nod), bottom(idle));
});
for (const protocol of ['anthropic', 'openai'])
  test(`${protocol} program route uses only existing chat credentials and exact endpoint with original image bytes`, async () => {
    const calls = [];
    const service = createServices(async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ url, init, body });
      return response(
        protocol === 'anthropic'
          ? { content: [{ type: 'text', text: JSON.stringify(drawing()) }] }
          : { choices: [{ message: { content: JSON.stringify(drawing()) } }] },
      );
    });
    const configured = { ...settings, llmProtocol: protocol };
    const prepared = service.prepareSkinGeneration({ character, mode: 'program' }, configured, credentials);
    assert.equal(calls.length, 0);
    const result = await service.generateSkin(
      { character, mode: 'program', style: '8bit', referenceDigest: prepared.referenceDigest },
      configured,
      credentials,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, settings.llmBaseUrl);
    assert.equal(calls[0].init.headers.Authorization, 'Bearer ' + credentials.llmKey);
    const content = calls[0].body.messages.find((m) => m.role === 'user').content;
    if (protocol === 'anthropic') assert.equal(content[0].source.data, fixture.image.split(',')[1]);
    else assert.equal(content[0].image_url.url, fixture.image);
    assert.equal(result.generation.mode, 'program');
    assert.equal(result.review.status, 'pending');
    const skin = validateSkin(result),
      approved = reviewSkin(character, skin, 'approved', {
        imageDigest: skin.review.imageDigest,
        animationDigest: skin.review.animationDigest,
        frames: skin.sprite.frames.map((_, index) => index),
        anatomy: true,
        identity: true,
        continuity: true,
      });
    assert.equal(approved.review.status, 'approved');
    assert.throws(() => approvedBase(character, approved), /图集/);
    const bundle = validateBundle(createBundle(character, [skin]));
    assert.equal(bundle.skins[0].generation.mode, 'program');
    assert.deepEqual(bundle.skins[0].sprite, skin.sprite);
    assert.deepEqual(bundle.skins[0].drawing, skin.drawing);
  });
test('invalid style, changed references and missing chat key stop before any program request', async () => {
  let calls = 0;
  const service = createServices(async () => {
    calls++;
    throw new Error('Unexpected provider call');
  });
  assert.throws(() => service.prepareSkinGeneration({ character, mode: 'program' }, settings, {}), /Key/);
  await assert.rejects(
    service.generateSkin({ character, mode: 'program', style: 'original' }, settings, credentials),
    /支持/,
  );
  await assert.rejects(
    service.generateSkin(
      { character, mode: 'program', style: '8bit', referenceDigest: 'bad' },
      settings,
      credentials,
    ),
    /变化/,
  );
  assert.equal(calls, 0);
});
test('invalid model drawing is rejected after one request without hidden retries or a fabricated character', async () => {
  let calls = 0;
  const service = createServices(async () => {
    calls++;
    return response({ choices: [{ message: { content: JSON.stringify({ ...drawing(), code: 'run()' }) } }] });
  });
  await assert.rejects(
    service.generateSkin({ character, mode: 'program', style: '8bit' }, settings, credentials),
    /未支持/,
  );
  assert.equal(calls, 1);
});
test('program revision preserves original references and prior source code while creating an independent pending candidate', async () => {
  const requests = [];
  const service = createServices(async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return response({ choices: [{ message: { content: JSON.stringify(drawing()) } }] });
  });
  const base = await service.generateSkin(
    { character, mode: 'program', style: '8bit' },
    settings,
    credentials,
  );
  const result = await service.generateSkin(
    {
      character,
      mode: 'program',
      style: '8bit',
      programSkin: base,
      feedback: 'Remove duplicate eyes; keep the shoulder connected.',
    },
    settings,
    credentials,
  );
  assert.equal(requests.length, 2);
  assert.notEqual(result.id, base.id);
  assert.equal(result.generation.parentSkinId, base.id);
  assert.equal(result.review.status, 'pending');
  assert.equal(requests[1].messages[1].content[0].image_url.url, character.visualReferences[0].image);
  assert.match(requests[1].messages[1].content.at(-1).text, /Remove duplicate eyes/);
  assert.ok(requests[1].messages[1].content.at(-1).text.includes(JSON.stringify(base.drawing)));
  await assert.rejects(
    service.generateSkin(
      {
        character,
        mode: 'program',
        style: '8bit',
        programSkin: { ...base, characterId: 'someone-else' },
        feedback: 'fix',
      },
      settings,
      credentials,
    ),
    /当前角色/,
  );
  assert.equal(requests.length, 2);
});
