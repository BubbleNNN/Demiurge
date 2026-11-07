'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  selectMemories,
  personaContext,
  availableActions,
  normalizeAction,
} = require('../electron/persona.cjs');
const { createServices } = require('../electron/services.cjs');
const character = {
  id: 'cyrene',
  name: '昔涟',
  work: '崩坏：星穹铁道',
  summary: '日常陪伴',
  personality: ['温柔'],
  speakingStyle: '亲近且俏皮',
  appearance: '粉发',
  behavior: { energy: 30, affection: 70, curiosity: 50 },
  quotes: [],
  unknowns: ['生日未核实'],
  roleplay: {
    timeline: '初次相识',
    relationship: '朋友',
    voiceRules: ['偶尔用人家'],
    avoid: ['不要混入另一作品身份'],
    customFacts: ['在这间书屋相处'],
    spoilerPolicy: 'avoid',
  },
  sources: [
    { title: '衣着', url: 'https://example.org/outfit', snippet: '白色服装与粉色头发' },
    { title: '秋千', url: 'https://example.org/swing', snippet: '爱好语音提到荡秋千' },
  ],
};
test('persona distinguishes evidence, private creative setting, relationship and spoiler policy', () => {
  const context = personaContext(character, '一起荡秋千吗');
  assert.equal(context.scene.relationship, '朋友');
  assert.equal(context.scene.spoilerPolicy, 'avoid');
  assert.deepEqual(context.userCreatedSetting, ['在这间书屋相处']);
  assert.equal(context.sourceEvidence[0].title, '秋千');
  assert.equal(
    context.sourceEvidence.some((s) => s.snippet.includes('书屋')),
    false,
  );
});
test('memory retrieval prioritizes pins and relevant older facts while excluding disabled and other-character memories', () => {
  const memories = [
    { characterId: 'cyrene', text: '我喜欢喝绿茶' },
    ...Array.from({ length: 30 }, (_, i) => ({ characterId: 'cyrene', text: '无关习惯' + i })),
    { characterId: 'cyrene', text: '重要的约定', pinned: true },
    { characterId: 'cyrene', text: '我喜欢绿茶但是不要再使用这段', excluded: true },
    { characterId: 'other', text: '别的角色喜欢绿茶', pinned: true },
  ];
  const selected = selectMemories(memories, 'cyrene', '今天喝绿茶');
  assert.equal(selected[0], '重要的约定');
  assert.ok(selected.includes('我喜欢喝绿茶'));
  assert.equal(selected.length, 12);
  assert.equal(
    selected.some((v) => /不要再|别的/.test(v)),
    false,
  );
});
test('actions obey actual assets and emotional context, including quiet companions', () => {
  assert.deepEqual(availableActions({ builtin: 'cyrene-8bit-v5', images: {} }), [
    'idle',
    'nod',
    'sleep',
    'wave',
  ]);
  assert.deepEqual(availableActions({ kind: 'image', images: {} }), ['idle']);
  assert.deepEqual(
    availableActions({ kind: 'live2d', model: { motions: { Hello: 1 }, motionMap: { wave: 'Hello' } } }),
    ['idle', 'wave'],
  );
  assert.equal(normalizeAction('bounce', 'happy', ['idle', 'bounce'], character), 'idle');
  assert.equal(normalizeAction('wave', 'sad', ['idle', 'wave'], character), 'idle');
  assert.equal(normalizeAction('sleep', 'neutral', ['idle', 'sleep'], character), 'idle');
  assert.equal(normalizeAction('sleep', 'sleepy', ['idle', 'sleep'], character), 'sleep');
  assert.equal(normalizeAction('wave', 'happy', ['idle'], character), 'idle');
});
test('chat compiles persona and grounded evidence in one call and filters impossible output actions', async () => {
  let body,
    calls = 0;
  const services = createServices(async (_, init) => {
    calls++;
    body = JSON.parse(init.body);
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                text: '我们慢慢聊。',
                emotion: 'happy',
                action: 'bounce',
                memory: null,
              }),
            },
          },
        ],
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  });
  const result = await services.chatWithCharacter(
    {
      character,
      messages: [{ role: 'user', content: '一起荡秋千吗' }],
      memories: [],
      availableActions: ['idle', 'wave'],
    },
    { llmBaseUrl: 'https://example.org/v1', llmModel: 'test' },
    { llmKey: 'test-key' },
  );
  assert.equal(calls, 1, 'No extra paid judge request');
  assert.equal(result.action, 'idle');
  assert.match(body.messages[1].content, /身份由name与work/);
  assert.match(body.messages[1].content, /未核实/);
  assert.match(body.messages[1].content, /userCreatedSetting/);
  assert.match(body.messages[1].content, /availableActions/);
  assert.equal(JSON.stringify(body).includes('test-key'), false);
});

test('history budget keeps the latest full message, reduces large contexts and preserves short conversation depth', () => {
  const { boundedHistory } = require('../electron/persona.cjs');
  const messages = Array.from({ length: 40 }, (_, index) => ({
    role: index % 2 ? 'user' : 'assistant',
    content: String(index) + '文'.repeat(1998),
  }));
  const brief = boundedHistory(messages, 6000),
    balanced = boundedHistory(messages, 12000),
    long = boundedHistory(messages, 24000);
  assert.ok(brief.length < balanced.length && balanced.length < long.length);
  assert.equal(brief.at(-1).content, messages.at(-1).content);
  assert.ok(balanced.reduce((sum, m) => sum + m.content.length, 0) <= 12000);
  assert.equal(boundedHistory(messages.map((m) => ({ ...m, content: '短消息' }))).length, 24);
  assert.deepEqual(boundedHistory(messages, 1), balanced);
  assert.deepEqual(boundedHistory([]), []);
});
