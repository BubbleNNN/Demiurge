'use strict';
// Real Electron UI, IPC, PNG codecs, persistence and pet playback. Image responses
// are isolated transport fixtures; this does not certify model/artwork quality.
const { app, BrowserWindow, dialog, safeStorage, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fixture = require('../tests/fixtures/pet-images.cjs');
const dir = path.resolve(__dirname, '../.local/pet-production-upgrade-' + randomUUID());
fs.mkdirSync(dir, { recursive: true });
process.env.MORI_DATA_DIR = dir;
delete process.env.MORI_DEV_URL;
safeStorage.isEncryptionAvailable = () => false;
const originalBytes = fs.readFileSync(path.resolve(__dirname, '../public/art/cyrene-chibi.png'));
const original = fixture.url(originalBytes);
const master = fixture.image(),
  sheet = fixture.image(true);
const stamp = new Date().toISOString();
const character = {
  id: 'production-test',
  name: '自动制作测试',
  work: '隔离测试',
  summary: 'Keep this dossier',
  personality: ['温和'],
  speakingStyle: '',
  appearance: '',
  quotes: [],
  sources: [],
  unknowns: [],
  behavior: { energy: 50, affection: 50, curiosity: 50 },
  createdAt: stamp,
  visualReferences: [{ id: 'original', name: '输入字节测试原图', image: original, createdAt: stamp }],
};
fs.writeFileSync(
  path.join(dir, 'state.json'),
  JSON.stringify({
    settings: {
      llmBaseUrl: 'https://never-call.example/v1',
      llmModel: 'saved-chat',
      imageBaseUrl: 'https://production.mori.example/v1',
      imageModel: '',
      demoMode: false,
      proactiveEnabled: false,
      voiceEnabled: false,
      motionEnabled: true,
    },
    characters: [character],
    skins: [],
    activeCharacterId: character.id,
    activeSkinId: '',
    messages: {
      [character.id]: [{ id: 'old-message', role: 'user', content: 'Preserve my history', createdAt: stamp }],
    },
    memories: [
      { id: 'old-memory', characterId: character.id, text: 'Preserve this memory', createdAt: stamp },
    ],
  }),
);

const calls = [];
// Delay one old-task reply to exercise renderer selection races through real IPC.
let delayedMasterId, releaseMasterReply;
const registerHandler = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) =>
  registerHandler(channel, async (...args) => {
    if (channel === 'mori:pet-job-masters' && args[1] === delayedMasterId) {
      delayedMasterId = undefined;
      await new Promise((resolve) => {
        releaseMasterReply = resolve;
      });
    }
    return handler(...args);
  });
