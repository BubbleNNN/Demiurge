'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createStore, validateState } = require('../electron/store.cjs');
const stamp = '2026-10-22T12:00:00Z';
const settings = {
  llmBaseUrl: '',
  llmModel: '',
  imageBaseUrl: '',
  imageModel: '',
  demoMode: false,
  proactiveEnabled: false,
  chatMode: 'local',
};
const initial = () => ({
  settings,
  characters: [
    {
      id: 'companion',
      name: '陪伴',
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
    },
  ],
  skins: [],
  activeCharacterId: 'companion',
  activeSkinId: '',
  messages: { companion: [] },
  memories: [],
});
async function directory(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mori-recovery-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
const encryption = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from(text).map((byte) => byte ^ 0x9a),
  decryptString: (bytes) =>
    Buffer.from(bytes)
      .map((byte) => byte ^ 0x9a)
      .toString(),
};

test('TTS credential status survives restart and explicit clearing', async (t) => {
  const dir = await directory(t),
    store = createStore({ dir, safeStorage: encryption });
  await store.saveState(initial());
  assert.equal((await store.saveSettings(settings, { ttsKey: 'fixture-speech-key' })).ttsKey, true);
  const reopened = createStore({ dir, safeStorage: encryption });
  assert.equal((await reopened.getKeyStatus()).ttsKey, true);
  assert.equal((await reopened.saveSettings(settings, { ttsKey: '' })).ttsKey, false);
  assert.equal((await createStore({ dir, safeStorage: encryption }).getKeyStatus()).ttsKey, false);
});

test('reload reads a repaired state without restarting and remains serialized with writes', async (t) => {
  const dir = await directory(t),
    file = path.join(dir, 'state.json');
  await fs.writeFile(file, '{ damaged');
  const store = createStore({ dir });
  await assert.rejects(store.loadState(), /preserved/);
  await fs.writeFile(file, JSON.stringify(initial()));
  assert.deepEqual(await store.retryLoadState(), initial());
  const changed = initial();
  changed.characters[0].name = '更新后的陪伴';
  const [, reloaded] = await Promise.all([store.saveState(changed), store.retryLoadState()]);
  assert.equal(reloaded.characters[0].name, '更新后的陪伴');
});

test('previous valid state restores explicitly while retaining the damaged original and backup', async (t) => {
  const dir = await directory(t),
    store = createStore({ dir }),
    original = initial();
  await store.saveState(original);
  assert.deepEqual(await store.getRecoveryStatus(), { hasPreviousState: false });
  const second = initial();
  second.characters[0].name = '第二版';
  await store.saveState(second);
  const backup = path.join(dir, 'state.previous.json');
  assert.deepEqual(JSON.parse(await fs.readFile(backup, 'utf8')), original);
  assert.equal((await fs.stat(backup)).mode & 0o777, 0o600);
  await fs.writeFile(path.join(dir, 'state.json'), '{ damaged original');
  await assert.rejects(store.retryLoadState(), /preserved/);
  assert.deepEqual(await store.getRecoveryStatus(), { hasPreviousState: true });
  const restored = { ...original, revision: 1 };
  assert.deepEqual(await store.restorePreviousState(), restored);
  const preserved = (await fs.readdir(dir)).find((file) => file.startsWith('state.rejected-'));
  assert.equal(await fs.readFile(path.join(dir, preserved), 'utf8'), '{ damaged original');
  assert.deepEqual(await createStore({ dir }).loadState(), restored);
  assert.deepEqual(JSON.parse(await fs.readFile(backup, 'utf8')), original);
});

test('restoring older content advances past the revision already seen by other windows', async (t) => {
  const dir = await directory(t),
    store = createStore({ dir });
  const first = { ...initial(), revision: 41 };
  await store.saveState(first);
  const newer = { ...initial(), revision: 42 };
  newer.characters[0].name = 'Later content shown in the pet window';
  await store.saveState(newer);
  await fs.writeFile(path.join(dir, 'state.json'), '{ damaged');
  await assert.rejects(store.retryLoadState(), /preserved/);
  const restored = await store.restorePreviousState();
  assert.equal(restored.revision, 43);
  assert.deepEqual(restored.characters, first.characters);
  assert.equal((await createStore({ dir }).loadState()).revision, 43);
  assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'state.previous.json'), 'utf8')).revision, 41);
});

test('invalid backup cannot replace a damaged state or silently initialize an empty workspace', async (t) => {
  const dir = await directory(t),
    store = createStore({ dir });
  await fs.writeFile(path.join(dir, 'state.json'), '{ original');
  await fs.writeFile(path.join(dir, 'state.previous.json'), '{}');
  assert.deepEqual(await store.getRecoveryStatus(), { hasPreviousState: false });
  await assert.rejects(store.restorePreviousState());
  await assert.rejects(store.saveState(initial()), /preserved/);
  assert.equal(await fs.readFile(path.join(dir, 'state.json'), 'utf8'), '{ original');
});

test('credential errors preserve offline state and require explicit reset before new keys', async (t) => {
  const dir = await directory(t),
    store = createStore({ dir, safeStorage: encryption });
  await store.saveState(initial());
  const damaged = JSON.stringify({ version: 1, data: Buffer.from('broken bytes').toString('base64') });
  await fs.writeFile(path.join(dir, 'credentials.enc.json'), damaged);
  const status = await store.getKeyStatus();
  assert.match(status.credentialError, /preserved/);
  assert.equal(status.ttsKey, false);
  assert.equal((await store.loadState()).settings.chatMode, 'local');
  await assert.rejects(store.getCredentials(), /preserved/);
  await assert.rejects(store.saveSettings(settings, { llmKey: 'replacement' }), /preserved/);
  const offlineSettings = { ...settings, motionEnabled: false, chatMode: 'local' };
  assert.match((await store.saveSettings(offlineSettings, {})).credentialError, /preserved/);
  assert.equal((await store.loadState()).settings.motionEnabled, false);
  assert.equal(await fs.readFile(path.join(dir, 'credentials.enc.json'), 'utf8'), damaged);
  const reset = await store.resetCredentials();
  assert.equal(reset.credentialError, undefined);
  const preserved = (await fs.readdir(dir)).find((file) => file.startsWith('credentials.rejected-'));
  assert.equal(await fs.readFile(path.join(dir, preserved), 'utf8'), damaged);
  assert.equal((await store.saveSettings(settings, { llmKey: 'replacement' })).llmKey, true);
  assert.equal((await createStore({ dir, safeStorage: encryption }).getCredentials()).llmKey, 'replacement');
});

test('long conversation persistence retains older messages and rejects overflow without replacing disk', async (t) => {
  const dir = await directory(t),
    store = createStore({ dir }),
    value = initial();
  value.messages.companion = Array.from({ length: 1002 }, (_, index) => ({
    id: `message-${index}`,
    role: index % 2 ? 'assistant' : 'user',
    content: `内容 ${index}`,
    createdAt: stamp,
  }));
  await store.saveState(value);
  const loaded = await createStore({ dir }).loadState();
  assert.equal(loaded.messages.companion.length, 1002);
  assert.equal(loaded.messages.companion[0].id, 'message-0');
  const oversized = { ...value, messages: { companion: Array(100001).fill(value.messages.companion[0]) } };
  assert.throws(() => validateState(oversized), /100000/);
  await assert.rejects(store.saveState(oversized), /100000/);
  assert.equal((await createStore({ dir }).loadState()).messages.companion.length, 1002);
});
