'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createCodex, codexArgs, describeFailure } = require('../electron/codex.cjs');
const { createServices } = require('../electron/services.cjs');
const { searchProvider } = require('../electron/research.cjs');

// A fake `codex exec --json` child that replays the given JSONL events.
function fakeSpawn(events, { code = 0, stderr = '', calls = [] } = {}) {
  return (executable, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.exitCode = null;
    child.killed = false;
    child.kill = () => {
      child.killed = true;
      child.exitCode = 143;
    };
    const call = { executable, args, options, prompt: '', files: {} };
    calls.push(call);
    // Capture temporary inputs before the runner deletes its directory.
    const schema = args[args.indexOf('--output-schema') + 1];
    if (args.includes('--output-schema')) call.files.schema = JSON.parse(fs.readFileSync(schema, 'utf8'));
    args.forEach((arg, i) => {
      if (args[i - 1] === '--image') call.files[path.basename(arg)] = fs.readFileSync(arg);
    });
    child.stdin.on('data', (chunk) => (call.prompt += chunk));
    child.stdin.on('finish', () => {
      setImmediate(() => {
        for (const event of events) child.stdout.write(JSON.stringify(event) + '\n');
        if (stderr) child.stderr.write(stderr);
        child.stdout.end();
        setImmediate(() => {
          child.exitCode = code;
          child.emit('close', code);
        });
      });
    });
    return child;
  };
}
const message = (text) => ({ type: 'item.completed', item: { id: 'm', type: 'agent_message', text } });
const done = { type: 'turn.completed', usage: {} };
const codexFor = (spawnFn) =>
  createCodex({
    spawnFn,
    environment: async () => ({
      HOME: os.homedir(),
      PATH: '/usr/bin',
      OPENAI_API_KEY: 'sk-should-not-pass',
      CODEX_API_KEY: 'x',
    }),
    resolve: async () => '/fixture/codex',
  });

test('Codex runs read-only, ephemeral, ChatGPT-only, with tools disabled unless searching', () => {
  const chat = codexArgs({ directory: '/tmp/work', schemaFile: '/tmp/work/s.json', model: 'fixture-model' });
  const pairs = (flag, list) => list.flatMap((v, i) => (list[i - 1] === flag ? [v] : []));
  for (const flag of ['--ephemeral', '--ignore-user-config', '--ignore-rules', '--json'])
    assert.ok(chat.includes(flag));
  assert.equal(chat[chat.indexOf('--sandbox') + 1], 'read-only');
  const disabled = pairs('--disable', chat);
  for (const feature of [
    'shell_tool',
    'unified_exec',
    'apps',
    'plugins',
    'computer_use',
    'image_generation',
    'code_mode_host',
  ])
    assert.ok(disabled.includes(feature), feature);
  const config = pairs('-c', chat);
  assert.ok(config.includes('web_search="disabled"'));
  assert.ok(config.includes('forced_login_method="chatgpt"'));
  assert.ok(config.includes('approval_policy="never"'));
  assert.equal(chat[chat.indexOf('--model') + 1], 'fixture-model');
  assert.equal(chat.at(-1), '-');

  const search = codexArgs({ directory: '/tmp/work', search: true });
  assert.ok(pairs('-c', search).includes('web_search="live"'));
  // Codex routes web search through its code-mode host; nothing else is re-enabled.
  assert.ok(!pairs('--disable', search).includes('code_mode_host'));
  assert.ok(pairs('--disable', search).includes('shell_tool'));
  assert.ok(!search.includes('--model'));
});

test('Codex returns the final message, passes schema and images, strips API keys and cleans up', async () => {
  const calls = [];
  const codex = codexFor(
    fakeSpawn(
      [
        { type: 'thread.started' },
        { type: 'item.completed', item: { type: 'error', message: 'non-fatal notice' } },
        message('{"ok":true}'),
        done,
      ],
      { calls },
    ),
  );
  const png = 'data:image/png;base64,' + Buffer.from('fixture-png').toString('base64');
  const result = await codex.run({ prompt: '你好', schema: { type: 'object' }, images: [png] });
  assert.equal(result.text, '{"ok":true}');
  const [call] = calls;
  assert.equal(call.executable, '/fixture/codex');
  assert.equal(call.prompt, '你好');
  assert.deepEqual(call.files.schema, { type: 'object' });
  assert.equal(call.files['reference-1.png'].toString(), 'fixture-png');
  assert.equal(call.options.env.OPENAI_API_KEY, undefined, 'subscription login only, never API-key billing');
  assert.equal(call.options.env.CODEX_API_KEY, undefined);
  assert.equal(call.options.shell, false);
  assert.equal(fs.existsSync(call.options.cwd), false, 'temporary directory removed');
  await assert.rejects(codex.run({ prompt: 'x', images: ['https://example.com/a.png'] }), /只接收应用内/);
});

