'use strict';
// Full-size synthetic pixels exercise packing budgets; no image API or art-quality claim.
const { app, nativeImage } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const f = require('../tests/fixtures/pet-images.cjs');
const { stageSheet } = require('../tests/fixtures/pet-stages.cjs');
const { packFrames } = require('../electron/pet-frames.cjs');
const { motionRecipe } = require('../electron/pet-recipes.cjs');
const motions = require('../shared/pet-motions.json');
const root = path.resolve(__dirname, '../.local/aligned-atlas-check');
app.whenReady().then(() => {
  try {
    const codec = {
      decode(bytes) {
        const im = nativeImage.createFromBuffer(bytes);
        return { ...im.getSize(), bitmap: im.toBitmap() };
      },
      encode(bitmap, width, height) {
        return nativeImage.createFromBitmap(bitmap, { width, height }).toPNG();
      },
    };
    const enlarge = (bytes) =>
      f.url(
        nativeImage.createFromBuffer(bytes).resize({ width: 1024, height: 1024, quality: 'good' }).toPNG(),
      );
    const sheets = Object.fromEntries(
      motions.map((m) => [
        m.id,
        motionRecipe(m.id, { transitionVersion: 3 }).count === 12
          ? f.url(stageSheet({ size: 1024, sleep: m.id === 'sleep' }))
          : enlarge(f.image(true)),
      ]),
    );
    const result = packFrames(enlarge(f.image()), sheets, 'sticker', codec, { transitionVersion: 3 });
    assert.equal(result.sprite.frames.length, 177);
    for (const id of [
      'walk_left',
      'walk_right',
      'walk_up',
      'walk_down',
      'read',
      'gaming',
      'sleep',
      'office',
    ]) {
      assert.equal(result.sprite.clips[id].frames.length, 4);
      assert.ok(result.sprite.clips['enter_' + id]);
      assert.ok(result.sprite.clips['exit_' + id]);
    }
    // Each frame's renderer canvas is its `cell`; the stored rect holds only the visible pixels.
    const pixels = result.sprite.frames.reduce((s, f) => s + f.cell[0] * f.cell[1], 0);
    assert.ok(pixels <= 32 * 1024 * 1024, `renderer needs ${pixels} pixels`);
    assert.ok(!result.warnings.some((w) => w.includes('% 保存')));
    fs.mkdirSync(root, { recursive: true });
    const report = {
      passed: true,
      frames: 177,
      motions: motions.length,
      decodedPixels: pixels,
      paidRequests: 0,
      warnings: result.warnings,
    };
    fs.writeFileSync(path.join(root, 'checks.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    app.exit(0);
  } catch (e) {
    console.error(e);
    app.exit(1);
  }
});
