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
  const services = createServices(
    async (url, init) => {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
      calls.push({ url, body });
      if (url === 'https://api.tavily.com/search') return search(body);
      if (url === 'https://wiki.example/flower' || url === 'https://other.example/x')
        return new Response('<html><body>No images</body></html>', {
          headers: { 'Content-Type': 'text/html' },
        });
      if (url.endsWith('/chat/completions'))
        return json({ choices: [{ message: { content: JSON.stringify(replies.shift()) } }] });
      if (anthropic && url.endsWith('/v1/messages'))
        return json({
          content: [{ type: 'tool_use', name: 'mori_result', input: replies.shift() }],
          stop_reason: 'tool_use',
        });
      throw new Error('Unexpected request ' + url);
    },
    { resolveHost: async () => [{ address: '93.184.216.34' }] },
  );
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
    ['chat.example', 'api.tavily.com', 'wiki.example', 'other.example', 'chat.example'],
    'chat model, then search and image-source reads, then chat model; the image model is not called',
  );
  // The chat model sees the user's words with the current image and the original reference.
  const first = JSON.stringify(calls[0].body.messages);
  assert.match(first, /发饰应该是两朵花/);
  assert.ok(first.includes(current) && first.includes(original));
  // The search names the character and work, plus the detail the chat model chose.
  assert.equal(calls[1].body.query, '花饰测试 修正测试作品 hair flower ornament');
  // Only evidence about the character reaches the second step.
  const second = JSON.stringify(calls.at(-1).body.messages);
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
  assert.deepEqual(
    [...new Set(progress)],
    ['理解修正要求', '搜索相关资料', '下载搜索参考图', '编写修图提示词'],
  );
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
  const second = JSON.stringify(calls.at(-1).body.messages);
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

function visualTransport({ verdict, imageFails = false, imageProvider } = {}) {
  const calls = [],
    codexCalls = [];
  const pixels = fixture.decode(fixture.image());
  pixels.bitmap[0] = 77;
  const webBytes = fixture.encode(pixels.bitmap, pixels.width, pixels.height);
  const webImage = fixture.url(webBytes);
  const services = createServices(
    async (url, init) => {
      calls.push({ url, init });
      if (url === 'https://api.tavily.com/search') {
        const request = JSON.parse(init.body);
        assert.equal(request.include_images, true);
        return json({
          results: evidence.slice(0, 1),
          images: [{ url: 'https://cdn.example/detail.png', description: '花饰测试发饰细节' }],
        });
      }
      if (url === 'https://wiki.example/flower')
        return new Response('<html><body></body></html>', { headers: { 'Content-Type': 'text/html' } });
      if (url === 'https://cdn.example/detail.png') {
        if (imageFails) return new Response('down', { status: 503 });
        assert.equal(init.headers.Authorization, undefined, 'public image hosts never receive API keys');
        return new Response(webBytes, { headers: { 'Content-Type': 'image/png' } });
      }
      if (url.endsWith('/chat/completions')) {
        const body = JSON.parse(init.body),
          prompt = JSON.stringify(body.messages);
        const result = prompt.includes('Decide what to look up')
          ? { query: 'hair flower', focus: '改发饰' }
          : prompt.includes('Verify that it is the same character')
            ? verdict || { sameCharacter: true, compatibleOutfit: true, useful: true, confidence: 0.95 }
            : {
                prompt: 'Correct the ornament using the downloaded web reference.',
                summary: '参考搜索图片修正发饰',
                conflicts: '',
                used: [1],
              };
        return json({ choices: [{ message: { content: JSON.stringify(result) } }] });
      }
      if (url.endsWith('/images/edits'))
        return json({ data: [{ b64_json: fixture.image().toString('base64') }] });
      throw Error('Unexpected URL ' + url);
    },
    {
      resolveHost: async () => [{ address: '93.184.216.34' }],
      codex: {
        run: async (input) => {
          codexCalls.push(input);
          return { images: [fixture.image()], text: 'done' };
        },
      },
    },
  );
  return {
    services,
    calls,
    codexCalls,
    webBytes,
    webImage,
    config: { ...settings, ...(imageProvider ? { imageProvider } : {}) },
  };
}

function revisionMaster() {
  const pack = require('../electron/references.cjs').referencePack(character);
  return {
    id: 'web-master',
    characterId: character.id,
    name: '候选',
    style: '3d',
    kind: 'image',
    images: { neutral: current },
    generated: true,
    createdAt: stamp,
    generation: {
      referenceIds: ['original-1'],
      referenceDigest: pack.digest,
      model: 'fixture',
      prompt: 'fixture',
    },
    review: {
      status: 'pending',
      referenceDigest: pack.digest,
      imageDigest: require('../electron/references.cjs').imageDigest(current),
    },
  };
}

