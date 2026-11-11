'use strict';
const { sourceUrl } = require('./sources.cjs');
const categories = ['personal', 'relationships', 'events', 'traits', 'voice'];
function validateDossier(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('人物资料格式无效。');
  const result = {};
  for (const category of categories) {
    const entries = value[category] ?? [];
    if (!Array.isArray(entries) || entries.length > 32) throw Error('每类人物资料最多32条。');
    result[category] = entries.map((item) => {
      if (
        !item ||
        typeof item.title !== 'string' ||
        !item.title.trim() ||
        item.title.length > 120 ||
        typeof item.detail !== 'string' ||
        !item.detail.trim() ||
        item.detail.length > 2000
      )
        throw Error('人物资料需包含标题和不超过2000字的内容。');
      const urls = item.sourceUrls ?? [];
      if (!Array.isArray(urls) || urls.length > 4) throw Error('每条资料最多4个来源。');
      const status = item.status ?? 'unverified';
      if (!['sourced', 'unverified', 'user'].includes(status) || typeof item.spoiler !== 'boolean')
        throw Error('人物资料出处或剧透标记无效。');
      const sourceUrls = [...new Set(urls.map(sourceUrl))];
      return {
        title: item.title.trim(),
        detail: item.detail.trim(),
        sourceUrls,
        status: status === 'sourced' && !sourceUrls.length ? 'unverified' : status,
        spoiler: item.spoiler,
      };
    });
  }
  return result;
}
function researchedDossier(value, sources = [], draft = false) {
  const allowed = new Set(sources.map((s) => s.url)),
    result = {};
  for (const category of categories)
    result[category] = (Array.isArray(value?.[category]) ? value[category] : [])
      .slice(0, 32)
      .flatMap((item) => {
        if (
          !item ||
          typeof item.title !== 'string' ||
          !item.title.trim() ||
          typeof item.detail !== 'string' ||
          !item.detail.trim()
        )
          return [];
        const sourceUrls = draft
          ? []
          : (Array.isArray(item.sourceUrls) ? item.sourceUrls : [])
              .filter((url) => allowed.has(url))
              .slice(0, 4);
        return [
          {
            title: item.title.trim().slice(0, 120),
            detail: item.detail.trim().slice(0, 2000),
            sourceUrls,
            status: sourceUrls.length ? 'sourced' : 'unverified',
            spoiler: item.spoiler === true,
          },
        ];
      });
  return validateDossier(result);
}
function dossierContext(character, latest = '') {
  const result = {},
    query = String(latest).toLowerCase(),
    allowSpoilers = character.roleplay?.spoilerPolicy === 'allow';
  let budget = 10000;
  for (const category of categories) {
    const items = (character.dossier?.[category] || []).filter((e) => allowSpoilers || !e.spoiler);
    const ranked = items
      .map((e, i) => ({
        e,
        i,
        score: [e.title, ...(e.title.match(/[\u4e00-\u9fff]{2}/g) || [])].reduce(
          (n, t) => n + (query.includes(t.toLowerCase()) ? 1 : 0),
          0,
        ),
      }))
      .sort((a, b) => b.score - a.score || a.i - b.i);
    result[category] = ranked.slice(0, category === 'voice' ? 6 : 4).flatMap(({ e }) => {
      const detail = e.detail.slice(0, 650),
        size = detail.length + e.title.length;
      if (size > budget) return [];
      budget -= size;
      return [{ title: e.title, detail, status: e.status, sourceUrls: e.sourceUrls.slice(0, 2) }];
    });
  }
  return result;
}
module.exports = { categories, validateDossier, researchedDossier, dossierContext };
