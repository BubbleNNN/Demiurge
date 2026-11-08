'use strict';
// Checks every pet and plugin in community/ and writes community/index.json with their sizes and
// SHA-256 digests (the app refuses any file that does not match). Run after adding or changing a
// file: `node scripts/community-index.cjs`; `--check` only verifies (used in CI).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateBundle, validateDesktopProfile, MAX_FILE_BYTES } = require('../electron/store.cjs');
const { validatePlugin, validateIndex } = require('../electron/community.cjs');

const root = path.resolve(__dirname, '../community');
const check = process.argv.includes('--check');
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const pets = [];
const plugins = [];
const metaOf = (folder) => {
  const file = path.join(folder, 'meta.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
};

for (const id of fs.readdirSync(path.join(root, 'pets')).sort()) {
  const folder = path.join(root, 'pets', id);
  if (!fs.statSync(folder).isDirectory()) continue;
  const bytes = fs.readFileSync(path.join(folder, 'pack.json'));
  if (bytes.length > MAX_FILE_BYTES) throw new Error(`${id}: pack.json is too large`);
  const bundle = validateBundle(JSON.parse(bytes.toString('utf8')));
  const meta = metaOf(folder);
  if (!meta.license)
    throw new Error(`${id}: meta.json must say how the character and art may be shared (license)`);
  pets.push({
    id,
    name: meta.name || bundle.character.name,
    work: meta.work ?? bundle.character.work,
    author: meta.author || '',
    description: meta.description || '',
    license: meta.license,
    path: `pets/${id}/pack.json`,
    size: bytes.length,
    sha256: digest(bytes),
    ...(fs.existsSync(path.join(folder, 'preview.png')) ? { preview: `pets/${id}/preview.png` } : {}),
  });
}
for (const name of fs.readdirSync(path.join(root, 'plugins')).sort()) {
  if (!name.endsWith('.json')) continue;
  const bytes = fs.readFileSync(path.join(root, 'plugins', name));
  const plugin = validatePlugin(JSON.parse(bytes.toString('utf8')), validateDesktopProfile);
  if (`${plugin.id}.json` !== name) throw new Error(`${name}: the file must be named after the plugin id`);
  plugins.push({
    id: plugin.id,
    name: plugin.name,
    author: plugin.author,
    description: plugin.description,
    license: 'MIT',
    kind: plugin.kind,
    path: `plugins/${name}`,
    size: bytes.length,
    sha256: digest(bytes),
  });
}
const index = validateIndex({ version: 1, updated: new Date().toISOString().slice(0, 10), pets, plugins });
const file = path.join(root, 'index.json');
if (check) {
  const current = validateIndex(JSON.parse(fs.readFileSync(file, 'utf8')));
  const strip = (value) => JSON.stringify({ ...value, updated: '' });
  if (strip(current) !== strip(index)) {
    console.error('community/index.json is out of date: run node scripts/community-index.cjs');
    process.exit(1);
  }
  console.log(`community: ${pets.length} pets and ${plugins.length} plugins checked`);
} else {
  fs.writeFileSync(file, JSON.stringify(index, null, 2) + '\n');
  console.log(`community/index.json: ${pets.length} pets, ${plugins.length} plugins`);
}
