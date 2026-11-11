'use strict';
// Native Electron IPC/UI, original bundled artwork and persistence; any API call fails.
const { app, BrowserWindow, dialog, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const dir = path.resolve(__dirname, '../.local/companion-smoke-' + randomUUID());
fs.mkdirSync(dir, { recursive: true });
process.env.MORI_DATA_DIR = dir;
delete process.env.MORI_DEV_URL;
safeStorage.isEncryptionAvailable = () => false;
let networkCalls = 0;
global.fetch = async () => {
  networkCalls++;
  throw new Error('Local companion must not call an API');
};
const packFile = path.join(dir, 'portable-character.json');
dialog.showSaveDialog = async () => ({ canceled: false, filePath: packFile });
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [packFile] });
const stamp = new Date().toISOString();
const previous = {
  id: 'existing',
  name: '原有角色',
  work: '测试',
  summary: 'Preserve this',
  speakingStyle: '',
  personality: [],
  appearance: '',
  quotes: [],
  sources: [],
  unknowns: [],
  behavior: { energy: 20, affection: 30, curiosity: 40 },
  createdAt: stamp,
};
fs.writeFileSync(
  path.join(dir, 'state.json'),
  JSON.stringify({
    settings: {
      llmBaseUrl: 'https://never-call.example/v1',
      llmModel: 'saved-model',
      imageBaseUrl: '',
      imageModel: '',
      demoMode: false,
      proactiveEnabled: true,
      motionEnabled: true,
      voiceEnabled: true,
    },
    characters: [previous],
    skins: [],
    activeCharacterId: previous.id,
    activeSkinId: '',
    messages: { existing: [] },
    memories: [],
  }),
);
let win;
const deadline = setTimeout(() => finish(new Error('Native companion timed out')), 90000);
async function finish(error) {
  clearTimeout(deadline);
  if (error) {
    console.error(error.stack);
    if (win && !win.isDestroyed())
      console.error((await win.webContents.executeJavaScript('document.body.innerText')).slice(-2500));
  } else
    console.log(
      'Native companion passed: unchanged old character/settings, asset-first catalog, authored clips, local labeled chat with no keys/API/TTS, rest/wake, editable lines, portable PNG/animation export/import, reload and pet playback.',
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
      throw new Error(code.slice(0, 300) + ': ' + error.message);
    });
  const wait = async (code) => {
    for (let n = 0; n < 200; n++) {
      if (await js(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 70));
    }
    const seen = await js(
      `JSON.stringify({clip:document.querySelector('.scene-artwork canvas')?.dataset.clip,presence:document.querySelector('.room-presence')?.textContent,feature:document.querySelector('main')?.dataset.feature})`,
    );
    throw new Error('UI did not reach: ' + code + ' — saw ' + seen);
  };
  const click = (label) =>
    js(
      `(()=>{const button=[...document.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')===${JSON.stringify(label)}||b.textContent.trim()===${JSON.stringify(label)})&&!b.disabled);if(!button)throw new Error('Missing '+${JSON.stringify(label)});button.click()})()`,
    );
  const setText = (label, value) =>
    js(
      `(()=>{const node=document.querySelector('textarea[aria-label='+${JSON.stringify(JSON.stringify(label))}+']');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(node,${JSON.stringify(value)});node.dispatchEvent(new Event('input',{bubbles:true}))})()`,
    );
  const state = () => js('window.mori.load().then(r=>r.state)');
  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(`!!document.querySelector('.room-rail')`);
      await click('Demiurge 首页');
      await click('角色工作室');
      await click('外观与动作');
      await click('打开桌宠工作台');
      await click('导入与工具');
      await click('角色包与互动');
      await click('精选角色包');
      await wait(`document.querySelectorAll('.pack-outfits button').length===7`);
      assert.equal((await state()).activeCharacterId, previous.id);
      await wait(`!!document.querySelector('.pack-preview canvas[data-clip]')`);
      assert.ok(
        await js(
          `(()=>{const modal=document.querySelector('.modal');return modal.scrollWidth<=modal.clientWidth+2&&[...document.querySelectorAll('.pack-outfits button')].every(b=>b.getBoundingClientRect().width<300)})()`,
        ),
        'Pack cards must fit within the dialog without image overflow',
      );
      assert.equal(await js(`document.querySelector('[aria-label="预览点头动作"]').disabled`), false);
      await click('预览招手动作');
      await wait(`document.querySelector('.pack-preview canvas').dataset.clip==='wave'`);
      await fs.promises.writeFile(
        path.join(dir, 'character-pack.png'),
        (await win.webContents.capturePage()).toPNG(),
      );
      await click('使用昔涟角色包');
      await wait(
        `!document.querySelector('.modal')&&document.querySelector('.scene-artwork canvas[data-clip]')`,
      );
      let loaded = await state();
      assert.equal(loaded.activeSkinId, 'cyrene-8bit-v5');
      assert.deepEqual(
        loaded.characters.find((c) => c.id === previous.id),
        previous,
      );
      assert.equal(loaded.settings.llmModel, 'saved-model');
      await js(`document.querySelector('.chat-preferences summary').click()`);
      await click('本地台词');
      await click('查看对话记录');
      await wait(
        `document.querySelector('.chat-mode-picker button[aria-pressed="true"]').textContent==='本地台词'`,
      );
      await setText('聊天消息', '你好');
      await click('发送消息');
      await wait(
        `document.querySelectorAll('.chat-message.assistant').length===1&&!document.querySelector('.chat-waiting')`,
      );
      loaded = await state();
      assert.equal(loaded.messages['mori-cyrene'].at(-1).origin, 'script');
      assert.equal(loaded.messages['mori-cyrene'].at(-1).action, 'wave');
      assert.ok(await js(`document.querySelector('.reply-tools').textContent.includes('本地台词')`));
      await wait(`document.querySelector('.head-zone')&&!document.querySelector('.head-zone').disabled`);
      await setText('聊天消息', '请计算一颗星星的质量');
      await click('发送消息');
      await wait(
        `document.querySelectorAll('.chat-message.assistant').length===2&&!document.querySelector('.chat-waiting')`,
      );
      assert.equal((await state()).messages['mori-cyrene'].at(-1).interaction, 'unknown');
      assert.equal(networkCalls, 0);
      await click('展开人物设置');
      await wait(`!document.querySelector('[aria-label="让角色休息"]').disabled`);
      await click('让角色休息');
      await wait(`document.querySelector('.scene-artwork canvas').dataset.clip==='sleep'`);
      assert.ok(await js(`document.querySelector('.head-zone').disabled`));
      await click('唤醒角色');
      await wait(`document.querySelector('.scene-artwork canvas').dataset.clip==='wave'`);
      await click('Demiurge 首页');
      await click('角色工作室');
      await click('外观与动作');
      await click('打开桌宠工作台');
      await click('导入与工具');
      await click('角色包与互动');
      await click('昔涟的互动台词');
      await setText('互动台词：轻轻点一下', '我们先慢慢做眼前的小事。');
      await click('保存互动台词');
      await wait(`document.querySelector('.success-note')?.textContent==='互动台词已保存。'`);
      await setText('互动台词：轻轻点一下', '一起慢慢做眼前的小事吧。');
      await click('保存互动台词');
      await wait(
        `window.mori.load().then(r=>r.state.characters.find(c=>c.id==='mori-cyrene').companion.replies.touch[0]==='一起慢慢做眼前的小事吧。')`,
      );
      await click('精选角色包');
      await click('导出当前角色包');
      await wait(`document.querySelector('.success-note')?.textContent.includes('离线导入')`);
      const exported = JSON.parse(fs.readFileSync(packFile, 'utf8'));
      assert.ok(exported.skins.every((s) => s.images.neutral.startsWith('data:image/png;base64,')));
      assert.ok(exported.skins.find((s) => s.style === '8bit').sprite.clips.wave);
      assert.ok(!JSON.stringify(exported).includes('saved-model'));
      await click('导入角色包');
      await wait(`window.mori.load().then(r=>r.state.characters.length===3)`);
      await click('关闭弹窗');
      loaded = await state();
      const importedId = loaded.activeCharacterId;
      assert.notEqual(importedId, 'mori-cyrene');
      assert.equal(
        loaded.characters.find((c) => c.id === importedId).companion.replies.touch[0],
        '一起慢慢做眼前的小事吧。',
      );
      await click('Demiurge 首页');
      await js(
        `(async()=>{document.querySelector('.room-wardrobe-more[aria-expanded="false"]')?.click();await new Promise(r=>setTimeout(r,60));const b=[...document.querySelectorAll('.room-wardrobe button')].find(b=>(b.getAttribute('aria-label')||'').includes('记忆存档'));b.click()})()`,
      );
      await wait(`!!document.querySelector('.scene-artwork canvas[data-clip]')`);
      win.webContents.reload();
      await wait(
        `!!document.querySelector('.room-rail')&&!!document.querySelector('.scene-artwork canvas[data-clip]')`,
      );
      assert.equal((await state()).settings.chatMode, 'local');
      await fs.promises.writeFile(
        path.join(dir, 'local-companion.png'),
        (await win.webContents.capturePage()).toPNG(),
      );
      await click('放到桌面');
      const pet = BrowserWindow.getAllWindows().find((window) => window !== win);
      for (let n = 0; n < 120; n++) {
        if (pet && (await pet.webContents.executeJavaScript(`!!document.querySelector('canvas[data-clip]')`)))
          break;
        await new Promise((resolve) => setTimeout(resolve, 70));
      }
      assert.ok(await pet.webContents.executeJavaScript(`!!document.querySelector('canvas[data-clip]')`));
      assert.equal(networkCalls, 0);
      await finish();
    } catch (error) {
      await finish(error);
    }
  });
});
require('../electron/main.cjs');
