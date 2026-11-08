'use strict';
// A user's correction goes to the chat model and a web search first; the chat model writes the
// instruction the image model receives. Fixed replies only; no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createServices } = require('../electron/services.cjs');
const { validatePlan, compactPlan, validateCompactPlan } = require('../electron/revision-plan.cjs');
const fixture = require('./fixtures/pet-images.cjs');
const stamp = '2026-11-08T00:00:00.000Z';
const original = fixture.url(fixture.image());
const current = fixture.url(fixture.image(false, { frames: 1 }));
const character = {
  id: 'plan-character',
  name: '花饰测试',
  work: '修正测试作品',
  summary: '',
  personality: [],
  speakingStyle: '',
  appearance: '',
  quotes: [],
  sources: [],
  unknowns: [],
  behavior: { energy: 50, affection: 50, curiosity: 50 },
  createdAt: stamp,
  visualReferences: [{ id: 'original-1', name: '原图', image: original, createdAt: stamp }],
};
const settings = {
  llmBaseUrl: 'https://chat.example/v1',
  llmModel: 'chat-fixture',
  searchProvider: 'tavily',
  imageBaseUrl: 'https://image.example/v1',
  imageModel: 'image-fixture',
};
const credentials = { llmKey: 'chat-key', searchKey: 'search-key', imageKey: 'image-key' };
const evidence = [
  {
    title: '花饰测试 - 角色 Wiki',
    url: 'https://wiki.example/flower',
    content: '花饰测试的发饰是两朵粉色五瓣花，戴在左侧。',
  },
  { title: '无关页面', url: 'https://other.example/x', content: 'nothing about this person' },
];
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
function transport({ replies, search = () => json({ results: evidence }), anthropic = false }) {
  const calls = [];
  const services = createServices(async (url, init) => {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ url, body });
    if (url === 'https://api.tavily.com/search') return search(body);
    if (url.endsWith('/chat/completions'))
      return json({ choices: [{ message: { content: JSON.stringify(replies.shift()) } }] });
    if (anthropic && url.endsWith('/v1/messages'))
      return json({
        content: [{ type: 'tool_use', name: 'mori_result', input: replies.shift() }],
        stop_reason: 'tool_use',
      });
    throw new Error('Unexpected request ' + url);
  });
  return { services, calls };
}
const ask = { character, style: '3d', feedback: '发饰应该是两朵花', images: [current] };

test('the correction is read by the chat model, searched, and rewritten into the image instruction', async () => {
  const { services, calls } = transport({
    replies: [
      { query: 'hair flower ornament', focus: '把发饰改成两朵花' },
      {
        prompt:
          'Replace the hair ornament with two pink five-petal flowers on the left side; keep everything else unchanged.',
        summary: '发饰改为左侧两朵粉色五瓣花',
        conflicts: '',
        used: [1, 7],
      },
    ],
  });
  const progress = [];
  const plan = await services.planRevision(ask, settings, credentials, (event) => progress.push(event.stage));
  assert.deepEqual(
    calls.map((call) => new URL(call.url).hostname),
    ['chat.example', 'api.tavily.com', 'chat.example'],
    'chat model, then search, then chat model; the image model is not called',
  );
  // The chat model sees the user's words with the current image and the original reference.
  const first = JSON.stringify(calls[0].body.messages);
  assert.match(first, /发饰应该是两朵花/);
  assert.ok(first.includes(current) && first.includes(original));
  // The search names the character and work, plus the detail the chat model chose.
  assert.equal(calls[1].body.query, '花饰测试 修正测试作品 hair flower ornament');
  // Only evidence about the character reaches the second step.
  const second = JSON.stringify(calls[2].body.messages);
  assert.match(second, /两朵粉色五瓣花/);
  assert.doesNotMatch(second, /nothing about this person/);
  assert.equal(
    plan.prompt,
    'Replace the hair ornament with two pink five-petal flowers on the left side; keep everything else unchanged.',
  );
  assert.equal(plan.summary, '发饰改为左侧两朵粉色五瓣花');
  assert.equal(plan.query, 'hair flower ornament');
  assert.deepEqual(plan.sources, [{ title: '花饰测试 - 角色 Wiki', url: 'https://wiki.example/flower' }]);
  assert.equal(plan.searched, 1);
  assert.deepEqual(validatePlan(plan), plan);
  assert.ok(validateCompactPlan(compactPlan(plan)));
  assert.equal('prompt' in compactPlan(plan), false, 'task records keep the summary, not the prompt');
  assert.deepEqual([...new Set(progress)], ['理解修正要求', '搜索相关资料', '编写修图提示词']);
});

