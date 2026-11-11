'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createServices } = require('../electron/services.cjs');
const { searchProvider } = require('../electron/research.cjs');
const { extractSource } = require('../electron/sources.cjs');

const settings = { llmBaseUrl: 'https://model.example/v1', llmModel: 'fixture' };
const credentials = { llmKey: 'sk-fixture-model' };
const input = { name: '小森', work: '森林来信', notes: '' };
const address = 'https://official.example/character';
const evidence =
  '小森是森林来信中的信使，绿色短发，棕色斗篷。说话简洁温柔，喜欢观察森林中的树木。他向同伴问候：“明天一起去看树吧。”';
const html = `<html><head><title>官方人物介绍</title><style>hidden</style></head><body><nav>登录 广告</nav><article><h1>小森</h1><p>${evidence}</p></article><footer>联系我们</footer><script>maliciousInstruction()</script></body></html>`;
const profile = {
  identityMatched: true,
  summary: '小森是一名森林信使。',
  personality: ['温和'],
  appearance: '绿色短发，棕色斗篷',
  speakingStyle: '简洁温柔',
  theme: 'forest',
  unknowns: [],
  quotes: [{ text: '明天一起去看树吧。', sourceUrl: address, kind: 'dialogue' }],
  behavior: { energy: 30, affection: 50, curiosity: 70 },
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const completion = (body = profile) => json({ choices: [{ message: { content: JSON.stringify(body) } }] });
const native = (body = profile) =>
  json({ content: [{ type: 'tool_use', name: 'mori_result', input: body }], stop_reason: 'tool_use' });
const webpage = () => new Response(html, { headers: { 'Content-Type': 'text/html' } });
const resolveHost = async () => [{ address: '93.184.215.14' }];
const promptData = (init) =>
  JSON.parse(JSON.parse(init.body).messages.at(-1).content.split('以下 JSON 是资料数据：')[1]);

test('Wiki 567 identifies a source-site block, stops before the model and never silently uses saved data', async () => {
  let calls = 0;
  const services = createServices(async () => {
    calls++;
    return new Response('<html><body>Blocked page with private diagnostic data</body></html>', {
      status: 567,
      headers: { 'Content-Type': 'text/html', Server: 'TencentEdgeOne' },
    });
  });
  const configured = { ...settings, searchProvider: 'wiki', wikiApiUrl: 'https://wiki.example/w/api.php' };
  await assert.rejects(
    services.researchCharacter(
      { ...input, mode: 'search', existingSources: [{ title: '旧资料', url: address, snippet: evidence }] },
      configured,
      credentials,
    ),
    (error) => {
      assert.match(error.message, /HTTP 567.*访问防护/);
      assert.doesNotMatch(error.message, /模型名称|private diagnostic/);
      return true;
    },
  );
  assert.equal(calls, 1);
  const testResult = await services.testSearchConnection(configured, credentials);
  assert.equal(testResult.ok, false);
  assert.match(testResult.message, /已保存资料/);
});

test('saved-source mode uses one model call with stored evidence, retains quotes and discloses that sources were not refreshed', async () => {
  const stored = [
    { title: '官方人物介绍', url: address, snippet: evidence },
    { title: '旧版较长来源', url: 'https://archive.example/long', snippet: '旧资料'.repeat(3500) },
  ];
  const calls = [];
  const services = createServices(async (url, init) => {
    calls.push({ url, init });
    assert.equal(
      url,
      'https://model.example/v1/chat/completions',
      'Saved mode must not contact a source website',
    );
    return completion();
  });
  const result = await services.researchCharacter(
    { ...input, mode: 'saved', existingSources: stored },
    { ...settings, searchProvider: 'wiki' },
    credentials,
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(
    promptData(calls[0].init).sources,
    stored.map((source) => ({ ...source, snippet: source.snippet.slice(0, 8000) })),
  );
  assert.deepEqual(result.sources, stored);
  assert.deepEqual(result.quotes, [{ text: '明天一起去看树吧。', sourceUrl: address }]);
  assert.equal(result.knowledge.method, 'saved');
  assert.equal(result.knowledge.kind, 'sourced');
  assert.match(result.unknowns.join(' '), /未联网读取或核实新资料/);
});

test('saved-source mode cannot manufacture evidence for a character with no stored source text', async () => {
  let calls = 0;
  const services = createServices(async () => {
    calls++;
    return completion();
  });
  for (const existingSources of [undefined, [], [{ title: '空来源', url: address, snippet: '' }]])
    await assert.rejects(
      services.researchCharacter({ ...input, mode: 'saved', existingSources }, settings, credentials),
      /没有已保存的来源正文/,
    );
  assert.equal(calls, 0);
});

test('a blocked source webpage is not promoted to source evidence or followed by a model request', async () => {
  let calls = 0;
  const services = createServices(
    async () => {
      calls++;
      return new Response('<html><body>567</body></html>', { status: 567 });
    },
    { resolveHost },
  );
  await assert.rejects(
    services.researchCharacter({ ...input, mode: 'links', urls: [address] }, settings, credentials),
    /没有读到可用正文.*HTTP 567.*访问防护/,
  );
  assert.equal(calls, 1);
});

test('model drafts use one chat request, discard invented sources and quotes and remain explicitly unverified', async () => {
  const calls = [];
  const services = createServices(async (url, init) => {
    calls.push({ url, init });
    return completion({ ...profile, sources: [{ title: '虚构', url: address, snippet: evidence }] });
  });
  const result = await services.researchCharacter({ ...input, mode: 'draft' }, settings, credentials);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://model.example/v1/chat/completions');
  assert.deepEqual(result.sources, []);
  assert.deepEqual(result.quotes, []);
  assert.equal(result.knowledge.kind, 'draft');
  assert.equal(result.knowledge.method, 'model');
  assert.match(result.unknowns[0], /尚未联网核实/);
  assert.deepEqual(promptData(calls[0].init).sources, []);
});

test('link profiles extract real text without forwarding API auth, retain prior evidence and validate quotes', async () => {
  const calls = [];
  const previous = { title: '旧资料', url: 'https://archive.example/story', snippet: '小森是森林里的信使。' };
  const services = createServices(
    async (url, init) => {
      calls.push({ url, init });
      if (url === address) return webpage();
      return completion({
        ...profile,
        quotes: [...profile.quotes, { text: '编出来的台词', sourceUrl: address }],
      });
    },
    { resolveHost },
  );
  const result = await services.researchCharacter(
    { ...input, mode: 'links', urls: [address, address + '#section'], existingSources: [previous] },
    settings,
    credentials,
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.equal(calls[0].init.headers['x-api-key'], undefined);
  assert.match(result.sources[0].snippet, /明天一起去看树吧/);
  assert.doesNotMatch(result.sources[0].snippet, /广告|maliciousInstruction|联系我们/);
  assert.equal(result.sources[0].title, '官方人物介绍');
  assert.deepEqual(result.sources[1], previous);
  assert.deepEqual(result.quotes, [{ text: profile.quotes[0].text, sourceUrl: address }]);
  assert.deepEqual(promptData(calls[1].init).sources, result.sources);
  assert.equal(result.knowledge.method, 'links');
  assert.equal(result.knowledge.kind, 'sourced');
});

test('updates retain older source records beyond the model evidence budget and disclose which subset was used', async () => {
  const previous = Array.from({ length: 15 }, (_, index) => ({
    title: `旧资料${index}`,
    url: `https://archive.example/${index}`,
    snippet: evidence,
  }));
  let modelData;
  const services = createServices(
    async (url, init) => {
      if (url === address) return webpage();
      modelData = promptData(init);
      return completion();
    },
    { resolveHost },
  );
  const result = await services.researchCharacter(
    {
      ...input,
      mode: 'links',
      urls: [address],
      existingSources: [{ title: '重复', url: address, snippet: evidence }, ...previous],
    },
    settings,
    credentials,
  );
  assert.equal(result.sources.length, 16);
  assert.deepEqual(result.sources.at(-1), previous.at(-1));
  assert.equal(modelData.sources.length, 12);
  assert.equal(modelData.sources[0].url, address);
  assert.match(result.unknowns.join(' '), /其余资料仍保留/);
});

test('unreadable source links retain successful evidence and expose gaps, while total failure skips the model', async () => {
  let modelCalls = 0;
  const services = createServices(
    async (url) => {
      if (url.includes('model.example')) {
        modelCalls++;
        return completion();
      }
      if (url === address) return webpage();
      return new Response('<html><body><script>load()</script></body></html>', {
        headers: { 'Content-Type': 'text/html' },
      });
    },
    { resolveHost },
  );
  const partial = await services.researchCharacter(
    { ...input, mode: 'links', urls: [address, 'https://dynamic.example/character'] },
    settings,
    credentials,
  );
  assert.equal(partial.sources.length, 1);
  assert.match(partial.unknowns.join(' '), /部分资料页面未读取/);
  assert.equal(modelCalls, 1);
  await assert.rejects(
    services.researchCharacter(
      {
        ...input,
        mode: 'links',
        urls: ['https://dynamic.example/character'],
        existingSources: partial.sources,
      },
      settings,
      credentials,
    ),
    /没有读到可用正文/,
  );
  assert.equal(modelCalls, 1);
});

test('link import rejects credentials, private DNS, private redirects and excessive input before model calls', async () => {
  let calls = 0;
  const services = createServices(
    async () => {
      calls++;
      return completion();
    },
    { resolveHost: async () => [{ address: '10.0.0.1' }] },
  );
  for (const urls of [
    [],
    Array(7).fill(address),
    ['file:///private/secret'],
    ['https://user:secret@official.example'],
    ['https://official.example?api_key=secret'],
    ['https://private.example/character'],
  ])
    await assert.rejects(
      services.researchCharacter({ ...input, mode: 'links', urls }, settings, credentials),
    );
  assert.equal(calls, 0);
  const redirect = createServices(
    async () => {
      calls++;
      return new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/secret' } });
    },
    { resolveHost },
  );
  await assert.rejects(
    redirect.researchCharacter({ ...input, mode: 'links', urls: [address] }, settings, credentials),
    /不能访问本机或内网/,
  );
  assert.equal(calls, 1);
});

test('public redirects preserve final source URL; unsupported and oversized pages never become evidence', async () => {
  const calls = [];
  const final = 'https://official.example/final';
  const services = createServices(
    async (url) => {
      calls.push(url);
      if (url === address) return new Response(null, { status: 301, headers: { Location: '/final' } });
      if (url === final) return webpage();
      return completion({
        ...profile,
        quotes: [{ text: '明天一起去看树吧。', sourceUrl: final, kind: 'dialogue' }],
      });
    },
    { resolveHost },
  );
  const result = await services.researchCharacter(
    { ...input, mode: 'links', urls: [address] },
    settings,
    credentials,
  );
  assert.equal(result.sources[0].url, final);
  assert.equal(result.quotes[0].sourceUrl, final);
  assert.equal(calls.length, 3);
  for (const response of [
    new Response('binary', { headers: { 'Content-Type': 'application/pdf' } }),
    new Response('large', { headers: { 'Content-Type': 'text/html', 'Content-Length': '1048577' } }),
  ]) {
    let attempts = 0;
    const rejected = createServices(
      async () => {
        attempts++;
        return response;
      },
      { resolveHost },
    );
    await assert.rejects(
      rejected.researchCharacter({ ...input, mode: 'links', urls: [address] }, settings, credentials),
      /没有读到可用正文/,
    );
    assert.equal(attempts, 1);
  }
  assert.throws(
    () =>
      extractSource(Buffer.from('<html><body><script>load()</script></body></html>'), 'text/html', address),
    /没有可读取的正文/,
  );
});

test('SearXNG uses JSON search without a search key and keeps actual snippets rather than model URLs', async () => {
  const calls = [];
  const services = createServices(async (url, init) => {
    calls.push({ url, init });
    return calls.length === 1
      ? json({ results: [{ title: '官方', url: address, content: evidence }] })
      : completion();
  });
  const result = await services.researchCharacter(
    { ...input, mode: 'search' },
    { ...settings, searchProvider: 'searxng', searxngBaseUrl: 'http://localhost:8080' },
    credentials,
  );
  const query = new URL(calls[0].url);
  assert.equal(query.pathname, '/search');
  assert.equal(query.searchParams.get('format'), 'json');
  assert.equal(query.searchParams.get('q'), '小森 森林来信');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers, undefined);
  assert.equal(result.sources[0].snippet, evidence);
  assert.equal(result.knowledge.method, 'searxng');
});

test('SearXNG JSON refusal surfaces an error with no fallback draft or extra model request', async () => {
  let calls = 0;
  const services = createServices(async () => {
    calls++;
    return json({}, 403);
  });
  await assert.rejects(
    services.researchCharacter(
      { ...input, mode: 'search' },
      { ...settings, searchProvider: 'searxng', searxngBaseUrl: 'https://search.example' },
      credentials,
    ),
    /JSON 格式.*HTTP 403/,
  );
  assert.equal(calls, 1);
});

test('Wiki imports plaintext extracts from the configured public MediaWiki API without a commercial key', async () => {
  const calls = [];
  const services = createServices(async (url, init) => {
    calls.push({ url, init });
    return calls.length === 1
      ? json({ query: { pages: { 1: { title: '小森', fullurl: address, extract: evidence } } } })
      : completion();
  });
  const result = await services.researchCharacter(
    { ...input, mode: 'search' },
    { ...settings, searchProvider: 'wiki', wikiApiUrl: 'https://wiki.example/w/api.php' },
    credentials,
  );
  const query = new URL(calls[0].url);
  assert.equal(query.pathname, '/w/api.php');
  assert.equal(query.searchParams.get('generator'), 'search');
  assert.equal(query.searchParams.get('explaintext'), '1');
  assert.equal(query.searchParams.get('exintro'), null, 'Include relationship and event sections, not only the introduction');
  assert.equal(query.searchParams.get('exchars'), '8000');
  assert.equal(query.searchParams.get('inprop'), 'url');
  assert.equal(result.knowledge.method, 'wiki');
  assert.deepEqual(result.quotes, [{ text: profile.quotes[0].text, sourceUrl: address }]);
});

test('Wiki falls back to reading real pages when TextExtracts is unavailable and empty results stop generation', async () => {
  let models = 0;
  const services = createServices(
    async (url) => {
      if (url.includes('w/api.php'))
        return json({ query: { pages: { 1: { title: '小森', fullurl: address } } } });
      if (url === address) return webpage();
      models++;
      return completion();
    },
    { resolveHost },
  );
  assert.equal(
    (
      await services.researchCharacter(
        { ...input, mode: 'search' },
        { ...settings, searchProvider: 'wiki' },
        credentials,
      )
    ).sources.length,
    1,
  );
  assert.equal(models, 1);
  const empty = createServices(async () => json({ query: { pages: {} } }));
  await assert.rejects(
    empty.researchCharacter(
      { ...input, mode: 'search' },
      { ...settings, searchProvider: 'wiki' },
      credentials,
    ),
    /没有返回可用资料/,
  );
});

const nativeSettings = {
  ...settings,
  llmProtocol: 'anthropic',
  llmAuthMode: 'bearer',
  searchProvider: 'claude',
};
const nativeResults = {
  content: [
    { type: 'server_tool_use', name: 'web_search', id: 'search-1', input: { query: '小森' } },
    {
      type: 'web_search_tool_result',
      tool_use_id: 'search-1',
      content: [
        { type: 'web_search_result', title: '官方', url: address, encrypted_content: 'opaque-not-evidence' },
      ],
    },
    {
      type: 'text',
      text: '检索摘要',
      citations: [{ type: 'web_search_result_location', url: address, cited_text: evidence }],
    },
  ],
  stop_reason: 'end_turn',
};
test('Claude search shares the saved model key, reads actual tool results then separately requests the structured profile', async () => {
  const calls = [];
  const services = createServices(
    async (url, init) => {
      calls.push({ url, init });
      if (url === address) return webpage();
      return calls.length === 1 ? json(nativeResults) : native();
    },
    { resolveHost },
  );
  const result = await services.researchCharacter({ ...input, mode: 'search' }, nativeSettings, credentials);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, 'https://model.example/v1/messages');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-fixture-model');
  const searchBody = JSON.parse(calls[0].init.body);
  assert.deepEqual(searchBody.tools, [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }]);
  assert.equal(searchBody.tool_choice, undefined);
  assert.equal(JSON.parse(calls[2].init.body).tool_choice.name, 'mori_result');
  assert.equal(calls[1].init.headers.Authorization, undefined);
  assert.equal(result.knowledge.method, 'claude');
  assert.equal(JSON.stringify(result).includes('opaque-not-evidence'), false);
});

