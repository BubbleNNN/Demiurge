'use strict';
// What the user is doing, from the desktop helper's geometry and timestamps, and where the
// character keeps them company. No window titles or contents are involved.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function load(file) {
  const result = {};
  new Function(
    'exports',
    'require',
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  )(result, require);
  return result;
}
const u = load(path.resolve(__dirname, '../src/userContext.ts'));
const { normalizeScene } = require('../electron/desktop-surfaces.cjs');
const area = { x: 0, y: 30, width: 1512, height: 920 };
const body = { width: 180, height: 260 };
const app = (bundle, name = '') => ({ bundle, name });
const activity = (bundle, extra = {}) => ({
  app: app(bundle),
  keyIdle: 2,
  pointerIdle: 1,
  focus: { id: 'w1', x: 300, y: 100, width: 800, height: 600 },
  ...extra,
});

test('front apps are recognised by bundle identifier or name', () => {
  const kinds = {
    'com.microsoft.VSCode': 'code',
    'com.todesktop.230313mzl4w4u92': 'code',
    'com.apple.Terminal': 'code',
    'com.googlecode.iterm2': 'code',
    'com.openai.codex': 'code',
    'com.apple.dt.Xcode': 'code',
    'com.apple.iWork.Pages': 'write',
    'md.obsidian': 'write',
    'com.figma.Desktop': 'design',
    'com.google.Chrome': 'read',
    'com.apple.Safari': 'read',
    'com.tencent.xinWeChat': 'chat',
    'com.anthropic.claudefordesktop': 'chat',
    'com.bilibili.bilibiliPC': 'video',
    'com.netease.163music': 'music',
    'com.spotify.client': 'music',
    'com.tencent.meeting': 'meeting',
    'us.zoom.xos': 'meeting',
    'com.valvesoftware.steam': 'game',
    'com.example.unknown': 'other',
  };
  for (const [bundle, kind] of Object.entries(kinds)) assert.equal(u.appKind(app(bundle)), kind, bundle);
  assert.equal(u.appKind(app('', 'Visual Studio Code')), 'other', 'names alone need a known word');
  assert.equal(u.appKind(app('', 'Terminal')), 'code');
  assert.equal(u.appKind(null), 'other');
});

test('typing, active, idle and away; a video or a meeting needs no input to count as present', () => {
  const mode = (extra, bundle = 'com.microsoft.VSCode') => u.userContext(activity(bundle, extra)).mode;
  assert.equal(mode({ keyIdle: 1 }), 'typing');
  assert.equal(mode({ keyIdle: 30, pointerIdle: 10 }), 'active');
  assert.equal(mode({ keyIdle: 200, pointerIdle: 120 }), 'idle');
  assert.equal(mode({ keyIdle: 900, pointerIdle: 900 }), 'away');
  assert.equal(mode({ keyIdle: 900, pointerIdle: 900 }, 'com.bilibili.bilibiliPC'), 'active');
  assert.equal(mode({ keyIdle: 4000, pointerIdle: 4000 }, 'com.bilibili.bilibiliPC'), 'away');
  assert.equal(mode({ keyIdle: 1, self: true }), 'active', 'typing to her is not working elsewhere');
  assert.equal(u.userContext(null), null);
});

test('she keeps the user company while they work, does something that goes with it, and stays quiet while they type', () => {
  const coding = u.userContext(activity('com.microsoft.VSCode'));
  assert.deepEqual(
    [coding.kind, coding.company, coding.companion, coding.quiet],
    ['code', true, 'office', true],
  );
  const writing = u.userContext(activity('com.apple.iWork.Pages', { keyIdle: 20 }));
  assert.deepEqual([writing.company, writing.companion, writing.quiet], [true, 'diary', false]);
  assert.equal(u.userContext(activity('com.google.Chrome', { keyIdle: 40 })).companion, 'read');
  assert.equal(u.userContext(activity('com.netease.163music', { keyIdle: 40 })).companion, 'music');
  const meeting = u.userContext(activity('com.tencent.meeting', { keyIdle: 300, pointerIdle: 300 }));
  assert.deepEqual(
    [meeting.mode, meeting.company, meeting.quiet, meeting.companion],
    ['active', true, true, null],
  );
  assert.equal(u.userContext(activity('com.valvesoftware.steam')).company, false, 'games fill the screen');
  assert.equal(u.userContext(activity('com.microsoft.VSCode', { focus: undefined })).company, false);
  const away = u.userContext(activity('com.microsoft.VSCode', { keyIdle: 900, pointerIdle: 900 }));
  assert.deepEqual([away.company, away.companion, away.quiet], [false, null, false]);
  assert.equal(away.idleMinutes, 15);
});