test('Codex stops on any tool other than messages and permitted search', async () => {
  const codex = codexFor(
    fakeSpawn([
      { type: 'item.started', item: { type: 'command_execution', command: 'ls' } },
      message('{}'),
      done,
    ]),
  );
  await assert.rejects(codex.run({ prompt: 'x' }), /未允许的工具/);
  const searchOutsideResearch = codexFor(
    fakeSpawn([{ type: 'item.completed', item: { type: 'web_search', results: [] } }, done]),
  );
  await assert.rejects(searchOutsideResearch.run({ prompt: 'x' }), /未允许的工具/);
});

test('Codex search keeps the tool results and reports login, quota and incomplete failures clearly', async () => {
  const hit = {
    type: 'text_result',
    title: '小森 - 官方',
    url: 'https://official.example/character',
    snippet: '小森是信使',
  };
  const codex = codexFor(
    fakeSpawn([
      {
        type: 'item.completed',
        item: { type: 'web_search', query: '小森 森林来信', results: [hit, { title: 'no url' }] },
      },
      message('{"sources":[]}'),
      done,
    ]),
  );
  const result = await codex.run({ prompt: 'search', search: true });
  assert.deepEqual(result.results, [{ title: hit.title, url: hit.url, snippet: hit.snippet }]);
  assert.deepEqual(result.queries, ['小森 森林来信']);

  await assert.rejects(
    codexFor(fakeSpawn([], { code: 1, stderr: 'Error: Not logged in' })).run({ prompt: 'x' }),
    /codex login/,
  );
  await assert.rejects(
    codexFor(fakeSpawn([{ type: 'turn.failed', error: { message: 'You have hit your usage limit' } }])).run({
      prompt: 'x',
    }),
    /额度/,
  );
  await assert.rejects(codexFor(fakeSpawn([message('partial')])).run({ prompt: 'x' }), /没有返回完整结果/);
  assert.match(describeFailure('unknown model "x"'), /模型 ID/);
});

test('Codex honours cancellation', async () => {
  const controller = new AbortController();
  const codex = createCodex({
    environment: async () => ({ HOME: os.homedir() }),
    resolve: async () => '/fixture/codex',
    spawnFn: () => {
      const child = new EventEmitter();
      Object.assign(child, {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        stdin: new PassThrough(),
        exitCode: null,
      });
      child.kill = () => {
        child.exitCode = 143;
      };
      setImmediate(() => controller.abort());
      return child;
    },
  });
  await assert.rejects(codex.run({ prompt: 'x', signal: controller.signal }), /已停止/);
});

test('Chat through local Codex needs no API key and keeps persona rules, schema and action limits', async () => {
  const runs = [];
  let fetches = 0;
  const services = createServices(
    async () => {
      fetches++;
      throw new Error('no network');
    },
    {
      codex: {
        run: async (request) => {
          runs.push(request);
          return {
            text: JSON.stringify({ text: '你来啦。', emotion: 'happy', action: 'wave', memory: null }),
          };
        },
      },
    },
  );
  const character = {
    id: 'c',
    name: '昔涟',
    work: '崩坏：星穹铁道',
    summary: '',
    personality: [],
    speakingStyle: '',
    appearance: '',
    quotes: [],
    sources: [],
    unknowns: [],
    behavior: { energy: 60, affection: 60, curiosity: 60 },
  };
  const reply = await services.chatWithCharacter(
    {
      character,
      messages: [
        { id: '1', role: 'user', content: '早上好', createdAt: '' },
        { id: '2', role: 'assistant', content: '早呀', createdAt: '' },
        { id: '3', role: 'user', content: '你好', createdAt: '' },
      ],
      memories: [],
      availableActions: ['idle', 'wave'],
      availableEmotions: ['neutral', 'happy'],
    },
    { llmProtocol: 'codex', llmBaseUrl: '', llmModel: '' },
    {},
  );
  assert.equal(reply.text, '你来啦。');
  assert.equal(reply.action, 'wave');
  assert.equal(fetches, 0);
  const [run] = runs;
  assert.match(run.prompt, /角色身份由name与work共同限定/);
  assert.match(run.prompt, /"content":"早上好"/);
  assert.match(run.prompt, /"content":"你好"/);
  assert.deepEqual(run.schema.properties.action.enum, ['idle', 'wave']);
  assert.equal(run.effort, 'low');
  assert.equal(run.search, undefined);
  assert.equal(searchProvider({ llmProtocol: 'codex' }, {}), 'codex');
});

