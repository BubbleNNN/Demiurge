'use strict';
// Isolated native UI acceptance: no user workspace or external model requests.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const dir = path.resolve(__dirname, '../.local/refinement-' + require('node:crypto').randomUUID());
const output = path.resolve(__dirname, '../artifacts/refinement-2026-10-07');
fs.mkdirSync(dir, { recursive: true });
fs.mkdirSync(output, { recursive: true });
process.env.MORI_DATA_DIR = dir;
process.env.MORI_DEV_VIEW = 'home';
delete process.env.MORI_DEV_URL;
let win,
  requests = 0;
global.fetch = async () => {
  requests++;
  throw new Error('Refinement fixture stays offline');
};
const clickThrough = [];
const setIgnore = BrowserWindow.prototype.setIgnoreMouseEvents;
BrowserWindow.prototype.setIgnoreMouseEvents = function (enabled, options) {
  clickThrough.push(enabled);
  return setIgnore.call(this, enabled, options);
};
const deadline = setTimeout(() => finish(new Error('Refinement acceptance timed out')), 110000);
async function finish(error) {
  clearTimeout(deadline);
  if (error) {
    console.error(error.stack);
    if (win && !win.isDestroyed()) {
      fs.writeFileSync(path.join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG());
      console.error((await win.webContents.executeJavaScript('document.body.innerText')).slice(-2400));
    }
  }
  console.log('Fixture directory: ' + dir);
  app.exit(error ? 1 : 0);
}
app.on('browser-window-created', (_, created) => {
  // Animation state is read from the page; a window behind other apps must keep its frames.
  created.webContents.setBackgroundThrottling(false);
  if (win) return;
  win = created;
  const js = (code) =>
    win.webContents.executeJavaScript(code, true).catch((error) => {
      throw new Error(code.slice(0, 300) + ': ' + error.message);
    });
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const wait = async (code, run = js) => {
    for (let n = 0; n < 180; n++) {
      if (await run(code)) return;
      await delay(50);
    }
    throw new Error('UI did not reach: ' + code);
  };
  const click = (label) =>
    js(
      `(()=>{const root=document.querySelector('.modal')||document;const b=[...root.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')===${JSON.stringify(label)}||b.textContent.trim()===${JSON.stringify(label)})&&!b.disabled);if(!b)throw Error('Missing button '+${JSON.stringify(label)});b.click()})()`,
    );
  const fill = (label, value) =>
    js(
      `(()=>{const el=document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']');Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}))})()`,
    );
  const state = () => js('window.mori.load().then(r=>r.state)');
  const capture = async (name) => {
    await delay(180);
    fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG());
  };
  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(`!!document.querySelector('.room-rail')`);
      const baseline = await state();
      // Draft survives cancellation AND a renderer reload.
      await click('添加角色');
      await fill('新角色名字', '待完善人物');
      await fill('新角色作品', '测试世界');
      await fill('新角色补充设定', '喜欢安静地读书。');
      await wait(`JSON.parse(localStorage.getItem('mori:character-draft:v1')).notes==='喜欢安静地读书。'`);
      await click('关闭弹窗');
      await new Promise((resolve) => {
        win.webContents.once('did-finish-load', resolve);
        win.reload();
      });
      await wait(`!!document.querySelector('.room-rail')`);
      await click('添加角色');
      assert.equal(await js(`document.querySelector('[aria-label="新角色名字"]').value`), '待完善人物');
      assert.equal(
        await js(`document.querySelector('[aria-label="新角色补充设定"]').value`),
        '喜欢安静地读书。',
      );
      await js(`document.querySelector('[aria-label="建档后自动收集参考图"]').click()`);
      // Two synchronous submits must produce one saved identity.
      await js(
        `(()=>{const f=document.querySelector('.modal form');f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))})()`,
      );
      await wait(`!!document.querySelector('[aria-label="新角色外观设置"]')`);
      const createdState = await state(),
        createdId = createdState.activeCharacterId;
      assert.equal(createdState.characters.length, baseline.characters.length + 1);
      assert.equal(createdState.activeSkinId, '');
      assert.match(await js(`window.mori.openPet().then(()=>'',error=>error.message)`), /已核对的外观/);
      assert.equal(BrowserWindow.getAllWindows().length, 1);
      await click('稍后补充素材，保留角色档案');
      await click('Mori 首页');
      await wait(`!!document.querySelector('.character-readiness')`);
      await capture('new-character-setup');
      // Reopening with the same name/work resumes that profile without overwriting notes.
      await click('添加角色');
      await fill('新角色名字', '待完善人物');
      await fill('新角色作品', '测试世界');
      await fill('新角色补充设定', '不应覆盖已保存的角色设定');
      await click('创建角色');
      await wait(`!!document.querySelector('[aria-label="新角色外观设置"]')`);
      const resumed = await state();
      assert.equal(resumed.characters.length, baseline.characters.length + 1);
      assert.equal(resumed.activeCharacterId, createdId);
      assert.equal(resumed.characters.find((c) => c.id === createdId).summary, '喜欢安静地读书。');
      assert.equal(requests, 0);
      await click('稍后补充素材，保留角色档案');
      // A remembered skin survives switching away and back through real UI.
      await js(
        `window.mori.load().then(({state:s})=>window.mori.save({...s,preferredSkins:{[${JSON.stringify(baseline.activeCharacterId)}]:'cyrene-powerpuff-v1'}},s))`,
      );
      await js(
        `[...document.querySelectorAll('.rail-avatar')].find(b=>b.getAttribute('aria-label').includes('昔涟')).click()`,
      );
      await wait(`window.mori.load().then(({state})=>state.activeSkinId==='cyrene-powerpuff-v1')`);
      await click('Mori 首页');
      await wait(`!!document.querySelector('.scene-artwork canvas[data-figure-bounds]')`);
      // Real bitmap hit tests: transparent point must do nothing; head/body route separately.
      const points =
        await js(`(()=>{const c=document.querySelector('.scene-artwork canvas'),r=c.getBoundingClientRect(),b=JSON.parse(c.dataset.figureBounds),p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
        const at=ratio=>{const y=Math.floor(b.y+b.height*ratio);for(let x=Math.floor(c.width*.35);x<c.width*.65;x++)if(p[(y*c.width+x)*4+3]>200)return{x:Math.round(r.x+x*r.width/c.width),y:Math.round(r.y+y*r.height/c.height)};throw Error('No opaque target')};return{head:at(.28),body:at(.76),blank:{x:Math.round(r.x+2),y:Math.round(r.y+2)}}})()`);
      const input = (target, point) => {
        target.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
        target.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
      };
      input(win, points.blank);
      await delay(120);
      assert.equal(await js(`!!document.querySelector('.touch-feedback')`), false);
      input(win, points.head);
      await wait(`!!document.querySelector('.touch-feedback.headpat')`);
      await capture('home-head-interaction');
      await delay(1850);
      input(win, points.body);
      await wait(`!!document.querySelector('.touch-feedback.poke')`);
      await wait(`document.querySelector('.scene-artwork canvas').dataset.clip==='nod'`);
      assert.deepEqual((await state()).messages, resumed.messages);
      await click('连接与设置');
      await wait(`!!document.querySelector('.desktop-workspace')`);
      await capture('desktop-size-preview');
      for (const width of [900, 1400]) {
        win.setSize(width, 900);
        await delay(250);
        assert.equal(
          await js('document.documentElement.scrollWidth>innerWidth'),
          false,
          'No horizontal overflow at ' + width,
        );
        await capture('desktop-' + width);
      }
      await click('打开桌宠');
      for (let n = 0; n < 100 && BrowserWindow.getAllWindows().length < 2; n++) await delay(60);
      const pet = BrowserWindow.getAllWindows().find((w) => w !== win);
      assert.ok(pet);
      const petJs = (code) => pet.webContents.executeJavaScript(code, true);
      await wait(`!!document.querySelector('.pet-draggable canvas[data-figure-bounds]')`, petJs);
      // Resize an already open native window, with fixed bottom and no stretching.
      const sizes = {};
      for (const size of ['small', 'medium', 'large']) {
        await js(
          `document.querySelector('.pet-size-options button:nth-child('+${['small', 'medium', 'large'].indexOf(size) + 1}+')').click()`,
        );
        await wait(`window.mori.load().then(({state})=>state.settings.petSize==='${size}')`);
        await delay(250);
        sizes[size] = pet.getBounds();
        const box = await petJs(
          `(()=>{const c=document.querySelector('.pet-draggable canvas'),r=c.getBoundingClientRect();return{w:r.width,h:r.height,b:JSON.parse(c.dataset.figureBounds)}})()`,
        );
        assert.ok(box.w > 0 && box.h > 0);
        assert.ok(box.b.x >= 0 && box.b.y >= 0);
        fs.writeFileSync(
          path.join(output, 'pet-' + size + '.png'),
          (await pet.webContents.capturePage()).toPNG(),
        );
      }
      assert.ok(sizes.small.height < sizes.medium.height && sizes.medium.height < sizes.large.height);
      assert.equal(sizes.small.y + sizes.small.height, sizes.large.y + sizes.large.height);
      // Click-through hits use actual alpha, not the rectangular element.
      await petJs(`window.dispatchEvent(new MouseEvent('mousemove',{clientX:2,clientY:2,bubbles:true}))`);
      await delay(80);
      assert.equal(clickThrough.at(-1), true);
      const opaque = await petJs(
        `(()=>{const c=document.querySelector('canvas'),r=c.getBoundingClientRect(),b=JSON.parse(c.dataset.figureBounds),p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;const y=Math.floor(b.y+b.height*.3);for(let x=Math.floor(c.width*.3);x<c.width*.7;x++)if(p[(y*c.width+x)*4+3]>200)return{x:r.x+x*r.width/c.width,y:r.y+y*r.height/c.height}})()`,
      );
      assert.ok(opaque);
      await petJs(
        `window.dispatchEvent(new MouseEvent('mousemove',{clientX:${opaque.x},clientY:${opaque.y},bubbles:true}))`,
      );
      await delay(80);
      assert.equal(clickThrough.at(-1), false);
      input(pet, { x: Math.round(opaque.x), y: Math.round(opaque.y) });
      await wait(`!!document.querySelector('.touch-feedback.headpat')`, petJs);
      await petJs(
        `(async()=>{document.querySelector('[aria-label="和角色说话"]').click();for(let n=0;n<100&&!document.querySelector('[aria-label="打开桌宠聊天"]');n++)await new Promise(r=>setTimeout(r,20));document.querySelector('[aria-label="打开桌宠聊天"]').click()})()`,
      );
      await wait(`!!document.querySelector('.pet-chat-panel')`, petJs);
      await petJs(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
      await wait(`!document.querySelector('.pet-chat-panel')`, petJs);
      // Closing the conversation returns to the message box under her; closing that brings the toolbar back.
      await wait(`!!document.querySelector('[aria-label="收起输入框"]')`, petJs);
      await petJs(`document.querySelector('[aria-label="收起输入框"]').click()`);
      await wait(`!!document.querySelector('[aria-label="让角色休息"]')`, petJs);
      await petJs(`document.querySelector('[aria-label="让角色休息"]').click()`);
      await wait(`document.querySelector('.pet-draggable canvas').dataset.clip==='sleep'`, petJs);
      await petJs(`document.querySelector('[aria-label="唤醒角色"]').click()`);
      await wait(`document.querySelector('.pet-draggable canvas').dataset.clip==='wave'`, petJs);
      assert.equal(requests, 0);
      const result = {
        passed: true,
        draftReload: true,
        doubleSubmitGuard: true,
        resumableProfile: true,
        rememberedAppearance: true,
        alphaHitTargets: true,
        threeNativeSizes: sizes,
        clickThrough: true,
        keyboardEscape: true,
        restWake: true,
        responsiveWidths: [900, 1400],
        apiRequests: requests,
      };
      fs.writeFileSync(path.join(output, 'acceptance.json'), JSON.stringify(result, null, 2) + '\n');
      console.log(JSON.stringify(result));
      await finish();
    } catch (error) {
      await finish(error);
    }
  });
});
require('../electron/main.cjs');
