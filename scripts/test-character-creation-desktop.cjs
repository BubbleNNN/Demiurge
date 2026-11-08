'use strict';
// Real Electron creation/collection/import paths, an isolated workspace and
// anonymous public-page fixtures. No model or paid service is ever contacted.
const { app, dialog, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const dir = path.resolve(__dirname, '../.local/character-creation-smoke-' + randomUUID());
fs.mkdirSync(dir, { recursive: true });
process.env.MORI_DATA_DIR = dir;
delete process.env.MORI_DEV_URL;
safeStorage.isEncryptionAvailable = () => false;
// Artwork is only a plumbing fixture; it is never presented as new character art.
const png = fs.readFileSync(path.resolve(__dirname, '../public/art/cyrene-reference-v3.png'));
const frames = path.join(dir, 'frame-fixture');
for (const action of ['idle', 'wave']) {
  fs.mkdirSync(path.join(frames, action), { recursive: true });
  fs.writeFileSync(path.join(frames, action, '01.png'), png);
}
dialog.showOpenDialog = async (_window, options) => {
  assert.match(options.title, /PNG 动作文件夹/);
  return { canceled: false, filePaths: [frames] };
};
const page = 'https://source.mori.example/new-character';
const image = 'https://source.mori.example/portrait.png';
let requests = 0;
global.fetch = async (url, init) => {
  requests++;
  assert.equal(init.headers.Authorization, undefined);
  assert.equal(init.credentials, 'omit');
  assert.ok(!init.method || init.method === 'GET');
  if (String(url) === page)
    return new Response(
      '<html><head><title>新角色测试人物</title></head><body><article><h1>新角色测试人物</h1><img src="' +
        image +
        '" alt="全身立绘" width="1024" height="1536"></article></body></html>',
      { headers: { 'Content-Type': 'text/html' } },
    );
  assert.equal(String(url), image, 'Only public source/PNG fixtures may be requested');
  return new Response(png, { headers: { 'Content-Type': 'image/png' } });
};
const dns = require('node:dns/promises');
const lookup = dns.lookup;
dns.lookup = (host, ...args) =>
  host === 'source.mori.example' ? Promise.resolve([{ address: '93.184.215.14' }]) : lookup(host, ...args);
let win;
const deadline = setTimeout(() => finish(new Error('New character check timed out')), 90000);
async function finish(error) {
  clearTimeout(deadline);
  if (error) {
    console.error(error.stack);
    if (win && !win.isDestroyed())
      console.error((await win.webContents.executeJavaScript('document.body.innerText')).slice(-3500));
  } else
    console.log(
      'Native new-character creation passed: no-key name-only profile, same-name/work matching, no duplicate pack activation, anonymous reference bytes, identity-independent setup, explicit original portrait activation, action-folder import, local dialogue, unchanged old data/settings and reload.',
    );
  console.log('Artifacts: ' + dir);
  app.exit(error ? 1 : 0);
}
app.on('browser-window-created', (_event, window) => {
  // Animation state is read from the page; a window behind other apps must keep its frames.
  window.webContents.setBackgroundThrottling(false);
  if (win) return;
  win = window;
  const js = (code) =>
    win.webContents.executeJavaScript(code, true).catch((error) => {
      throw new Error(code.slice(0, 300) + ': ' + error.message);
    });
  const wait = async (code) => {
    for (let n = 0; n < 200; n++) {
      if (await js(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    throw new Error('UI did not reach: ' + code);
  };
  const click = (label) =>
    js(
      `(()=>{const root=document.querySelector('.modal')||document;const b=[...root.querySelectorAll('button')].find(b=>(b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)})&&!b.disabled);if(!b)throw new Error('Missing '+${JSON.stringify(label)});b.click()})()`,
    );
  const fill = (label, value) =>
    js(
      `(()=>{const el=document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']');if(!el)throw new Error('Missing field');Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}))})()`,
    );
  const state = () => js('window.mori.load().then(r=>r.state)');
  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(`!!document.querySelector('.room-rail')`);
      const initial = await state();
      assert.equal(await js('window.mori.load().then(r=>r.keys.llmKey)'), false);
      await click('添加角色');
      await wait(`document.querySelector('[aria-label="角色建档方式"]')?.value==='manual'`);
      await fill('新角色名字', '昔涟');
      await wait(`!!document.querySelector('[aria-label="新角色素材匹配"] button')`);
      await fill('新角色作品', '另一部作品');
      await wait(`!document.querySelector('[aria-label="新角色素材匹配"] button')`);
      await fill('新角色作品', '崩坏星穹铁道');
      await wait(`!!document.querySelector('[aria-label="新角色素材匹配"] button')`);
      await js(`document.querySelector('[aria-label="新角色素材匹配"] button').click()`);
      await wait(`!document.querySelector('.modal')`);
      assert.equal((await state()).characters.length, initial.characters.length);
      assert.equal(requests, 0);

      await click('添加角色');
      await fill('新角色名字', '只填名字的新人物');
      await js(`document.querySelector('[aria-label="建档后自动收集参考图"]').click()`);
      await click('创建角色');
      await wait(`!!document.querySelector('[aria-label="新角色外观设置"]')`);
      let loaded = await state();
      const simpleId = loaded.activeCharacterId;
      const simple = loaded.characters.find((c) => c.id === simpleId);
      assert.equal(simple.name, '只填名字的新人物');
      assert.equal(simple.appearance + simple.summary + simple.speakingStyle, '');
      assert.deepEqual(simple.quotes, []);
      assert.equal(loaded.skins.filter((s) => s.characterId === simpleId).length, 0);
      assert.equal(requests, 0);
      await click('稍后补充素材，保留角色档案');
      await click('Demiurge 首页');
      await click('角色工作室');
      await click('外观与动作');
      await click('使用预制角色包');
      await wait(`!!document.querySelector('.pack-current')`);
      assert.equal(
        await js(`document.querySelectorAll('.pack-outfits button').length`),
        0,
        'A new person must not show Cyrene as its own artwork',
      );
      await click('关闭弹窗');

      await click('添加角色');
      await fill('新角色名字', '新角色测试人物');
      await fill('新角色作品', '测试作品');
      await fill('新角色资料链接', page);
      // Collection is remembered from the previous form; explicitly enable it.
      await js(
        `(()=>{const el=document.querySelector('[aria-label="建档后自动收集参考图"]');if(!el.checked)el.click()})()`,
      );
      await click('创建角色');
      await wait(`document.querySelectorAll('.modal .reference-choice').length===1`);
      loaded = await state();
      const charId = loaded.activeCharacterId;
      const current = loaded.characters.find((c) => c.id === charId);
      assert.equal(current.sources[0].snippet, '');
      assert.equal(current.referenceCandidates[0].origin, 'page');
      assert.deepEqual(Buffer.from(current.referenceCandidates[0].image.split(',')[1], 'base64'), png);
      assert.equal(requests, 2);
      await js(`document.querySelector('.modal .reference-choice input').click()`);
      await click('保存 1 张为角色参考');
      await wait(`!!document.querySelector('.modal .reference-card details')`);
      await click('直接使用主参考作为立绘');
      await wait(`document.body.textContent.includes('已有启用外观')`);
      loaded = await state();
      const portrait = loaded.skins.find((s) => s.id === loaded.activeSkinId);
      assert.equal(portrait.characterId, charId);
      assert.equal(portrait.generated, false);
      assert.deepEqual(Buffer.from(portrait.images.neutral.split(',')[1], 'base64'), png);
      assert.equal(requests, 2);
      await click('为新角色导入外观与动作');
      await wait(`!!document.querySelector('.art-workflow')`);
      await click('PNG 动作文件夹');
      await wait(`!!document.querySelector('.candidate-animation canvas[data-clip]')`);
      await click('预览招手动作');
      await wait(`document.querySelector('.candidate-animation canvas').dataset.clip==='wave'`);
      await click('保存并使用此外观');
      await wait(`!document.querySelector('.modal')`);
      loaded = await state();
      const animation = loaded.skins.find((s) => s.id === loaded.activeSkinId);
      assert.equal(animation.characterId, charId);
      assert.ok(animation.sprite.clips.wave);
      assert.deepEqual(loaded.settings, initial.settings);
      assert.deepEqual(
        loaded.characters.filter((c) => initial.characters.some((old) => old.id === c.id)),
        initial.characters,
      );
      assert.deepEqual(loaded.memories, initial.memories);
      await click('Demiurge 首页');
      await fill('聊天消息', '你好');
      await click('发送消息');
      await wait(
        `window.mori.load().then(r=>r.state.messages[${JSON.stringify(charId)}]?.some(m=>m.origin==='script'))`,
      );
      assert.equal(requests, 2, 'Local dialogue must not request any model');
      await new Promise((resolve) => {
        win.webContents.once('did-finish-load', resolve);
        win.webContents.reload();
      });
      await wait(`!!document.querySelector('.room-rail')`);
      loaded = await state();
      assert.equal(loaded.activeCharacterId, charId);
      assert.equal(loaded.activeSkinId, animation.id);
      assert.equal(loaded.characters.length, initial.characters.length + 2);
      assert.equal(requests, 2);
      await fs.promises.writeFile(
        path.join(dir, 'new-character.png'),
        (await win.webContents.capturePage()).toPNG(),
      );
      await finish();
    } catch (error) {
      await finish(error);
    }
  });
});
require('../electron/main.cjs');
