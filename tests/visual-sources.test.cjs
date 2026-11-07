'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createServices } = require('../electron/services.cjs');
const { pageImages, CATALOG_BASE } = require('../electron/visual-sources.cjs');
const { validateCharacter, createBundle, validateBundle } = require('../electron/store.cjs');
const png = (width = 1000, height = 1500) => {
  const b = Buffer.alloc(32);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(b);
  b.write('IHDR', 12);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
};
const json = (data) =>
  new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
const publicHost = async () => [{ address: '93.184.215.14' }];
const character = {
  id: 'hero',
  name: '风堇',
  work: '崩坏星穹铁道',
  summary: '',
  personality: [],
  speakingStyle: '',
  appearance: '',
  sources: [],
  quotes: [],
  unknowns: [],
  behavior: { energy: 50, affection: 50, curiosity: 50 },
  createdAt: new Date().toISOString(),
};

test('visual collection downloads exact-name catalog images without a model key and preserves original bytes and source labels', async () => {
  const calls = [],
    bytes = png();
  const services = createServices(
    async (url, init) => {
      calls.push(url);
      assert.equal(init.credentials, 'omit');
      assert.equal(init.headers.Authorization, undefined);
      if (url.endsWith('characters.json'))
        return json({
          1409: {
            name: '风堇',
            portrait: 'image/character_portrait/1409.png',
            preview: 'image/character_preview/1409.png',
            icon: 'icon/character/1409.png',
          },
          wrong: { name: '别的人', portrait: 'image/character_portrait/9999.png' },
        });
      if (url.includes('api.github.com'))
        return json({ size: bytes.length, encoding: 'base64', content: bytes.toString('base64') });
      return new Response(bytes, { headers: { 'Content-Type': 'image/png' } });
    },
    { resolveHost: publicHost },
  );
  const result = await services.discoverReferences(character, {});
  assert.equal(result.candidates.length, 1, 'Identical image bytes must be deduplicated');
  assert.equal(result.candidates[0].image, `data:image/png;base64,${bytes.toString('base64')}`);
  assert.equal(result.candidates[0].width, 1000);
  assert.equal(result.candidates[0].match, 'name');
  assert.match(result.candidates[0].sourceUrl, /github.com\/Mar-7th/);
  assert.match(result.warnings.join(' '), /不表示官方认证/);
  assert.deepEqual(calls, [
    CATALOG_BASE + 'index_new/cn/characters.json',
    'https://api.github.com/repos/Mar-7th/StarRailRes/contents/image/character_portrait/1409.png?ref=master',
    'https://api.github.com/repos/Mar-7th/StarRailRes/contents/image/character_preview/1409.png?ref=master',
  ]);
});

test('public page discovery requires a matching character heading and filters icons while choosing larger srcset images', () => {
  const body = Buffer.from(
    '<html><head><title>小森人物资料</title></head><body><article><h1>小森</h1><img alt="技能图标" src="https://cdn.example/icon.png"><img alt="全身立绘" src="/small.png" srcset="https://cdn.example/large.png 2000w, /small.png 300w"></article></body></html>',
  );
  const result = pageImages(body, 'https://source.example/hero', { name: '小森' });
  assert.equal(result.length, 1);
  assert.equal(result[0].imageUrl, 'https://cdn.example/large.png');
  assert.equal(result[0].match, 'unverified');
  assert.throws(() => pageImages(body, 'https://source.example/hero', { name: '另一人' }), /未匹配角色名/);
});

test('a failed raw catalog read can use the same public repository file through the contents API', async () => {
  const calls = [];
  const catalog = Buffer.from(
    JSON.stringify({ 1409: { name: '风堇', portrait: 'image/character_portrait/1409.png' } }),
  );
  const services = createServices(
    async (url, init) => {
      calls.push(url);
      assert.equal(init.headers.Authorization, undefined);
      if (url.startsWith(CATALOG_BASE)) throw new TypeError('Raw file route unavailable');
      const bytes = url.includes('characters.json') ? catalog : png();
      return json({ size: bytes.length, encoding: 'base64', content: bytes.toString('base64') });
    },
    { resolveHost: publicHost },
  );
  const result = await services.discoverReferences(character, {});
  assert.equal(result.candidates[0].match, 'name');
  assert.ok(
    calls.includes(
      'https://api.github.com/repos/Mar-7th/StarRailRes/contents/index_new/cn/characters.json?ref=master',
    ),
  );
  assert.equal(calls.length, 3);
});

