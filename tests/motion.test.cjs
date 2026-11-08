'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function load(file) {
  const exports = {};
  new Function(
    'exports',
    'require',
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
  )(exports, require('node:module').createRequire(require('node:path').resolve(file)));
  return exports;
}
const { initialState, migrateState } = load('src/initial.ts');
const { pixelAnimation, spriteAnimation, supportsAction, supportsEmotion } = load('src/artwork.ts');
const { clipFrame, clipDuration, selectSpriteFrame } = load('src/animation/timeline.ts');
const { validateState } = require('../electron/store.cjs');
const input = {
  time: 0,
  age: 0,
  action: 'idle',
  emotion: 'neutral',
  talking: false,
  audioDriven: false,
  mouth: 0,
  paused: false,
};
test('catalog includes newly drawn original style and retains existing active artwork without overwriting custom work', () => {
  const fresh = initialState();
  assert.equal(fresh.skins.length, 7);
  assert.equal(new Set(fresh.skins.map((s) => s.style)).size, 7);
  assert.equal(validateState(fresh).activeSkinId, 'cyrene-original-v1');
  for (const skin of fresh.skins) {
    const png = fs.readFileSync(`public/art/${skin.builtin}.png`);
    assert.equal(png[25], 6, 'RGBA ' + skin.id);
  }
  const old = {
    ...fresh,
    skins: [{ ...fresh.skins[0], id: 'cyrene-anime-v4', builtin: 'cyrene-anime-v4' }],
    activeSkinId: 'cyrene-anime-v4',
  };
  const migrated = migrateState(old);
  assert.equal(migrated.activeSkinId, 'cyrene-anime-v5');
  assert.equal(migrateState(migrated), migrated);
  assert.equal(migrateState({ ...old, activeSkinId: 'my-custom-art' }).activeSkinId, 'my-custom-art');
});
test('authored frame timings handle boundaries, loops, holds and finite recovery', () => {
  const clip = pixelAnimation.clips.wave;
  assert.equal(clipFrame(pixelAnimation, clip, 0), 0);
  assert.equal(clipFrame(pixelAnimation, clip, 180), 4);
  assert.equal(clipFrame(pixelAnimation, clip, 340), 5);
  assert.equal(clipFrame(pixelAnimation, clip, 10000), 0);
  const end = selectSpriteFrame(pixelAnimation, {
    ...input,
    action: 'wave',
    age: clipDuration(pixelAnimation, clip),
  });
  assert.equal(end.clip, 'idle');
  const talk = pixelAnimation.clips.talk;
  assert.equal(clipFrame(pixelAnimation, talk, 120), 2);
  assert.equal(clipFrame(pixelAnimation, talk, clipDuration(pixelAnimation, talk) + 120), 2);
});
test('speech silence, gesture priority and reduced motion select complete frames safely', () => {
  assert.equal(
    selectSpriteFrame(pixelAnimation, { ...input, talking: true, audioDriven: true, mouth: 0, time: 130 })
      .frame,
    0,
  );
  assert.equal(
    selectSpriteFrame(pixelAnimation, { ...input, talking: true, audioDriven: true, mouth: 0.4, time: 130 })
      .frame,
    2,
  );
  assert.equal(
    selectSpriteFrame(pixelAnimation, { ...input, talking: true, action: 'wave', age: 340, time: 130 }).clip,
    'wave',
  );
  assert.equal(
    selectSpriteFrame(pixelAnimation, { ...input, talking: true, action: 'wave', age: 340, paused: true })
      .frame,
    0,
  );
  assert.equal(selectSpriteFrame(pixelAnimation, { ...input, action: 'sleep', paused: true }).frame, 1);
  assert.equal(selectSpriteFrame(pixelAnimation, { ...input, action: 'nod' }).clip, 'idle');
});
test('only available expressions and actions are advertised', () => {
  const fresh = initialState();
  const pixel = fresh.skins.find((s) => s.style === '8bit');
  assert.equal(supportsAction(pixel, 'wave'), true);
  assert.equal(supportsAction(pixel, 'nod'), true);
  assert.equal(supportsEmotion(pixel, 'happy'), true);
  assert.equal(supportsEmotion(pixel, 'sad'), false);
  assert.equal(supportsAction(fresh.skins[0], 'wave'), true);
  assert.equal(supportsAction(pixel, 'shake'), false);
  assert.equal(supportsAction(pixel, 'bounce'), false);
  assert.equal(
    supportsAction(
      { kind: 'live2d', model: { motions: { Greeting: 2 }, motionMap: { wave: 'Greeting' } } },
      'wave',
    ),
    true,
  );
});
test('each retained artwork plays breathing during neutral idle, recovers from gestures and honors explicit user art', () => {
  const pack = require('../shared/cyrene-motion-pack.json');
  const { availableActions } = require('../electron/persona.cjs');
  const { createHash } = require('node:crypto');
  for (const skin of initialState().skins) {
    const animation = spriteAnimation(skin);
    const entry = pack.entries.find((entry) => entry.builtin === skin.builtin);
    assert.ok(animation, skin.style);
    const bytes = fs.readFileSync('public/art/' + entry.file);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    assert.deepEqual(availableActions(skin), ['idle', 'nod', 'sleep', 'wave']);
    assert.equal(
      selectSpriteFrame(animation, { ...input, time: 2000 }).frame,
      3,
      skin.style + ' neutral breathing',
    );
    assert.equal(selectSpriteFrame(animation, { ...input, time: 2000, paused: true }).frame, 0);
    assert.equal(selectSpriteFrame(animation, { ...input, time: 3200 }).clip, 'blink');
    for (const action of ['wave', 'nod']) {
      assert.equal(selectSpriteFrame(animation, { ...input, action, age: 250 }).clip, action);
      assert.equal(
        selectSpriteFrame(animation, {
          ...input,
          action,
          age: clipDuration(animation, animation.clips[action]),
        }).clip,
        'idle',
      );
    }
    const custom = { ...skin, images: { neutral: 'user-approved-art' } };
    assert.equal(
      spriteAnimation(custom),
      undefined,
      'Custom artwork must not receive incompatible bundled frames',
    );
    assert.deepEqual(availableActions(custom), ['idle']);
  }
});
test('authored sleep sequences retain their frame timing and hold still with motion disabled', () => {
  const animation = {
    ...pixelAnimation,
    clips: { ...pixelAnimation.clips, sleep: { frames: [0, 1], durations: [200, 300], loop: true } },
  };
  assert.equal(selectSpriteFrame(animation, { ...input, action: 'sleep', age: 250 }).frame, 1);
  assert.equal(selectSpriteFrame(animation, { ...input, action: 'sleep', age: 500 }).frame, 0);
  assert.equal(selectSpriteFrame(animation, { ...input, action: 'sleep', age: 250, paused: true }).frame, 0);
});

