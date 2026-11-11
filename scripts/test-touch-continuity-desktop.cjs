'use strict';
// Always invisible, mouse-transparent, unfocusable and isolated. Never use real providers.
process.env.MORI_QUIET = '1';
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const dir = path.resolve(__dirname, '../.local/touch-continuity-' + require('node:crypto').randomUUID());
fs.mkdirSync(dir, { recursive: true });
process.env.MORI_DATA_DIR = dir;
delete process.env.MORI_DEV_URL;
let requests = 0,
  win;
global.fetch = async () => {
  requests++;
  throw Error('No provider requests permitted');
};
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const deadline = setTimeout(() => finish(Error('Native touch continuity timeout')), 60000);
function finish(error) {
  clearTimeout(deadline);
  if (error) console.error(error.stack);
  console.log('Evidence: ' + dir);
  app.exit(error ? 1 : 0);
}
app.on('browser-window-created', (_, created) => {
  if (win) return;
  win = created;
  win.webContents.once('did-finish-load', async () => {
    const js = (code) => win.webContents.executeJavaScript(code, true);
    const wait = async (code) => {
      for (let i = 0; i < 150; i++) {
        if (await js(code)) return;
        await delay(50);
      }
      throw Error('Not ready: ' + code);
    };
    const event = async (type, x, y) =>
      js(
        `(()=>{const el=document.querySelector('.room-figure');el.dispatchEvent(new PointerEvent(${JSON.stringify(type)},{bubbles:true,button:0,pointerId:1,pointerType:'mouse',clientX:${x},clientY:${y}}));})()`,
      );
    const point = async (y) =>
      js(
        `(()=>{const c=document.querySelector('.room-figure canvas:not(.canvas-pending)'),r=c.getBoundingClientRect(),b=JSON.parse(c.dataset.figureBounds);return {x:r.x+(b.x+b.width*.5)*r.width/c.width,y:r.y+(b.y+b.height*${y})*r.height/c.height,width:b.width*r.width/c.width}})()`,
      );
    try {
      await wait(`!!document.querySelector('.room-figure canvas[data-figure-bounds]')`);
      await js(
        `window.mori.load().then(({state:s})=>window.mori.saveSettings({...s.settings,proactiveEnabled:false,desktopLifeEnabled:false,motionEnabled:true},{}))`,
      );
      const before = await js('window.mori.load().then(r=>r.state)');
      const body = await point(0.62),
        head = await point(0.16);
      await event('pointerup', body.x, body.y);
      await wait(`!!document.querySelector('.touch-feedback.poke')`);
      assert.notEqual(await js(`document.querySelector('.room-figure canvas').dataset.clip`), 'surprised');
      await delay(1300);
      assert.notEqual(await js(`document.querySelector('.room-figure canvas').dataset.clip`), 'surprised');
      for (const dx of [0, 18, -18, 18]) {
        await event('pointermove', head.x + dx, head.y);
        await delay(140);
      }
      await wait(`!!document.querySelector('.touch-feedback.headpat')`);
      await delay(2700);
      await event('pointerdown', body.x, body.y);
      await delay(750);
      await wait(`!!document.querySelector('.touch-feedback.headpat')`);
      await event('pointerup', body.x, body.y);
      assert.equal(
        await js(`!!document.querySelector('.touch-feedback.poke')`),
        false,
        'Hold release must not also poke',
      );
      await delay(1500);
      // Hover is a glance rather than another poke; the native feed samples stationary pointers too.
      await event('pointerleave', 0, 0);
      await event('pointermove', body.x, body.y);
      await delay(2300);
      await event('pointermove', body.x, body.y);
      assert.equal(await js(`!!document.querySelector('.touch-feedback.poke')`), false);
      await js('window.mori.openPet()');
      const pet = BrowserWindow.getAllWindows().find((w) => w !== win);
      const pj = (code) => pet.webContents.executeJavaScript(code, true);
      for (let i = 0; i < 120; i++) {
        if (
          !pet.webContents.isLoading() &&
          (await pj(`!!document.querySelector('.pet-draggable canvas[data-figure-bounds]')`))
        )
          break;
        await delay(50);
      }
      const p = await pj(
        `(()=>{const c=document.querySelector('.pet-draggable canvas'),r=c.getBoundingClientRect(),b=JSON.parse(c.dataset.figureBounds);return{x:r.x+(b.x+b.width*.5)*r.width/c.width,y:r.y+(b.y+b.height*.65)*r.height/c.height}})()`,
      );
      await pj(
        `document.querySelector('.pet-draggable').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,pointerType:'mouse',button:0,clientX:${p.x},clientY:${p.y},screenX:${p.x},screenY:${p.y}}))`,
      );
      await delay(750);
      assert.ok(await pj(`!!document.querySelector('.touch-feedback.headpat')`), 'Native stationary hold');
      await pj(
        `document.querySelector('.pet-draggable').dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,button:0}))`,
      );
      assert.equal(await pj(`!!document.querySelector('.touch-feedback.poke')`), false);
      await delay(2700);
      const bounds = pet.getBounds();
      const headPoint = await pj(
        `(()=>{const c=document.querySelector('.pet-draggable canvas'),r=c.getBoundingClientRect(),b=JSON.parse(c.dataset.figureBounds);return{x:r.x+(b.x+b.width*.5)*r.width/c.width,y:r.y+(b.y+b.height*.16)*r.height/c.height}})()`,
      );
      const screen = require('electron').screen;
      for (const dx of [0, 18, -18, 18]) {
        screen.getCursorScreenPoint = () => ({ x: bounds.x + headPoint.x + dx, y: bounds.y + headPoint.y });
        await delay(160);
      }
      assert.ok(
        await pj(`!!document.querySelector('.touch-feedback.headpat')`),
        'Native global pointer stroke',
      );
      screen.getCursorScreenPoint = () => ({ x: -10000, y: -10000 });
      for (const w of BrowserWindow.getAllWindows()) {
        assert.equal(w.getOpacity(), 0);
        assert.equal(w.isFocused(), false);
      }
      const after = await js('window.mori.load().then(r=>r.state)');
      assert.deepEqual(after.messages, before.messages);
      assert.deepEqual(after.memories, before.memories);
      assert.deepEqual(after.skins, before.skins);
      assert.equal(requests, 0);
      const report = {
        passed: true,
        quiet: true,
        allWindowsInvisible: true,
        noFocus: true,
        providerCalls: requests,
        roomStroke: true,
        roomHold: true,
        nativeHold: true,
        nativeStroke: true,
        holdReleaseNoPoke: true,
        noSurprisedFallback: true,
        chatAndArtworkPreserved: true,
      };
      fs.writeFileSync(path.join(dir, 'acceptance.json'), JSON.stringify(report, null, 2));
      fs.writeFileSync(path.join(dir, 'room.png'), (await win.webContents.capturePage()).toPNG());
      console.log(JSON.stringify(report));
      finish();
    } catch (e) {
      finish(e);
    }
  });
});
require('../electron/main.cjs');
