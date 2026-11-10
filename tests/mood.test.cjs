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
  for (let t = 20; t <= 120; t += 5) {
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
  m.feel(present, 'chat', 121 * MIN);
  m.feel(present, 'play', 122 * MIN);
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

test('how she feels changes what she does, not only her face', () => {
  const conduct = (name) => m.moodConduct(name);
  // Happy, she is brisk and restless; lonely, she drags her feet and stays down by you longest of
  // all but cross, when she sits sulking even longer.
  assert.ok(conduct('happy').pace > conduct('calm').pace);
  assert.ok(conduct('lonely').pace < conduct('calm').pace);
  assert.ok(conduct('lonely').walksOnly && conduct('angry').walksOnly && !conduct('happy').walksOnly);
  assert.ok(conduct('happy').hold[1] <= conduct('calm').hold[1]);
  assert.ok(conduct('lonely').hold[0] > conduct('calm').hold[0]);
  assert.ok(conduct('angry').hold[0] > conduct('lonely').hold[0]);
  // Sitting or lying down is a stay of most of a minute at least, not a gesture.
  for (const name of ['calm', 'happy', 'lonely', 'angry']) assert.ok(conduct(name).hold[0] >= 30, name);
  // Lonely, she stays with you; cross, she keeps away from your window.
  assert.equal(conduct('lonely').ownChance, 0);
  assert.equal(conduct('angry').keepsCompany, false);
  assert.ok(['calm', 'happy', 'lonely'].every((name) => conduct(name).keepsCompany));

  // Her habits as her mood allows: no humming while cross; sitting by you while lonely even if
  // sitting is not one of her habits; humming and stretching when happy.
  const own = ['lookAround', 'hum', 'stretch'];
  assert.deepEqual(m.moodHabits('calm', own), own);
  assert.deepEqual(new Set(m.moodHabits('angry', own)), new Set(['sit']));
  assert.deepEqual(new Set(m.moodHabits('lonely', own)), new Set(['lookAround', 'sit', 'lie']));
  assert.deepEqual(new Set(m.moodHabits('happy', ['sit'])), new Set(['sit', 'hum', 'stretch']));
  assert.equal(
    m.within([45, 90], () => 0),
    45000,
  );
  assert.equal(
    m.within([45, 90], () => 1),
    90000,
  );

  // The routine leans the same way: cross, she writes in her diary rather than play games.
  const picks = (name) => {
    const counts = {};
    for (let i = 0; i < 400; i++) {
      const s = life.createLife(0);
      s.until = 0;
      s.focus = 0;
      let n = ((i + 1) * 2654435761) % 2147483647 || 1;
      const random = () => (n = (n * 48271) % 2147483647) / 2147483647;
      const step = life.advanceLife(s, {
        now: 1000,
        hour: 15,
        available: ['read', 'gaming', 'music', 'diary'],
        proactive: false,
        leanings: m.moodConduct(name).activities,
        random,
      });
      counts[step.activity] = (counts[step.activity] || 0) + 1;
    }
    return counts;
  };
  const calm = picks('calm'),
    angry = picks('angry'),
    happy = picks('happy');
  assert.ok(angry.diary > calm.diary * 1.5, JSON.stringify({ calm, angry }));
  assert.ok((angry.gaming || 0) < calm.gaming / 2, JSON.stringify({ calm, angry }));
  assert.ok(happy.gaming + happy.music > calm.gaming + calm.music, JSON.stringify({ calm, happy }));
});

test('one pat, a chat or a game ends her loneliness; sitting with the user she is not alone', () => {
  // However lonely she had grown, the user coming to her is what she was missing.
  for (const event of ['headpat', 'chat', 'play', 'touch']) {
    const lonely = { ...m.createMood(0), lonely: 100 };
    m.feel(lonely, event, MIN);
    assert.notEqual(m.moodName(lonely), 'lonely', event);
    assert.ok(lonely.lonely < 75, `${event}: no sad face either`);
  }
  // A poke is attention of a sort, but not that.
  const poked = { ...m.createMood(0), lonely: 100 };
  m.feel(poked, 'poke', MIN);
  assert.equal(m.moodName(poked), 'lonely');
  // Welcomed back, she cheers up a good deal.
  const back = { ...m.createMood(0), lonely: 70 };
  m.feel(back, 'greet', MIN);
  assert.notEqual(m.moodName(back), 'lonely');
  // Three hours by the user's window while they work: never lonely, and she gets over it.
  const company = { ...m.createMood(0), lonely: 65 };
  for (let t = 1; t <= 180; t++) m.settle(company, t * MIN, true, true);
  assert.equal(company.lonely, 0);
  assert.equal(company.lastContact, 180 * MIN);
  // Then on her own: the quarter of an hour's grace counts from when she was last with them.
  m.settle(company, 194 * MIN, true, false);
  assert.equal(company.lonely, 0);
  // A working day at the computer without her: lonely, but not in under two hours.
  const workday = m.createMood(0);
  for (let t = 1; t <= 100; t++) m.settle(workday, t * MIN, true);
  assert.notEqual(m.moodName(workday), 'lonely');
  for (let t = 101; t <= 240; t++) m.settle(workday, t * MIN, true);
  assert.equal(m.moodName(workday), 'lonely');
  // Overnight with the app closed: she missed the user, but is not miserable when it opens.
  const night = m.createMood(0);
  m.settle(night, 10 * 60 * MIN, true);
  assert.notEqual(m.moodName(night), 'lonely');
});
