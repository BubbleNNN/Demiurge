'use strict';
function chatRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('聊天请求格式无效。');
  const characterId = input.characterId ?? input.character?.id;
  const latestMessageId = input.latestMessageId ?? input.messages?.at?.(-1)?.id;
  for (const id of [characterId, latestMessageId])
    if (typeof id !== 'string' || !id || id.length > 128) throw Error('请先保存角色和当前消息，再发送。');
  if (input.skinId !== undefined && (typeof input.skinId !== 'string' || input.skinId.length > 128))
    throw Error('聊天外观编号无效。');
  return { characterId, latestMessageId, skinId: input.skinId, situation: input.situation };
}
module.exports = { chatRequest };
