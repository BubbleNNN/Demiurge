'use strict';
// Corrections go to a chat model and a search before the image model; this stands in for the chat model.
const planner = require('./lib/revision-planner-fixture.cjs');
// Real Electron UI + IPC with isolated files and fixed images. No paid requests.
const { app, dialog, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fixture = require('../tests/fixtures/pet-images.cjs');
const { referencePack, imageDigest } = require('../electron/references.cjs');
const artStyles = require('../shared/art-styles.json');
const motions = require('../shared/pet-motions.json');
const dir = path.resolve(__dirname, '../.local/pet-style-reference-desktop-' + randomUUID());
fs.mkdirSync(dir, { recursive: true });
process.env.MORI_DATA_DIR = dir;
delete process.env.MORI_DEV_URL;
safeStorage.isEncryptionAvailable = () => false;
const timestamp = new Date().toISOString();
const originalBytes = fs.readFileSync(path.resolve(__dirname, '../public/art/cyrene-chibi.png'));
function tinted(number, sheet = false) {
  const image = fixture.decode(fixture.image(sheet));
  for (let i = 0; i < image.bitmap.length; i += 4)
    if (image.bitmap[i + 3]) image.bitmap[i] = (image.bitmap[i] + number * 17) % 255;
  return fixture.encode(image.bitmap, image.width, image.height);
}
const guideA = tinted(9),
  guideB = tinted(12);
const guideAFile = path.join(dir, 'style-a.png'),
  guideBFile = path.join(dir, 'style-b.png');
fs.writeFileSync(guideAFile, guideA);
fs.writeFileSync(guideBFile, guideB);
const character = {
  id: 'style-reference-test',
  name: '画风参考测试',
  work: '隔离验收',
  summary: 'Keep identity',
  personality: ['温和'],
  speakingStyle: '',
  appearance: '',
  quotes: [],
  sources: [],
  unknowns: [],
  behavior: { energy: 50, affection: 50, curiosity: 50 },
  createdAt: timestamp,
  visualReferences: [
    { id: 'identity', name: '角色原图', image: fixture.url(originalBytes), createdAt: timestamp },
  ],
};
const identity = referencePack(character);
const source = {
  id: randomUUID(),
  characterId: character.id,
  name: '已确认角色图',
  kind: 'image',
  style: '3d',
  images: { neutral: fixture.url(tinted(1)) },
  createdAt: timestamp,
  generated: true,
  generation: {
    referenceIds: ['identity'],
    referenceDigest: identity.digest,
    model: 'fixture',
    prompt: 'fixture',
  },
  review: {
    status: 'approved',
    referenceDigest: identity.digest,
    imageDigest: imageDigest(fixture.url(tinted(1))),
    reviewedAt: timestamp,
  },
};
fs.writeFileSync(
  path.join(dir, 'state.json'),
  JSON.stringify({
    settings: {
      llmBaseUrl: planner.llmBaseUrl,
      llmModel: planner.llmModel,
      chatMode: 'local',
      imageBaseUrl: 'https://style-reference.mori.example/v1',
      searchProvider: 'wiki',
      imageModel: '',
      demoMode: false,
      proactiveEnabled: false,
      motionEnabled: true,
      voiceEnabled: false,
    },
    characters: [character],
    skins: [source],
    activeCharacterId: character.id,
    activeSkinId: '',
    messages: {
      [character.id]: [{ id: 'old-message', role: 'user', content: 'Keep history', createdAt: timestamp }],
    },
    memories: [{ id: 'old-memory', characterId: character.id, text: 'Keep memory', createdAt: timestamp }],
  }),
);
let importFile = guideAFile,
  cancelImport = false,
  imports = 0;
dialog.showOpenDialog = async (_window, options) => {
  imports += 1;
  assert.match(options.title, /画风参考/);
  assert.deepEqual(options.properties, ['openFile']);
  return cancelImport ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [importFile] };
};
let delayedGuideJob = '',
  releaseGuide;
