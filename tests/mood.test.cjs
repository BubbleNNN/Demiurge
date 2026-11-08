'use strict';
// Her feelings: lonely when left alone, happy when played with, cross when woken up or flung off
// a window, comforted by a pat on the head.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function load(file) {
  const result = {};
  new Function(
    'exports',
    'require',
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  )(result, require);
  return result;
}
const m = load(path.resolve(__dirname, '../src/mood.ts'));
const life = load(path.resolve(__dirname, '../src/life.ts'));
const MIN = 60000;

test('left alone she grows lonely, faster while the user is at the computer; company lifts it', () => {
  const present = m.createMood(0),
    away = m.createMood(0);
  m.settle(present, 15 * MIN, true);
  assert.equal(present.lonely, 15, 'a quarter of an hour alone is nothing yet');
  for (let t = 20; t <= 90; t += 5) {
    m.settle(present, t * MIN, true);
    m.settle(away, t * MIN, false);
  }
  assert.equal(m.moodName(present), 'lonely');
  assert.ok(present.lonely > away.lonely);
  assert.equal(m.moodFace('lonely'), 'sad');
  assert.equal(m.moodMark('lonely'), '…');
  assert.match(m.moodWords(present), /寂寞/);
  assert.match(
    m.moodLine('greet', present, () => 0),
    /等了好久|寂寞/,
  );
  m.feel(present, 'chat', 91 * MIN);
  m.feel(present, 'play', 92 * MIN);
  assert.notEqual(m.moodName(present), 'lonely');
  assert.equal(m.moodName(present), 'happy', 'a game makes her happy');
  assert.equal(m.moodMark('happy'), '♪');
});

test('woken up or flung off a window she is cross; pokes make it worse, a pat on the head comforts her', () => {
  const mood = m.createMood(0);
  m.feel(mood, 'woken', MIN);
  assert.equal(m.moodName(mood), 'angry');
  assert.equal(mood.grudge, '睡得正香被吵醒');
  assert.match(m.moodWords(mood), /生气（睡得正香被吵醒）/);
  assert.equal(m.moodMark('angry'), '💢');
  const before = mood.anger;
  m.feel(mood, 'poke', MIN);
  assert.ok(mood.anger > before, 'poking a cross character');
  assert.match(
    m.moodLine('poke', mood, () => 0),
    /生气|不理你/,
  );
  m.feel(mood, 'headpat', MIN);
  m.feel(mood, 'headpat', MIN);
  assert.notEqual(m.moodName(mood), 'angry');
  // Anger also cools down by itself, and the grudge goes with it.
  const flung = m.feel(m.createMood(0), 'flung', 0);
  assert.equal(m.moodName(flung), 'angry');
  m.settle(flung, 30 * MIN, true);
  assert.notEqual(m.moodName(flung), 'angry');
  assert.equal(flung.grudge, '');
});

test('saved feelings are checked and bounded', () => {
  const restored = m.restoreMood(
    { joy: 400, lonely: -3, anger: 'x', lastContact: 9e15, grudge: 'y'.repeat(99) },
    1000,
  );
  assert.deepEqual(
    [restored.joy, restored.lonely, restored.anger, restored.lastContact, restored.grudge.length],
    [100, 0, 0, 1000, 40],
  );
  assert.equal(m.restoreMood(null, 5).updatedAt, 5);
});

test('lonely, she asks for a chat or a pat; cross, only to be comforted; feelings survive a long absence', () => {
  const ask = (feelings, seed) => {
    const s = life.createLife(0);
    s.nextInvite = 0;
    s.social = 10;
    let n = seed;
    const random = () => (n = (n * 48271) % 2147483647) / 2147483647;
    return life.advanceLife(s, { now: 1000, hour: 15, available: ['read'], feelings, random }).invite;
  };
  assert.equal(ask(undefined, 3), null, 'not lonely and not missing anyone: no invitation');
  const lonely = new Set(Array.from({ length: 40 }, (_, i) => ask({ lonely: true, angry: false }, i + 2)));
  assert.ok(lonely.has('chat') && lonely.has('pat'), [...lonely].join());
  assert.deepEqual(
    new Set(Array.from({ length: 20 }, (_, i) => ask({ lonely: false, angry: true }, i + 2))),
    new Set(['pat']),
  );
  assert.equal(life.offerText('chat').title, '陪我聊聊');
  assert.equal(life.isMoment('pat'), false);
  assert.equal(life.isMoment('guess'), true);
  // An hour away resets her routine, but not how she feels.
  const saved = { ...life.createLife(0), mood: { ...m.createMood(0), lonely: 80 } };
  assert.equal(life.restoreLife(saved, 3600000).mood.lonely, 80);
  // The chat model hears how she feels.
  assert.ok(life.lifeSituation(life.createLife(0), {}, 0, '有点生气').feeling.includes('有点生气'));
});
