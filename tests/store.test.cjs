'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createStore, validateState, validateBundle, createBundle } = require('../electron/store.cjs');

const timestamp = '2026-09-26T08:00:00.000Z';
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6SAAAAABJRU5ErkJggg==';
function character() {
  return {
    id: 'aoi',
    name: '小葵',
    work: '原创',
    summary: 'A friendly garden spirit.',
    personality: ['kind'],
    speakingStyle: 'Short sentences.',
    appearance: 'Green hair.',
    quotes: [{ text: 'Hello!', sourceUrl: 'https://example.org/character' }],
    sources: [{ title: 'Character', url: 'https://example.org/character', snippet: 'A garden spirit.' }],
    unknowns: ['Age'],
    behavior: { energy: 45, affection: 75, curiosity: 80 },
    createdAt: timestamp,
  };
}
function skin() {
  return {
    id: 'aoi-chibi',
    characterId: 'aoi',
    name: '手绘',
    style: 'chibi',
    images: { neutral: png },
    createdAt: timestamp,
    generated: true,
  };
}
function settings() {
  return {
    llmBaseUrl: 'https://api.example.org/v1',
    llmModel: 'chat-model',
    imageBaseUrl: 'http://localhost:1234/v1',
    imageModel: 'image-model',
    demoMode: false,
    proactiveEnabled: false,
  };
}
function state() {
  return {
    settings: settings(),
    characters: [character()],
    skins: [skin()],
    activeCharacterId: 'aoi',
    activeSkinId: 'aoi-chibi',
    messages: { aoi: [{ id: 'msg-1', role: 'user', content: 'Hello', createdAt: timestamp }] },
    memories: [{ id: 'mem-1', characterId: 'aoi', text: 'Likes plants', createdAt: timestamp }],
  };
}

test('reference originals and review provenance survive persistence and character bundle round trip', async (t) => {
  const input = state();
  const original = {
    id: 'ref-one',
    name: '原作参考.png',
    image: png,
    sourceUrl: 'https://example.org/original',
    createdAt: timestamp,
  };
  input.characters[0].visualReferences = [original];
  const { referencePack, imageDigest, reviewSkin, approvedBase } = require('../electron/references.cjs');
  const pack = referencePack(input.characters[0]);
  input.skins[0].generation = {
    referenceIds: [original.id],
    referenceDigest: pack.digest,
    model: 'image-model',
    prompt: 'Edit original images.',
  };
  input.skins[0].review = { status: 'pending', referenceDigest: pack.digest, imageDigest: imageDigest(png) };
  input.skins[0] = reviewSkin(input.characters[0], input.skins[0], 'approved');
  const store = createStore({ dir: await directory(t) });
  await store.saveState(input);
  const restored = await store.loadState();
  assert.deepEqual(restored, input);
  const bundle = validateBundle(createBundle(restored.characters[0], restored.skins));
  assert.deepEqual(bundle.character.visualReferences, [original]);
  assert.deepEqual(bundle.skins, input.skins);
  assert.doesNotThrow(() => approvedBase(bundle.character, bundle.skins[0]));
  const changed = structuredClone(bundle.character);
  changed.visualReferences[0].image =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1WQAAAAASUVORK5CYII=';
  assert.throws(() => approvedBase(changed, bundle.skins[0]), /参考图已变化/);
});
test('roleplay and memory controls persist without treating private setting as source evidence', () => {
  const input = state();
  input.characters[0].roleplay = {
    timeline: '初见',
    relationship: '朋友',
    voiceRules: ['短句'],
    avoid: ['不改身份'],
    customFacts: ['原创书屋'],
    spoilerPolicy: 'avoid',
  };
  input.memories[0].pinned = true;
  input.memories[0].excluded = true;
  const value = validateState(input);
  assert.deepEqual(value.characters[0].roleplay, input.characters[0].roleplay);
  assert.equal(value.memories[0].pinned, true);
  assert.equal(value.memories[0].excluded, true);
  const pack = validateBundle(createBundle(value.characters[0], value.skins));
  assert.deepEqual(pack.character.roleplay, value.characters[0].roleplay);
  assert.equal('memories' in pack, false);
});
test('topic boundaries and reply correlation persist and reject incompatible message roles', () => {
  const input = state();
  input.messages.aoi[0].contextStart = true;
  input.messages.aoi.push({
    id: 'msg-2',
    role: 'assistant',
    content: '你好',
    createdAt: timestamp,
    replyTo: 'msg-1',
  });
  assert.deepEqual(validateState(input).messages, input.messages);
  input.messages.aoi[1].contextStart = true;
  assert.throws(() => validateState(input), /only a user/);
  delete input.messages.aoi[1].contextStart;
  input.messages.aoi[0].replyTo = 'msg-2';
  assert.throws(() => validateState(input), /only an assistant/);
});
test('explicit complete-URL mode persists and old settings keep their default routing', () => {
  const input = state();
  assert.equal(validateState(input).settings.llmEndpointMode, undefined);
  input.settings.llmEndpointMode = 'exact';
  assert.equal(validateState(input).settings.llmEndpointMode, 'exact');
  input.settings.llmEndpointMode = 'other';
  assert.throws(() => validateState(input), /llmEndpointMode/);
});

