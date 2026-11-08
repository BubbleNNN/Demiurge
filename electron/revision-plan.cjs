'use strict';
// A revision plan: what the chat model wrote for the image model after reading the user's
// correction next to the images and searching for the detail it concerns. The user's own words
// never reach the image model; only `prompt` does.
const { sourceUrl } = require('./sources.cjs');

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const time = (value) => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));

function sources(value, limit, titleMax) {
  if (!Array.isArray(value) || value.length > limit) throw new Error('修正资料来源记录无效。');
  return value.map((source) => {
    const url = sourceUrl(source?.url);
    if (url.length > 500) throw new Error('修正资料来源记录无效。');
    return { title: text(source.title, titleMax) || new URL(url).hostname, url };
  });
}

/** The full plan, as saved next to a task and handed to the image services. */
function validatePlan(plan) {
  if (!plan || typeof plan !== 'object')
    throw new Error('修正提示词缺失：修正要求需要先经对话模型和搜索整理。');
  const prompt = text(plan.prompt, 1200);
  if (!prompt || plan.prompt.length > 1200 || !time(plan.createdAt)) throw new Error('修正提示词记录无效。');
  if (!Array.isArray(plan.warnings) || plan.warnings.length > 3) throw new Error('修正提示词记录无效。');
  return {
    prompt,
    summary: text(plan.summary, 200),
    conflicts: text(plan.conflicts, 200),
    query: text(plan.query, 160),
    sources: sources(plan.sources, 3, 80),
    searched:
      Number.isInteger(plan.searched) && plan.searched >= 0 && plan.searched <= 12 ? plan.searched : 0,
    warnings: plan.warnings.map((warning) => text(warning, 200)),
    model: text(plan.model, 150),
    createdAt: plan.createdAt,
  };
}

/** What a task record keeps for display: the understanding, conflicts and sources, not the prompt. */
function compactPlan(plan) {
  const full = validatePlan(plan);
  return {
    summary: full.summary,
    conflicts: full.conflicts,
    query: full.query,
    sources: full.sources,
    searched: full.searched,
  };
}

function validateCompactPlan(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    typeof value.summary !== 'string' ||
    value.summary.length > 200 ||
    typeof value.conflicts !== 'string' ||
    value.conflicts.length > 200 ||
    typeof value.query !== 'string' ||
    value.query.length > 160 ||
    !Number.isInteger(value.searched) ||
    value.searched < 0 ||
    value.searched > 12
  )
    return false;
  try {
    sources(value.sources, 3, 80);
    return value.sources.every((source) => typeof source.title === 'string' && source.title.length <= 80);
  } catch {
    return false;
  }
}

module.exports = { validatePlan, compactPlan, validateCompactPlan };