test('Codex research only trusts URLs returned by the search tool, then reads them before the profile', async () => {
  const address = 'https://official.example/character';
  const evidence =
    '小森是森林来信中的信使，绿色短发，棕色斗篷。说话简洁温柔，喜欢观察森林中的树木。他向同伴问候：“明天一起去看树吧。”';
  const html = `<html><head><title>小森 - 官方人物介绍</title></head><body><article><h1>小森</h1><p>${evidence}</p></article></body></html>`;
  const fetched = [];
  const runs = [];
  const services = createServices(
    async (url) => {
      fetched.push(String(url));
      const other =
        '<html><head><title>森林旅游指南</title></head><body><article><p>这是一篇介绍森林徒步路线、露营装备和季节天气的旅游文章，与任何角色无关，只讨论路线和装备的选择。</p></article></body></html>';
      return new Response(String(url).includes('unrelated') ? other : html, {
        headers: { 'Content-Type': 'text/html' },
      });
    },
    {
      resolveHost: async () => [{ address: '93.184.215.14' }],
      codex: {
        run: async (request) => {
          runs.push(request);
          if (request.search)
            return {
              text: JSON.stringify({
                sources: [
                  { title: 'invented', url: 'https://invented.example/fake' },
                  { title: '小森', url: address },
                ],
              }),
              results: [
                { title: '无关结果', url: 'https://unrelated.example/page', snippet: '别的内容' },
                { title: '小森 - 官方', url: address, snippet: '小森是信使' },
              ],
            };
          return {
            text: JSON.stringify({
              identityMatched: true,
              summary: '小森是一名森林信使。',
              personality: ['温和'],
              speakingStyle: '简洁',
              appearance: '绿色短发',
              quotes: [{ text: '明天一起去看树吧。', sourceUrl: address, kind: 'dialogue' }],
              unknowns: [],
              behavior: { energy: 30, affection: 50, curiosity: 70 },
              theme: 'forest',
            }),
          };
        },
      },
    },
  );
  const character = await services.researchCharacter(
    { name: '小森', work: '森林来信', notes: '', mode: 'search' },
    { llmProtocol: 'codex', llmBaseUrl: '', llmModel: '' },
    {},
  );
  assert.equal(runs[0].search, true);
  assert.equal(runs[1].effort, 'medium');
  assert.ok(
    !fetched.some((url) => url.includes('invented.example')),
    'model-written links are never fetched',
  );
  assert.equal(fetched[0], address, 'the picked, name-matching search result is read first');
  assert.deepEqual(
    character.sources.map((source) => source.url),
    [address],
    'unrelated results without the character name are dropped',
  );
  assert.match(
    character.sources[0].snippet,
    /棕色斗篷/,
    'page text, not the search snippet, is the evidence',
  );
  assert.equal(character.knowledge.method, 'codex');
  assert.deepEqual(character.quotes, [{ text: '明天一起去看树吧。', sourceUrl: address }]);
});

test('Pages behind a fake-IP proxy DNS are readable, while literal fake-IP and private links stay blocked', async () => {
  const page =
    '<html><head><title>小森 - 官方人物介绍</title></head><body><article><h1>小森</h1><p>小森是森林来信中的信使，绿色短发，棕色斗篷。说话简洁温柔，喜欢观察森林中的树木，也常常给同伴写信，在信里描述季节变化、雨后的苔藓和远处山谷的风声。</p></article></body></html>';
  const draft = {
    identityMatched: true,
    summary: '小森是一名森林信使。',
    personality: [],
    speakingStyle: '简洁',
    appearance: '绿色短发',
    quotes: [],
    unknowns: [],
    behavior: { energy: 30, affection: 50, curiosity: 70 },
    theme: 'forest',
  };
  const build = (address) =>
    createServices(async () => new Response(page, { headers: { 'Content-Type': 'text/html' } }), {
      resolveHost: async () => [{ address }],
      codex: { run: async () => ({ text: JSON.stringify(draft) }) },
    });
  const settings = { llmProtocol: 'codex', llmBaseUrl: '', llmModel: '' };
  const linkInput = (url) => ({ name: '小森', work: '森林来信', notes: '', mode: 'links', urls: [url] });
  const proxied = await build('198.18.0.151').researchCharacter(
    linkInput('https://wiki.example/xiaosen'),
    settings,
    {},
  );
  assert.match(proxied.sources[0].snippet, /棕色斗篷/);
  await assert.rejects(
    build('198.18.0.151').researchCharacter(linkInput('http://198.18.0.151/page'), settings, {}),
    /没有读到可用正文/,
  );
  await assert.rejects(
    build('192.168.1.10').researchCharacter(linkInput('https://wiki.example/xiaosen'), settings, {}),
    /没有读到可用正文/,
  );
});