test('reference image redirects cannot reach private hosts and invalid or small images are not saved', async () => {
  for (const kind of ['private', 'svg', 'small']) {
    let calls = 0;
    const services = createServices(
      async (url) => {
        calls++;
        if (url.includes('characters.json'))
          return json({ 1409: { name: '风堇', portrait: 'image/character_portrait/1409.png' } });
        if (kind === 'private')
          return new Response('', { status: 302, headers: { location: 'https://127.0.0.1/private' } });
        const bytes = kind === 'svg' ? Buffer.from('<svg>fake</svg>') : png(100, 100);
        return json({ size: bytes.length, encoding: 'base64', content: bytes.toString('base64') });
      },
      { resolveHost: publicHost },
    );
    await assert.rejects(services.discoverReferences(character, {}), /没有取得可用参考图/);
    assert.equal(calls, 2);
  }
});

test('Wiki image discovery reads imageinfo original URLs and filters small or unrelated icon assets', async () => {
  const services = createServices(
    async (url) => {
      if (url.includes('api.php')) {
        const parsed = new URL(url);
        assert.equal(parsed.searchParams.get('generator'), 'images');
        assert.equal(parsed.searchParams.get('titles'), '小森');
        return json({
          query: {
            pages: [
              {
                title: 'File:小森全身立绘.png',
                imageinfo: [{ url: 'https://cdn.example/hero.png', width: 1000, height: 1500 }],
              },
              {
                title: 'File:技能图标.png',
                imageinfo: [{ url: 'https://cdn.example/icon.png', width: 1000, height: 1500 }],
              },
            ],
          },
        });
      }
      return new Response(png());
    },
    { resolveHost: publicHost },
  );
  const result = await services.discoverReferences(
    { ...character, name: '小森', work: '森林来信', sources: [{ url: 'https://wiki.example/game/小森' }] },
    { wikiApiUrl: 'https://wiki.example/game/api.php' },
  );
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].origin, 'wiki');
});

test('downloaded candidate metadata round trips through character bundles and invalid dimensions are rejected', () => {
  const candidate = {
    id: 'ref',
    name: '主参考',
    image: `data:image/png;base64,${png().toString('base64')}`,
    sourceUrl: 'https://source.example/hero',
    imageUrl: 'https://cdn.example/hero.png',
    width: 1000,
    height: 1500,
    origin: 'catalog',
    match: 'name',
    createdAt: new Date().toISOString(),
  };
  const c = validateCharacter({
    ...character,
    referenceCandidates: [candidate],
    referenceWarnings: ['社区来源，待核对'],
  });
  assert.deepEqual(validateBundle(createBundle(c, [])).character.referenceCandidates, [candidate]);
  assert.throws(
    () => validateCharacter({ ...character, referenceCandidates: [{ ...candidate, width: 99999 }] }),
    /invalid image width/,
  );
});

test('large catalog images use the public blob API and mismatched Git hashes cannot become references', async () => {
  const bytes = png(),
    hash = require('node:crypto')
      .createHash('sha1')
      .update(Buffer.from(`blob ${bytes.length}\0`))
      .update(bytes)
      .digest('hex');
  for (const corrupted of [false, true]) {
    let blobReads = 0;
    const services = createServices(
      async (url) => {
        if (url.endsWith('characters.json'))
          return json({ 1409: { name: '风堇', portrait: 'image/character_portrait/1409.png' } });
        if (url.includes('/contents/')) return json({ size: bytes.length, sha: hash, encoding: 'none' });
        assert.ok(url.endsWith(`/git/blobs/${hash}`));
        blobReads++;
        const content = Buffer.from(bytes);
        if (corrupted) content[25] = 1;
        return json({ encoding: 'base64', content: content.toString('base64') });
      },
      { resolveHost: publicHost },
    );
    if (corrupted) await assert.rejects(services.discoverReferences(character, {}), /哈希不一致/);
    else assert.equal((await services.discoverReferences(character, {})).candidates.length, 1);
    assert.equal(blobReads, 1);
  }
});
