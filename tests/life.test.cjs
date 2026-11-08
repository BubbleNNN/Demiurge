'use strict';
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
const life = load(path.resolve(__dirname, '../src/life.ts'));
const all = ['read', 'gaming', 'snack', 'music', 'diary'];
const minute = 60000;
const day = (hour) => new Date(2026, 10, 7, hour, 0, 0).getTime();
const steady = () => 0.5;

test('needs drift; hunger interrupts focused work with a reason, then she resumes it', () => {
  const start = day(15);
  const s = life.createLife(start);
  s.activity = 'read';
  s.until = start + 60 * minute;
  s.hunger = 61;
  let now = start;
  for (let i = 0; i < 12; i++)
    life.advanceLife(s, { now: (now += minute), hour: 15, available: all, random: steady });
  assert.ok(s.hunger > 61, 'hunger rises over time');
  s.until = now;
  const step = life.advanceLife(s, { now: (now += 1000), hour: 15, available: all, random: steady });
  assert.equal(step.activity, 'snack');
  assert.equal(step.changed, true);
  assert.match(s.reason, /饿|馋/);
  assert.equal(s.resume, 'read');
  // Follow her minute by minute until the snack is over.
  for (let i = 0; i < 5 && s.activity === 'snack'; i++)
    life.advanceLife(s, { now: (now += minute), hour: 15, available: all, random: steady });
  assert.equal(s.activity, 'read', 'returns to the interrupted activity');
});

test('interaction pauses the fictional clock without catch-up bursts', () => {
  const start = day(14);
  const s = life.createLife(start);
  const before = { ...s };
  assert.equal(
    life.advanceLife(s, { now: start + 30 * minute, hour: 14, available: all, blocked: true }),
    null,
  );
  assert.equal(s.hunger, before.hunger);
  life.advanceLife(s, { now: start + 30 * minute + 5000, hour: 14, available: all, random: steady });
  assert.ok(s.hunger - before.hunger < 1, 'only the 5 seconds after the pause count');
});

test('invitations follow loneliness, never nag, and back off further each time she is turned down', () => {
  const start = day(16);
  const s = life.createLife(start);
  s.social = 90;
  s.nextInvite = start;
  s.until = start + 60 * minute;
  const step = life.advanceLife(s, { now: start + 1000, hour: 16, available: all, random: steady });
  assert.ok(step.invite, 'she invites when she wants company');
  assert.ok(s.pending);
  life.settleInvite(s, 'decline', start + 2000);
  const first = s.nextInvite - (start + 2000);
  s.social = 90;
  s.nextInvite = start;
  life.advanceLife(s, { now: start + 3000, hour: 16, available: all, random: steady });
  life.settleInvite(s, 'decline', start + 4000);
  assert.ok(s.nextInvite - (start + 4000) > first, 'second refusal waits longer');
  life.settleInvite(s, 'accept', start + 5000);
  assert.equal(s.missed, 0);
  // Late at night she neither invites nor chatters.
  const night = life.createLife(day(23));
  night.social = 95;
  night.nextInvite = 0;
  night.nextSpeech = 0;
  const quiet = life.advanceLife(night, { now: day(23) + 1000, hour: 23, available: all, random: steady });
  assert.equal(quiet.invite, null);
  assert.equal(quiet.speech, null);
});

test('tired at night she sleeps; shared moments are remembered briefly and described for chat', () => {
  const night = life.createLife(day(1));
  night.energy = 10;
  night.until = day(1);
  assert.equal(
    life.advanceLife(night, { now: day(1) + 1000, hour: 1, available: all, random: steady }).activity,
    'sleep',
  );

  const now = day(17);
  const s = life.createLife(now);
  s.hunger = 70;
  for (let i = 0; i < 14; i++) life.recordMoment(s, 'guess', `第 ${i} 局`, now - (14 - i) * minute);
  life.recordMoment(s, 'snack', '分享了草莓蛋糕', now - 5 * minute);
  assert.equal(s.moments.length, 12, 'keeps the most recent moments only');
  assert.ok(s.hunger < 70, 'sharing a snack satisfies hunger');
  s.activity = 'read';
  const situation = life.lifeSituation(s, { read: '在读书' }, now);
  assert.equal(situation.doing, '在读书');
  assert.equal(situation.timeOfDay, '下午');
  assert.match(situation.recentMoments.at(-1), /5 分钟前一起吃了点心：分享了草莓蛋糕/);
});

test('reopening within half an hour continues the same activity; later only the needs carry over', () => {
  const now = day(12);
  const s = life.createLife(now);
  s.activity = 'music';
  s.until = now + 10 * minute;
  s.hunger = 44;
  const saved = JSON.parse(JSON.stringify(s));
  assert.equal(life.restoreLife(saved, now + 5 * minute).activity, 'music');
  const later = life.restoreLife(saved, now + 3 * 60 * minute);
  assert.equal(later.activity, 'idle');
  assert.equal(later.hunger, 44);
  assert.equal(life.restoreLife({ version: 9 }, now).activity, 'idle');
});

test('what the user is doing shapes her routine: alongside their work, her own fun while they are away', () => {
  const all = ['read', 'gaming', 'snack', 'music', 'diary', 'office'];
  const temperament = { energy: 50, affection: 50, curiosity: 50 };
  const coding = { mode: 'typing', key: 'com.microsoft.VSCode', companion: 'office', idleMinutes: 0 };
  // The user opens their editor while she is playing: she wraps up and works beside them.
  let s = life.createLife(0);
  s.activity = 'gaming';
  s.until = 10 * 60000;
  let seed = 3;
  const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const step = life.advanceLife(s, {
    now: 5000,
    hour: 15,
    available: all,
    temperament,
    context: coding,
    random: () => 0.1,
  });
  assert.equal(step.activity, 'office');
  assert.equal(step.changed, true);
  // Once per change of app: the next ticks do not restart it.
  const until = s.until;
  life.advanceLife(s, { now: 10000, hour: 15, available: all, temperament, context: coding, random });
  assert.equal(s.until, until);
  // Without that activity in her pack, nothing is forced.
  s = life.createLife(0);
  s.activity = 'gaming';
  s.until = 10 * 60000;
  assert.equal(
    life.advanceLife(s, {
      now: 5000,
      hour: 15,
      available: all,
      temperament,
      context: { ...coding, companion: null },
      random,
    }).changed,
    false,
  );
  // Away a long while: she naps; away a little: she plays more than she works.
  s = life.createLife(0);
  s.energy = 60;
  s.until = 0;
  const away = { mode: 'away', key: '', companion: null, idleMinutes: 30 };
  assert.equal(
    life.advanceLife(s, { now: 1000, hour: 15, available: all, temperament, context: away, random }).activity,
    'sleep',
  );
  const kinds = { alone: {}, working: {} };
  for (let i = 0; i < 400; i++) {
    for (const [name, context] of [
      ['alone', { mode: 'away', key: '', companion: null, idleMinutes: 8 }],
      ['working', { mode: 'idle', key: '', companion: null, idleMinutes: 2 }],
    ]) {
      const t = life.createLife(0);
      t.until = 0;
      const picked = life.advanceLife(t, {
        now: 1000,
        hour: 15,
        available: all,
        temperament,
        context,
        random,
      }).activity;
      kinds[name][picked] = (kinds[name][picked] || 0) + 1;
    }
  }
  assert.ok((kinds.alone.gaming || 0) > (kinds.working.gaming || 0), JSON.stringify(kinds));
  assert.ok((kinds.alone.office || 0) < (kinds.working.office || 0), JSON.stringify(kinds));
});
