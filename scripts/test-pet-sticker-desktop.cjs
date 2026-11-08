'use strict';
// Actual Electron UI + IPC + native PNG codec; synthetic replies, no art-quality claim.
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const f = require('../tests/fixtures/pet-images.cjs');
const motions = require('../shared/pet-motions.json');
const style = require('../shared/art-styles.json')['chibi-pet'];
const furina = fs.readFileSync(path.resolve(__dirname, '../public/art/chibi-fallback-furina.png'));
const dir = path.resolve(__dirname, '../.local/pet-sticker-desktop-' + randomUUID());
fs.mkdirSync(dir, { recursive: true });
process.env.MORI_DATA_DIR = dir;
delete process.env.MORI_DEV_URL;
safeStorage.isEncryptionAvailable = () => false;
const stamp = new Date().toISOString();
const character = {
  id: 'sticker-test',
  name: '贴纸制作测试',
  work: '隔离验收',
  summary: '',
  personality: [],
  speakingStyle: '',
  appearance: '',
  quotes: [],
  sources: [],
  unknowns: [],
  behavior: { energy: 50, affection: 50, curiosity: 50 },
  createdAt: stamp,
  visualReferences: [{ id: 'identity', name: '原始参考', image: f.url(f.image()), createdAt: stamp }],
};
fs.writeFileSync(
  path.join(dir, 'state.json'),
  JSON.stringify({
    settings: {
      llmBaseUrl: 'https://never-call.example/v1',
      llmModel: '',
      chatMode: 'local',
      imageBaseUrl: 'https://sticker.mori.example/v1',
      imageModel: '',
      searchProvider: 'wiki',
      demoMode: false,
      proactiveEnabled: false,
      voiceEnabled: false,
      motionEnabled: true,
    },
    characters: [character],
    skins: [],
    activeCharacterId: character.id,
    activeSkinId: '',
    messages: { [character.id]: [] },
    memories: [],
  }),
);
const src = f.decode(f.image(true)),
  bitmap = Buffer.alloc(256 * 264 * 4);
for (let row = 0; row < 2; row++)
  for (let y = 0; y < 128; y++)
    src.bitmap.copy(
      bitmap,
      (row * 132 + y) * 256 * 4,
      (row * 128 + y) * 256 * 4,
      (row * 128 + y + 1) * 256 * 4,
    );
