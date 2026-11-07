'use strict';
// Unpack existing neutral atlas cells; preserve authored pixels and design.
const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const destination = path.join(root, 'artifacts/animation/cyrene-v1/masters');
app
  .whenReady()
  .then(() => {
    fs.mkdirSync(destination, { recursive: true });
    const rows = [
      ['original', 'cyrene-original-v1', null],
      ['anime', 'cyrene-anime-v5', null],
      ['chibi', 'cyrene-chibi-v4', [0, 0, 512, 768]],
      ['powerpuff', 'cyrene-powerpuff-v1', null],
      ['pixel', 'cyrene-pixel-v4', [0, 0, 512, 768]],
      ['8bit', 'cyrene-8bit-v5', [0, 0, 384, 512]],
      ['3d', 'cyrene-3d-v5', null],
    ];
    const result = rows.map(([style, builtin, rect]) => {
      const source = path.join(root, 'public/art', builtin + '.png');
      const target = path.join(destination, style + '.png');
      if (rect) {
        const [x, y, width, height] = rect;
        fs.writeFileSync(target, nativeImage.createFromPath(source).crop({ x, y, width, height }).toPNG());
      } else fs.copyFileSync(source, target);
      return { style, builtin, reference: target, original: source, unpackedNeutralCell: Boolean(rect) };
    });
    fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result));
    app.exit(0);
  })
  .catch((error) => {
    console.error(error.message);
    app.exit(1);
  });
