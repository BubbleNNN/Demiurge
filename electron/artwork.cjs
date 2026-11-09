'use strict';
// Where the bundled example artwork lives: public/art when running from source, dist/art in a
// packaged app (the renderer's copy; the app ships it once, not twice).
const fs = require('node:fs');
const path = require('node:path');

function artDirectory(base = path.resolve(__dirname, '..')) {
  const source = path.join(base, 'public/art');
  return fs.existsSync(source) ? source : path.join(base, 'dist/art');
}

module.exports = { artDirectory };
