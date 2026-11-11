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
const furina = fs.readFileSync(path.resolve(__dirname, '../public/art/cyrene-chibi-v6-reference.png'));
const dir = path.resolve(__dirname, '../.local/pet-activities-desktop-' + randomUUID());
fs.mkdirSync(dir, { recursive: true });
process.env.MORI_DATA_DIR = dir;
delete process.env.MORI_DEV_URL;
safeStorage.isEncryptionAvailable = () => false;
const stamp = new Date().toISOString();
const character = {
  id: 'sticker-test',
  name: '生活活动测试',
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
const rawSheet = require('../tests/fixtures/pet-stages.cjs').stageSheet();
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
    sheet = prompt.includes('regular 4-by-3 grid');
  assert.ok(prompt.includes(style.prompt));
  const input = init.body.getAll('image[]').length ? init.body.getAll('image[]') : [init.body.get('image')];
  const images = await Promise.all(input.map(async (blob) => Buffer.from(await blob.arrayBuffer())));
  // Base: identity original, then the Furina sticker as a style guide only. Sheets: master plus identity.
  assert.deepEqual(images.slice(0, 2), sheet ? [f.image(), f.image()] : [f.image(), furina]);
  if (!sheet) assert.ok(prompt.includes('bundled chibi example, a STYLE GUIDE ONLY'));
  if (sheet && calls.length === 2) assert.deepEqual(images[2], rawSheet);
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
  const diagnostics =
    error && win && !win.isDestroyed()
      ? await win.webContents.executeJavaScript(
          `({hidden:document.hidden,canvases:[...document.querySelectorAll('canvas[data-clip]')].map(c=>({...c.dataset}))})`,
        )
      : undefined;
  const report = {
    diagnostics,
    passed: !error,
    calls,
    paidRequests: 0,
    exceptions,
    error: error?.stack,
    artifacts: dir,
  };
  fs.writeFileSync(path.join(dir, 'checks.json'), JSON.stringify(report, null, 2));
  console[error ? 'error' : 'log'](JSON.stringify(report, null, 2));
  app.exit(error ? 1 : 0);
}
app.on('browser-window-created', (_event, created) => {
  // Keep native animation assertions independent of which app owns OS focus.
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
      await click('打开桌宠工作台');
      // These tests cover the standard flow; sharp quality (the default) has its own test.
      await js(
        `new Promise((done)=>{const start=Date.now();const pick=()=>{const e=document.querySelector('[aria-label="动作清晰度"]');if(!e){if(Date.now()-start<3000)return setTimeout(pick,30);return done(false)}if(e.value!=='standard'){Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'standard');e.dispatchEvent(new Event('change',{bubbles:true}))}done(true)};pick()})`,
      );
      await wait(`!!document.querySelector('[aria-label="桌宠画风：Q版"]')`);
      assert.equal(
        await js(`document.querySelector('[aria-label="桌宠画风：Q版"]').getAttribute('aria-pressed')`),
        'true',
      );
      assert.equal(
        await js(`document.querySelectorAll('[aria-label^="桌宠画风："]').length`),
        4,
        'four looks only',
      );
      for (const direction of ['向右跑', '向左跑', '向后跑', '向前跑'])
        assert.equal(
          await js(
            `document.querySelector('[aria-label="制作动作：${direction}"]').getAttribute('aria-pressed')`,
          ),
          'true',
        );
      for (const motion of motions) {
        const pressed = await js(
          `document.querySelector('[aria-label=${JSON.stringify('制作动作：' + motion.name)}]').getAttribute('aria-pressed')==='true'`,
        );
        if (pressed !== ['read', 'gaming'].includes(motion.id)) await click('制作动作：' + motion.name);
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
      assert.deepEqual(calls, ['base', 'sheet', 'sheet']);
      const [job] = await js(`window.mori.listPetJobs('sticker-test')`);
      assert.equal(job.status, 'ready');
      assert.equal(job.transitionVersion, 3);

      assert.deepEqual(job.styles, ['chibi-pet']);
      assert.deepEqual(job.motions, ['read', 'gaming']);
      const [skin] = await js(`window.mori.petJobResults(${JSON.stringify(job.id)})`);
      assert.equal(skin.style, 'chibi-pet');
      assert.deepEqual(
        wikiSearches.map((q) => /Q版|chibi/.test(q)),
        [true],
        'one chibi search, before the first image request',
      );
      assert.equal(skin.generation.chibiResearch.status, 'fallback');
      assert.match(skin.generation.chibiResearch.reason, /仅参考画风/);
      assert.equal(skin.review.status, 'pending');
      assert.ok(skin.sprite.clips.read && skin.sprite.clips.enter_read && skin.sprite.clips.exit_read);
      assert.ok(skin.sprite.clips.gaming);
      const raw = JSON.parse(fs.readFileSync(path.join(dir, 'pet-jobs', `${job.id}-1.asset.json`), 'utf8'));
      assert.equal(raw.image, f.url(rawSheet));
      assert.notEqual(await js('window.mori.load().then(r=>r.state.activeSkinId)'), skin.id);
      await js(
        `document.querySelector('.candidate-animation-stage').scrollIntoView({block:'center',behavior:'instant'})`,
      );
      win.show();
      win.focus();
      await click('预览读书动作');
      await wait(`!!document.querySelector('.candidate-animation canvas[data-clip="enter_read"]')`);
      await wait(`!!document.querySelector('.candidate-animation canvas[data-clip="read"]')`);
      await click('预览玩掌机动作');
      await wait(`!!document.querySelector('.candidate-animation canvas[data-clip="exit_read"]')`);
      await wait(`!!document.querySelector('.candidate-animation canvas[data-clip="enter_gaming"]')`);
      await wait(`!!document.querySelector('.candidate-animation canvas[data-clip="gaming"]')`);
      await click('预览待机动作');
      await wait(`!!document.querySelector('.candidate-animation canvas[data-clip="exit_gaming"]')`);
      await wait(`!!document.querySelector('.candidate-animation canvas[data-clip="idle"]')`);
      // Approve synthetic test pixels only inside this disposable workspace.
      const count = await js(`document.querySelectorAll('.production-review input[type="checkbox"]:not(.production-add-motions input)').length`);
      assert.equal(count, 31);
      for (let i = 0; i < count; i++) {
        await js(`document.querySelectorAll('.production-review input[type="checkbox"]:not(.production-add-motions input)')[${i}].click()`);
      }
      await wait(`!document.querySelector('[aria-label="确认形象并启用桌宠"]').disabled`);
      await click('确认形象并启用桌宠');
      await wait(`document.querySelector('[aria-label="开始自动制作桌宠"]').disabled===false`);
      assert.equal(await js('window.mori.load().then(r=>r.state.activeSkinId)'), skin.id);
      await js('window.mori.openPet()');
      let pet;
      for (let attempt = 0; attempt < 100; attempt++) {
        pet = require('electron')
          .BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().includes('pet=1'));
        if (
          pet &&
          (await pet.webContents.executeJavaScript(`!!document.querySelector('[aria-label="桌宠读书"]')`))
        )
          break;
        await new Promise((r) => setTimeout(r, 50));
      }
      assert.ok(pet);
      const petJS = (code) => pet.webContents.executeJavaScript(code, true);
      const petWait = async (code) => {
        for (let n = 0; n < 250; n++) {
          if (await petJS(code)) return;
          await new Promise((r) => setTimeout(r, 40));
        }
        throw Error('Pet did not reach: ' + code);
      };
      await petJS(`document.querySelector('[aria-label="桌宠读书"]').click()`);
      await petWait(`!!document.querySelector('canvas[data-clip="read"]')`);
      await new Promise((r) => setTimeout(r, 5000));
      assert.equal(await petJS(`document.querySelector('canvas[data-clip]').dataset.clip`), 'read');
      pet.show();
      pet.focus();
      await petJS(`document.querySelector('[aria-label="桌宠读书"]').focus()`);
      await new Promise((r) => setTimeout(r, 250));
      assert.equal(
        await petJS(
          `[...document.querySelectorAll('.pet-toolbar button')].every(b=>{const r=b.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&b.scrollWidth<=b.clientWidth+1})`,
        ),
        true,
      );
      const rendering = await petJS(
        `(()=>{const c=document.querySelector('canvas[data-clip]'),r=c.getBoundingClientRect(),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let visible=0;for(let i=3;i<d.length;i+=4)if(d[i]>40)visible++;return {visible,clip:c.dataset.clip,rect:{top:r.top,bottom:r.bottom,left:r.left,right:r.right},viewport:{width:innerWidth,height:innerHeight},scroll:scrollY}})()`,
      );
      fs.writeFileSync(path.join(dir, 'rendering.json'), JSON.stringify(rendering, null, 2));
      assert.ok(rendering.visible > 100);
      assert.ok(rendering.rect.bottom > 0 && rendering.rect.top < rendering.viewport.height);
      fs.writeFileSync(path.join(dir, 'activity-pet.png'), (await pet.webContents.capturePage()).toPNG());
      await petJS(`document.querySelector('[aria-label="停止桌宠活动"]').click()`);
      await petWait(`!!document.querySelector('canvas[data-clip="exit_read"]')`);
      await petWait(`!!document.querySelector('canvas[data-clip="idle"]')`);
      // Accelerate only the 60-second activity deadline, leaving animation timing intact.
      await petJS(
        `window.activityTestTimeout=window.setTimeout; window.setTimeout=(fn,ms,...args)=>window.activityTestTimeout(fn,ms>=59000&&ms<=60000?100:ms,...args); true`,
      );
      await petJS(`document.querySelector('[aria-label="桌宠玩掌机"]').click()`);
      await petWait(`!document.querySelector('[aria-label="停止桌宠活动"]')`);
      await petWait(`!!document.querySelector('canvas[data-clip="idle"]')`);
      await petJS(`window.setTimeout=window.activityTestTimeout; delete window.activityTestTimeout`);
      await js('window.mori.closePet()');
      await capture('activity-result.png', '.candidate-animation-stage');
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
