'use strict';
// The example artwork ships once: from source it is read from public/art, in a packaged app
// (which has no public/art) from dist/art, and exporting the built-in character still works.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { artDirectory } = require('../electron/artwork.cjs');

test('artwork is found in the source tree and in a packaged layout', async () => {
  const root = path.resolve(__dirname, '..');
  assert.equal(artDirectory(root), path.join(root, 'public/art'));
  const packaged = fs.mkdtempSync(path.join(os.tmpdir(), 'demiurge-art-'));
  try {
    fs.mkdirSync(path.join(packaged, 'dist'), { recursive: true });
    fs.cpSync(path.join(root, 'public/art'), path.join(packaged, 'dist/art'), { recursive: true });
    assert.equal(artDirectory(packaged), path.join(packaged, 'dist/art'));
    // Every bundled example image, read from where a packaged app keeps it.
    const pack = require('../shared/cyrene-motion-pack.json');
    for (const entry of pack.entries)
      assert.ok(fs.existsSync(path.join(artDirectory(packaged), entry.file)), entry.file);
    assert.ok(fs.existsSync(path.join(artDirectory(packaged), 'cyrene-chibi-v6-reference.png')));
  } finally {
    fs.rmSync(packaged, { recursive: true, force: true });
  }
});

test('distributed art contains only the current starter and its own reference crop', () => {
  const pack=require('../shared/cyrene-motion-pack.json');
  assert.equal(pack.entries.length,1);
  const entry=pack.entries[0];
  assert.deepEqual(fs.readdirSync('public/art').filter(f=>f.endsWith('.png')).sort(),[entry.file,...entry.pageFiles,'cyrene-chibi-v6-reference.png'].sort());
});
