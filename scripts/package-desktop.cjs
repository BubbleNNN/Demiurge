'use strict';

// Manual Electron packaging, following electronjs.org/docs/latest/tutorial/application-distribution.
// Keep this independent of the package manager's symlink layout and of neighboring projects.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { builtinModules, createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const excluded = new Set([
  '.git',
  '.github',
  '.DS_Store',
  '.local',
  '.local-backups',
  '.pnpm-store',
  'tests',
  'test',
  '__tests__',
  '__fixtures__',
  'fixtures',
  'examples',
  'benchmarks',
]);
const builtin = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`), 'electron']);
const allowedRoot = new Set([
  'package.json',
  'electron',
  'shared',
  'dist',
  'public',
  'node_modules',
  'LICENSE',
  'licenses',
]);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${path.basename(command)} failed (${result.status ?? result.signal}).`);
  return result.stdout;
}

function filesBelow(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const target = path.join(dir, entry.name);
      return entry.isDirectory() ? filesBelow(target) : [target];
    });
}

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function safeName(name) {
  return !excluded.has(name) && !name.startsWith('.env') && !/\.(?:log|map|tsbuildinfo)$/i.test(name);
}

function allowedPayloadPath(relative) {
  const normalized = relative.split(path.sep).join('/');
  return (
    [
      'package.json',
      'LICENSE',
      'dist/index.html',
      'dist/favicon.svg',
      'dist/app-icon.png',
      'electron/native/desktop-bounds',
      'dist/vendor/live2dcubismcore.min.js',
    ].includes(normalized) ||
    /^electron\/[\w/-]+\.cjs$/.test(normalized) ||
    /^shared\/[\w/-]+\.json$/.test(normalized) ||
    /^dist\/art\/[\w-]+\.png$/.test(normalized) ||
    /^dist\/assets\/[\w.-]+\.(?:js|css|woff2?|wasm|png|svg)$/.test(normalized) ||
    normalized.startsWith('node_modules/') ||
    normalized.startsWith('licenses/')
  );
}

function copyDirectory(from, to, accept = () => true) {
  const stat = fs.lstatSync(from);
  if (stat.isSymbolicLink()) throw new Error(`Unexpected symlink in application inputs: ${from}`);
  if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from).sort()) {
      if (safeName(name) && name !== 'node_modules' && accept(path.join(from, name)))
        copyDirectory(path.join(from, name), path.join(to, name), accept);
    }
  } else if (stat.isFile()) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    fs.chmodSync(to, stat.mode & 0o777);
  } else {
    throw new Error(`Unsupported application input: ${from}`);
  }
}

function runtimeImports(electronDir) {
  const names = new Set();
  for (const file of filesBelow(electronDir).filter((file) => file.endsWith('.cjs'))) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const name = match[1];
      if (!name.startsWith('.') && !builtin.has(name))
        names.add(name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0]);
    }
  }
  return [...names].sort();
}

function resolvePackage(name, from) {
  const request = createRequire(path.join(from, 'package.json'));
  // Find the package folder without relying on an exported package.json subpath.
  for (const search of request.resolve.paths(`${name}/package.json`) || []) {
    const candidate = path.join(search, name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate);
  }
  throw new Error(
    `Missing installed dependency ${name} (required by ${from}). Run pnpm install --frozen-lockfile.`,
  );
}