test('Codex image mode keeps only the image tool and its host, collects the session picture and cleans up', async () => {
  const pairs = (flag, list) => list.flatMap((v, i) => (list[i - 1] === flag ? [v] : []));
  const args = codexArgs({ directory: '/tmp/work', generateImage: true });
  const disabled = pairs('--disable', args);
  assert.ok(!disabled.includes('image_generation'));
  assert.ok(!disabled.includes('code_mode_host'));
  for (const feature of ['shell_tool', 'unified_exec', 'apps', 'plugins', 'computer_use'])
    assert.ok(disabled.includes(feature));
  assert.ok(pairs('-c', args).includes('web_search="disabled"'));
  assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mori-generated-'));
  const thread = '01a1b59d-e030-7473-8cba-814825cefa0f';
  fs.mkdirSync(path.join(root, thread));
  fs.writeFileSync(path.join(root, thread, 'exec-1.png'), Buffer.from('fixture-generated-png'));
  fs.writeFileSync(path.join(root, thread, 'notes.txt'), 'ignored');
  const imageCalls = [];
  const codex = createCodex({
    spawnFn: fakeSpawn([{ type: 'thread.started', thread_id: thread }, message('done'), done], { calls: imageCalls }),
    environment: async () => ({ HOME: os.homedir() }),
    resolve: async () => '/fixture/codex',
    imagesRoot: () => root,
  });
  const reference = require('./fixtures/pet-images.cjs').url(require('./fixtures/pet-images.cjs').image());
  const result = await codex.run({ prompt: 'draw', generateImage: true, images: [reference, reference] });
  const imagePaths = imageCalls[0].args.flatMap((arg, i, args) => args[i - 1] === '--image' ? [arg] : []);
  assert.equal(imagePaths.length, 2);
  for (const file of imagePaths) assert.ok(imageCalls[0].prompt.includes(file));
  assert.match(imageCalls[0].prompt, /referenced_image_paths/);
  assert.deepEqual(
    result.images.map((image) => image.toString()),
    ['fixture-generated-png'],
  );
  assert.equal(fs.existsSync(path.join(root, thread)), false, "the session's picture folder is removed");

  const empty = createCodex({
    spawnFn: fakeSpawn([
      { type: 'thread.started', thread_id: thread },
      message('I could not draw that.'),
      done,
    ]),
    environment: async () => ({ HOME: os.homedir() }),
    resolve: async () => '/fixture/codex',
    imagesRoot: () => root,
  });
  await assert.rejects(
    empty.run({ prompt: 'draw', generateImage: true }),
    /没有生成图像.*I could not draw that/,
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test('Codex image transport sends only five files for six references, with all source numbers mapped', async () => {
  const fixture = require('./fixtures/pet-images.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mori-budget-'));
  const thread = '01a1b59d-e030-7473-8cba-814825cefa0f';
  fs.mkdirSync(path.join(root, thread));
  fs.writeFileSync(path.join(root, thread, 'image.png'), fixture.image());
  const calls = [];
  const codex = createCodex({
    spawnFn: fakeSpawn([{ type: 'thread.started', thread_id: thread }, message('done'), done], { calls }),
    environment: async () => ({ HOME: os.homedir() }), resolve: async () => '/fixture/codex',
    imagesRoot: () => root,
    referenceCodec: { fit: bytes => fixture.decode(bytes), encode: fixture.encode },
  });
  try {
    const originals = Array.from({ length: 6 }, () => fixture.url(fixture.image()));
    await codex.run({ prompt: 'Images 5 through 6 are continuity references.', generateImage: true, images: originals });
    const paths = calls[0].args.filter((_, i, args) => args[i - 1] === '--image');
    assert.equal(paths.length, 5);
    assert.match(calls[0].prompt, /source image 6 = attachment 5, row 1, column 2/);
    assert.match(calls[0].prompt, /Images 5 through 6 are continuity references/);
    assert.match(calls[0].prompt, /at most five reference paths/);
    assert.ok(calls[0].files['reference-board-5.png'].length > 0);
    assert.equal(fs.existsSync(calls[0].options.cwd), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Image candidates can be drawn by local Codex with the original references and no image key', async () => {
  const fixture = require('./fixtures/pet-images.cjs');
  const stamp = '2026-11-07T00:00:00.000Z';
  const original = fixture.url(fixture.image());
  const runs = [];
  let fetches = 0;
  const services = createServices(
    async () => {
      fetches++;
      throw new Error('no image API');
    },
    {
      codex: {
        run: async (request) => {
          runs.push(request);
          return { text: 'done', images: [fixture.image()] };
        },
      },
    },
  );
  const character = {
    id: 'codex-art',
    name: '角色',
    work: '',
    summary: '',
    personality: [],
    speakingStyle: '',
    appearance: '',
    quotes: [],
    sources: [],
    unknowns: [],
    behavior: { energy: 50, affection: 50, curiosity: 50 },
    createdAt: stamp,
    visualReferences: [{ id: 'identity', name: '角色原图', image: original, createdAt: stamp }],
  };
  const settings = { imageProvider: 'codex', imageBaseUrl: '', imageModel: '' };
  services.checkImageConfiguration(settings, {});
  const skin = await services.generateSkin({ character, style: 'chibi' }, settings, {});
  assert.equal(fetches, 0);
  assert.equal(skin.review.status, 'pending', 'Codex output still waits for review');
  assert.equal(skin.generation.model, 'codex');
  const [run] = runs;
  assert.equal(run.generateImage, true);
  assert.deepEqual(run.images, [original], 'original reference bytes are attached');
  assert.match(run.prompt, /exactly ONE new image/);
  assert.match(run.prompt, /transparent/);
  assert.throws(() => services.checkImageConfiguration({ imageBaseUrl: '', imageModel: '' }, {}), /图像/);
});

test('Her current situation reaches the model as capped context, separate from canon', async () => {
  const runs = [];
  const services = createServices(
    async () => {
      throw new Error('no network');
    },
    {
      codex: {
        run: async (request) => {
          runs.push(request);
          return {
            text: JSON.stringify({ text: '刚放下书呢。', emotion: 'happy', action: 'idle', memory: null }),
          };
        },
      },
    },
  );
  const character = {
    id: 'c',
    name: '昔涟',
    work: '崩坏：星穹铁道',
    summary: '',
    personality: [],
    speakingStyle: '',
    appearance: '',
    quotes: [],
    sources: [],
    unknowns: [],
    behavior: { energy: 60, affection: 60, curiosity: 60 },
  };
  await services.chatWithCharacter(
    {
      character,
      messages: [{ id: '1', role: 'user', content: '在干嘛？', createdAt: '' }],
      memories: [],
      situation: {
        timeOfDay: '下午',
        doing: '在读书',
        reason: '接着看下一段。'.repeat(40),
        feeling: ['有点饿'],
        recentMoments: ['5 分钟前一起吃了点心：分享了草莓蛋糕', 'x', 'y', 'z'],
        injected: 'ignored',
      },
    },
    { llmProtocol: 'codex' },
    {},
  );
  const [run] = runs;
  assert.match(run.prompt, /"situation":\{"timeOfDay":"下午","doing":"在读书"/);
  assert.match(run.prompt, /分享了草莓蛋糕/);
  assert.doesNotMatch(run.prompt, /injected/);
  assert.match(run.prompt, /不要把它说成原作经历/);
  const reason = JSON.parse(run.prompt.match(/"reason":("[^"]*")/)[1]);
  assert.ok(reason.length <= 120);
});

test('Mori account override wins over login shell, uses file credentials and leaves other callers unchanged', async (t) => {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'mori-account-test-'));
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  fs.writeFileSync(path.join(home,'auth.json'),'{}');
  const env={HOME:os.homedir(),CODEX_HOME:'/different-shell-account',PATH:'/usr/bin',CODEX_ACCESS_TOKEN:'do-not-inherit',OPENAI_API_KEY:'api-key'};
  const calls=[];
  const client=createCodex({codexHome:home,environment:async()=>env,resolve:async()=>'/fixture/codex',spawnFn:fakeSpawn([message('ok'),done],{calls})});
  await client.run({prompt:'local fixture only'});
  assert.equal(calls[0].options.env.CODEX_HOME,home);
  assert.equal(calls[0].options.env.CODEX_ACCESS_TOKEN,undefined);
  assert.equal(calls[0].options.env.OPENAI_API_KEY,undefined);
  assert.ok(calls[0].args.includes('cli_auth_credentials_store="file"'));
  assert.equal(env.CODEX_HOME,'/different-shell-account');
  assert.equal(env.CODEX_ACCESS_TOKEN,'do-not-inherit');
  const missing=createCodex({codexHome:path.join(home,'missing'),environment:async()=>env,spawnFn:()=>assert.fail('must not fall back to another account')});
  await assert.rejects(missing.run({prompt:'must not run'}));
});
