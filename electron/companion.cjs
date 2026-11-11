'use strict';
// Authored responses and explicit keyword rules. No model, network or inferred biography.
const intents = [
  ['comfort', /难过|伤心|焦虑|烦躁|不开心|压力|鼓励|安慰|撑不住|心情不好/iu],
  ['wake', /醒醒|起床|醒来|唤醒/iu],
  ['rest', /晚安|睡觉|睡吧|休息|困了/iu],
  ['thanks', /谢谢|感谢|多谢/iu],
  ['farewell', /再见|拜拜|回头见|离开了/iu],
  ['focus', /专心|专注|学习|工作|写作业/iu],
  ['greet', /你好|早安|早上好|晚上好|下午好|嗨|^hi\b|^hello\b/iu],
];
const rules = require('../shared/companion-events.json');
function detectIntent(text) {
  // Negated rest requests should not put a companion to sleep.
  if (/(不想|不要|别|不许).{0,6}(睡|休息)/u.test(text)) return 'unknown';
  return intents.find(([, rule]) => rule.test(text))?.[0] || 'unknown';
}
function localReply({ character, messages, availableActions = ['idle'], availableEmotions, event }) {
  const intent = Object.hasOwn(rules, event) ? event : detectIntent(messages?.at(-1)?.content || '');
  const rule = rules[intent];
  const authored = character.companion?.replies?.[intent];
  const lines = authored?.length ? authored : rule.lines;
  const turns = (messages || []).filter(
    (message) =>
      message.role === 'assistant' &&
      message.origin === 'script' &&
      (message.interaction === intent || (!message.interaction && lines.includes(message.content))),
  ).length;
  const energeticTouch =
    intent === 'touch' && character.behavior.energy >= 65 && character.behavior.affection >= 50;
  const baseActions = character.behavior.energy < 35 ? rule.quietActions : rule.actions;
  const actions = energeticTouch ? ['wave', ...baseActions] : baseActions;
  let face = character.behavior.affection < 35 ? rule.reservedEmotion : rule.emotion;
  let touchActions;
  if (intent === 'headpat' || intent === 'poke') {
    const traits = [character.summary, ...(character.personality || []), character.speakingStyle].join(' ');
    const manner = character.desktopProfile?.manner;
    const reserved = character.behavior.affection < 35 || /害羞|内向|冷静|沉稳|shy|calm/iu.test(traits) ||
      (manner && Math.max(manner.calm || 0, manner.shy || 0) >= Math.max(0.5, manner.playful || 0, manner.teasing || 0));
    face = reserved ? 'neutral' : 'happy';
    touchActions = reserved ? ['idle'] : intent === 'poke' && /活泼|元气|playful/iu.test(traits)
      ? ['wave', 'nod', 'idle'] : ['nod', 'idle'];
  }
  return {
    text: lines[turns % lines.length],
    emotion: !availableEmotions || availableEmotions.includes(face) ? face : 'neutral',
    action: (touchActions || actions).find((action) => availableActions.includes(action)) || 'idle',
    memory: null,
    origin: 'script',
    interaction: intent,
  };
}
module.exports = { localReply, detectIntent };
