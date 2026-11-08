'use strict';
// Builds a Windows x64 package of Demiurge from this Mac: Electron's Windows runtime (downloaded
// once by Electron's own downloader, checked against its published checksums) with the same app
// payload as the macOS build, zipped as release/Demiurge-<version>-windows-x64.zip.
// Untested on Windows itself. The desktop helper (windows, Spaces, typing) is macOS only, so on
// Windows the pet lives on the desktop without window awareness; everything else is the same.
const fs = require('node:fs');
const path = require('node:path');
const { writePayload, auditPayload, hashFile, run } = require('./package-desktop.cjs');

const root = path.resolve(__dirname, '..');

async function packageWindows({ skipBuild = false } = {}) {
  if (process.platform !== 'darwin') throw new Error('This script packages for Windows from macOS.');
  const info = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(info.version)) throw new Error('Invalid package version.');
  if (!fs.existsSync(path.join(root, 'public/vendor/live2dcubismcore.min.js')))
    throw new Error('Live2D Core is missing. Run pnpm setup:live2d before building a complete package.');
  if (!skipBuild) {
    run(process.execPath, [require.resolve('typescript/bin/tsc'), '-b']);
    run(process.execPath, [
      path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js'),
      'build',
    ]);
  }
  const electronVersion = require('electron/package.json').version;
  const { downloadArtifact } = require(
    require.resolve('@electron/get', { paths: [path.dirname(require.resolve('electron/package.json'))] }),
  );
  const archive = await downloadArtifact({
    version: electronVersion,
    platform: 'win32',
    arch: 'x64',
    artifactName: 'electron',
  });
  const release = path.join(root, 'release');
  fs.mkdirSync(release, { recursive: true });
  const stem = `Demiurge-${info.version}-windows-x64`;
  const temporary = fs.mkdtempSync(path.join(release, '.package-win-'));
  const folder = path.join(temporary, stem);
  try {
    run('/usr/bin/ditto', ['-x', '-k', archive, folder], { stdio: 'pipe' });
    fs.rmSync(path.join(folder, 'resources/default_app.asar'), { force: true });
    const payload = path.join(folder, 'resources/app');
    const runtime = writePayload(payload, info, 'win32');
    // The window and taskbar icon (Windows reads it at runtime): your own picture when there is one.
    const icons = path.join(temporary, 'icons');
    fs.mkdirSync(icons);
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const customIcon = path.join(root, 'private/app-icon.png');
    run(
      require('electron'),
      [
        path.join(root, 'scripts/lib/package-icon.cjs'),
        fs.existsSync(customIcon) ? customIcon : path.join(root, 'public/favicon.svg'),
        icons,
      ],
      { env },
    );
    fs.copyFileSync(path.join(icons, 'icon_256x256@2x.png'), path.join(payload, 'dist/app-icon.png'));
    fs.rmSync(icons, { recursive: true });
    fs.renameSync(path.join(folder, 'electron.exe'), path.join(folder, 'Demiurge.exe'));
    for (const file of ['LICENSE', 'LICENSES.chromium.html']) {
      const original = path.join(folder, file);
      if (fs.existsSync(original))
        fs.renameSync(original, path.join(payload, 'licenses', `Electron-${file}`));
    }
    fs.writeFileSync(
      path.join(folder, 'README.txt'),
      [
        `Demiurge ${info.version} for Windows (x64), unsigned local build.`,
        'Run Demiurge.exe. Windows SmartScreen may warn about an unknown publisher the first time.',
        'On Windows the desktop pet does not yet see other windows (that helper is macOS only).',
        '',
      ].join('\r\n'),
    );
    const manifest = {
      product: 'Demiurge',
      version: info.version,
      platform: 'win32',
      arch: 'x64',
      electron: electronVersion,
      signed: false,
      tested: false,
      runtimeDependencies: runtime.map(({ name, version }) => ({ name, version })),
      payload: auditPayload(payload),
    };
    fs.writeFileSync(path.join(folder, 'package-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    const zip = path.join(release, `${stem}.zip`);
    fs.rmSync(zip, { force: true });
    run('/usr/bin/ditto', ['-c', '-k', '--keepParent', '--noextattr', '--norsrc', folder, zip], {
      stdio: 'pipe',
    });
    fs.writeFileSync(`${zip}.sha256`, `${hashFile(zip)}  ${path.basename(zip)}\n`);
    console.log(`ZIP: ${zip}`);
    console.log(
      `Audited ${manifest.payload.length} payload entries; ${runtime.length} runtime packages. Untested on Windows.`,
    );
    return { zip, manifest };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

module.exports = { packageWindows };
if (require.main === module)
  packageWindows({ skipBuild: process.argv.includes('--skip-build') }).catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
