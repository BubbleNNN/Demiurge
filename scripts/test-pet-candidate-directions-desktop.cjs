'use strict';
// Isolated real Electron behavior with fixed PNG replies, not an art-quality test.
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fixture = require('../tests/fixtures/pet-images.cjs');
const { referencePack, imageDigest } = require('../electron/references.cjs');
const artStyles = require('../shared/art-styles.json');
const directions = require('../shared/pet-candidate-directions.json');
const motions = require('../shared/pet-motions.json');
const order = ['balanced', 'bold', 'soft'];
const dir = path.resolve(__dirname, '../.local/pet-candidate-directions-desktop-' + randomUUID());
fs.mkdirSync(dir, { recursive: true });
process.env.MORI_DATA_DIR = dir;
delete process.env.MORI_DEV_URL;
safeStorage.isEncryptionAvailable = () => false;
const timestamp = new Date().toISOString();
const originalBytes = fs.readFileSync(path.resolve(__dirname, '../public/art/cyrene-chibi.png'));
function tinted(number, sheet = false) {
  const image = fixture.decode(fixture.image(sheet));
  for (let i = 0; i < image.bitmap.length; i += 4)
    if (image.bitmap[i + 3]) image.bitmap[i] = (image.bitmap[i] + number * 11) % 255;
  return fixture.encode(image.bitmap, image.width, image.height);
}
const character = {
  id: 'candidate-directions-test',
  name: '候选方向测试',
  work: '隔离验收',
  summary: 'Preserve identity',
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
  name: '已有角色图',
  kind: 'image',
  style: 'chibi-pet',
  images: { neutral: fixture.url(tinted(1)) },
  generated: true,
  createdAt: timestamp,
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
      llmBaseUrl: 'https://never-call.example/v1',
      llmModel: '',
      chatMode: 'local',
      imageBaseUrl: 'https://directions.mori.example/v1',
      searchProvider: 'wiki',
      imageModel: '',
      demoMode: false,
      proactiveEnabled: false,
      voiceEnabled: false,
      motionEnabled: true,
    },
    characters: [character],
    skins: [source],
    activeCharacterId: character.id,
    activeSkinId: '',
    messages: {
      [character.id]: [
        { id: 'old-message', role: 'user', content: 'Preserve history', createdAt: timestamp },
      ],
    },
    memories: [
      { id: 'old-memory', characterId: character.id, text: 'Preserve memory', createdAt: timestamp },
    ],
  }),
);
let expectedMaster = tinted(1),
  expectedDirection = null,
  expectedKind = 'sheet';
