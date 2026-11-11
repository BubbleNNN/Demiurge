'use strict';
// Builds a Windows x64 package of Demiurge from this Mac: Electron's Windows runtime (downloaded
// once by Electron's own downloader, checked against its published checksums) with the same app
// payload as the macOS build, zipped as release/Demiurge-<version>-windows-x64.zip.
// Untested on Windows itself. The desktop helper (windows, Spaces, typing) is macOS only, so on
// Windows the pet lives on the desktop without window awareness; everything else is the same.
// `--public` makes the build meant for a download page: the bundled icon instead of your own
// picture (private/app-icon.png), and no Live2D Cubism Core, which has its own license terms
// (docs/THIRD_PARTY.md). Sprite and image pets work the same; Live2D models do not load.
const fs = require('node:fs');
const path = require('node:path');
const { writePayload, auditPayload, hashFile, run } = require('./package-desktop.cjs');

const root = path.resolve(__dirname, '..');

async function packageWindows({ skipBuild = false, publicBuild = false } = {}) {
  if (process.platform !== 'darwin') throw new Error('This script packages for Windows from macOS.');
  const info = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(info.version)) throw new Error('Invalid package version.');
  if (!publicBuild && !fs.existsSync(path.join(root, 'public/vendor/live2dcubismcore.min.js')))
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
    const runtime = writePayload(payload, info, 'win32', { live2d: !publicBuild });
    // The window and taskbar icon (Windows reads it at runtime): your own picture when there is one.
    const icons = path.join(temporary, 'icons');
    fs.mkdirSync(icons);
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const customIcon = publicBuild ? '' : path.join(root, 'private/app-icon.png');
    run(
      require('electron'),
      [
        path.join(root, 'scripts/lib/package-icon.cjs'),
        customIcon && fs.existsSync(customIcon) ? customIcon : path.join(root, 'public/favicon.svg'),
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
        `Demiurge ${info.version} — Windows x64`,
        '让你喜欢的角色，在桌面活过来。',
        '',
        '【第一次使用】',
        '请完整解压后双击 Demiurge.exe，不要只移动 exe。无需安装 Node.js 或 Python。',
        '内置最新版大昔涟 Q版。打开后点击「体验桌面陪伴」或「放到桌面」。',
        '本地台词和日常互动无需 Key；自由聊天请在「连接与设置」配置模型。',
        '新手教程：https://github.com/BubbleNNN/Demiurge/blob/main/README.zh-CN.md',
        '更新前完全退出程序，替换程序目录；保留 %APPDATA%\\Mori 中的个人数据。',
        '此包未签名，尚未在 Windows 真机验证。窗口感知暂时仅 macOS 支持。',
        '',
        `Demiurge ${info.version} for Windows (x64), unsigned build.`,
        'Run Demiurge.exe. Windows SmartScreen may warn about an unknown publisher the first time.',
        'On Windows the desktop pet does not yet see other windows (that helper is macOS only).',
        ...(publicBuild
          ? ['This build does not include Live2D Cubism Core, so Live2D models do not load.']
          : []),
        'Your data is kept in %APPDATA%\\Mori. To uninstall, delete this folder (and that one to remove your data).',
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
      public: publicBuild,
      live2d: !publicBuild,
      runtimeDependencies: runtime.map(({ name, version }) => ({ name, version })),
      payload: auditPayload(payload, { live2d: !publicBuild }),
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
  packageWindows({
    skipBuild: process.argv.includes('--skip-build'),
    publicBuild: process.argv.includes('--public'),
  }).catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
