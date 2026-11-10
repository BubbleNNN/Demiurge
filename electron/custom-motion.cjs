'use strict';
// Motions the user describes in their own words ("add a swing motion"). The chat model turns the
// instruction into a recipe of the same shape as the built-in ones in shared/pet-motions.json,
// which the image pipeline draws and packs exactly like them. Two kinds:
// - gesture: plays once from her resting pose and back (like waving): 4 and 8 poses.
// - pose: she gets into it, it loops, she gets out (like sitting, or swinging on a swing): 12
//   stages (entrance, loop, exit) for current tasks and 8 poses for older ones.
// The first and last pose are always her exact resting pose, in the built-in wording.

const ID = /^custom_[a-z][a-z0-9]{0,19}$/;
// Clip names a custom motion adds to a pack.
const CLIP = /^(?:enter_|exit_)?custom_[a-z][a-z0-9]{0,19}$/;
const MAX = 12;
const REST = 'exact neutral resting pose of image 1, arms relaxed, same body center and ground line';
const STAND = 'exact neutral empty-handed standing master pose, same body center and ground line';
const PACES = { slow: 1.3, normal: 1, quick: 0.75 };

const fail = () => {
  throw new Error('自定义动作记录无效。');
};
const text = (value, min, max) => {
  if (typeof value !== 'string') fail();
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length < min || clean.length > max) fail();
  return clean;
};
function list(value, count) {
  if (!Array.isArray(value) || value.length !== count) fail();
  const poses = value.map((pose) => text(pose, 6, 240));
  if (new Set(poses.map((pose) => pose.toLowerCase())).size < count - 1) fail();
  return poses;
}

/** A checked recipe; the rest poses are always the built-in ones. */
function validateCustomMotion(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const id = text(value.id, 8, 27);
  if (!ID.test(id)) fail();
  const kind = value.kind;
  if (kind !== 'gesture' && kind !== 'pose') fail();
  const pace = value.pace ?? 'normal';
  if (!Object.hasOwn(PACES, pace)) fail();
  // Her resting pose opens (and closes) every motion in the built-in wording, whatever the plan
  // said there; the rest is checked as written.
  const rest = kind === 'pose' ? STAND : REST;
  const framed = (poses, count, ends) =>
    Array.isArray(poses) && poses.length === count
      ? poses.map((pose, i) => (ends.includes(i) ? rest : pose))
      : poses;
  const motion = {
    id,
    name: text(value.name, 1, 12),
    description: text(value.description, 2, 80),
    kind,
    pace,
    poses: list(framed(value.poses, 4, [0]), 4),
    poses8: list(framed(value.poses8, 8, [0, 7]), 8),
  };
  if (kind === 'pose') motion.stages = list(framed(value.stages, 12, [0, 11]), 12);
  return motion;
}

function validateCustomMotions(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX) fail();
  const motions = value.map(validateCustomMotion);
  if (new Set(motions.map((m) => m.id)).size !== motions.length) fail();
  return motions;
}

/** What a finished look keeps about its custom motions: enough to list and describe them. */
function motionLabels(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX) throw new Error('自定义动作名称无效。');
  const labels = value.map((m) => {
    if (!m || typeof m !== 'object' || !ID.test(m.id) || !['gesture', 'pose'].includes(m.kind))
      throw new Error('自定义动作名称无效。');
    const name = typeof m.name === 'string' ? m.name.trim() : '';
    const description = typeof m.description === 'string' ? m.description.trim() : '';
    if (!name || name.length > 12 || description.length > 80) throw new Error('自定义动作名称无效。');
    return { id: m.id, name, description, kind: m.kind };
  });
  if (new Set(labels.map((m) => m.id)).size !== labels.length) throw new Error('自定义动作名称无效。');
  return labels;
}

/** A free id for a motion, from a short English word the model suggested. */
function freeId(slug, taken) {
  const base =
    'custom_' +
    (String(slug || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .replace(/^[0-9]+/, '')
      .slice(0, 16) || 'move');
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base.slice(0, 24)}${n}`;
  return id;
}

module.exports = {
  ID,
  CLIP,
  PACES,
  validateCustomMotion,
  validateCustomMotions,
  motionLabels,
  freeId,
};
