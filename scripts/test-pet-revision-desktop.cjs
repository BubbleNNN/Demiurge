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
const webReference = tinted(false, 9);
// The only public resource in this fixture is supplied below, including DNS; no network.
require('node:dns/promises').lookup = async () => [{ address: '93.184.216.34', family: 4 }];
const furina = fs.readFileSync(path.resolve(__dirname, '../public/art/chibi-fallback-furina.png'));
// A motion described in words: the chat model's design, as this stand-in returns it.
const designs = [];
const design = {
  problem: '',
  name: '转个圈',
  description: '原地轻快地转一圈',
  summary: '抬手、转身到背面、转回正面、站好。',
  slug: 'spin',
  kind: 'gesture',
  pace: 'quick',
  poses: [
    'rest',
    'lift both arms and start turning to the left',
    'back turned to the viewer mid-spin',
    'turn back to face the viewer, arms lowering',
  ],
  poses8: [
    'rest',
    'bend the knees slightly and lift both arms to the sides',
    'turn a quarter to the left, arms out',
    'back turned to the viewer, skirt flaring',
    'turn three quarters, right side toward the viewer',
    'face the viewer again, arms still out',
    'lower the arms halfway with a small smile',
    'rest',
  ],
  stages: [],
};
global.fetch = async (url, init) => {
  if (String(url) === 'https://reference.mori.example/detail.png')
    return new Response(webReference, { headers: { 'Content-Type': 'image/png' } });
  if (String(url).endsWith('/chat/completions') &&
      String(init.body).includes('Verify that it is the same character')) {
    assert.ok(String(init.body).includes(fixture.url(webReference)));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      sameCharacter: true, compatibleOutfit: true, useful: true, confidence: 0.95,
    }) } }] }), { headers: { 'Content-Type': 'application/json' } });
  }
  if (
    String(url).endsWith('/chat/completions') &&
    String(init.body).includes('You design one new animated motion')
  ) {
    designs.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(design) } }] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const planned = await planner.handle(url, init);
  if (planned) return planned;
  if (String(url).startsWith('https://zh.wikipedia.org/w/api.php')) {
    // The chibi look first looks for an existing design; this isolated wiki has none.
    wikiSearches.push(new URL(url).searchParams.get('gsrsearch'));
    return new Response(JSON.stringify({ batchcomplete: '', query: { pages: calls.length >= 4 ? { 1: { title: character.name, fullurl: 'https://reference.mori.example/detail.png' } } : {} } }), {
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
  const hasWebReference = prompt.includes('downloaded, visually checked web references');
  assert.equal(images.length, hasWebReference ? 3 : 2);
  if (hasWebReference) assert.deepEqual(Buffer.from(await images[2].arrayBuffer()), webReference);
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
    await click('打开桌宠工作台');
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
      // Her motions are planned from her profile: what suits her is selected, the rest folded.
      await js(
        `document.querySelector('[aria-label="自动制作动作"]').scrollIntoView({block:'start',behavior:'instant'})`,
      );
      await capture('motion-plan.png');
      await js(`document.querySelector('[aria-label="自动制作动作"] details').open=true`);
      await js(
        `document.querySelector('[aria-label="自动制作动作"] details').scrollIntoView({block:'start',behavior:'instant'})`,
      );
      await capture('motion-plan-aside.png');
      await change('角色候选数量', '2');
      // Labels come from the shared catalogue; only wave and talk stay selected. Motions that do
      // not suit her start unselected, so each is set by its state rather than toggled blindly.
      for (const motion of require('../shared/pet-motions.json')) {
        const label = '制作动作：' + motion.name;
        const pressed = await js(
          `document.querySelector('[aria-label=${JSON.stringify(label)}]').getAttribute('aria-pressed')==='true'`,
        );
        if (pressed !== ['wave', 'talk'].includes(motion.id)) await click(label);
      }
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
      await change('桌宠成品修正方式', 'researched');
      await change('桌宠修正要求', '手掌保持五指，招手幅度更轻柔。', true);
      assert.match(
        await js(`document.querySelector('[aria-label="修正桌宠成品"]').textContent`),
        /预计 1 次图像请求/,
      );
      await click('创建桌宠修正版');
      await wait(
        `document.querySelector('.production-tabs small')?.textContent==='2'&&!!document.querySelector('[aria-label="修正桌宠成品"]')`,
      );
      await idle();
      assert.equal(calls.length, 5, 'A wave revision must make exactly one additional request');
      assert.equal(calls.at(-1).isSheet, true);
      // The image model received the chat model's instruction for this request, not the user's words.
      assert.ok(calls.at(-1).prompt.includes(planner.plannedPrompt('手掌保持五指，招手幅度更轻柔。')));
      assert.match(calls.at(-1).prompt, /手掌保持五指/);
      assert.equal(planner.calls.at(-1).feedback, '手掌保持五指，招手幅度更轻柔。');
      assert.ok(planner.calls.at(-1).images >= 2, 'the planner saw the current motion and the master');
      jobs = await js(`window.mori.listPetJobs('revision-desktop')`);
      const revised = jobs.find((job) => job.id !== originalJobId);
      assert.equal(revised.status, 'ready');
      assert.equal(revised.revision.motion, 'wave');
      assert.equal(revised.revision.plan.visualReferences.length, 1);
      assert.match(await js(`document.querySelector('[aria-label="修正说明的整理结果"]').textContent`), /1 张已下载并核对/);
      assert.ok(calls.at(-1).prompt.includes('downloaded, visually checked web references'));
      assert.equal(revised.selectedBases['chibi-pet'], candidates[1].id);
      assert.match(
        await js(
          `document.querySelector('[aria-label="桌宠制作任务"] .production-section-heading small').textContent`,
        ),
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
      // A finished task offers the motions it lacks that suit her, ticked. This task has only
      // wave and talk; her profile (lively, runs, music/reading/snacks by temperament) keeps
      // gaming, diary, office, lying down and flying aside, unticked and folded.
      await wait(`!!document.querySelector('[aria-label="补充新动作"]')`);
      const catalogue = require('../shared/pet-motions.json');
      const offered = async (group) =>
        (
          await js(
            `[...document.querySelectorAll('[aria-label="${group}"] label')].map(l=>({name:l.textContent,on:l.querySelector('input').checked}))`,
          )
        ).map((m) => ({ ...m, id: catalogue.find((c) => m.name.startsWith(c.name)).id }));
      const suited = await offered('要补充的动作');
      assert.ok(
        suited.every((m) => m.on),
        JSON.stringify(suited),
      );
      assert.deepEqual(
        suited.map((m) => m.id),
        catalogue
          .map((c) => c.id)
          .filter((id) => !['wave', 'talk', 'gaming', 'diary', 'office', 'lie', 'fly'].includes(id)),
      );
      assert.match(suited.find((m) => m.id === 'sit').name, /基础动作 · 坐在你正在用的窗口上陪你/);
      assert.match(suited.find((m) => m.id === 'read').name, /适合她 · 按她的性格推断/);
      const aside = await offered('不适合她的动作');
      assert.deepEqual(
        aside.map((m) => [m.id, m.on]),
        [
          ['gaming', false],
          ['diary', false],
          ['office', false],
          ['lie', false],
          ['fly', false],
        ],
      );
      assert.match(aside.find((m) => m.id === 'fly').name, /她靠跑移动，不会飞/);
      assert.equal(
        await js(`document.querySelector('[aria-label="补充新动作"] details').open`),
        false,
        'kept aside, folded',
      );
      assert.match(
        await js(`document.querySelector('[aria-label="补充新动作"]').textContent`),
        /预计 \d+ 次图像请求，不调用对话模型/,
      );
      assert.equal(calls.length, 5, 'Offering new motions calls nothing');
      // While another task of this style is still unfinished, adding motions is refused, and the
      // refusal is shown beside the button, not at the top of the window out of sight.
      const revisedFile = JSON.parse(
        fs.readFileSync(path.join(dir, 'pet-jobs', revised.id + '.json'), 'utf8'),
      );
      const blocker = {
        ...revisedFile,
        id: randomUUID(),
        status: 'queued',
        createdAt: new Date().toISOString(),
        steps: revisedFile.steps.map((s, i, all) => (i === all.length - 1 ? { ...s, status: 'queued' } : s)),
      };
      const blockerFile = path.join(dir, 'pet-jobs', blocker.id + '.json');
      fs.writeFileSync(blockerFile, JSON.stringify(blocker));
      await click('补充桌宠动作');
      await wait(`!!document.querySelector('[aria-label="补充新动作"] .inline-error')`);
      const refusal = await js(
        `(()=>{const e=document.querySelector('[aria-label="补充新动作"] .inline-error');e.scrollIntoView({block:'center',behavior:'instant'});return {text:e.textContent,height:e.getBoundingClientRect().height,alerts:document.querySelectorAll('.inline-error[role="alert"]').length}})()`,
      );
      assert.match(refusal.text, /已有未完成任务/);
      assert.ok(refusal.height > 0);
      assert.equal(refusal.alerts, 1, 'shown once, beside the button');
      await capture('add-motions-refused.png');
      fs.unlinkSync(blockerFile);
      assert.equal(calls.length, 5, 'A refused request calls nothing');
      // A motion described in words: the chat model designs it against her look, the plan is
      // shown, and only then is it drawn (one image) and packed with the rest.
      await js(
        `(()=>{const t=document.querySelector('textarea[aria-label="描述新动作"]');t.scrollIntoView({block:'center',behavior:'instant'});const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;set.call(t,'给她加一个转圈的动作');t.dispatchEvent(new Event('input',{bubbles:true}));return true})()`,
      );
      await click('设计新动作');
      await wait(`!!document.querySelector('.custom-motion-plan')`);
      const shown = await js(`document.querySelector('[aria-label="自定义新动作"]').textContent`);
      assert.match(shown, /转个圈/);
      assert.match(shown, /做一次就回到站姿/);
      assert.match(shown, /预计 1 次图像请求/);
      assert.equal(designs.length, 1, 'one chat request designs it');
      assert.match(JSON.stringify(designs[0]), /给她加一个转圈的动作/);
      assert.equal(calls.length, 5, 'designing draws nothing');
      await capture('custom-motion-plan.png', '[aria-label="自定义新动作"]');
      await click('制作这个新动作');
      await wait(
        `window.mori.load().then(()=>document.querySelectorAll('[aria-label="确认形象并启用桌宠"]').length>0)`,
      );
      for (let i = 0; i < 300 && calls.length < 6; i++) await new Promise((r) => setTimeout(r, 100));
      assert.equal(calls.length, 6, 'exactly one image draws the new motion');
      assert.match(calls[5].prompt, /back turned to the viewer mid-spin|turn a quarter to the left/);
      // The new look's review replaces the previous one (and its ticks) when its results load:
      // tick whatever is unticked until confirming is possible.
      let confirmable = false;
      for (let i = 0; i < 150 && !confirmable; i++) {
        confirmable = await js(
          `(()=>{for(const b of document.querySelectorAll('.production-review input[type="checkbox"]:not(.production-add-motions input)'))if(!b.checked)b.click();const c=document.querySelector('[aria-label="确认形象并启用桌宠"]');return !!c&&!c.disabled})()`,
        );
        if (!confirmable) await new Promise((r) => setTimeout(r, 100));
      }
      assert.ok(confirmable, 'the reviewed look can be confirmed');
      await click('确认形象并启用桌宠');
      await wait(
        `window.mori.load().then(r=>r.state.skins.find(s=>s.id===r.state.activeSkinId)?.customMotions?.[0]?.name==='转个圈')`,
      );
      const active = await js(
        'window.mori.load().then(r=>{const s=r.state.skins.find(s=>s.id===r.state.activeSkinId);return {clip:s.sprite.clips.custom_spin,labels:s.customMotions}})',
      );
      assert.equal(active.clip.loop, false);
      assert.deepEqual(active.labels, [
        { id: 'custom_spin', name: '转个圈', description: '原地轻快地转一圈', kind: 'gesture' },
      ]);
      // On her toolbar, by name; she does it.
      await js('window.mori.openPet()');
      let pet;
      for (let i = 0; i < 100 && !pet; i++) {
        pet = require('electron')
          .BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().includes('pet=1'));
        await new Promise((r) => setTimeout(r, 100));
      }
      const pj = (code) => pet.webContents.executeJavaScript(code, true);
      for (
        let i = 0;
        i < 100 && !(await pj('!!document.querySelector(\'[aria-label="她的动作"] button\')'));
        i++
      )
        await new Promise((r) => setTimeout(r, 100));
      assert.equal(
        await pj('document.querySelector(\'[aria-label="她的动作"] button\').textContent'),
        '转个圈',
      );
      await pj('document.querySelector(\'[aria-label="桌宠转个圈"]\').click()');
      let played = false;
      for (let i = 0; i < 60 && !played; i++) {
        played =
          (await pj('document.querySelector(".pet-draggable canvas")?.dataset.clip || ""')) === 'custom_spin';
        await new Promise((r) => setTimeout(r, 50));
      }
      assert.ok(played, 'the toolbar button plays the new motion');
      // The toolbar still fits in the band under her, its row of motions inside the window.
      const fits = await pj(
        `(()=>{const t=document.querySelector('.pet-toolbar').getBoundingClientRect(),r=document.querySelector('[aria-label="她的动作"]').getBoundingClientRect();return t.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth})()`,
      );
      assert.equal(fits, true, 'toolbar inside the window');
      await js('window.mori.closePet()');
      // Reopened with nothing in progress, the studio starts on making a new pet: no task in sight.
      // Her pets are one tab away, the look in use marked; one opens at a time, with a way back.
      await click('关闭弹窗');
      await wait(`!document.querySelector('.pet-production')`);
      await click('打开桌宠工作台');
      await wait(`!!document.querySelector('.production-tabs')`);
      assert.equal(
        await js(`document.querySelector('.production-tabs [aria-selected="true"]').textContent`),
        '制作新桌宠',
      );
      assert.equal(
        await js(`!!document.querySelector('[aria-label="桌宠制作任务"]')`),
        false,
        'no task shown',
      );
      assert.equal(await js(`document.querySelector('.production-new').hidden`), false);
      await js(`[...document.querySelectorAll('.production-tabs button')][1].click()`);
      await wait(`document.querySelectorAll('.production-task-row').length>=2`);
      assert.equal(
        await js(`document.querySelector('.production-new').hidden`),
        true,
        'the setup steps aside',
      );
      const rows = await js(
        `[...document.querySelectorAll('.production-task-row')].map((r) => r.textContent)`,
      );
      assert.equal(rows.filter((r) => r.includes('正在用')).length, 1, 'the look in use is marked once');
      assert.ok(rows.find((r) => r.includes('正在用')).includes('补充转个圈'));
      await js(`document.querySelector('.production-task-row').click()`);
      await wait(`!!document.querySelector('[aria-label="桌宠制作任务"]')`);
      assert.equal(await js(`!!document.querySelector('.production-task-row')`), false, 'one task at a time');
      await capture('studio-task.png', '[aria-label="桌宠制作任务"]');
      await js(`document.querySelector('.production-back').click()`);
      await wait(`!!document.querySelector('.production-task-row')`);
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
            customMotionDesigned: true,
            customMotionOnToolbar: true,
            studioOpensClean: true,
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