test('her spot is just beside the user window, on the nearer side, feet level with its bottom', () => {
  const focus = { x: 400, y: 100, width: 700, height: 500 };
  const right = u.companySpot(area, body, focus, { x: 1300, y: 900 });
  assert.equal(right.side, 'right');
  assert.equal(right.over, false);
  assert.equal(right.to.y, 600, 'level with the window bottom');
  assert.ok(right.to.x - body.width / 2 < focus.x + focus.width, 'touching its edge');
  assert.ok(right.to.x - body.width / 2 > focus.x + focus.width - body.width * 0.2, 'hardly over it');
  assert.equal(u.coverage(right.to, body, focus) < 0.1, true);
  const left = u.companySpot(area, body, focus, { x: 100, y: 900 });
  assert.equal(left.side, 'left');
  assert.ok(left.to.x + body.width / 2 > focus.x && left.to.x < focus.x);
  // A window reaching the bottom of the screen: she stands on the floor beside it.
  const tall = u.companySpot(area, body, { x: 400, y: 40, width: 700, height: 2000 }, { x: 1300, y: 900 });
  assert.equal(tall.to.y, area.y + area.height - 2);
  // A window high on the screen: her head must stay on screen.
  const high = u.companySpot(area, body, { x: 400, y: 30, width: 700, height: 100 }, { x: 1300, y: 900 });
  assert.ok(high.to.y - body.height >= area.y);
  // A maximized window: the lower corner nearer to her, over its edge.
  const max = u.companySpot(area, body, { x: 0, y: 30, width: 1512, height: 920 }, { x: 1200, y: 900 });
  assert.deepEqual([max.side, max.over], ['right', true]);
  assert.ok(max.to.x + body.width / 2 <= area.x + area.width);
  assert.equal(
    u.companySpot(area, body, { x: 0, y: 30, width: 1512, height: 920 }, { x: 200, y: 900 }).side,
    'left',
  );
});

test('the helper snapshot: visible windows only, not Mori, and the user window is the front app front window', () => {
  const raw = {
    windows: [
      {
        id: 1,
        pid: 99,
        bounds: { X: 0, Y: 30, Width: 900, Height: 700 },
        alpha: 1,
        owner: 'Mori',
        bundle: 'com.mori.companion',
      },
      {
        id: 2,
        pid: 7,
        bounds: { X: 10, Y: 40, Width: 400, Height: 300 },
        alpha: 0,
        owner: 'Shot',
        bundle: 'x.shot',
      },
      {
        id: 3,
        pid: 5,
        bounds: { X: 300, Y: 100, Width: 800, Height: 600 },
        alpha: 1,
        owner: 'Code',
        bundle: 'com.microsoft.VSCode',
      },
      {
        id: 4,
        pid: 5,
        bounds: { X: 320, Y: 120, Width: 600, Height: 500 },
        alpha: 1,
        owner: 'Code',
        bundle: 'com.microsoft.VSCode',
      },
      {
        id: 5,
        pid: 6,
        bounds: { X: 100, Y: 200, Width: 100, Height: 50 },
        alpha: 1,
        owner: 'Tiny',
        bundle: 'x.tiny',
      },
    ],
    front: { pid: 5, bundle: 'com.microsoft.VSCode', name: 'Code' },
    keyIdle: 1.5,
    pointerIdle: 0.4,
  };
  const scene = normalizeScene(raw, { x: 0, y: 0 }, 99);
  assert.deepEqual(
    scene.surfaces.map((w) => w.id),
    ['3', '4'],
  );
  assert.equal(scene.surfaces[0].app, 'com.microsoft.VSCode');
  assert.equal('pid' in scene.surfaces[0], false);
  assert.deepEqual(scene.activity.focus, { id: '3', x: 300, y: 100, width: 800, height: 600 });
  assert.deepEqual(scene.activity.app, { bundle: 'com.microsoft.VSCode', name: 'Code' });
  assert.equal(scene.activity.self, false);
  assert.equal(u.userContext(scene.activity).mode, 'typing');
  // Mori in front: she is with the user; no focus window elsewhere.
  const self = normalizeScene(
    { ...raw, front: { pid: 99, bundle: 'com.mori.companion', name: 'Mori' } },
    { x: 0, y: 0 },
    99,
  );
  assert.deepEqual([self.activity.self, self.activity.app, self.activity.focus], [true, null, undefined]);
  // The plain list older helpers printed still works, without activity.
  const old = normalizeScene(raw.windows, { x: 0, y: 0 }, 99);
  assert.equal(old.surfaces.length, 2);
  assert.equal(old.activity, undefined);
});

test('typing in a window with room above it, she perches on its top edge near the nearer end', () => {
  const window = { x: 300, y: 400, width: 800, height: 400 };
  const spot = u.perchSpot(area, body, window, { x: 1400, y: 900 });
  assert.equal(spot.perch, true);
  assert.equal(spot.to.y, 400);
  assert.equal(spot.side, 'right');
  assert.ok(spot.to.x + body.width / 2 <= window.x + window.width && spot.to.x > window.x + window.width / 2);
  assert.equal(u.perchSpot(area, body, window, { x: 10, y: 900 }).side, 'left');
  // A tall window leaves no room for her head above it, a narrow one no room to sit.
  assert.equal(u.perchSpot(area, body, { x: 300, y: 60, width: 800, height: 800 }, { x: 0, y: 0 }), null);
  assert.equal(u.perchSpot(area, body, { x: 300, y: 400, width: 150, height: 300 }, { x: 0, y: 0 }), null);
});