test('Claude citations are usable only when attached to a real search result; incomplete search discloses its limit', async () => {
  const response = structuredClone(nativeResults);
  response.stop_reason = 'pause_turn';
  response.content.at(-1).citations.push({
    type: 'web_search_result_location',
    url: 'https://madeup.example',
    cited_text: '伪造资料',
  });
  let modelCalls = 0;
  const services = createServices(
    async (url) => {
      if (url === address) return json({}, 403);
      return ++modelCalls === 1 ? json(response) : native();
    },
    { resolveHost },
  );
  const result = await services.researchCharacter({ ...input, mode: 'search' }, nativeSettings, credentials);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].snippet, evidence);
  assert.match(result.unknowns.join(' '), /部分结果/);
  assert.equal(modelCalls, 2);
});

test('unsupported native search and invented text links are explicit failures and never create source evidence', async () => {
  for (const content of [
    [{ type: 'text', text: `来源：${address}`, citations: nativeResults.content.at(-1).citations }],
    [
      {
        type: 'web_search_tool_result',
        content: { type: 'web_search_tool_result_error', error_code: 'unavailable' },
      },
    ],
  ]) {
    let calls = 0;
    const services = createServices(async () => {
      calls++;
      return json({ content });
    });
    const result = await services.testSearchConnection(nativeSettings, credentials);
    assert.equal(result.ok, false);
    assert.match(result.message, /未返回原生网页搜索结果/);
    assert.equal(calls, 1);
  }
});

