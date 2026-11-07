'use strict';
const { parseHTML } = require('linkedom');
const { Readability } = require('@mozilla/readability');

function sourceUrl(value) {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !['80', '443'].includes(url.port))
  )
    throw new Error('资料链接只支持不含凭据的公开 HTTP(S) 网页。');
  for (const key of url.searchParams.keys()) {
    if (/^(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret)$/i.test(key))
      throw new Error('资料链接不能包含密钥或登录凭据。');
  }
  url.hash = '';
  return url.href;
}

function extractSource(bytes, contentType, address) {
  const url = sourceUrl(address);
  const raw = bytes.toString('utf8');
  let title = new URL(url).hostname;
  let body;
  if (/text\/plain/i.test(contentType)) body = raw;
  else if (/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    const { document } = parseHTML(raw);
    title = document.querySelector('title')?.textContent || title;
    for (const node of document.querySelectorAll('script,style,noscript,nav,footer,form,iframe,svg'))
      node.remove();
    for (const node of document.querySelectorAll('p,li,br,h1,h2,h3,tr'))
      node.appendChild(document.createTextNode('\n'));
    const article = new Readability(document, { charThreshold: 80 }).parse();
    body = article?.textContent;
    title = article?.title || title;
    if (!body) {
      body = (document.querySelector('article,main') || document.body)?.textContent;
    }
  } else throw new Error('资料链接需返回 HTML 或纯文本；图片、PDF 和其他二进制文件暂不支持。');
  body = String(body || '')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();
  if (body.length < 60) throw new Error('页面没有可读取的正文，可能需要登录或由脚本动态加载。');
  return { title: title.trim().slice(0, 200), url, snippet: body.slice(0, 8000) };
}

function normalizeSources(items, limit = 12, snippetLimit = 8000) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).slice(0, 100).flatMap((item) => {
    try {
      if (seen.size >= limit) return [];
      const url = sourceUrl(item.url);
      const snippet = String(item.snippet || item.content || '')
        .trim()
        .slice(0, snippetLimit);
      if (seen.has(url) || !snippet) return [];
      seen.add(url);
      return [{ title: String(item.title || new URL(url).hostname).slice(0, 200), url, snippet }];
    } catch {
      return [];
    }
  });
}

module.exports = { sourceUrl, extractSource, normalizeSources };
