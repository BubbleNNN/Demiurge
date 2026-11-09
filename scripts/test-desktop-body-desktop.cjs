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
// What the user is doing, as the helper would report it (none unless a step sets it).
let activity = () => undefined;
require('../electron/desktop-surfaces.cjs').desktopSurfaces = async () => ({
  supported: true,
  surfaces: surfaces(),
  ...(activity() ? { activity: activity() } : {}),
});
surfaces = () => [];
let cursor = null;
app.on('browser-window-created', (_e, win) => {
  // Keep animation frames running in windows that are not focused.
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', (_ev, level, message) => {
    if (level >= 3) exceptions.push(message.slice(0, 300));
  });
  if (win.getTitle() === 'Demiurge 桌宠' || started) return;
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
      // The system pointer as the pet window reads it: far away unless a step moves it.
      screen.getCursorScreenPoint = () => cursor || { x: -10000, y: -10000 };
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

      const status = () => pj('document.querySelector(".desktop-pet-shell").dataset.status');

      // 1b. The user types in an editor: she goes to stand beside its window, not over it, and
      // goes back to her own life when the user is away.
      const editor = new BrowserWindow({
        x: area.x + 160,
        y: area.y + 90,
        width: 620,
        height: 420,
        show: true,
        title: 'editor',
      });
      await editor.loadURL('data:text/html,<p>Editor fixture window</p>');
      const eb = editor.getBounds();
      const typing = {
        app: { bundle: 'com.microsoft.VSCode', name: 'Code' },
        self: false,
        keyIdle: 1,
        pointerIdle: 1,
        focus: { id: 'editor', ...eb },
      };
      surfaces = () =>
        editor.isDestroyed() ? [] : [{ ...editor.getBounds(), id: 'editor', app: 'com.microsoft.VSCode' }];
      activity = () => typing;
      await wait(async () => (await status()).includes('陪着你'), 'keeping the user company', 500);
      const beside = await feet();
      const width = await pj(
        `(() => { const c = document.querySelector('.pet-draggable canvas'); return JSON.parse(c.dataset.figureBounds).width * c.offsetWidth / c.width; })()`,
      );
      assert.ok(
        beside.x - width / 2 >= eb.x + eb.width - width * 0.2 || beside.x + width / 2 <= eb.x + width * 0.2,
        'beside the window, hardly over it',
      );
      assert.ok(near(beside.y, eb.y + eb.height), 'feet level with the window bottom');
      fs.writeFileSync(path.join(dir, 'pet-company.png'), (await pet.webContents.capturePage()).toPNG());
      activity = () => ({ ...typing, keyIdle: 900, pointerIdle: 900 });
      await wait(async () => !(await status()).includes('陪着你'), 'back to her own life', 200);
      report.company = { window: eb, feet: beside };
      activity = () => undefined;
      editor.destroy();
      surfaces = () => [];
      await sleep(1600);

      // 1c. Typing in a window with room above it: she runs over and sits or lies on its top
      // edge. Dragged slowly she keeps her spot on it; yanked away she falls to the bottom of the
      // screen and sulks until a pat on the head, then goes back.
      const desk = new BrowserWindow({
        x: area.x + 260,
        y: area.y + 430,
        width: 640,
        height: 300,
        show: true,
        title: 'desk',
      });
      await desk.loadURL('data:text/html,<p>Typing fixture window</p>');
      const deskFocus = () => ({ id: 'desk', ...desk.getBounds() });
      surfaces = () =>
        desk.isDestroyed() ? [] : [{ ...desk.getBounds(), id: 'desk', app: 'com.microsoft.VSCode' }];
      activity = () =>
        desk.isDestroyed()
          ? undefined
          : {
              app: { bundle: 'com.microsoft.VSCode', name: 'Code' },
              self: false,
              keyIdle: 1,
              pointerIdle: 1,
              focus: deskFocus(),
            };
      // Her choices (sit or lie, sulk or not) are fixed for the test.
      await pj('window.__random = Math.random; Math.random = () => 0.1; true');
      await wait(async () => (await status()).includes('在你的窗口上'), 'perched on the window', 500);
      const top0 = desk.getBounds();
      const perched = await feet();
      assert.ok(near(perched.y, top0.y), 'feet on the window top edge');
      assert.ok(perched.x > top0.x && perched.x < top0.x + top0.width);
      fs.writeFileSync(path.join(dir, 'pet-perch.png'), (await pet.webContents.capturePage()).toPNG());
      // Slowly to the right: she keeps her place on it.
      for (let i = 1; i <= 16; i++) {
        desk.setPosition(top0.x + i * 10, top0.y + Math.round(i * 2));
        await sleep(60);
      }
      await wait(
        async () => {
          const f = await feet();
          return near(f.y, top0.y + 32) && near(f.x, perched.x + 160, 4);
        },
        'kept her spot while the window moved slowly',
        200,
      );
      assert.ok((await status()).includes('在你的窗口上'));
      // Yanked away: she falls to the bottom of the screen, cross.
      const slow = desk.getBounds();
      desk.setPosition(slow.x - 420, slow.y);
      const floor = async () => area.y + area.height - (pet.getBounds().height - (await body()).footY);
      await wait(async () => (await status()).includes('等你哄'), 'sulking after the fall', 300);
      const fallen = await feet();
      assert.ok(fallen.y > slow.y + slow.height, 'fell well below the window');
      assert.ok(near(fallen.y, await floor()), 'down at the bottom of the screen');
      assert.equal(await pj('document.querySelector(".mood-mark")?.textContent'), '💢');
      fs.writeFileSync(path.join(dir, 'pet-sulk.png'), (await pet.webContents.capturePage()).toPNG());
      // A pat on the head: forgiven, and back to the window.
      await sleep(2000);
      const head = await pj(
        `(() => { const c = document.querySelector('.pet-draggable canvas'); const f = JSON.parse(c.dataset.figureBounds); let x = 0, y = 0; for (let n = c; n; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; } const sx = c.offsetWidth / c.width, sy = c.offsetHeight / c.height; return { x: x + (f.x + f.width / 2) * sx, y: y + (f.y + f.height * 0.12) * sy }; })()`,
      );
      input('mouseMove', head.x, head.y);
      input('mouseDown', head.x, head.y, { button: 'left', clickCount: 1 });
      input('mouseUp', head.x, head.y, { button: 'left', clickCount: 1 });
      await wait(async () => !(await status()).includes('等你哄'), 'comforted', 100);
      assert.notEqual(await pj('document.querySelector(".mood-mark")?.textContent || ""'), '💢');
      await wait(async () => (await status()).includes('在你的窗口上'), 'back on the window', 500);
      report.perch = { window: top0, feet: perched, fallen };
      await pj('Math.random = window.__random; true');
      activity = () => undefined;
      desk.destroy();
      surfaces = () => [];
      // Back down off the window for the next steps.
      await sleep(1500);

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
      const floorY = area.y + area.height - (pet.getBounds().height - (await body()).footY);
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

      // 6. Close the window: it is gone from under her and she falls to the bottom.
      const riding = await feet();
      fixture.destroy();
      const bottom = area.y + area.height - (pet.getBounds().height - (await body()).footY);
      await wait(async () => near((await feet()).y, bottom), 'fell when the window closed', 200);
      const after = await feet();
      assert.ok(near(after.x, riding.x, 1), 'straight down');
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

      // 9b. A game on the desktop: a small bubble above her, never over her.
      await pj('document.querySelector(\'[aria-label="收起输入框"]\').click()');
      await wait(() => pj('!!document.querySelector(\'[aria-label="一起玩"]\')'), 'toolbar back');
      await pj('document.querySelector(\'[aria-label="一起玩"]\').click()');
      await wait(
        () => pj('!!document.querySelector(".pet-moment-bubble .moment-card.compact")'),
        'game bubble',
      );
      const game = await rect('.pet-moment-bubble');
      assert.ok(game.bottom <= bands.top + 2, 'the game sits above her');
      assert.ok(!(await pj('!!document.querySelector(".pet-moment")')), 'no card over her');
      await pj(
        '[...document.querySelectorAll(".pet-moment-bubble button")].find((b) => b.textContent.includes("左手")).click()',
      );
      await wait(
        () => pj('/猜中|另一只手/.test(document.querySelector(".pet-moment-bubble").textContent)'),
        'her answer',
      );
      fs.writeFileSync(path.join(dir, 'pet-game.png'), (await pet.webContents.capturePage()).toPNG());
      await pj('document.querySelector(\'[aria-label="结束这个小活动"]\').click()');
      await wait(() => pj('!document.querySelector(".pet-moment-bubble")'), 'game closed');

      // 9c. Stroking her head with the pointer, without clicking, is a pat: at an ordinary
      // stroking speed, and passing over the outline of her hair rather than only on it. The
      // pointer is read from the system (the page gets no mouse moves while another app is in
      // front), so the test moves the system pointer, not page events.
      await sleep(3000);
      const crown = await pj(
        `(() => { const c = document.querySelector('.pet-draggable canvas'); const f = JSON.parse(c.dataset.figureBounds); let x = 0, y = 0; for (let n = c; n; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; } const sx = c.offsetWidth / c.width, sy = c.offsetHeight / c.height; return { x: x + (f.x + f.width / 2) * sx, y: y + (f.y - f.height * 0.04) * sy, half: (f.width / 2) * sx }; })()`,
      );
      // Feedback already shown is marked rather than removed: the page owns those elements.
      const seen = () =>
        pj('document.querySelectorAll(".touch-feedback").forEach((e) => (e.dataset.seen = "1")); true');
      const patted = () => pj('!!document.querySelector(".touch-feedback.headpat:not([data-seen])")');
      await seen();
      assert.equal(
        await pj(
          `document.elementFromPoint(${crown.x}, ${crown.y})?.closest('.pet-draggable') ? 'on her' : 'just above her'`,
        ),
        'just above her',
        'the stroke passes just above her hair',
      );
      // Page mouse moves alone (the app in front) are not what counts.
      for (let i = 0; i < 6; i++) {
        input('mouseMove', crown.x + (i % 2 ? 1 : -1) * crown.half * 0.5, crown.y);
        await sleep(170);
      }
      await sleep(300);
      assert.equal(await patted(), false, 'page moves alone are not read as strokes');
      const w = pet.getBounds();
      for (let i = 0; i < 6; i++) {
        cursor = {
          x: Math.round(w.x + crown.x + (i % 2 ? 1 : -1) * crown.half * 0.5),
          y: Math.round(w.y + crown.y),
        };
        await sleep(170);
      }
      cursor = null;
      await wait(patted, 'pat by stroking', 60);
      report.hoverPat = true;
      // The toolbar under her feet has a pat too.
      await sleep(2000);
      await seen();
      await pj(
        `[...document.querySelectorAll('.pet-toolbar button')].find((b) => b.getAttribute('aria-label') === '摸摸头').click()`,
      );
      await wait(patted, 'pat from the toolbar', 60);
      report.toolbarPat = true;

      // 9d. At the bottom of the screen her toolbar still opens below her, on screen.
      await carry(0, 1400);
      await sleep(800);
      assert.ok(
        pet.getBounds().y + pet.getBounds().height <= area.y + area.height,
        'the band below her stays on screen',
      );
      assert.equal(
        await pj('document.querySelector(".desktop-pet-shell").classList.contains("controls-above")'),
        false,
      );
      assert.ok(
        await pj('!!document.querySelector(".pet-band.below .pet-toolbar-zone")'),
        'toolbar below her',
      );
      const zoneBox = await rect('.pet-toolbar-zone');
      assert.ok(zoneBox.bottom <= (await pj('innerHeight')), 'toolbar inside the window');

      // 9e. Another Space: she arrives again (this look cannot walk, so it reappears) and ends up
      // where she was.
      pet.setPosition(area.x + 400, area.y + 220);
      await sleep(400);
      const home = await feet();
      pet.webContents.send('mori:space-changed', { from: 'left' });
      await wait(async () => (await status()).includes('跑过来了'), 'entering', 60);
      await wait(async () => !(await status()).includes('跑过来了'), 'arrived', 200);
      const back = await feet();
      assert.ok(near(back.x, home.x, 3) && near(back.y, home.y, 3), 'back where she was');
      assert.equal(await pj('document.querySelector(".pet-body").classList.contains("vanished")'), false);
      report.space = { home, back };

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
