'use strict';
const { app, BrowserWindow, safeStorage } = require('electron');
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const dir = fs.mkdtempSync(path.resolve(__dirname, '../.local/anime-migration-'));
process.env.MORI_DATA_DIR = dir;
delete process.env.MORI_DEV_URL;
safeStorage.isEncryptionAvailable = () => false;
let networkCalls = 0;
global.fetch = async () => {
  networkCalls++;
  throw Error('No model requests in migration smoke');
};
const wait = async (fn, label) => {
  for (let i = 0; i < 300; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error('Timed out: ' + label);
};
let finished = false;
const timer = setTimeout(() => finish(Error('migration timeout')), 70000);
function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  const result = { passed: !error, networkCalls, error: error?.stack, artifacts: dir };
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  app.exit(error ? 1 : 0);
}
app.on('browser-window-created', (_e, win) => {
  if (win.getTitle() === 'Mori 桌宠') return;
  win.webContents.once('did-finish-load', async () => {
    if (win.webContents.getURL().includes('pet=1')) return;
    try {
      const js = (s) => win.webContents.executeJavaScript(s, true);
      await wait(() => js('!!document.querySelector(".room-rail")'), 'home');
      await js(
        'window.mori.load().then(r=>window.mori.saveSettings({...r.state.settings,proactiveEnabled:false,motionEnabled:true,desktopLifeEnabled:true},{}))',
      );
      await js('window.mori.openPet()');
      let pet;
      await wait(() => {
        pet = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('pet=1'));
        return !!pet;
      }, 'pet');
      const pj = (s) => pet.webContents.executeJavaScript(s, true);
      await wait(() => pj('!!document.querySelector(".pet-toolbar")'), 'toolbar');
      const actual = await pj('window.mori.desktopScene(true)');
      assert.ok(actual.bounds.width > 0);
      assert.ok(Array.isArray(actual.icons));
      require('../electron/desktop-surfaces.cjs').desktopSurfaces = async () => ({
        supported: true,
        surfaces: [],
      });
      require('../electron/desktop-icons.cjs').desktopIcons = async () => ({ supported: true, icons: [] });
      await pj('document.querySelector("[aria-label=探索桌面]").click()');
      await wait(
        () => pj('document.querySelector(".pet-speech")?.textContent.includes("没有找到")'),
        'failure feedback',
      );
      // Actual native fixture window: placement geometry is read by the native helper.
      const fixture = new BrowserWindow({
        x: actual.area.x + 50,
        y: actual.area.y + 520,
        width: 650,
        height: 180,
        show: true,
      });
      await fixture.loadURL('data:text/html,<p>Migration window fixture</p>');
      delete require.cache[require.resolve('../electron/desktop-surfaces.cjs')];
      // Same-process fixture is intentionally excluded by native detection; supply its exact geometry for deterministic behavior.
      const rect = fixture.getBounds();
      require('../electron/desktop-surfaces.cjs').desktopSurfaces = async () => ({
        supported: true,
        surfaces: [{ ...rect, id: 'fixture' }],
      });
      await pj('document.querySelector("[aria-label=探索桌面]").click()');
      await wait(
        () => pj('document.querySelector(".pet-name-tag")?.title.includes("在窗口边缘")'),
        'arrival',
      );
      await pj('document.querySelector("[aria-label=结束桌面活动]").click()');
      await pj('document.querySelector("[aria-label=一起玩]").click()');
      await wait(() => pj('!!document.querySelector(".pet-moment .moment-card")'), 'game');
      fs.writeFileSync(path.join(dir, 'pet-interaction.png'), (await pet.webContents.capturePage()).toPNG());
      assert.equal(networkCalls, 0);
      fixture.destroy();
      finish();
    } catch (e) {
      finish(e);
    }
  });
});
require('../electron/main.cjs');
