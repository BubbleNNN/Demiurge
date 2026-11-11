// Prepare only the public starter art, never the user's workspace.
const fs = require('node:fs'),
  path = require('node:path');
const root = path.resolve(__dirname, '../..'),
  out = path.resolve(process.argv[2] || path.join(root, '.local/promo-chibi'));
const entry = require('../../shared/cyrene-motion-pack.json').entries[0];
fs.mkdirSync(out, { recursive: true });
[entry.file, ...entry.pageFiles].forEach((file, i) =>
  fs.copyFileSync(path.join(root, 'public/art', file), path.join(out, `atlas-${i}.png`)),
);
fs.writeFileSync(path.join(out, 'sprite.json'), JSON.stringify(entry.animation, null, 2));
console.log('Prepared bundled public artwork:', out);
