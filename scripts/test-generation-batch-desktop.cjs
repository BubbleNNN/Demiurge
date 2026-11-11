'use strict';
// Native queue integration with isolated data and image transport fixtures.
// Never reads the user's saved keys or calls a paid provider.
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const dir = path.resolve(__dirname, '../.local/generation-batch-smoke-' + randomUUID());
fs.mkdirSync(dir, { recursive: true });
process.env.MORI_DATA_DIR = dir;
delete process.env.MORI_DEV_URL;
safeStorage.isEncryptionAvailable = () => false;
const png = fs.readFileSync(path.resolve(__dirname, '../public/art/cyrene-chibi-v6-reference.png'));
const original = 'data:image/png;base64,' + png.toString('base64');
const timestamp = new Date().toISOString();
fs.writeFileSync(
  path.join(dir, 'state.json'),
  JSON.stringify({
    settings: {
      llmBaseUrl: '',
      llmModel: '',
      imageBaseUrl: 'https://images.mori.example/v1',
      imageModel: 'batch-fixture',
      searchProvider: 'wiki',
      demoMode: false,
      proactiveEnabled: false,
    },
    characters: [
      {
        id: 'batch-test',
        name: '批量测试角色',
        work: '隔离测试素材',
        summary: '',
        personality: [],
        speakingStyle: '',
        appearance: '',
        quotes: [],
        sources: [],
        unknowns: [],
        behavior: { energy: 50, affection: 50, curiosity: 50 },
        createdAt: timestamp,
        visualReferences: [{ id: 'original', name: '传输测试原图', image: original, createdAt: timestamp }],
      },
    ],
    skins: [],
    activeCharacterId: 'batch-test',
    activeSkinId: '',
    messages: { 'batch-test': [] },
    memories: [],
  }),
);
const calls = [],
  savedFault = '批量测试：本机保存被中断';
let failChibi = true,
  failNextSave = false,
  holdNext = false,
  releaseImage,
  active = 0,
  maximum = 0;