const rawSheet = f.encode(bitmap, 256, 264);
const calls = [];
const wikiSearches = [];
global.fetch = async (url, init) => {
  if (String(url).startsWith('https://zh.wikipedia.org/w/api.php')) {
    // The chibi look first looks for an existing design; this isolated wiki has none.
    wikiSearches.push(new URL(url).searchParams.get('gsrsearch'));
    return new Response(JSON.stringify({ batchcomplete: '', query: { pages: {} } }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
  assert.equal(url, 'https://sticker.mori.example/v1/images/edits');
  const prompt = init.body.get('prompt'),
    sheet = prompt.includes('regular 2-by-2 grid');
  assert.ok(prompt.includes(style.prompt));
  const input = init.body.getAll('image[]').length ? init.body.getAll('image[]') : [init.body.get('image')];
  const images = await Promise.all(input.map(async (blob) => Buffer.from(await blob.arrayBuffer())));
  // Base: identity original, then the Furina sticker as a style guide only. Sheets: master plus identity.
  assert.deepEqual(images, sheet ? [f.image(), f.image()] : [f.image(), furina]);
  if (!sheet) assert.ok(prompt.includes('FURINA sticker, a STYLE GUIDE ONLY'));
  calls.push(sheet ? 'sheet' : 'base');
  return new Response(
    JSON.stringify({ data: [{ b64_json: (sheet ? rawSheet : f.image()).toString('base64') }] }),
    { headers: { 'Content-Type': 'application/json' } },
  );
};
let win,
  finished = false;
const exceptions = [];
const deadline = setTimeout(() => finish(Error('Sticker native test timed out')), 90000);
async function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  if (error && win && !win.isDestroyed())
    fs.writeFileSync(path.join(dir, 'failure.png'), (await win.webContents.capturePage()).toPNG());
  const report = { passed: !error, calls, paidRequests: 0, exceptions, error: error?.stack, artifacts: dir };
  fs.writeFileSync(path.join(dir, 'checks.json'), JSON.stringify(report, null, 2));
  console[error ? 'error' : 'log'](JSON.stringify(report, null, 2));
  app.exit(error ? 1 : 0);
}
app.on('browser-window-created', (_event, created) => {
  // Animation state is read from the page; a window behind other apps must keep its frames.
  created.webContents.setBackgroundThrottling(false);
  if (win) return;
  win = created;
  win.webContents.on('console-message', (_event, level, message) => {
    if (level === 3) exceptions.push(message);
  });
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const wait = async (code) => {
    for (let n = 0; n < 300; n++) {
      if (await js(code)) return;
      await new Promise((r) => setTimeout(r, 40));
    }
    throw Error('UI did not reach: ' + code);
  };
  const click = (label) =>
    js(
      `(()=>{const b=[...document.querySelectorAll('button')].find(b=>(b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)})&&!b.disabled);if(!b)throw Error('Missing '+${JSON.stringify(label)});b.click()})()`,
    );
  const capture = async (name, selector) => {
    await js(
      `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`,
    );
    await new Promise((r) => setTimeout(r, 200));
    fs.writeFileSync(path.join(dir, name), (await win.webContents.capturePage()).toPNG());
  };
  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(`!!document.querySelector('.room-rail')`);
      await js(
        `window.mori.load().then(r=>window.mori.saveSettings({...r.state.settings,imageModel:'sticker-fixture'},{imageKey:'isolated-key'}))`,
      );
      await click('Demiurge 首页');
      await click('角色工作室');
      await click('外观与动作');
      await click('自动制作多画风桌宠');
      // These tests cover the standard flow; sharp quality (the default) has its own test.
      await js(
        `new Promise((done)=>{const start=Date.now();const pick=()=>{const e=document.querySelector('[aria-label="动作清晰度"]');if(!e){if(Date.now()-start<3000)return setTimeout(pick,30);return done(false)}if(e.value!=='standard'){Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'standard');e.dispatchEvent(new Event('change',{bubbles:true}))}done(true)};pick()})`,
      );
      await wait(`!!document.querySelector('[aria-label="桌宠画风：Q版"]')`);
      assert.equal(
        await js(`document.querySelectorAll('[aria-label^="桌宠画风："]').length`),
        4,
        'four looks only',
      );
      // The chibi look is the default selection; a second look would add its own requests.
      assert.equal(
        await js(`document.querySelector('[aria-label="桌宠画风：Q版"]').getAttribute('aria-pressed')`),
        'true',
      );
      for (const motion of motions) {
        const pressed = await js(
          `document.querySelector('[aria-label=${JSON.stringify('制作动作：' + motion.name)}]').getAttribute('aria-pressed')==='true'`,
        );
        if (pressed !== (motion.id === 'wave')) await click('制作动作：' + motion.name);
      }
      assert.equal(calls.length, 0);
      await capture('sticker-plan.png', '[aria-label="自动制作画风"]');
      await click('开始自动制作桌宠');
      await wait(
        `!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='继续自动制作'&&!b.disabled)`,
      );
      assert.deepEqual(calls, ['base']);
      await click('继续自动制作');
      await wait(`!!document.querySelector('.production-review')`);
      await wait(`!document.querySelector('[aria-label="开始自动制作桌宠"]').disabled`);
      assert.deepEqual(calls, ['base', 'sheet']);
      const [job] = await js(`window.mori.listPetJobs('sticker-test')`);
      assert.equal(job.status, 'ready');
      assert.deepEqual(job.styles, ['chibi-pet']);
      assert.ok(job.results[0].warnings.some((w) => w.includes('补透明留白')));
      const [skin] = await js(`window.mori.petJobResults(${JSON.stringify(job.id)})`);
      assert.equal(skin.style, 'chibi-pet');
      assert.deepEqual(
        wikiSearches.map((q) => /Q版|chibi/.test(q)),
        [true],
        'one chibi search, before the first image request',
      );
      assert.equal(skin.generation.chibiResearch.status, 'fallback');
      assert.match(skin.generation.chibiResearch.reason, /芙宁娜/);
      assert.equal(skin.review.status, 'pending');
      assert.ok(skin.sprite.clips.wave);
      const raw = JSON.parse(fs.readFileSync(path.join(dir, 'pet-jobs', `${job.id}-1.asset.json`), 'utf8'));
      assert.equal(raw.image, f.url(rawSheet));
      assert.notEqual(await js('window.mori.load().then(r=>r.state.activeSkinId)'), skin.id);
      await capture('sticker-result.png', '.production-review');
      assert.equal(
        await js(
          `document.querySelector('.modal').scrollWidth<=document.querySelector('.modal').clientWidth+2`,
        ),
        true,
      );
      assert.deepEqual(exceptions, []);
      await finish();
    } catch (error) {
      await finish(error);
    }
  });
});
require('../electron/main.cjs');
