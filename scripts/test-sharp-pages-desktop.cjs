'use strict';
// Real Electron, real IPC, real asset protocol: a sharp pack spread over several atlas pages is
// moved out of the state into files on the first save, played on the stage through the
// mori-asset scheme, and an activity on a later page is loaded on demand in the desktop pet with
// its canvas still readable (click hit-testing). Synthetic images; no network.
const { app, BrowserWindow, safeStorage } = require('electron');
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const f = require('../tests/fixtures/pet-images.cjs');
const { partImage } = require('../tests/fixtures/pet-parts.cjs');
const { packFrames } = require('../electron/pet-frames.cjs');
const { referencePack, imageDigest } = require('../electron/references.cjs');
const { animationDigest } = require('../electron/animation-quality.cjs');
const dir = fs.mkdtempSync(path.resolve(__dirname, '../.local/sharp-pages-'));
process.env.MORI_DATA_DIR = dir;
delete process.env.MORI_DEV_URL;
safeStorage.isEncryptionAvailable = () => false;
let networkCalls = 0;
global.fetch = async () => {
  networkCalls++;
  throw Error('No network in the sharp pages test');
};
const stamp = '2026-11-08T00:00:00.000Z';
const original = f.url(f.image());
const character = {
  id: 'sharp-pages',
  name: '分页测试',
  work: '隔离验收',
  summary: '',
  personality: [],
  speakingStyle: '',
  appearance: '',
  quotes: [],
  sources: [],
  unknowns: [],
  behavior: { energy: 50, affection: 50, curiosity: 50 },
  createdAt: stamp,
  visualReferences: [{ id: 'identity', name: '原始参考', image: original, createdAt: stamp }],
};
const sharp = { transitionVersion: 3, quality: 'sharp', pagePixels: 60000 };
const packed = packFrames(
  original,
  {
    blink: [
      partImage({ columns: 2, rows: 1, cell: [192, 256], scale: 0.6 }),
      partImage({ columns: 2, rows: 1, cell: [192, 256], scale: 0.62, arm: 2 }),
    ],
    read: [partImage({}), partImage({ scale: 1.05, arm: 1 }), partImage({ scale: 0.97, arm: 2 })],
  },
  'chibi-pet',
  f.codec,
  sharp,
);
assert.ok(packed.sprite.pages?.length >= 1, 'the fixture pack has extra pages');
const pack = referencePack(character);
const skin = {
  id: 'sharp-pack',
  characterId: character.id,
  name: '分页清晰动作',
  style: 'chibi-pet',
  kind: 'image',
  images: { neutral: packed.image },
  sprite: packed.sprite,
  generated: true,
  createdAt: stamp,
  generation: {
    referenceIds: ['identity'],
    referenceDigest: pack.digest,
    model: 'fixture',
    prompt: 'fixture',
  },
  review: {
    status: 'approved',
    referenceDigest: pack.digest,
    imageDigest: imageDigest(packed.image),
    animationDigest: animationDigest(packed.sprite),
    animation: {
      frames: packed.sprite.frames.map((_, i) => i),
      anatomy: true,
      identity: true,
      continuity: true,
    },
    reviewedAt: stamp,
  },
};
fs.writeFileSync(
  path.join(dir, 'state.json'),
  JSON.stringify({
    settings: {
      llmBaseUrl: 'https://never-call.example/v1',
      llmModel: '',
      imageBaseUrl: '',
      imageModel: '',
      chatMode: 'local',
      demoMode: false,
      proactiveEnabled: false,
      voiceEnabled: false,
      motionEnabled: true,
      desktopLifeEnabled: false,
    },
    characters: [character],
    skins: [skin],
    activeCharacterId: character.id,
    activeSkinId: skin.id,
    messages: { [character.id]: [] },
    memories: [],
  }),
);
const exceptions = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (fn, label, tries = 200) => {
  for (let i = 0; i < tries; i++) {
    if (await fn()) return;
    await sleep(50);
  }
  throw Error('Timed out: ' + label);
};
let finished = false,
  started = false;
