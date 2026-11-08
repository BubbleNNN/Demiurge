const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
function normalizeSurfaces(raw, origin, pid) {
  return raw
    .filter((w) => w.pid !== pid && w.bounds && w.bounds.Width >= 180 && w.bounds.Height >= 120)
    .slice(0, 30)
    .map((w) => ({
      id: String(w.id),
      x: w.bounds.X - origin.x,
      y: w.bounds.Y - origin.y,
      width: w.bounds.Width,
      height: w.bounds.Height,
    }))
    .filter((w) => [w.x, w.y, w.width, w.height].every(Number.isFinite));
}
async function desktopSurfaces(origin) {
  if (process.platform !== 'darwin')
    return { surfaces: [], supported: false, reason: '当前窗口感知仅支持 macOS；可以标记藏身处。' };
  const exe = path.join(__dirname, 'native', 'desktop-bounds').replace('app.asar/', 'app.asar.unpacked/');
  try {
    const { stdout } = await promisify(execFile)(exe, [], { timeout: 4000, maxBuffer: 1024 * 1024 });
    return { surfaces: normalizeSurfaces(JSON.parse(stdout), origin, process.pid), supported: true };
  } catch {
    return { surfaces: [], supported: false, reason: '暂时无法读取窗口位置，可以使用标记的藏身处。' };
  }
}
module.exports = { desktopSurfaces, normalizeSurfaces };