test('chat protocol and auth selections survive reopening without changing saved keys', async (t) => {
  const input = state();
  assert.equal(validateState(input).settings.llmProtocol, undefined);
  input.settings.llmProtocol = 'anthropic';
  input.settings.llmAuthMode = 'bearer';
  const dir = await directory(t);
  const safeStorage = encryption();
  const store = createStore({ dir, safeStorage });
  await store.saveState(input);
  await store.saveSettings(input.settings, { llmKey: 'fixture-private-key' });
  const reopened = createStore({ dir, safeStorage });
  const saved = await reopened.loadState();
  assert.equal(saved.settings.llmProtocol, 'anthropic');
  assert.equal(saved.settings.llmAuthMode, 'bearer');
  assert.equal((await reopened.getCredentials()).llmKey, 'fixture-private-key');
  input.settings.llmProtocol = 'unknown';
  assert.throws(() => validateState(input), /llmProtocol/);
  input.settings.llmProtocol = 'anthropic';
  input.settings.llmAuthMode = 'unknown';
  assert.throws(() => validateState(input), /llmAuthMode/);
});

test('references share workspace image budget and reject duplicate IDs, remote URLs and unsafe content', () => {
  const original = { id: 'ref-one', name: '原图', image: png, createdAt: timestamp };
  for (const references of [
    [original, original],
    [{ ...original, image: 'https://example.org/tracker.png' }],
    [{ ...original, sourceUrl: 'javascript:alert(1)' }],
  ]) {
    const input = state();
    input.characters[0].visualReferences = references;
    assert.throws(() => validateState(input));
  }
  const { validateReferences } = require('../electron/store.cjs');
  assert.throws(
    () => validateReferences([original], 'references', { bytes: 96 * 1024 * 1024 }),
    /total image size/,
  );
});
async function directory(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mori-store-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
test('research provenance and optional search settings survive reopen and export without breaking legacy characters', async (t) => {
  const dir = await directory(t);
  const input = state();
  input.characters[0].knowledge = { kind: 'sourced', method: 'links', collectedAt: timestamp };
  input.settings.searchProvider = 'searxng';
  input.settings.searxngBaseUrl = 'http://localhost:8080';
  input.settings.wikiApiUrl = 'https://wiki.example/w/api.php';
  const store = createStore({ dir });
  await store.saveState(input);
  const restored = await createStore({ dir }).loadState();
  assert.deepEqual(restored.characters[0].knowledge, input.characters[0].knowledge);
  assert.equal(restored.settings.searchProvider, 'searxng');
  assert.equal(restored.settings.searxngBaseUrl, 'http://localhost:8080/');
  assert.equal(restored.settings.wikiApiUrl, input.settings.wikiApiUrl);
  assert.deepEqual(
    validateBundle(createBundle(restored.characters[0], [])).character.knowledge,
    input.characters[0].knowledge,
  );
  assert.equal(validateState(state()).characters[0].knowledge, undefined);
  const cached = structuredClone(restored.characters[0]);
  cached.knowledge.method = 'saved';
  assert.equal(validateBundle(createBundle(cached, [])).character.knowledge.method, 'saved');
  for (const malformed of [
    { kind: 'verified', method: 'model', collectedAt: timestamp },
    { kind: 'draft', method: 'invented', collectedAt: timestamp },
    { kind: 'draft', method: 'links', collectedAt: timestamp },
    { kind: 'sourced', method: 'model', collectedAt: timestamp },
    { kind: 'draft', method: 'model', collectedAt: 'invalid-date' },
  ]) {
    const bad = state();
    bad.characters[0].knowledge = malformed;
    assert.throws(() => validateState(bad));
  }
  const bad = state();
  bad.settings.searchProvider = 'invented';
  assert.throws(() => validateState(bad));
});
function encryption() {
  const key = crypto.randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString(text) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), data]);
    },
    decryptString(data) {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
      decipher.setAuthTag(data.subarray(12, 28));
      return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
}

