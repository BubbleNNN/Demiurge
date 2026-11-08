'use strict';
// Real Electron candidate-edit controls, IPC and local files. Fixed PNG responses
// exercise behavior without calling a paid image service or certifying art quality.
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fixture = require('../tests/fixtures/pet-images.cjs');
const catalogue = require('../shared/pet-motions.json');
const dir = path.resolve(__dirname, '../.local/pet-base-edit-desktop-' + randomUUID());
fs.mkdirSync(dir, { recursive: true });
process.env.MORI_DATA_DIR = dir;
delete process.env.MORI_DEV_URL;
safeStorage.isEncryptionAvailable = () => false;
const originalBytes = fs.readFileSync(path.resolve(__dirname, '../public/art/cyrene-chibi.png'));
const timestamp = new Date().toISOString();
const character = {
  id: 'base-edit-test',
  name: '候选修正测试',
  work: '隔离验收',
  summary: 'Preserve original character',
  personality: ['温和'],
  speakingStyle: '',
  appearance: '',
  quotes: [],
  sources: [],
  unknowns: [],
  behavior: { energy: 50, affection: 50, curiosity: 50 },
  createdAt: timestamp,
  visualReferences: [
    { id: 'original', name: '角色参考原图', image: fixture.url(originalBytes), createdAt: timestamp },
  ],
};
fs.writeFileSync(
  path.join(dir, 'state.json'),
  JSON.stringify({
    settings: {
      llmBaseUrl: 'https://never-call.example/v1',
      llmModel: '',
      chatMode: 'local',
      imageBaseUrl: 'https://base-edit.mori.example/v1',
      searchProvider: 'wiki',
      imageModel: '',
      demoMode: false,
      proactiveEnabled: false,
      motionEnabled: true,
      voiceEnabled: false,
    },
    characters: [character],
    skins: [],
    activeCharacterId: character.id,
    activeSkinId: '',
    messages: {
      [character.id]: [
        { id: 'old-message', role: 'user', content: 'Preserve conversation', createdAt: timestamp },
      ],
    },
    memories: [
      { id: 'old-memory', characterId: character.id, text: 'Preserve memory', createdAt: timestamp },
    ],
  }),
);
function tinted(sheet, number) {
  const image = fixture.decode(fixture.image(sheet));
  for (let i = 0; i < image.bitmap.length; i += 4)
    if (image.bitmap[i + 3]) image.bitmap[i] = (image.bitmap[i] + number * 19) % 255;
  return fixture.encode(image.bitmap, image.width, image.height);
}
const bytesOf = (skin) => Buffer.from(skin.images.neutral.split(',')[1], 'base64');
const calls = [];
let expectedEditSource,
  expectedActionMaster,
  holdEdit = false,
  releaseEdit,
  failNextEditSave = false,
  credentialsUnavailable = false,
  rejectedCredentialReads = 0;
