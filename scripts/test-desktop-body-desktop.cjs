'use strict';
// Real Electron pet window and real input events: scroll to resize, carry her (she swings),
// drop her from a height (she falls and lands), drop her above a window (she lands on its top),
// move that window (she rides along) and close it (she falls to the floor). No network.
const { app, BrowserWindow, safeStorage, screen } = require('electron');
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const dir = fs.mkdtempSync(path.resolve(__dirname, '../.local/desktop-body-'));
process.env.MORI_DATA_DIR = dir;
delete process.env.MORI_DEV_URL;
safeStorage.isEncryptionAvailable = () => false;
let networkCalls = 0;
global.fetch = async () => {
  networkCalls++;
  throw Error('No network in the desktop body test');
};
const exceptions = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (fn, label, tries = 200) => {
  for (let i = 0; i < tries; i++) {
    if (await fn()) return;
    await sleep(50);
  }
  throw Error('Timed out: ' + label);
};
let finished = false;
const timer = setTimeout(() => finish(Error('desktop body timeout')), 120000);
function finish(error, extra = {}) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  const result = { passed: !error, networkCalls, exceptions, ...extra, error: error?.stack, artifacts: dir };
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  app.exit(error ? 1 : 0);
}
// Fixture desktop: no icons, and windows supplied by the test (same-process windows are
// excluded by native detection on purpose).
let surfaces = [];
// Only the first window (the workshop) drives the test; the pet and fixture windows do not.
let started = false;
require('../electron/desktop-icons.cjs').desktopIcons = async () => ({ supported: true, icons: [] });
require('../electron/desktop-surfaces.cjs').desktopSurfaces = async () => ({
  supported: true,
  surfaces: surfaces(),
});
surfaces = () => [];
app.on('browser-window-created', (_e, win) => {
  // Keep animation frames running in windows that are not focused.
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', (_ev, level, message) => {
    if (level >= 3) exceptions.push(message.slice(0, 300));
  });
  if (win.getTitle() === 'Mori 桌宠' || started) return;
  started = true;
  win.webContents.once('did-finish-load', async () => {
    if (win.webContents.getURL().includes('pet=1')) return;
    const report = {};
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
      await wait(() => pj('!!document.querySelector(".pet-draggable canvas[data-figure-bounds]")'), 'figure');
      await sleep(600);
      const area = screen.getDisplayMatching(pet.getBounds()).workArea;
      // Feet and body centre inside the pet window, from the playing canvas.
      const body = () =>
        pj(`(() => {
          const c = document.querySelector('.pet-draggable canvas[data-figure-bounds]');
          const f = JSON.parse(c.dataset.figureBounds);
          let x = 0, y = 0;
          for (let n = c; n; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; }
          const sx = c.offsetWidth / c.width, sy = c.offsetHeight / c.height;
          return { footX: x + (f.x + f.width / 2) * sx, footY: y + (f.y + f.height) * sy,
                   cx: x + (f.x + f.width / 2) * sx, cy: y + (f.y + f.height * 0.55) * sy };
        })()`);
      const feet = async () => {
        const b = await body(),
          w = pet.getBounds();
        return { x: w.x + b.footX, y: w.y + b.footY };
      };
      const input = (type, x, y, extra = {}) => {
        const w = pet.getBounds();
        pet.webContents.sendInputEvent({
          type,
          x: Math.round(x),
          y: Math.round(y),
          globalX: Math.round(w.x + x),
          globalY: Math.round(w.y + y),
          ...extra,
        });
      };
      // Grab her by the body, carry her sideways, and let go.
      async function carry(dx, dy, check) {
        const b = await body();
        input('mouseMove', b.cx, b.cy);
        input('mouseDown', b.cx, b.cy, { button: 'left', clickCount: 1 });
        for (let i = 1; i <= 8; i++) {
          await sleep(30);
          // The window follows the pointer, so the pointer stays at the same spot inside it.
          const w = pet.getBounds();
          pet.webContents.sendInputEvent({
            type: 'mouseMove',
            x: Math.round(b.cx),
            y: Math.round(b.cy),
            globalX: Math.round(w.x + b.cx + dx / 8),
            globalY: Math.round(w.y + b.cy + dy / 8),
            button: 'left',
            modifiers: ['leftButtonDown'],
          });
        }
        if (check) await check();
        input('mouseUp', b.cx, b.cy, { button: 'left', clickCount: 1 });
      }

      // 1. Scroll over her to make her bigger; the size is saved.
      const before = pet.getBounds();
      const b0 = await body();
      for (let i = 0; i < 4; i++) {
        input('mouseWheel', b0.cx, b0.cy, { deltaX: 0, deltaY: 120, wheelTicksY: -1, canScroll: true });
        await sleep(40);
      }
      await wait(() => pet.getBounds().height !== before.height, 'resize by scrolling');
      await wait(
        () => js('window.mori.load().then(r=>r.state.settings.petScale)').then((v) => Number.isFinite(v)),
        'scale saved',
      );
      report.resize = {
        before: before.height,
        after: pet.getBounds().height,
        saved: await js('window.mori.load().then(r=>r.state.settings.petScale)'),
      };
      await sleep(1700);
      // Scrolling the other way shrinks her again.
      const grown = pet.getBounds().height;
      const b0b = await body();
      for (let i = 0; i < 4; i++) {
        input('mouseWheel', b0b.cx, b0b.cy, { deltaX: 0, deltaY: -120, wheelTicksY: 1, canScroll: true });
        await sleep(40);
      }
      await wait(() => pet.getBounds().height < grown, 'shrink by scrolling');
      report.resize.shrunk = pet.getBounds().height;
      await sleep(1700);

      // 2. Lift her high and drop her: she swings while carried, falls, and lands on the floor.
      pet.setPosition(pet.getBounds().x - 200, pet.getBounds().y - 320);
      await sleep(200);
      let swung = '';
      await carry(160, 0, async () => {
        await wait(
          () => pj('document.querySelector(".pet-body").classList.contains("lifted")'),
          'lifted',
          40,
        );
        await wait(
          async () => {
            swung = await pj('document.querySelector(".pet-body").style.transform');
            return /rotate/.test(swung);
          },
          'swing',
          40,
        );
      });
      assert.match(swung, /rotate\(-?[0-9.]+deg\)/, 'she swings while carried');
      const floorY = area.y + area.height - (pet.getBounds().height - (await body()).footY);
      const trace = [];
      try {
        await wait(
          async () => {
            const f = await feet();
            trace.push([
              Math.round(f.y),
              pet.getBounds().y,
              await pj('document.querySelector(".pet-name-tag")?.title||""'),
            ]);
            return Math.abs(f.y - floorY) <= 3;
          },
          'fell to the floor',
          120,
        );
      } catch (e) {
        report.trace = {
          floorY,
          area,
          bounds: pet.getBounds(),
          samples: trace.filter((_, i) => i % 10 === 0),
        };
        throw e;
      }
      await wait(
        () => pj('document.querySelector(".pet-landing").classList.contains("landing")'),
        'landing squash',
      );
      report.drop = { floorY, feet: await feet() };

      // 3. Drop her above a window: she lands on its top edge.
      await sleep(800);
      const fixture = new BrowserWindow({
        x: area.x + 120,
        y: area.y + area.height - 330,
        width: 700,
        height: 260,
        show: true,
        title: 'fixture',
      });
      await fixture.loadURL('data:text/html,<p>Desktop body fixture window</p>');
      surfaces = () => (fixture.isDestroyed() ? [] : [{ ...fixture.getBounds(), id: 'fixture' }]);
      const top = fixture.getBounds();
      const b1 = await body();
      pet.setPosition(Math.round(top.x + 300 - b1.footX), Math.round(top.y - 160 - b1.footY));
      await sleep(200);
      await carry(20, 0);
      await wait(async () => Math.abs((await feet()).y - top.y) <= 3, 'landed on the window', 120);
      report.perch = { windowTop: top.y, feet: await feet() };

      // 4. Move the window: she rides along.
      const start = await feet();
      fixture.setPosition(top.x + 120, top.y + 60);
      await wait(
        async () => {
          const f = await feet();
          return Math.abs(f.y - (top.y + 60)) <= 3 && Math.abs(f.x - (start.x + 120)) <= 3;
        },
        'rode the window',
        120,
      );
      report.ride = { from: start, to: await feet() };

      // 5. Close the window: she falls to the floor.
      fixture.destroy();
      const floorAfter = area.y + area.height - (pet.getBounds().height - (await body()).footY);
      await wait(
        async () => Math.abs((await feet()).y - floorAfter) <= 3,
        'fell when the window closed',
        160,
      );
      report.fall = { floorY: floorAfter, feet: await feet() };
      fs.writeFileSync(path.join(dir, 'pet.png'), (await pet.webContents.capturePage()).toPNG());
      assert.equal(networkCalls, 0);
      assert.deepEqual(exceptions, []);
      finish(null, report);
    } catch (e) {
      finish(e, report);
    }
  });
});
require('../electron/main.cjs');
