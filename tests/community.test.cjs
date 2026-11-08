'use strict';
// The community catalogue: read-only downloads, each file checked against the size and digest the
// index records, validated like a local import; plugins are data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createCommunity, validateIndex, validatePlugin, REGISTRIES } = require('../electron/community.cjs');
const { validateBundle, validateDesktopProfile } = require('../electron/store.cjs');

const plugin = {
  version: 1,
  id: 'cozy',
  name: 'Cozy',
  author: 'tester',
  description: 'sits a lot',
  kind: 'behavior',
  target: 'all',
  profile: {
    hobbies: ['read'],
    habits: ['sit', 'lie'],
    travel: 'walk',
    manner: { calm: 0.9 },
    lines: { seek: ['休息一下？'] },
  },
};
const bytes = Buffer.from(JSON.stringify(plugin));
const digest = (b) => crypto.createHash('sha256').update(b).digest('hex');
const index = (extra = {}) => ({
  version: 1,
  updated: '2026-11-08',
  pets: [],
  plugins: [
    {
      id: 'cozy',
      name: 'Cozy',
      kind: 'behavior',
      path: 'plugins/cozy.json',
      size: bytes.length,
      sha256: digest(bytes),
      ...extra,
    },
  ],
});
function serve(files) {
  const asked = [];
  const fetch = async (url) => {
    asked.push(url);
    const body = files[url];
    if (body === undefined) return new Response('missing', { status: 404 });
    return new Response(typeof body === 'string' ? body : body);
  };
  return { fetch, asked };
}

test('plugins install from the catalogue after their digest checks out, and can be removed', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'demiurge-community-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  // The renamed repository is tried first; the old name still works.
  const base = REGISTRIES[1];
  const { fetch, asked } = serve({
    [`${base}index.json`]: JSON.stringify(index()),
    [`${base}plugins/cozy.json`]: bytes,
  });
  const community = createCommunity({ fetch, dir, validateBundle, validateDesktopProfile });
  const catalogue = await community.catalogue();
  assert.equal(catalogue.plugins[0].id, 'cozy');
  assert.equal(asked[0], `${REGISTRIES[0]}index.json`);
  const installed = await community.installPlugin('cozy');
  assert.deepEqual(
    installed.map((p) => [p.id, p.target, p.profile.travel]),
    [['cozy', 'all', 'walk']],
  );
  assert.deepEqual(await community.removePlugin('cozy'), []);
});

test('a file that does not match its digest, an unsafe path or code is refused', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'demiurge-community-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const base = REGISTRIES[0];
  const tampered = Buffer.from(JSON.stringify({ ...plugin, name: 'changed' }));
  const community = createCommunity({
    fetch: serve({ [`${base}index.json`]: JSON.stringify(index()), [`${base}plugins/cozy.json`]: tampered })
      .fetch,
    dir,
    validateBundle,
    validateDesktopProfile,
  });
  await assert.rejects(community.installPlugin('cozy'), /不一致|大小/);
  assert.deepEqual(await community.plugins(), []);
  for (const bad of ['../secrets.json', '/etc/passwd', 'https://evil.example/x.json'])
    assert.throws(() => validateIndex(index({ path: bad })), /路径/);
  assert.throws(
    () => validatePlugin({ ...plugin, kind: 'script' }, validateDesktopProfile),
    /只接受数据插件/,
  );
  assert.throws(() => validatePlugin({ ...plugin, profile: { travel: 'teleport' } }, validateDesktopProfile));
  assert.throws(() =>
    validatePlugin({ ...plugin, profile: { lines: { evil: ['x'] } } }, validateDesktopProfile),
  );
});

test('the catalogue in the repository is valid and up to date', async () => {
  const { execFileSync } = require('node:child_process');
  const out = execFileSync(
    process.execPath,
    [path.resolve(__dirname, '../scripts/community-index.cjs'), '--check'],
    { encoding: 'utf8' },
  );
  assert.match(out, /plugins checked/);
});
