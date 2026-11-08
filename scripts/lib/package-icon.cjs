'use strict';
// Rasterize the app icon SVG at macOS icon sizes, using the installed Electron runtime.
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'demiurge-package-icon-'));
app.setPath('userData', temporary);
app.commandLine.appendSwitch('disable-http-cache');
const timeout = setTimeout(() => app.exit(1), 20000);
app
  .whenReady()
  .then(async () => {
    const [source, target] = process.argv.slice(2);
    // A picture of the user's own (PNG) sits on a rounded light tile; the bundled icon is an SVG.
    const picture = /\.png$/i.test(source)
      ? `data:image/png;base64,${fs.readFileSync(source).toString('base64')}`
      : '';
    const win = new BrowserWindow({
      width: 1024,
      height: 1024,
      show: false,
      transparent: true,
      useContentSize: true,
      webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false },
    });
    const art = picture
      ? `<div style="position:absolute;left:100px;top:100px;width:824px;height:824px;border-radius:186px;overflow:hidden;background:#ffffff;box-shadow:inset 0 0 0 3px rgba(140,118,214,0.3)"><img src="${picture}" style="position:absolute;inset:34px;width:756px;height:756px;object-fit:contain;mix-blend-mode:multiply"></div>`
      : fs.readFileSync(source, 'utf8').replace('<svg ', '<svg width="1024" height="1024" ');
    await win.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(`<html><body style="margin:0;background:transparent;position:relative;width:1024px;height:1024px">${art}</body></html>`)}`,
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    const capture = await win.webContents.capturePage();
    const image = nativeImage.createFromBuffer(capture.toPNG());
    if (image.isEmpty()) throw new Error('Failed to render the app icon.');
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