function installRuntimeDependencies(sourceRoot, targetRoot, names) {
  const installed = new Map();
  function install(name, from, parentTarget) {
    const source = resolvePackage(name, from);
    const target = path.join(parentTarget, 'node_modules', name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (installed.has(source)) {
      fs.symlinkSync(path.relative(path.dirname(target), installed.get(source).target), target, 'dir');
      return;
    }
    const info = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
    installed.set(source, { name: info.name, version: info.version, target, source });
    copyDirectory(source, target);
    for (const dependency of Object.keys(info.dependencies || {}).sort()) install(dependency, source, target);
    // Optional dependencies must not silently disappear when present on this platform.
    for (const dependency of Object.keys(info.optionalDependencies || {}).sort()) {
      if (fs.existsSync(path.join(target, 'node_modules', dependency))) continue;
      try {
        resolvePackage(dependency, source);
      } catch {
        continue;
      }
      install(dependency, source, target);
    }
  }
  for (const name of names) install(name, sourceRoot, targetRoot);
  return [...installed.values()];
}

function collectNotices(sourceRoot, target, names) {
  fs.mkdirSync(target, { recursive: true });
  const visited = new Set();
  const records = [];
  function collect(name, from) {
    const source = resolvePackage(name, from);
    if (visited.has(source)) return;
    visited.add(source);
    const info = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
    const directory = `${info.name.replaceAll('/', '__')}@${info.version}`;
    const notices = filesBelow(source).filter((file) => {
      const relative = path.relative(source, file).split(path.sep);
      return (
        !relative.includes('node_modules') &&
        !relative.some((part) => excluded.has(part)) &&
        /^(?:licen[cs]e|notice|copying|ofl)(?:[.-]|$)/i.test(path.basename(file))
      );
    });
    for (const file of notices) {
      const output = path.join(target, directory, path.relative(source, file));
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.copyFileSync(file, output);
    }
    records.push({
      name: info.name,
      version: info.version,
      license: info.license || 'See upstream notices',
      notices: notices.map((file) => `${directory}/${path.relative(source, file)}`),
    });
    for (const dependency of Object.keys(info.dependencies || {}).sort()) collect(dependency, source);
  }
  for (const name of names) collect(name, sourceRoot);
  records.sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(path.join(target, 'dependencies.json'), JSON.stringify(records, null, 2) + '\n');
  return records;
}

// `live2d: false` is a build for publishing: Live2D Cubism Core (licensed separately) must be absent.
function auditPayload(payload, { live2d = true } = {}) {
  for (const name of fs.readdirSync(payload))
    if (!allowedRoot.has(name)) throw new Error(`Unapproved package root: ${name}`);
  const realRoot = fs.realpathSync(payload);
  const files = filesBelow(payload);
  const manifest = [];
  for (const file of files) {
    const relative = path.relative(payload, file);
    if (!allowedPayloadPath(relative)) throw new Error(`Unapproved package resource: ${relative}`);
    if (relative.split(path.sep).some((part) => !safeName(part)))
      throw new Error(`Excluded package input: ${relative}`);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) {
      const resolved = fs.realpathSync(file);
      if (!resolved.startsWith(realRoot + path.sep))
        throw new Error(`Package symlink escapes the app: ${relative}`);
      manifest.push({ path: relative, link: fs.readlinkSync(file) });
    } else {
      manifest.push({ path: relative, bytes: stat.size, sha256: hashFile(file) });
    }
  }
  for (const required of [
    'package.json',
    'electron/main.cjs',
    'electron/preload.cjs',
    'shared/features.json',
    'dist/index.html',
    'dist/favicon.svg',
    ...(live2d ? ['dist/vendor/live2dcubismcore.min.js'] : []),
    'licenses/THIRD_PARTY.md',
  ]) {
    if (!fs.existsSync(path.join(payload, required)))
      throw new Error(`Missing runtime resource: ${required}`);
  }
  const core = path.join(payload, 'dist/vendor/live2dcubismcore.min.js');
  if (!live2d) {
    if (fs.existsSync(core)) throw new Error('A build for publishing must not bundle Live2D Cubism Core.');
  } else {
    const vendor = fs.readFileSync(core, 'utf8');
    if (
      !vendor.includes('Live2D Cubism Core') ||
      !vendor.includes('live2d-proprietary-software-license-agreement')
    )
      throw new Error('Live2D Core or its original license notice is missing.');
  }
  // The example artwork ships once, in dist/art; character export reads it there
  // (electron/artwork.cjs). A second copy would only make the download bigger.
  if (fs.existsSync(path.join(payload, 'public/art')))
    throw new Error('Artwork is bundled twice (public/art).');
  for (const file of fs.readdirSync(path.join(root, 'public/art')).filter((name) => name.endsWith('.png'))) {
    const bundled = path.join(payload, 'dist/art', file);
    if (!fs.existsSync(bundled) || hashFile(bundled) !== hashFile(path.join(root, 'public/art', file)))
      throw new Error(`Bundled artwork is missing or differs from the source: ${file}`);
  }
  return manifest;
}

