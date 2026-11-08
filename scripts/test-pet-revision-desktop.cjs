'use strict';
// Corrections go to a chat model and a search before the image model; this stands in for the chat model.
const planner = require('./lib/revision-planner-fixture.cjs');
// Real Electron UI/IPC and disk persistence with isolated fixed image responses.
// These checks validate production behavior, not the quality of generated artwork.
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fixture = require('../tests/fixtures/pet-images.cjs');
const dir = path.resolve(__dirname, '../.local/pet-revision-desktop-' + randomUUID());
fs.mkdirSync(dir, { recursive: true });
process.env.MORI_DATA_DIR = dir;
delete process.env.MORI_DEV_URL;
safeStorage.isEncryptionAvailable = () => false;
const originalBytes = fs.readFileSync(path.resolve(__dirname, '../public/art/cyrene-chibi.png'));
const stamp = new Date().toISOString();
const character = {
  id: 'revision-desktop',
  name: '桌宠修正测试',
  work: '隔离测试',
  summary: 'Keep the original dossier',
  personality: ['温和'],
  speakingStyle: '',
  appearance: '',
  quotes: [],
  sources: [],
  unknowns: [],
  behavior: { energy: 50, affection: 50, curiosity: 50 },
  createdAt: stamp,
  visualReferences: [
    { id: 'original', name: '角色原图', image: fixture.url(originalBytes), createdAt: stamp },
  ],
};
fs.writeFileSync(
  path.join(dir, 'state.json'),
  JSON.stringify({
    settings: {
      llmBaseUrl: planner.llmBaseUrl,
      llmModel: planner.llmModel,
      imageBaseUrl: 'https://revision.mori.example/v1',
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
      [character.id]: [
        { id: 'old-message', role: 'user', content: 'Keep my conversation', createdAt: stamp },
      ],
    },
    memories: [{ id: 'old-memory', characterId: character.id, text: 'Keep this memory', createdAt: stamp }],
  }),
);
function tinted(sheet, number) {
  const data = fixture.decode(fixture.image(sheet));
  for (let i = 0; i < data.bitmap.length; i += 4)
    if (data.bitmap[i + 3]) data.bitmap[i] = (data.bitmap[i] + 17 * number) % 255;
  return fixture.encode(data.bitmap, data.width, data.height);
}
const masters = [tinted(false, 1), tinted(false, 2)],
  calls = [];
