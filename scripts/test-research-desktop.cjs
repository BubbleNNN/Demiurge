'use strict';
// Isolated native UI/IPC and local HTTP fixture. No paid provider is contacted.
const { app } = require('electron');
const fs = require('node:fs');
const promises = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const dir = path.resolve(__dirname, '../.local/research-smoke-' + randomUUID());
fs.mkdirSync(dir, { recursive: true });
process.env.MORI_DATA_DIR = dir;
delete process.env.MORI_DEV_URL;
const source = 'https://source.mori.example/profile';
const second = 'https://source.mori.example/story';
const evidence =
  '小森是森林来信中的信使，绿色短发，棕色斗篷。说话简洁温柔，喜欢观察森林中的树木。他向同伴问候：“明天一起去看树吧。”他会先仔细听完朋友的话，再分享自己旅行途中看见的小事。';
const originalFetch = global.fetch;
global.fetch = async (url, init) => {
  if (String(url).startsWith('https://source.mori.example/')) {
    assert.equal(init.headers.Authorization, undefined);
    assert.equal(init.credentials, 'omit');
    const body = String(url).endsWith('/empty')
      ? ''
      : evidence + (String(url) === second ? '他把信送到山间的小屋。' : '');
    return new Response(
      `<html><head><title>昔涟与小森 · 本机测试人物资料</title></head><body><nav>不应该进入资料的广告</nav><article><p>${body}</p></article><script>不应该执行</script></body></html>`,
      { headers: { 'Content-Type': 'text/html' } },
    );
  }
  return originalFetch(url, init);
};
const dns = require('node:dns/promises');
const originalLookup = dns.lookup;
dns.lookup = (host, ...args) =>
  host === 'source.mori.example'
    ? Promise.resolve([{ address: '93.184.215.14' }])
    : originalLookup(host, ...args);
let failNextProfileSave = false,
  failStateWrite = false,
  refuseSearch = false;
let refuseSearchStatus = 403;
const originalRename = promises.rename;
promises.rename = async (...args) => {
  if (failStateWrite && args[1] === path.join(dir, 'state.json')) {
    failStateWrite = false;
    throw new Error('研究档案本机保存恢复验证');
  }
  return originalRename(...args);
};
const profileBodies = [],
  searchPaths = [];
