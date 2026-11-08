'use strict';
// Isolated local transport fixture; never contacts a paid provider.
const { app, BrowserWindow, dialog, clipboard } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const dir = path.resolve(__dirname, '../.local/chat-smoke-' + randomUUID());
fs.mkdirSync(dir, { recursive: true });
process.env.MORI_DATA_DIR = dir;
delete process.env.MORI_DEV_URL;
const exported = path.join(dir, 'conversation.txt');
dialog.showSaveDialog = async () => ({ canceled: false, filePath: exported });
let requests = 0,
  aborted = 0,
  started = false;
let failNextReplyWrite = true;
const requestBodies = [];
const requestPaths = [];
const requestHeaders = [];
let respondNext = false,
  responseDelay = 0,
  failStateWrite = false;
const filePromises = require('node:fs/promises');
const originalRename = filePromises.rename;
filePromises.rename = async (...args) => {
  if (failStateWrite && args[1] === path.join(dir, 'state.json')) {
    failStateWrite = false;
    throw new Error('本机写盘恢复验证');
  }
  return originalRename(...args);
};
const sockets = new Set();
const server = http.createServer((req, res) => {
  requests++;
  requestPaths.push(req.url);
  requestHeaders.push(req.headers);
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    try {
      requestBodies.push(JSON.parse(body));
    } catch {}
  });
  req.resume();
  if (respondNext) {
    respondNext = false;
    failStateWrite = failNextReplyWrite;
    res.setHeader('Content-Type', 'application/json');
    const reply = {
      text: '本机保存恢复验证完成',
      emotion: 'neutral',
      action: 'idle',
      memory: null,
    };
    const payload = JSON.stringify(
      req.url.endsWith('/v1/messages')
        ? {
            type: 'message',
            stop_reason: 'tool_use',
            content: [
              {
                type: 'tool_use',
                name: 'mori_result',
                input: { ...reply, text: 'Claude 原生协议回复验证完成' },
              },
            ],
          }
        : { choices: [{ message: { content: JSON.stringify(reply) } }] },
    );
    const delayMs = responseDelay;
    responseDelay = 0;
    if (delayMs) setTimeout(() => res.end(payload), delayMs);
    else res.end(payload);
  }
  res.on('close', () => {
    if (!res.writableEnded) aborted++;
  });
  // Deliberately leave the response pending to test cancellation.
});
server.on('connection', (socket) => {
  sockets.add(socket);
  socket.once('close', () => sockets.delete(socket));
});
const timer = setTimeout(() => finish(new Error('Chat check timed out')), 45000);
function finish(error) {
  clearTimeout(timer);
  if (error) console.error(error.stack);
  for (const socket of sockets) socket.destroy();
  server.close();
  console.log('Chat artifacts: ' + dir);
  app.exit(error ? 1 : 0);
}
app.on('browser-window-created', (_, win) => {
  // Animation state is read from the page; a window behind other apps must keep its frames.
  win.webContents.setBackgroundThrottling(false);
  if (started) return;
  started = true;
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const wait = async (code) => {
    for (let n = 0; n < 160; n++) {
      if (await js(code)) return;
      await delay(40);
    }
    throw new Error('Timeout: ' + code);
  };
  const click = (title) =>
    js(
      `(()=>{const b=[...document.querySelectorAll('button')].find(b=>(b.textContent.trim()===${JSON.stringify(title)}||b.getAttribute('aria-label')===${JSON.stringify(title)})&&!b.disabled);if(!b)throw new Error('Button missing');b.click()})()`,
    );
  const fill = (label, value) =>
    js(
      `(()=>{const el=document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']');const setter=Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;setter.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}))})()`,
    );
  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(`window.mori.load().then(({state})=>state?.characters.length>0)`);
      await js(`window.mori.openPet()`);
      let pet = BrowserWindow.getAllWindows().find((w) => w !== win);
      const petJS = (code) => pet.webContents.executeJavaScript(code, true);
      const waitPet = async (code) => {
        for (let n = 0; n < 160; n++) {
          if (await petJS(code)) return;
          await delay(40);
        }
        throw new Error('Pet timeout: ' + code);
      };
      for (let n = 0; n < 160; n++) {
        if (!pet.webContents.isLoading() && (await petJS(`!!document.querySelector('.pet-toolbar')`))) break;
        await delay(40);
      }
      await petJS(
        `(async()=>{document.querySelector('[aria-label="和角色说话"]').click();for(let n=0;n<100&&!document.querySelector('[aria-label="打开桌宠聊天"]');n++)await new Promise(r=>setTimeout(r,20));document.querySelector('[aria-label="打开桌宠聊天"]').click()})()`,
      );
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = `http://127.0.0.1:${server.address().port}/v1`;
      await js(
        `window.mori.load().then(({state})=>window.mori.saveSettings({...state.settings,chatMode:'model',llmBaseUrl:${JSON.stringify(address)},llmModel:'local-transport-fixture'},{llmKey:'fixture-no-paid-service'}))`,
      );
      await wait(`document.querySelector('.connection-text')?.textContent.includes('已配置')`);
      await click('查看对话记录');
      await waitPet(`document.querySelector('.connection-text')?.textContent.includes('已配置')`);
      assert.ok(
        await petJS(`document.querySelector('.connection-text')?.textContent.includes('已配置')`),
        'Pet connection should update without reload',
      );
      await click('连接与设置');
      await js(
        `(()=>{const el=document.querySelector('[aria-label="对话地址形式"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,'exact');el.dispatchEvent(new Event('change',{bubbles:true}))})()`,
      );
      await wait(`document.querySelector('[aria-label="对话地址形式"]').value==='exact'`);
      const exactAddress = `http://127.0.0.1:${server.address().port}/custom-request`;
      await fill('对话服务地址', exactAddress);
      await click('保存设置');
      await wait(`window.mori.load().then(r=>r.state.settings.llmEndpointMode==='exact')`);
      assert.equal((await js(`window.mori.load().then(r=>r.state)`)).settings.llmBaseUrl, exactAddress);
      await click('Demiurge 首页');
      await fill('聊天消息', '原生检查：今天想看星星');
      await click('发送消息');
      for (let n = 0; n < 100 && requests === 0; n++) await delay(30);
      assert.equal(requests, 1);
      assert.equal(requestPaths[0], '/custom-request', 'Saved exact URL must not acquire a chat suffix');
      await waitPet(`document.querySelector('.connection-text')?.textContent.includes('另一窗口')`);
      assert.equal((await petJS(`window.mori.load().then(r=>r.chatStatus)`)).busy, true);
      await new Promise((resolve) => {
        pet.webContents.once('did-finish-load', resolve);
        pet.webContents.reload();
      });
      await waitPet(`!!document.querySelector('.pet-toolbar')`);
      await petJS(
        `(async()=>{document.querySelector('[aria-label="和角色说话"]').click();for(let n=0;n<100&&!document.querySelector('[aria-label="打开桌宠聊天"]');n++)await new Promise(r=>setTimeout(r,20));document.querySelector('[aria-label="打开桌宠聊天"]').click()})()`,
      );
      await waitPet(`document.querySelector('.connection-text')?.textContent.includes('另一窗口')`);
      await petJS(
        `(()=>{const input=document.querySelector('[aria-label="聊天消息"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'桌宠等待时保留的草稿');input.dispatchEvent(new Event('input',{bubbles:true}))})()`,
      );
      await waitPet(`document.querySelector('[aria-label="聊天消息"]').value==='桌宠等待时保留的草稿'`);
      assert.ok(await petJS(`document.querySelector('[aria-label="发送消息"]').disabled`));
      await delay(100);
      fs.writeFileSync(path.join(dir, 'shared-chat-pet.png'), (await pet.webContents.capturePage()).toPNG());
      await click('停止等待');
      await wait(`document.querySelector('.inline-error')?.textContent.includes('停止等待')`);
      await waitPet(`!document.querySelector('[aria-label="发送消息"]').disabled`);
      assert.equal(
        await petJS(`document.querySelector('[aria-label="聊天消息"]').value`),
        '桌宠等待时保留的草稿',
      );
      for (let n = 0; n < 100 && aborted === 0; n++) await delay(30);
      assert.equal(aborted, 1, 'Pending HTTP transport must be closed');
      const saved = await js(`window.mori.load().then(({state})=>state.messages[state.activeCharacterId])`);
      assert.equal(saved.length, 1);
      assert.equal(saved[0].role, 'user');
      await js(`window.mori.copyText('复制原生验证：星星♪')`);
      assert.equal(clipboard.readText(), '复制原生验证：星星♪');
      await click('查找与导出对话');
      await fill('搜索对话', '星星');
      await wait(`document.querySelectorAll('.conversation-results > button').length===1`);
      await click('导出完整记录');
      await wait(`document.querySelector('.toast')?.textContent.includes('对话已导出')`);
      for (let n = 0; n < 100 && !fs.existsSync(exported); n++) await delay(30);
      assert.match(fs.readFileSync(exported, 'utf8'), /今天想看星星/);
      assert.equal(fs.readFileSync(exported, 'utf8').includes('fixture-no-paid-service'), false);
      fs.writeFileSync(
        path.join(dir, 'conversation-search.png'),
        (await win.webContents.capturePage()).toPNG(),
      );
      await click('关闭弹窗');
      const before = await js(`window.mori.load().then(r=>r.state)`);
      await Promise.all([
        js(
          `(()=>{const base=${JSON.stringify(before)},next=structuredClone(base);next.characters[0].summary='两个窗口的独立更新';return window.mori.save(next,base)})()`,
        ),
        petJS(
          `(()=>{const base=${JSON.stringify(before)},next=structuredClone(base);next.memories.push({id:'native-pet-memory',characterId:base.activeCharacterId,text:'我喜欢看星星',createdAt:new Date().toISOString()});return window.mori.save(next,base)})()`,
        ),
      ]);
      const merged = await js(`window.mori.load().then(r=>r.state)`);
      assert.equal(merged.characters[0].summary, '两个窗口的独立更新');
      assert.ok(merged.memories.some((m) => m.id === 'native-pet-memory'));
      await click('Demiurge 首页');
      await click('角色工作室');
      await click('角色档案');
      await click('编辑档案');
      const originalRules = await js(`document.querySelector('[aria-label="语气习惯"]').value`);
      await fill('语气习惯', '文'.repeat(401));
      await wait(`document.querySelector('.modal [role="alert"]')?.textContent.includes('每条最多 400 字')`);
      assert.ok(await js(`document.querySelector('.modal .button.primary.full').disabled`));
      assert.equal(await js(`document.querySelector('[aria-label="语气习惯"]').value.length`), 401);
      const tooManyRules = Array.from({ length: 13 }, (_, index) => '习惯' + index).join('\n');
      await fill('语气习惯', tooManyRules);
      await wait(`document.querySelector('.modal [role="alert"]')?.textContent.includes('最多 12 条')`);
      assert.equal(await js(`document.querySelector('[aria-label="语气习惯"]').value`), tooManyRules);
      await fill('语气习惯', originalRules);
      await wait(`!document.querySelector('.modal .button.primary.full').disabled`);
      await fill('角色名字', '保留的编辑草稿');
      await petJS(
        `window.mori.load().then(({state})=>window.mori.save({...state,characters:state.characters.map(c=>({...c,name:'另一窗口的名字'}))},state))`,
      );
      await click('保存角色档案');
      await wait(`document.querySelector('.toast')?.textContent.includes('草稿已保留')`);
      assert.equal(await js(`document.querySelector('[aria-label="角色名字"]').value`), '保留的编辑草稿');
      assert.equal((await js(`window.mori.load().then(r=>r.state)`)).characters[0].name, '另一窗口的名字');
      await click('重新读取最新档案');
      await fill('角色名字', '合并后的名字');
      await fill('活跃程度', '25');
      await petJS(
        `window.mori.load().then(({state})=>window.mori.save({...state,characters:state.characters.map(c=>({...c,summary:'远端更新简介，保留独立编辑'}))},state))`,
      );
      await click('保存角色档案');
      await wait(`!document.querySelector('[aria-label="编辑角色档案"]')`);
      const final = await js(`window.mori.load().then(r=>r.state)`);
      assert.equal(final.characters[0].name, '合并后的名字');
      assert.equal(final.characters[0].summary, '远端更新简介，保留独立编辑');
      assert.equal(final.characters[0].behavior.energy, 25);
      await click('Demiurge 首页');
      respondNext = true;
      if (await js(`!!document.querySelector('[aria-label="查看对话记录"]')`)) await click('查看对话记录');
      await fill('聊天消息', '仅测试本机保存恢复');
      await click('发送消息');
      await wait(`document.querySelector('.inline-error')?.textContent.includes('回复已生成')`);
      const callCount = requests;
      await click('仅重试本机保存');
      await wait(`document.querySelector('.chat-history')?.textContent.includes('本机保存恢复验证完成')`);
      assert.equal(requests, callCount, 'Completed reply retry must not request the model again');
      const restored = await js(`window.mori.load().then(r=>r.state.messages[r.state.activeCharacterId])`);
      assert.equal(restored.filter((m) => m.content === '本机保存恢复验证完成').length, 1);
      const beforePreview = await js(`window.mori.load().then(r=>r.state)`);
      await click('Demiurge 首页');
      await click('角色工作室');
      await click('角色档案');
      await click('角色试聊');
      failNextReplyWrite = false;
      respondNext = true;
      responseDelay = 200;
      await click('听听这句回应');
      await waitPet(`document.querySelector('.connection-text')?.textContent.includes('试聊')`);
      assert.ok(await petJS(`document.querySelector('[aria-label="发送消息"]').disabled`));
      await wait(`document.querySelector('.preview-words')?.textContent.includes('本机保存恢复验证完成')`);
      const afterPreview = await js(`window.mori.load().then(r=>r.state)`);
      await waitPet(`!document.querySelector('[aria-label="发送消息"]').disabled`);
      assert.deepEqual(afterPreview.messages, beforePreview.messages, 'Preview must not alter chat history');
      assert.deepEqual(afterPreview.memories, beforePreview.memories, 'Preview must not alter memory');
      assert.match(requestBodies.at(-1).messages[1].content, /"memories":\[\]/);
      assert.match(requestBodies.at(-1).messages[1].content, /"energy":25/);
      assert.equal(
        JSON.stringify(requestBodies.at(-1)).includes('我喜欢看星星'),
        false,
        'Preview must not inherit private user memories',
      );
      fs.writeFileSync(path.join(dir, 'persona-preview.png'), (await win.webContents.capturePage()).toPNG());
      await click('关闭弹窗');
      await click('相处记忆');
      await click('编辑记忆：我喜欢看星星');
      await fill('记忆内容', '删除后保留的记忆草稿');
      await petJS(
        `window.mori.load().then(({state})=>window.mori.save({...state,memories:state.memories.filter(m=>m.id!=='native-pet-memory')},state))`,
      );
      await wait(`document.querySelector('.modal .notice')?.textContent.includes('删除了这段记忆')`);
      await click('保存为新记忆');
      await wait(`!document.querySelector('[aria-label="编辑这段记忆"]')`);
      const recovered = await js(`window.mori.load().then(r=>r.state)`);
      assert.ok(recovered.memories.some((m) => m.text === '删除后保留的记忆草稿'));
      assert.equal(
        recovered.memories.some((m) => m.id === 'native-pet-memory'),
        false,
      );
      fs.writeFileSync(path.join(dir, 'memory-recovery.png'), (await win.webContents.capturePage()).toPNG());
      await click('连接与设置');
      await fill('对话模型 ID', 'unsaved-native-draft');
      await petJS(
        `window.mori.load().then(({state})=>window.mori.save({...state,settings:{...state.settings,motionEnabled:false}},state))`,
      );
      assert.equal(
        await js(`document.querySelector('[aria-label="对话模型 ID"]').value`),
        'unsaved-native-draft',
      );
      await click('保存设置');
      await wait(`document.querySelector('.toast')?.textContent.includes('服务配置已保存')`);
      const configured = await js(`window.mori.load().then(r=>r.state)`);
      assert.equal(configured.settings.llmModel, 'unsaved-native-draft');
      assert.equal(configured.settings.motionEnabled, false);
      await click('Demiurge 首页');
      const topicBefore = await js(`window.mori.load().then(r=>r.state)`);
      await click('查找与导出对话');
      await click('开启新话题');
      await wait(`!!document.querySelector('.topic-notice')`);
      await click('取消开启新话题');
      assert.deepEqual(
        (await js(`window.mori.load().then(r=>r.state)`)).messages,
        topicBefore.messages,
        'Preparing or cancelling a topic must not modify stored messages',
      );
      await click('查找与导出对话');
      await click('开启新话题');
      respondNext = true;
      await fill('聊天消息', '从新的日常话题开始');
      await click('发送消息');
      const oldLength = topicBefore.messages[topicBefore.activeCharacterId].length;
      await wait(
        `window.mori.load().then(({state})=>state.messages[state.activeCharacterId].length===${oldLength + 2})`,
      );
      const topicAfter = await js(`window.mori.load().then(r=>r.state)`);
      const topicMessages = topicAfter.messages[topicAfter.activeCharacterId];
      assert.equal(topicMessages.at(-2).contextStart, true);
      assert.equal(topicMessages.at(-1).replyTo, topicMessages.at(-2).id);
      assert.deepEqual(
        topicAfter.memories,
        topicBefore.memories,
        'A new topic must preserve long-term memories',
      );
      assert.deepEqual(
        requestBodies
          .at(-1)
          .messages.filter((m) => m.role !== 'system')
          .map((m) => m.content),
        ['从新的日常话题开始'],
        'Earlier conversation must not enter the new topic request',
      );
      if (await js(`!!document.querySelector('[aria-label="查看对话记录"]')`)) await click('查看对话记录');
      await wait(`!!document.querySelector('.topic-divider')`);
      fs.writeFileSync(path.join(dir, 'new-topic.png'), (await win.webContents.capturePage()).toPNG());
      await new Promise((resolve) => {
        win.webContents.once('did-finish-load', resolve);
        win.webContents.reload();
      });
      await wait(`!!document.querySelector('[aria-label="查看对话记录"]')`);
      await click('查看对话记录');
      await wait(`!!document.querySelector('.topic-divider')`);
      respondNext = true;
      await fill('聊天消息', '继续这个话题');
      await click('发送消息');
      await wait(
        `window.mori.load().then(({state})=>state.messages[state.activeCharacterId].length===${oldLength + 4})`,
      );
      assert.deepEqual(
        requestBodies
          .at(-1)
          .messages.filter((m) => m.role !== 'system')
          .map((m) => m.content),
        ['从新的日常话题开始', '本机保存恢复验证完成', '继续这个话题'],
        'Topic boundary must survive reloading the real renderer',
      );
      const draftBefore = await js(`window.mori.load().then(r=>r.state)`);
      const callsBeforeDrafts = requests;
      await click('开启新话题');
      await wait(`!!document.querySelector('.topic-notice')`);
      await fill('聊天消息', '留给原来角色的草稿');
      await js(
        `window.mori.load().then(({state})=>window.mori.save({...state,characters:[...state.characters,{...state.characters[0],id:'native-other-character',name:'另一个测试角色'}],messages:{...state.messages,'native-other-character':[]},activeCharacterId:'native-other-character',activeSkinId:''},state))`,
      );
      await wait(`document.querySelector('[aria-label="聊天消息"]').value===''`);
      for (let n = 0; n < 160 && !pet.isDestroyed(); n++) await delay(40);
      assert.equal(pet.isDestroyed(), true, 'Switching to a character without usable art closes the old pet');
      assert.equal(await js(`!!document.querySelector('.topic-notice')`), false);
      await fill('聊天消息', '留给另一个角色的草稿');
      await js(
        `window.mori.load().then(({state})=>window.mori.save({...state,activeCharacterId:${JSON.stringify(draftBefore.activeCharacterId)},activeSkinId:${JSON.stringify(draftBefore.activeSkinId)}},state))`,
      );
      await wait(`document.querySelector('[aria-label="聊天消息"]').value==='留给原来角色的草稿'`);
      assert.ok(
        await js(`!!document.querySelector('.topic-notice')`),
        'Pending topic belongs to its character',
      );
      await js(
        `window.mori.load().then(({state})=>window.mori.save({...state,activeCharacterId:'native-other-character',activeSkinId:''},state))`,
      );
      await wait(`document.querySelector('[aria-label="聊天消息"]').value==='留给另一个角色的草稿'`);
      await js(
        `window.mori.load().then(({state})=>window.mori.save({...state,activeCharacterId:${JSON.stringify(draftBefore.activeCharacterId)},activeSkinId:${JSON.stringify(draftBefore.activeSkinId)}},state))`,
      );
      await wait(`document.querySelector('[aria-label="聊天消息"]').value==='留给原来角色的草稿'`);
      const draftAfter = await js(`window.mori.load().then(r=>r.state)`);
      assert.deepEqual(
        draftAfter.messages[draftBefore.activeCharacterId],
        draftBefore.messages[draftBefore.activeCharacterId],
      );
      await js(`window.mori.openPet()`);
      pet = BrowserWindow.getAllWindows().find((w) => w !== win);
      await waitPet(`!!document.querySelector('[aria-label="和角色说话"]')`);
      await petJS(
        `(async()=>{document.querySelector('[aria-label="和角色说话"]').click();for(let n=0;n<100&&!document.querySelector('[aria-label="打开桌宠聊天"]');n++)await new Promise(r=>setTimeout(r,20));document.querySelector('[aria-label="打开桌宠聊天"]').click()})()`,
      );
      await waitPet(`!!document.querySelector('.compose-bottom [aria-label="开启新话题"]')`);
      await petJS(`document.querySelector('.compose-bottom [aria-label="开启新话题"]').click()`);
      await waitPet(`!!document.querySelector('.topic-notice')`);
      assert.ok(await petJS(`!!document.querySelector('.topic-notice')`), 'Pet needs a direct topic action');
      assert.ok(
        await petJS(`document.querySelector('.chat-compose').getBoundingClientRect().bottom<=innerHeight`),
      );
      await delay(100);
      assert.ok(await petJS(`document.querySelector('.topic-notice')?.getBoundingClientRect().height>20`));
      fs.writeFileSync(path.join(dir, 'pet-new-topic.png'), (await pet.webContents.capturePage()).toPNG());
      await petJS(`document.querySelector('[aria-label="取消开启新话题"]').click()`);
      assert.equal(
        requests,
        callsBeforeDrafts,
        'Draft changes and preparing a topic must not call any model',
      );
      await click('连接与设置');
      const choose = async (label, value) => {
        await js(
          `(()=>{const el=document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('change',{bubbles:true}))})()`,
        );
        await wait(
          `document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']').value===${JSON.stringify(value)}`,
        );
      };
      await choose('对话接口协议', 'anthropic');
      await choose('Claude 密钥发送方式', 'bearer');
      await choose('对话地址形式', 'base');
      await fill('对话服务地址', `http://127.0.0.1:${server.address().port}`);
      await click('保存设置');
      await wait(
        `window.mori.load().then(r=>r.state.settings.llmProtocol==='anthropic'&&r.state.settings.llmAuthMode==='bearer'&&r.state.settings.llmEndpointMode==='base')`,
      );
      await new Promise((resolve) => {
        win.webContents.once('did-finish-load', resolve);
        win.webContents.reload();
      });
      await wait(`!!document.querySelector('.room-rail')`);
      await click('连接与设置');
      assert.equal(await js(`document.querySelector('[aria-label="对话接口协议"]').value`), 'anthropic');
      assert.equal(await js(`document.querySelector('[aria-label="Claude 密钥发送方式"]').value`), 'bearer');
      await delay(100);
      fs.writeFileSync(
        path.join(dir, 'anthropic-settings.png'),
        (await win.webContents.capturePage()).toPNG(),
      );
      await click('Demiurge 首页');
      respondNext = true;
      await fill('聊天消息', 'Claude 接入方式验证');
      await click('发送消息');
      await wait(
        `document.querySelector('.room-bubble')?.textContent.includes('Claude 原生协议回复验证完成')`,
      );
      assert.equal(requests, callsBeforeDrafts + 1);
      assert.equal(requestPaths.at(-1), '/v1/messages');
      assert.equal(requestHeaders.at(-1).authorization, 'Bearer fixture-no-paid-service');
      assert.equal(requestHeaders.at(-1)['x-api-key'], undefined);
      assert.equal(requestHeaders.at(-1)['anthropic-version'], '2023-06-01');
      assert.match(requestBodies.at(-1).system, /合并后的名字/);
      assert.equal(
        requestBodies.at(-1).messages.some((m) => m.role === 'system'),
        false,
      );
      assert.match(requestBodies.at(-1).messages.at(-1).content, /"userMessage":"Claude 接入方式验证"/);
      assert.equal(requestBodies.at(-1).tool_choice.name, 'mori_result');
      assert.equal((await js(`window.mori.load().then(r=>r.keys)`)).llmKey, true);
      console.log(
        'PASS native chat recovery, window merges, persona preview, topics, drafts, exact URLs and Anthropic structured responses',
      );
      finish();
    } catch (error) {
      finish(error);
    }
  });
});
require('../electron/main.cjs');