test('first run is empty; state writes round-trip, strip extra properties, and return detached objects', async (t) => {
  const dir = await directory(t);
  const store = createStore({ dir });
  assert.equal(await store.loadState(), null);
  const input = state();
  input.apiKey = 'do-not-persist';
  input.settings.llmKey = 'do-not-persist';
  input.characters[0].systemPrompt = 'do-not-persist';
  await store.saveState(input);
  const saved = await store.loadState();
  assert.deepEqual(saved, state());
  saved.characters[0].name = 'changed';
  assert.equal((await store.loadState()).characters[0].name, '小葵');
  const raw = await fs.readFile(path.join(dir, 'state.json'), 'utf8');
  assert.ok(!raw.includes('do-not-persist'));
  assert.deepEqual(await createStore({ dir }).loadState(), state());
  assert.equal((await fs.stat(path.join(dir, 'state.json'))).mode & 0o777, 0o600);
  assert.deepEqual(await fs.readdir(dir), ['state.json']);
});

test('API keys are encrypted at rest, survive reopening, preserve omitted keys and clear empty values', async (t) => {
  const dir = await directory(t);
  const safeStorage = encryption();
  const store = createStore({ dir, safeStorage });
  await store.saveState(state());
  const status = await store.saveSettings(
    { ...settings(), llmModel: 'new-model' },
    { llmKey: 'sk-secret-chat', searchKey: 'tvly-secret-search' },
  );
  assert.deepEqual(status, { llmKey: true, searchKey: true, imageKey: false, ttsKey: false, secure: true });
  for (const file of await fs.readdir(dir)) {
    const raw = await fs.readFile(path.join(dir, file), 'utf8');
    assert.ok(!raw.includes('sk-secret-chat'));
    assert.ok(!raw.includes('tvly-secret-search'));
  }
  const reopened = createStore({ dir, safeStorage });
  assert.deepEqual(await reopened.getCredentials(), {
    llmKey: 'sk-secret-chat',
    searchKey: 'tvly-secret-search',
  });
  assert.equal((await reopened.loadState()).settings.llmModel, 'new-model');
  await reopened.saveSettings(settings(), { llmKey: '', imageKey: 'image-secret' });
  assert.deepEqual(await createStore({ dir, safeStorage }).getCredentials(), {
    searchKey: 'tvly-secret-search',
    imageKey: 'image-secret',
  });
  const modelSettings = {
    ...settings(),
    modelBaseUrl: 'https://api.meshy.ai',
    modelVersion: 'latest',
  };
  const modelStatus = await reopened.saveSettings(modelSettings, { modelKey: 'dedicated-model-secret' });
  assert.equal(modelStatus.modelKey, true);
  const modelStore = createStore({ dir, safeStorage });
  assert.deepEqual(await modelStore.getCredentials(), {
    searchKey: 'tvly-secret-search',
    imageKey: 'image-secret',
    modelKey: 'dedicated-model-secret',
  });
  assert.equal(
    (await modelStore.loadState()).settings.modelBaseUrl,
    new URL(modelSettings.modelBaseUrl).href,
  );
  assert.equal((await modelStore.loadState()).settings.modelVersion, modelSettings.modelVersion);
  for (const file of await fs.readdir(dir))
    assert.doesNotMatch(await fs.readFile(path.join(dir, file), 'utf8'), /dedicated-model-secret/);
});