global.fetch = async (url, init) => {
  assert.equal(url, 'https://production.mori.example/v1/images/edits');
  const form = init.body,
    prompt = String(form.get('prompt'));
  calls.push({ prompt, size: form.get('size') });
  const isSheet = /regular [24]-by-2 grid/.test(prompt);
  const images = form.getAll('image[]').length ? form.getAll('image[]') : [form.get('image')];
  assert.deepEqual(Buffer.from(await images.at(-1).arrayBuffer()), originalBytes);
  const bytes = isSheet ? fixture.image(true, { frames: form.get('size') === '1536x1024' ? 8 : 4 }) : master;
  return new Response(JSON.stringify({ data: [{ b64_json: bytes.toString('base64') }] }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
let win;
const deadline = setTimeout(() => finish(new Error('Native upgrade test timed out')), 60000);
async function finish(error) {
  clearTimeout(deadline);
  if (error) {
    console.error(error.stack);
    if (win && !win.isDestroyed()) {
      console.error(await win.webContents.executeJavaScript('document.body.innerText'));
      fs.writeFileSync(path.join(dir, 'failure.png'), (await win.webContents.capturePage()).toPNG());
    }
  } else
    console.log(
      'PASS: real Electron controls, base checkpoint, reload, eight-frame and emotion transport, atlas and preview; fixtures only.',
    );
  console.log('Artifacts: ' + dir);
  app.exit(error ? 1 : 0);
}
app.on('browser-window-created', (_event, created) => {
  if (win) return;
  win = created;
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const wait = async (code) => {
    for (let n = 0; n < 250; n++) {
      if (await js(code)) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('UI did not reach: ' + code);
  };
  const click = (label) =>
    js(
      `(()=>{const b=[...document.querySelectorAll('button')].find(b=>(b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)})&&!b.disabled);if(!b)throw new Error('Missing button '+${JSON.stringify(label)});b.click()})()`,
    );
  const open = async () => {
    await click('外观工作台');
    await click('自动制作多画风桌宠');
    await wait(`!!document.querySelector('[aria-label="动作帧数"]')`);
  };
  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(`!!document.querySelector('.mori-symbol')`);
      await js(
        `window.mori.load().then(r=>window.mori.saveSettings({...r.state.settings,imageModel:'production-fixture'},{imageKey:'isolated-test-key'}))`,
      );
      await open();
      await js(
        `(()=>{ const e=document.querySelector('[aria-label="动作帧数"]'); e.value='8'; e.dispatchEvent(new Event('change',{bubbles:true})); const t=document.querySelector('[aria-label="动作气质"]'); t.value='gentle'; t.dispatchEvent(new Event('change',{bubbles:true})); const a=document.querySelector('[aria-label="外观要求"]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(a,'轮廓清晰，保留发饰'); a.dispatchEvent(new Event('input',{bubbles:true})); })()`,
      );
      await click('开始自动制作桌宠');
      await wait(
        `document.querySelectorAll('[aria-label="角色基准预览"] img').length===1&&!document.querySelector('.production-step.working')`,
      );
      assert.equal(calls.length, 1, 'Default checkpoint must stop before generating any actions');
      assert.match(calls[0].prompt, /轮廓清晰/);
      let jobs = await js(`window.mori.listPetJobs('production-test')`);
      assert.equal(jobs[0].frameCount, 8);
      assert.equal(jobs[0].temperament, 'gentle');
      assert.equal((await js(`window.mori.load()`)).state.skins.length, 0);
      await js(
        `document.querySelector('[aria-label="角色基准预览"]').scrollIntoView({block:'center',behavior:'instant'})`,
      );
      await new Promise((r) => setTimeout(r, 400));
      fs.writeFileSync(path.join(dir, 'base-checkpoint.png'), (await win.webContents.capturePage()).toPNG());
      win.webContents.reload();
      await wait(`!!document.querySelector('.mori-symbol')`);
      await open();
      await wait(`document.querySelectorAll('[aria-label="角色基准预览"] img').length===1`);
      assert.equal(calls.length, 1);
      await click('继续自动制作');
      await wait(
        `!!document.querySelector('.production-review')&&!document.querySelector('.production-step.working')`,
      );
      assert.equal(calls.length, 7);
      assert.equal(calls.filter((c) => c.size === '1536x1024').length, 5);
      jobs = await js(`window.mori.listPetJobs('production-test')`);
      assert.equal(jobs[0].status, 'ready');
      const skins = await js(`window.mori.petJobResults(${JSON.stringify(jobs[0].id)})`);
      assert.equal(skins[0].sprite.frames.length, 45);
      assert.equal(skins[0].sprite.clips.wave.frames.length, 9);
      await new Promise((r) => setTimeout(r, 500));
      await js(
        `document.querySelector('.candidate-animation-stage').scrollIntoView({block:'center',behavior:'instant'})`,
      );
      await wait(`document.querySelector('.candidate-animation canvas')?.dataset.motion==='active'`);
      await click('预览招手动作');
      await wait(`document.querySelector('.candidate-animation canvas').dataset.clip==='wave'`);
      await js(
        `document.querySelector('.production-review').scrollIntoView({block:'start',behavior:'instant'})`,
      );
      fs.writeFileSync(
        path.join(dir, 'eight-frame-preview.png'),
        (await win.webContents.capturePage()).toPNG(),
      );
      assert.equal(
        await js(
          `document.querySelector('.modal').scrollWidth<=document.querySelector('.modal').clientWidth+2`,
        ),
        true,
      );
      win.setSize(900, 800);
      await new Promise((r) => setTimeout(r, 150));
      assert.equal(
        await js(
          `document.querySelector('.modal').scrollWidth<=document.querySelector('.modal').clientWidth+2`,
        ),
        true,
      );
      const second = await js(
        `window.mori.startPetJob({characterId:'production-test',styles:['original'],motions:['wave'],autoCollect:false}).then(async j=>{await window.mori.advancePetJob(j.id);return j})`,
      );
      await click('刷新任务');
      await wait(`document.querySelectorAll('.production-job-tabs button').length===2`);
      await js(
        `[...document.querySelectorAll('.production-job-tabs button')].find(b=>b.textContent.includes('原作画风')).click()`,
      );
      await wait(`document.querySelector('[aria-label="角色基准预览"] img')?.alt.includes('原作画风')`);
      delayedMasterId = jobs[0].id;
      await js(
        `[...document.querySelectorAll('.production-job-tabs button')].find(b=>b.textContent.includes('软萌 Q 版')).click()`,
      );
      for (let n = 0; n < 100 && !releaseMasterReply; n++) await new Promise((r) => setTimeout(r, 20));
      assert.ok(releaseMasterReply);
      assert.equal(await js(`document.querySelectorAll('[aria-label="角色基准预览"] img').length`), 0);
      await js(
        `[...document.querySelectorAll('.production-job-tabs button')].find(b=>b.textContent.includes('原作画风')).click()`,
      );
      await wait(`document.querySelector('[aria-label="角色基准预览"] img')?.alt.includes('原作画风')`);
      releaseMasterReply();
      await new Promise((r) => setTimeout(r, 200));
      assert.equal(
        await js(`document.querySelector('[aria-label="角色基准预览"] img')?.alt.includes('原作画风')`),
        true,
        'Late replies from an old task cannot replace the selected master',
      );
      assert.equal(await js(`document.querySelectorAll('.production-review').length`), 0);
      fs.writeFileSync(
        path.join(dir, 'checks.json'),
        JSON.stringify(
          {
            passed: true,
            imageRequests: calls.length,
            paidRequests: 0,
            frames: 45,
            sizes: [900],
            checkpoint: true,
            reload: true,
            staleTaskReply: true,
          },
          null,
          2,
        ),
      );
      await finish();
    } catch (error) {
      await finish(error);
    }
  });
});
require('../electron/main.cjs');
