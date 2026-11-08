'use strict';
// Real Electron app, community catalogue served from a local copy (no network): open the panel
// from the sidebar, see the shared pet and plugins, install a plugin and remove it, refuse a file
// whose digest does not match the catalogue, and add the shared pet as a new character.
const { app, BrowserWindow, safeStorage } = require('electron');
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto'),
  assert = require('node:assert/strict');
const { REGISTRIES } = require('../electron/community.cjs');

const dir = fs.mkdtempSync(path.resolve(__dirname, '../.local/community-'));
process.env.MORI_DATA_DIR = dir;
delete process.env.MORI_DEV_URL;
safeStorage.isEncryptionAvailable = () => false;

// The catalogue: the repository's plugins, one test pet (original), and one plugin whose recorded
// digest does not match its file.
const served = path.join(dir, 'served');
fs.mkdirSync(path.join(served, 'plugins'), { recursive: true });
fs.mkdirSync(path.join(served, 'pets'), { recursive: true });
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const entry = (rel, meta) => {
  const bytes = fs.readFileSync(path.join(served, rel));
  return { ...meta, path: rel, size: bytes.length, sha256: digest(bytes) };
};
const index = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../community/index.json'), 'utf8'));
for (const plugin of index.plugins)
  fs.copyFileSync(path.resolve(__dirname, '../community', plugin.path), path.join(served, plugin.path));
const demi = {
  version: 1,
  character: {
    id: 'demi-test',
    name: '小方块',
    work: '',
    summary: '一个害羞的方块精灵。',
    personality: ['害羞'],
    speakingStyle: '',
    appearance: '淡紫色的小方块',
    quotes: [],
    sources: [],
    unknowns: [],
    behavior: { energy: 40, affection: 60, curiosity: 70 },
    createdAt: new Date().toISOString(),
    desktopProfile: { hobbies: ['read'], travel: 'hop' },
  },
  skins: [],
};
fs.writeFileSync(path.join(served, 'pets/demi.json'), JSON.stringify(demi));
fs.writeFileSync(
  path.join(served, 'plugins/tampered.json'),
  JSON.stringify({
    version: 1,
    id: 'tampered',
    name: '被改过的插件',
    kind: 'behavior',
    target: 'all',
    profile: {},
  }),
);
const catalogue = {
  version: 1,
  updated: '2026-11-08',
  pets: [entry('pets/demi.json', { id: 'demi', name: '小方块', author: 'Demiurge', license: 'CC0' })],
  plugins: [
    ...index.plugins,
    {
      ...entry('plugins/tampered.json', { id: 'tampered', name: '被改过的插件', kind: 'behavior' }),
      sha256: '0'.repeat(64),
    },
  ],
};
fs.writeFileSync(path.join(served, 'index.json'), JSON.stringify(catalogue));

const requests = [];
global.fetch = async (url) => {
  requests.push(String(url));
  const base = REGISTRIES[0];
  if (!String(url).startsWith(base)) throw Error('Unexpected request ' + url);
  const file = path.join(served, String(url).slice(base.length));
  if (!file.startsWith(served + path.sep) || !fs.existsSync(file))
    return new Response('missing', { status: 404 });
  return new Response(fs.readFileSync(file), { status: 200 });
};

const exceptions = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (fn, label, tries = 200) => {
  for (let i = 0; i < tries; i++) {
    if (await fn()) return;
    await sleep(50);
  }
  throw Error('Timed out: ' + label);
};
let finished = false;
const timer = setTimeout(() => finish(Error('community timeout')), 60000);
function finish(error, extra = {}) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  const result = {
    passed: !error,
    exceptions,
    requests: requests.length,
    ...extra,
    error: error?.stack,
    artifacts: dir,
  };
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  app.exit(error ? 1 : 0);
}
let started = false;
app.on('browser-window-created', (_e, win) => {
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', (_ev, level, message) => {
    if (level >= 3) exceptions.push(message.slice(0, 300));
  });
  if (started) return;
  started = true;
  win.webContents.once('did-finish-load', async () => {
    const report = {};
    try {
      const js = (s) => win.webContents.executeJavaScript(s, true);
      const click = (label) =>
        js(
          `(()=>{const b=[...document.querySelectorAll('button')].find(b=>(b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)})&&!b.disabled);if(!b)throw new Error('Button missing: '+${JSON.stringify(label)});b.click()})()`,
        );
      const has = (label) =>
        js(
          `[...document.querySelectorAll('button')].some(b=>(b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)})&&!b.disabled)`,
        );
      const text = () => js('document.querySelector(".community")?.innerText || ""');
      const installed = () => {
        try {
          return JSON.parse(fs.readFileSync(path.join(dir, 'plugins.json'), 'utf8')).map((p) => p.id);
        } catch {
          return [];
        }
      };
      await wait(() => js('!!document.querySelector(".room-rail")'), 'home');

      // 1. The panel opens from the sidebar and lists the shared pet.
      await click('社区桌宠与插件');
      await wait(() => has('下载并添加小方块'), 'pet listed');
      report.pets = (await text()).includes('CC0');
      assert.ok(report.pets, 'licence shown');

      // 2. Plugins: install one, then remove it.
      await click('插件');
      const cozy = index.plugins.find((p) => p.id === 'cozy-corner');
      await wait(() => has(`安装插件${cozy.name}`), 'plugins listed');
      await click(`安装插件${cozy.name}`);
      await wait(() => has(`移除插件${cozy.name}`), 'installed');
      assert.deepEqual(installed(), ['cozy-corner']);
      await click(`移除插件${cozy.name}`);
      await wait(() => has(`安装插件${cozy.name}`), 'removed');
      assert.deepEqual(installed(), []);

      // 3. A file that does not match its recorded digest is refused.
      await click('安装插件被改过的插件');
      await wait(async () => (await text()).includes('与社区目录记录不一致'), 'tampered refused');
      assert.deepEqual(installed(), []);
      await sleep(400);
      report.tampered = await js(
        '(()=>{const e=document.querySelector(".community .inline-error");const r=e&&e.getBoundingClientRect();return r&&r.height>0?"refused, shown":"hidden"})()',
      );
      assert.equal(report.tampered, 'refused, shown');
      fs.writeFileSync(path.join(dir, 'plugins.png'), (await win.webContents.capturePage()).toPNG());

      // 4. The shared pet becomes a new character, with her behaviour profile.
      await click('桌宠');
      await wait(() => has('下载并添加小方块'), 'pet tab');
      await click('下载并添加小方块');
      await wait(async () => !(await js('!!document.querySelector(".community")')), 'panel closed');
      const loaded = await js('window.mori.load().then(r=>r.state)');
      const added = loaded.characters.find((c) => c.name === '小方块');
      assert.ok(added, 'character added');
      assert.equal(loaded.activeCharacterId, added.id);
      assert.notEqual(added.id, 'demi-test', 'given a fresh id');
      assert.deepEqual(added.desktopProfile, { hobbies: ['read'], travel: 'hop' });
      report.pet = { id: added.id, active: true };
      assert.ok(requests.every((url) => url.startsWith(REGISTRIES[0])));
      assert.deepEqual(exceptions, []);
      finish(null, report);
    } catch (e) {
      finish(e, report);
    }
  });
});
require('../electron/main.cjs');