test('unavailable encryption keeps credentials in session memory and never creates a secret file', async (t) => {
  const dir = await directory(t);
  const safeStorage = {
    isEncryptionAvailable: () => false,
    encryptString: () => assert.fail('must not encrypt when unavailable'),
  };
  const store = createStore({ dir, safeStorage });
  const status = await store.saveSettings(settings(), { llmKey: 'session-only-secret' });
  assert.deepEqual(status, { llmKey: true, searchKey: false, imageKey: false, ttsKey: false, secure: false });
  assert.deepEqual(await store.getCredentials(), { llmKey: 'session-only-secret' });
  assert.deepEqual(await fs.readdir(dir), []);
  assert.deepEqual(await createStore({ dir, safeStorage }).getCredentials(), {});
});

test('Linux basic_text backend is treated as insecure even when encryption reports available', async (t) => {
  const dir = await directory(t);
  const store = createStore({
    dir,
    safeStorage: {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => 'basic_text',
      encryptString: () => assert.fail('insecure backend must not write'),
    },
  });
  assert.equal((await store.saveSettings(settings(), { searchKey: 'session-key' })).secure, false);
  assert.deepEqual(await fs.readdir(dir), []);
});

test('malformed and null state are preserved and cannot be silently overwritten, even without prior load', async (t) => {
  for (const original of ['{ broken json', 'null', JSON.stringify({ characters: [] })]) {
    const dir = await directory(t);
    const file = path.join(dir, 'state.json');
    await fs.writeFile(file, original);
    const store = createStore({ dir });
    await assert.rejects(store.saveState(state()), /preserved/);
    await assert.rejects(store.loadState(), /preserved/);
    await assert.rejects(store.saveSettings(settings(), { llmKey: 'secret' }), /preserved/);
    assert.equal(await fs.readFile(file, 'utf8'), original);
    assert.deepEqual(await fs.readdir(dir), ['state.json']);
  }
});

test('unreadable encrypted credentials are preserved and never replaced by new keys', async (t) => {
  const dir = await directory(t);
  const original = JSON.stringify({
    version: 1,
    data: Buffer.from('broken encrypted bytes').toString('base64'),
  });
  await fs.writeFile(path.join(dir, 'credentials.enc.json'), original);
  const store = createStore({ dir, safeStorage: encryption() });
  await assert.rejects(store.getCredentials(), /preserved/);
  await assert.rejects(store.saveSettings(settings(), { llmKey: 'replacement' }), /preserved/);
  assert.equal(await fs.readFile(path.join(dir, 'credentials.enc.json'), 'utf8'), original);
});

test('bundles round-trip only character and skins, stripping unknown fields and secrets', () => {
  const c = { ...character(), credentials: { llmKey: 'secret' } };
  const s = { ...skin(), apiKey: 'secret', images: { ...skin().images, injected: '<script>bad</script>' } };
  const bundle = createBundle(c, [s]);
  assert.deepEqual(bundle, { version: 1, character: character(), skins: [skin()] });
  assert.deepEqual(validateBundle({ ...bundle, messages: ['private'], settings: { apiKey: 'secret' } }), {
    character: character(),
    skins: [skin()],
  });
  assert.deepEqual(
    validateBundle({ version: 1, character: c, skins: [{ ...skin(), generated: false, images: {} }] })
      .skins[0].images,
    {},
  );
});