const timer = setTimeout(() => finish(Error('sharp pages timeout')), 90000);
function finish(error, extra = {}) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  const result = { passed: !error, networkCalls, exceptions, ...extra, error: error?.stack, artifacts: dir };
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  app.exit(error ? 1 : 0);
}
app.on('browser-window-created', (_e, win) => {
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', (_ev, level, message) => {
    if (level >= 3) exceptions.push(message.slice(0, 300));
  });
  if (win.getTitle() === 'Mori 桌宠' || started) return;
  started = true;
  win.webContents.once('did-finish-load', async () => {
    const report = { pages: packed.sprite.pages.length, frames: packed.sprite.frames.length };
    try {
      const js = (s) => win.webContents.executeJavaScript(s, true);
      await wait(() => js('!!document.querySelector(".room-rail")'), 'home');
      // The first save moves every atlas page out of the state into digest-named files.
      await js(
        'window.mori.load().then(r=>window.mori.saveSettings({...r.state.settings,proactiveEnabled:false},{}))',
      );
      await wait(() => {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
        return raw.skins[0].images.neutral.startsWith('mori-asset://skins/');
      }, 'atlas stored as a file');
      const raw = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
      const stored = raw.skins[0];
      assert.equal(stored.review.status, 'approved', 'storing the atlas keeps the review');
      for (const source of [stored.images.neutral, ...stored.sprite.pages.map((p) => p.src)]) {
        const sha = /skins\/([0-9a-f]{64})\.png$/.exec(source)[1];
        assert.equal(
          imageDigest(
            `data:image/png;base64,${fs.readFileSync(path.join(dir, 'skin-assets', `${sha}.png`)).toString('base64')}`,
          ),
          sha,
        );
      }
      report.stateBytes = fs.statSync(path.join(dir, 'state.json')).size;
      // The stage plays from the stored atlas.
      await wait(() => js('!!document.querySelector(".room-figure canvas[data-frame]")'), 'stage playing');
      assert.equal(
        await js('!!document.querySelector(".room-figure .sprite-fallback-note")'),
        false,
        'no playback failure',
      );
      // The desktop pet loads a later page when an activity on it starts.
      await js('window.mori.openPet()');
      let pet;
      await wait(() => {
        pet = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('pet=1'));
        return !!pet;
      }, 'pet');
      const pj = (s) => pet.webContents.executeJavaScript(s, true);
      await wait(() => pj('!!document.querySelector(\'[aria-label="桌宠读书"]\')'), 'pet toolbar');
      await wait(() => pj('!!document.querySelector(".pet-draggable canvas[data-frame]")'), 'pet playing');
      await pj('document.querySelector(\'[aria-label="桌宠读书"]\').click()');
      const readFrames = new Set(packed.sprite.clips.read.frames);
      await wait(
        async () =>
          readFrames.has(Number(await pj('document.querySelector(".pet-draggable canvas").dataset.frame'))),
        'reading frame drawn',
        300,
      );
      const drawn = Number(await pj('document.querySelector(".pet-draggable canvas").dataset.frame'));
      report.readFrame = drawn;
      report.readPage = packed.sprite.frames[drawn].page || 0;
      assert.ok(report.readPage >= 1, 'the activity lives on a later page');
      // Its pixels are readable: the stored atlas was loaded with CORS, so hit-testing works.
      const visible = await pj(
        `(() => { const c = document.querySelector('.pet-draggable canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++; return n; })()`,
      );
      report.visiblePixels = visible;
      assert.ok(visible > 100);
      fs.writeFileSync(path.join(dir, 'pet-reading.png'), (await pet.webContents.capturePage()).toPNG());
      assert.equal(networkCalls, 0);
      assert.deepEqual(exceptions, []);
      finish(null, report);
    } catch (e) {
      finish(e, report);
    }
  });
});
require('../electron/main.cjs');
