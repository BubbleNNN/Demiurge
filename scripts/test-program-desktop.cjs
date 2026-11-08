'use strict';
// Actual Electron render/IPC/persistence; isolated workspace, mocked chat vision.
const { app, safeStorage, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const drawing = require('../tests/fixtures/pixel-program.cjs');
const dir = path.resolve(__dirname, '../.local/program-smoke-' + randomUUID());
fs.mkdirSync(dir, { recursive: true });
process.env.MORI_DATA_DIR = dir;
delete process.env.MORI_DEV_URL;
safeStorage.isEncryptionAvailable = () => false;
const png = fs.readFileSync(path.resolve(__dirname, '../public/art/cyrene-chibi.png'));
const original = 'data:image/png;base64,' + png.toString('base64'),
  timestamp = new Date().toISOString();
fs.writeFileSync(
  path.join(dir, 'state.json'),
  JSON.stringify({
    settings: {
      llmBaseUrl: 'https://program.mori.example/exact',
      llmEndpointMode: 'exact',
      llmProtocol: 'anthropic',
      llmAuthMode: 'bearer',
      llmModel: 'vision-fixture',
      imageBaseUrl: '',
      imageModel: '',
      demoMode: false,
      proactiveEnabled: false,
      motionEnabled: true,
    },
    characters: [
      {
        id: 'program-native',
        name: '程序动画测试',
        work: '隔离测试',
        summary: '',
        appearance: '',
        speakingStyle: '',
        personality: [],
        quotes: [],
        sources: [],
        unknowns: [],
        behavior: { energy: 50, affection: 50, curiosity: 50 },
        createdAt: timestamp,
        visualReferences: [{ id: 'original', name: 'original.png', image: original, createdAt: timestamp }],
      },
    ],
    skins: [],
    activeCharacterId: 'program-native',
    activeSkinId: '',
    messages: { 'program-native': [] },
    memories: [],
  }),
);
let calls = 0,
  win;
global.fetch = async (url, init) => {
  assert.equal(url, 'https://program.mori.example/exact');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, 'Bearer program-fixture-key');
  const body = JSON.parse(init.body),
    content = body.messages[0].content;
  assert.equal(content[0].source.data, png.toString('base64'));
  assert.equal(content[0].source.media_type, 'image/png');
  calls++;
  return new Response(
    JSON.stringify({
      content: [
        {
          type: 'text',
          text: JSON.stringify(drawing(content.at(-1).text.includes('"width":64') ? 'pixel' : '8bit')),
        },
      ],
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
};
const deadline = setTimeout(() => finish(new Error('Program native test timed out')), 60000);
async function finish(error) {
  clearTimeout(deadline);
  if (error) {
    console.error(error.stack);
    if (win && !win.isDestroyed())
      console.error((await win.webContents.executeJavaScript('document.body.innerText')).slice(-3500));
  } else
    console.log(
      'Native program passed: existing chat key only, exact URL, original image bytes, two pixel styles, 6 actions/6 expressions, real canvas playback, review gate, pet playback and persisted reload.',
    );
  console.log('Artifacts: ' + dir);
  app.exit(error ? 1 : 0);
}
app.on('browser-window-created', (_event, created) => {
  if (win) return;
  win = created;
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const wait = async (code) => {
    for (let n = 0; n < 180; n++) {
      if (await js(code)) return;
      await new Promise((r) => setTimeout(r, 80));
    }
    throw new Error('UI did not reach ' + code);
  };
  const click = (label) =>
    js(
      `(()=>{const b=[...document.querySelectorAll('button')].find(b=>(b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)})&&!b.disabled);if(!b)throw new Error('Missing button '+${JSON.stringify(label)});b.click()})()`,
    );
  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(`!!document.querySelector('.room-rail')`);
      await js(
        `window.mori.load().then(r=>window.mori.saveSettings(r.state.settings,{llmKey:'program-fixture-key'}))`,
      );
      await click('Mori 首页');
      await click('角色工作室');
      await click('外观与动作');
      await click('制作立绘与像素动画');
      await click('聊天模型 · 程序像素动画');
      await wait(`document.querySelectorAll('.style-option').length===2`);
      assert.ok(
        await js(
          `document.querySelector('.generation-method[aria-pressed="true"]').textContent.includes('程序像素')`,
        ),
      );
      await click('全选画风');
      await click('用 1 张原图制作 2 份动画候选');
      await wait(
        `document.querySelectorAll('.generation-batch-item.saved').length===2&&!document.querySelector('.progress-card')`,
      );
      assert.equal(calls, 2);
      let state = await js(`window.mori.load().then(r=>r.state)`);
      assert.equal(state.skins.length, 2);
      assert.equal(state.activeSkinId, '');
      assert.ok(
        state.skins.every(
          (s) =>
            s.review.status === 'pending' &&
            s.generation.mode === 'program' &&
            Object.keys(s.sprite.clips).length === 14,
        ),
      );
      await js(
        `document.querySelector('.candidate-animation').scrollIntoView({block:'center',behavior:'instant'})`,
      );
      await wait(`!!document.querySelector('.candidate-animation canvas[data-frame]')`);
      for (const [action, label] of [
        ['wave', '招手'],
        ['nod', '点头'],
        ['shake', '摇头'],
        ['bounce', '跳跃'],
        ['sleep', '睡眠'],
      ]) {
        await click('预览' + label + '动作');
        await wait(
          `document.querySelector('.candidate-animation canvas[data-clip]')?.dataset.clip===${JSON.stringify(action)}`,
        );
      }
      await click('预览待机动作');
      await click('惊讶');
      await wait(
        `document.querySelector('.candidate-animation canvas[data-clip]')?.dataset.clip==='surprised'`,
      );
      await click('试播说话');
      await wait(`document.querySelector('.candidate-animation canvas[data-clip]')?.dataset.clip==='talk'`);
      await click('试播说话');
      await click('预览待机动作');
      await new Promise((r) => setTimeout(r, 350));
      fs.writeFileSync(
        path.join(dir, 'animation-preview.png'),
        (await win.webContents.capturePage()).toPNG(),
      );
      await js(
        `(()=>{const input=document.querySelector('[aria-label="程序动画修正意见"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'修正眼睛重复，保留服装');input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      await click('按意见修正动画（1 次聊天请求）');
      await wait(
        `window.mori.load().then(r=>r.state.skins.length===3&&!document.querySelector('.progress-card'))`,
      );
      state = await js(`window.mori.load().then(r=>r.state)`);
      assert.equal(calls, 3);
      assert.ok(state.skins.at(-1).generation.parentSkinId);
      assert.ok(state.skins.at(-1).drawing);
      await js(`document.querySelectorAll('.identity-checks input').forEach(input=>input.click())`);
      await click('确认基准并使用');
      await wait(`!document.querySelector('.progress-card')&&!document.querySelector('.identity-checks')`);
      assert.equal(
        await js(`Boolean(document.querySelector('.expression-preview'))`),
        false,
        'Program animation does not require image API expression generation',
      );
      state = await js(`window.mori.load().then(r=>r.state)`);
      assert.ok(state.activeSkinId);
      assert.equal(state.skins.find((s) => s.id === state.activeSkinId).review.status, 'approved');
      await click('关闭弹窗');
      await wait(`!!document.querySelector('.scene-artwork canvas[data-frame]')`);
      await js(`window.mori.openPet()`);
      let pet;
      for (let n = 0; n < 100; n++) {
        pet = BrowserWindow.getAllWindows().find((w) => w !== win);
        if (
          pet &&
          !pet.webContents.isLoading() &&
          (await pet.webContents.executeJavaScript(`!!document.querySelector('canvas[data-frame]')`))
        )
          break;
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.ok(pet);
      assert.ok(await pet.webContents.executeJavaScript(`!!document.querySelector('canvas[data-frame]')`));
      win.webContents.reload();
      await wait(`!!document.querySelector('.room-rail')`);
      state = await js(`window.mori.load().then(r=>r.state)`);
      assert.equal(state.skins.length, 3);
      assert.equal(state.characters[0].visualReferences[0].image, original);
      assert.equal(calls, 3);
      await finish();
    } catch (error) {
      await finish(error);
    }
  });
});
require('../electron/main.cjs');