test('searched pixels survive planning and reach both master and motion multipart edits byte-for-byte', async () => {
  const h = visualTransport();
  const plan = await h.services.planRevision(ask, h.config, credentials);
  assert.equal(plan.visualReferences.length, 1);
  assert.equal(plan.visualReferences[0].image, h.webImage);
  const written = JSON.parse(h.calls.filter((c) => c.url.endsWith('/chat/completions')).at(-1).init.body);
  assert.ok(
    JSON.stringify(written.messages).includes(h.webImage),
    'the writing model sees the actual downloaded picture',
  );
  const summary = compactPlan(plan);
  assert.equal(summary.visualReferences.length, 1);
  assert.equal(
    'image' in summary.visualReferences[0],
    false,
    'large bytes stay in the saved plan, not task metadata',
  );
  assert.ok(validateCompactPlan(summary));
  const input = {
    character,
    skin: revisionMaster(),
    referenceDigest: revisionMaster().generation.referenceDigest,
    plan,
  };
  await h.services.revisePetBase(input, h.config, credentials);
  await h.services.generatePetSheet({ ...input, motion: 'wave' }, h.config, credentials);
  const edits = h.calls.filter((c) => c.url.endsWith('/images/edits'));
  assert.equal(edits.length, 2);
  for (const { init } of edits) {
    const attachments = init.body.getAll('image[]');
    assert.equal(attachments.length, 3);
    assert.deepEqual(Buffer.from(await attachments[2].arrayBuffer()), h.webBytes);
    assert.match(
      init.body.get('prompt'),
      /Images 3 through 3 are downloaded, visually checked web references/,
    );
  }
  const broken = structuredClone(plan);
  broken.visualReferences[0].image = original;
  await assert.rejects(
    h.services.revisePetBase({ ...input, plan: broken }, h.config, credentials),
    /内容与记录不一致/,
  );
  assert.equal(
    h.calls.filter((c) => c.url.endsWith('/images/edits')).length,
    2,
    'bad persisted bytes stop before billing',
  );
});

test('the Codex image backend receives downloaded references too', async () => {
  const h = visualTransport({ imageProvider: 'codex' });
  const plan = await h.services.planRevision(ask, h.config, credentials);
  await h.services.revisePetBase(
    { character, skin: revisionMaster(), referenceDigest: revisionMaster().generation.referenceDigest, plan },
    h.config,
    credentials,
  );
  assert.equal(h.codexCalls.length, 1);
  assert.deepEqual(h.codexCalls[0].images, [current, original, h.webImage]);
});

test('wrong outfits are excluded with an explicit warning; failed downloads stop the pipeline', async () => {
  const wrong = visualTransport({
    verdict: { sameCharacter: true, compatibleOutfit: false, useful: true, confidence: 0.99 },
  });
  const plan = await wrong.services.planRevision(ask, settings, credentials);
  assert.deepEqual(plan.visualReferences, []);
  assert.match(plan.warnings.join(' '), /未通过角色、服装或细节核对/);
  assert.ok(!JSON.stringify(JSON.parse(wrong.calls.at(-1).init.body).messages).includes(wrong.webImage));
  const failed = visualTransport({ imageFails: true });
  await assert.rejects(failed.services.planRevision(ask, settings, credentials), /未能下载并核对/);
  assert.equal(failed.calls.filter((c) => c.url.endsWith('/images/edits')).length, 0);
});

test('direct corrections need only an image provider, preserve exact detail instructions and carry them into motions', async () => {
  const feedback =
    '虹膜改为紫红色（#B85686），中央瞳孔保持深色。\n画面左侧发饰改成两片叶形，不要花朵；衣服不变。';
  const edits = [];
  const services = createServices(async (url, init) => {
    assert.equal(url, 'https://image.example/v1/images/edits', 'no search or chat requests');
    edits.push(init.body);
    return json({ data: [{ b64_json: fixture.image().toString('base64') }] });
  });
  const imageOnly = {
    imageBaseUrl: settings.imageBaseUrl,
    imageModel: settings.imageModel,
    searchProvider: 'none',
  };
  const keys = { imageKey: 'fixture' };
  const plan = await services.planRevision({ ...ask, mode: 'direct', feedback }, imageOnly, keys);
  assert.equal(edits.length, 0);
  assert.equal(plan.userRequest, feedback);
  assert.equal(plan.mode, 'direct');
  assert.equal(compactPlan(plan).userRequest, feedback);
  const input = {
    character,
    skin: revisionMaster(),
    referenceDigest: revisionMaster().generation.referenceDigest,
    plan,
  };
  const revised = await services.revisePetBase(input, imageOnly, keys);
  const saved = require('../electron/store.cjs').validateSkin(revised);
  assert.equal(saved.generation.correctionRequest, feedback);
  await services.generatePetSheet(
    { character, skin: saved, referenceDigest: input.referenceDigest, motion: 'wave' },
    imageOnly,
    keys,
  );
  for (const form of edits) {
    assert.ok(form.get('prompt').includes(JSON.stringify(feedback)), 'the original wording survives intact');
    assert.match(form.get('prompt'), /iris hue/);
  }
  assert.match(edits[0].get('prompt'), /override generic instructions/);
  assert.match(edits[1].get('prompt'), /retain them in every frame/);
  await assert.rejects(services.planRevision({ ...ask, mode: 'invalid' }, imageOnly, keys), /修正方式无效/);
});

test('researched guidance cannot replace the user wording or omit specified colors and ornament counts', async () => {
  const h = visualTransport();
  const feedback = '画面右侧只有两片金色叶形发饰；虹膜为紫红色，别改成蓝色。';
  const plan = await h.services.planRevision({ ...ask, feedback }, h.config, credentials);
  assert.equal(plan.userRequest, feedback);
  await h.services.revisePetBase(
    { character, skin: revisionMaster(), referenceDigest: revisionMaster().generation.referenceDigest, plan },
    h.config,
    credentials,
  );
  const form = h.calls.at(-1).init.body;
  assert.ok(form.get('prompt').includes(JSON.stringify(feedback)));
  assert.match(form.get('prompt'), /follow the user's words/);
});
