'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  ts = require('typescript');
const { motionRecipe } = require('../electron/pet-recipes.cjs');
const { packFrames } = require('../electron/pet-frames.cjs');
const f = require('./fixtures/pet-images.cjs');
const { validateAnimation } = require('../electron/sprites.cjs');
function load(file) {
  const exports = {};
  new Function(
    'exports',
    'require',
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  )(exports, require);
  return exports;
}
const desktop = load('src/desktopLife.ts');
test('new desktop motion pipeline packs independent directions, carried pose, listening and physical sleep transitions', () => {
  const ids = ['walk_left', 'walk_right', 'walk_up', 'walk_down', 'drag', 'listen', 'sleep'];
  const sheets = Object.fromEntries(
    ids.map((id) => [id, f.url(f.image(true, { frames: motionRecipe(id, { transitionVersion: 2 }).count }))]),
  );
  const packed = packFrames(f.url(f.image()), sheets, 'sticker', f.codec, { transitionVersion: 2 });
  const a = validateAnimation(packed.sprite);
  assert.ok(a.clips.drag.loop);
  for (const id of ids.filter((x) => x !== 'drag')) {
    assert.ok(a.clips[id].loop);
    assert.equal(a.clips['enter_' + id].loop, false);
    assert.equal(a.clips['exit_' + id].loop, false);
    assert.ok(a.clips['exit_' + id].durations.every((x) => x >= 280));
  }
  assert.notDeepEqual(a.clips.walk_left.frames, a.clips.walk_right.frames);
  assert.equal(motionRecipe('sleep').count, 4);
  assert.equal(motionRecipe('sleep', { transitionVersion: 2 }).count, 8);
});
test('native placement uses global negative monitor coordinates and excludes covered destinations', () => {
  const scene = {
    bounds: { x: -900, y: 400, width: 280, height: 400 },
    area: { x: -1000, y: 0, width: 1000, height: 1000 },
    surfaces: [{ id: 'ledge', x: -900, y: 500, width: 600, height: 300 }],
    icons: [],
    supported: true,
  };
  const p = desktop.choosePlace(scene, { x: 140, y: 360 }, 'read');
  assert.equal(p.kind, 'perch');
  assert.ok(p.destination.x < 0);
  assert.equal(p.destination.y, 140);
  scene.surfaces.unshift({ id: 'cover', x: -1000, y: 0, width: 1000, height: 900 });
  assert.equal(desktop.choosePlace(scene, { x: 140, y: 360 }, 'read'), null);
  scene.surfaces = [];
  scene.icons = [{ id: 'icon', x: -500, y: 400, width: 64, height: 64 }];
  assert.equal(desktop.choosePlace(scene, { x: 140, y: 360 }, 'hide').kind, 'hide');
});
test('travel has bounded steps and ends exactly at its destination', () => {
  let b = { x: 0, y: 0, width: 280, height: 400 };
  const to = { x: 300, y: 150 };
  assert.ok(desktop.travelStep(b, to, 100).x <= 18);
  for (let i = 0; i < 100; i++) b = { ...b, ...desktop.travelStep(b, to, 0.05) };
  assert.equal(b.x, to.x);
  assert.equal(b.y, to.y);
  assert.ok(b.arrived);
});
