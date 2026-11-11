'use strict';
// Real PNGs, native dialogs/IPC, preview, persisted wardrobe and pet. No network.
const { app, BrowserWindow, dialog, nativeImage, safeStorage, clipboard } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const dir = path.resolve(__dirname, '../.local/art-workflow-smoke-' + randomUUID());
const pack = path.join(dir, 'original-frames');
fs.mkdirSync(dir, { recursive: true });
process.env.MORI_DATA_DIR = dir;
delete process.env.MORI_DEV_URL;
safeStorage.isEncryptionAvailable = () => false;
global.fetch = async () => {
  throw new Error('Asset workflow must not call a remote API');
};
dialog.showOpenDialog = async (_win, options) => {
  assert.deepEqual(options.properties, ['openDirectory']);
  return { canceled: false, filePaths: [pack] };
};
const timestamp = new Date().toISOString();
const character = {
  id: 'art-native',
  name: '素材导入测试',
  work: '隔离测试',
  summary: '',
  appearance: '粉色头发，白色衣服',
  speakingStyle: '',
  personality: [],
  quotes: [],
  sources: [],
  unknowns: [],
  behavior: { energy: 50, affection: 50, curiosity: 50 },
  createdAt: timestamp,
};
fs.writeFileSync(
  path.join(dir, 'state.json'),
  JSON.stringify({
    settings: {
      llmBaseUrl: '',
      llmModel: '',
      imageBaseUrl: '',
      imageModel: '',
      demoMode: false,
      proactiveEnabled: false,
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
const authored = [];
for (const [clip, number, color] of [
  ['idle', 1, [50, 90, 210]],
  ['wave', 1, [60, 100, 220]],
  ['wave', 2, [70, 110, 230]],
  ['wave', 10, [80, 120, 240]],
  ['talk', 1, [90, 130, 200]],
  ['talk', 2, [100, 140, 190]],
]) {
  const bitmap = Buffer.alloc(64 * 96 * 4);
  for (let y = 12; y < 90; y++)
    for (let x = 15; x < 49; x++) {
      const i = (y * 64 + x) * 4;
      bitmap[i] = color[0];
      bitmap[i + 1] = color[1];
      bitmap[i + 2] = color[2];
      bitmap[i + 3] = 255;
    }
  const image = nativeImage.createFromBitmap(bitmap, { width: 64, height: 96, scaleFactor: 1 });
  const png = image.toPNG();
  fs.mkdirSync(path.join(pack, clip), { recursive: true });
  fs.writeFileSync(path.join(pack, clip, `${number}.png`), png);
  authored.push(nativeImage.createFromBuffer(png).toBitmap());
}
fs.writeFileSync(
  path.join(pack, 'pet.json'),
  JSON.stringify({
    name: '测试原作动画',
    frameDuration: 120,
    clips: { wave: { durations: [100, 300, 100] } },
  }),
);
let win;
const deadline = setTimeout(() => finish(new Error('Native art workflow timed out')), 60000);
async function finish(error) {
  clearTimeout(deadline);
  if (error) {
    console.error(error.stack);
    if (win && !win.isDestroyed())
      console.error((await win.webContents.executeJavaScript('document.body.innerText')).slice(-2500));
  } else
    console.log(
      'Native asset workflow passed: current style briefs, copied character instructions, no API keys/network, original PNG pixels/transparency, natural order, action preview, smooth filtering, explicit save/use, wardrobe reload and pet playback.',
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
    for (let i = 0; i < 200; i++) {
      if (await js(code)) return;
      await new Promise((r) => setTimeout(r, 70));
    }
    throw new Error('UI did not reach ' + code);
  };
  const click = (label) =>
    js(
      `(()=>{const b=[...document.querySelectorAll('button')].find(b=>(b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)})&&!b.disabled);if(!b)throw new Error('Missing '+${JSON.stringify(label)});b.click()})()`,
    );
  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(`!!document.querySelector('.room-rail')`);
      await click('Demiurge 首页');
      await click('角色工作室');
      await click('外观与动作');
      await click('打开桌宠工作台');
      await click('导入与工具');
      await wait(`document.querySelectorAll('.art-style-picker button').length===4`);
      for (const name of ['原作', '8bit', '3D', 'Q版']) {
        await click('素材画风：' + name);
        assert.ok(
          await js(
            `document.querySelector('.art-style-brief').textContent.includes(${JSON.stringify(name)})`,
          ),
        );
      }
      await click('素材画风：原作');
      await click('复制角色制作说明');
      await wait(`!!document.querySelector('[role="status"]')`);
      assert.ok(clipboard.readText().includes('粉色头发'));
      assert.ok(clipboard.readText().includes('original'));
      await click('PNG 动作文件夹');
      await wait(`!!document.querySelector('.art-import-preview canvas[data-frame]')`);
      await js(
        `document.querySelector('.candidate-animation').scrollIntoView({block:'center',behavior:'instant'})`,
      );
      assert.equal(
        (await js(`window.mori.load().then(r=>r.state)`)).skins.length,
        0,
        'Preview must not save or activate automatically',
      );
      assert.ok(
        await js(
          `document.querySelector('.candidate-animation canvas').getContext('2d').imageSmoothingEnabled`,
        ),
      );
      assert.ok(await js(`document.querySelector('[aria-label="预览点头动作"]').disabled`));
      await click('预览招手动作');
      await wait(`document.querySelector('.candidate-animation canvas').dataset.clip==='wave'`);
      await click('试播说话');
      await wait(`document.querySelector('.candidate-animation canvas').dataset.clip==='talk'`);
      await click('试播说话');
      await click('预览待机动作');
      fs.writeFileSync(path.join(dir, 'asset-preview.png'), (await win.webContents.capturePage()).toPNG());
      await click('保存到衣橱');
      await wait(`!document.querySelector('.art-workflow')`);
      let state = await js(`window.mori.load().then(r=>r.state)`);
      assert.equal(state.skins.length, 1);
      assert.equal(state.activeSkinId, '');
      const skin = state.skins[0];
      assert.equal(skin.style, 'original');
      assert.equal(skin.sprite.pixelated, false);
      assert.equal(skin.generation, undefined);
      // Saved atlases live in digest-named files next to the state.
      const stored = /^mori-asset:\/\/skins\/([0-9a-f]{64})\.png$/.exec(skin.images.neutral);
      assert.ok(stored, 'the saved atlas is stored as a file');
      const atlas = nativeImage.createFromBuffer(
        fs.readFileSync(path.join(dir, 'skin-assets', stored[1] + '.png')),
      );
      for (const [i, bitmap] of authored.entries()) {
        const [x, y, width, height] = skin.sprite.frames[i].rect;
        assert.deepEqual(
          atlas.crop({ x, y, width, height }).toBitmap(),
          bitmap,
          'Packed pixels must equal the original authored frame',
        );
      }
      assert.deepEqual(skin.sprite.clips.wave.frames, [1, 2, 3]);
      assert.deepEqual(skin.sprite.clips.wave.durations, [100, 300, 100]);
      await click('打开桌宠工作台');
      await click('导入与工具');
      await click('素材画风：原作');
      await click('PNG 动作文件夹');
      await wait(`!!document.querySelector('.art-import-preview canvas[data-frame]')`);
      await click('保存并使用此外观');
      await wait(`!document.querySelector('.art-workflow')`);
      state = await js(`window.mori.load().then(r=>r.state)`);
      assert.equal(state.skins.length, 2);
      assert.equal(state.activeSkinId, state.skins[1].id);
      await js(`window.mori.openPet()`);
      let pet;
      for (let i = 0; i < 120; i++) {
        pet = BrowserWindow.getAllWindows().find((w) => w !== win);
        if (
          pet &&
          !pet.webContents.isLoading() &&
          (await pet.webContents.executeJavaScript(`!!document.querySelector('canvas[data-frame]')`))
        )
          break;
        await new Promise((r) => setTimeout(r, 80));
      }
      assert.ok(pet);
      assert.ok(await pet.webContents.executeJavaScript(`!!document.querySelector('canvas[data-frame]')`));
      win.webContents.reload();
      await wait(`!!document.querySelector('.room-rail')`);
      state = await js(`window.mori.load().then(r=>r.state)`);
      assert.equal(state.skins.length, 2);
      assert.equal(state.skins[1].style, 'original');
      assert.equal(state.settings.demoMode, false);
      await finish();
    } catch (error) {
      await finish(error);
    }
  });
});
require('../electron/main.cjs');
