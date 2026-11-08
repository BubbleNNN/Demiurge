'use strict';
// Real local sample models only; no model generation or paid provider calls.
const { app } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { validateState } = require('../electron/store.cjs');
const dir = path.resolve(__dirname, '../.local/model-motion-smoke-' + randomUUID());
process.env.MORI_DATA_DIR = dir;
delete process.env.MORI_DEV_URL;
let started = false;
let timer;
function finish(error) {
  clearTimeout(timer);
  if (error) console.error(error.stack);
  console.log('Model motion artifacts: ' + dir);
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
      await delay(50);
    }
    throw new Error('Timeout: ' + code);
  };
  const click = (title) =>
    js(
      `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim().endsWith(${JSON.stringify(title)})&&!b.disabled);if(!b)throw new Error('Missing button: '+${JSON.stringify(title)});b.click()})()`,
    );
  const capture = async (name) => {
    const rect = await js(
      `(()=>{const r=document.querySelector('.workbench-stage').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.floor(r.width),height:Math.floor(r.height)}})()`,
    );
    const bytes = (await win.webContents.capturePage(rect)).toPNG();
    if (name) await fs.writeFile(path.join(dir, name + '.png'), bytes);
    return createHash('sha256').update(bytes).digest('hex');
  };
  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(
        `!!document.querySelector('.scene-artwork canvas')&&!document.querySelector('.scene-artwork .model-status')`,
      );
      await click('全部外观');
      await js(`document.querySelector('.workbench').scrollIntoView({block:'center',behavior:'instant'})`);
      for (const kind of ['live2d', 'vrm']) {
        await js(
          `window.mori.load().then(({state})=>window.mori.save({...state,activeSkinId:state.skins.find(s=>s.kind==='${kind}').id,settings:{...state.settings,motionEnabled:true,trackingEnabled:false}}))`,
        );
        await wait(
          `!!document.querySelector('.workbench-stage .avatar-stage.${kind} canvas')&&!document.querySelector('.workbench-stage .model-status')`,
        );
        await delay(450);
        await click('招呼');
        await delay(150);
        const moving = await capture(kind + '-gesture-a');
        await delay(450);
        assert.notEqual(await capture(kind + '-gesture-b'), moving, kind + ' gesture should change pixels');
        await delay(2400);
        await js(
          `[...document.querySelectorAll('label')].find(l=>l.textContent.includes('播放角色动作')).querySelector('input').click()`,
        );
        await wait(`window.mori.load().then(({state})=>state.settings.motionEnabled===false)`);
        await delay(300);
        const paused = await capture(kind + '-paused');
        await delay(350);
        assert.equal(await capture(), paused, kind + ' must remain still when paused');
        if (kind === 'vrm') {
          await js(
            `[...document.querySelectorAll('label')].find(l=>l.textContent.includes('播放角色动作')).querySelector('input').click()`,
          );
          win.webContents.debugger.attach('1.3');
          await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
            features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
          });
          await delay(300);
          const reduced = await capture('vrm-reduced');
          await delay(350);
          assert.equal(await capture(), reduced, 'VRM reduced motion should remain still');
          win.webContents.debugger.detach();
        }
      }
      console.log(
        'PASS actual Live2D and VRM rendering, authored bone/mapped gestures, persisted pause and reduced motion',
      );
      finish();
    } catch (error) {
      finish(error);
    }
  });
});
try {
  // Prepare synchronously so the app's custom protocol registers before ready.
  const sync = require('node:fs');
  sync.mkdirSync(dir, { recursive: true });
  const fixture = path.resolve(__dirname, '../.local/render-validation');
  const source = JSON.parse(sync.readFileSync(path.join(fixture, 'state.json'), 'utf8'));
  const character = source.characters.find((c) => c.id === 'haru-test');
  const skins = source.skins.filter((s) => s.kind === 'live2d' || s.kind === 'vrm');
  assert.equal(skins.length, 2, 'Local model fixtures must be prepared first');
  for (const skin of skins) {
    sync.cpSync(path.join(fixture, 'models', skin.model.id), path.join(dir, 'models', skin.model.id), {
      recursive: true,
    });
    if (skin.kind === 'live2d') skin.model.motionMap = { wave: 'TapBody' };
  }
  sync.writeFileSync(
    path.join(dir, 'state.json'),
    JSON.stringify(
      validateState({
        ...source,
        characters: [character],
        skins,
        activeCharacterId: character.id,
        activeSkinId: skins.find((s) => s.kind === 'live2d').id,
        messages: { [character.id]: [] },
        memories: [],
      }),
    ),
  );
  timer = setTimeout(() => finish(new Error('Model motion test timed out')), 60000);
  require('../electron/main.cjs');
} catch (error) {
  finish(error);
}
