'use strict';
// Rasterize the existing Mori SVG at macOS icon sizes, using the installed Electron runtime.
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mori-package-icon-'));
app.setPath('userData', temporary);
app.commandLine.appendSwitch('disable-http-cache');
const timeout = setTimeout(() => app.exit(1), 20000);
app
  .whenReady()
  .then(async () => {
    const [source, target] = process.argv.slice(2);
    const win = new BrowserWindow({
      width: 1024,
      height: 1024,
      show: false,
      transparent: true,
      useContentSize: true,
      webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false },
    });
    const svg = fs.readFileSync(source, 'utf8').replace('<svg ', '<svg width="1024" height="1024" ');
    await win.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`)}`,
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    const capture = await win.webContents.capturePage();
    const image = nativeImage.createFromBuffer(capture.toPNG());
    if (image.isEmpty()) throw new Error('Failed to render Mori icon.');
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) {
        const png = image.resize({ width: size * scale, height: size * scale, quality: 'best' }).toPNG();
        fs.writeFileSync(path.join(target, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`), png);
      }
    }
    win.destroy();
    clearTimeout(timeout);
    fs.rmSync(temporary, { recursive: true, force: true });
    app.exit(0);
  })
  .catch((error) => {
    console.error(error.stack);
    app.exit(1);
  });
