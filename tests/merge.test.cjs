'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mergeSnapshots } = require('../electron/merge.cjs');
const base = {
  revision: 5,
  settings: { motionEnabled: true, llmModel: 'old' },
  characters: [{ id: 'a', name: '小森', summary: 'old' }],
  skins: [],
  memories: [],
  messages: { a: [] },
  activeCharacterId: 'a',
  activeSkinId: '',
};
const clone = () => structuredClone(base);
test('concurrent windows keep independent field edits, messages and memories', () => {
  const left = clone(),
    right = clone();
  left.characters[0].name = '小森森';
  left.messages.a.push({ id: 'l', content: 'left', createdAt: '2026-09-30T00:00:01Z' });
  right.characters[0].summary = 'new summary';
  right.messages.a.push({ id: 'r', content: 'right', createdAt: '2026-09-30T00:00:02Z' });
  right.memories.push({ id: 'm', text: 'remember' });
  right.settings.motionEnabled = false;
  const merged = mergeSnapshots(base, left, right);
  assert.equal(merged.characters[0].name, '小森森');
  assert.equal(merged.characters[0].summary, 'new summary');
  assert.deepEqual(
    merged.messages.a.map((m) => m.id),
    ['l', 'r'],
  );
  assert.equal(merged.memories[0].id, 'm');
  assert.equal(merged.settings.motionEnabled, false);
  assert.equal(base.characters[0].name, '小森');
});
test('same-field conflicts and edit-versus-delete preserve data by rejecting the save', () => {
  const left = clone(),
    right = clone();
  left.characters[0].name = 'left';
  right.characters[0].name = 'right';
  assert.throws(() => mergeSnapshots(base, left, right), /另一窗口/);
  right.characters = [];
  assert.throws(() => mergeSnapshots(base, left, right), /另一窗口/);
  left.characters = [];
  assert.deepEqual(mergeSnapshots(base, left, right).characters, []);
});
test('ordered identity references remain atomic while collection additions coexist', () => {
  const before = clone();
  before.characters[0].visualReferences = [{ id: 'one' }];
  const left = structuredClone(before),
    right = structuredClone(before);
  left.characters[0].visualReferences = [{ id: 'one' }, { id: 'two' }];
  right.characters[0].visualReferences = [{ id: 'three' }, { id: 'one' }];
  assert.throws(() => mergeSnapshots(before, left, right), /另一窗口/);
  assert.throws(() => mergeSnapshots(null, { ...base, revision: 1 }, base), /另一窗口/);
  const a = clone(),
    b = clone();
  a.memories = [{ id: 'a' }];
  b.memories = [{ id: 'b' }];
  assert.deepEqual(new Set(mergeSnapshots(base, a, b).memories.map((m) => m.id)), new Set(['a', 'b']));
});
