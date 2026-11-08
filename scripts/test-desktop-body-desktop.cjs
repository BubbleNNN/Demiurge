'use strict';
// Real Electron pet window and real input events: scroll to resize, carry her (she swings), let
// go in the middle of the screen (she stays there), carry her up to the menu bar (her speech moves
// below her), let go just above a window (she steps onto it), move that window (she rides along)
// and close it (she stays where she is). The toolbar shows only under the pointer; the slider
// resizes her; a message typed under her gets a reply above her head; she reopens where she was
// left. No network.
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
        'window.mori.load().then(r=>window.mori.saveSettings({...r.state.settings,chatMode:"local",proactiveEnabled:false,motionEnabled:true,desktopLifeEnabled:true},{}))',
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
        let last = pet.getBounds();
        for (let i = 1; i <= 8; i++) {
          // The window follows the pointer, so the pointer stays at the same spot inside it. Wait
          // for it to follow the previous step (or to stop at a screen edge), as a hand would.
          for (let n = 0; n < 10; n++) {
            await sleep(20);
            const now = pet.getBounds();
            if (i === 1 || now.x !== last.x || now.y !== last.y) break;
          }
          const w = pet.getBounds();
          last = w;
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

      const bands = require('../shared/pet-window.json');
      const near = (a, b, tolerance = 3) => Math.abs(a - b) <= tolerance;
      const rect = (selector) =>
        pj(
          `(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r && { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; })()`,
        );
      const opacity = (selector) =>
        pj(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).opacity`).then(Number);

      // 2. Lift her and let go in the middle of the screen: she swings while carried and then
      // stays exactly where she was put. There is no gravity.
      pet.setPosition(area.x + 300, area.y + 160);
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
      await sleep(400);
      const placed = await feet();
      await sleep(1800);
      const still = await feet();
      const floorY = area.y + area.height - (pet.getBounds().height - bands.bottom - (await body()).footY);
      assert.ok(near(still.x, placed.x, 1) && near(still.y, placed.y, 1), 'she stays where she was let go');
      assert.ok(floorY - still.y > 200, 'well above the bottom of the screen');
      assert.doesNotMatch(
        await pj('document.querySelector(".pet-speech")?.textContent || ""'),
        /那么高|落地/,
      );
      report.drop = { floorY, feet: still };

      // 3. Carry her up to the top of the screen: her head reaches the menu bar, the band above her
      // hangs past the screen edge, and what she says moves below her.
      await carry(0, -1400);
      await wait(async () => pet.getBounds().y + bands.top === area.y, 'figure up against the top edge', 80);
      await wait(
        () => pj('document.querySelector(".desktop-pet-shell").classList.contains("speech-below")'),
        'speech moves below her',
      );
      // Her reaction to the ride, or (if that has passed) her answer to a touch, shows below her.
      if (!(await pj('!!document.querySelector(".pet-band.below .pet-speech")'))) {
        await sleep(4500);
        const bt = await body();
        input('mouseMove', bt.cx, bt.cy);
        input('mouseDown', bt.cx, bt.cy, { button: 'left', clickCount: 1 });
        input('mouseUp', bt.cx, bt.cy, { button: 'left', clickCount: 1 });
      }
      await wait(
        () => pj('!!document.querySelector(".pet-band.below .pet-speech")'),
        'her speech, below her',
      );
      const below = await rect('.pet-band.below .pet-speech');
      assert.ok(
        below.top >= bands.top + (pet.getBounds().height - bands.top - bands.bottom) - 2,
        'speech under her feet',
      );
      assert.ok(pet.getBounds().y + below.bottom <= area.y + area.height, 'speech on screen');
      report.top = { bounds: pet.getBounds(), speech: below };
      fs.writeFileSync(path.join(dir, 'pet-top.png'), (await pet.webContents.capturePage()).toPNG());

      // 4. Let go just above a window: she steps onto its top edge.
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
      pet.setPosition(Math.round(top.x + 300 - b1.footX), Math.round(top.y - 20 - b1.footY));
      await sleep(200);
      await carry(20, 0);
      await wait(async () => near((await feet()).y, top.y), 'stepped onto the window', 120);
      await wait(
        () => pj('document.querySelector(".pet-landing").classList.contains("landing")'),
        'landing squash',
      );
      report.perch = { windowTop: top.y, feet: await feet() };

      // 5. Move the window: she rides along.
      const start = await feet();
      fixture.setPosition(top.x + 120, top.y + 60);
      await wait(
        async () => {
          const f = await feet();
          return near(f.y, top.y + 60) && near(f.x, start.x + 120);
        },
        'rode the window',
        120,
      );
      report.ride = { from: start, to: await feet() };

      // 6. Close the window: she stays where she is.
      const riding = await feet();
      fixture.destroy();
      await sleep(3000);
      const after = await feet();
      assert.ok(near(after.x, riding.x, 1) && near(after.y, riding.y, 1), 'she stays when the window goes');
      report.closed = { before: riding, after };

      // 7. The toolbar is invisible until the pointer is over it; over her, a faint handle shows
      // where it is. Her speech and the toolbar never overlap.
      pet.setPosition(area.x + 300, area.y + 200);
      await sleep(300);
      const b2 = await body();
      input('mouseMove', b2.cx, b2.cy);
      await sleep(350);
      assert.equal(await opacity('.pet-toolbar'), 0, 'hidden while the pointer is on her');
      assert.ok(await pj('document.querySelector(".desktop-pet-shell").classList.contains("figure-hover")'));
      assert.equal(await opacity('.pet-toolbar-hint'), 1);
      input('mouseDown', b2.cx, b2.cy, { button: 'left', clickCount: 1 });
      input('mouseUp', b2.cx, b2.cy, { button: 'left', clickCount: 1 });
      await wait(() => pj('!!document.querySelector(".pet-speech")'), 'she answers a touch');
      const zone = await rect('.pet-toolbar-zone');
      input('mouseMove', (zone.left + zone.right) / 2, (zone.top + zone.bottom) / 2);
      await sleep(350);
      assert.equal(await opacity('.pet-toolbar'), 1, 'shown under the pointer');
      const bar = await rect('.pet-toolbar'),
        said = await rect('.pet-speech');
      assert.ok(said.bottom <= bar.top || said.top >= bar.bottom, 'speech and toolbar do not overlap');
      assert.ok(said.bottom <= b2.cy, 'her speech is above her');
      fs.writeFileSync(path.join(dir, 'pet-toolbar-open.png'), (await pet.webContents.capturePage()).toPNG());
      input('mouseMove', 2, 2);
      await sleep(350);
      assert.equal(await opacity('.pet-toolbar'), 0, 'hidden again once the pointer leaves');
      fs.writeFileSync(path.join(dir, 'pet-toolbar.png'), (await pet.webContents.capturePage()).toPNG());

      // 8. The size slider resizes her and is saved.
      const sized = pet.getBounds().height;
      await pj(
        `(() => { const el = document.querySelector('[aria-label="桌宠大小"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '1.2'); el.dispatchEvent(new Event('input', { bubbles: true })); })()`,
      );
      await wait(() => pet.getBounds().height !== sized, 'resized by the slider');
      await wait(
        () => js('window.mori.load().then(r=>r.state.settings.petScale===1.2)'),
        'slider size saved',
      );
      assert.equal(pet.getBounds().height, 360 + bands.top + bands.bottom);
      report.slider = { before: sized, after: pet.getBounds().height };

      // 9. Talk to her from the desktop: no other window is opened.
      const windows = BrowserWindow.getAllWindows().length;
      await pj('document.querySelector(\'[aria-label="和角色说话"]\').click()');
      await wait(
        () => pj('document.activeElement?.getAttribute("aria-label") === "聊天消息"'),
        'message box focused',
      );
      await pj(
        `(() => { const el = document.querySelector('[aria-label="聊天消息"]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, '你好'); el.dispatchEvent(new Event('input', { bubbles: true })); })()`,
      );
      await wait(() => pj('document.querySelector(\'[aria-label="聊天消息"]\').value === "你好"'), 'typed');
      await pj(
        `document.querySelector('[aria-label="聊天消息"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`,
      );
      await wait(
        () => js('window.mori.load().then(r=>(r.state.messages[r.state.activeCharacterId]||[]).length>=2)'),
        'reply saved',
      );
      const saved = await js('window.mori.load().then(r=>r.state.messages[r.state.activeCharacterId])');
      const reply = saved.at(-1).content;
      assert.equal(saved.at(-2).content, '你好');
      await wait(
        () => pj(`document.querySelector('.pet-speech p')?.textContent === ${JSON.stringify(reply)}`),
        'reply above her',
      );
      assert.equal(
        await pj('document.querySelector(\'[aria-label="聊天消息"]\').value'),
        '',
        'the box is cleared',
      );
      assert.equal(BrowserWindow.getAllWindows().length, windows, 'no window opened');
      const box = await rect('.pet-composer');
      assert.ok(
        box.top >= bands.top + (pet.getBounds().height - bands.top - bands.bottom) - 2,
        'message box under her',
      );
      fs.writeFileSync(path.join(dir, 'pet-chat.png'), (await pet.webContents.capturePage()).toPNG());
      report.chat = { reply };

      // 10. She reopens where she was left.
      const left = pet.getBounds();
      await sleep(1000);
      await js('window.mori.closePet()');
      await wait(() => pet.isDestroyed(), 'closed');
      await js('window.mori.openPet()');
      await wait(() => {
        pet = BrowserWindow.getAllWindows().find(
          (w) => !w.isDestroyed() && w.webContents.getURL().includes('pet=1'),
        );
        return !!pet;
      }, 'reopened');
      assert.deepEqual(pet.getBounds(), left);
      report.reopened = pet.getBounds();
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
