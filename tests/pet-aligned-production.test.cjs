'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { motionRecipe, motionClip, activityTransitions } = require('../electron/pet-recipes.cjs');
const { packFrames, inspectSheet } = require('../electron/pet-frames.cjs');
const { layoutFramesFlexible } = require('../electron/atlas-layout.cjs');
const motions = require('../shared/pet-motions.json');
const f = require('./fixtures/pet-images.cjs');
const { stageSheet } = require('./fixtures/pet-stages.cjs');
const options = { transitionVersion: 3 };

test('aligned activities allocate separate four-frame entrance, loop and exit; legacy jobs keep their layout', () => {
  for (const motion of motions.filter((m) => m.activity || m.staged)) {
    const r = motionRecipe(motion.id, options);
    assert.equal(r.count, 12);
    assert.equal(r.poses.length, 12);
    assert.equal(r.size, '1024x1024');
    assert.equal(r.columns * r.rows, 12);
    const indices = Array.from({ length: 12 }, (_, i) => i + 1);
    assert.deepEqual(motionClip(motion.id, indices, options).frames, [5, 6, 7, 8]);
    const transitions = activityTransitions(motion.id, indices, options);
    assert.deepEqual(transitions['enter_' + motion.id].frames, [1, 2, 3, 4]);
    assert.deepEqual(transitions['exit_' + motion.id].frames, [9, 10, 11, 12]);
    assert.equal(motionRecipe(motion.id, { transitionVersion: 2 }).count, 8);
  }
  assert.equal(motionRecipe('sleep').count, 4);
  for (const id of ['walk_left', 'walk_right', 'walk_up', 'walk_down']) {
    const poses = motionRecipe(id, options).poses.slice(4, 8).join(' ');
    assert.match(poses, /first passing pose/);
    assert.match(poses, /second passing pose/);
  }
});

test('a moving entrance cannot hide a frozen daily or locomotion loop', () => {
  const frozen = f.url(stageSheet({ frozenLoop: true }));
  for (const id of ['read', 'walk_right'])
    assert.throws(() => inspectSheet(frozen, f.codec, id, options), /循环段/);
  assert.equal(inspectSheet(f.url(stageSheet()), f.codec, 'walk_left', options).distinctFrames, 4);
});

test('curled sleep is retained at authored height and its sleeping alias uses a loop frame', () => {
  const master = f.url(f.image());
  const sheet = f.url(stageSheet({ sleep: true }));
  const result = packFrames(master, { sleep: sheet }, 'sticker', f.codec, options);
  assert.equal(result.sprite.frames.length, 13);
  assert.deepEqual(result.sprite.clips.sleep.frames, [5, 6, 7, 8]);
  assert.deepEqual(result.sprite.clips.sleepy.frames, [5]);
  const decoded = f.decode(Buffer.from(result.image.split(',')[1], 'base64'));
  const height = (i) => {
    const [x, y, w, h] = result.sprite.frames[i].rect;
    let lo = h,
      hi = 0;
    for (let yy = 0; yy < h; yy++)
      for (let xx = 0; xx < w; xx++)
        if (decoded.bitmap[((y + yy) * decoded.width + x + xx) * 4 + 3] >= 24) {
          lo = Math.min(lo, yy);
          hi = Math.max(hi, yy);
        }
    return (hi - lo + 1) / h;
  };
  assert.ok(height(5) < height(1) * 0.5, 'sleep should stay curled, not stretched to standing height');
});

test('fixed registration preserves foot changes without shifting a stationary head sideways', () => {
  const png = stageSheet();
  const image = f.decode(png);
  const cw = image.width / 4,
    ch = image.height / 3;
  // Add a wide trailing foot on frame 6. The head and canvas do not move.
  for (let y = 100; y < 109; y++)
    for (let x = 19; x < 42; x++) {
      const i = ((ch + y) * image.width + cw + x) * 4;
      image.bitmap[i] = 75;
      image.bitmap[i + 1] = 50;
      image.bitmap[i + 2] = 120;
      image.bitmap[i + 3] = 255;
    }
  const result = packFrames(
    f.url(f.image()),
    { walk_right: f.url(f.encode(image.bitmap, image.width, image.height)) },
    'sticker',
    f.codec,
    options,
  );
  const atlas = f.decode(Buffer.from(result.image.split(',')[1], 'base64'));
  const headX = (index) => {
    const [x, y, w, h] = result.sprite.frames[index].rect;
    let sum = 0,
      count = 0;
    for (let yy = 0; yy < h; yy++)
      for (let xx = 0; xx < w; xx++) {
        const i = ((y + yy) * atlas.width + x + xx) * 4;
        if (
          atlas.bitmap[i] === 210 &&
          atlas.bitmap[i + 1] === 115 &&
          atlas.bitmap[i + 2] === 160 &&
          atlas.bitmap[i + 3] === 255
        ) {
          sum += xx;
          count++;
        }
      }
    return sum / count;
  };
  assert.equal(headX(5), headX(6));
});

test('aligned atlas can use the renderer budget without lowering pixel density', () => {
  const sizes = Array.from({ length: 177 }, () => ({ width: 320, height: 420 }));
  assert.throws(() => layoutFramesFlexible(sizes), /图集超过/);
  const layout = layoutFramesFlexible(sizes, 32 * 1024 * 1024);
  assert.ok(layout.width * layout.height <= 32 * 1024 * 1024);
  assert.ok(layout.rects.every((r) => r[2] === 320 && r[3] === 420));
});

test('aligned packing preserves source RGBA samples instead of interpolating the frame edges', () => {
  const {splitSheet}=require('../electron/pet-frames.cjs');
  const png=f.url(stageSheet());
  const {frames}=splitSheet(png,f.codec,'read',options);
  const result=packFrames(f.url(f.image()),{read:png},'sticker',f.codec,options);
  const atlas=f.decode(Buffer.from(result.image.split(',')[1],'base64'));
  const histogram=(image,rect)=>{
    const [x,y,w,h]=rect, counts={};
    for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++) {
      const i=((y+yy)*image.width+x+xx)*4;
      if(image.bitmap[i+3]===0)continue;
      const key=image.bitmap.subarray(i,i+4).toString('hex');
      counts[key]=(counts[key]||0)+1;
    }
    return counts;
  };
  frames.forEach((frame,i)=>assert.deepEqual(histogram(atlas,result.sprite.frames[i+1].rect),histogram(frame,[0,0,frame.width,frame.height])));
});
