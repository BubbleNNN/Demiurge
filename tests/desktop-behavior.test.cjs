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
const b = load(path.resolve(__dirname, '../src/desktopBehavior.ts'));
const area = { x: 0, y: 25, width: 1440, height: 850 };
const body = { foot: { x: 170, y: 420 }, width: 220, height: 300 };
const scene = (surfaces = [], icons = []) => ({
  bounds: { x: 0, y: 0, width: 340, height: 440 },
  area,
  surfaces,
  icons,
  supported: true,
});

test('the floor, uncovered window tops and free icons are ledges; covered parts and cramped tops are not', () => {
  const front = { id: 'front', x: 300, y: 500, width: 600, height: 300 };
  const back = { id: 'back', x: 100, y: 550, width: 1100, height: 250 };
  const high = { id: 'high', x: 900, y: 120, width: 400, height: 300 }; // no headroom above it
  const icon = { id: 'i1', x: 1300, y: 200, width: 64, height: 64 };
  const hidden = { id: 'i2', x: 400, y: 600, width: 64, height: 64 };
  const all = b.ledges(scene([front, back, high], [icon, hidden]), body);
  assert.deepEqual(
    all.map((l) => l.kind),
    ['floor', 'window', 'window', 'window'],
  );
  const backPieces = all.filter((l) => l.owner === 'back').map((l) => [l.x, l.x + l.width]);
  assert.deepEqual(
    backPieces,
    [
      [100, 300],
      [900, 1200],
    ],
    'the part under the front window is not walkable',
  );
  assert.equal(all.find((l) => l.kind === 'floor').y, 855, 'feet reach 20 points above the work area bottom');
  assert.ok(!all.some((l) => l.owner === 'high'), 'no room for her above a window near the top');
  assert.ok(!all.some((l) => l.kind === 'icon'), 'icon tops near the top or under windows are not ledges');
  const lower = b.ledges(scene([], [{ id: 'i3', x: 1300, y: 600, width: 64, height: 64 }]), body);
  assert.ok(lower.some((l) => l.kind === 'icon'));
});

test('what is under her: the nearest ledge at or below her feet', () => {
  const all = b.ledges(scene([{ id: 'w', x: 200, y: 600, width: 500, height: 200 }]), body);
  assert.equal(b.supportBelow(all, { x: 400, y: 300 }).kind, 'window');
  assert.equal(b.supportBelow(all, { x: 400, y: 600 }).kind, 'window');
  assert.equal(b.supportBelow(all, { x: 900, y: 300 }).kind, 'floor');
  assert.equal(
    b.supportBelow(all, { x: 400, y: 700 }).kind,
    'floor',
    'below a window top she falls to the floor',
  );
  assert.equal(b.supportBelow(all, { x: 400, y: 700 }).y, 855);
  assert.ok(b.standingOn(all[1], { x: 400, y: 603 }));
  assert.ok(!b.standingOn(all[1], { x: 400, y: 560 }));
});

test('temperament shapes what she does: lively characters move, calm ones stay, curious ones climb', () => {
  const windows = [{ id: 'w', x: 200, y: 600, width: 500, height: 200 }];
  const all = b.ledges(scene(windows), body);
  const count = (temperament, runs = 400) => {
    const kinds = {};
    let seed = 1;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < runs; i++) {
      const plan = b.nextPlan({
        scene: scene(windows),
        ledges: all,
        body,
        feet: { x: 1000, y: 855 },
        current: all[0],
        temperament,
        hour: 15,
        userIdle: 0,
        focusChanged: false,
        tired: false,
        random,
      });
      kinds[plan.kind] = (kinds[plan.kind] || 0) + 1;
    }
    return kinds;
  };
  const calm = count({ energy: 10, affection: 50, curiosity: 10 });
  const lively = count({ energy: 95, affection: 50, curiosity: 90 });
  assert.ok(calm.stay > lively.stay, `calm stays more: ${JSON.stringify(calm)} vs ${JSON.stringify(lively)}`);
  assert.ok((lively.climb || 0) > (calm.climb || 0), 'curious climbs more');
  assert.ok((lively.stroll || 0) > (calm.stroll || 0), 'lively strolls more');
});