const sockets = new Set();
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET') {
    searchPaths.push(req.url);
    if (refuseSearch) {
      res.statusCode = refuseSearchStatus;
      res.end('{}');
      return;
    }
    const url = new URL(req.url, 'http://localhost');
    const data =
      url.pathname === '/search'
        ? { results: [{ title: '昔涟与小森 · 本机测试人物资料', url: source, content: evidence }] }
        : {
            query: {
              pages: { 1: { title: '昔涟与小森 · 本机测试人物资料', fullurl: source, extract: evidence } },
            },
          };
    res.end(JSON.stringify(data));
    return;
  }
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    try {
      const body = JSON.parse(raw);
      if (body.tools?.[0]?.name === 'web_search') {
        res.end(
          JSON.stringify({
            content: [
              {
                type: 'web_search_tool_result',
                content: [
                  { type: 'web_search_result', title: '官方', url: source, encrypted_content: 'opaque' },
                ],
              },
              {
                type: 'text',
                text: '检索完成',
                citations: [{ type: 'web_search_result_location', url: source, cited_text: evidence }],
              },
            ],
            stop_reason: 'end_turn',
          }),
        );
        return;
      }
      profileBodies.push(body);
      if (failNextProfileSave) {
        failStateWrite = true;
        failNextProfileSave = false;
      }
      const data = JSON.parse(body.messages.at(-1).content.split('以下 JSON 是资料数据：')[1]);
      const profile = {
        identityMatched: true,
        summary: `${data.requestedCharacter.name}是一位森林信使。`,
        personality: ['温和'],
        speakingStyle: '简洁温柔',
        appearance: '绿色短发，棕色斗篷',
        theme: 'forest',
        unknowns: [],
        quotes: [
          { text: '明天一起去看树吧。', sourceUrl: source, kind: 'dialogue' },
          { text: '模型编造的台词', sourceUrl: source, kind: 'dialogue' },
        ],
        behavior: { energy: 90, affection: 50, curiosity: 60 },
      };
      res.end(
        JSON.stringify({
          stop_reason: 'tool_use',
          content: [{ type: 'tool_use', name: 'mori_result', input: profile }],
        }),
      );
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ message: error.message }));
    }
  });
});
server.on('connection', (socket) => {
  sockets.add(socket);
  socket.once('close', () => sockets.delete(socket));
});
let started = false;
const timer = setTimeout(() => finish(new Error('Research desktop check timed out')), 60000);
function finish(error) {
  clearTimeout(timer);
  if (error) console.error(error.stack);
  for (const socket of sockets) socket.destroy();
  server.close();
  console.log('Research artifacts: ' + dir);
  app.exit(error ? 1 : 0);
}
app.on('browser-window-created', (_, win) => {
  if (started) return;
  started = true;
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const wait = async (code) => {
    for (let n = 0; n < 160; n++) {
      if (await js(code)) return;
      await delay(40);
    }
    throw new Error('Timeout: ' + code);
  };
  const click = (label) =>
    js(
      `(()=>{const b=[...document.querySelectorAll('button')].find(b=>(b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)})&&!b.disabled);if(!b)throw new Error('Missing button: '+${JSON.stringify(label)});b.click()})()`,
    );
  const fill = (label, value) =>
    js(
      `(()=>{const el=document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']');if(!el)throw new Error('Missing field');Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}))})()`,
    );
  const choose = async (label, value) => {
    await js(
      `(()=>{const el=document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('change',{bubbles:true}))})()`,
    );
    await wait(
      `document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']').value===${JSON.stringify(value)}`,
    );
  };
  const load = () => js(`window.mori.load().then(r=>r.state)`);
  const create = async (name, mode, urls) => {
    if (await js(`!!document.querySelector('[aria-label="新角色外观设置"]')`))
      await click('稍后补充素材，保留角色档案');
    await click('添加角色');
    await wait(`!!document.querySelector('[aria-label="角色建档方式"]')`);
    assert.equal(await js(`document.querySelector('[aria-label="角色建档方式"]').value`), 'manual');
    await choose('角色建档方式', mode);
    await fill('新角色名字', name);
    await fill('新角色作品', '森林来信');
    if (urls) await fill('新角色资料链接', urls);
    await click('创建角色');
  };
  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(`window.mori.load().then(r=>r.state?.characters.length>0)`);
      const initial = await load();
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const base = `http://127.0.0.1:${server.address().port}`;
      await js(
        `window.mori.load().then(r=>window.mori.saveSettings({...r.state.settings,llmBaseUrl:${JSON.stringify(base)},llmModel:'native-fixture',llmProtocol:'anthropic',llmAuthMode:'bearer',searchProvider:'none'},{llmKey:'local-fixture-not-a-real-key'}))`,
      );
      failNextProfileSave = true;
      await create('草稿小森', 'draft');
      await wait(`document.querySelector('.inline-error')?.textContent.includes('档案已暂存')`);
      assert.equal(profileBodies.length, 1);
      await click('重试保存档案');
      await wait(`!document.querySelector('[aria-label="角色建档方式"]')`);
      let state = await load();
      let current = state.characters.find((c) => c.id === state.activeCharacterId);
      assert.equal(profileBodies.length, 1, 'Local retry must not repeat paid profile generation');
      assert.equal(current.knowledge.kind, 'draft');
      assert.deepEqual(current.sources, []);
      assert.deepEqual(current.quotes, []);
      assert.equal(state.characters.length, initial.characters.length + 1);
      await wait(`document.body.textContent.includes('模型草稿 · 原作设定尚未核实')`);
      await create('链接小森', 'links', source);
      await wait(`!document.querySelector('[aria-label="角色建档方式"]')`);
      state = await load();
      current = state.characters.find((c) => c.id === state.activeCharacterId);
      assert.equal(current.knowledge.method, 'links');
      assert.equal(current.sources.length, 1);
      assert.equal(current.quotes.length, 1);
      assert.doesNotMatch(current.sources[0].snippet, /广告|不应该执行/);
      const characterId = current.id;
      await click('稍后补充素材，保留角色档案');
      await click('角色档案');
      await js(
        `window.mori.load().then(r=>window.mori.save({...r.state,characters:r.state.characters.map(c=>c.id===${JSON.stringify(characterId)}?{...c,behavior:{...c.behavior,energy:17},roleplay:{timeline:'初见',relationship:'朋友',voiceRules:['短句'],avoid:[],customFacts:[],spoilerPolicy:'avoid'}}:c)},r.state))`,
      );
      await wait(`document.body.textContent.includes('17%')`);
      failNextProfileSave = true;
      await click('补充与更新资料');
      await wait(`!!document.querySelector('[aria-label="更新资料链接"]')`);
      await fill('更新资料链接', second);
      await click('读取并更新档案');
      await wait(`document.querySelector('.inline-error')?.textContent.includes('结果已暂存')`);
      const beforeRetry = profileBodies.length;
      await click('重试保存档案');
      await wait(`!document.querySelector('[aria-label="更新资料链接"]')`);
      assert.equal(profileBodies.length, beforeRetry);
      state = await load();
      current = state.characters.find((c) => c.id === characterId);
      assert.equal(current.sources.length, 2);
      assert.equal(current.behavior.energy, 17);
      assert.equal(current.roleplay.voiceRules[0], '短句');
      const updateData = JSON.parse(
        profileBodies.at(-1).messages.at(-1).content.split('以下 JSON 是资料数据：')[1],
      );
      assert.equal(updateData.sources.length, 2, 'Update must use both new and previously saved evidence');
      fs.writeFileSync(path.join(dir, 'sourced-profile.png'), (await win.webContents.capturePage()).toPNG());
      await click('连接与设置');
      await wait(`!!document.querySelector('[aria-label="搜索提供商"]')`);
      await choose('搜索提供商', 'searxng');
      await fill('SearXNG 服务地址', base);
      await click('保存并测试搜索');
      await wait(`document.body.textContent.includes('搜索接口可用，已读取 1 个名称匹配来源')`);
      assert.equal(profileBodies.length, beforeRetry, 'Search tests must not generate a profile');
      assert.ok(searchPaths.at(-1).startsWith('/search?'));
      fs.writeFileSync(path.join(dir, 'search-settings.png'), (await win.webContents.capturePage()).toPNG());
      await create('小森', 'search');
      await wait(`!document.querySelector('[aria-label="角色建档方式"]')`);
      state = await load();
      assert.equal(
        state.characters.find((c) => c.id === state.activeCharacterId).knowledge.method,
        'searxng',
      );
      await click('稍后补充素材，保留角色档案');
      await click('连接与设置');
      await choose('搜索提供商', 'wiki');
      await fill('Wiki API 地址', base + '/w/api.php');
      await click('保存并测试搜索');
      await wait(`document.body.textContent.includes('搜索接口可用，已读取 1 个名称匹配来源')`);
      assert.ok(new URL(searchPaths.at(-1), base).searchParams.has('explaintext'));
      await choose('搜索提供商', 'claude');
      await click('保存并测试搜索');
      await wait(`document.body.textContent.includes('搜索接口可用，已读取 1 个名称匹配来源')`);
      await new Promise((resolve) => {
        win.webContents.once('did-finish-load', resolve);
        win.webContents.reload();
      });
      await wait(`!!document.querySelector('.mori-symbol')`);
      await click('连接与设置');
      await wait(`document.querySelector('[aria-label="搜索提供商"]')?.value==='claude'`);
      assert.equal((await js(`window.mori.load().then(r=>r.keys)`)).llmKey, true);
      await choose('搜索提供商', 'searxng');
      await click('保存设置');
      await wait(`window.mori.load().then(r=>r.state.settings.searchProvider==='searxng')`);
      refuseSearch = true;
      refuseSearchStatus = 567;
      await click('角色档案');
      const beforeBlockedUpdate = await load();
      const beforeBlockedCharacter = beforeBlockedUpdate.characters.find(
        (c) => c.id === beforeBlockedUpdate.activeCharacterId,
      );
      const modelsBeforeBlock = profileBodies.length;
      await click('补充与更新资料');
      await wait(`!!document.querySelector('[aria-label="更新资料方式"]')`);
      await choose('更新资料方式', 'search');
      await click('读取并更新档案');
      await wait(`document.querySelector('.inline-error')?.textContent.includes('HTTP 567')`);
      assert.equal(profileBodies.length, modelsBeforeBlock);
      assert.deepEqual(
        (await load()).characters.find((c) => c.id === beforeBlockedCharacter.id),
        beforeBlockedCharacter,
      );
      assert.equal(
        await js(`document.querySelector('.inline-error').textContent.includes('模型名称')`),
        false,
      );
      await click('改用已保存资料');
      await wait(`document.querySelector('[aria-label="更新资料方式"]').value==='saved'`);
      assert.equal(
        profileBodies.length,
        modelsBeforeBlock,
        'Selecting saved sources must not automatically submit a model request',
      );
      const searchesBeforeSaved = searchPaths.length;
      await click('整理已有资料');
      await wait(`!document.querySelector('[aria-label="更新资料方式"]')`);
      const cachedCharacter = (await load()).characters.find((c) => c.id === beforeBlockedCharacter.id);
      assert.equal(profileBodies.length, modelsBeforeBlock + 1);
      assert.equal(searchPaths.length, searchesBeforeSaved);
      assert.deepEqual(cachedCharacter.sources, beforeBlockedCharacter.sources);
      assert.equal(cachedCharacter.knowledge.method, 'saved');
      assert.match(cachedCharacter.unknowns.join(' '), /未联网/);
      assert.deepEqual(cachedCharacter.behavior, beforeBlockedCharacter.behavior);
      await wait(`document.body.textContent.includes('基于已保存来源')`);
      fs.writeFileSync(
        path.join(dir, 'saved-sources-profile.png'),
        (await win.webContents.capturePage()).toPNG(),
      );
      await assert.rejects(
        js(
          `window.mori.research({name:'小森',work:'森林来信',notes:'',mode:'saved',existingSources:[{title:'伪造',url:'https://fake.example',snippet:'伪造的证据'}]})`,
        ),
        /没有已保存的来源正文/,
      );
      assert.equal(
        profileBodies.length,
        modelsBeforeBlock + 1,
        'Main process must ignore renderer-supplied saved sources',
      );
      refuseSearchStatus = 403;
      const beforeFailure = (await load()).characters.length,
        modelBeforeFailure = profileBodies.length;
      await create('失败小森', 'search');
      await wait(`document.querySelector('.inline-error')?.textContent.includes('HTTP 403')`);
      assert.equal((await load()).characters.length, beforeFailure);
      assert.equal(
        profileBodies.length,
        modelBeforeFailure,
        'A failed search must not silently become a model draft',
      );
      assert.equal(await js(`document.querySelector('[aria-label="新角色名字"]').value`), '失败小森');
      assert.deepEqual((await load()).messages, {
        ...initial.messages,
        ...Object.fromEntries(
          (await load()).characters
            .filter((c) => !initial.characters.some((x) => x.id === c.id))
            .map((c) => [c.id, []]),
        ),
      });
      console.log(
        'Native research passed: explicit draft selection, key-only creation, link evidence and quote filtering, cached local saves, evidence updates, SearXNG/Wiki/Claude selection and tests, reload persistence, source-site 567 hints, explicit saved-source updates without source requests, fabricated-cache rejection and preserved drafts.',
      );
      finish();
    } catch (error) {
      finish(error);
    }
  });
});
require('../electron/main.cjs');
