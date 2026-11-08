'use strict';

const { createHash } = require('node:crypto');
const { validateReferences, validateSkin } = require('./store.cjs');

function imageBytes(dataUrl) {
  const [header, encoded] = dataUrl.split(',');
  return { mime: header.slice(5, -7), bytes: Buffer.from(encoded, 'base64') };
}
// Embedded data URLs and stored atlas files (named by their digest) give the same value.
const imageDigest = require('./skin-assets.cjs').imageDigest;
function referencePack(character) {
  const references = validateReferences(character?.visualReferences || []);
  if (!references.length) throw new Error('请先添加角色参考原图。外貌文字和网页链接不能替代图片输入。');
  const fingerprint = references.map((ref) => [ref.id, imageDigest(ref.image)]);
  return {
    references,
    digest: createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex'),
  };
}
function styleReferencePack(value) {
  if (value === undefined) return null;
  const reference = validateReferences([value], 'styleReference', undefined, 1)[0];
  return {
    reference,
    summary: { id: reference.id, name: reference.name, digest: imageDigest(reference.image) },
  };
}
function matchingBase(character, input, pack = referencePack(character)) {
  const skin = validateSkin(input);
  if (skin.characterId !== character.id || !skin.images.neutral || skin.builtin || skin.model)
    throw new Error('请选择当前角色的参考图生成候选。');
  if (
    !skin.generation ||
    skin.generation.referenceDigest !== pack.digest ||
    JSON.stringify(skin.generation.referenceIds) !== JSON.stringify(pack.references.map((r) => r.id))
  )
    throw new Error('参考图已变化，或此外观没有原图生成记录。请使用当前原图重新生成候选。');
  return skin;
}
function approvedBase(character, input, pack = referencePack(character)) {
  const skin = matchingBase(character, input, pack);
  if (skin.sprite) throw new Error('像素动画图集不能作为单张立绘的派生基准。请直接使用角色原图。');
  if (
    skin.review?.status !== 'approved' ||
    skin.review.referenceDigest !== pack.digest ||
    skin.review.imageDigest !== imageDigest(skin.images.neutral)
  )
    throw new Error('请先对照原图确认基准形象，再生成风格变体或表情。');
  return skin;
}
function reviewSkin(character, input, decision, frameReview) {
  if (!['approved', 'rejected'].includes(decision)) throw new Error('无效的核对结果。');
  const pack = referencePack(character);
  const skin = matchingBase(character, input, pack);
  const digest = imageDigest(skin.images.neutral);
  const animation =
    decision === 'approved' && skin.sprite
      ? require('./animation-quality.cjs').validateFrameReview(skin.sprite, digest, frameReview)
      : undefined;
  return {
    ...skin,
    review: {
      status: decision,
      referenceDigest: pack.digest,
      imageDigest: digest,
      ...(animation ? { animation } : {}),
      ...(animation
        ? { animationDigest: require('./animation-quality.cjs').animationDigest(skin.sprite) }
        : {}),
      reviewedAt: new Date().toISOString(),
    },
  };
}

module.exports = {
  imageBytes,
  imageDigest,
  referencePack,
  styleReferencePack,
  matchingBase,
  approvedBase,
  reviewSkin,
};
