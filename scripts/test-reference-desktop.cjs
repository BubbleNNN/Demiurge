'use strict';
// Run with Electron after `pnpm build`. Uses an isolated workspace and a loopback
// transport fixture, never user API keys. This is not an image-fidelity evaluation.
const { app, dialog, safeStorage, protocol } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const dir = path.join(root, '.local', `reference-smoke-${randomUUID()}`);
const fixture = path.join(root, 'public/art/cyrene-chibi.png');
let requests = 0;
let server;
let window;
let started = false;
const errors = [];
// Fixture setup awaits loopback binding. Register the app's scheme before Electron
// becomes ready, then verify main.cjs requests exactly these same privileges.
const schemes = [
  {
    scheme: 'mori-asset',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
];
protocol.registerSchemesAsPrivileged(schemes);
protocol.registerSchemesAsPrivileged = (requested) => assert.deepEqual(requested, schemes);
const deadline = setTimeout(() => finish(new Error('Desktop test timed out.')), 60000);

async function finish(error) {
  clearTimeout(deadline);
  if (error) {
    console.error(error.stack || error);
    if (window && !window.isDestroyed()) {
      const state = await window.webContents.executeJavaScript('document.body.innerText').catch(() => '');
      console.error(state.slice(-4500));
    }
  }
  server?.close();
  console.log(`Isolated test workspace: ${dir}`);
  app.exit(error ? 1 : 0);
}
async function evaluate(code) {
  return window.webContents.executeJavaScript(code, true).catch((error) => {
    throw new Error(code.slice(0, 300) + ': ' + error.message);
  });
}
async function waitFor(code) {
  for (let n = 0; n < 120; n++) {
    const result = await evaluate(code);
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Condition failed: ${code}`);
}
async function click(text) {
  await evaluate(
    `(() => { const button = [...document.querySelectorAll('button')].find((b) => (b.textContent.trim() === ${JSON.stringify(text)} || b.getAttribute('aria-label') === ${JSON.stringify(text)}) && !b.disabled); if (!button) throw new Error('Enabled button not found: ' + ${JSON.stringify(text)}); button.click(); })()`,
  );
}
async function loadedState() {
  return evaluate('(async () => (await window.mori.load()).state)()');
}

async function run() {
  await waitFor(`!!document.querySelector('.room-rail')`);
  await evaluate(
    `(async () => { const s = (await window.mori.load()).state; await window.mori.saveSettings(s.settings, {imageKey:'local-transport-fixture'}); })()`,
  );
  await click('Mori 首页');
  await click('角色工作室');
  await click('外观与动作');
  await click('制作立绘与像素动画');
  await waitFor(`document.querySelector('.generation-studio')`);
  assert.equal(
    await evaluate(
      `[...document.querySelectorAll('button')].find(b => b.textContent.includes('生成 1 张候选')).disabled`,
    ),
    true,
  );
  await click('添加原图');
  await waitFor(`document.querySelectorAll('.reference-card').length === 1`);
  const before = await loadedState();
  const imported = before.characters[0].visualReferences[0];
  assert.equal(imported.image.split(',')[1], (await fs.readFile(fixture)).toString('base64'));
  await click('用 1 张原图生成 1 张候选');
  await waitFor(
    `document.querySelector('.reference-comparison') && !document.querySelector('.progress-card')`,
  );
  const base = (await loadedState()).skins[0];
  assert.equal(base.review.status, 'pending');
  assert.equal((await loadedState()).activeSkinId, '');
  assert.equal(requests, 1);
  const blocked = await evaluate(
    `window.mori.generateExpressions({characterId:'reference-test',skinId:${JSON.stringify(base.id)}}).then(() => false, () => true)`,
  );
  assert.equal(blocked, true);
  assert.equal(requests, 1);
  // Capture the real UI (fixture artwork is not claimed to be Cyrene reference art).
  await evaluate(
    `document.querySelector('.reference-comparison').scrollIntoView({block:'center',behavior:'instant'})`,
  );
  await new Promise((resolve) => setTimeout(resolve, 200));
  await fs.writeFile(
    path.join(dir, 'reference-comparison.png'),
    (await window.webContents.capturePage()).toPNG(),
  );
  await evaluate(`document.querySelectorAll('.identity-checks input').forEach(input => input.click())`);
  await click('确认基准并使用');
  await waitFor(`document.querySelector('.expression-preview') && !document.querySelector('.progress-card')`);
  assert.equal((await loadedState()).activeSkinId, base.id);
  await click('生成缺失表情（最多 5 次请求）');
  await waitFor(
    `document.querySelectorAll('.expression-preview img').length === 6 && !document.querySelector('.progress-card')`,
  );
  assert.equal(requests, 6);
  const state = await loadedState();
  assert.equal(Object.keys(state.skins[0].images).length, 6);
  await evaluate(
    `(() => { const select = document.querySelector('.generation-source select'); select.value=${JSON.stringify(base.id)}; select.dispatchEvent(new Event('change',{bubbles:true})); })()`,
  );
  await click('清空选择');
  await click('✧原作画风');
  await click('用 1 张原图生成 1 张候选');
  await waitFor(
    `(async () => (await window.mori.load()).state.skins.length === 2 && !document.querySelector('.progress-card'))()`,
  );
  const branch = (await loadedState()).skins.find((s) => s.id !== base.id);
  assert.equal(branch.generation.parentSkinId, base.id);
  assert.equal(branch.review.status, 'pending');
  assert.equal(requests, 7);
  await click('添加原图');
  await waitFor(`document.querySelectorAll('.reference-card').length === 2`);
  const staleBlocked = await evaluate(
    `window.mori.generateExpressions({characterId:'reference-test',skinId:${JSON.stringify(base.id)}}).then(() => false, () => true)`,
  );
  assert.equal(staleBlocked, true);
  assert.equal(requests, 7);
  window.webContents.reload();
  await waitFor(`!!document.querySelector('.room-rail')`);
  const restored = await loadedState();
  assert.equal(restored.characters[0].visualReferences.length, 2);
  assert.equal(restored.skins.length, 2);
  assert.equal(restored.skins.find((s) => s.id === base.id).review.status, 'pending');
  assert.deepEqual(errors, []);
  console.log(
    'PASS: native original import, original bytes over HTTP multipart, base-review gate, five expression edits, style branch with original refs, stale-review rejection, reload persistence.',
  );
  await finish();
}

(async () => {
  await fs.mkdir(path.join(dir, 'Shared Dictionary/cache'), { recursive: true });
  const bytes = await fs.readFile(fixture);
  server = http.createServer(async (req, res) => {
    try {
      assert.equal(req.method, 'POST');
      assert.equal(req.url, '/v1/images/edits');
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const form = await new Request('http://localhost/', {
        method: 'POST',
        headers: req.headers,
        body: Buffer.concat(chunks),
      }).formData();
      const files = form.getAll('image[]').length ? form.getAll('image[]') : [form.get('image')];
      assert.equal(files.length, requests === 0 ? 1 : 2);
      for (const file of files) assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
      requests++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ b64_json: bytes.toString('base64') }] }));
    } catch (error) {
      errors.push(error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Local transport assertion failed.' } }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const character = {
    id: 'reference-test',
    name: '参考传输测试',
    work: '本地测试素材（非官方角色参考）',
    summary: '只验证图片传输与审核流程',
    personality: [],
    speakingStyle: '',
    appearance: '此段文字不得替代原图',
    quotes: [],
    sources: [],
    unknowns: [],
    behavior: { energy: 50, affection: 50, curiosity: 50 },
    createdAt: new Date().toISOString(),
  };
  await fs.writeFile(
    path.join(dir, 'state.json'),
    JSON.stringify({
      settings: {
        llmBaseUrl: '',
        llmModel: '',
        imageBaseUrl: `http://127.0.0.1:${server.address().port}/v1`,
        imageModel: 'local-transport-fixture',
        demoMode: false,
        proactiveEnabled: false,
      },
      characters: [character],
      skins: [],
      activeCharacterId: character.id,
      activeSkinId: '',
      messages: { [character.id]: [] },
      memories: [],
    }),
  );
  process.env.MORI_DATA_DIR = dir;
  delete process.env.MORI_DEV_URL;
  safeStorage.isEncryptionAvailable = () => false;
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] });
  app.on('browser-window-created', (_event, created) => {
    // Animation state is read from the page; a window behind other apps must keep its frames.
    created.webContents.setBackgroundThrottling(false);
    window = created;
    created.webContents.on('console-message', (event) => {
      if (event.level === 'error' || event.level === 3) errors.push(event.message);
    });
    created.webContents.on('did-finish-load', () => {
      if (!started) {
        started = true;
        void run().catch(finish);
      }
    });
  });
  require('../electron/main.cjs');
})().catch(finish);
