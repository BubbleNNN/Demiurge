'use strict';
const { app, BrowserWindow, safeStorage } = require('electron');
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'),
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demiurge-onboarding-'));
const out = path.join(root, '.local/release-onboarding');
fs.mkdirSync(out, { recursive: true });
process.env.MORI_QUIET = '1';
process.env.MORI_DATA_DIR = dir;
delete process.env.MORI_DEV_URL;
safeStorage.isEncryptionAvailable = () => false;
global.fetch = async () => {
  throw Error('No external requests in release test');
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let started = false;
setTimeout(() => {
  console.error('Timed out');
  app.exit(1);
}, 45000);
app.on('browser-window-created', (_e, win) => {
  if (started) return;
  started = true;
  win.webContents.setBackgroundThrottling(false);
  win.webContents.once('did-finish-load', async () => {
    try {
      const js = (s) => win.webContents.executeJavaScript(s, true);
      for (let i = 0; i < 100; i++) {
        if (await js('!!document.querySelector(".welcome-guide")')) break;
        await sleep(100);
      }
      const saved = await js('window.mori.load().then(r=>r.state)');
      assert.equal(saved.skins.length, 1);
      assert.equal(saved.skins[0].builtin, 'cyrene-chibi-v6');
      const entry = require('../shared/cyrene-motion-pack.json').entries[0];
      const dimensions = await js(
        `Promise.all(${JSON.stringify([entry.file, ...entry.pageFiles])}.map(file=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve([img.naturalWidth,img.naturalHeight]);img.onerror=()=>reject(Error(file));img.src='./art/'+file})))`,
      );
      assert.equal(dimensions.length, 5);
      assert.ok(dimensions.every(([w, h]) => w > 1000 && h > 1000));
      for (const [w, h] of [
        [1440, 900],
        [1000, 700],
      ]) {
        win.setContentSize(w, h);
        await sleep(250);
        const layout = await js(
          `(()=>{const p=document.querySelector('.welcome-guide'),r=p.getBoundingClientRect();return {width:innerWidth,height:innerHeight,left:r.left,top:r.top,right:r.right,bottom:r.bottom,scroll:document.documentElement.scrollWidth,buttons:[...p.querySelectorAll('button')].every(b=>{const r=b.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===b})}})()`,
        );
        assert.ok(layout.buttons, JSON.stringify(layout));
        assert.ok(layout.left >= 0 && layout.right <= layout.width && layout.bottom <= layout.height);
        assert.ok(layout.scroll <= layout.width);
        fs.writeFileSync(path.join(out, `welcome-${w}.png`), (await win.webContents.capturePage()).toPNG());
      }
      await js(`document.querySelector('[aria-label="收起初次使用指南"]').click()`);
      await sleep(300);
      assert.equal(await js('window.mori.load().then(r=>r.state.settings.welcomeDismissed)'), true);
      await new Promise((resolve) => {
        win.webContents.once('did-finish-load', resolve);
        win.reload();
      });
      await sleep(500);
      assert.equal(await js('!!document.querySelector(".welcome-guide")'), false);
      for (const w of BrowserWindow.getAllWindows()) {
        assert.equal(w.getOpacity(), 0);
        assert.equal(w.isFocused(), false);
      }
      fs.writeFileSync(
        path.join(out, 'checks.json'),
        JSON.stringify(
          {
            passed: true,
            quiet: true,
            oneBundledPet: true,
            pages: dimensions,
            guideButtonsReachable: [1440, 1000],
            dismissalPersisted: true,
          },
          null,
          2,
        ),
      );
      console.log(
        'PASS: one starter, all five atlas pages, reachable first-use guide, persistent dismissal, invisible windows.',
      );
      app.exit(0);
    } catch (e) {
      console.error(e);
      app.exit(1);
    }
  });
});
require('../electron/main.cjs');
