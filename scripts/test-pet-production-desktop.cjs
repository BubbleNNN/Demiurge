'use strict';
// Real Electron UI, IPC, PNG codecs, persistence and pet playback. Image responses
// are isolated transport fixtures; this does not certify model/artwork quality.
const { app, BrowserWindow, dialog, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fixture = require('../tests/fixtures/pet-images.cjs');
const dir = path.resolve(__dirname, '../.local/pet-production-smoke-' + randomUUID());
fs.mkdirSync(dir, { recursive: true });
process.env.MORI_DATA_DIR = dir;
delete process.env.MORI_DEV_URL;
safeStorage.isEncryptionAvailable = () => false;
const originalBytes = fs.readFileSync(path.resolve(__dirname, '../public/art/cyrene-chibi-v6-reference.png'));
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
      searchProvider: 'wiki',
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
const wikiSearches = [];
const furina = fs.readFileSync(path.resolve(__dirname, '../public/art/cyrene-chibi-v6-reference.png'));
const calls = [],
  styles = require('../shared/art-styles.json');
let holdNext = true,
  releaseImage,
  failWave = true,
  failInstall = true,
  active = 0,
  maximum = 0;
const rename = fs.promises.rename;
fs.promises.rename = async (from, to) => {
  if (failInstall && to === path.join(dir, 'state.json')) {
    const next = JSON.parse(await fs.promises.readFile(from, 'utf8'));
    if (next.skins.some((s) => s.sprite)) {
      failInstall = false;
      throw new Error('Fixture: shared-state save interrupted');
    }
  }
  return rename(from, to);
};
global.fetch = async (url, init) => {
  if (String(url).startsWith('https://zh.wikipedia.org/w/api.php')) {
    // The chibi look first looks for an existing design; this isolated wiki has none.
    wikiSearches.push(new URL(url).searchParams.get('gsrsearch'));
    return new Response(JSON.stringify({ batchcomplete: '', query: { pages: {} } }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
  assert.equal(url, 'https://production.mori.example/v1/images/edits');
  assert.equal(init.headers.Authorization, 'Bearer isolated-test-key');
  const form = init.body,
    prompt = String(form.get('prompt'));
  const style = [...require('../shared/creation-styles.json'), ...Object.keys(styles)].find((s) =>
    prompt.includes(styles[s].prompt),
  );
  assert.ok(style, 'A request must explicitly describe its rendering medium');
  const isSheet = prompt.includes('regular 2-by-2 grid');
  const images = form.getAll('image[]').length ? form.getAll('image[]') : [form.get('image')];
  // The chibi look carries the Furina sticker last, as a style guide only.
  assert.equal(images.length, isSheet ? 2 : style === 'chibi-pet' ? 2 : 1);
  assert.deepEqual(Buffer.from(await images[isSheet ? 1 : 0].arrayBuffer()), originalBytes);
  if (isSheet) assert.deepEqual(Buffer.from(await images[0].arrayBuffer()), master);
  else if (style === 'chibi-pet') assert.deepEqual(Buffer.from(await images[1].arrayBuffer()), furina);
  assert.equal(form.get('background'), 'transparent');
  calls.push({ style, isSheet });
  maximum = Math.max(maximum, ++active);
  try {
    if (holdNext) {
      holdNext = false;
      await new Promise((resolve) => {
        releaseImage = resolve;
      });
    }
    if (isSheet && prompt.includes('bend one elbow') && failWave) {
      failWave = false;
      return new Response(JSON.stringify({ error: { message: 'Intentional pose failure' } }), {
        status: 502,
      });
    }
    return new Response(
      JSON.stringify({ data: [{ b64_json: (isSheet ? sheet : master).toString('base64') }] }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } finally {
    active--;
  }
};
const packFile = path.join(dir, 'portable-pet.json');
dialog.showSaveDialog = async () => ({ canceled: false, filePath: packFile });
let win;
const deadline = setTimeout(() => finish(new Error('Native production test timed out')), 90000);
async function finish(error) {
  clearTimeout(deadline);
  if (error) {
    console.error(error.stack);
    if (win && !win.isDestroyed()) {
      console.error((await win.webContents.executeJavaScript('document.body.innerText')).slice(-6000));
      fs.writeFileSync(path.join(dir, 'failure.png'), (await win.webContents.capturePage()).toPNG());
    }
  } else
    console.log(
      'Native automatic production passed: missing configuration gate, multi-style/all-motion selection, original/master byte preservation, pause and reload, single-stage retry, local-only save recovery, two pending atlases, review/activation, authored talk/gesture/emotion playback, portable export and real desktop window. No paid service called; fixtures only.',
    );
  console.log('Artifacts: ' + dir);
  app.exit(error ? 1 : 0);
}
app.on('browser-window-created', (_event, created) => {
  // Animation state is read from the page; a window behind other apps must keep its frames.
  created.webContents.setBackgroundThrottling(false);
  if (win) return;
  win = created;
  win.webContents.on('console-message', (_event, details) => {
    if (details.level >= 2) console.error('Renderer: ' + details.message);
  });
  const js = async (code) => {
    try {
      return await win.webContents.executeJavaScript(code, true);
    } catch (error) {
      throw new Error('Renderer action failed: ' + code + '\n' + error.message);
    }
  };
  const wait = async (code) => {
    for (let n = 0; n < 300; n++) {
      if (await js(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 70));
    }
    throw new Error('UI did not reach: ' + code);
  };
  const click = (label) =>
    js(
      `(()=>{const b=[...document.querySelectorAll('button')].find(b=>(b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)})&&!b.disabled);if(!b)throw new Error('Missing button '+${JSON.stringify(label)});b.click()})()`,
    );
  const state = () => js('window.mori.load().then(r=>r.state)');
  const idle = () =>
    wait(
      `!document.querySelector('.production-step.working')&&!document.querySelector('.pet-production .progress-card')`,
    );
  const open = async () => {
    await click('Demiurge 首页');
    await click('角色工作室');
    await click('外观与动作');
    await click('打开桌宠工作台');
    // These tests cover the standard flow; sharp quality (the default) has its own test.
    await js(
      `new Promise((done)=>{const start=Date.now();const pick=()=>{const e=document.querySelector('[aria-label="动作清晰度"]');if(!e){if(Date.now()-start<3000)return setTimeout(pick,30);return done(false)}if(e.value!=='standard'){Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'standard');e.dispatchEvent(new Event('change',{bubbles:true}))}done(true)};pick()})`,
    );
    await wait(`document.querySelectorAll('.production-style-grid button').length===4`);
  };
  const capture = async (file) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    fs.writeFileSync(path.join(dir, file), (await win.webContents.capturePage()).toPNG());
  };
  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(`!!document.querySelector('.room-rail')`);
      const before = await state();
      await open();
      assert.equal(await js(`document.querySelector('[aria-label="开始自动制作桌宠"]').disabled`), true);
      assert.equal(await js(`!!document.querySelector('.production-connection')`), true);
      assert.equal(calls.length, 0);
      await click('关闭弹窗');
      await js(
        `window.mori.load().then(r=>window.mori.saveSettings({...r.state.settings,imageModel:'production-fixture'},{imageKey:'isolated-test-key'}))`,
      );
      await open();
      await click('全选画风');
      assert.equal(
        await js(`document.querySelectorAll('.production-style-grid button[aria-pressed="true"]').length`),
        4,
      );
      await click('清空画风');
      assert.equal(await js(`document.querySelector('[aria-label="开始自动制作桌宠"]').disabled`), true);
      await click('桌宠画风：Q版');
      await click('桌宠画风：原作');
      // Keep the seven four-frame motions; twelve-frame activities have their own native test.
      const fourFrame = ['blink', 'talk', 'wave', 'nod', 'shake', 'bounce', 'emotions'];
      for (const motion of require('../shared/pet-motions.json')) {
        const pressed = await js(
          `document.querySelector('[aria-label=${JSON.stringify('制作动作：' + motion.name)}]').getAttribute('aria-pressed')==='true'`,
        );
        if (pressed !== fourFrame.includes(motion.id)) await click('制作动作：' + motion.name);
      }
      assert.equal(
        await js(`document.querySelectorAll('.production-motion-grid button[aria-pressed="true"]').length`),
        7,
      );
      assert.match(await js(`document.querySelector('.production-start').textContent`), /预计 16 次图像请求/);
      await js(`document.querySelector('.production-start').scrollIntoView({block:'center'})`);
      await capture('fixture-plan.png');
      await click('开始自动制作桌宠');
      await wait(`document.querySelectorAll('.production-step.working').length===1`);
      await click('完成当前阶段后暂停');
      await wait(
        `!!document.querySelector('button:disabled')&&document.body.innerText.includes('完成当前阶段后暂停…')`,
      );
      assert.ok(releaseImage);
      releaseImage();
      await wait(
        `document.querySelectorAll('.production-step.done').length===1&&document.body.innerText.includes('已暂停')`,
      );
      await idle();
      assert.equal(calls.length, 1);
      win.webContents.reload();
      await wait(`!!document.querySelector('.room-rail')`);
      await open();
      await wait(`document.querySelectorAll('.production-step.done').length===1`);
      assert.equal(calls.length, 1, 'Opening the task never resumes paid work');
      await click('继续自动制作');
      await wait(`!!document.querySelector('.production-step.uncertain')`);
      await idle();
      assert.equal(calls.length, 4);
      await click('重新生成招手并继续（调用图像 API）');
      await wait(`!!document.querySelector('.production-step.unsaved')`);
      await idle();
      assert.equal(calls.length, 9, 'Only the failed wave is repeated');
      assert.equal((await state()).skins.length, 0);
      await click('仅恢复本机保存');
      await wait(
        `document.querySelectorAll('.production-step.done').length===9&&!!document.querySelector('.production-review')`,
      );
      await idle();
      assert.equal(
        calls.length,
        9,
        'Recovery installs acknowledged atlas without calls or advancing the next style',
      );
      assert.equal((await state()).skins.length, 1);
      await click('继续自动制作');
      await wait(
        `document.querySelectorAll('.production-step.done').length===10&&!document.querySelector('.production-step.working')`,
      );
      assert.equal(calls.length, 10, 'The next style also pauses after its new master');
      await click('继续自动制作');
      await wait(
        `document.querySelectorAll('.production-step.done').length===18&&document.querySelectorAll('.production-output-tabs button').length===2`,
      );
      await idle();
      assert.equal(calls.length, 17);
      assert.equal(maximum, 1);
      let loaded = await state();
      assert.equal(loaded.skins.length, 2);
      assert.ok(loaded.skins.every((s) => s.review.status === 'pending' && s.sprite.frames.length === 29));
      assert.equal(loaded.activeSkinId, '');
      const configuredSettings = loaded.settings;
      assert.deepEqual(loaded.characters, before.characters);
      assert.deepEqual(loaded.messages, before.messages);
      assert.deepEqual(loaded.memories, before.memories);
      assert.equal(await js(`document.querySelector('[aria-label="确认形象并启用桌宠"]').disabled`), true);
      await new Promise((resolve) => setTimeout(resolve, 500));
      await js(
        `document.querySelector('.candidate-animation-stage').scrollIntoView({block:'center',behavior:'instant'})`,
      );
      await wait(`document.querySelector('.candidate-animation canvas')?.dataset.motion==='active'`);
      await click('预览招手动作');
      await wait(`document.querySelector('.candidate-animation canvas').dataset.clip==='wave'`);
      await click('试播说话');
      await wait(`document.querySelector('.candidate-animation canvas').dataset.clip==='talk'`);
      await js(`document.querySelector('[aria-label="试播表情"] button[aria-pressed="false"]').click()`);
      await wait(`document.querySelector('.candidate-animation canvas').dataset.clip==='happy'`);
      await js(`document.querySelector('.production-review').scrollIntoView({block:'start'})`);
      await capture('fixture-review.png');
      assert.equal(
        await js(
          `document.querySelector('.modal').scrollWidth<=document.querySelector('.modal').clientWidth+2`,
        ),
        true,
      );
      await js(
        `document.querySelectorAll('.production-review .generation-checks input').forEach(i=>i.click())`,
      );
      await js(
        `document.querySelectorAll('.frame-review-grid input[type=checkbox]').forEach(i=>{if(!i.checked)i.click()})`,
      );
      await wait(`!document.querySelector('[aria-label="确认形象并启用桌宠"]').disabled`);
      await click('确认形象并启用桌宠');
      await wait(`document.querySelector('.production-output-tabs button').textContent.includes('已确认')`);
      loaded = await state();
      const approved = loaded.skins.find((s) => s.style === 'chibi-pet');
      assert.equal(loaded.activeSkinId, approved.id);
      assert.equal(approved.review.status, 'approved');
      assert.deepEqual(loaded.settings, configuredSettings);
      await click('导出桌宠角色包');
      await wait(`document.body.innerText.includes('角色图、动作时序与角色资料已导出')`);
      const bundle = JSON.parse(fs.readFileSync(packFile, 'utf8'));
      assert.equal(bundle.skins.length, 1);
      assert.equal(bundle.skins[0].sprite.frames.length, 29);
      assert.ok(bundle.skins[0].sprite.clips.bounce && bundle.skins[0].sprite.clips.talk);
      assert.equal(JSON.stringify(bundle).includes('isolated-test-key'), false);
      await js(
        `[...document.querySelectorAll('.production-output-tabs button')].find(b=>b.querySelector('strong').textContent==='原作').click()`,
      );
      await click('形象不对，标记为不采用');
      await wait(
        `document.querySelector('.production-output-tabs button[aria-pressed="true"]').textContent.includes('不采用')`,
      );
      loaded = await state();
      assert.equal(loaded.activeSkinId, approved.id);
      assert.equal(loaded.skins.find((s) => s.style === 'original').review.status, 'rejected');
      await js(
        `[...document.querySelectorAll('.production-output-tabs button')].find(b=>b.querySelector('strong').textContent==='Q版').click()`,
      );
      await click('来到桌面');
      let pet;
      for (let n = 0; n < 150; n++) {
        pet = BrowserWindow.getAllWindows().find((w) => w !== win);
        if (pet && (await pet.webContents.executeJavaScript(`!!document.querySelector('canvas[data-clip]')`)))
          break;
        await new Promise((resolve) => setTimeout(resolve, 70));
      }
      assert.ok(pet);
      assert.ok(await pet.webContents.executeJavaScript(`!!document.querySelector('canvas[data-clip]')`));
      await click('关闭弹窗');
      await click('Demiurge 首页');
      await wait(`!!document.querySelector('.scene-artwork canvas[data-clip]')`);
      await click('摸摸角色的头');
      await wait(`document.querySelector('.scene-artwork canvas').dataset.clip==='nod'`);
      await pet.webContents.executeJavaScript(`document.querySelector('[aria-label="让角色休息"]').click()`);
      // This pack has no sleep motion (twelve-frame motions have their own test): resting keeps
      // the idle loop and blinking instead of a gesture or a missing clip.
      let restObserved = false;
      for (let n = 0; n < 60; n++) {
        if (
          await pet.webContents.executeJavaScript(
            `!!document.querySelector('[aria-label="唤醒角色"]')&&['idle','blink'].includes(document.querySelector('canvas[data-clip]').dataset.clip)`,
          )
        ) {
          restObserved = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.equal(
        restObserved,
        true,
        'The real pet rests on its idle loop when the pack has no sleep motion',
      );
      await pet.webContents.executeJavaScript(`document.querySelector('[aria-label="唤醒角色"]').click()`);
      let waveObserved = false;
      for (let n = 0; n < 30; n++) {
        if (
          await pet.webContents.executeJavaScript(
            `document.querySelector('canvas[data-clip]').dataset.clip==='wave'`,
          )
        ) {
          waveObserved = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(waveObserved, true, 'Wake uses the generated greeting');
      assert.equal(calls.length, 17);
      loaded = await state();
      assert.deepEqual(loaded.characters, before.characters);
      assert.deepEqual(loaded.messages, before.messages);
      assert.deepEqual(loaded.memories, before.memories);
      await finish();
    } catch (error) {
      await finish(error);
    }
  });
});
require('../electron/main.cjs');
