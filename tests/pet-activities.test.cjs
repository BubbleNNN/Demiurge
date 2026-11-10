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
  )(result, (name) =>
    name.endsWith('.json')
      ? require(path.resolve(path.dirname(file), name))
      : load(path.resolve(path.dirname(file), name + '.ts')),
  );
  return result;
}
const { newActivityPlayback, advanceActivityPlayback } = load('src/animation/activities.ts');
const { supportsAction } = load('src/artwork.ts');
const { availableActions } = require('../electron/persona.cjs');
const { motionRecipe } = require('../electron/pet-recipes.cjs');
const { packFrames } = require('../electron/pet-frames.cjs');
const { validateAnimation, parseAseprite } = require('../electron/sprites.cjs');
const f = require('./fixtures/pet-images.cjs');
const packed = packFrames(
  f.url(f.image()),
  { read: f.url(f.image(true, { frames: 8 })), gaming: f.url(f.image(true, { frames: 8 })) },
  'sticker',
  f.codec,
);
const animation = packed.sprite;
const play = (s, target, t, key = 0, paused = false, interrupt = false) =>
  advanceActivityPlayback(s, animation, target, t, key, paused, interrupt);

test('activities always generate eight poses and retain enter, loop and exit clips through validation', () => {
  for (const action of ['read', 'gaming']) {
    assert.equal(motionRecipe(action, { frameCount: 4 }).count, 8);
    assert.equal(motionRecipe(action).size, '1536x1024');
    assert.equal(animation.clips[action].loop, true);
    assert.equal(animation.clips['enter_' + action].loop, false);
    assert.equal(animation.clips['exit_' + action].loop, false);
  }
  assert.equal(animation.frames.length, 17);
  assert.deepEqual(validateAnimation(animation), animation);
  assert.deepEqual(animation.clips.read.frames, [4, 5, 6, 5]);
  assert.deepEqual(animation.clips.enter_read.frames, [1, 2, 3, 4]);
  assert.deepEqual(animation.clips.exit_read.frames, [6, 7, 8, 1]);
});
test('enter then sustained loop then exit returns to neutral without replaying entrance on each cycle', () => {
  const s = newActivityPlayback();
  assert.equal(play(s, 'read', 0).clip, 'enter_read');
  assert.equal(play(s, 'read', 1360).clip, 'read');
  assert.equal(play(s, 'read', 15000).clip, 'read');
  assert.equal(play(s, 'idle', 15001).clip, 'exit_read');
  assert.equal(play(s, 'idle', 16361), null);
  assert.equal(s.current, 'idle');
});
test('a finished one-shot gesture hands back to the timeline instead of holding its last pose', () => {
  const gesture = {
    frames: [{}, {}, {}],
    clips: {
      idle: { frames: [0], loop: true },
      wave: { frames: [0, 1, 2, 0], durations: [100, 180, 220, 160], loop: false },
      drag: { frames: [1, 2], durations: [320, 320], loop: true },
    },
  };
  const s = newActivityPlayback();
  assert.deepEqual(advanceActivityPlayback(s, gesture, 'wave', 0, 1), { frame: 0, clip: 'wave' });
  assert.deepEqual(advanceActivityPlayback(s, gesture, 'wave', 200, 1), { frame: 1, clip: 'wave' });
  // The wave lasts 660 ms; afterwards the ordinary timeline (idle, blink, talk) takes over.
  assert.equal(advanceActivityPlayback(s, gesture, 'wave', 660, 1), null);
  assert.equal(advanceActivityPlayback(s, gesture, 'wave', 5000, 1), null);
  // Replaying the same gesture starts it again.
  assert.equal(advanceActivityPlayback(s, gesture, 'wave', 6000, 2).clip, 'wave');
  // Looping clips keep playing for as long as they are requested.
  const d = newActivityPlayback();
  assert.equal(advanceActivityPlayback(d, gesture, 'drag', 0, 1).clip, 'drag');
  assert.equal(advanceActivityPlayback(d, gesture, 'drag', 9000, 1).clip, 'drag');
});
test('rapid switches finish current authored segment and keep only the latest requested activity', () => {
  const s = newActivityPlayback();
  const first = play(s, 'read', 0);
  assert.equal(play(s, 'gaming', 100, 1).clip, first.clip);
  assert.equal(play(s, 'idle', 150, 2).clip, first.clip);
  assert.equal(play(s, 'gaming', 1360, 3).clip, 'exit_read');
  assert.equal(play(s, 'gaming', 2720, 3).clip, 'enter_gaming');
  assert.equal(play(s, 'gaming', 4080, 3).clip, 'gaming');
});
test('speech interrupts immediately; reduced motion settles on an activity frame without transitions', () => {
  const s = newActivityPlayback();
  play(s, 'read', 0);
  assert.equal(play(s, 'idle', 100, 1, false, true), null);
  assert.equal(s.segment, undefined);
  assert.equal(s.current, 'idle');
  const reduced = play(s, 'gaming', 200, 2, true);
  assert.equal(reduced.clip, 'gaming');
  assert.equal(reduced.frame, animation.clips.gaming.frames[0]);
  assert.equal(s.segment, undefined);
  assert.equal(play(s, 'idle', 300, 3, true), null);
});
test('missing transitions use actual existing loops and legacy skins do not gain fictitious activity support', () => {
  const loopOnly = { ...animation, clips: { idle: animation.clips.idle, read: animation.clips.read } };
  const s = newActivityPlayback();
  assert.equal(advanceActivityPlayback(s, loopOnly, 'read', 0, 0).clip, 'read');
  assert.equal(advanceActivityPlayback(s, loopOnly, 'idle', 10, 1), null);
  for (const skin of [
    { kind: 'vrm' },
    { kind: 'image' },
    { kind: 'image', sprite: { clips: { idle: { frames: [0] } } } },
  ]) {
    assert.equal(supportsAction(skin, 'read'), false);
    assert.equal(availableActions(skin).includes('read'), false);
  }
  assert.equal(supportsAction({ sprite: animation }, 'read'), true);
  assert.ok(availableActions({ sprite: animation }).includes('gaming'));
});
test('Aseprite import preserves activity loops and one-shot transition tags', () => {
  const { animation: imported } = parseAseprite({
    frames: Array.from({ length: 4 }, (_, i) => ({
      frame: { x: i * 32, y: 0, w: 32, h: 32 },
      duration: 200,
    })),
    meta: {
      image: 'atlas.png',
      frameTags: [
        { name: 'read', from: 1, to: 3 },
        { name: 'enter_read', from: 0, to: 1 },
      ],
    },
  });
  assert.equal(imported.clips.read.loop, true);
  assert.equal(imported.clips.enter_read.loop, false);
});
test('she turns into a walk before she moves, and comes in from off screen already walking', () => {
  const { readyToMove } = load('src/animation/activities.ts');
  // The shape of a generated pack: a turn into each walk (and back out), sitting with its own.
  const turn = [280, 400, 400, 280];
  const walking = {
    width: 4,
    height: 4,
    frames: Array.from({ length: 24 }, () => ({ rect: [0, 0, 4, 4], duration: 140 })),
    clips: {
      idle: { frames: [0], loop: true },
      walk_right: { frames: [1, 2, 3, 4], durations: [180, 180, 180, 180], loop: true },
      enter_walk_right: { frames: [5, 6, 7, 8], durations: turn, loop: false },
      exit_walk_right: { frames: [9, 10, 11, 12], durations: turn, loop: false },
      sit: { frames: [13, 14], loop: true },
      enter_sit: { frames: [15, 16, 17, 18], durations: turn, loop: false },
      exit_sit: { frames: [19, 20, 21, 22], durations: turn, loop: false },
    },
  };
  const at = (s, target, t, interrupt = false) =>
    advanceActivityPlayback(s, walking, target, t, 0, false, interrupt)?.clip ?? 'idle';
  // Standing: the turn plays for its whole length, and she may not move until the walk shows.
  const s = newActivityPlayback();
  for (let t = 0; t < 1360; t += 40) {
    const clip = at(s, 'walk_right', t);
    assert.equal(clip, 'enter_walk_right');
    assert.equal(readyToMove(clip, 'walk_right', t), false, `still turning at ${t} ms`);
  }
  assert.equal(at(s, 'walk_right', 1360), 'walk_right');
  assert.equal(readyToMove('walk_right', 'walk_right', 1360), true);
  // Sitting: she gets up, then turns, and only then sets off.
  const seated = newActivityPlayback();
  at(seated, 'sit', 0);
  at(seated, 'sit', 2000);
  const order = [];
  for (let t = 2000; t <= 2000 + 2800; t += 40) {
    const clip = at(seated, 'walk_right', t);
    if (order.at(-1) !== clip) order.push(clip);
    if (clip !== 'walk_right') assert.equal(readyToMove(clip, 'walk_right', t - 2000), false);
  }
  assert.deepEqual(order, ['exit_sit', 'enter_walk_right', 'walk_right']);
  // Out of sight, the walk starts at once.
  const entering = newActivityPlayback();
  at(entering, 'sit', 0);
  assert.equal(at(entering, 'walk_right', 3000, true), 'walk_right');
  assert.equal(at(entering, 'walk_right', 3040), 'walk_right');
  // A look without that walk plays its rest pose: she goes after a moment rather than waiting.
  assert.equal(readyToMove('idle', 'walk_left', 100), false);
  assert.equal(readyToMove('idle', 'walk_left', 400), true);
  assert.equal(readyToMove(undefined, 'walk_left', 0), true);
  // A turn that never ends is not waited for.
  assert.equal(readyToMove('enter_walk_left', 'walk_left', 6000), true);
});