test('explicit authored mouth poses follow audio opening, close on silence and keep gesture priority', () => {
  const animation = {
    ...pixelAnimation,
    mouthFrames: { closed: 0, small: 2, wide: 3 },
  };
  for (const [mouth, frame] of [
    [0, 0],
    [0.08, 0],
    [0.2, 2],
    [0.44, 2],
    [0.45, 3],
    [1, 3],
    [NaN, 0],
    [Infinity, 0],
  ]) {
    for (const time of [0, 130, 410, 10000])
      assert.equal(
        selectSpriteFrame(animation, { ...input, talking: true, audioDriven: true, mouth, time }).frame,
        frame,
      );
  }
  assert.equal(
    selectSpriteFrame(animation, {
      ...input,
      talking: true,
      audioDriven: true,
      mouth: 1,
      action: 'wave',
      age: 340,
    }).clip,
    'wave',
  );
  assert.equal(
    selectSpriteFrame(animation, { ...input, talking: true, audioDriven: true, mouth: 1, paused: true })
      .frame,
    0,
  );
  assert.equal(selectSpriteFrame(animation, { ...input, talking: true, time: 130 }).frame, 2);
});

test('packs that rested on the separately drawn still move their rest onto the blink sheet pose', () => {
  const { restOnMotionSheet } = load('src/initial.ts');
  const frame = (cell, page) => ({
    rect: [0, 0, 10, 10],
    duration: 140,
    offset: [0, 0],
    cell,
    ...(page ? { page } : {}),
  });
  // Frame 0: the approved still (a larger canvas); 1–3: blink sheet; 4–6: wave sheet.
  const pack = {
    width: 384,
    height: 512,
    frames: [
      frame([1063, 1417]),
      frame([400, 534]),
      frame([400, 534]),
      frame([400, 534]),
      frame([420, 559]),
      frame([420, 559]),
      frame([420, 559]),
    ],
    clips: {
      idle: { frames: [0], loop: true },
      neutral: { frames: [0], loop: true },
      blink: { frames: [0, 2, 3, 0], loop: false },
      wave: { frames: [0, 5, 6, 0], loop: false },
      talk: { frames: [0, 5, 6], loop: true },
    },
    mouthFrames: { closed: 0, small: 5, wide: 6 },
  };
  const moved = restOnMotionSheet(pack);
  assert.deepEqual(moved.clips.idle.frames, [1]);
  assert.deepEqual(moved.clips.neutral.frames, [1]);
  assert.deepEqual(moved.clips.blink.frames, [1, 2, 3, 1]);
  assert.deepEqual(moved.clips.wave.frames, [1, 5, 6, 1]);
  assert.deepEqual(moved.clips.talk.frames, [1, 5, 6]);
  assert.equal(moved.mouthFrames.closed, 1);
  assert.equal(moved.frames, pack.frames, 'the atlas is untouched');
  // Already moved, imported frame folders, a used or mismatched frame: left alone.
  assert.equal(restOnMotionSheet(moved), moved);
  for (const other of [
    { ...pack, clips: { ...pack.clips, blink: { frames: [1, 2, 3], loop: false } } },
    { ...pack, clips: { ...pack.clips, wave: { frames: [1, 5, 6, 0], loop: false } } },
    { ...pack, frames: pack.frames.map((f, i) => (i === 1 ? frame([700, 900]) : f)) },
    { ...pack, frames: pack.frames.map((f, i) => (i === 1 ? frame([400, 534], 1) : f)) },
  ])
    assert.equal(restOnMotionSheet(other), other);
  // Saved workspaces are moved once when loaded.
  const state = initialState();
  const skin = { ...state.skins[0], id: 'generated-rest', sprite: pack };
  const migrated = migrateState({ ...state, skins: [...state.skins, skin] });
  assert.deepEqual(migrated.skins.find((s) => s.id === 'generated-rest').sprite.clips.idle.frames, [1]);
  assert.equal(migrateState(migrated), migrated);
});
