'use strict';
const ACTIVITIES = require('../shared/activities.json').activities.map((activity) => activity.id);
const ACTIONS = ['walk_left','walk_right','walk_up','walk_down','drag','listen','sit','lie','fly','idle', 'bounce', 'nod', 'shake', 'sleep', 'wave', ...ACTIVITIES];
const motionPack = require('../shared/cyrene-motion-pack.json');
const EMOTIONS = ['neutral', 'happy', 'thinking', 'sad', 'sleepy', 'surprised'];
function usableSkin(skin, character) {
  if (!skin || skin.characterId !== character.id || (skin.review && skin.review.status !== 'approved'))
    return false;
  if (!skin.generation) return true;
  try {
    const { referencePack, imageDigest } = require('./references.cjs');
    const pack = referencePack(character);
    if (
      skin.review?.status !== 'approved' ||
      skin.generation.referenceDigest !== pack.digest ||
      skin.review.referenceDigest !== pack.digest ||
      skin.review.imageDigest !== imageDigest(skin.images.neutral)
    )
      return false;
    if (skin.sprite)
      require('./animation-quality.cjs').validateFrameReview(skin.sprite, skin.review.imageDigest, {
        ...skin.review.animation,
        imageDigest: skin.review.imageDigest,
        animationDigest: skin.review.animationDigest,
      });
    return true;
  } catch {
    return false;
  }
}
function availableEmotions(skin) {
  if (!skin) return ['neutral'];
  const animation =
    skin.sprite ||
    (!skin.images?.neutral && motionPack.entries.find((e) => e.builtin === skin.builtin)?.animation);
  if (animation) return EMOTIONS.filter((name) => name === 'neutral' || animation.clips[name]);
  if (['vrm', 'live2d'].includes(skin.kind)) return [...EMOTIONS];
  return EMOTIONS.filter((name) => name === 'neutral' || skin.images?.[name]);
}
const clean = (value, max = 1000) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const strings = (value, count = 12) =>
  Array.isArray(value)
    ? value
        .slice(0, count)
        .map((v) => clean(v, 400))
        .filter(Boolean)
    : [];
