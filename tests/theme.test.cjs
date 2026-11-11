'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
function loadTs(file) {
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  new Function('exports', 'require', source)(
    exports,
    require('node:module').createRequire(require('node:path').resolve(file)),
  );
  return exports;
}
const { resolveTheme, themeVars, skinImage, styles, availableStyle } = loadTs('src/theme.ts');
const { initialState, migrateState } = loadTs('src/initial.ts');
test('character identity and appearance select matching palettes while explicit choice wins', () => {
  assert.equal(resolveTheme({ name: '昔涟', appearance: '' }).id, 'rose');
  assert.equal(resolveTheme({ name: '海风', appearance: '水蓝色头发' }).id, 'ocean');
  assert.equal(resolveTheme({ name: '昔涟', theme: 'forest' }).id, 'forest');
  assert.equal(themeVars({ name: '昔涟', accent: '#123456' })['--accent'], '#123456');
  // Four looks are offered; the same list gates new production tasks in the main process.
  assert.deepEqual(
    styles.map((style) => style.id),
    require('../shared/creation-styles.json'),
  );
  assert.deepEqual(
    styles.map((style) => style.id),
    ['original', '8bit', '3d', 'chibi-pet'],
  );
  for (const retired of ['anime', 'chibi', 'sticker', 'pastel', 'powerpuff', 'pixel', 'figure'])
    assert.equal(availableStyle(retired), true, `${retired} skins made earlier stay visible`);
});
test('first workspace and old demo migrations disable fake replies without deleting saved characters', () => {
  const fresh = initialState();
  assert.equal(fresh.settings.demoMode, false);
  const old = {
    ...fresh,
    settings: { ...fresh.settings, demoMode: true },
    characters: [{ ...fresh.characters[0], id: 'old', name: '旧伙伴' }],
    skins: [],
    messages: { old: [] },
  };
  const migrated = migrateState(old);
  assert.equal(migrated.settings.demoMode, false);
  assert.ok(migrated.characters.some((c) => c.id === 'old'));
  assert.equal(migrated.activeCharacterId, 'mori-cyrene');
});
test('missing expression falls back to actual base art and model skins have no fake illustration', () => {
  assert.equal(skinImage({ images: { neutral: 'base' } }, 'happy'), 'base');
  assert.equal(skinImage({ images: {}, builtin: 'cyrene-anime' }), './art/cyrene-anime.png');
  assert.equal(skinImage({ images: {}, kind: 'vrm' }), undefined);
});
test('retired styles disappear from selection while their saved assets and other workspace data remain recoverable', () => {
  const fresh = initialState();
  const legacy = {
    ...fresh.skins[0],
    id: 'saved-watercolor',
    builtin: 'cyrene-watercolor-v4',
    images: {neutral:'data:image/png;base64,owned-art'},
    style: 'watercolor',
  };
  const existing = {
    ...fresh,
    skins: [...fresh.skins.filter((skin) => skin.style !== 'original'), legacy],
    activeSkinId: legacy.id,
    messages: { 'mori-cyrene': [{ id: 'saved-message', content: '保留聊天' }] },
    memories: [{ id: 'saved-memory', text: '保留记忆' }],
  };
  const migrated = migrateState(existing);
  assert.equal(migrated.activeSkinId, 'cyrene-chibi-v6');
  assert.equal(
    migrated.skins.find((skin) => skin.id === legacy.id),
    legacy,
  );
  for (const field of ['settings', 'characters', 'messages', 'memories'])
    assert.deepEqual(migrated[field], existing[field]);
  assert.ok(['realistic', 'plush', 'watercolor', 'figurine'].every((style) => !availableStyle(style)));
  assert.equal(migrateState(migrated), migrated);
  assert.equal(
    migrateState({ ...existing, activeSkinId: 'cyrene-anime-v5' }).activeSkinId,
    'cyrene-anime-v5',
  );
});
