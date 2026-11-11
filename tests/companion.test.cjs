'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { localReply } = require('../electron/companion.cjs');
const { portableBundle } = require('../electron/character-packs.cjs');
const {
  validateCharacter,
  validateState,
  validateBundle,
  validateSettings,
} = require('../electron/store.cjs');
const modules = new Map();
function load(file) {
  file = path.resolve(file);
  if (modules.has(file)) return modules.get(file);
  const exports = {};
  modules.set(file, exports);
  const requireLocal = (name) =>
    name.endsWith('.json')
      ? require(path.resolve(path.dirname(file), name))
      : load(path.resolve(path.dirname(file), name + '.ts'));
  new Function(
    'exports',
    'require',
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  )(exports, requireLocal);
  return exports;
}
const { initialState, cyrene } = load('src/initial.ts');
const { installStarterPack, matchingCharacterPacks, activateCharacterPack } = load('src/characterPacks.ts');
const { createLocalCharacter } = load('src/characterCreation.ts');
const { freshBehavior, admitBehavior, proactiveInterval, interactionPlan } = load('src/companion.ts');
const { appendCompletedReply } = load('src/conversation.ts');
test('new characters can be created with a name alone without inventing biography, appearance, quotes or character voice', () => {
  const character = createLocalCharacter({
    id: 'new',
    name: '  新人物  ',
    work: '',
    notes: '',
    urls: '',
    createdAt: cyrene.createdAt,
  });
  assert.equal(character.name, '新人物');
  assert.equal(character.summary + character.appearance + character.speakingStyle, '');
  assert.deepEqual(character.quotes, []);
  assert.deepEqual(character.companion.replies, {});
  assert.equal(character.knowledge.kind, 'manual');
  assert.ok(validateCharacter(character));
});
test('manual reference links stay unprocessed and bounded; notes do not become every personality field', () => {
  const input = {
    id: 'new',
    name: '新人物',
    work: '新作品',
    notes: '第一章登场',
    urls: 'https://example.org/person\nhttps://example.org/person',
    createdAt: cyrene.createdAt,
  };
  const character = createLocalCharacter(input);
  assert.equal(character.sources.length, 1);
  assert.equal(character.sources[0].snippet, '');
  assert.equal(character.summary, input.notes);
  assert.equal(character.appearance + character.speakingStyle, '');
  for (const urls of [
    'not-a-url',
    'https://user:password@example.org',
    'http://example.org',
    'https://example.org:8443',
    Array.from({ length: 7 }, (_, n) => `https://example.org/${n}`).join('\n'),
  ])
    assert.throws(() => createLocalCharacter({ ...input, urls }));
});
test('pack matching respects character identity and work, handles known aliases and never offers Cyrene for an unknown name', () => {
  const state = initialState();
  assert.equal(matchingCharacterPacks(state, '风堇', cyrene.work).length, 0);
  assert.equal(matchingCharacterPacks(state, '昔涟', '完全不同的作品').length, 0);
  assert.equal(matchingCharacterPacks(state, '  Cyrene ', 'Honkai: Star Rail').length, 1);
  assert.equal(matchingCharacterPacks(state, '', '').length, 0);
  state.skins.forEach((skin) => {
    skin.review = { status: 'pending', referenceDigest: 'test', imageDigest: 'test' };
  });
  assert.equal(matchingCharacterPacks(state, '昔涟', cyrene.work)[0].origin, 'builtin');
});
test('using a matching saved character preserves its edited profile and state and does not duplicate the person', () => {
  const state = initialState();
  state.characters[0].summary = '用户修改后的昔涟';
  state.messages[cyrene.id] = [{ id: 'old', role: 'user', content: '保留', createdAt: cyrene.createdAt }];
  const pack = matchingCharacterPacks(state, '昔涟', cyrene.work)[0];
  const result = activateCharacterPack(state, pack);
  assert.deepEqual(result.characters, state.characters);
  assert.deepEqual(result.settings, state.settings);
  assert.deepEqual(result.messages, state.messages);
  assert.deepEqual(result.memories, state.memories);
});
test('starter installation reuses an existing matching profile even when its ID came from an import', () => {
  const state = initialState();
  state.characters[0].id = 'imported-cyrene';
  state.characters[0].summary = '导入后编辑';
  state.skins = [];
  state.activeCharacterId = 'imported-cyrene';
  state.activeSkinId = '';
  state.messages = { 'imported-cyrene': [] };
  const result = activateCharacterPack(state, matchingCharacterPacks(state, '昔涟', cyrene.work)[0]);
  assert.equal(result.characters.length, 1);
  assert.equal(result.activeCharacterId, 'imported-cyrene');
  assert.equal(result.characters[0].summary, '导入后编辑');
  assert.ok(result.skins.every((skin) => skin.characterId === 'imported-cyrene'));
  assert.ok(validateState(result));
});
test('starter pack installation is idempotent and preserves saved personality, memories, keys configuration and chat', () => {
  const state = initialState();
  state.characters[0].summary = 'User edited biography';
  delete state.characters[0].companion;
  state.settings.llmModel = 'configured-model';
  state.messages[cyrene.id] = [{ id: 'message', role: 'user', content: 'hi', createdAt: cyrene.createdAt }];
  state.memories = [{ id: 'memory', characterId: cyrene.id, text: 'keep me', createdAt: cyrene.createdAt }];
  const installed = installStarterPack(state, '8bit');
  assert.equal(installed.characters[0].summary, 'User edited biography');
  assert.deepEqual(installed.settings, state.settings);
  assert.deepEqual(installed.messages, state.messages);
  assert.deepEqual(installed.memories, state.memories);
  assert.equal(installed.activeSkinId, 'cyrene-8bit-v5');
  assert.ok(installed.characters[0].companion);
  assert.deepEqual(installStarterPack(installed, '8bit'), installed);
  assert.ok(validateState(installed));
});
test('local replies use authored scene lines, vary by persisted local turns and never invent a free answer or memory', () => {
  const input = {
    character: cyrene,
    messages: [{ role: 'user', content: '给我一点鼓励吧' }],
    availableActions: ['idle', 'bounce'],
  };
  const first = localReply(input);
  assert.equal(first.text, cyrene.companion.replies.comfort[0]);
  assert.equal(first.action, 'idle');
  assert.equal(first.memory, null);
  assert.equal(first.origin, 'script');
  const second = localReply({
    ...input,
    messages: [{ role: 'assistant', origin: 'script', content: first.text }, ...input.messages],
  });
  assert.equal(second.text, cyrene.companion.replies.comfort[1]);
  const unknown = localReply({ ...input, messages: [{ role: 'user', content: '用 Python 写一个编译器' }] });
  assert.equal(unknown.interaction, 'unknown');
  assert.equal(unknown.text, cyrene.companion.replies.unknown[0]);
});
test('rest and wake intents survive unavailable animations and do not advertise missing poses', () => {
  const rest = localReply({ character: cyrene, messages: [{ content: '晚安' }], availableActions: ['idle'] });
  assert.equal(rest.action, 'idle');
  assert.equal(rest.interaction, 'rest');
  assert.equal(
    localReply({ character: cyrene, messages: [{ content: '醒醒' }], availableActions: ['idle', 'wave'] })
      .interaction,
    'wake',
  );
  assert.equal(interactionPlan('touch', cyrene, ['idle', 'wave'], ['neutral', 'happy']).action, 'idle');
  assert.equal(interactionPlan('greet', cyrene, ['idle'], ['neutral']).emotion, 'neutral');
});
test('headpat and poke have separate authored lines and fall back to actual asset capabilities', () => {
  const pat = interactionPlan('headpat', cyrene, ['idle', 'wave'], ['neutral', 'happy']);
  const poke = interactionPlan('poke', cyrene, ['idle', 'shake'], ['neutral', 'surprised']);
  assert.equal(pat.action, 'idle');
  assert.equal(pat.emotion, 'happy');
  assert.equal(pat.text, cyrene.companion.replies.headpat[0]);
  assert.equal(poke.action, 'idle');
  assert.equal(poke.emotion, 'neutral');
  assert.notEqual(pat.text, poke.text);
  const blank = { ...cyrene, companion: { version: 1, replies: { headpat: [] } } };
  assert.ok(interactionPlan('headpat', blank, ['idle'], ['neutral']).text);
  assert.equal(
    localReply({ character: cyrene, messages: [], event: 'poke', availableActions: ['idle'] }).action,
    'idle',
  );
  assert.ok(
    validateCharacter({
      ...cyrene,
      companion: { version: 1, replies: { headpat: ['谢谢'], poke: ['嗯？'] } },
    }),
  );
});
test('local behavior honors authored completion, priorities, cooldown and persistent rest', () => {
  const wave = admitBehavior(freshBehavior(), {
    event: 'greet',
    now: 100,
    duration: 1800,
    priority: 40,
    cooldown: 8000,
  });
  assert.equal(
    admitBehavior(wave, { event: 'proactive', now: 500, duration: 100, priority: 10, cooldown: 0 }),
    null,
  );
  assert.equal(
    admitBehavior(wave, { event: 'greet', now: 2000, duration: 1800, priority: 40, cooldown: 8000 }),
    null,
  );
  const sleeping = admitBehavior(wave, {
    event: 'rest',
    now: 600,
    duration: 100,
    priority: 90,
    cooldown: 0,
    rest: true,
  });
  assert.equal(sleeping.resting, true);
  assert.equal(
    admitBehavior(sleeping, { event: 'touch', now: 10000, duration: 100, priority: 40, cooldown: 0 }),
    null,
  );
  const awake = admitBehavior(sleeping, {
    event: 'wake',
    now: 650,
    duration: 1800,
    priority: 100,
    cooldown: 0,
    wake: true,
  });
  assert.equal(awake.resting, false);
});
test('quieter characters check in less often and only energetic affectionate characters wave when touched', () => {
  const quiet = { ...cyrene, behavior: { ...cyrene.behavior, energy: 10 } },
    lively = { ...cyrene, behavior: { ...cyrene.behavior, energy: 90 } };
  assert.ok(proactiveInterval(quiet) > proactiveInterval(lively));
  assert.equal(interactionPlan('touch', lively, ['idle', 'wave'], ['happy']).action, 'wave');
  assert.equal(interactionPlan('touch', quiet, ['idle', 'wave'], ['happy']).action, 'idle');
});
test('interaction profiles validate size and event names without entering canonical source data', () => {
  assert.deepEqual(validateCharacter(cyrene).companion, cyrene.companion);
  assert.throws(
    () =>
      validateCharacter({ ...cyrene, companion: { version: 1, replies: { touch: Array(13).fill('line') } } }),
    /12/,
  );
  assert.throws(
    () =>
      validateCharacter({ ...cyrene, companion: { version: 1, replies: { execute: ['arbitrary script'] } } }),
    /unknown/,
  );
  assert.throws(() => validateSettings({ ...initialState().settings, chatMode: 'fake' }));
});
test('exported starter art contains original PNG bytes, shared animation timings and authored lines, with no machine references', async () => {
  const state = installStarterPack(initialState(), '8bit');
  const skins = state.skins;
  const pack = require('../shared/cyrene-motion-pack.json');
  const bundle = await portableBundle(
    { ...state.characters[0], llmKey: 'must-be-stripped' },
    skins,
    path.resolve('public/art'),
  );
  const checked = validateBundle(bundle);
  assert.deepEqual(Object.keys(bundle).sort(), ['character', 'skins', 'version']);
  assert.equal(bundle.character.llmKey, undefined);
  for (let i = 0; i < skins.length; i++) {
    const bytes = Buffer.from(checked.skins[i].images.neutral.split(',')[1], 'base64');
    const entry = pack.entries.find((entry) => entry.builtin === skins[i].builtin);
    assert.deepEqual(bytes, fs.readFileSync(path.join('public/art', entry.file)));
    assert.equal(checked.skins[i].builtin, undefined);
    assert.deepEqual(checked.skins[i].sprite, entry.animation);
  }
  assert.equal(checked.skins.length, 7);
  assert.deepEqual(checked.character.companion, cyrene.companion);
});
test('legacy 2x2 atlas exports preserve the displayed first pose, without assigning extra motions', async () => {
  const state = initialState();
  const bundle = await portableBundle(
    cyrene,
    [
      {
        ...state.skins.find((skin) => skin.style === 'pixel'),
        id: 'legacy-pixel',
        builtin: 'cyrene-pixel-v4',
      },
    ],
    path.resolve('public/art'),
  );
  assert.ok(bundle.skins.length);
  for (const skin of bundle.skins) {
    assert.deepEqual(Object.keys(skin.sprite.clips), ['idle']);
    assert.deepEqual(skin.sprite.frames[0].rect.slice(0, 2), [0, 0]);
  }
});
test('pack export rejects cross-character art and filename traversal before file access', async () => {
  const skin = initialState().skins[0];
  await assert.rejects(
    portableBundle(cyrene, [{ ...skin, characterId: 'someone-else' }], 'public/art'),
    /不属于/,
  );
  await assert.rejects(
    portableBundle(cyrene, [{ ...skin, builtin: '../../credentials' }], 'public/art'),
    /builtin/,
  );
});
test('saved local replies retain their label, intent and reply id without fabricating long term memory', () => {
  const state = initialState();
  const reply = localReply({
    character: cyrene,
    messages: [{ content: '晚安' }],
    availableActions: ['idle', 'sleep'],
  });
  const appended = appendCompletedReply(state, {
    characterId: cyrene.id,
    reply,
    messageId: 'local-reply',
    memoryId: 'unused',
    createdAt: cyrene.createdAt,
  });
  const stored = validateState(appended);
  assert.equal(stored.messages[cyrene.id][0].origin, 'script');
  assert.equal(stored.messages[cyrene.id][0].interaction, 'rest');
  assert.equal(stored.memories.length, 0);
});