const wikiSearches = [];
const furina = fs.readFileSync(path.resolve(__dirname, '../public/art/chibi-fallback-furina.png'));
global.fetch = async (url, init) => {
  const planned = await planner.handle(url, init);
  if (planned) return planned;
  if (String(url).startsWith('https://zh.wikipedia.org/w/api.php')) {
    // The chibi look first looks for an existing design; this isolated wiki has none.
    wikiSearches.push(new URL(url).searchParams.get('gsrsearch'));
    return new Response(JSON.stringify({ batchcomplete: '', query: { pages: {} } }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
  assert.equal(url, 'https://revision.mori.example/v1/images/edits');
  assert.equal(init.headers.Authorization, 'Bearer isolated-revision-key');
  const form = init.body,
    prompt = String(form.get('prompt'));
  const isSheet = prompt.includes('regular 2-by-2 grid');
  const images = form.getAll('image[]').length ? form.getAll('image[]') : [form.get('image')];
  // A chibi base carries the Furina sticker last, as a style guide only.
  assert.deepEqual(Buffer.from(await images[isSheet ? 1 : 0].arrayBuffer()), originalBytes);
  assert.equal(images.length, 2);
  if (!isSheet) assert.deepEqual(Buffer.from(await images[1].arrayBuffer()), furina);
  if (isSheet)
    assert.deepEqual(
      Buffer.from(await images[0].arrayBuffer()),
      masters[1],
      'Every action must use the second selected candidate',
    );
  const candidate = /Independent candidate (\d+)/.exec(prompt)?.[1];
  if (!isSheet) assert.ok(candidate === '1' || candidate === '2');
  calls.push({ isSheet, prompt, candidate });
  const bytes = isSheet ? tinted(true, calls.length) : masters[Number(candidate) - 1];
  return new Response(JSON.stringify({ data: [{ b64_json: bytes.toString('base64') }] }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
let win,
  finished = false;
const deadline = setTimeout(() => finish(new Error('Native revision test timed out')), 90000);
async function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  if (error) {
    console.error(error.stack);
    if (win && !win.isDestroyed()) {
      console.error((await win.webContents.executeJavaScript('document.body.innerText')).slice(-8000));
      fs.writeFileSync(path.join(dir, 'failure.png'), (await win.webContents.capturePage()).toPNG());
    }
  } else
    console.log(
      'PASS: native candidate comparison, persisted selection, second-master bytes, single-action revision, preserved history and pending new output. No paid requests; fixtures only.',
    );
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
    for (let n = 0; n < 250; n++) {
      if (await js(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('UI did not reach: ' + code);
  };
  const click = (label) =>
    js(
      `(()=>{const b=[...document.querySelectorAll('button')].find(b=>(b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)})&&!b.disabled);if(!b)throw new Error('Missing button '+${JSON.stringify(label)});b.click()})()`,
    );
  const change = (label, value, textarea = false) =>
    js(
      `(()=>{const e=document.querySelector('[aria-label=${JSON.stringify(label)}]');if(!e)throw new Error('Missing control');Object.getOwnPropertyDescriptor(${textarea ? 'HTMLTextAreaElement' : 'HTMLSelectElement'}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('${textarea ? 'input' : 'change'}',{bubbles:true}));})()`,
    );
  const open = async () => {
    await click('Demiurge 首页');
    await click('角色工作室');
    await click('外观与动作');
    await click('自动制作多画风桌宠');
    // These tests cover the standard flow; sharp quality (the default) has its own test.
    await js(
      `new Promise((done)=>{const start=Date.now();const pick=()=>{const e=document.querySelector('[aria-label="动作清晰度"]');if(!e){if(Date.now()-start<3000)return setTimeout(pick,30);return done(false)}if(e.value!=='standard'){Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'standard');e.dispatchEvent(new Event('change',{bubbles:true}))}done(true)};pick()})`,
    );
    await wait(`!!document.querySelector('[aria-label="角色候选数量"]')`);
  };
  const idle = () =>
    wait(
      `!document.querySelector('.production-step.working')&&!document.querySelector('.pet-production .progress-card')&&!document.querySelector('[aria-label="开始自动制作桌宠"]').disabled`,
    );
  const capture = async (file) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    fs.writeFileSync(path.join(dir, file), (await win.webContents.capturePage()).toPNG());
  };
  const state = () => js('window.mori.load().then(result=>result.state)');
  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(`!!document.querySelector('.room-rail')`);
      await js(
        `window.mori.load().then(result=>window.mori.saveSettings({...result.state.settings,imageModel:'revision-fixture'},{imageKey:'isolated-revision-key',llmKey:'${planner.llmKey}'}))`,
      );
      const before = await state();
      await open();
      await change('角色候选数量', '2');
      // Labels come from the shared catalogue; keep only the initially selected wave/talk.
      const motionNames = require('../shared/pet-motions.json')
        .filter((m) => !['wave', 'talk'].includes(m.id))
        .map((m) => m.name);
      for (const name of motionNames) await click('制作动作：' + name);
      assert.match(await js(`document.querySelector('.production-start').textContent`), /预计 4 次图像请求/);
      await click('开始自动制作桌宠');
      await wait(`document.querySelectorAll('[aria-label="角色基准预览"] img').length===2`);
      await idle();
      assert.equal(calls.length, 2, 'Candidate comparison must stop before action requests');
      assert.equal(
        await js(
          `[...document.querySelectorAll('.production-task-actions button')].some(b=>b.textContent.includes('继续自动制作'))`,
        ),
        false,
      );
      let jobs = await js(`window.mori.listPetJobs('revision-desktop')`);
      const originalJobId = jobs[0].id;
      const candidates = await js(`window.mori.petJobMasters(${JSON.stringify(originalJobId)})`);
      assert.notEqual(candidates[0].images.neutral, candidates[1].images.neutral);
      await click('放大核对Q版候选 2');
      await wait(`!!document.querySelector('[aria-label="角色候选放大核对"]')`);
      assert.equal(
        await js(`document.querySelector('[alt="当前查看的角色候选"]').src`),
        candidates[1].images.neutral,
      );
      assert.equal(
        await js(`document.querySelector('[alt="角色参考原图"]').src`),
        fixture.url(originalBytes),
      );
      await js(
        `(()=>{const e=document.querySelector('[aria-label="候选放大比例"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'2');e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      await wait(`document.querySelector('.artwork-inspection output').textContent==='200%'`);
      await click('深色');
      await wait(`document.querySelector('.artwork-inspection-grid').dataset.background==='dark'`);
      assert.ok(
        await js(
          `(()=>{const e=document.querySelector('.artwork-inspection-viewport');return e.scrollWidth>e.clientWidth&&e.scrollHeight>e.clientHeight})()`,
        ),
      );
      await js(
        `document.querySelector('[aria-label="角色候选放大核对"]').scrollIntoView({block:'center',behavior:'instant'})`,
      );
      await capture('candidate-detail-inspection.png');
      await change('查看角色候选', candidates[0].id);
      await wait(
        `document.querySelector('[alt="当前查看的角色候选"]').src===${JSON.stringify(candidates[0].images.neutral)}`,
      );
      assert.equal(calls.length, 2, 'Zoom, background and inspection selection must never generate images');
      assert.equal(
        (await js(`window.mori.listPetJobs('revision-desktop')`))[0].awaitingSelection,
        'chibi-pet',
      );
      await click('收起放大核对');
      await js(
        `document.querySelector('[aria-label="角色基准预览"]').scrollIntoView({block:'center',behavior:'instant'})`,
      );
      await capture('candidate-comparison.png');
      const loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
      win.webContents.reload();
      await loaded;
      await wait(`!!document.querySelector('.room-rail')`);
      await open();
      await wait(`document.querySelectorAll('[aria-label="角色基准预览"] img').length===2`);
      assert.equal(calls.length, 2, 'Reload must not resume generation');
      await click('选择Q版候选 2 并继续');
      await wait(`!!document.querySelector('[aria-label="修正桌宠成品"]')`);
      await idle();
      assert.equal(calls.length, 4);
      jobs = await js(`window.mori.listPetJobs('revision-desktop')`);
      assert.equal(jobs[0].selectedBases['chibi-pet'], candidates[1].id);
      assert.equal(jobs[0].status, 'ready');
      const originalOutput = (await js(`window.mori.petJobResults(${JSON.stringify(originalJobId)})`))[0];
      const originalTaskBytes = fs.readFileSync(path.join(dir, 'pet-jobs', originalJobId + '.json'));
      await change('桌宠修正范围', 'wave');
      await change('桌宠修正要求', '手掌保持五指，招手幅度更轻柔。', true);
      assert.match(
        await js(`document.querySelector('[aria-label="修正桌宠成品"]').textContent`),
        /预计 1 次图像请求/,
      );
      await click('创建桌宠修正版');
      await wait(
        `document.querySelectorAll('.production-job-tabs button').length===2&&!!document.querySelector('[aria-label="修正桌宠成品"]')`,
      );
      await idle();
      assert.equal(calls.length, 5, 'A wave revision must make exactly one additional request');
      assert.equal(calls.at(-1).isSheet, true);
      // The image model received the chat model's instruction for this request, not the user's words.
      assert.ok(calls.at(-1).prompt.includes(planner.plannedPrompt('手掌保持五指，招手幅度更轻柔。')));
      assert.doesNotMatch(calls.at(-1).prompt, /手掌保持五指/);
      assert.equal(planner.calls.at(-1).feedback, '手掌保持五指，招手幅度更轻柔。');
      assert.ok(planner.calls.at(-1).images >= 2, 'the planner saw the current motion and the master');
      jobs = await js(`window.mori.listPetJobs('revision-desktop')`);
      const revised = jobs.find((job) => job.id !== originalJobId);
      assert.equal(revised.status, 'ready');
      assert.equal(revised.revision.motion, 'wave');
      assert.equal(revised.selectedBases['chibi-pet'], candidates[1].id);
      assert.match(
        await js(`document.querySelector('.production-job-tabs button[aria-pressed="true"]').textContent`),
        /修正招手/,
      );
      assert.match(
        await js(`document.querySelector('[aria-label="本次修正说明"]').textContent`),
        /手掌保持五指，招手幅度更轻柔/,
      );
      const originalJob = jobs.find((job) => job.id === originalJobId);
      const talkArtifact = (job) =>
        path.join(dir, 'pet-jobs', `${job.id}-${job.steps.findIndex((s) => s.motion === 'talk')}.asset.json`);
      assert.deepEqual(fs.readFileSync(talkArtifact(revised)), fs.readFileSync(talkArtifact(originalJob)));
      assert.deepEqual(
        fs.readFileSync(path.join(dir, 'pet-jobs', originalJobId + '.json')),
        originalTaskBytes,
      );
      const after = await state();
      assert.deepEqual(
        after.skins.find((skin) => skin.id === originalOutput.id),
        originalOutput,
      );
      assert.equal(after.skins.length, 2);
      assert.ok(after.skins.every((skin) => skin.review.status === 'pending'));
      assert.equal(after.activeSkinId, '', 'Revision output must never activate itself');
      assert.deepEqual(after.characters, before.characters);
      assert.deepEqual(after.messages, before.messages);
      assert.deepEqual(after.memories, before.memories);
      await wait(
        `document.querySelectorAll('[aria-label="修正前后动作对比"] .candidate-animation-stage').length===2`,
      );
      await js(
        `document.querySelector('[aria-label="修正前后动作对比"]').scrollIntoView({block:'center',behavior:'instant'})`,
      );
      await wait(`document.querySelectorAll('[aria-label="修正前后动作对比"] canvas[data-skin]').length===2`);
      const revisionOutput = after.skins.find((skin) => skin.id !== originalOutput.id);
      const pairIds = await js(
        `[...document.querySelectorAll('[aria-label="修正前后动作对比"] canvas[data-skin]')].map(e=>e.dataset.skin)`,
      );
      assert.deepEqual(pairIds, [originalOutput.id, revisionOutput.id]);
      await click('预览招手动作');
      await wait(
        `[...document.querySelectorAll('[aria-label="修正前后动作对比"] canvas[data-clip]')].every(e=>e.dataset.clip==='wave')`,
      );
      await capture('revision-motion-comparison.png');
      await wait(
        `[...document.querySelectorAll('[aria-label="修正前后动作对比"] canvas[data-clip]')].every(e=>e.dataset.clip==='idle')`,
      );
      await click('预览招手动作');
      await wait(
        `[...document.querySelectorAll('[aria-label="修正前后动作对比"] canvas[data-clip]')].every(e=>e.dataset.clip==='wave')`,
      );
      assert.equal(calls.length, 5, 'Comparing and replaying must not call a model');
      await js(
        `document.querySelector('[aria-label="修正桌宠成品"]').scrollIntoView({block:'center',behavior:'instant'})`,
      );
      await capture('single-action-revision.png');
      // A finished task offers the motions added since (sitting and lying on a window), ticked.
      await wait(`!!document.querySelector('[aria-label="补充新动作"]')`);
      const added = await js(
        `[...document.querySelectorAll('.production-add-motions label')].filter(l=>l.querySelector('input').checked).map(l=>l.textContent)`,
      );
      assert.equal(added.length, 3);
      assert.ok(
        added[0].startsWith('坐下') && added[1].startsWith('趴着') && added[2].startsWith('飞行'),
        added.join(),
      );
      assert.match(
        await js(`document.querySelector('[aria-label="补充新动作"]').textContent`),
        /预计 \d+ 次图像请求，不调用对话模型/,
      );
      assert.equal(calls.length, 5, 'Offering new motions calls nothing');
      win.setSize(900, 800);
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(
        await js(
          `document.querySelector('.modal').scrollWidth<=document.querySelector('.modal').clientWidth+2`,
        ),
        true,
      );
      fs.writeFileSync(
        path.join(dir, 'checks.json'),
        JSON.stringify(
          {
            passed: true,
            paidRequests: 0,
            imageFixtureRequests: calls.length,
            candidates: 2,
            selectedCandidate: 2,
            selectionReload: true,
            motionRevisionRequests: 1,
            unchangedSheetCopied: true,
            originalOutputPreserved: true,
            historyPreserved: true,
            autoActivation: false,
            horizontalOverflow: false,
            enlargedCandidateInspection: true,
            inspectionDoesNotSelectMaster: true,
            transparentBackgroundInspection: true,
            originalAndRevisionPlayback: true,
            sharedActionReplay: true,
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