const wikiSearches = [];
const furina = fs.readFileSync(path.resolve(__dirname, '../public/art/chibi-fallback-furina.png'));
const calls = [];
global.fetch = async (url, init) => {
  if (String(url).startsWith('https://zh.wikipedia.org/w/api.php')) {
    // The chibi look first looks for an existing design; this isolated wiki has none.
    wikiSearches.push(new URL(url).searchParams.get('gsrsearch'));
    return new Response(JSON.stringify({ batchcomplete: '', query: { pages: {} } }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
  assert.equal(url, 'https://directions.mori.example/v1/images/edits');
  assert.equal(init.headers.Authorization, 'Bearer isolated-direction-key');
  const prompt = String(init.body.get('prompt'));
  const kind = prompt.includes('regular 2-by-2 grid')
    ? 'sheet'
    : prompt.includes('Requested correction:')
      ? 'edit'
      : 'base';
  assert.equal(kind, expectedKind);
  const style =
    kind === 'edit'
      ? 'chibi-pet'
      : [...require('../shared/creation-styles.json'), ...Object.keys(artStyles)].find((id) =>
          prompt.includes(artStyles[id].prompt),
        );
  assert.ok(style);
  const items = init.body.getAll('image[]').length ? init.body.getAll('image[]') : [init.body.get('image')];
  const images = await Promise.all(items.map(async (image) => Buffer.from(await image.arrayBuffer())));
  // A chibi base carries the Furina sticker last, as a style guide only.
  assert.equal(images.length, kind === 'base' ? (style === 'chibi-pet' ? 2 : 1) : 2);
  assert.deepEqual(images[kind === 'base' ? 0 : images.length - 1], originalBytes);
  if (kind === 'base' && style === 'chibi-pet') assert.deepEqual(images[1], furina);
  if (kind !== 'base')
    assert.deepEqual(
      images[0],
      expectedMaster,
      'Only the explicitly selected candidate supplies motions/edits',
    );
  const direction =
    order.find((id) => prompt.includes(directions[id][style === 'original' ? 'originalPrompt' : 'prompt'])) ||
    null;
  if (kind === 'base') {
    if (Array.isArray(expectedDirection)) assert.equal(direction, expectedDirection.shift());
    else assert.equal(direction, expectedDirection);
    if (style === 'original')
      for (const value of Object.values(directions)) assert.ok(!prompt.includes(value.prompt));
  }
  calls.push({ kind, style, direction });
  const bytes = tinted(calls.length + 20, kind === 'sheet');
  return new Response(JSON.stringify({ data: [{ b64_json: bytes.toString('base64') }] }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
let win,
  finished = false;
const deadline = setTimeout(() => finish(new Error('Native directions test timed out')), 120000);
async function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  const message = error
    ? error.stack
    : 'PASS: default explore/subtle/single/source candidate modes, 3 persisted directions, original-style conservative prompts, selected bytes, correction inheritance, reload and Inspector labels. Fixed PNG replies; 0 paid requests.';
  fs.writeFileSync(path.join(dir, 'native.log'), message + '\nArtifacts: ' + dir + '\n');
  if (error && win && !win.isDestroyed()) {
    console.error((await win.webContents.executeJavaScript('document.body.innerText')).slice(-12000));
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
      `!document.querySelector('[aria-label="开始自动制作桌宠"]').disabled&&!document.querySelector('.production-step.working')&&!document.querySelector('.pet-production .progress-card')`,
    );
  const cardDirections = () =>
    js(`[...document.querySelectorAll('[aria-label="候选表现方向"]')].map(e=>e.textContent.trim())`);
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
  const countBases = (count) =>
    wait(
      `document.querySelectorAll('[aria-label="角色基准预览"]>.production-base-grid>figure').length===${count}`,
    );
  const capture = async (name, selector) => {
    await js(
      `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`,
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    fs.writeFileSync(path.join(dir, name), (await win.webContents.capturePage()).toPNG());
  };
  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(`!!document.querySelector('.room-rail')`);
      await js(
        `window.mori.load().then(r=>window.mori.saveSettings({...r.state.settings,imageModel:'direction-fixture'},{imageKey:'isolated-direction-key'}))`,
      );
      const initial = await state();
      await open();
      assert.equal(await js(`!!document.querySelector('[aria-label="角色候选变化"]')`), false);
      for (const motion of motions) {
        const pressed = await js(
          `document.querySelector('[aria-label=${JSON.stringify('制作动作：' + motion.name)}]').getAttribute('aria-pressed')==='true'`,
        );
        if (pressed !== (motion.id === 'wave')) await click('制作动作：' + motion.name);
      }
      await change('角色候选数量', '2');
      assert.equal(await js(`document.querySelector('[aria-label="角色候选变化"]').value`), 'explore');
      assert.equal(await js(`document.querySelectorAll('[aria-label="本次候选方向"] li').length`), 2);
      await change('角色候选数量', '3');
      assert.equal(await js(`document.querySelectorAll('[aria-label="本次候选方向"] li').length`), 3);
      await change('角色候选变化', 'subtle');
      assert.equal(await js(`!!document.querySelector('[aria-label="本次候选方向"]')`), false);
      await change('角色候选变化', 'explore');
      await capture('candidate-directions-plan.png', '[aria-label="本次候选方向"]');
      assert.equal(calls.length, 0);
      await change('桌宠制作基准', source.id);
      assert.equal(await js(`!!document.querySelector('[aria-label="角色候选变化"]')`), false);
      await click('开始自动制作桌宠');
      await wait(`!!document.querySelector('.production-review')`);
      await idle();
      assert.equal(calls.length, 1);
      assert.equal((await tasks())[0].candidateVariation, 'subtle');
      assert.equal((await tasks())[0].candidateCount, 1);
      await change('桌宠制作基准', '');
      assert.equal(await js(`document.querySelector('[aria-label="角色候选变化"]').value`), 'explore');
      assert.deepEqual(await cardDirections(), [], 'The new draft cannot assign directions to an old source');
      expectedKind = 'base';
      expectedDirection = [...order];
      await click('开始自动制作桌宠');
      await countBases(3);
      await idle();
      assert.deepEqual(expectedDirection, []);
      assert.equal(calls.length, 4);
      let explore = (await tasks()).find((task) => task.candidateVariation === 'explore');
      assert.equal(explore.awaitingSelection, 'chibi-pet');
      const originalBases = await bases(explore.id);
      assert.deepEqual(
        originalBases.map((skin) => skin.generation.candidateDirection),
        order,
      );
      assert.deepEqual(
        await cardDirections(),
        order.map((id) => directions[id].label),
      );
      await capture('candidate-directions-comparison.png', '.production-base-grid');
      await click('放大核对Q版候选 2');
      const options = await js(
        `[...document.querySelector('[aria-label="查看角色候选"]').options].map(e=>e.textContent)`,
      );
      for (let index = 0; index < order.length; index++)
        assert.ok(options[index].includes(directions[order[index]].label));
      assert.match(await js(`document.querySelector('[aria-label="当前候选方向"]').textContent`), /鲜明轮廓/);
      await change('候选预览高度', '96');
      assert.equal(calls.length, 4);
      expectedMaster = Buffer.from(originalBases[1].images.neutral.split(',')[1], 'base64');
      expectedKind = 'edit';
      await click('修正Q版候选 2');
      await change('角色候选修正要求', '保留鲜明轮廓，让眼睛更清楚。', 'textarea');
      await click('生成角色候选修正版');
      await countBases(4);
      await idle();
      assert.equal(calls.length, 5);
      const edited = (await bases(explore.id)).find(
        (skin) => skin.generation.parentSkinId === originalBases[1].id,
      );
      assert.equal(edited.generation.candidateDirection, 'bold');
      assert.deepEqual(
        await cardDirections(),
        [...order, 'bold'].map((id) => directions[id].label),
      );
      win.setSize(900, 850);
      await capture('candidate-directions-results.png', '[aria-label="角色基准预览"]');
      assert.equal(
        await js(
          `document.querySelector('.modal').scrollWidth<=document.querySelector('.modal').clientWidth+2`,
        ),
        true,
      );
      const loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
      win.webContents.reload();
      await loaded;
      await wait(`!!document.querySelector('.room-rail')`);
      await open();
      await countBases(4);
      assert.equal(await js(`!!document.querySelector('[aria-label="角色候选变化"]')`), false);
      assert.deepEqual(
        await cardDirections(),
        [...order, 'bold'].map((id) => directions[id].label),
      );
      assert.equal(calls.length, 5);
      expectedKind = 'sheet';
      expectedMaster = Buffer.from(edited.images.neutral.split(',')[1], 'base64');
      await click('选择Q版候选 4 并继续');
      await wait(`!!document.querySelector('.production-review')`);
      await idle();
      assert.equal(calls.length, 6);
      const result = await js(`window.mori.petJobResults(${JSON.stringify(explore.id)})`);
      assert.equal(result[0].generation.candidateDirection, 'bold');
      for (const motion of motions) {
        const pressed = await js(
          `document.querySelector('[aria-label=${JSON.stringify('制作动作：' + motion.name)}]').getAttribute('aria-pressed')==='true'`,
        );
        if (pressed !== (motion.id === 'wave')) await click('制作动作：' + motion.name);
      }
      await change('角色候选数量', '2');
      await change('角色候选变化', 'subtle');
      expectedKind = 'base';
      expectedDirection = null;
      await click('开始自动制作桌宠');
      await countBases(2);
      await idle();
      const subtle = (await tasks()).find(
        (task) => task.candidateCount === 2 && task.candidateVariation === 'subtle',
      );
      assert.ok(subtle);
      assert.equal(calls.length, 8);
      const subtleBases = await bases(subtle.id);
      assert.ok(subtleBases.every((skin) => skin.generation.candidateDirection === undefined));
      assert.deepEqual(await cardDirections(), []);
      expectedKind = 'sheet';
      expectedMaster = Buffer.from(subtleBases[0].images.neutral.split(',')[1], 'base64');
      await click('选择Q版候选 1 并继续');
      await wait(`!!document.querySelector('.production-review')`);
      await idle();
      assert.equal(calls.length, 9);
      await change('角色候选变化', 'explore');
      await change('角色候选数量', '1');
      assert.equal(await js(`!!document.querySelector('[aria-label="角色候选变化"]')`), false);
      expectedKind = 'base';
      expectedDirection = null;
      await click('开始自动制作桌宠');
      await countBases(1);
      await idle();
      assert.equal(calls.length, 10);
      assert.equal((await tasks())[0].candidateVariation, 'subtle');
      assert.deepEqual(await cardDirections(), []);
      await click('桌宠画风：Q版');
      await click('桌宠画风：原作');
      await change('角色候选数量', '2');
      assert.equal(await js(`document.querySelector('[aria-label="角色候选变化"]').value`), 'explore');
      expectedDirection = ['balanced', 'bold'];
      await click('开始自动制作桌宠');
      await countBases(2);
      await idle();
      assert.equal(calls.length, 12);
      assert.deepEqual(expectedDirection, []);
      const originalJob = (await tasks()).find((task) => task.styles[0] === 'original');
      assert.equal(originalJob.awaitingSelection, 'original');
      assert.deepEqual(
        (await bases(originalJob.id)).map((skin) => skin.generation.candidateDirection),
        ['balanced', 'bold'],
      );
      assert.deepEqual(
        await cardDirections(),
        ['balanced', 'bold'].map((id) => directions[id].label),
      );
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
            defaultMultiCandidateExplore: true,
            directionPreviewCountMatches: true,
            sourceEffectiveSubtle: true,
            singleEffectiveSubtle: true,
            subtleAddsNoDirection: true,
            explorePromptDirections: order,
            originalUsesConservativeDirections: true,
            candidateLabelsFromSavedProvenance: true,
            noDirectionInferredForOldCandidates: true,
            inspectorLabelsMatch: true,
            correctionInheritsDirection: true,
            chosenCandidateBytesVerified: true,
            reloadPreservesLabels: true,
            previewsSendNoRequests: true,
            requiredSelectionPreserved: true,
            outputInheritsChosenDirection: true,
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
