'use strict';
const motions = require('../shared/pet-motions.json');
const candidateDirections = require('../shared/pet-candidate-directions.json');
const artStyles = require('../shared/art-styles.json');
const temperaments = {
  natural: { scale: 1, prompt: 'Natural restrained gestures, relaxed shoulders and a warm expression.' },
  gentle: {
    scale: 1.25,
    prompt:
      'Gentle quiet gestures with small joint movements and soft expressions. Keep every pose distinct.',
  },
  lively: {
    scale: 0.85,
    prompt:
      'Playful expressive gestures with readable anticipation and follow-through. Exaggerate the specified joints, not the camera or body scale.',
  },
};

function productionOptions(input = {}) {
  const frameCount = input.frameCount ?? 4;
  const candidateCount = input.candidateCount ?? 1;
  const candidateVariation = input.candidateVariation ?? 'subtle';
  if (![1, 2, 3].includes(candidateCount)) throw new Error('角色候选数量只能为一到三张。');
  if (!['subtle', 'explore'].includes(candidateVariation)) throw new Error('候选变化方式无效。');
  const temperament = input.temperament ?? 'natural';
  const artDirection = input.artDirection ?? '';
  if (![4, 8].includes(frameCount)) throw new Error('动作帧数只能选择四帧或八帧。');
  if (!Object.hasOwn(temperaments, temperament)) throw new Error('动作气质无效。');
  if (typeof artDirection !== 'string' || artDirection.length > 600)
    throw new Error('外观要求需为不超过 600 字的文字。');
  return { candidateCount, candidateVariation, frameCount, temperament, artDirection: artDirection.trim() };
}

function candidateRecipe(style, index, input = {}) {
  if (productionOptions(input).candidateVariation === 'subtle') return null;
  if (!Object.hasOwn(artStyles, style)) throw new Error('角色画风无效。');
  if (!Number.isInteger(index) || index < 1 || index > 3) throw new Error('候选方向编号只能为一到三。');
  const id = ['balanced', 'bold', 'soft'][index - 1];
  return { id, ...candidateDirections[id] };
}

function motionRecipe(id, input = {}) {
  const options = productionOptions(input);
  const motion = motions.find((m) => m.id === id);
  if (!motion) throw new Error('桌宠动作无效。');
  // Expressions are four independent portraits, never padded into eight frames.
  const count = id === 'emotions' ? 4 : motion.activity ? 8 : options.frameCount;
  return {
    ...motion,
    count,
    columns: count === 8 ? 4 : 2,
    rows: 2,
    size: count === 8 ? '1536x1024' : '1024x1024',
    poses: count === 8 ? motion.poses8 : motion.poses,
    direction: temperaments[options.temperament].prompt,
    tempo: temperaments[options.temperament].scale,
  };
}

function motionClip(name, indices, input = {}) {
  const recipe = motionRecipe(name, input);
  const count = indices.length;
  const time = (values) => values.map((ms) => Math.round(ms * recipe.tempo));
  if (recipe.activity)
    return {
      frames: [indices[3], indices[4], indices[5], indices[4]],
      durations: time([1500, 650, 1500, 650]),
      loop: true,
    };
  if (name === 'sleep') {
    const sleeping = count === 8 ? indices.slice(4) : indices.slice(2);
    return { frames: sleeping, durations: time(sleeping.map(() => (count === 8 ? 650 : 1300))), loop: true };
  }
  if (name === 'talk')
    return {
      frames: [0, ...indices.slice(1)],
      durations: time(count === 8 ? [100, 90, 110, 100, 90, 110, 100, 120] : [100, 140, 120, 150]),
      loop: true,
    };
  const timing = {
    blink: count === 8 ? [40, 35, 35, 40, 65, 40, 40, 60, 80] : [50, 70, 85, 75, 80],
    wave: count === 8 ? [100, 90, 100, 130, 140, 100, 90, 110, 150] : [100, 180, 220, 180, 160],
    nod: count === 8 ? [100, 70, 90, 110, 140, 90, 80, 100, 140] : [100, 140, 180, 140, 140],
    shake: count === 8 ? [100, 90, 130, 80, 90, 130, 90, 100, 140] : [100, 170, 170, 130, 140],
    bounce: count === 8 ? [100, 80, 110, 65, 120, 65, 100, 120, 140] : [100, 130, 180, 120, 140],
  };
  return { frames: [0, ...indices.slice(1), 0], durations: time(timing[name]), loop: false };
}

function activityTransitions(name, indices, input = {}) {
  const recipe = motionRecipe(name, input);
  if (!recipe.activity) return {};
  const clip = (frames) => ({
    frames: frames.map((i) => indices[i]),
    durations: [280, 400, 400, 280].map((ms) => Math.round(ms * recipe.tempo)),
    loop: false,
  });
  return { [`enter_${name}`]: clip([0, 1, 2, 3]), [`exit_${name}`]: clip([5, 6, 7, 0]) };
}
module.exports = { productionOptions, candidateRecipe, motionRecipe, motionClip, activityTransitions };