function editPlist(file, values, remove = []) {
  // plutil is present on supported macOS systems; no Python or Xcode is required.
  for (const key of remove) spawnSync('/usr/bin/plutil', ['-remove', key, file], { stdio: 'ignore' });
  for (const [key, value] of Object.entries(values))
    run('/usr/bin/plutil', ['-replace', key, '-string', value, file], { stdio: 'pipe' });
}

// The app itself inside a packaged Electron (resources/app): code, shared data, the built page,
// artwork, runtime dependencies and licenses. The same for every platform except the macOS
// desktop helper.
function writePayload(payload, info, platform, { live2d = true } = {}) {
  fs.mkdirSync(payload, { recursive: true });
  const imports = runtimeImports(path.join(root, 'electron'));
  const dependencies = Object.fromEntries(
    imports.map((name) => {
      const metadata = JSON.parse(
        fs.readFileSync(path.join(resolvePackage(name, root), 'package.json'), 'utf8'),
      );
      return [name, metadata.version];
    }),
  );
  fs.writeFileSync(
    path.join(payload, 'package.json'),
    JSON.stringify(
      {
        name: info.name,
        // Internal name: keeps the data folder and Keychain item of earlier Mori versions.
        productName: 'Mori',
        version: info.version,
        description: info.description,
        main: info.main,
        license: info.license,
        dependencies,
      },
      null,
      2,
    ) + '\n',
  );
  if (platform === 'darwin') run(process.execPath, [path.join(root, 'scripts/build-desktop-helper.cjs')]);
  copyDirectory(
    path.join(root, 'electron'),
    path.join(payload, 'electron'),
    (file) =>
      fs.statSync(file).isDirectory() ||
      file.endsWith('.cjs') ||
      (platform === 'darwin' && file === path.join(root, 'electron/native/desktop-bounds')),
  );
  copyDirectory(
    path.join(root, 'shared'),
    path.join(payload, 'shared'),
    (file) => fs.statSync(file).isDirectory() || file.endsWith('.json'),
  );
  for (const name of ['index.html', 'favicon.svg', 'assets'])
    copyDirectory(path.join(root, 'dist', name), path.join(payload, 'dist', name));
  const artwork = path.join(root, 'dist/art');
  const pngOnly = (file) => fs.statSync(file).isDirectory() || file.endsWith('.png');
  copyDirectory(artwork, path.join(payload, 'dist/art'), pngOnly);
  if (live2d)
    copyDirectory(
      path.join(root, 'dist/vendor/live2dcubismcore.min.js'),
      path.join(payload, 'dist/vendor/live2dcubismcore.min.js'),
    );
  copyDirectory(path.join(root, 'LICENSE'), path.join(payload, 'LICENSE'));
  const runtime = installRuntimeDependencies(root, payload, imports);
  collectNotices(root, path.join(payload, 'licenses'), Object.keys(info.dependencies));
  fs.copyFileSync(path.join(root, 'docs/THIRD_PARTY.md'), path.join(payload, 'licenses/THIRD_PARTY.md'));
  const artNotice = path.join(root, 'public/art/README.md');
  if (fs.existsSync(artNotice)) fs.copyFileSync(artNotice, path.join(payload, 'licenses/ARTWORK.md'));
  return runtime;
}