const rename = fs.promises.rename;
fs.promises.rename = async (from, to) => {
  if (failNextSave && to === path.join(dir, 'state.json')) {
    failNextSave = false;
    throw new Error(savedFault);
  }
  return rename(from, to);
};
const tokens = Object.fromEntries(
  Object.entries(require('../shared/art-styles.json')).map(([id, guide]) => [id, guide.prompt]),
);
const styleIds = require('../shared/creation-styles.json');
const furina = fs.readFileSync(path.resolve(__dirname, '../public/art/cyrene-chibi-v6-reference.png'));
const wikiSearches = [];
global.fetch = async (url, init) => {
  if (String(url).startsWith('https://zh.wikipedia.org/w/api.php')) {
    // The chibi look first looks for an existing design; this isolated wiki has none.
    wikiSearches.push(new URL(url).searchParams.get('gsrsearch'));
    return new Response(JSON.stringify({ batchcomplete: '', query: { pages: {} } }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
  assert.equal(url, 'https://images.mori.example/v1/images/edits');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, 'Bearer batch-test-key');
  const form = init.body,
    prompt = String(form.get('prompt'));
  // Offered looks first: the chibi look shares its medium text with the retired sticker look.
  const style = [...styleIds, ...Object.keys(tokens)].find((style) => prompt.includes(tokens[style]));
  assert.ok(style, 'Each request has a distinct supported rendering medium');
  const images = form.getAll('image[]').length ? form.getAll('image[]') : [form.get('image')];
  assert.equal(
    images.length,
    style === 'chibi-pet' ? 2 : 1,
    'Unreviewed outputs cannot become the next style reference',
  );
  assert.deepEqual(Buffer.from(await images[0].arrayBuffer()), png);
  if (style === 'chibi-pet')
    assert.deepEqual(Buffer.from(await images[1].arrayBuffer()), furina, 'Furina style guide only');
  calls.push(style);
  maximum = Math.max(maximum, ++active);
  try {
    if (holdNext) {
      holdNext = false;
      await new Promise((resolve) => {
        releaseImage = resolve;
      });
    }
    if (style === '8bit' && failChibi) {
      failChibi = false;
      return new Response(JSON.stringify({ error: { message: 'Intentional style failure' } }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } finally {
    active--;
  }
};
let win;
const deadline = setTimeout(() => finish(new Error('Batch native test timed out')), 60000);
const finish = async (error) => {
  clearTimeout(deadline);
  if (error) {
    console.error(error.stack);
    if (win && !win.isDestroyed()) {
      console.error((await win.webContents.executeJavaScript('document.body.innerText')).slice(-4000));
      fs.writeFileSync(path.join(dir, 'failure.png'), (await win.webContents.capturePage()).toPNG());
    }
  } else {
    console.log(
      'Native batch passed: multi-selection, select/clear all, current style catalog generation, original byte preservation, separate pending reviews, per-style failure retry, local-save pause/recovery, stop/continue and persisted candidates.',
    );
  }
  console.log('Artifacts: ' + dir);
  app.exit(error ? 1 : 0);
};
app.on('browser-window-created', (_event, created) => {
  // Animation state is read from the page; a window behind other apps must keep its frames.
  created.webContents.setBackgroundThrottling(false);
  if (win) return;
  win = created;
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const wait = async (code) => {
    for (let n = 0; n < 250; n++) {
      if (await js(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    throw new Error('UI did not reach: ' + code);
  };
  const click = (label) =>
    js(
      `(()=>{const b=[...document.querySelectorAll('button')].find(b=>(b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)})&&!b.disabled);if(!b)throw new Error('Missing button '+${JSON.stringify(label)});b.click()})()`,
    );
  const capture = async (file) => {
    await js(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    fs.writeFileSync(path.join(dir, file), (await win.webContents.capturePage()).toPNG());
  };
  const select = async (names) => {
    await click('清空选择');
    for (const name of names) await click('选择画风：' + name);
  };
  const idle = () =>
    wait(
      `!document.querySelector('.progress-card') && !document.querySelector('.generation-batch-item.generating,.generation-batch-item.saving')`,
    );
  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(`!!document.querySelector('.room-rail')`);
      await js(
        `window.mori.load().then(r=>window.mori.saveSettings(r.state.settings,{imageKey:'batch-test-key'}))`,
      );
      await click('Demiurge 首页');
      await click('角色工作室');
      await click('外观与动作');
      await click('打开桌宠工作台');
      await click('导入与工具');
      await click('绘图实验');
      await click('图像服务 · 多画风立绘');
      await wait(`document.querySelectorAll('.style-option').length===${styleIds.length}`);
      await click('全选画风');
      assert.equal(
        await js(`document.querySelectorAll('.style-option[aria-pressed="true"]').length`),
        styleIds.length,
      );
      await click('清空选择');
      assert.equal(await js(`document.querySelectorAll('.style-option[aria-pressed="true"]').length`), 0);
      assert.equal(
        await js(
          `[...document.querySelectorAll('button')].find(b=>b.textContent.includes('生成 0 张候选')).disabled`,
        ),
        true,
      );
      assert.equal(calls.length, 0);
      for (const name of ['原作', '8bit', '3D']) await click('选择画风：' + name);
      await js(`document.querySelector('.generation-step').scrollIntoView({block:'start'})`);
      await capture('multi-selection.png');
      await click('用 1 张原图生成 3 张候选');
      await wait(
        `document.querySelectorAll('.generation-batch-item.saved').length===2 && document.querySelectorAll('.generation-batch-item.failed').length===1`,
      );
      await idle();
      assert.deepEqual(calls, ['original', '8bit', '3d']);
      let state = await js(`window.mori.load().then(r=>r.state)`);
      assert.equal(state.skins.length, 2);
      assert.equal(state.activeSkinId, '');
      assert.ok(
        state.skins.every(
          (s) => s.review.status === 'pending' && s.generation.referenceIds[0] === 'original',
        ),
      );
      await capture('partial-results.png');
      await click('重试8bit');
      await wait(`document.querySelectorAll('.generation-batch-item.saved').length===3`);
      await idle();
      assert.deepEqual(calls, ['original', '8bit', '3d', '8bit']);
      await click('核对原作候选');
      const anime = (await js(`window.mori.load().then(r=>r.state.skins)`)).find(
        (s) => s.style === 'original',
      );
      assert.equal(await js(`document.querySelector('[aria-label="选择基准候选"]').value`), anime.id);
      await select(['原作', '8bit']);
      failNextSave = true;
      await click('用 1 张原图生成 2 张候选');
      await wait(
        `document.querySelector('.generation-batch-item.unsaved')?.textContent.includes(${JSON.stringify(savedFault)})`,
      );
      await idle();
      assert.equal(calls.length, 5);
      assert.equal(await js(`document.querySelectorAll('.generation-batch-item.queued').length`), 1);
      await click('仅重试本地保存');
      await wait(
        `document.querySelectorAll('.generation-batch-item.saved').length===1 && !document.querySelector('.generation-batch-item.unsaved')`,
      );
      await idle();
      assert.equal(calls.length, 5, 'Local-only retry cannot submit another image request');
      await click('继续剩余 1 种画风');
      await wait(`document.querySelectorAll('.generation-batch-item.saved').length===2`);
      await idle();
      assert.equal(calls.length, 6);
      await select(['原作', '8bit', '3D']);
      holdNext = true;
      await click('用 1 张原图生成 3 张候选');
      await wait(`document.querySelectorAll('.generation-batch-item.generating').length===1`);
      await click('停止队列');
      assert.ok(releaseImage);
      releaseImage();
      await wait(
        `document.querySelectorAll('.generation-batch-item.saved').length===1 && document.querySelectorAll('.generation-batch-item.queued').length===2`,
      );
      await idle();
      assert.equal(calls.length, 7);
      await click('继续剩余 2 种画风');
      await wait(`document.querySelectorAll('.generation-batch-item.saved').length===3`);
      await idle();
      assert.equal(calls.length, 9);
      await click('全选画风');
      await click(`用 1 张原图生成 ${styleIds.length} 张候选`);
      await wait(`document.querySelectorAll('.generation-batch-item.saved').length===${styleIds.length}`);
      await idle();
      assert.deepEqual(calls.slice(-styleIds.length), styleIds);
      assert.equal(maximum, 1);
      assert.equal(wikiSearches.length, 1, 'only the chibi look searched, once');
      const chibi = (await js(`window.mori.load().then(r=>r.state.skins)`)).find(
        (s) => s.style === 'chibi-pet',
      );
      assert.equal(chibi.generation.chibiResearch.status, 'fallback');
      state = await js(`window.mori.load().then(r=>r.state)`);
      assert.equal(state.skins.length, 8 + styleIds.length);
      assert.ok(state.skins.every((s) => s.review.status === 'pending'));
      assert.equal(state.activeSkinId, '');
      assert.equal(state.characters[0].visualReferences[0].image, original);
      await js(`document.querySelector('.generation-batch').scrollIntoView({block:'start'})`);
      await capture('all-styles-ready.png');
      win.webContents.reload();
      await wait(`!!document.querySelector('.room-rail')`);
      assert.equal((await js(`window.mori.load().then(r=>r.state.skins)`)).length, 8 + styleIds.length);
      await finish();
    } catch (error) {
      await finish(error);
    }
  });
});
require('../electron/main.cjs');
