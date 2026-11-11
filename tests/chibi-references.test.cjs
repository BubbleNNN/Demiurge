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
const furina_png = fixture.url(fixture.image(false, { opaque: true }));
const furina = furina_png;
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

test('wiki and community pages are read through their JSON APIs and the character\'s own files come first', async () => {
  const { mediaWikiPage, communityPost, rank, wikiLangNames } = require('../electron/chibi-references.cjs');
  const gallery = mediaWikiPage('https://genshin-impact.fandom.com/wiki/Paimon%27s%20Paintings/Set%2028');
  assert.equal(gallery.api, 'https://genshin-impact.fandom.com/api.php');
  assert.equal(gallery.title, "Paimon's Paintings/Set 28");
  assert.equal(gallery.category, null);
  const media = mediaWikiPage('https://honkai-star-rail.fandom.com/zh/wiki/%E6%98%94%E6%B6%9F/%E5%AA%92%E4%BD%93?variant=zh-tw');
  assert.equal(media.api, 'https://honkai-star-rail.fandom.com/zh/api.php');
  assert.equal(media.title, '昔涟/媒体');
  assert.equal(mediaWikiPage('https://example.com/blog/wiki-tips'), null);
  assert.equal(communityPost('https://www.hoyolab.com/article/42168240').api, 'https://bbs-api-os.hoyolab.com/community/post/wapi/getPostFull?post_id=42168240');
  assert.equal(communityPost('https://www.miyoushe.com/ys/article/74703348').api, 'https://bbs-api.miyoushe.com/post/wapi/getPostFull?post_id=74703348');
  assert.equal(communityPost('https://www.hoyolab.com/accountCenter/postList?id=1'), null);
  assert.deepEqual(wikiLangNames({ query: { pages: [{ title: '芙宁娜', langlinks: [{ lang: 'en', title: 'Furina' }, { lang: 'ja', title: 'フリーナ (原神)' }] }] } }), ['芙宁娜', 'Furina', 'フリーナ']);

  // A character with no built-in alias table: the names arrive from the search answer and the wiki.
  const furina = { id: 'f', name: '芙宁娜', work: '原神', visualReferences: character.visualReferences };
  const requests = [];
  const wikiFile = (name, width = 340) => ({ title: `File:${name}`, imageinfo: [{ url: `https://static.example/${encodeURIComponent(name)}`, width, height: width, mime: 'image/png' }] });
  const references = createChibiReferences({
    search: async () => ({
      sources: [
        { title: "Paimon's Paintings/Set 28 | Genshin Impact Wiki", url: 'https://genshin-impact.fandom.com/wiki/Paimon%27s%20Paintings/Set%2028', snippet: '' },
        { title: 'Stickers Vol.1 | HoYoLAB', url: 'https://www.hoyolab.com/article/42168240', snippet: '' },
        { title: 'Furina | Genshin Impact Wiki', url: 'https://genshin-impact.fandom.com/wiki/Furina', snippet: '' },
      ],
      warnings: [],
      aliases: ['Furina'],
    }),
    publicResource: async (url, options) => {
      requests.push(url);
      const json = (value) => ({ url, contentType: 'application/json', bytes: Buffer.from(JSON.stringify(value)) });
      const params = new URL(url).searchParams;
      if (params.get('prop') === 'langlinks') {
        assert.equal(params.get('titles'), 'Furina', "the character's own page, never a gallery");
        return json({ query: { pages: [{ title: 'Furina', langlinks: [{ lang: 'ja', title: 'フリーナ' }] }] } });
      }
      if (url.includes('generator=images'))
        return json({ query: { pages: [wikiFile("Paimon's Paintings Set 28.png", 750), wikiFile("Icon Emoji Paimon's Paintings 28 Neuvillette 1.png"), wikiFile('Icon Fire.png', 64), wikiFile("Icon Emoji Paimon's Paintings 28 Furina 2.png")] } });
      if (url.includes('generator=search')) {
        assert.equal(params.get('gsrnamespace'), '6');
        return json({ query: { pages: [wikiFile("Icon Emoji Paimon's Paintings 28 Furina 1.png"), wikiFile('Furina Card.jpg', 2048)] } });
      }
      if (url.startsWith('https://bbs-api-os.hoyolab.com/')) {
        assert.equal(options.headers.Referer, 'https://www.hoyolab.com/');
        return json({ retcode: 0, data: { post: { post: { subject: 'Stickers Vol.1' }, image_list: [{ url: 'https://upload-os-bbs.example/a.png', width: 1200, height: 1600 }, { url: 'https://upload-os-bbs.example/tiny.png', width: 64, height: 64 }] } } });
      }
      assert.ok(url.startsWith('https://static.example/') || url.startsWith('https://upload-os-bbs.example/'), url);
      return { url, contentType: 'image/png', bytes: Buffer.concat([fixture.image(), Buffer.from(url)]) };
    },
    inspectImage: async () => ({ width: 340, height: 340, mime: 'image/png' }),
    verify: async (_character, _originals, image) => ({ sameCharacter: /Furina/.test(Buffer.from(image.split(',')[1], 'base64').toString('latin1')), chibi: true, usable: true, confidence: 0.9 }),
    fallbackImage: async () => furina_png,
  });
  const result = await references.discover(furina, settings, credentials);
  assert.equal(result.summary.status, 'found');
  assert.match(result.summary.sources[0].imageUrl, /Paintings%2028%20Furina/);
  assert.match(result.summary.reason, /Paintings 28 Furina/);
  const searched = requests.filter((url) => url.includes('generator=search')).map((url) => new URL(url).searchParams.get('gsrsearch'));
  assert.ok(searched.includes('芙宁娜') && searched.includes('furina') && searched.includes('フリーナ'), `file searches use typed, answered and wiki names: ${searched}`);
  assert.ok(!searched.includes("paimon'spaintings"), 'gallery titles are not treated as names');
  assert.ok(!requests.some((url) => /fandom\.com\/wiki\//.test(url)), 'the blocked HTML page is never fetched');
  assert.ok(!requests.some((url) => url.startsWith('https://www.hoyolab.com/')), 'the script-rendered post is never fetched');
  const downloads = requests.filter((url) => url.startsWith('https://static.example/') || url.startsWith('https://upload-os-bbs.example/'));
  assert.equal(downloads.length, 1, 'the first candidate already passes, so nothing else is downloaded');
  // Ranking: own name plus sticker wording, then sticker wording, then the page's name alone.
  const aliases = require('../electron/research.cjs').characterAliases({ ...furina, aliases: ['Furina'] });
  const score = (name, title = "Paimon's Paintings") => rank({ name, title, imageUrl: 'https://static.example/x.png' }, aliases);
  assert.ok(score("Icon Emoji Paimon's Paintings 28 Furina 2.png") > score("Icon Emoji Paimon's Paintings 28 Neuvillette 1.png"));
  assert.ok(score("Icon Emoji Paimon's Paintings 28 Neuvillette 1.png") > score("Paimon's Paintings Set 28.png"));
  assert.equal(score('芙宁娜 立绘.png', '芙宁娜/媒体'), -1, 'portraits without sticker wording are not verified');
  assert.ok(score('芙宁娜 表情 自然状态.png', '芙宁娜/媒体') > score('Icon Emoji Paimon\'s Paintings 28 Neuvillette 1.png'));
});

test('category pages list their files, Wikipedia-style wikis retry under /w/, and plain art is never verified', async () => {
  const { mediaWikiPage, rank } = require('../electron/chibi-references.cjs');
  const category = mediaWikiPage('https://genshin-impact.fandom.com/wiki/Category%3AFurina_Images');
  assert.equal(category.category, 'Category:Furina Images');
  const wikipedia = mediaWikiPage('https://zh.wikipedia.org/wiki/%E8%8A%99%E5%AE%81%E5%A8%9C');
  assert.equal(wikipedia.api, 'https://zh.wikipedia.org/api.php');
  assert.equal(wikipedia.alternate, 'https://zh.wikipedia.org/w/api.php');
  const aliases = require('../electron/research.cjs').characterAliases({ name: '星野アイ', aliases: ['Ai Hoshino'] });
  assert.equal(rank({ name: 'Ai Hoshino main.jpg', title: 'Ai Hoshino/Gallery', imageUrl: 'https://static.example/Ai_Hoshino_main.jpg' }, aliases), -1, 'a portrait with no sticker wording is skipped');
  assert.ok(rank({ name: '', title: 'Stickers Vol.1', snippet: '', imageUrl: 'https://upload.example/abc.png' }, aliases) >= 0, 'unnamed post images on a sticker post stay');

  const requests = [];
  const references = createChibiReferences({
    search: async () => ({ sources: [{ title: 'Category:Furina Images', url: 'https://genshin-impact.fandom.com/wiki/Category%3AFurina_Images', snippet: '' }, { title: '芙宁娜 - 维基百科', url: 'https://zh.wikipedia.org/wiki/%E8%8A%99%E5%AE%81%E5%A8%9C', snippet: '' }], warnings: [], aliases: ['Furina'] }),
    publicResource: async (url) => {
      requests.push(url);
      const json = (value) => ({ url, contentType: 'application/json', bytes: Buffer.from(JSON.stringify(value)) });
      const params = new URL(url).searchParams;
      if (url.startsWith('https://zh.wikipedia.org/api.php')) throw new Error('Wiki 多语言名称失败（HTTP 404）。');
      if (url.startsWith('https://zh.wikipedia.org/w/api.php')) {
        if (params.get('prop') === 'langlinks') return json({ query: { pages: [{ title: '芙宁娜', langlinks: [{ lang: 'en', title: 'Furina' }, { lang: 'ja', title: 'フリーナ' }] }] } });
        return json({ query: { pages: [] } });
      }
      if (params.get('generator') === 'categorymembers') {
        assert.equal(params.get('gcmtitle'), 'Category:Furina Images');
        return json({ query: { pages: [{ title: "File:Icon Emoji Paimon's Paintings 28 Furina 3.png", imageinfo: [{ url: 'https://static.example/emoji.png', width: 340, height: 340, mime: 'image/png' }] }, { title: 'File:Furina Card.png', imageinfo: [{ url: 'https://static.example/card.png', width: 1080, height: 2160, mime: 'image/png' }] }] } });
      }
      if (params.get('generator') === 'search' || params.get('generator') === 'images') return json({ query: { pages: [] } });
      return { url, contentType: 'image/png', bytes: fixture.image() };
    },
    inspectImage: async () => ({ width: 340, height: 340, mime: 'image/png' }),
    verify: async () => ({ sameCharacter: true, chibi: true, usable: true, confidence: 0.9 }),
    fallbackImage: async () => furina_png,
  });
  const result = await references.discover({ id: 'f', name: '芙宁娜', work: '原神', visualReferences: character.visualReferences }, settings, credentials);
  assert.equal(result.summary.status, 'found');
  assert.equal(result.summary.sources[0].imageUrl, 'https://static.example/emoji.png');
  assert.ok(requests.some((url) => url.startsWith('https://zh.wikipedia.org/w/api.php') && url.includes('langlinks')), 'the alternate api location is tried');
  assert.ok(!requests.includes('https://static.example/card.png'), 'the plain card is never downloaded');
  const searched = requests.filter((url) => url.includes('generator=search')).map((url) => new URL(url).searchParams.get('gsrsearch'));
  assert.ok(searched.includes('フリーナ'), `wikipedia interlanguage names feed the file search: ${searched}`);
});

test('wiki thumbnails are requested as the stored file and download failures are reported, not hidden', async () => {
  const { originalImageUrl } = require('../electron/chibi-references.cjs');
  assert.equal(
    originalImageUrl('https://static.wikia.nocookie.net/x/images/1/16/A.png/revision/latest?cb=1&path-prefix=zh'),
    'https://static.wikia.nocookie.net/x/images/1/16/A.png/revision/latest?cb=1&path-prefix=zh&format=original',
  );
  assert.equal(originalImageUrl('https://upload-os-bbs.hoyolab.com/upload/a.png'), 'https://upload-os-bbs.hoyolab.com/upload/a.png');
  const { references } = harness({
    publicResource: async (url) => {
      if (url.endsWith('/chibi')) return { url, contentType: 'text/html', bytes: page([{ src: '/img/a.png' }]) };
      throw new Error('图片无法解码或尺寸超出限制。');
    },
  });
  await assert.rejects(references.discover(character, settings, credentials), /未能下载并核对（a\.png：图片无法解码/);
});

test('WebP candidates are measured from their header when the desktop decoder cannot read them', async () => {
  const { createServices } = require('../electron/services.cjs');
  const services = createServices(async () => { throw new Error('offline'); }, {
    inspectImage: () => { throw new Error('参考图无法解码。'); },
  });
  const vp8x = Buffer.concat([
    Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8X'), Buffer.alloc(4),
    Buffer.alloc(4), Buffer.from([0x3f, 0x01, 0x00]), Buffer.from([0x47, 0x01, 0x00]), Buffer.alloc(8),
  ]);
  assert.deepEqual(await services.inspectReferenceImage(vp8x), { width: 320, height: 328, mime: 'image/webp' });
  await assert.rejects(services.inspectReferenceImage(Buffer.from('not an image at all, really')), /有效 PNG/);
});

test('direct image search hits and direct image pages reach verification instead of falling through to fallback', async () => {
  for (const result of [
    { sources: [], images: [{ imageUrl: 'https://cdn.example/image.png', url: 'https://cdn.example/image.png', title: '', name: '', searchImage: true }] },
    { sources: [{ title: '小森', url: 'https://cdn.example/image.png', snippet: '' }] },
  ]) {
    const { references, log } = harness({ search: async () => ({ ...result, warnings: [] }) });
    const found = await references.discover(character, settings, credentials);
    assert.equal(found.summary.status, 'found');
    assert.equal(found.image, `data:image/png;base64,${candidatePng.toString('base64')}`);
    assert.equal(log.verified, 1);
    assert.equal(log.reads.length, 1, 'a direct response is reused without a second download');
  }
});
