'use strict';
// Native bitmap decoding/resize/composition only. No network, credentials or generation.
const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { fitImageReferenceBudget } = require('../electron/image-reference-budget.cjs');
const fixture = require('../tests/fixtures/pet-images.cjs');
const dir = path.resolve(__dirname, '../.local/reference-budget-' + randomUUID());
fs.mkdirSync(dir, { recursive: true });
app.setPath('userData', dir);
app
  .whenReady()
  .then(() => {
    const base = nativeImage.createFromBuffer(fixture.image());
    const sources = Array.from({ length: 9 }, (_, i) => ({
      name: `reference-${i + 1}.${i === 5 ? 'jpg' : 'png'}`,
      bytes: i === 5 ? base.resize({ width: 1600, height: 2400 }).toJPEG(90) : base.toPNG(),
    }));
    const result = fitImageReferenceBudget(sources);
    assert.equal(result.sources.length, 5);
    for (let i = 0; i < 4; i++) assert.deepEqual(result.sources[i].bytes, sources[i].bytes);
    const board = nativeImage.createFromBuffer(result.sources[4].bytes);
    assert.deepEqual(board.getSize(), { width: 2048, height: 3192 });
    const pixels = board.toBitmap(),
      width = board.getSize().width;
    for (let i = 0; i < 5; i++) {
      const x = (i % 2) * 1024 + 512,
        y = Math.floor(i / 2) * 1064 + 40 + 512;
      assert.ok(pixels[(y * width + x) * 4 + 3] > 0, `source ${i + 5} is present`);
      assert.ok(result.mapping.includes(`source image ${i + 5} = attachment 5`));
    }
    fs.writeFileSync(path.join(dir, 'reference-board.png'), result.sources[4].bytes);
    console.log(
      'PASS: native PNG/JPEG decoding, portrait resize without cropping, nine sources in five paths, original four unchanged, transparent board and stable source numbering. No model requests.',
    );
    console.log('Artifacts:', dir);
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