test('provider selection preserves old Tavily setups, supports one-key Claude and lets users explicitly disable search', async () => {
  assert.equal(searchProvider(settings, { ...credentials, searchKey: 'tavily-fixture' }), 'tavily');
  assert.equal(searchProvider(nativeSettings, credentials), 'claude');
  assert.equal(searchProvider(settings, credentials), 'none');
  let calls = 0;
  const services = createServices(async () => {
    calls++;
    return completion();
  });
  await assert.rejects(
    services.researchCharacter(
      { ...input, mode: 'search' },
      { ...nativeSettings, searchProvider: 'none' },
      credentials,
    ),
    /请选择搜索提供商/,
  );
  await assert.rejects(
    services.researchCharacter({ ...input, mode: 'draft' }, settings, {}),
    /聊天模型.*Key/,
  );
  assert.equal(calls, 0);
});

test('search capability tests use only the chosen search service and do not ask a model to manufacture a profile', async () => {
  let calls = 0;
  const services = createServices(async () => {
    calls++;
    return json({ results: [{ title: '昔涟角色资料', url: address, content: '昔涟来自崩坏：星穹铁道。' }] });
  });
  const result = await services.testSearchConnection(
    { ...settings, searchProvider: 'searxng', searxngBaseUrl: 'https://search.example' },
    credentials,
  );
  assert.equal(result.ok, true);
  assert.match(result.message, /未创建角色/);
  assert.equal(calls, 1);
});