test('bundles reject executable/remote images, credential URLs, malformed data and unsafe identifiers', () => {
  for (const image of [
    'javascript:alert(1)',
    'file:///etc/passwd',
    'https://tracker.example/image.png',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    'data:image/png;base64,' + Buffer.from('<script>alert(1)</script>').toString('base64'),
    png.slice(0, -1),
  ]) {
    assert.throws(() => createBundle(character(), [{ ...skin(), images: { neutral: image } }]), /images/);
  }
  for (const url of [
    'javascript:alert(1)',
    'file:///etc/passwd',
    'data:text/html,hi',
    'https://user:secret@example.org',
    ' https://example.org',
  ]) {
    assert.throws(
      () => createBundle({ ...character(), sources: [{ title: 'bad', url, snippet: '' }] }, []),
      /url/,
    );
  }
  assert.throws(() => createBundle({ ...character(), id: 'constructor' }, []), /identifier/);
  assert.throws(() => createBundle({ ...character(), id: '../../outside' }, []), /identifier/);
  assert.throws(() => validateBundle({ version: 2, character: character(), skins: [] }), /version/);
});

test('bundle/state validation rejects cross-character assets, invalid actions, oversized text and duplicate IDs', () => {
  assert.throws(
    () => createBundle(character(), [{ ...skin(), characterId: 'someone-else' }]),
    /another character/,
  );
  assert.throws(() => createBundle(character(), [skin(), skin()]), /duplicate/);
  assert.throws(() => createBundle({ ...character(), name: 'x'.repeat(201) }, []), /name/);
  assert.throws(
    () => createBundle({ ...character(), behavior: { ...character().behavior, energy: NaN } }, []),
    /energy/,
  );
  const badAction = state();
  badAction.messages.aoi[0].action = 'execute_shell';
  assert.throws(() => validateState(badAction), /action/);
  const orphan = state();
  orphan.memories[0].characterId = 'missing';
  assert.throws(() => validateState(orphan), /unknown character/);
});

test('serialized writes retain the final state and a rejected update does not poison the queue', async (t) => {
  const dir = await directory(t);
  const store = createStore({ dir });
  const first = state();
  const last = state();
  last.characters[0].name = 'Final';
  await Promise.all([store.saveState(first), store.saveState(last)]);
  await assert.rejects(store.saveState({}), /characters/);
  assert.equal((await store.loadState()).characters[0].name, 'Final');
  assert.equal((await createStore({ dir }).loadState()).characters[0].name, 'Final');
});

test('playback preferences survive persistence and legacy settings remain valid', async (t) => {
  const dir = await directory(t),
    store = createStore({ dir });
  const input = state();
  input.settings.motionEnabled = false;
  input.settings.trackingEnabled = true;
  await store.saveState(input);
  const loaded = await createStore({ dir }).loadState();
  assert.equal(loaded.settings.motionEnabled, false);
  assert.equal(loaded.settings.trackingEnabled, true);
  assert.equal(validateState(state()).settings.motionEnabled, undefined);
  assert.throws(
    () => validateState({ ...input, settings: { ...input.settings, motionEnabled: 'false' } }),
    /motionEnabled/,
  );
});

test('serialized snapshot merges retain simultaneous windows and increment the server revision', async (t) => {
  const dir = await directory(t),
    store = createStore({ dir });
  const first = await store.saveMergedState(state(), null);
  const one = structuredClone(first),
    two = structuredClone(first);
  one.characters[0].summary = 'new summary';
  two.memories.push({ id: 'second-memory', characterId: 'aoi', text: 'I like stars', createdAt: timestamp });
  await Promise.all([store.saveMergedState(one, first), store.saveMergedState(two, first)]);
  const loaded = await store.loadState();
  assert.equal(loaded.characters[0].summary, 'new summary');
  assert.equal(loaded.memories.length, 2);
  assert.equal(loaded.revision, 3);
  const conflict = structuredClone(first);
  conflict.characters[0].summary = 'conflicting summary';
  await assert.rejects(store.saveMergedState(conflict, first), /另一窗口/);
  assert.equal((await store.loadState()).revision, 3);
  const oldSettings = structuredClone(loaded.settings);
  await store.saveMergedState({ ...loaded, settings: { ...loaded.settings, motionEnabled: false } }, loaded);
  await store.saveSettings({ ...oldSettings, llmModel: 'updated-model' }, {}, oldSettings);
  const final = await store.loadState();
  assert.equal(final.settings.motionEnabled, false);
  assert.equal(final.settings.llmModel, 'updated-model');
  assert.equal(final.revision, 5);
});
