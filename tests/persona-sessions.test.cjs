'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPersonaSessions, personaSignature } = require('../electron/persona-sessions.cjs');
const character = {
  id: 'fixture',
  name: '测试角色',
  work: '测试世界',
  speakingStyle: '简短、克制',
  roleplay: { relationship: '朋友' },
};
const reply = {
  text: '我记住这句话了。',
  emotion: 'neutral',
  action: 'idle',
  memory: 'must never save this',
};
const input = { owner: 1, character, text: '我们聊到哪了' };

test('preview carries only its own committed turns and strips any proposed memory', () => {
  const sessions = createPersonaSessions();
  const first = sessions.prepare(input);
  assert.deepEqual(first.messages, [{ role: 'user', content: input.text }]);
  const completed = first.commit(reply);
  assert.equal(completed.memory, null);
  const next = sessions.prepare({ ...input, sessionId: completed.preview.sessionId, text: '继续上一句' });
  assert.deepEqual(
    next.messages.map((message) => message.content),
    [input.text, reply.text, '继续上一句'],
  );
  assert.equal(next.messages[1].action, 'idle');
  const third = next.commit(reply);
  assert.equal(third.preview.turnCount, 2);
});
test('a failed or cancelled request cannot add a phantom turn to retry history', () => {
  const sessions = createPersonaSessions();
  const completed = sessions.prepare(input).commit(reply);
  const failed = sessions.prepare({ ...input, sessionId: completed.preview.sessionId, text: '失败问题' });
  assert.equal(failed.messages.length, 3);
  const retry = sessions.prepare({ ...input, sessionId: completed.preview.sessionId, text: '重试问题' });
  assert.equal(retry.messages.length, 3);
  assert.equal(JSON.stringify(retry.messages).includes('失败问题'), false);
  retry.commit(reply);
  assert.throws(() => failed.commit(reply), /试聊已结束/);
});
test('window ownership, clear and restart prevent cross-session response contamination', () => {
  const sessions = createPersonaSessions();
  const completed = sessions.prepare(input).commit(reply);
  assert.throws(
    () => sessions.prepare({ ...input, owner: 2, sessionId: completed.preview.sessionId }),
    /会话已结束/,
  );
  const pending = sessions.prepare({ ...input, sessionId: completed.preview.sessionId });
  sessions.clear(1);
  assert.throws(() => pending.commit(reply), /试聊已结束/);
  const fresh = sessions.prepare(input).commit(reply);
  assert.notEqual(fresh.preview.sessionId, completed.preview.sessionId);
  assert.equal(fresh.preview.turnCount, 1);
});
test('changing saved identity or voice resets history; changing pixels or theme does not', () => {
  const sessions = createPersonaSessions();
  const completed = sessions.prepare(input).commit(reply);
  assert.equal(
    personaSignature({ ...character, theme: 'blue', visualReferences: [{ image: 'pixels' }] }),
    personaSignature(character),
  );
  const next = sessions.prepare({
    ...input,
    character: { ...character, speakingStyle: '自然、轻快' },
    sessionId: completed.preview.sessionId,
  });
  assert.equal(next.messages.length, 1);
  const result = next.commit(reply);
  assert.equal(result.preview.resetReason, 'profile-changed');
  assert.equal(result.preview.turnCount, 1);
});
test('preview expires and is capped at eight turns without changing an existing session on validation failure', () => {
  let time = 0;
  const sessions = createPersonaSessions({ now: () => time, ttlMs: 100 });
  let previous = sessions.prepare(input).commit(reply);
  for (let i = 1; i < 8; i++)
    previous = sessions.prepare({ ...input, sessionId: previous.preview.sessionId }).commit(reply);
  assert.equal(previous.preview.turnCount, 8);
  assert.throws(() => sessions.prepare({ ...input, sessionId: previous.preview.sessionId }), /已满 8 轮/);
  time = 101;
  const expired = sessions.prepare({ ...input, sessionId: previous.preview.sessionId }).commit(reply);
  assert.equal(expired.preview.resetReason, 'expired');
  assert.equal(expired.preview.turnCount, 1);
  assert.throws(() => sessions.prepare({ ...input, text: 'x'.repeat(4001) }), /4000/);
  assert.throws(() => sessions.prepare({ ...input, sessionId: {} }), /会话无效/);
});
test('callers cannot rewrite a saved assistant turn through a returned context array', () => {
  const sessions = createPersonaSessions();
  const first = sessions.prepare(input).commit(reply);
  const request = sessions.prepare({ ...input, sessionId: first.preview.sessionId });
  request.messages[1].content = '伪造身份';
  request.commit(reply);
  const next = sessions.prepare({ ...input, sessionId: first.preview.sessionId });
  assert.equal(next.messages[1].content, reply.text);
});
