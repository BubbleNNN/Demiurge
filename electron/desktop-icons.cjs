const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
// Fixed read-only Finder query: no names, paths, file contents, or user-generated script.
const SCRIPT = `tell application "Finder"
set iconSize to icon size of icon view options of window of desktop
set output to (iconSize as text) & linefeed
repeat with p in (get desktop position of every item of desktop)
set output to output & (item 1 of p as text) & "," & (item 2 of p as text) & linefeed
end repeat
return output
end tell`;
function normalizeIcons(text, origin) {
  const [sizeLine, ...rows] = text.trim().split(/\r?\n/);
  const size = Number(sizeLine);
  if (!Number.isFinite(size) || size < 16 || size > 256) return [];
  return rows.flatMap((row) => {
    const parts = row.split(',').map(Number);
    if (parts.length !== 2 || !parts.every(Number.isFinite)) return [];
    const [x, y] = parts;
    if (x < 0 || y < 0) return [];
    return [
      {
        id: `icon:${x}:${y}`,
        x: x - origin.x - size / 2,
        y: y - origin.y - size / 2,
        width: size,
        height: size,
      },
    ];
  });
}
async function desktopIcons(origin) {
  if (process.platform !== 'darwin')
    return { icons: [], supported: false, reason: '自动识别桌面图标目前支持 macOS。' };
  try {
    const hidden = await run('/usr/bin/defaults', ['read', 'com.apple.finder', 'CreateDesktop'], {
      timeout: 2000,
    }).catch(() => ({ stdout: '1' }));
    if (hidden.stdout.trim() === '0')
      return { icons: [], supported: true, reason: 'Finder 当前隐藏了桌面图标。' };
    const { stdout } = await run('/usr/bin/osascript', ['-e', SCRIPT], {
      timeout: 15000,
      maxBuffer: 128 * 1024,
    });
    return { icons: normalizeIcons(stdout, origin), supported: true };
  } catch (error) {
    const denied = String(error.stderr || error.message).includes('-1743');
    return {
      icons: [],
      supported: false,
      reason: denied
        ? '请在系统设置 → 隐私与安全性 → 自动化中，允许 Demiurge 访问 Finder，才能自动获取桌面图标位置。'
        : '暂时无法获取 Finder 图标位置；如果系统正在询问，请允许访问 Finder 后重试。',
    };
  }
}
module.exports = { desktopIcons, normalizeIcons };
