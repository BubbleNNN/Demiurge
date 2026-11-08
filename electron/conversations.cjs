'use strict';
function requestHistory(messages, latestMessageId) {
  const latest = messages.findIndex((message) => message.id === latestMessageId);
  if (latest < 0 || messages[latest].role !== 'user') throw new Error('这条消息尚未保存，请重新发送。');
  let start = 0;
  for (let index = latest; index >= 0; index--) {
    if (messages[index].role === 'user' && messages[index].contextStart) {
      start = index;
      break;
    }
  }
  const topic = messages.slice(start, latest + 1);
  const userIds = new Set(topic.filter((message) => message.role === 'user').map((message) => message.id));
  return topic.filter((message) => !message.replyTo || userIds.has(message.replyTo));
}
function formatChat(character, messages) {
  const oneLine = (value) => String(value || '').replace(/[\r\n]+/g, ' ');
  return [
    `Demiurge · ${oneLine(character.name)}`,
    character.work ? `作品：${oneLine(character.work)}` : '原创角色',
    `共 ${messages.length} 条消息`,
    '',
    ...messages.flatMap((message) => [
      ...(message.contextStart ? ['—— 新话题 ——', ''] : []),
      `[${message.createdAt}] ${message.role === 'assistant' ? oneLine(character.name) : '你'}`,
      message.content,
      '',
    ]),
  ].join('\n');
}
module.exports = { formatChat, requestHistory };