test('unrelated search results fail before profile generation even when the search API returned valid JSON', async () => {
  let calls = 0;
  const services = createServices(async () => {
    calls++;
    return json({
      results: [
        { title: 'Claude Code 安装指南', url: address, content: '编程工具和 GitHub 配置，与角色无关。' },
      ],
    });
  });
  const chosen = { ...settings, searchProvider: 'searxng', searxngBaseUrl: 'https://search.example' };
  await assert.rejects(
    services.researchCharacter({ ...input, mode: 'search' }, chosen, credentials),
    /未取得.*匹配.*来源/,
  );
  assert.equal(calls, 1);
  const testResult = await services.testSearchConnection(chosen, credentials);
  assert.equal(testResult.ok, false);
  assert.match(testResult.message, /不能据此建立角色档案/);
});

test('Cyrene aliases accept relevant English sources and remove unrelated history or code pages', async () => {
  let calls = 0,
    sent;
  const services = createServices(async (_url, init) => {
    if (++calls === 1)
      return json({
        results: [
          {
            title: 'Cyrene — Honkai: Star Rail',
            url: address,
            content: 'Cyrene is a character from Honkai: Star Rail.',
          },
          {
            title: 'Claude Code',
            url: 'https://unrelated.example/guide',
            content: 'An unrelated code editor.',
          },
        ],
      });
    sent = promptData(init);
    return completion({ ...profile, quotes: [] });
  });
  const result = await services.researchCharacter(
    { name: '昔涟', work: '崩坏：星穹铁道', notes: '', mode: 'search' },
    { ...settings, searchProvider: 'searxng', searxngBaseUrl: 'https://search.example' },
    credentials,
  );
  assert.equal(result.sources.length, 1);
  assert.equal(sent.sources.length, 1);
  assert.match(result.unknowns.join(' '), /已剔除/);
});

test('a same-name song cannot become a character profile when the model identifies the wrong entity', async () => {
  let calls = 0;
  const services = createServices(
    async (url) => {
      calls++;
      return url === address
        ? webpage()
        : completion({ ...profile, identityMatched: false, summary: '这是一首名叫小森的歌曲。' });
    },
    { resolveHost },
  );
  await assert.rejects(
    services.researchCharacter({ ...input, mode: 'links', urls: [address] }, settings, credentials),
    /未能确认.*人物身份/,
  );
  assert.equal(
    calls,
    2,
    'Identity check belongs to the same profile request, without an automatic paid retry',
  );
});

test('lyrics and narration are excluded even if their literal text exists in the retrieved source', async () => {
  const services = createServices(
    async (url) =>
      url === address
        ? webpage()
        : completion({
            ...profile,
            quotes: [
              ...profile.quotes,
              { ...profile.quotes[0], kind: 'lyrics' },
              { ...profile.quotes[0], kind: 'narration' },
            ],
          }),
    { resolveHost },
  );
  const result = await services.researchCharacter(
    { ...input, mode: 'links', urls: [address] },
    settings,
    credentials,
  );
  assert.deepEqual(result.quotes, [{ text: '明天一起去看树吧。', sourceUrl: address }]);
});