function packageDesktop({ skipBuild = false, makeZip = true } = {}) {
  if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch))
    throw new Error('This packaging command currently supports native macOS arm64 or x64 only.');
  const info = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(info.version))
    throw new Error('Invalid package version.');
  const electronExecutable = require('electron');
  const electronApp = path.resolve(electronExecutable, '../../..');
  const electronVersion = require('electron/package.json').version;
  const architecture = run('/usr/bin/lipo', ['-archs', electronExecutable], {
    stdio: 'pipe',
    encoding: 'utf8',
  }).trim();
  if (!architecture.split(/\s+/).includes(process.arch === 'x64' ? 'x86_64' : process.arch))
    throw new Error(`Installed Electron architecture ${architecture} does not match Node ${process.arch}.`);
  if (!fs.existsSync(path.join(root, 'public/vendor/live2dcubismcore.min.js')))
    throw new Error('Live2D Core is missing. Run pnpm setup:live2d before building a complete local app.');
  if (!skipBuild) {
    run(process.execPath, [require.resolve('typescript/bin/tsc'), '-b']);
    run(process.execPath, [
      path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js'),
      'build',
    ]);
  }
  if (!fs.existsSync(path.join(root, 'dist/index.html')))
    throw new Error('Missing production build. Run pnpm build.');
  const release = path.join(root, 'release');
  fs.mkdirSync(release, { recursive: true });
  const stem = `Demiurge-${info.version}-macOS-${process.arch}`;
  const temporary = fs.mkdtempSync(path.join(release, '.package-'));
  const output = path.join(release, stem);
  const app = path.join(temporary, 'Demiurge.app');
  try {
    run('/usr/bin/ditto', ['--noextattr', '--norsrc', electronApp, app], { stdio: 'pipe' });
    const contents = path.join(app, 'Contents');
    const resources = path.join(contents, 'Resources');
    fs.rmSync(path.join(resources, 'default_app.asar'), { force: true });
    fs.rmSync(path.join(contents, '_CodeSignature'), { recursive: true, force: true });
    const payload = path.join(resources, 'app');
    fs.mkdirSync(payload, { recursive: true });
    const runtime = writePayload(payload, info, 'darwin');
    fs.copyFileSync(path.join(root, 'docs/MACOS_RELEASE.md'), path.join(temporary, 'RELEASE_GUIDE.md'));
    for (const file of ['LICENSE', 'LICENSES.chromium.html']) {
      const original = path.join(path.dirname(electronApp), file);
      if (fs.existsSync(original))
        fs.copyFileSync(original, path.join(payload, 'licenses', `Electron-${file}`));
    }
    fs.copyFileSync(
      path.join(root, 'docs/licenses/anime-codex-MIT.txt'),
      path.join(payload, 'licenses/anime-codex-MIT.txt'),
    );
    // Kept from the Mori days: macOS permissions (Finder automation) stay granted after the rename.
    const bundleId = 'com.mori.companion';
    editPlist(
      path.join(contents, 'Info.plist'),
      {
        NSAppleEventsUsageDescription: '桌宠通过 Finder 获取桌面图标位置，寻找藏身处；不会读取文件内容。',
        CFBundleDisplayName: 'Demiurge',
        CFBundleName: 'Demiurge',
        CFBundleExecutable: 'Demiurge',
        CFBundleIdentifier: bundleId,
        CFBundleShortVersionString: info.version,
        CFBundleVersion: info.version,
        CFBundleIconFile: 'demiurge.icns',
        LSApplicationCategoryType: 'public.app-category.lifestyle',
        NSHumanReadableCopyright:
          'Demiurge (formerly Mori) contributors. Third-party code and artwork retain their own rights.',
      },
      ['ElectronAsarIntegrity'],
    );
    fs.renameSync(path.join(contents, 'MacOS/Electron'), path.join(contents, 'MacOS/Demiurge'));
    for (const helper of fs
      .readdirSync(path.join(contents, 'Frameworks'))
      .filter((name) => /^Electron Helper.*\.app$/.test(name))) {
      const helperContents = path.join(contents, 'Frameworks', helper, 'Contents');
      const label = helper.replace(/\.app$/, '');
      const suffix = label === 'Electron Helper' ? '' : `.${label.match(/\(([^)]+)\)/)[1].toLowerCase()}`;
      editPlist(path.join(helperContents, 'Info.plist'), {
        CFBundleDisplayName: label.replace('Electron', 'Demiurge'),
        CFBundleName: label.replace('Electron', 'Demiurge'),
        CFBundleIdentifier: `${bundleId}.helper${suffix}`,
      });
      fs.rmSync(path.join(helperContents, '_CodeSignature'), { recursive: true, force: true });
    }
    const iconDir = path.join(temporary, 'demiurge.iconset');
    fs.mkdirSync(iconDir);
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.MORI_DEV_URL;
    // Your own picture in private/app-icon.png (git-ignored) wins over the bundled icon.
    const customIcon = path.join(root, 'private/app-icon.png');
    run(
      electronExecutable,
      [
        path.join(root, 'scripts/lib/package-icon.cjs'),
        fs.existsSync(customIcon) ? customIcon : path.join(root, 'public/favicon.svg'),
        iconDir,
      ],
      { env },
    );
    // The same icon in the app's sidebar (it falls back to favicon.svg without one).
    if (fs.existsSync(customIcon))
      fs.copyFileSync(path.join(iconDir, 'icon_256x256@2x.png'), path.join(payload, 'dist/app-icon.png'));
    run('/usr/bin/iconutil', ['-c', 'icns', iconDir, '-o', path.join(resources, 'demiurge.icns')], {
      stdio: 'pipe',
    });
    fs.rmSync(iconDir, { recursive: true });
    fs.rmSync(path.join(resources, 'electron.icns'), { force: true });
    const manifest = {
      product: 'Demiurge',
      version: info.version,
      platform: 'darwin',
      arch: process.arch,
      electron: electronVersion,
      signed: false,
      notarized: false,
      distribution: 'local-evaluation',
      runtimeDependencies: runtime
        .map(({ name, version }) => ({ name, version }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      sourceLockSha256: hashFile(path.join(root, 'pnpm-lock.yaml')),
      payload: auditPayload(payload),
    };
    fs.writeFileSync(path.join(temporary, 'package-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    fs.rmSync(output, { recursive: true, force: true });
    fs.renameSync(temporary, output);
    if (makeZip) {
      const zip = path.join(release, `${stem}.zip`);
      fs.rmSync(zip, { force: true });
      run(
        '/usr/bin/ditto',
        ['-c', '-k', '--sequesterRsrc', '--keepParent', '--noextattr', '--norsrc', output, zip],
        { stdio: 'pipe' },
      );
      fs.writeFileSync(`${zip}.sha256`, `${hashFile(zip)}  ${path.basename(zip)}\n`);
      console.log(`ZIP: ${zip}`);
    }
    console.log(`APP: ${path.join(output, 'Demiurge.app')}`);
    console.log(
      `Audited ${manifest.payload.length} payload entries; ${runtime.length} runtime packages. Local unsigned build; no upload.`,
    );
    return { output, app: path.join(output, 'Demiurge.app'), manifest };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

module.exports = {
  runtimeImports,
  installRuntimeDependencies,
  auditPayload,
  safeName,
  packageDesktop,
  writePayload,
  hashFile,
  run,
};
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--skip-build', '--no-zip'].includes(arg))) {
    console.error('Usage: node scripts/package-desktop.cjs [--skip-build] [--no-zip]');
    process.exitCode = 1;
  } else {
    try {
      packageDesktop({ skipBuild: args.includes('--skip-build'), makeZip: !args.includes('--no-zip') });
    } catch (error) {
      console.error(error.stack);
      process.exitCode = 1;
    }
  }
}