const pipelineModule = require('../electron/pet-pipeline.cjs');
const createPipeline = pipelineModule.createPetPipeline;
pipelineModule.createPetPipeline = (options) => {
  const pipeline = createPipeline(options),
    lookup = pipeline.styleReference;
  pipeline.styleReference = async (id) => {
    const result = await lookup(id);
    if (id === delayedGuideJob) {
      delayedGuideJob = '';
      await new Promise((resolve) => {
        releaseGuide = resolve;
      });
    }
    return result;
  };
  return pipeline;
};
const calls = [],
  masterBytes = new Map([['3d', tinted(1)]]);
let expectedGuide = guideA;
global.fetch = async (url, init) => {
  const planned = await planner.handle(url, init);
  if (planned) return planned;
  if (String(url).startsWith('https://zh.wikipedia.org/w/api.php'))
    // The correction's search reaches an isolated wiki with no pages.
    return new Response(JSON.stringify({ batchcomplete: '', query: { pages: {} } }), {
      headers: { 'Content-Type': 'application/json' },
    });
  assert.equal(url, 'https://style-reference.mori.example/v1/images/edits');
  assert.equal(init.headers.Authorization, 'Bearer isolated-style-key');
  const prompt = String(init.body.get('prompt'));
  const kind = prompt.includes('regular 2-by-2 grid')
    ? 'sheet'
    : prompt.includes('Requested correction')
      ? 'edit'
      : 'base';
  const style =
    kind === 'edit' ? '3d' : Object.keys(artStyles).find((id) => prompt.includes(artStyles[id].prompt));
  assert.ok(style);
  const items = init.body.getAll('image[]').length ? init.body.getAll('image[]') : [init.body.get('image')];
  const images = await Promise.all(items.map(async (item) => Buffer.from(await item.arrayBuffer())));
  const usesGuide = kind !== 'sheet' && style !== 'original';
  assert.equal(images.length, (kind === 'base' ? 1 : 2) + (usesGuide ? 1 : 0));
  assert.deepEqual(images[kind === 'base' ? 0 : 1], originalBytes, 'Identity bytes remain separate');
  if (kind !== 'base') assert.deepEqual(images[0], masterBytes.get(style), 'Use the selected master bytes');
  if (usesGuide) {
    assert.deepEqual(images.at(-1), expectedGuide, 'Use the task guide, independent of the current draft');
    assert.match(prompt, /STYLE-ONLY reference/);
  } else assert.doesNotMatch(prompt, /STYLE-ONLY reference/);
  calls.push({ style, kind, imageCount: images.length, usesGuide });
  const bytes = tinted(calls.length + 20, kind === 'sheet');
  if (kind !== 'sheet') masterBytes.set(style, bytes);
  return new Response(JSON.stringify({ data: [{ b64_json: bytes.toString('base64') }] }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
let win,
  finished = false;
const deadline = setTimeout(() => finish(new Error('Native style reference test timed out')), 120000);
async function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  const message = error
    ? error.stack
    : 'PASS: independent style import/scope/provenance, original and source exclusion, saved guide on corrections, exact input bytes, stale task lookup, reload, 96/160/240 CSS px old/new previews. Fixed responses only; 0 paid requests.';
  fs.writeFileSync(path.join(dir, 'native.log'), message + '\nArtifacts: ' + dir + '\n');
  if (error && win && !win.isDestroyed()) {
    console.error((await win.webContents.executeJavaScript('document.body.innerText')).slice(-10000));
    fs.writeFileSync(path.join(dir, 'failure.png'), (await win.webContents.capturePage()).toPNG());
  }
  console[error ? 'error' : 'log'](message);
  console.log('Artifacts: ' + dir);
  app.exit(error ? 1 : 0);
}
app.on('browser-window-created', (_event, created) => {
  // Animation state is read from the page; a window behind other apps must keep its frames.
  created.webContents.setBackgroundThrottling(false);
  if (win) return;
  win = created;
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const wait = async (code) => {
    for (let attempt = 0; attempt < 300; attempt++) {
      if (await js(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error('UI did not reach: ' + code);
  };
  const click = (label) =>
    js(
      `(()=>{const b=[...document.querySelectorAll('button')].find(b=>(b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)})&&!b.disabled);if(!b)throw new Error('Missing button '+${JSON.stringify(label)});b.click()})()`,
    );
  const change = (label, value, kind = 'select') =>
    js(
      `(()=>{const e=document.querySelector('[aria-label=${JSON.stringify(label)}]');if(!e)throw new Error('Missing control');Object.getOwnPropertyDescriptor(${kind === 'textarea' ? 'HTMLTextAreaElement' : 'HTMLSelectElement'}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('${kind === 'textarea' ? 'input' : 'change'}',{bubbles:true}));})()`,
    );
  const state = () => js('window.mori.load().then(r=>r.state)');
  const tasks = () => js(`window.mori.listPetJobs(${JSON.stringify(character.id)})`);
  const bases = (id) => js(`window.mori.petJobMasters(${JSON.stringify(id)})`);
  const idle = () =>
    wait(
      `!document.querySelector('[aria-label="添加画风参考图"]:disabled')&&!document.querySelector('[aria-label="更换画风参考图"]:disabled')&&!document.querySelector('.production-step.working')&&!document.querySelector('.pet-production .progress-card')`,
    );
  const draftImage = () => js(`document.querySelector('[aria-label="画风参考（选填）"] summary img')?.src`);
  const taskImage = () =>
    js(`document.querySelector('[aria-label="本任务使用的画风参考"] summary img')?.src`);
  const open = async () => {
    await click('Demiurge 首页');
    await click('角色工作室');
    await click('外观与动作');
    await click('自动制作多画风桌宠');
    // These tests cover the standard flow; sharp quality (the default) has its own test.
    await js(
      `new Promise((done)=>{const start=Date.now();const pick=()=>{const e=document.querySelector('[aria-label="动作清晰度"]');if(!e){if(Date.now()-start<3000)return setTimeout(pick,30);return done(false)}if(e.value!=='standard'){Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'standard');e.dispatchEvent(new Event('change',{bubbles:true}))}done(true)};pick()})`,
    );
    await wait(`!!document.querySelector('[aria-label="添加画风参考图"]')`);
  };
  // Another task: back to 我的桌宠, then open it from the list.
  const selectTask = async (needle) => {
    await js(`document.querySelector('.production-back')?.click(); true`);
    await wait(`!!document.querySelector('.production-task-row')`);
    await js(
      `(()=>{const b=[...document.querySelectorAll('.production-task-row')].find(b=>b.textContent.includes(${JSON.stringify(needle)}));if(!b)throw new Error('Missing task');b.click()})()`,
    );
  };
  const capture = async (name) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    fs.writeFileSync(path.join(dir, name), (await win.webContents.capturePage()).toPNG());
  };
  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(`!!document.querySelector('.room-rail')`);
      const initial = await state();
      await open();
      assert.equal(await js(`document.querySelector('[aria-label="开始自动制作桌宠"]').disabled`), true);
      await click('添加画风参考图');
      await idle();
      assert.equal(await draftImage(), fixture.url(guideA));
      assert.equal(calls.length, 0);
      cancelImport = true;
      await click('更换画风参考图');
      await idle();
      cancelImport = false;
      assert.equal(await draftImage(), fixture.url(guideA));
      await click('移除画风参考图');
      assert.equal(await draftImage(), undefined);
      await click('添加画风参考图');
      await idle();
      assert.deepEqual((await state()).characters, initial.characters);
      await js(
        `window.mori.load().then(r=>window.mori.saveSettings({...r.state.settings,imageModel:'style-fixture'},{imageKey:'isolated-style-key',llmKey:'${planner.llmKey}'}))`,
      );
      for (const motion of motions) {
        const pressed = await js(
          `document.querySelector('[aria-label=${JSON.stringify('制作动作：' + motion.name)}]').getAttribute('aria-pressed')==='true'`,
        );
        if (pressed !== (motion.id === 'wave')) await click('制作动作：' + motion.name);
      }
      await change('桌宠制作基准', source.id);
      assert.equal(await js(`document.querySelector('[aria-label="更换画风参考图"]').disabled`), true);
      assert.equal(await js(`document.querySelector('[aria-label="移除画风参考图"]').disabled`), true);
      assert.match(
        await js(`document.querySelector('[aria-label="画风参考（选填）"]').textContent`),
        /本次补动作不使用/,
      );
      await click('开始自动制作桌宠');
      await wait(`!!document.querySelector('.production-review')`);
      await wait(
        `!document.querySelector('.production-step.working')&&!document.querySelector('.pet-production .progress-card')`,
      );
      assert.equal(calls.length, 1);
      assert.equal((await tasks())[0].styleReference, undefined);
      await change('桌宠制作基准', '');
      await idle();
      await click('桌宠画风：3D');
      await click('桌宠画风：原作');
      assert.equal(await js(`document.querySelector('[aria-label="开始自动制作桌宠"]').disabled`), true);
      assert.match(
        await js(`document.querySelector('[aria-label="画风参考适用范围"]').textContent`),
        /移除画风参考/,
      );
      await click('桌宠画风：3D');
      await click('开始自动制作桌宠');
      await wait(
        `document.querySelector('.production-tabs small')?.textContent==='2'&&document.querySelectorAll('[aria-label="角色基准预览"]>.production-base-grid>figure').length===1`,
      );
      await idle();
      const mixed = (await tasks()).find((task) => task.styles.length === 2);
      assert.ok(mixed.styleReference);
      assert.equal(mixed.styleReference.digest, imageDigest(fixture.url(guideA)));
      assert.equal(await taskImage(), fixture.url(guideA));
      assert.equal(calls.length, 2);
      assert.equal((await bases(mixed.id))[0].generation.styleReference, undefined);
      await click('继续自动制作');
      await wait(
        `document.querySelectorAll('[aria-label="角色基准预览"]>.production-base-grid>figure').length===2`,
      );
      await idle();
      assert.equal(calls.length, 4);
      const beforeEdit = (await bases(mixed.id)).find((skin) => skin.style === '3d');
      assert.equal(beforeEdit.generation.styleReference.digest, mixed.styleReference.digest);
      importFile = guideBFile;
      await click('更换画风参考图');
      await idle();
      assert.equal(await draftImage(), fixture.url(guideB));
      assert.equal(await taskImage(), fixture.url(guideA));
      await js(
        `document.querySelector('[aria-label="本任务使用的画风参考"]').scrollIntoView({block:'center',behavior:'instant'})`,
      );
      await capture('task-style-reference.png');
      await click('修正3D候选 1');
      await change('角色候选修正要求', '轮廓更清楚，沿用本任务画风。', 'textarea');
      await click('生成角色候选修正版');
      await wait(
        `document.querySelectorAll('[aria-label="角色基准预览"]>.production-base-grid>figure').length===3`,
      );
      await idle();
      assert.equal(calls.length, 5);
      assert.equal(await taskImage(), fixture.url(guideA));
      const corrected = (await bases(mixed.id)).find(
        (skin) => skin.generation.parentSkinId === beforeEdit.id,
      );
      assert.equal(corrected.generation.styleReference.digest, mixed.styleReference.digest);
      assert.equal(await js(`document.querySelector('[aria-label="候选预览高度"]').value`), 'fit');
      for (const height of [96, 160, 240]) {
        await change('候选预览高度', String(height));
        await wait(`document.querySelector('.artwork-inspection-grid').dataset.preview==='small'`);
        const dimensions = await js(
          `[...document.querySelectorAll('.artwork-inspection-viewport img')].map(img=>({height:img.getBoundingClientRect().height,width:img.getBoundingClientRect().width,ratio:img.naturalWidth/img.naturalHeight}))`,
        );
        assert.equal(dimensions.length, 2);
        for (const image of dimensions) {
          assert.equal(image.height, height);
          assert.ok(Math.abs(image.width / image.height - image.ratio) < 0.02);
        }
        assert.equal(calls.length, 5);
        assert.equal((await tasks()).find((task) => task.id === mixed.id).awaitingSelection, '3d');
      }
      await change('候选预览高度', '160');
      await click('深色');
      win.setSize(900, 820);
      await js(
        `document.querySelector('[aria-label="角色候选放大核对"]').scrollIntoView({block:'center',behavior:'instant'})`,
      );
      await capture('small-size-old-new.png');
      assert.equal(
        await js(
          `document.querySelector('.modal').scrollWidth<=document.querySelector('.modal').clientWidth+2`,
        ),
        true,
      );
      await click('选择3D候选 2 并继续');
      await wait(`!!document.querySelector('.production-review')`);
      await idle();
      assert.equal(calls.length, 6);
      await click('桌宠画风：原作');
      await click('桌宠画风：3D');
      await click('桌宠画风：8bit');
      expectedGuide = guideB;
      await click('开始自动制作桌宠');
      await wait(
        `document.querySelector('.production-tabs small')?.textContent==='3'&&document.querySelectorAll('[aria-label="角色基准预览"]>.production-base-grid>figure').length===1`,
      );
      await idle();
      assert.equal(calls.length, 7);
      assert.equal(await taskImage(), fixture.url(guideB));
      delayedGuideJob = mixed.id;
      await selectTask('原作');
      for (let attempt = 0; attempt < 100 && !releaseGuide; attempt++)
        await new Promise((resolve) => setTimeout(resolve, 20));
      assert.ok(releaseGuide);
      await selectTask('8bit');
      await wait(
        `document.querySelector('[aria-label="本任务使用的画风参考"] summary img')?.src===${JSON.stringify(fixture.url(guideB))}`,
      );
      releaseGuide();
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(await taskImage(), fixture.url(guideB));
      assert.match(
        await js(
          `document.querySelector('[aria-label="桌宠制作任务"] .production-section-heading small').textContent`,
        ),
        /8bit/,
      );
      const loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
      win.webContents.reload();
      await loaded;
      await wait(`!!document.querySelector('.room-rail')`);
      await open();
      await wait(`!!document.querySelector('[aria-label="本任务使用的画风参考"] summary img')`);
      assert.equal(await draftImage(), undefined, 'A new modal has no draft guide');
      assert.equal(await taskImage(), fixture.url(guideB));
      await selectTask('原作');
      await wait(
        `document.querySelector('[aria-label="本任务使用的画风参考"] summary img')?.src===${JSON.stringify(fixture.url(guideA))}`,
      );
      assert.equal(calls.length, 7);
      const final = await state();
      assert.deepEqual(final.characters, initial.characters);
      assert.deepEqual(final.messages, initial.messages);
      assert.deepEqual(final.memories, initial.memories);
      assert.equal(final.activeSkinId, '');
      fs.writeFileSync(
        path.join(dir, 'checks.json'),
        JSON.stringify(
          {
            passed: true,
            paidRequests: 0,
            imageFixtureRequests: calls.length,
            imports,
            localImportWithoutConfiguration: true,
            cancelledImportPreservesDraft: true,
            draftRemoval: true,
            identityReferencesUnchanged: true,
            originalOnlyGuideBlocked: true,
            mixedOriginalOmitsGuide: true,
            sourceMasterOmitsGuide: true,
            guideInputBytesVerified: true,
            taskGuideSurvivesDraftReplacement: true,
            correctionsInheritTaskGuide: true,
            sheetsOnlyUseMasterAndIdentity: true,
            staleTaskLookupDiscarded: true,
            reloadRestoresSavedGuides: true,
            previewHeightsCssPx: [96, 160, 240],
            previewAspectPreserved: true,
            previewRequests: 0,
            oldNewComparison: true,
            horizontalOverflow: false,
            noAutoActivation: true,
            historyPreserved: true,
            calls,
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
