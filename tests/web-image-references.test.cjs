'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { searchImages, collectRevisionImages } = require('../electron/web-image-references.cjs');
const fixture = require('./fixtures/pet-images.cjs');

test('image search metadata is retained separately from text, deduplicated and bounded', () => {
  const found = searchImages({
    images: [{ url: 'https://cdn.example/a.png', description: '角色细节' }, 'javascript:bad'],
    results: [
      { url: 'https://wiki.example/a', img_src: 'https://cdn.example/a.png', title: '角色' },
      { url: 'https://wiki.example/b', image_url: 'https://cdn.example/b.png', title: '原图' },
      { url: 'https://wiki.example/c', images: [{ url: 'https://cdn.example/c.png' }] },
    ],
  });
  assert.equal(found.length, 3);
  assert.equal(found[1].url, 'https://wiki.example/b');
  assert.equal(found[1].imageUrl, 'https://cdn.example/b.png');
  assert.deepEqual(searchImages({ images: {}, results: false }), []);
});

test('HTML original-size and social-preview images are inspected, deduplicated by bytes and attached', async () => {
  const bytes = fixture.image(),
    seen = [],
    verified = [];
  const result = await collectRevisionImages({
    found: { sources: [{ title: '角色资料', url: 'https://wiki.example/detail' }] },
    character: { name: '小森', work: '森林来信' },
    publicResource: async (url) => {
      seen.push(url);
      return url.endsWith('/detail')
        ? {
            url,
            contentType: 'text/html',
            bytes: Buffer.from(
              '<html><title>小森服装</title><meta property="og:image" content="/social.png"><img alt="小森" src="/tiny.png" srcset="/tiny.png 80w, /original.png 800w"></html>',
            ),
          }
        : { url, contentType: 'image/png', bytes };
    },
    inspectImage: async () => ({ width: 512, height: 512, mime: 'image/png' }),
    verify: async (image) => {
      verified.push(image);
      return { sameCharacter: true, compatibleOutfit: true, useful: true, confidence: 0.9 };
    },
    progress: () => {},
  });
  assert.deepEqual(seen, [
    'https://wiki.example/detail',
    'https://wiki.example/original.png',
    'https://wiki.example/social.png',
  ]);
  assert.equal(verified.length, 1, 'identical pixels at two URLs are verified once');
  assert.equal(result.references.length, 1);
  assert.equal(result.references[0].image, fixture.url(bytes));
  assert.equal(result.references[0].url, 'https://wiki.example/detail');
});

test('search pages without text are retained for visual discovery across API providers', async () => {
  const { createResearch } = require('../electron/research.cjs');
  for (const provider of ['tavily', 'searxng', 'wiki']) {
    const research = createResearch({
      request: async () =>
        provider === 'wiki'
          ? { query: { pages: { 1: { title: '小森', fullurl: 'https://cdn.example/portrait.png' } } } }
          : { results: [{ title: '小森', url: 'https://cdn.example/portrait.png' }] },
      readDocument: async () => {
        throw Error('An image has no article text');
      },
      requireKey: () => 'fixture',
      endpoint: (base, suffix) => `${base}/${suffix}`,
    });
    const result = await research.searchRevisionSources(
      { name: '小森', work: '森林来信', query: '发饰' },
      {
        searchProvider: provider,
        searxngBaseUrl: 'https://search.example',
        wikiApiUrl: 'https://wiki.example/api.php',
      },
      {},
    );
    assert.equal(result.sources.length, 0);
    assert.equal(result.visualSources[0].url, 'https://cdn.example/portrait.png');
  }
});