test('plans are always reachable: climbs start from her ledge, peeks hide part of her behind a window, naps stay put', () => {
  const window = { id: 'w', x: 500, y: 300, width: 500, height: 520 };
  const all = b.ledges(scene([window]), body);
  const floor = all[0];
  const input = {
    scene: scene([window]),
    ledges: all,
    body,
    feet: { x: 200, y: 855 },
    current: floor,
    temperament: { energy: 50, affection: 90, curiosity: 90 },
    hour: 15,
    userIdle: 0,
    focusChanged: false,
    tired: false,
    random: () => 0.1,
  };
  const peek = b.peekPlan(input, floor);
  assert.equal(peek.kind, 'peek');
  assert.equal(peek.to.y, floor.y);
  assert.ok(Math.abs(peek.to.x - 500) < body.width / 2, 'stands across the window edge');
  const nap = b.nextPlan({ ...input, tired: true, random: () => 0.99 });
  assert.ok(['nap', 'stay', 'climb', 'stroll', 'peek'].includes(nap.kind));
  for (let i = 0; i < 50; i++) {
    let seed = i + 3;
    const plan = b.nextPlan({ ...input, random: () => (seed = (seed * 48271) % 2147483647) / 2147483647 });
    if (plan.kind === 'stay') continue;
    const target = plan.ledge;
    assert.ok(
      plan.to.x >= target.x && plan.to.x <= target.x + target.width,
      `${plan.kind} lands on its ledge`,
    );
    assert.equal(plan.to.y, target.y);
  }
});

test('a jump arcs above both ends and lands exactly on the target', () => {
  const path = b.hopPath({ x: 100, y: 875 }, { x: 400, y: 600 });
  const end = path.at(path.duration);
  assert.deepEqual([Math.round(end.x), Math.round(end.y)], [400, 600]);
  const middle = path.at(path.duration / 2);
  assert.ok(middle.y < 600, 'rises above the higher end');
  assert.ok(b.walkSpeed({ energy: 90 }) > b.walkSpeed({ energy: 10 }));
  assert.ok(b.restBetween({ energy: 10 }, () => 0.5) > b.restBetween({ energy: 90 }, () => 0.5));
});

test('put down off any ledge she stays there: no falling, only naps and watching where she is', () => {
  const windows = [{ id: 'w', x: 200, y: 600, width: 500, height: 200 }];
  const all = b.ledges(scene(windows), body);
  const feet = { x: 900, y: 400 }; // in the middle of the screen, above nothing in particular
  assert.equal(b.standingOn(b.supportBelow(all, feet), feet), false);
  for (let i = 0; i < 200; i++) {
    let seed = i + 11;
    const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    for (const extra of [{}, { tired: true }, { focusChanged: true }]) {
      const plan = b.nextPlan({
        scene: scene(windows),
        ledges: all,
        body,
        feet,
        current: null,
        temperament: { energy: 95, affection: 95, curiosity: 95 },
        hour: 15,
        userIdle: 0,
        focusChanged: false,
        tired: false,
        random,
        ...extra,
      });
      assert.ok(['stay', 'nap', 'watch'].includes(plan.kind), plan.kind);
      if (plan.kind !== 'stay') assert.deepEqual(plan.to, feet, 'she does it where she is');
    }
  }
});

test('on a window top she naps and watches where she is, and peeks only from the floor', () => {
  const windows = [
    { id: 'front', x: 900, y: 200, width: 400, height: 600 },
    { id: 'w', x: 100, y: 600, width: 600, height: 200 },
  ];
  const all = b.ledges(scene(windows), body);
  const top = all.find((l) => l.owner === 'w');
  const feet = { x: 400, y: top.y };
  const kinds = new Set();
  for (let i = 0; i < 300; i++) {
    let seed = i + 5;
    const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    const plan = b.nextPlan({
      scene: scene(windows),
      ledges: all,
      body,
      feet,
      current: top,
      temperament: { energy: 50, affection: 90, curiosity: 90 },
      hour: 15,
      userIdle: 0,
      focusChanged: true,
      tired: i % 2 === 0,
      random,
    });
    kinds.add(plan.kind);
    assert.notEqual(plan.kind, 'peek');
    if (plan.kind === 'nap' || plan.kind === 'watch') assert.deepEqual(plan.to, feet);
  }
  assert.ok(kinds.has('nap') && kinds.has('watch'));
});

test('the pet window may hang past the work area by its bands: the floor is the bottom edge and high window tops are ledges', () => {
  const margins = { top: 108, bottom: 108 };
  const tall = {
    bounds: { x: 0, y: 0, width: 340, height: 540 },
    area,
    surfaces: [{ id: 'high', x: 900, y: 380, width: 400, height: 300 }],
    icons: [],
    supported: true,
    margins,
  };
  const fig = { foot: { x: 170, y: 425 }, width: 220, height: 300 };
  const all = b.ledges(tall, fig);
  // Feet 425 into a 540 window whose lower 108 points may hang past the bottom: 7 points of figure below the feet.
  assert.equal(all.find((l) => l.kind === 'floor').y, area.y + area.height - 7);
  // Her figure is 317 points tall above her feet; the band above it may hang past the menu bar.
  assert.ok(
    all.some((l) => l.owner === 'high'),
    'a window top 355 points below the menu bar has room for her',
  );
  const fixed = b.ledges({ ...tall, margins: undefined }, fig);
  assert.ok(
    !fixed.some((l) => l.owner === 'high'),
    'without hanging bands the whole window would have to fit',
  );
});
