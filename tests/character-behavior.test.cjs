'use strict';
// Each character lives on the desktop in her own way: hobbies, habits, travel and manner come from
// her profile, not from one template.
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
const b = load(path.resolve(__dirname, '../src/characterBehavior.ts'));
const heads = load(path.resolve(__dirname, '../src/animation/heads.ts'));
const life = load(path.resolve(__dirname, '../src/life.ts'));
const base = {
  summary: '',
  personality: [],
  speakingStyle: '',
  appearance: '',
  work: '',
  behavior: { energy: 50, affection: 50, curiosity: 50 },
};

test('the built-in character writes her diary, hums and teases gently', () => {
  const cyrene = b.desktopProfile({ ...base, id: 'mori-cyrene' });
  assert.equal(cyrene.hobbies[0], 'diary');
  assert.ok(cyrene.habits.includes('sit') && cyrene.habits.includes('hum'));
  assert.equal(b.leadingManner(cyrene), 'teasing');
  assert.equal(b.touchMark(cyrene, 'headpat'), '✦');
  assert.ok(b.pickLine(cyrene, 'seek', () => 0));
});

test('other characters are read from their own profile: traits, hobbies and how they travel', () => {
  const shy = b.desktopProfile({
    ...base,
    id: 'a',
    personality: ['害羞', '内向'],
    summary: '喜欢看书和写诗的图书委员',
  });
  assert.equal(b.leadingManner(shy), 'shy');
  assert.deepEqual(shy.hobbies.slice(0, 2), ['diary', 'read']);
  assert.equal(b.touchMark(shy, 'headpat'), '///');
  assert.match(
    b.pickLine(shy, 'headpat', () => 0),
    /害羞|摸/,
  );
  const gamer = b.desktopProfile({
    ...base,
    id: 'b',
    personality: ['调皮', '爱捉弄人'],
    summary: '重度游戏玩家',
    behavior: { energy: 85, affection: 50, curiosity: 40 },
  });
  assert.equal(gamer.hobbies[0], 'gaming');
  assert.equal(b.leadingManner(gamer), 'teasing');
  assert.equal(gamer.travel, 'run');
  const witch = b.desktopProfile({ ...base, id: 'c', summary: '骑着扫帚飞行的魔女', personality: ['冷静'] });
  assert.equal(witch.travel, 'fly');
  assert.equal(b.leadingManner(witch), 'calm');
  assert.ok(witch.habits.includes('lie'));
  // Unknown traits still give a full profile from the temperament.
  const plain = b.desktopProfile({
    ...base,
    id: 'd',
    behavior: { energy: 20, affection: 50, curiosity: 80 },
  });
  assert.ok(plain.hobbies.length >= 3 && plain.habits.length >= 3);
  assert.equal(plain.travel, 'walk');
});

test('her favourite activities come up far more often in her routine', () => {
  const count = (hobbies) => {
    const seen = {};
    let n = 7;
    const random = () => (n = (n * 48271) % 2147483647) / 2147483647;
    for (let i = 0; i < 600; i++) {
      const s = life.createLife(0);
      s.until = 0;
      const step = life.advanceLife(s, {
        now: 1000,
        hour: 15,
        available: ['read', 'gaming', 'snack', 'music', 'diary', 'office'],
        hobbies,
        random,
      });
      seen[step.activity] = (seen[step.activity] || 0) + 1;
    }
    return seen;
  };
  const diarist = count(['diary', 'read']);
  const plain = count([]);
  const top = Object.entries(diarist).sort((a, b) => b[1] - a[1])[0][0];
  assert.equal(top, 'diary', JSON.stringify({ diarist, plain }));
  assert.ok(diarist.diary > plain.diary * 1.8, JSON.stringify({ diarist, plain }));
});

test('a frame with a bigger or smaller head is brought to the rest pose, other poses are left alone', () => {
  const rest = { head: 0.5, height: 0.75 };
  assert.equal(heads.headCorrection({ head: 0.5, height: 0.76 }, rest), 1);
  assert.equal(heads.headCorrection({ head: 0.51, height: 0.75 }, rest), 1, 'within 2.5%');
  assert.ok(
    Math.abs(heads.headCorrection({ head: 0.53, height: 0.75 }, rest) - 0.5 / 0.53) < 1e-9,
    'a 6% larger head shrinks',
  );
  assert.ok(heads.headCorrection({ head: 0.47, height: 0.74 }, rest) > 1, 'a smaller one grows');
  assert.equal(heads.headCorrection({ head: 0.7, height: 0.5 }, rest), 1, 'sitting or lying is another pose');
  assert.equal(heads.headCorrection({ head: 0.3, height: 0.75 }, rest), 1.1, 'never more than 10%');
  assert.equal(heads.headCorrection(null, rest), 1);
});