test('without a chat model or a search service, or when the search fails, nothing is sent to the image model', async () => {
  const unused = transport({ replies: [] });
  await assert.rejects(
    unused.services.planRevision(ask, { ...settings, llmModel: '' }, credentials),
    /配置对话模型/,
  );
  await assert.rejects(
    unused.services.planRevision(
      ask,
      { ...settings, searchProvider: undefined },
      { ...credentials, searchKey: undefined },
    ),
    /选择搜索服务/,
  );
  assert.equal(unused.calls.length, 0);
  const failing = transport({
    replies: [{ query: 'hair flower', focus: '改发饰' }],
    search: () => json({ error: 'down' }, 500),
  });
  await assert.rejects(
    failing.services.planRevision(ask, settings, credentials),
    /修正资料搜索未完成.*不会跳过搜索/,
  );
  assert.deepEqual(
    failing.calls.map((call) => new URL(call.url).hostname),
    ['chat.example', 'api.tavily.com'],
  );
});

test('an empty search still yields a plan from the original images alone', async () => {
  const { services, calls } = transport({
    replies: [
      { query: 'rare detail', focus: '修正细节' },
      {
        prompt: 'Sharpen the collar outline.',
        summary: '收紧领口轮廓',
        conflicts: '与原图领口形状不同',
        used: [1],
      },
    ],
    search: () => json({ results: [] }),
  });
  const plan = await services.planRevision(ask, settings, credentials);
  assert.equal(plan.searched, 0);
  assert.deepEqual(plan.sources, []);
  assert.equal(plan.conflicts, '与原图领口形状不同');
  assert.match(JSON.stringify(calls[2].body.messages), /Web evidence about the character.*\[\]/);
});

test('a motion correction tells the chat model which motion and keeps the frame layout', async () => {
  const { services, calls } = transport({
    replies: [
      { query: 'waving hand', focus: '挥手更轻' },
      {
        prompt: 'Lower the waving arm slightly in every pose.',
        summary: '挥手幅度变小',
        conflicts: '',
        used: [],
      },
    ],
  });
  await services.planRevision(
    { ...ask, motion: 'wave', motionName: '招手', feedback: '挥手更轻' },
    settings,
    credentials,
  );
  const second = JSON.stringify(calls[2].body.messages);
  assert.match(second, /\\"招手\\" motion/);
  assert.match(second, /keep the number of poses, their order and the frame layout unchanged/);
});

test('Claude receives the images as base64 blocks and answers through the result tool', async () => {
  const { services, calls } = transport({
    anthropic: true,
    replies: [
      { query: 'hair flower', focus: '改发饰' },
      { prompt: 'Two flowers in the hair.', summary: '两朵花', conflicts: '', used: [] },
    ],
  });
  const plan = await services.planRevision(
    ask,
    { ...settings, llmProtocol: 'anthropic', llmBaseUrl: 'https://claude.example' },
    credentials,
  );
  assert.equal(plan.prompt, 'Two flowers in the hair.');
  const blocks = calls[0].body.messages[0].content;
  assert.equal(blocks[0].type, 'image');
  assert.equal(blocks[0].source.type, 'base64');
  assert.equal(calls[0].url, 'https://claude.example/v1/messages');
});

test('saved plans are bounded and checked before use', () => {
  const plan = {
    prompt: 'Fix the collar.',
    summary: '修领口',
    conflicts: '',
    query: 'collar',
    sources: [],
    searched: 0,
    warnings: [],
    model: 'chat',
    createdAt: stamp,
  };
  assert.equal(validatePlan(plan).prompt, 'Fix the collar.');
  for (const bad of [
    null,
    { ...plan, prompt: '' },
    { ...plan, prompt: 'x'.repeat(1201) },
    { ...plan, createdAt: 'yesterday' },
    { ...plan, sources: [{ title: 'a', url: 'javascript:alert(1)' }] },
    { ...plan, sources: new Array(4).fill({ title: 'a', url: 'https://a.example/' }) },
  ])
    assert.throws(() => validatePlan(bad));
  assert.equal(validateCompactPlan({ ...compactPlan(plan), summary: 'x'.repeat(201) }), false);
});
