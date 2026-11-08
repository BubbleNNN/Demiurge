'use strict';

// This launches the actual packaged executable, not an Electron test harness or development server.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const { auditPayload } = require('./package-desktop.cjs');
const root = path.resolve(__dirname, '..');
const info = require('../package.json');
const appPath = path.resolve(
  process.argv[2] || path.join(root, `release/Mori-${info.version}-macOS-${process.arch}/Mori.app`),
);
const binary = path.join(appPath, 'Contents/MacOS/Mori');
const payload = path.join(appPath, 'Contents/Resources/app');
const output = path.join(root, `artifacts/macos-release-${process.arch}`);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mori-packaged-smoke-'));
const env = { ...process.env, MORI_DATA_DIR: dataDir };
for (const key of [
  'MORI_DEV_URL',
  'MORI_DEV_VIEW',
  'MORI_DEV_TOKEN',
  'ELECTRON_RUN_AS_NODE',
  'NODE_OPTIONS',
  'NODE_PATH',
])
  delete env[key];
fs.mkdirSync(output, { recursive: true });
fs.rmSync(path.join(output, 'checks.json'), { force: true });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let child,
  log = '',
  client;

async function waitFor(callback, label, timeout = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const result = await callback();
    if (result) return result;
    if (child && child.exitCode !== null)
      throw new Error(`App exited while waiting for ${label}: ${child.exitCode}`);
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  const exceptions = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
    const request = pending.get(message.id);
    if (request) {
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timed out: ${method}`));
      }, 15000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (result.exceptionDetails)
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  await send('Runtime.enable');
  return { send, evaluate, exceptions, close: () => socket.close() };
}

(async () => {
  const manifest = auditPayload(payload);
  const expected = JSON.parse(
    fs.readFileSync(path.join(path.dirname(appPath), 'package-manifest.json'), 'utf8'),
  );
  assert.deepEqual(manifest, expected.payload, 'Packaged files must match the recorded build manifest.');
  const runtime = spawnSync(
    binary,
    [
      '-e',
      `
    const assert = require('node:assert/strict');
    const { createRequire } = require('node:module');
    const req = createRequire(process.argv[1]);
    const { parseHTML } = req('linkedom');
    assert.equal(parseHTML('<div>Mori</div>').document.querySelector('div').textContent, 'Mori');
    assert.equal(typeof req('@mozilla/readability').Readability, 'function');
    const { zipSync, unzipSync } = req('fflate');
    assert.equal(Buffer.from(unzipSync(zipSync({hello: Buffer.from('Mori')})).hello).toString(), 'Mori');
    for (const file of require('node:fs').readdirSync(require('node:path').join(require('node:path').dirname(process.argv[1]), 'electron')))
      if (file.endsWith('.cjs') && !['main.cjs', 'preload.cjs'].includes(file)) req('./electron/' + file);
    console.log('Runtime dependency closure passed.');
  `,
      path.join(payload, 'package.json'),
    ],
    {
      cwd: os.tmpdir(),
      encoding: 'utf8',
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
      timeout: 15000,
    },
  );
  assert.equal(runtime.status, 0, runtime.stderr || runtime.error?.message);
  child = spawn(binary, ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'], {
    cwd: os.tmpdir(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (data) => {
    log += data.toString();
  });
  child.stderr.on('data', (data) => {
    log += data.toString();
  });
  child.on('error', (error) => {
    log += error.stack;
  });
  const endpoint = await waitFor(() => {
    const match = log.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
    return match ? `http://127.0.0.1:${match[1]}` : null;
  }, 'isolated local debugging endpoint');
  const pages = () => fetch(`${endpoint}/json/list`).then((response) => response.json());
  const page = await waitFor(
    async () =>
      (await pages()).find(
        (item) => item.type === 'page' && item.url.startsWith('file:') && !item.url.includes('pet=1'),
      ),
    'packaged workshop page',
  );
  client = await connect(page.webSocketDebuggerUrl);
  await waitFor(
    () => client.evaluate(`Boolean(document.querySelector('.room-rail') && window.mori)`),
    'rendered Mori interface',
  );
  const initial = await waitFor(async () => {
    const value = await client.evaluate('window.mori.load()');
    return value.state?.characters?.length ? value : null;
  }, 'first launch state');
  assert.ok(initial.state.skins.length > 0, 'Fresh app must ship usable artwork.');
  assert.equal(
    Object.entries(initial.keys).some(([name, present]) => name.endsWith('Key') && present),
    false,
    'Fresh package must contain no user credentials.',
  );
  assert.equal(await client.evaluate(`typeof require`), 'undefined', 'Renderer must remain sandboxed.');
  assert.equal(
    await client.evaluate(`location.protocol`),
    'file:',
    'Smoke must not use a development server.',
  );
  await client.evaluate(`(async () => {
    const loaded = await window.mori.load();
    const settings = {...loaded.state.settings, chatMode: 'local', proactiveEnabled: false, voiceEnabled: false};
    await window.mori.saveSettings(settings, {}, loaded.state.settings);
    const character = loaded.state.characters.find(c => c.id === loaded.state.activeCharacterId);
    const message = {id:'packaged-smoke', role:'user', content:'你好', createdAt: new Date().toISOString()};
    const state = {...loaded.state, settings, messages: {...loaded.state.messages, [character.id]: [message]}};
    await window.mori.save(state, loaded.state);
    return true;
  })()`);
  const reply = await client.evaluate(`(async () => {
    const {state} = await window.mori.load();
    return window.mori.chat({character: state.characters.find(c => c.id === state.activeCharacterId), messages: state.messages[state.activeCharacterId], memories: state.memories});
  })()`);
  assert.ok(reply.text || reply.content, `Local companion did not reply: ${JSON.stringify(reply)}`);
  const vendor = await client.evaluate(`new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('./vendor/live2dcubismcore.min.js', location.href).href;
    script.onload = () => resolve(Boolean(window.Live2DCubismCore));
    script.onerror = () => reject(new Error('Bundled Live2D runtime failed to load'));
    document.head.appendChild(script);
  })`);
  assert.equal(vendor, true);
  await client.evaluate(`window.mori.openPet()`);
  const petPage = await waitFor(
    async () => (await pages()).find((item) => item.url.includes('pet=1')),
    'desktop pet window',
  );
  const petClient = await connect(petPage.webSocketDebuggerUrl);
  try {
    await waitFor(
      () => petClient.evaluate(`Boolean(document.querySelector('canvas, .pet-window, .pet-avatar'))`),
      'desktop pet artwork',
    );
    const scene = await petClient.evaluate('window.mori.desktopScene(true)');
    assert.equal(scene.supported, true, scene.reason);
    assert.ok(Array.isArray(scene.icons));
    await petClient.evaluate("document.querySelector('[aria-label=一起玩]').click()");
    await waitFor(
      () => petClient.evaluate("Boolean(document.querySelector('.pet-moment-bubble .moment-card'))"),
      'packaged game',
    );
    const screenshot = await petClient.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(output, 'packaged-pet.png'), Buffer.from(screenshot.data, 'base64'));
    assert.deepEqual(petClient.exceptions, []);
  } finally {
    petClient.close();
  }
  const screenshot = await client.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(output, 'packaged-workshop.png'), Buffer.from(screenshot.data, 'base64'));
  await client.evaluate('window.mori.closePet()');
  await client.send('Page.reload', { ignoreCache: true });
  await waitFor(() => client.evaluate(`Boolean(document.querySelector('.room-rail'))`), 'reloaded workshop');
  const persisted = await client.evaluate('window.mori.load()');
  assert.equal(persisted.state.settings.chatMode, 'local');
  assert.equal(persisted.state.messages[persisted.state.activeCharacterId][0].id, 'packaged-smoke');
  assert.ok(fs.existsSync(path.join(dataDir, 'state.json')), 'State must use the isolated data directory.');
  assert.deepEqual(client.exceptions, [], 'Packaged renderer must not throw.');
  const report = {
    passed: true,
    app: appPath,
    dataDirectory: dataDir,
    version: info.version,
    architecture: process.arch,
    payloadEntries: manifest.length,
    runtimeDependencyClosure: true,
    firstLaunch: true,
    sandboxedRenderer: true,
    localChat: true,
    bundledLive2DLoaded: true,
    desktopPet: true,
    nativeDesktopScene: true,
    desktopInteraction: true,
    reloadPersistence: true,
    userCredentialsBundled: false,
    paidRequests: 0,
    developmentServerUsed: false,
  };
  fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify(report, null, 2) + '\n');
  fs.rmSync(path.join(output, 'failure.txt'), { force: true });
  console.log(
    `PASS: packaged first launch, offline companion, pet window, Live2D runtime, persistence, isolated dependencies and package audit.\nReport: ${path.join(output, 'checks.json')}`,
  );
})()
  .catch((error) => {
    console.error(error.stack);
    fs.writeFileSync(path.join(output, 'failure.txt'), error.stack + '\n');
    fs.writeFileSync(
      path.join(output, 'checks.json'),
      JSON.stringify({ passed: false, app: appPath, error: error.message }, null, 2) + '\n',
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    client?.close();
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(5000)]);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    fs.writeFileSync(path.join(output, 'electron.log'), log);
  });
