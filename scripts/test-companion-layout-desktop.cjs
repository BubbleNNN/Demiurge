'use strict';
// Native UI, real input events and an isolated workspace. No paid API.
const { app } = require('electron');
const fs = require('node:fs');
const promises = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const dir = path.resolve(__dirname, '../.local/companion-layout-smoke-' + randomUUID());
fs.mkdirSync(dir, { recursive: true });
process.env.MORI_DATA_DIR = dir;
delete process.env.MORI_DEV_URL;
process.env.MORI_DEV_VIEW = 'chat';
let apiCalls = 0,
  failReplySave = false;
global.fetch = async () => {
  apiCalls++;
  throw new Error('Companion layout must not contact an API');
};
const rename = promises.rename;
promises.rename = async (...args) => {
  if (failReplySave && args[1] === path.join(dir, 'state.json')) {
    const candidate = JSON.parse(await promises.readFile(args[0], 'utf8'));
    if (candidate.messages[candidate.activeCharacterId]?.at(-1)?.origin === 'script') {
      failReplySave = false;
      throw new Error('Layout fixture: fail completed reply save once');
    }
  }
  return rename(...args);
};
let win;
const timer = setTimeout(() => finish(new Error('Companion layout timed out')), 60000);
async function finish(error) {
  clearTimeout(timer);
  if (error) {
    console.error(error.stack);
    if (win && !win.isDestroyed())
      console.error((await win.webContents.executeJavaScript('document.body.innerText')).slice(-2200));
  } else
    console.log(
      'Native companion layout passed: composer below character, history collapsed with latest speech only, separate head/body input, no fake unavailable actions or saved touch messages, cooldown, rest/wake, collapsed settings with preserved drafts, expanded history, compact save-failure retry, responsive layout, studio tabs and settings navigation, chat deep link to the history drawer, shared composer drafts, native pet controls and zero API calls.',
    );
  console.log('Artifacts: ' + dir);
  app.exit(error ? 1 : 0);
}
app.on('browser-window-created', (_event, created) => {
  // Animation state is read from the page; a window behind other apps must keep its frames.
  created.webContents.setBackgroundThrottling(false);
  if (win) return;
  win = created;
  const js = (code) =>
    win.webContents.executeJavaScript(code, true).catch((error) => {
      throw new Error(`Renderer command failed: ${code}\n${error.message}`);
    });
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const wait = async (code) => {
    for (let n = 0; n < 160; n++) {
      if (await js(code)) return;
      await delay(50);
    }
    throw new Error('Layout did not reach: ' + code);
  };
  const click = (label) =>
    js(
      `(()=>{const b=[...document.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')===${JSON.stringify(label)}||b.textContent.trim()===${JSON.stringify(label)})&&!b.disabled);if(!b)throw new Error('Missing '+${JSON.stringify(label)});b.click()})()`,
    );
  const physicalClick = async (label) => {
    await wait(
      `(()=>{const b=document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']');return b&&!b.disabled})()`,
    );
    const rect = await js(
      `(()=>{const b=document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']');if(!b||b.disabled)throw new Error('Unavailable target');const r=b.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,
    );
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...rect });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...rect });
  };
  const fill = (label, value) =>
    js(
      `(()=>{const el=document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']');Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}))})()`,
    );
  const state = () => js('window.mori.load().then(r=>r.state)');
  const screenshot = async (name) => {
    await delay(250);
    await promises.writeFile(path.join(dir, name + '.png'), (await win.webContents.capturePage()).toPNG());
  };
  win.webContents.once('did-finish-load', async () => {
    try {
      // The old chat page is now the home screen with its history drawer open.
      await wait(`!!document.querySelector('.room-rail')`);
      await wait(`document.querySelector('main').dataset.feature==='home'`);
      assert.equal(await js(`new URL(location.href).searchParams.get('view')`), 'chat');
      assert.ok(await js(`!!document.querySelector('.history-drawer .chat-history')`));
      await click('关闭对话记录');
      await js(
        `window.mori.load().then(r=>{const s=r.state;return window.mori.save({...s,activeSkinId:'cyrene-8bit-v5',messages:{...s.messages,[s.activeCharacterId]:[{id:'old-user',role:'user',content:'更早的问候',createdAt:new Date().toISOString()},{id:'old-reply',role:'assistant',content:'较早的回复应当保持折叠',createdAt:new Date().toISOString()},{id:'recent-user',role:'user',content:'最近的问候',createdAt:new Date().toISOString()},{id:'recent-reply',role:'assistant',content:'最近一次回复显示在人物气泡里',createdAt:new Date().toISOString()}]}},s)})`,
      );
      await wait(
        `document.querySelector('.room-figure canvas[data-clip]')&&document.querySelector('.room-bubble')?.textContent.includes('最近一次回复')&&!document.querySelector('.head-zone').disabled`,
      );
      const initial = await state();
      assert.equal(await js(`!!document.querySelector('.chat-history')`), false);
      assert.equal(await js(`document.querySelector('.chat-preferences').open`), false);
      assert.equal(
        await js(`document.querySelector('[aria-label="展开人物设置"]').getAttribute('aria-expanded')`),
        'false',
      );
      assert.ok(
        await js(
          `document.querySelector('.room-composer').getBoundingClientRect().top>=document.querySelector('.room-figure').getBoundingClientRect().bottom`,
        ),
        'Composer sits below the character',
      );
      assert.equal(await js(`document.body.textContent.includes('较早的回复应当保持折叠')`), false);
      await screenshot('compact-home');
      await js(`document.querySelector('.chat-preferences summary').click()`);
      assert.ok(await js(`document.querySelector('.chat-preferences').open`));
      assert.ok(
        await js(
          `(()=>{const b=document.querySelector('.chat-mode-picker button');const r=b.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b})()`,
        ),
        'Mode picker must not be obscured by the stage',
      );
      await screenshot('conversation-options');
      await js(
        `document.querySelector('.chat-preferences summary').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`,
      );
      assert.equal(await js(`document.querySelector('.chat-preferences').open`), false);
      await physicalClick('摸摸角色的头');
      await wait(`!!document.querySelector('.touch-feedback.headpat')`);
      const pat = await js(`document.querySelector('.room-bubble .room-line').textContent`);
      assert.match(pat, /关心|舒服/);
      // The current 8-bit pack has an authored nod clip, unlike the original fixture.
      await wait(`document.querySelector('.room-figure canvas').dataset.clip==='nod'`);
      await physicalClick('戳一戳角色');
      assert.equal(
        await js(`document.querySelector('.room-bubble .room-line').textContent`),
        pat,
        'Rapid taps share a cooldown',
      );
      await delay(1850);
      await physicalClick('戳一戳角色');
      await wait(`!!document.querySelector('.touch-feedback.poke')`);
      assert.notEqual(await js(`document.querySelector('.room-bubble .room-line').textContent`), pat);
      assert.deepEqual(
        (await state()).messages,
        initial.messages,
        'Physical interactions do not write conversation history',
      );
      assert.equal(await js(`!!document.querySelector('.local-interaction-bar')`), false);
      await click('展开人物设置');
      await click('让角色休息');
      await wait(`document.querySelector('.room-figure canvas').dataset.clip==='sleep'`);
      assert.ok(
        await js(
          `document.querySelector('.head-zone').disabled&&document.querySelector('.poke-zone').disabled`,
        ),
      );
      await click('唤醒角色');
      await click('收起人物设置');
      await click('查看对话记录');
      await wait(`document.querySelectorAll('.history-drawer .chat-message').length===4`);
      assert.ok(
        await js(`document.querySelector('.chat-history').textContent.includes('较早的回复应当保持折叠')`),
      );
      await click('收起对话记录');
      await wait(`!document.querySelector('.chat-history')`);
      assert.deepEqual((await state()).messages, initial.messages);
      await fill('聊天消息', '切换模块后继续输入的草稿');
      // Studio tabs and settings replace the old seven-page sidebar.
      await click('角色工作室');
      for (const [tab, feature] of [
        ['外观与动作', 'wardrobe'],
        ['相处记忆', 'memories'],
        ['角色档案', 'characters'],
      ]) {
        await click(tab);
        await wait(`document.querySelector('main').dataset.feature===${JSON.stringify(feature)}`);
        assert.equal(
          await js(`document.querySelector('.studio-tabs [aria-selected="true"]').textContent.trim()`),
          tab,
        );
      }
      await click('连接与设置');
      await wait(`document.querySelector('main').dataset.feature==='settings'`);
      assert.equal(
        await js(`document.querySelector('.room-rail [aria-current="page"]').getAttribute('aria-label')`),
        '连接与设置',
      );
      await screenshot('desktop-module');
      await click('打开桌宠');
      await wait(`window.mori.load().then(()=>true)`);
      for (
        let n = 0;
        n < 100 &&
        !require('electron')
          .BrowserWindow.getAllWindows()
          .some((w) => w.webContents.getURL().includes('pet=1'));
        n++
      )
        await delay(50);
      const pet = require('electron')
        .BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes('pet=1'));
      assert.ok(pet, 'Settings opens a native pet');
      await click('收起桌宠');
      await delay(200);
      assert.ok(pet.isDestroyed(), 'Settings closes its pet');
      await click('Demiurge 首页');
      assert.equal(
        await js(`document.querySelector('[aria-label="聊天消息"]').value`),
        '切换模块后继续输入的草稿',
      );
      await fill('聊天消息', '');
      const afterNavigation = await state();
      for (const field of [
        'settings',
        'characters',
        'skins',
        'messages',
        'memories',
        'activeCharacterId',
        'activeSkinId',
      ])
        assert.deepEqual(afterNavigation[field], initial[field], 'Module navigation preserves ' + field);
      await click('连接与设置');
      await wait(`document.querySelectorAll('.settings-group').length===7`);
      assert.equal(await js(`document.querySelectorAll('.settings-group[open]').length`), 0);
      await js(`document.querySelector('.settings-group summary').click()`);
      await fill('对话模型 ID', 'temporary-draft');
      await js(`document.querySelector('.settings-group summary').click()`);
      await js(`document.querySelector('.settings-group summary').click()`);
      assert.equal(await js(`document.querySelector('[aria-label="对话模型 ID"]').value`), 'temporary-draft');
      await fill('对话模型 ID', initial.settings.llmModel);
      await js(`document.querySelector('.settings-group summary').click()`);
      await screenshot('collapsed-settings');
      await click('回到昔涟身边');
      failReplySave = true;
      await fill('聊天消息', '你好');
      await click('发送消息');
      await wait(
        `document.querySelector('.chat-feedback .inline-error')?.textContent.includes('回复已生成')`,
      );
      assert.equal(await js(`!!document.querySelector('.chat-history')`), false);
      await click('仅重试本机保存');
      await wait(`window.mori.load().then(r=>r.state.messages[r.state.activeCharacterId].length===6)`);
      await wait(`document.querySelector('.room-bubble')?.textContent.includes('本地台词')`);
      const replied = await state();
      assert.equal(replied.messages[replied.activeCharacterId].at(-1).origin, 'script');
      assert.equal(await js(`document.querySelectorAll('.chat-message').length`), 0);
      assert.deepEqual(replied.settings, initial.settings);
      await screenshot('reply-bubble');
      await js(
        `window.mori.load().then(r=>{const s=r.state;const messages=s.messages[s.activeCharacterId].map((m,i,list)=>i===list.length-1?{...m,content:'这是一条较长的回复，用来检查气泡的阅读宽度、滚动和人物遮挡。'.repeat(35)}:m);return window.mori.save({...s,messages:{...s.messages,[s.activeCharacterId]:messages}},s)})`,
      );
      await wait(
        `(()=>{const p=document.querySelector('.room-bubble>p');return p&&p.scrollHeight>p.clientHeight})()`,
      );
      win.setSize(1100, 800);
      await delay(200);
      assert.ok(await js(`document.documentElement.scrollWidth<=document.documentElement.clientWidth+1`));
      assert.ok(
        await js(
          `document.querySelector('.room-bubble').getBoundingClientRect().bottom<document.querySelector('.room-composer').getBoundingClientRect().top`,
        ),
      );
      await screenshot('long-reply');
      win.setSize(900, 760);
      await delay(200);
      assert.ok(await js(`document.documentElement.scrollWidth<=document.documentElement.clientWidth+1`));
      assert.ok(
        await js(
          `document.querySelector('.room-composer').getBoundingClientRect().top>=document.querySelector('.room-figure').getBoundingClientRect().bottom`,
        ),
      );
      await screenshot('compact-window');
      assert.equal(apiCalls, 0);
      await finish();
    } catch (error) {
      await finish(error);
    }
  });
});
require('../electron/main.cjs');
