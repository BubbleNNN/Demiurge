'use strict';
const { randomUUID, createHash } = require('node:crypto');

function personaSignature(character) {
  // Visual pixels, window preferences and discovery candidates are not dialogue identity.
  const fields = [
    'id',
    'name',
    'work',
    'summary',
    'personality',
    'speakingStyle',
    'behavior',
    'quotes',
    'unknowns',
    'roleplay',
    'sources',
    'knowledge',
    'companion',
  ];
  return createHash('sha256')
    .update(JSON.stringify(Object.fromEntries(fields.map((key) => [key, character[key]]))))
    .digest('hex');
}
function createPersonaSessions({ now = Date.now, ttlMs = 30 * 60 * 1000, maxTurns = 8 } = {}) {
  const sessions = new Map(),
    epochs = new Map();
  function clear(owner) {
    sessions.delete(owner);
    epochs.set(owner, (epochs.get(owner) || 0) + 1);
  }
  function prepare({ owner, character, sessionId, text }) {
    if (typeof text !== 'string' || !text.trim() || text.length > 4000)
      throw new Error('请输入不超过 4000 字的试聊消息。');
    if (sessionId !== undefined && (typeof sessionId !== 'string' || sessionId.length > 64 || !sessionId))
      throw new Error('试聊会话无效，请开始新试聊。');
    const previous = sessions.get(owner),
      signature = personaSignature(character);
    if (sessionId && previous?.id !== sessionId) throw new Error('试聊会话已结束，请开始新试聊。');
    let resetReason;
    if (sessionId && previous.signature !== signature) resetReason = 'profile-changed';
    else if (sessionId && now() - previous.updatedAt > ttlMs) resetReason = 'expired';
    const base =
      sessionId && !resetReason ? previous : { id: randomUUID(), signature, turns: 0, messages: [] };
    if (base.turns >= maxTurns) throw new Error(`本次试聊已满 ${maxTurns} 轮，请开始新试聊。`);
    const epoch = epochs.get(owner) || 0;
    const messages = [...base.messages, { role: 'user', content: text.trim() }];
    return {
      messages: structuredClone(messages),
      commit(reply) {
        // Closing, restarting or a later committed request invalidates an old completion.
        if ((epochs.get(owner) || 0) !== epoch || sessions.get(owner) !== previous)
          throw new Error('试聊已结束，本次回复未加入新会话。');
        const current = {
          ...base,
          updatedAt: now(),
          turns: base.turns + 1,
          messages: [
            ...messages,
            { role: 'assistant', content: reply.text, emotion: reply.emotion, action: reply.action },
          ],
        };
        sessions.set(owner, current);
        return {
          ...reply,
          memory: null,
          preview: {
            sessionId: current.id,
            turnCount: current.turns,
            maxTurns,
            ...(resetReason ? { resetReason } : {}),
          },
        };
      },
    };
  }
  return { prepare, clear };
}
module.exports = { createPersonaSessions, personaSignature };
