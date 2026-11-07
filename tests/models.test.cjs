'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { zipSync } = require('fflate');
const {
  safePath,
  validateLive2D,
  validateVrm,
  readModel,
  installModel,
  resolveAsset,
} = require('../electron/models.cjs');
function fixture() {
  return {
    'hero.model3.json': Buffer.from(
      JSON.stringify({
        Version: 3,
        FileReferences: {
          Moc: 'hero.moc3',
          Textures: ['tex/a.png'],
          Expressions: [{ Name: 'happy', File: 'happy.exp3.json' }],
          Motions: {
            Idle: [{ File: 'idle.motion3.json' }],
            TapBody: [{ File: 'wave.motion3.json', Sound: 'voice.wav' }],
          },
        },
      }),
    ),
    'hero.moc3': Buffer.from('MOC3fake-for-import-validation'),
    'tex/a.png': Buffer.from('texture'),
    'happy.exp3.json': Buffer.from('{}'),
    'idle.motion3.json': Buffer.from('{}'),
    'wave.motion3.json': Buffer.from('{}'),
    'voice.wav': Buffer.from('wave'),
    'unused.js': Buffer.from('alert(1)'),
  };
}
function glb(json) {
  const content = Buffer.from(JSON.stringify(json));
  const padded = Buffer.alloc(Math.ceil(content.length / 4) * 4, 32);
  content.copy(padded);
  const b = Buffer.alloc(20 + padded.length);
  b.write('glTF');
  b.writeUInt32LE(2, 4);
  b.writeUInt32LE(b.length, 8);
  b.writeUInt32LE(padded.length, 12);
  b.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(b, 20);
  return b;
}
test('Live2D importer retains referenced resources and strips model audio and unrelated code', () => {
  const result = validateLive2D(fixture());
  assert.deepEqual(result.expressions, ['happy']);
  assert.deepEqual(result.motions, { Idle: 1, TapBody: 1 });
  assert.equal(result.files['unused.js'], undefined);
  assert.equal(result.files['voice.wav'], undefined);
  assert.equal(JSON.parse(result.files[result.entry]).FileReferences.Motions.TapBody[0].Sound, undefined);
});
test('Live2D rejects missing textures, ambiguous manifests and bad moc signatures', () => {
  let f = fixture();
  delete f['tex/a.png'];
  assert.throws(() => validateLive2D(f), /缺少资源/);
  f = fixture();
  f['second.model3.json'] = f['hero.model3.json'];
  assert.throws(() => validateLive2D(f), /仅包含一个/);
  f = fixture();
  f['hero.moc3'] = Buffer.from('bad!');
  assert.throws(() => validateLive2D(f), /签名/);
});
test('asset paths reject traversal, encoded traversal and remote references', () => {
  for (const value of ['../private', '/etc/passwd', 'https://x/y', 'a\\b', 'a/%2e%2e/b', 'a//b'])
    assert.throws(() => safePath(value));
  const root = '/tmp/models';
  assert.equal(
    resolveAsset(root, 'mori-asset://models/12345678-abcd-1234-1234-123456789012/avatar.vrm'),
    root + '/12345678-abcd-1234-1234-123456789012/avatar.vrm',
  );
  assert.throws(() => resolveAsset(root, 'file:///etc/passwd'));
  assert.throws(() => resolveAsset(root, 'mori-asset://models/id/%2e%2e%2fsecret'));
});
test('VRM import requires self-contained GLB with VRM metadata', () => {
  assert.equal(validateVrm(glb({ extensions: { VRMC_vrm: {} } })).entry, 'avatar.vrm');
  assert.equal(validateVrm(glb({ extensions: { VRM: {} } })).entry, 'avatar.vrm');
  assert.throws(() => validateVrm(glb({})), /元数据/);
  assert.throws(
    () => validateVrm(glb({ extensions: { VRM: {} }, images: [{ uri: 'https://tracker.test/tex.png' }] })),
    /自包含/,
  );
  const broken = glb({ extensions: { VRM: {} } });
  broken.writeUInt32LE(0, 8);
  assert.throws(() => validateVrm(broken), /有效/);
});
test('ZIP import enforces resource count and copies a valid nested model into its own directory', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mori-model-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const zip = path.join(dir, 'model.zip');
  const nested = Object.fromEntries(Object.entries(fixture()).map(([n, b]) => ['Haru/' + n, b]));
  await fs.writeFile(zip, zipSync(nested));
  const skin = await installModel(zip, 'live2d', path.join(dir, 'models'), 'char');
  assert.equal(skin.model.entry, 'Haru/hero.model3.json');
  assert.equal(skin.characterId, 'char');
  assert.ok((await fs.stat(path.join(dir, 'models', skin.model.id, skin.model.entry))).isFile());
  const tooMany = Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`${i}.json`, Buffer.from('{}')]));
  await fs.writeFile(zip, zipSync(tooMany));
  await assert.rejects(readModel(zip, 'live2d'), /数量限制/);
});
test('ZIP rejects paths escaping model root before files are installed', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mori-model-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const zip = path.join(dir, 'bad.zip');
  await fs.writeFile(zip, zipSync({ '../outside': Buffer.from('bad') }));
  await assert.rejects(readModel(zip, 'live2d'), /不安全/);
});
