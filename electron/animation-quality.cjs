'use strict';
const { createHash } = require('node:crypto');
function animationDigest(animation) {
  const validated = require('./sprites.cjs').validateAnimation(animation);
  validated.clips = Object.fromEntries(
    Object.entries(validated.clips).sort(([a], [b]) => a.localeCompare(b)),
  );
  return createHash('sha256').update(JSON.stringify(validated)).digest('hex');
}
// Technical PNG validation cannot prove anatomy or identity. Require an
// explicit, pixel-bound visual review before releasing generated animation.
function validateFrameReview(animation, digest, input) {
  if (!input || input.imageDigest !== digest || input.animationDigest !== animationDigest(animation))
    throw new Error('动画素材已变化，或尚未逐帧核对，请重新检查当前图集。');
  if (input.anatomy !== true || input.identity !== true || input.continuity !== true)
    throw new Error('请确认每帧的肢体数量与连接、角色一致性和动作衔接。');
  const frames = input.frames;
  if (
    !Array.isArray(frames) ||
    frames.length !== animation.frames.length ||
    new Set(frames).size !== frames.length ||
    frames.some((index) => !Number.isInteger(index) || index < 0 || index >= animation.frames.length)
  )
    throw new Error('请逐帧检查完整动画；未检查的帧不能启用为桌宠。');
  return { frames: [...frames].sort((a, b) => a - b), anatomy: true, identity: true, continuity: true };
}

function assertPoseRelease(records, review) {
  if (!Array.isArray(review) || review.length !== records.length)
    throw new Error('发布动画前必须核对全部姿势帧。');
  for (let i = 0; i < records.length; i++) {
    const item = review[i];
    if (
      item?.sha256 !== records[i].sha256 ||
      item.status !== 'approved' ||
      item.anatomy !== true ||
      item.identity !== true ||
      item.continuity !== true
    )
      throw new Error(`姿势帧 ${i + 1} 尚未通过视觉验收，或验收记录与像素不匹配。`);
  }
}
module.exports = { validateFrameReview, assertPoseRelease, animationDigest };
