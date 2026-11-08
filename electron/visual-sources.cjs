'use strict';
const { randomUUID, createHash } = require('node:crypto');
const { parseHTML } = require('linkedom');
const { sourceUrl } = require('./sources.cjs');
const CATALOG_BASE = 'https://raw.githubusercontent.com/Mar-7th/StarRailRes/master/';
const CATALOG_PAGE = 'https://github.com/Mar-7th/StarRailRes';
const normalize = (s) =>
  String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s：:·•]/g, '');
const excluded =
  /(?:icon|avatar|emoji|logo|banner|skill|relic|light.?cone|currency|equipment|攻略|技能|图标|头像)/i;
function imageAddress(value, base) {
  const address = new URL(value, base);
  if (
    address.protocol !== 'https:' ||
    address.username ||
    address.password ||
    (address.port && address.port !== '443')
  )
    throw new Error('参考图片只支持公开 HTTPS 地址。');
  return sourceUrl(address.href);
}
function pageImages(bytes, url, character) {
  const { document } = parseHTML(bytes.toString('utf8'));
  const context = normalize(`${document.title} ${document.querySelector('h1')?.textContent || ''}`);
  const names = String(character.name)
    .split(/[\/|（）()、,，]/)
    .map(normalize)
    .filter(Boolean);
  if (!names.some((name) => context.includes(name)))
    throw new Error('网页标题未匹配角色名，未收集其中图片。');
  const root = document.querySelector('.mw-parser-output, article, main') || document.body;
  const candidates = [];
  const add = (raw, name, width, height, score = 0) => {
    try {
      if (!raw || excluded.test(name + ' ' + raw)) return;
      if ((width && width < 384) || (height && height < 384)) return;
      candidates.push({
        imageUrl: imageAddress(raw, url),
        sourceUrl: url,
        name: String(name || character.name).slice(0, 150),
        origin: 'page',
        match: 'unverified',
        score,
      });
    } catch {
      /* Unsupported embedded/vector images are not reference assets. */
    }
  };
  for (const el of [...(root?.querySelectorAll('img') || [])].slice(0, 80)) {
    const srcset = el.getAttribute('srcset') || el.getAttribute('data-srcset');
    const largest = srcset
      ?.split(',')
      .map((s) => s.trim().split(/\s+/))
      .sort((a, b) => parseFloat(b[1] || '1') - parseFloat(a[1] || '1'))[0]?.[0];
    const raw = largest || el.getAttribute('data-src') || el.getAttribute('src');
    const name = el.getAttribute('alt') || el.getAttribute('title') || character.name;
    add(
      raw,
      name,
      Number(el.getAttribute('width')),
      Number(el.getAttribute('height')),
      /portrait|立绘|全身|character/i.test(name + raw) ? 20 : 0,
    );
  }
  add(document.querySelector('meta[property="og:image"]')?.getAttribute('content'), character.name, 0, 0, -5);
  return candidates.sort((a, b) => b.score - a.score);
}
function createVisualSources({ publicResource, inspectImage }) {
  const readJson = async (url) => {
    const response = await publicResource(url, {
      label: '图片来源读取',
      limit: 1024 * 1024,
      accept: 'application/json',
    });
    if (/html/i.test(response.contentType)) throw new Error('图片来源接口返回网页，未读取到 JSON。');
    try {
      return JSON.parse(response.bytes.toString('utf8'));
    } catch {
      throw new Error('图片来源未返回有效 JSON。');
    }
  };
  const catalogImage = async (candidate) => {
    const asset = candidate.imageUrl.slice(CATALOG_BASE.length);
    const metadataResponse = await publicResource(
      `https://api.github.com/repos/Mar-7th/StarRailRes/contents/${asset}?ref=master`,
      {
        label: '社区图片 API 读取',
        limit: 12 * 1024 * 1024,
        accept: 'application/vnd.github+json',
        timeout: 45000,
        httpsOnly: true,
      },
    );
    let metadata;
    try {
      metadata = JSON.parse(metadataResponse.bytes.toString('utf8'));
    } catch {
      throw new Error('社区图片 API 未返回有效文件信息。');
    }
    if (!Number.isInteger(metadata.size) || metadata.size < 1 || metadata.size > 8 * 1024 * 1024)
      throw new Error('社区图片超出 8 MiB 限制。');
    let blob = metadata;
    if (metadata.encoding !== 'base64' || !metadata.content) {
      if (!/^[a-f0-9]{40}$/.test(metadata.sha)) throw new Error('社区图片未提供可追溯的文件哈希。');
      const response = await publicResource(
        `https://api.github.com/repos/Mar-7th/StarRailRes/git/blobs/${metadata.sha}`,
        {
          label: '社区原图下载',
          limit: 12 * 1024 * 1024,
          accept: 'application/vnd.github+json',
          timeout: 45000,
          httpsOnly: true,
        },
      );
      try {
        blob = JSON.parse(response.bytes.toString('utf8'));
      } catch {
        throw new Error('社区原图 API 未返回有效文件数据。');
      }
    }
    const content = typeof blob.content === 'string' ? blob.content.replace(/\s+/g, '') : '';
    if (blob.encoding !== 'base64' || !/^[A-Za-z0-9+/]+={0,2}$/.test(content))
      throw new Error('社区原图数据无效。');
    const bytes = Buffer.from(content, 'base64');
    if (bytes.length !== metadata.size || bytes.toString('base64') !== content)
      throw new Error('社区原图下载不完整。');
    if (metadata.sha) {
      const actual = createHash('sha1')
        .update(Buffer.from(`blob ${bytes.length}\0`))
        .update(bytes)
        .digest('hex');
      if (actual !== metadata.sha) throw new Error('社区原图内容与文件哈希不一致。');
    }
    return { bytes, url: candidate.imageUrl };
  };
  async function discoverReferences(character, settings, onProgress = () => {}) {
    const warnings = [],
      urls = [];
    // Exact name lookup in a named community catalog, not model-invented URLs.
    if (/星穹[铁鐵]?道|honkai.?star.?rail/i.test(character.work)) {
      try {
        onProgress({ stage: 'references', detail: '正在按角色名字读取星穹铁道社区图像索引…' });
        let data;
        try {
          data = await readJson(CATALOG_BASE + 'index_new/cn/characters.json');
        } catch {
          // Public raw-file routes can fail independently of GitHub's API.
          // Read the same repository file through its anonymous contents API.
          const response = await catalogImage({ imageUrl: CATALOG_BASE + 'index_new/cn/characters.json' });
          try {
            data = JSON.parse(response.bytes.toString('utf8'));
          } catch {
            throw new Error('社区角色索引未返回有效 JSON。');
          }
        }
        if (!data || typeof data !== 'object' || Array.isArray(data))
          throw new Error('社区角色索引格式无效。');
        const entries = Object.values(data).filter(
          (entry) =>
            entry &&
            (normalize(entry.name) === normalize(character.name) ||
              normalize(entry.tag) === normalize(character.name)),
        );
        for (const entry of entries.slice(0, 2)) {
          for (const field of ['portrait', 'preview']) {
            const asset = entry[field];
            if (
              typeof asset !== 'string' ||
              !/^image\/character_(portrait|preview)\/[a-zA-Z0-9_-]+\.(png|webp|jpe?g)$/.test(asset)
            )
              continue;
            urls.push({
              imageUrl: CATALOG_BASE + asset,
              sourceUrl: CATALOG_PAGE,
              name: `${entry.name} · ${field === 'portrait' ? '角色立绘' : '角色预览'}`,
              origin: 'catalog',
              match: 'name',
              score: field === 'portrait' ? 100 : 80,
            });
          }
        }
        if (!urls.length) warnings.push('社区索引未找到完全匹配的角色名，继续读取已有资料网页。');
      } catch (error) {
        warnings.push(`社区图像索引未读取：${String(error.message).slice(0, 160)}`);
      }
    }
    if (!urls.length) {
      const pages = [...new Set((character.sources || []).map((s) => s.url))].slice(0, 4);
      for (const page of pages) {
        try {
          onProgress({ stage: 'references', detail: '正在从角色资料页面提取图片地址…' });
          const wiki = settings.wikiApiUrl ? new URL(settings.wikiApiUrl) : undefined;
          const parsed = new URL(page);
          if (
            wiki &&
            wiki.origin === parsed.origin &&
            parsed.pathname.startsWith(wiki.pathname.replace(/api\.php$/, ''))
          ) {
            const title = decodeURIComponent(
              parsed.pathname.slice(wiki.pathname.replace(/api\.php$/, '').length),
            ).replace(/^wiki\//, '');
            const api = new URL(wiki);
            for (const [k, v] of Object.entries({
              action: 'query',
              generator: 'images',
              titles: title,
              gimlimit: '30',
              prop: 'imageinfo',
              iiprop: 'url|size',
              format: 'json',
              formatversion: '2',
            }))
              api.searchParams.set(k, v);
            const data = await readJson(api.href);
            if (data.error) throw new Error('Wiki 图片接口不可用。');
            for (const item of data.query?.pages || []) {
              const image = item.imageinfo?.[0];
              if (!image?.url || excluded.test(item.title) || image.width < 384 || image.height < 384)
                continue;
              urls.push({
                imageUrl: imageAddress(image.url, page),
                sourceUrl: page,
                name: String(item.title).slice(0, 150),
                origin: 'wiki',
                match: 'unverified',
                score: /立绘|portrait|全身/i.test(item.title) ? 40 : 10,
              });
            }
          } else {
            const response = await publicResource(page, {
              label: '参考图网页读取',
              limit: 1024 * 1024,
              accept: 'text/html',
            });
            if (!/html/i.test(response.contentType)) throw new Error('页面不是可读取的 HTML。');
            urls.push(...pageImages(response.bytes, response.url, character));
          }
        } catch (error) {
          warnings.push(`图片页面未读取：${String(error.message).slice(0, 160)}`);
          if (/HTTP (567|429)/.test(error.message)) break;
        }
        if (urls.length >= 12) break;
      }
    }
    const seenUrls = new Set(),
      seenBytes = new Set(),
      candidates = [];
    for (const candidate of urls.sort((a, b) => b.score - a.score).slice(0, 24)) {
      if (candidates.length >= 8) break;
      if (seenUrls.has(candidate.imageUrl)) continue;
      seenUrls.add(candidate.imageUrl);
      try {
        onProgress({ stage: 'references', detail: `正在下载参考图片，已保留 ${candidates.length} 张…` });
        const response =
          candidate.origin === 'catalog'
            ? await catalogImage(candidate)
            : await publicResource(candidate.imageUrl, {
                label: '参考图下载',
                limit: 8 * 1024 * 1024,
                timeout: 45000,
                accept: 'image/png,image/jpeg,image/webp',
                httpsOnly: true,
              });
        const inspected = await inspectImage(response.bytes);
        // Catalog close-ups are small but sharp face/ornament references; full images need more pixels.
        const closeUp = candidate.origin === 'catalog' && /角色预览/.test(candidate.name);
        if (
          Math.min(inspected.width, inspected.height) < (closeUp ? 320 : 384) ||
          inspected.width * inspected.height < (closeUp ? 150000 : 300000)
        )
          throw new Error('图片尺寸过小，已排除。');
        const digest = createHash('sha256').update(response.bytes).digest('hex');
        if (seenBytes.has(digest)) continue;
        seenBytes.add(digest);
        const { score, ...metadata } = candidate;
        candidates.push({
          ...metadata,
          imageUrl: response.url,
          id: randomUUID(),
          image: `data:${inspected.mime};base64,${response.bytes.toString('base64')}`,
          width: inspected.width,
          height: inspected.height,
          createdAt: new Date().toISOString(),
        });
      } catch (error) {
        warnings.push(`部分图片未保留：${String(error.message).slice(0, 160)}`);
      }
    }
    if (!candidates.length)
      throw new Error(`没有取得可用参考图。${warnings[0] || '请先添加角色资料网页，或导入原图。'}`);
    warnings.unshift('候选来自社区索引或网页，不表示官方认证；请核对角色、服装和构图，再用于生成。');
    onProgress({ stage: 'references', detail: `已收集 ${candidates.length} 张实际图片，请核对参考。` });
    return { candidates, warnings: warnings.slice(0, 10) };
  }
  return { discoverReferences };
}
module.exports = { createVisualSources, pageImages, CATALOG_BASE };