const originalRename = fs.promises.rename;
fs.promises.rename = async (source, target) => {
  if (
    failNextEditSave &&
    String(target).startsWith(dir + path.sep) &&
    /\.edit-[a-f0-9-]+\.asset\.json$/.test(String(target))
  ) {
    failNextEditSave = false;
    throw Object.assign(new Error('Injected candidate save EIO'), { code: 'EIO' });
  }
  return originalRename(source, target);
};
const storeModule = require('../electron/store.cjs');
const originalCreateStore = storeModule.createStore;
storeModule.createStore = (options) => {
  const store = originalCreateStore(options);
  const getCredentials = store.getCredentials;
  store.getCredentials = async () => {
    if (credentialsUnavailable) {
      rejectedCredentialReads += 1;
      throw new Error('Injected unavailable keychain');
    }
    return getCredentials();
  };
  return store;
};
const wikiSearches = [];
const furina = fs.readFileSync(path.resolve(__dirname, '../public/art/chibi-fallback-furina.png'));
global.fetch = async (url, init) => {
  if (String(url).startsWith('https://zh.wikipedia.org/w/api.php')) {
    // The chibi look first looks for an existing design; this isolated wiki has none.
    wikiSearches.push(new URL(url).searchParams.get('gsrsearch'));
    return new Response(JSON.stringify({ batchcomplete: '', query: { pages: {} } }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
  assert.equal(url, 'https://base-edit.mori.example/v1/images/edits');
  assert.equal(init.headers.Authorization, 'Bearer isolated-base-edit-key');
  const form = init.body,
    prompt = String(form.get('prompt'));
  const kind = prompt.includes('regular 2-by-2 grid')
    ? 'sheet'
    : prompt.includes('Requested correction:')
      ? 'edit'
      : 'base';
  const images = form.getAll('image[]').length ? form.getAll('image[]') : [form.get('image')];
  // A chibi base carries the Furina sticker last, as a style guide only.
  assert.deepEqual(
    Buffer.from(await images[kind === 'base' ? 0 : images.length - 1].arrayBuffer()),
    originalBytes,
  );
  assert.equal(images.length, 2);
  if (kind === 'base') assert.deepEqual(Buffer.from(await images[1].arrayBuffer()), furina);
  if (kind === 'edit')
    assert.deepEqual(
      Buffer.from(await images[0].arrayBuffer()),
      expectedEditSource,
      'Edit uses the exact selected candidate',
    );
  if (kind === 'sheet')
    assert.deepEqual(
      Buffer.from(await images[0].arrayBuffer()),
      expectedActionMaster,
      'Actions use the explicitly chosen corrected candidate',
    );
  calls.push({ kind, prompt });
  const bytes = tinted(kind === 'sheet', calls.length);
  if (kind === 'edit' && holdEdit) {
    holdEdit = false;
    await new Promise((resolve) => {
      releaseEdit = resolve;
    });
  }
  return new Response(JSON.stringify({ data: [{ b64_json: bytes.toString('base64') }] }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
let win,
  finished = false;
const deadline = setTimeout(() => finish(new Error('Native candidate-edit test timed out')), 90000);
async function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  if (error) {
    console.error(error.stack);
    if (win && !win.isDestroyed()) {
      console.error((await win.webContents.executeJavaScript('document.body.innerText')).slice(-10000));
      fs.writeFileSync(path.join(dir, 'failure.png'), (await win.webContents.capturePage()).toPNG());
    }
  } else
    console.log(
      'PASS: native single/multiple candidate edits, one request per edit, original bytes retained, forced selection checkpoint, old/new magnification, local save recovery without credentials, reload and explicit action source. Fixed responses only.',
    );
  console.log('Artifacts: ' + dir);
  app.exit(error ? 1 : 0);
}
app.on('browser-window-created', (_event, created) => {
  // Animation state is read from the page; a window behind other apps must keep its frames.
  created.webContents.setBackgroundThrottling(false);
  if (win) return;
  win = created;
  const js = async (code) => {
    try {
      return await win.webContents.executeJavaScript(code, true);
    } catch (error) {
      throw new Error('Renderer action failed: ' + code + '\n' + error.message);
    }
  };
  const wait = async (code) => {
    for (let n = 0; n < 250; n++) {
      if (await js(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('UI did not reach: ' + code);
  };
  const click = (label) =>
    js(
      `(()=>{const button=[...document.querySelectorAll('button')].find(b=>(b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)})&&!b.disabled);if(!button)throw new Error('Missing button '+${JSON.stringify(label)});button.click()})()`,
    );
  const change = (label, value, kind = 'select') =>
    js(
      `(()=>{const e=document.querySelector('[aria-label=${JSON.stringify(label)}]');if(!e)throw new Error('Missing control');Object.getOwnPropertyDescriptor(${kind === 'textarea' ? 'HTMLTextAreaElement' : kind === 'range' ? 'HTMLInputElement' : 'HTMLSelectElement'}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('${kind === 'select' ? 'change' : 'input'}',{bubbles:true}));})()`,
    );
  const open = async () => {
    await click('Mori 首页');
    await click('角色工作室');
    await click('外观与动作');
    await click('自动制作多画风桌宠');
    // These tests cover the standard flow; sharp quality (the default) has its own test.
    await js(
      `new Promise((done)=>{const start=Date.now();const pick=()=>{const e=document.querySelector('[aria-label="动作清晰度"]');if(!e){if(Date.now()-start<3000)return setTimeout(pick,30);return done(false)}if(e.value!=='standard'){Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'standard');e.dispatchEvent(new Event('change',{bubbles:true}))}done(true)};pick()})`,
    );
    await wait(`!!document.querySelector('[aria-label="角色候选数量"]')`);
  };
  const reload = async () => {
    const loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
    win.webContents.reload();
    await loaded;
    await wait(`!!document.querySelector('.room-rail')`);
    await open();
  };
  const onlyWaveAndTalk = async () => {
    for (const motion of catalogue) {
      const selected = await js(
        `document.querySelector('[aria-label=${JSON.stringify('制作动作：' + motion.name)}]').getAttribute('aria-pressed')==='true'`,
      );
      if (selected !== ['wave', 'talk'].includes(motion.id)) await click('制作动作：' + motion.name);
    }
  };
  const idle = () =>
    wait(
      `!document.querySelector('[aria-label="开始自动制作桌宠"]').disabled&&!document.querySelector('.production-step.working')&&!document.querySelector('.pet-production .progress-card')`,
    );
  const tasks = () => js(`window.mori.listPetJobs('base-edit-test')`);
  const bases = (id) => js(`window.mori.petJobMasters(${JSON.stringify(id)})`);
  const state = () => js('window.mori.load().then(result=>result.state)');
  const capture = async (name) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    fs.writeFileSync(path.join(dir, name), (await win.webContents.capturePage()).toPNG());
  };
  function assertAwaiting(job, originalStepCount) {
    assert.equal(job.awaitingSelection, 'chibi-pet');
    assert.equal(job.steps.length, originalStepCount, 'Candidate edits must not alter original step indices');
    assert.ok(job.steps.filter((step) => step.kind !== 'base').every((step) => step.status === 'queued'));
    assert.equal(job.results.length, 0);
    assert.equal(job.baseEdits.at(-1).status, 'done');
  }
  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(`!!document.querySelector('.room-rail')`);
      await js(
        `window.mori.load().then(r=>window.mori.saveSettings({...r.state.settings,imageModel:'base-edit-fixture'},{imageKey:'isolated-base-edit-key'}))`,
      );
      const initial = await state();
      await open();
      await onlyWaveAndTalk();
      await click('开始自动制作桌宠');
      await wait(
        `document.querySelectorAll('[aria-label="角色基准预览"]>.production-base-grid>figure').length===1`,
      );
      await idle();
      assert.equal(calls.length, 1);
      let firstJob = (await tasks())[0];
      const firstStepCount = firstJob.steps.length;
      const original = (await bases(firstJob.id))[0];
      expectedEditSource = bytesOf(original);
      await click('放大核对Q版候选 1');
      await wait(`!!document.querySelector('[aria-label="角色参考原图放大视图"]')`);
      await click('修正Q版候选 1');
      assert.equal(await js(`document.querySelector('[aria-label="角色候选修正要求"]').maxLength`), 600);
      assert.equal(await js(`document.querySelector('[aria-label="生成角色候选修正版"]').disabled`), true);
      await change('角色候选修正要求', '   ', 'textarea');
      assert.equal(await js(`document.querySelector('[aria-label="生成角色候选修正版"]').disabled`), true);
      await change('角色候选修正要求', '眼睛更清楚，保留衣服与发饰。', 'textarea');
      assert.match(
        await js(`document.querySelector('[aria-label="修正角色候选"]').textContent`),
        /预计 1 次图像编辑请求/,
      );
      holdEdit = true;
      await click('生成角色候选修正版');
      for (let n = 0; n < 100 && !releaseEdit; n++) await new Promise((resolve) => setTimeout(resolve, 20));
      assert.ok(releaseEdit);
      assert.equal(await js(`document.querySelector('[aria-label="生成角色候选修正版"]').disabled`), true);
      await js(`document.querySelector('[aria-label="生成角色候选修正版"]').click()`);
      assert.equal(calls.length, 2, 'A busy duplicate click must not send a second edit');
      releaseEdit();
      await wait(
        `document.querySelectorAll('[aria-label="角色基准预览"]>.production-base-grid>figure').length===2`,
      );
      await idle();
      assert.equal(calls.length, 2, 'Editing a single candidate must not start actions');
      firstJob = (await tasks())[0];
      assertAwaiting(firstJob, firstStepCount);
      const firstBases = await bases(firstJob.id),
        corrected = firstBases.find((skin) => skin.id !== original.id);
      assert.deepEqual(
        firstBases.find((skin) => skin.id === original.id),
        original,
      );
      assert.equal(corrected.generation.parentSkinId, original.id);
      assert.match(calls[1].prompt, /眼睛更清楚/);
      await wait(`!!document.querySelector('[aria-label="修正前的角色候选放大视图"]')`);
      assert.equal(
        await js(`document.querySelector('[aria-label="修正前的角色候选放大视图"] img').src`),
        original.images.neutral,
      );
      assert.equal(
        await js(`document.querySelector('[aria-label="当前查看的角色候选放大视图"] img').src`),
        corrected.images.neutral,
      );
      await change('候选放大比例', '2', 'range');
      await click('深色');
      await wait(
        `document.querySelector('.artwork-inspection output').textContent==='200%'&&document.querySelector('.artwork-inspection-grid').dataset.background==='dark'`,
      );
      await change('查看角色候选', original.id);
      await wait(`!!document.querySelector('[aria-label="角色参考原图放大视图"]')`);
      await change('查看角色候选', corrected.id);
      await wait(`!!document.querySelector('[aria-label="修正前的角色候选放大视图"]')`);
      assert.equal(calls.length, 2);
      assert.equal((await tasks())[0].awaitingSelection, 'chibi-pet');
      assert.equal((await state()).skins.length, 0);
      await js(
        `document.querySelector('[aria-label="角色候选放大核对"]').scrollIntoView({block:'center',behavior:'instant'})`,
      );
      await capture('single-candidate-before-after.png');
      win.setSize(900, 800);
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(
        await js(
          `document.querySelector('.modal').scrollWidth<=document.querySelector('.modal').clientWidth+2`,
        ),
        true,
      );
      await reload();
      await wait(
        `document.querySelectorAll('[aria-label="角色基准预览"]>.production-base-grid>figure').length===2`,
      );
      assert.equal(calls.length, 2);
      expectedActionMaster = bytesOf(corrected);
      await click('选择Q版候选 2 并继续');
      await wait(`!!document.querySelector('.production-review')`);
      await idle();
      assert.equal(calls.length, 4);
      assert.equal((await tasks())[0].status, 'ready');
      assert.equal(await js(`document.querySelectorAll('button[aria-label="修正Q版候选 1"]').length`), 0);

      await change('角色候选数量', '2');
      await onlyWaveAndTalk();
      await js(`document.querySelector('[aria-label="角色图完成后暂停"]').click()`);
      assert.equal(await js(`document.querySelector('[aria-label="角色图完成后暂停"]').checked`), false);
      await click('开始自动制作桌宠');
      await wait(
        `document.querySelectorAll('.production-job-tabs button').length===2&&document.querySelectorAll('[aria-label="角色基准预览"]>.production-base-grid>figure').length===2`,
      );
      await idle();
      assert.equal(calls.length, 6);
      let secondJob = (await tasks()).find((job) => job.id !== firstJob.id);
      const secondStepCount = secondJob.steps.length,
        originalPair = await bases(secondJob.id);
      expectedEditSource = bytesOf(originalPair[1]);
      await click('修正Q版候选 2');
      await change('角色候选修正要求', '手指完整，发饰边缘更干净。', 'textarea');
      failNextEditSave = true;
      await click('生成角色候选修正版');
      await wait(`!!document.querySelector('[aria-label="恢复Q版候选修正保存"]')`);
      await idle();
      assert.equal(failNextEditSave, false, 'The injected failure must reach the generated edit asset');
      assert.equal(calls.length, 7);
      assert.equal((await bases(secondJob.id)).length, 2);
      const unsaved = (await tasks()).find((job) => job.id === secondJob.id);
      assert.equal(unsaved.baseEdits.at(-1).status, 'unsaved');
      assert.equal(unsaved.awaitingSelection, 'chibi-pet');
      assert.ok(
        unsaved.steps.filter((step) => step.kind !== 'base').every((step) => step.status === 'queued'),
      );
      assert.equal(await js(`document.querySelector('[aria-label="修正Q版候选 1"]').disabled`), true);
      await js(`window.mori.load().then(r=>window.mori.saveSettings(r.state.settings,{imageKey:''}))`);
      await wait(`document.querySelector('[aria-label="开始自动制作桌宠"]').disabled`);
      credentialsUnavailable = true;
      assert.equal(await js(`document.querySelector('[aria-label="恢复Q版候选修正保存"]').disabled`), false);
      await click('恢复Q版候选修正保存');
      await wait(
        `document.querySelectorAll('[aria-label="角色基准预览"]>.production-base-grid>figure').length===3`,
      );
      assert.equal(
        rejectedCredentialReads,
        0,
        'Local recovery must never attempt to load unavailable credentials',
      );
      assert.equal(calls.length, 7, 'Recovering generated pixels must not send a new image request');
      credentialsUnavailable = false;
      await js(
        `window.mori.load().then(r=>window.mori.saveSettings(r.state.settings,{imageKey:'isolated-base-edit-key'}))`,
      );
      await idle();
      assert.equal(
        calls.length,
        7,
        'Editing with ordinary base pauses disabled must still stop for selection',
      );
      secondJob = (await tasks()).find((job) => job.id === secondJob.id);
      assertAwaiting(secondJob, secondStepCount);
      const secondBases = await bases(secondJob.id),
        secondCorrected = secondBases.find((skin) => !originalPair.some((old) => old.id === skin.id));
      for (const old of originalPair)
        assert.deepEqual(
          secondBases.find((skin) => skin.id === old.id),
          old,
        );
      assert.equal(secondCorrected.generation.parentSkinId, originalPair[1].id);
      assert.equal(
        await js(`document.querySelector('[aria-label="修正前的角色候选放大视图"] img').src`),
        originalPair[1].images.neutral,
      );
      await js(
        `document.querySelector('[aria-label="角色候选放大核对"]').scrollIntoView({block:'center',behavior:'instant'})`,
      );
      await capture('multiple-candidates-before-after.png');
      assert.equal(
        await js(
          `document.querySelector('.modal').scrollWidth<=document.querySelector('.modal').clientWidth+2`,
        ),
        true,
      );
      await reload();
      await wait(
        `document.querySelectorAll('[aria-label="角色基准预览"]>.production-base-grid>figure').length===3`,
      );
      assert.equal(calls.length, 7);
      expectedActionMaster = bytesOf(secondCorrected);
      await click('选择Q版候选 3 并继续');
      await wait(`!!document.querySelector('.production-review')`);
      await idle();
      assert.equal(calls.length, 9);
      assert.equal(calls.filter((call) => call.kind === 'edit').length, 2);
      const final = await state();
      assert.deepEqual(final.characters, initial.characters);
      assert.deepEqual(final.messages, initial.messages);
      assert.deepEqual(final.memories, initial.memories);
      assert.equal(final.activeSkinId, '');
      assert.equal(final.skins.length, 2);
      assert.ok(final.skins.every((skin) => skin.review.status === 'pending'));
      fs.writeFileSync(
        path.join(dir, 'checks.json'),
        JSON.stringify(
          {
            passed: true,
            paidRequests: 0,
            imageFixtureRequests: calls.length,
            candidateEdits: 2,
            requestsPerEdit: 1,
            singleCandidate: true,
            multipleCandidates: true,
            disabledPauseStillStops: true,
            editedSourceBytesVerified: true,
            correctedActionBytesVerified: true,
            originalCandidatesPreserved: true,
            originalStepIndicesPreserved: true,
            oldNewMagnification: true,
            inspectionChangesDoNotSelect: true,
            busyDuplicatePrevented: true,
            diskFailurePreservesOriginalCandidates: true,
            unsavedRecoveryWithoutCredentials: true,
            unsavedRecoveryImageRequests: 0,
            unsavedRecoveryCredentialReads: rejectedCredentialReads,
            reloadRequiresExplicitSelection: true,
            noAutoActivation: true,
            historyPreserved: true,
            horizontalOverflow: false,
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
