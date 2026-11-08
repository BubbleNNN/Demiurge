'use strict';
// What the desktop pet knows about the desktop: where visible app windows are, which app is in
// front and its window, and how long ago the user last typed or moved the pointer. Geometry, app
// identity and timestamps only: no window titles, contents or keystrokes.
//
// While the pet is open a long-running helper streams a snapshot every 250 ms, so she can follow a
// window being dragged and notice the user typing without starting a process for every look.
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');

const helper = () =>
  path.join(__dirname, 'native', 'desktop-bounds').replace('app.asar/', 'app.asar.unpacked/');

// Accepts the helper's snapshot, or the plain window list older helpers printed.
function normalizeScene(raw, origin, pid) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.windows) ? raw.windows : [];
  const own = (w) => w.pid === pid;
  const surfaces = list
    .filter(
      (w) =>
        !own(w) &&
        w.bounds &&
        w.bounds.Width >= 180 &&
        w.bounds.Height >= 120 &&
        // Fully transparent overlays (screenshot tools, invisible panels) are not places.
        !(Number.isFinite(w.alpha) && w.alpha < 0.2),
    )
    .slice(0, 30)
    .map((w) => ({
      id: String(w.id),
      x: w.bounds.X - origin.x,
      y: w.bounds.Y - origin.y,
      width: w.bounds.Width,
      height: w.bounds.Height,
      ...(w.pid ? { pid: w.pid } : {}),
      ...(typeof w.bundle === 'string' || typeof w.owner === 'string'
        ? { app: String(w.bundle || w.owner).slice(0, 120) }
        : {}),
    }))
    .filter((w) => [w.x, w.y, w.width, w.height].every(Number.isFinite));
  let activity;
  if (raw && !Array.isArray(raw)) {
    const front = raw.front && raw.front.pid !== pid ? raw.front : null;
    // The window the user is working in: the frontmost window of the frontmost app.
    const focus = front ? surfaces.find((w) => w.pid === front.pid) : undefined;
    const seconds = (value) => (Number.isFinite(value) && value >= 0 ? Math.min(value, 86400) : 86400);
    activity = {
      app: front
        ? { bundle: String(front.bundle || '').slice(0, 120), name: String(front.name || '').slice(0, 80) }
        : null,
      // Mori itself in front: the user is with her, not in another app.
      self: Boolean(raw.front && raw.front.pid === pid),
      keyIdle: seconds(raw.keyIdle),
      pointerIdle: seconds(raw.pointerIdle),
      ...(focus
        ? { focus: { id: focus.id, x: focus.x, y: focus.y, width: focus.width, height: focus.height } }
        : {}),
    };
  }
  return { surfaces: surfaces.map(({ pid: _pid, ...rest }) => rest), activity };
}
// Kept for callers and tests of the plain window list.
const normalizeSurfaces = (raw, origin, pid) => normalizeScene(raw, origin, pid).surfaces;

let watcher = null;
let latest = null;
function startWatching() {
  if (process.platform !== 'darwin' || watcher) return;
  let buffer = '';
  const child = spawn(helper(), ['--watch', '250'], { stdio: ['pipe', 'pipe', 'ignore'] });
  watcher = child;
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    if (buffer.length > 1024 * 1024) buffer = '';
    const lines = buffer.split('\n');
    buffer = lines.pop();
    const line = lines.at(-1);
    if (!line) return;
    try {
      latest = { at: Date.now(), raw: JSON.parse(line) };
    } catch {
      /* A partial line; the next one replaces it. */
    }
  });
  child.on('error', () => {});
  child.on('exit', () => {
    if (watcher === child) {
      watcher = null;
      latest = null;
    }
  });
}
function stopWatching() {
  const child = watcher;
  watcher = null;
  latest = null;
  try {
    child?.stdin.end();
    child?.kill();
  } catch {
    /* Already gone. */
  }
}

async function desktopSurfaces(origin) {
  if (process.platform !== 'darwin')
    return { surfaces: [], supported: false, reason: '当前窗口感知仅支持 macOS；可以标记藏身处。' };
  try {
    let raw = latest && Date.now() - latest.at < 1000 ? latest.raw : null;
    // When this picture of the desktop was taken: window speeds are measured between pictures.
    let at = raw ? latest.at : Date.now();
    if (!raw) {
      const { stdout } = await promisify(execFile)(helper(), [], { timeout: 4000, maxBuffer: 1024 * 1024 });
      raw = JSON.parse(stdout);
    }
    return { ...normalizeScene(raw, origin, process.pid), at, supported: true };
  } catch {
    return { surfaces: [], supported: false, reason: '暂时无法读取窗口位置，可以使用标记的藏身处。' };
  }
}
module.exports = { desktopSurfaces, normalizeSurfaces, normalizeScene, startWatching, stopWatching };
