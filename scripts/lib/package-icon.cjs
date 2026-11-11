'use strict';
// Rasterize the app icon SVG at macOS icon sizes, using the installed Electron runtime.
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'demiurge-package-icon-'));
app.setPath('userData', temporary);
app.dock?.hide();
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
    // A picture is placed by where its weight is, not by its frame: the point the drawn content
    // (anything darker than the white ground) balances on goes to the centre of the tile, and it
    // is scaled so that nothing reaches closer than MARGIN to the tile's edge. A picture whose
    // subject sits low in its frame (a heavy base, things floating above) is lifted to the middle.
    const place = `<script>
      const MARGIN = 40, HALF = 412, img = document.querySelector('img');
      img.onload = () => {
        const W = 240, H = Math.round((W * img.naturalHeight) / img.naturalWidth);
        const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
        const g = canvas.getContext('2d');
        g.drawImage(img, 0, 0, W, H);
        const d = g.getImageData(0, 0, W, H).data;
        let sx = 0, sy = 0, sw = 0, minX = W, minY = H, maxX = 0, maxY = 0;
        for (let y = 0; y < H; y++)
          for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4, a = d[i + 3] / 255, lum = (d[i] + d[i + 1] + d[i + 2]) / 3;
            const w = a * Math.max(0, 238 - lum) / 238;
            if (w < 0.05) continue;
            sx += x * w; sy += y * w; sw += w;
            minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          }
        const cx = sw ? sx / sw : W / 2, cy = sw ? sy / sw : H / 2;
        const reach = Math.max(cx - minX, maxX + 1 - cx, cy - minY, maxY + 1 - cy, 1);
        const k = (HALF - MARGIN) / reach;
        img.style.cssText = 'position:absolute;mix-blend-mode:multiply;left:' + (HALF - cx * k) + 'px;top:' + (HALF - cy * k) + 'px;width:' + W * k + 'px;height:' + H * k + 'px';
        document.body.dataset.ready = '1';
      };
      if (img.complete) img.onload();
    </script>`;
    const art = picture
      ? `<div style="position:absolute;left:100px;top:100px;width:824px;height:824px;border-radius:186px;overflow:hidden;background:#ffffff;box-shadow:inset 0 0 0 3px rgba(140,118,214,0.3)"><img src="${picture}"></div>${place}`
      : fs.readFileSync(source, 'utf8').replace('<svg ', '<svg width="1024" height="1024" ');
    await win.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(`<html><body style="margin:0;background:transparent;position:relative;width:1024px;height:1024px">${art}</body></html>`)}`,
    );
    for (let i = 0; picture && i < 100; i++) {
      if (await win.webContents.executeJavaScript('document.body.dataset.ready === "1"')) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
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
