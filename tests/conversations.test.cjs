'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatChat, requestHistory } = require('../electron/conversations.cjs');
test('new topics use persisted messages and exclude earlier topics, late replies and later window messages', () => {
  const messages = [
    { id: 'old', role: 'user', content: '旧阶段' },
    { id: 'old-reply', role: 'assistant', content: '旧回复', replyTo: 'old' },
    { id: 'new', role: 'user', content: '新阶段', contextStart: true },
    { id: 'late', role: 'assistant', content: '另一窗口迟到的旧回复', replyTo: 'old' },
    { id: 'new-reply', role: 'assistant', content: '新回复', replyTo: 'new' },
    { id: 'current', role: 'user', content: '继续新阶段' },
    { id: 'other-window', role: 'user', content: '稍后从另一窗口发送' },
  ];
  assert.deepEqual(
    requestHistory(messages, 'current').map((m) => m.id),
    ['new', 'new-reply', 'current'],
  );
  assert.deepEqual(
    requestHistory(messages, 'old').map((m) => m.id),
    ['old'],
  );
  assert.throws(() => requestHistory(messages, 'missing'), /尚未保存/);
  assert.throws(() => requestHistory(messages, 'old-reply'), /尚未保存/);
  assert.match(formatChat({ name: '昔涟' }, messages), /—— 新话题 ——/);
  assert.equal(messages.length, 7, 'Context selection must preserve stored history');
});
test('conversation export keeps Unicode text and chronology without exporting the workspace', () => {
  const output = formatChat(
    {
      name: '昔涟',
      work: '崩坏：星穹铁道',
      roleplay: { customFacts: ['private setting'] },
      llmKey: 'secret',
    },
    [
      { role: 'user', createdAt: '2026-09-30T12:00:00Z', content: '今天想看星星。\n等雨停。' },
      { role: 'assistant', createdAt: '2026-09-30T12:00:01Z', content: '一起去吧♪' },
    ],
  );
  assert.ok(output.indexOf('今天想看星星') < output.indexOf('一起去吧'));
  assert.match(output, /昔涟/);
  assert.match(output, /看星星。\n等雨停/);
  assert.equal(output.includes('private setting'), false);
  assert.equal(output.includes('secret'), false);
});

test('saving a completed reply is idempotent and retains other-character state', () => {
  const fs = require('node:fs'),
    ts = require('typescript');
  const exportsObject = {};
  new Function(
    'exports',
    ts.transpileModule(fs.readFileSync('src/conversation.ts', 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
  )(exportsObject);
  const { appendCompletedReply } = exportsObject;
  const before = {
    messages: {
      a: [{ id: 'user', role: 'user', content: '我喜欢星星' }],
      b: [{ id: 'other', content: 'other character' }],
    },
    memories: [],
  };
  const completed = {
    characterId: 'a',
    messageId: 'reply',
    memoryId: 'memory',
    replyTo: 'user',
    createdAt: '2026-09-30T12:00:00Z',
    reply: { text: '一起看看吧♪', emotion: 'happy', action: 'idle', memory: '我喜欢星星' },
  };
  const first = appendCompletedReply(before, completed),
    second = appendCompletedReply(first, completed);
  assert.equal(second.messages.a.length, 2);
  assert.equal(second.memories.length, 1);
  assert.equal(second.messages.a.at(-1).replyTo, 'user');
  assert.deepEqual(second.messages.b, before.messages.b);
  assert.equal(before.messages.a.length, 1);
  const full = {
    ...before,
    memories: Array.from({ length: 5000 }, (_, i) => ({ id: String(i), characterId: 'b', text: 'existing' })),
  };
  const capped = appendCompletedReply(full, completed);
  assert.equal(capped.memories.length, 5000);
  assert.equal(capped.messages.a.length, 2, 'Memory capacity must not discard a completed reply');
  const longHistory = {
    ...before,
    messages: {
      ...before.messages,
      a: Array.from({ length: 1000 }, (_, i) => ({ id: `older-${i}`, role: 'user', content: '保留的历史' })),
    },
  };
  const extended = appendCompletedReply(longHistory, completed);
  assert.equal(extended.messages.a.length, 1001);
  assert.equal(extended.messages.a[0].id, 'older-0', 'Completed replies must not delete early history');
});
