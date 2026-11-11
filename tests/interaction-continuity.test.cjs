'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  ts = require('typescript');
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  const out = {};
  cache.set(file, out);
  new Function(
    'exports',
    'require',
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  )(out, (name) =>
    name.endsWith('.json')
      ? require(path.resolve(path.dirname(file), name))
      : load(path.resolve(path.dirname(file), name + '.ts')),
  );
  return out;
}
const { createTouchGestures } = load('src/touchGestures.ts');
const { interactionPlan } = load('src/companion.ts');
const { createLife, advanceLife, restoreLife } = load('src/life.ts');
const { cyrene } = load('src/initial.ts');
const all = ['read', 'diary', 'office', 'snack', 'gaming', 'music'];
const options = { hour: 15, available: all, proactive: false, random: () => 0.5 };
test('a quiet reader and a playful character respond differently without a forced surprised portrait', () => {
  const character = (personality, energy) => ({
    ...cyrene,
    id: 'new',
    personality: [personality],
    summary: '',
    speakingStyle: '',
    desktopProfile: undefined,
    behavior: { energy, affection: 60, curiosity: 50 },
    companion: { replies: { poke: ['保留作者台词'] } },
  });
  const quiet = interactionPlan(
    'poke',
    character('沉稳', 20),
    ['idle', 'wave', 'nod'],
    ['neutral', 'happy', 'surprised'],
  );
  const lively = interactionPlan(
    'poke',
    character('活泼', 90),
    ['idle', 'wave', 'nod'],
    ['neutral', 'happy', 'surprised'],
  );
  assert.equal(quiet.action, 'idle');
  assert.equal(quiet.emotion, 'neutral');
  assert.equal(lively.action, 'wave');
  assert.equal(lively.emotion, 'happy');
  assert.equal(lively.text, '保留作者台词');
  assert.equal(quiet.text, lively.text);
});
test('missing reaction frames use the existing idle and neutral assets', () => {
  const result = interactionPlan('headpat', cyrene, ['idle'], ['neutral']);
  assert.equal(result.action, 'idle');
  assert.equal(result.emotion, 'neutral');
});
test('two deliberate back-and-forth turns stroke the head; jitter and a straight pass do not', () => {
  const g = createTouchGestures();
  for (const [x, t] of [
    [100, 100],
    [110, 250],
    [111, 300],
    [109, 350],
    [130, 400],
  ])
    assert.equal(g.sample(x, t, true, true), null);
  assert.equal(g.sample(115, 550, true, true), null);
  assert.equal(g.sample(130, 700, true, true), 'headpat');
  assert.equal(g.sample(110, 900, true, true), null, 'cooldown');
});
test('leaving the figure and dragging break the stroke chain', () => {
  for (const dragging of [false, true]) {
    const g = createTouchGestures();
    g.sample(100, 100, true, true);
    g.sample(120, 300, true, true);
    g.sample(100, 500, true, true);
    g.sample(120, 600, false, !dragging ? false : true, dragging);
    assert.equal(g.sample(120, 700, true, true), null);
  }
});
test('hovering notices the user once, then waits instead of repeatedly interrupting', () => {
  const g = createTouchGestures();
  assert.equal(g.sample(100, 100, false, true), null);
  assert.equal(g.sample(100, 2400, false, true), 'watch');
  assert.equal(g.sample(100, 6000, false, true), null);
  g.reset();
  assert.equal(g.sample(100, 16000, false, true), null);
});
test('a hold is distinct from a click and releasing cancels it', () => {
  const g = createTouchGestures();
  g.down(100);
  assert.equal(g.sample(100, 500, false, true), null);
  assert.equal(g.sample(100, 800, false, true), 'hold');
  const released = createTouchGestures();
  released.down(100);
  released.up();
  assert.equal(released.sample(100, 800, false, true), null);
});
test('a task continues across animation segments without rerolling the activity', () => {
  const s = createLife(0);
  s.until = 0;
  advanceLife(s, { ...options, now: 1000 });
  const task = s.activity;
  const remaining = s.task.remaining;
  s.until = 1000;
  advanceLife(s, { ...options, now: 6000, random: () => 0.99 });
  assert.equal(s.activity, task);
  assert.ok(s.task.remaining < remaining);
  assert.match(s.reason, /这一|这首|刚才|继续|接着/);
});
test('a focused task rests long enough and then resumes the unfinished work', () => {
  const s = createLife(0);
  s.activity = 'read';
  s.until = 0;
  s.focus = 60;
  s.task = { activity: 'read', remaining: 300000 };
  advanceLife(s, { ...options, now: 1000 });
  assert.equal(s.activity, 'idle');
  assert.equal(s.resume, 'read');
  advanceLife(s, { ...options, now: 30000 });
  assert.equal(s.activity, 'idle', 'not a rapid rest/resume loop');
  for (let now = 60000; now <= 240000 && s.activity === 'idle'; now += 30000)
    advanceLife(s, { ...options, now });
  assert.equal(s.activity, 'read');
  assert.equal(s.resume, null);
});
test('a hunger break returns to the same task rather than drawing a new random hobby', () => {
  const s = createLife(0);
  s.activity = 'diary';
  s.until = 0;
  s.hunger = 80;
  s.task = { activity: 'diary', remaining: 300000 };
  advanceLife(s, { ...options, now: 1000 });
  assert.equal(s.activity, 'snack');
  assert.equal(s.resume, 'diary');
  s.hunger = 20;
  s.until = 1000;
  advanceLife(s, { ...options, now: 6000 });
  assert.equal(s.activity, 'diary');
});
test('unavailable snack and hobby assets never become imaginary activities', () => {
  const s = createLife(0);
  s.until = 0;
  s.hunger = 90;
  advanceLife(s, { ...options, available: [], now: 1000 });
  assert.equal(s.activity, 'idle');
  const t = createLife(0);
  t.until = 0;
  t.hunger = 90;
  advanceLife(t, { ...options, available: ['read'], now: 1000 });
  assert.equal(t.activity, 'read');
});
test('a foreground app change cannot abandon an unfinished project', () => {
  const s = createLife(0);
  s.activity = 'diary';
  s.until = 0;
  s.task = { activity: 'diary', remaining: 300000 };
  advanceLife(s, {
    ...options,
    now: 1000,
    context: { mode: 'typing', key: 'editor', companion: 'office', idleMinutes: 0 },
  });
  assert.equal(s.activity, 'diary');
  assert.equal(restoreLife(JSON.parse(JSON.stringify(s)), 2000).task.activity, 'diary');
  s.task.remaining = 0;
  s.until = 0;
  advanceLife(s, {
    ...options,
    now: 3000,
    random: () => 0.1,
    context: { mode: 'typing', key: 'editor', companion: 'office', idleMinutes: 0 },
  });
  assert.equal(s.activity, 'office');
});

test('a passive glance does not lock out a deliberate head stroke', () => {
  const g = createTouchGestures();
  g.sample(100, 100, false, true);
  assert.equal(g.sample(100, 2400, false, true), 'watch');
  for (const [x, t] of [
    [100, 2500],
    [120, 2650],
    [100, 2800],
  ])
    assert.equal(g.sample(x, t, true, true), null);
  assert.equal(g.sample(120, 2950, true, true), 'headpat');
});