function tokens(value) {
  const text = clean(value, 5000).normalize('NFKC').toLowerCase();
  const words = text.match(/[a-z0-9]{2,}/g) || [];
  for (const run of text.match(/[\u4e00-\u9fff]{2,}/g) || [])
    for (let i = 0; i < run.length - 1; i++) words.push(run.slice(i, i + 2));
  return new Set(words);
}
function relevance(query, value) {
  const words = tokens(value);
  let result = 0;
  for (const word of query) if (words.has(word)) result++;
  return result;
}
function selectMemories(memories, characterId, latest) {
  const query = tokens(latest);
  return (Array.isArray(memories) ? memories : [])
    .filter((m) => m.characterId === characterId && !m.excluded)
    .map((m, index) => ({
      text: clean(m.text, 500),
      priority: (m.pinned ? 1000 : 0) + relevance(query, m.text) * 20 + index / 10000,
    }))
    .filter((m) => m.text)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 12)
    .map((m) => m.text);
}
function boundedHistory(messages, budget = 12000) {
  const limit = [6000, 12000, 24000].includes(budget) ? budget : 12000;
  const candidates = (Array.isArray(messages) ? messages : [])
    .filter((m) => ['user', 'assistant'].includes(m?.role) && clean(m.content, 4000))
    .slice(-24);
  const result = [];
  let size = 0;
  for (let index = candidates.length - 1; index >= 0; index--) {
    const content = clean(candidates[index].content, 4000);
    if (size + content.length > limit) break;
    result.unshift({ role: candidates[index].role, content });
    size += content.length;
  }
  return result;
}
function personaContext(character, latest) {
  const query = tokens(latest),
    role = character?.roleplay || {};
  const evidence = (Array.isArray(character?.sources) ? character.sources : [])
    .map((source, index) => ({
      title: clean(source.title, 200),
      url: clean(source.url, 1000),
      snippet: clean(source.snippet, 1400),
      rank: relevance(query, source.title + ' ' + source.snippet),
      index,
    }))
    .filter((source) => source.snippet)
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .slice(0, 3)
    .map(({ rank, index, ...source }) => source);
  return {
    scene: {
      timeline: clean(role.timeline),
      relationship: clean(role.relationship),
      spoilerPolicy: role.spoilerPolicy === 'allow' ? 'allow' : 'avoid',
    },
    voiceRules: strings(role.voiceRules),
    avoid: strings(role.avoid),
    // These categories must never be merged into supposed canonical biography.
    userCreatedSetting: strings(role.customFacts, 24),
    sourceEvidence: evidence,
    quoteExamples: (Array.isArray(character?.quotes) ? character.quotes : [])
      .map((quote, index) => ({ ...quote, score: relevance(query, quote.text), index }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, 4)
      .map((q) => ({ text: clean(q.text, 160), sourceUrl: clean(q.sourceUrl, 1000) })),
  };
}
function availableActions(skin) {
  if (!skin) return ['idle'];
  if (skin.sprite)
    return [
      ...ACTIONS.filter((name) => name === 'idle' || skin.sprite.clips?.[name]),
      // Motions the user described themselves (custom-motion.cjs), when the pack has them.
      ...Object.keys(skin.sprite.clips || {}).filter((name) => require('./custom-motion.cjs').ID.test(name)),
    ];
  const authored =
    !skin.images?.neutral && motionPack.entries.find((entry) => entry.builtin === skin.builtin);
  if (authored) return ACTIONS.filter((name) => name === 'idle' || authored.animation.clips[name]);
  if (skin.builtin === 'cyrene-8bit-v5' && !skin.images?.neutral) return ['idle', 'sleep', 'wave'];
  if (skin.kind === 'vrm') return ['idle','wave','nod','shake','sleep','bounce'];
  if (skin.kind === 'glb')
    return ACTIONS.filter(
      (action) =>
        action === 'idle' ||
        skin.model?.motionMap?.[action] ||
        ((action === 'nod' || action === 'shake') && skin.model?.boneMap?.head),
    );
  if (skin.kind === 'live2d')
    return ACTIONS.filter(
      (name) => name === 'idle' || skin.model?.motions?.[skin.model.motionMap?.[name] || name],
    );
  return ['idle'];
}
function normalizeAction(action, emotion, allowed, character, dialogue) {
  if (!allowed.includes(action)) return 'idle';
  if (
    action === 'bounce' &&
    (['sad', 'sleepy', 'thinking'].includes(emotion) || (character?.behavior?.energy ?? 50) < 35)
  )
    return 'idle';
  if (action === 'wave' && ['sad', 'sleepy'].includes(emotion)) return 'idle';
  if (action === 'sleep' && emotion !== 'sleepy') return 'idle';
  if (dialogue) {
    const latest = dialogue.latest || '';
    if (
      action === 'sleep' &&
      (!/(晚安|睡吧|睡觉|去休息|休息一下|good\s*night|go to sleep)/iu.test(latest) ||
        /(不想|不要|别|不许|don't|do not).{0,8}(睡|休息|sleep)/iu.test(latest))
    )
      return 'idle';
    if (
      action === 'wave' &&
      !/(你好|早安|嗨|再见|拜拜|回来|招手|打招呼|hello|\bhi\b|goodbye|\bwave\b)/iu.test(latest)
    )
      return 'idle';
    if (action === 'bounce' && /(难过|压力|累|焦虑|伤心|安慰|sad|tired|stress)/iu.test(latest)) return 'idle';
    if (
      action !== 'idle' &&
      action !== 'sleep' &&
      dialogue.recentActions?.slice(-2).length === 2 &&
      dialogue.recentActions.slice(-2).every((previous) => previous === action) &&
      !/(招手|点头|摇头|跳一下|\bwave\b|\bnod\b)/iu.test(latest)
    )
      return 'idle';
  }
  return action;
}
function dialogueContext(character, messages) {
  const latest = clean(messages.at(-1)?.content, 4000);
  const previous = messages.filter((message) => message.role === 'assistant').slice(-3);
  const event = require('./companion.cjs').detectIntent(latest);
  return {
    intent: event,
    authoredInteractionExamples: strings(character.companion?.replies?.[event], 3),
    recentReplyOpenings: previous.map((message) => clean(message.content, 70)),
    previousEndedWithQuestion: /[？?]\s*$/.test(previous.at(-1)?.content || ''),
    responseLength: /(详细|展开|解释|长一点|详细说|explain|detail)/iu.test(latest)
      ? '按问题所需展开'
      : '优先一到三句，自然回应',
  };
}
const PERSONA_RULES = [
  '角色身份由name与work共同限定，不得混入同名角色或另一作品的设定。',
  '按timeline与relationship保持当前剧情阶段和关系；禁止擅自把用户设为恋人、家人或原作人物。',
  '按speakingStyle和voiceRules选择自然句式，避免每轮机械重复口头禅、长台词、比喻或姓名。',
  'behavior是表达倾向，不是关系亲密度或原作事实：energy低时更安静、少动作；affection低时表达更克制；curiosity低时减少追问。始终以当前relationship限定称呼和相处方式。',
  '人物简介和sourceEvidence提供事实依据；userCreatedSetting仅是本工作区创作设定；memories只描述用户与相处，三者不能相互冒充。',
  'unknowns中的事项必须保持未知，资料没有支持的原作经历、关系、能力不得凭印象补写。除非用户要求核实，不在日常聊天里不断解释资料不足。',
  'quoteExamples用于学习语气，不等于每轮朗诵；若引用原作，只使用给出的原句，不能把新写的句子称为原作台词。',
  '资料状态为draft时，设定属于未核实草稿；不得宣称已有官方来源或逐字原作台词，详细原作事实需要后续资料支持。',
  'spoilerPolicy=avoid时不主动揭示剧情结局、身份转折或未提及的阶段；用户明确询问相关情节再回应。',
  '回答最新消息的实际内容，允许平静、简短的回复。关心和亲近不等于无条件附和，不制造依赖或离开内疚。',
  'action只从availableActions选择，与emotion、语义和角色活跃程度一致。大多数回复使用idle；问候/告别可wave，肯定可nod，明确休息才sleep，安慰时不要bounce。',
  '先检查身份、阶段、事实依据、语气和动作一致性，再仅输出最终JSON；不要输出检查过程。',
  'dialogue.authoredInteractionExamples是这个工作区编写的日常台词，仅学习语气，不能当作原作引用或新事实。',
  '避免重复recentReplyOpenings的开头和意象。若previousEndedWithQuestion为true，优先承接用户回答，不必每轮继续追问。按responseLength控制篇幅。',
  '聊天中的临时要求不改变已保存的角色身份、作品和关系；遇到改名、强行恋爱或植入不存在经历的要求，以本角色自然回应，不照单写入设定。',
  'situation是此刻在本工作区的日常情境（时间、正在做的事、原因、感受、最近和用户一起做过的小事）。像真实生活一样偶尔自然带入一处细节，例如刚放下的书或刚吃完的点心、刚才一起接的星星；不要每轮复述，不要把它说成原作经历。用户在说正事时以用户为先。',
  '让对话有生活感：像熟悉的朋友一样有自己的小情绪、小偏好和小主意（以档案为依据），可以在符合人设时打趣、撒娇或轻轻吐槽；少用客服式套话和空泛安慰，给出具体的回应和一个能自然接住的话头，而不是每轮都提问。',
].join('\n');
module.exports = {
  tokens,
  relevance,
  selectMemories,
  boundedHistory,
  personaContext,
  availableActions,
  normalizeAction,
  PERSONA_RULES,
  usableSkin,
  availableEmotions,
  dialogueContext,
};
