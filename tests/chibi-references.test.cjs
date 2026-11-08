'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createChibiReferences,
  pageChibiImages,
  validateChibiResearch,
} = require('../electron/chibi-references.cjs');
const { referencePack, imageDigest } = require('../electron/references.cjs');
const fixture = require('./fixtures/pet-images.cjs');

const original = fixture.url(fixture.image());
const character = {
  id: 'chibi-test',
  name: '小森',
  work: '森林来信',
  visualReferences: [{ id: 'identity', name: '原图', image: original, createdAt: '2026-11-07T00:00:00.000Z' }],
};
const settings = {},
  credentials = {};
const candidatePng = Buffer.concat([fixture.image(), Buffer.from([1])]);
const furina = fixture.url(fixture.image(false, { opaque: true }));
const page = (images) =>
  Buffer.from(
    `<html><head><title>小森 Q版 表情包</title></head><body>${images
      .map((src) => `<img alt="${src.alt || ''}" src="${src.src}">`)
      .join('')}</body></html>`,
  );

function harness(overrides = {}) {
  const log = { reads: [], verified: 0 };
  const references = createChibiReferences({
    search: async () => ({ sources: [{ title: '画廊', url: 'https://gallery.example/chibi', snippet: '' }], warnings: [] }),
    publicResource: async (url) => {
      log.reads.push(url);
      if (url.endsWith('/chibi'))
        return { url, contentType: 'text/html', bytes: page([{ src: '/img/a.png' }, { src: 'https://cdn.example/logo.png', alt: 'logo' }]) };
      return { url, contentType: 'image/png', bytes: candidatePng };
    },
    inspectImage: async () => ({ width: 384, height: 512, mime: 'image/png' }),
    verify: async () => {
      log.verified++;
      return { sameCharacter: true, chibi: true, usable: true, confidence: 0.95 };
    },
    fallbackImage: async () => furina,
    ...overrides,
  });
  return { references, log };
}

test('a verified same-character chibi on a source page becomes the design reference, with provenance', async () => {
  const { references, log } = harness();
  const progress = [];
  const result = await references.discover(character, settings, credentials, (event) => progress.push(event.stage));
  assert.equal(result.summary.status, 'found');
  assert.equal(result.referenceDigest, referencePack(character).digest);
  assert.equal(result.image, `data:image/png;base64,${candidatePng.toString('base64')}`);
  assert.equal(result.imageDigest, imageDigest(result.image));
  assert.deepEqual(result.summary.sources, [
    { title: '小森 Q版 表情包', url: 'https://gallery.example/chibi', imageUrl: 'https://gallery.example/img/a.png' },
  ]);
  assert.deepEqual(log.reads, ['https://gallery.example/chibi', 'https://gallery.example/img/a.png'], 'logo images are skipped');
  assert.equal(log.verified, 1);
  assert.ok(progress.includes('Q版参考检索') && progress.includes('Q版参考核对'));
  assert.deepEqual(validateChibiResearch(result.summary), result.summary);
});

test('candidates the model rejects lead to the Furina sticker style, recorded as not proof of absence', async () => {
  const { references, log } = harness({
    verify: async () => ({ sameCharacter: false, chibi: true, usable: true, confidence: 0.9 }),
  });
  const result = await references.discover(character, settings, credentials);
  assert.equal(result.summary.status, 'fallback');
  assert.equal(result.image, furina);
  assert.equal(result.imageDigest, imageDigest(furina));
  assert.match(result.summary.reason, /芙宁娜/);
  assert.match(result.summary.reason, /不表示网上一定不存在/);
  assert.deepEqual(result.summary.sources, [{ title: '画廊', url: 'https://gallery.example/chibi' }]);
  assert.equal(log.reads.length, 2);
  const low = harness({ verify: async () => ({ sameCharacter: true, chibi: true, usable: true, confidence: 0.6 }) });
  assert.equal((await low.references.discover(character, settings, credentials)).summary.status, 'fallback');
});

test('search, page and download failures stop before any fallback or image generation', async () => {
  const failedSearch = harness({
    search: async () => {
      throw new Error('provider down');
    },
  });
  await assert.rejects(failedSearch.references.discover(character, settings, credentials), /Q版参考搜索未完成.*provider down/);
  const unreadable = harness({
    publicResource: async () => {
      throw new Error('blocked');
    },
  });
  await assert.rejects(unreadable.references.discover(character, settings, credentials), /图片来源页都无法读取/);
  const undownloadable = harness({
    publicResource: async (url) =>
      url.endsWith('/chibi')
        ? { url, contentType: 'text/html', bytes: page([{ src: '/img/a.png' }]) }
        : Promise.reject(new Error('timeout')),
  });
  await assert.rejects(undownloadable.references.discover(character, settings, credentials), /未能下载并核对/);
  const verifierDown = harness({
    verify: async () => {
      throw new Error('model unavailable');
    },
  });
  await assert.rejects(verifierDown.references.discover(character, settings, credentials), /model unavailable/);
});

test('no search results at all is the one honest route to the fallback', async () => {
  const { references, log } = harness({ search: async () => ({ sources: [], warnings: ['搜索服务未返回结果'] }) });
  const result = await references.discover(character, settings, credentials);
  assert.equal(result.summary.status, 'fallback');
  assert.deepEqual(result.summary.warnings, ['搜索服务未返回结果']);
  assert.equal(log.reads.length, 0);
  assert.equal(log.verified, 0);
});

test('page scanning keeps https images from chibi pages or chibi-named images only', () => {
  const found = pageChibiImages(
    page([{ src: '/img/a.png' }, { src: 'http://insecure.example/b.png' }, { src: '/ad/banner.png', alt: 'banner' }]),
    'https://gallery.example/chibi',
    {},
  );
  assert.deepEqual(
    found.map((item) => item.imageUrl),
    ['https://gallery.example/img/a.png'],
  );
  const plain = pageChibiImages(
    Buffer.from('<html><title>角色介绍</title><img src="/img/full.png"><img alt="chibi sticker" src="/img/sd.png"></html>'),
    'https://wiki.example/entry',
    { title: '', snippet: '' },
  );
  assert.deepEqual(plain.map((item) => item.imageUrl), ['https://wiki.example/img/sd.png']);
});

test('research records reject unknown status, oversized text and credentialed links', () => {
  const good = { status: 'found', checkedAt: '2026-11-07T00:00:00.000Z', reason: 'ok', sources: [], warnings: [] };
  assert.deepEqual(validateChibiResearch(good), good);
  assert.throws(() => validateChibiResearch({ ...good, status: 'maybe' }), /无效/);
  assert.throws(() => validateChibiResearch({ ...good, reason: 'x'.repeat(601) }), /无效/);
  assert.throws(() => validateChibiResearch({ ...good, sources: [{ url: 'https://user:pw@example.com/' }] }), /凭据|无效/);
  assert.throws(() => validateChibiResearch({ ...good, checkedAt: 'yesterday' }), /无效/);
});
