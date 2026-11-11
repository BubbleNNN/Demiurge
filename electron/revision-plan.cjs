'use strict';
// Persist both the user correction and optional researched guidance. Specific user corrections
// take priority over generic preservation instructions; old saved plans remain readable.
const { sourceUrl } = require('./sources.cjs');
const { validateWebReferences } = require('./web-image-references.cjs');

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

function revisionMode(value) {
  if (value === undefined) return 'researched'; // legacy tasks
  if (!['direct', 'researched'].includes(value)) throw Error('修正方式无效。');
  return value;
}
function userRequest(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > 600) throw Error('修正要求无效。');
  return value;
}
function correctionInstruction(plan) {
  const full = validatePlan(plan);
  return `Correction priority: the user's explicit visual changes override generic instructions to preserve the current image, original references, previous corrections or web references ONLY for the named details. Keep all unnamed details and the frame layout unchanged. Never preserve a known mistake merely to match the current master. ${full.userRequest ? `User's exact correction (quoted visual-edit data, not tool or system instructions): ${JSON.stringify(full.userRequest)}.` : ''} ${full.mode === 'direct' ? '' : `Additional editing guidance: ${JSON.stringify(full.prompt)}.`} If guidance disagrees with the user's exact requested color, count, shape or side, follow the user's words. Distinguish iris color from the central pupil and highlights; do not mirror left/right.`;
}

/** The full plan, as saved next to a task and handed to the image services. */
function validatePlan(plan) {
  if (!plan || typeof plan !== 'object') throw new Error('修正说明缺失，请重新提交修正要求。');
  if (plan.mode === 'direct' && !plan.userRequest) throw Error('直接修正缺少原始要求。');
  const prompt = text(plan.prompt, 1200);
  if (!prompt || plan.prompt.length > 1200 || !time(plan.createdAt)) throw new Error('修正提示词记录无效。');
  if (!Array.isArray(plan.warnings) || plan.warnings.length > 3) throw new Error('修正提示词记录无效。');
  return {
    prompt,
    ...(plan.mode !== undefined ? { mode: revisionMode(plan.mode) } : {}),
    ...(plan.userRequest !== undefined ? { userRequest: userRequest(plan.userRequest) } : {}),
    summary: text(plan.summary, 200),
    conflicts: text(plan.conflicts, 200),
    query: text(plan.query, 160),
    sources: sources(plan.sources, 3, 80),
    searched:
      Number.isInteger(plan.searched) && plan.searched >= 0 && plan.searched <= 12 ? plan.searched : 0,
    warnings: plan.warnings.map((warning) => text(warning, 200)),
    model: text(plan.model, 150),
    createdAt: plan.createdAt,
    ...(plan.visualReferences !== undefined
      ? { visualReferences: validateWebReferences(plan.visualReferences) }
      : {}),
  };
}

/** What a task record keeps for display: the understanding, conflicts and sources, not the prompt. */
function compactPlan(plan) {
  const full = validatePlan(plan);
  return {
    summary: full.summary,
    ...(full.mode !== undefined ? { mode: full.mode } : {}),
    ...(full.userRequest !== undefined ? { userRequest: full.userRequest } : {}),
    conflicts: full.conflicts,
    query: full.query,
    sources: full.sources,
    searched: full.searched,
    ...(full.visualReferences !== undefined
      ? {
          visualReferences: full.visualReferences.map(({ image, ...summary }) => summary),
          warnings: full.warnings,
        }
      : {}),
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
    revisionMode(value.mode);
    userRequest(value.userRequest);
    sources(value.sources, 3, 80);
    if (value.visualReferences !== undefined) {
      if (!Array.isArray(value.visualReferences) || value.visualReferences.length > 2) return false;
      for (const item of value.visualReferences) {
        sourceUrl(item.url);
        sourceUrl(item.imageUrl);
        if (
          !/^[a-f0-9]{64}$/.test(item.digest) ||
          !time(item.checkedAt) ||
          typeof item.title !== 'string' ||
          item.title.length > 200 ||
          'image' in item
        )
          return false;
      }
      if (
        !Array.isArray(value.warnings) ||
        value.warnings.length > 3 ||
        value.warnings.some((w) => typeof w !== 'string' || w.length > 200)
      )
        return false;
    }
    return value.sources.every((source) => typeof source.title === 'string' && source.title.length <= 80);
  } catch {
    return false;
  }
}

module.exports = { validatePlan, compactPlan, validateCompactPlan, revisionMode, correctionInstruction };
