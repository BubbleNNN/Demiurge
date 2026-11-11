'use strict';
// Isolated native checks for pixel retention and the real review UI/IPC path.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const fixture = require('../tests/fixtures/pet-images.cjs');
const root = path.resolve(__dirname, '..');
const dir = path.join(root, '.local', 'animation-quality-' + randomUUID());
const output = path.join(root, 'artifacts/animation/quality-v2');
fs.mkdirSync(dir, { recursive: true });
fs.mkdirSync(output, { recursive: true });
process.env.MORI_DATA_DIR = dir;
process.env.MORI_DEV_VIEW = 'wardrobe';
delete process.env.MORI_DEV_URL;
let requests = 0,
  started = false;
global.fetch = async () => {
  requests++;
  throw new Error('Quality regression must not call a provider');
};
const timeout = setTimeout(() => {
  console.error('Animation quality regression timed out');
  app.exit(1);
}, 60000);
app.on('browser-window-created', (_, win) => {
  // Animation state is read from the page; a window behind other apps must keep its frames.
  win.webContents.setBackgroundThrottling(false);
  if (started) return;
  started = true;
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const wait = async (code) => {
    for (let i = 0; i < 200; i++) {
      if (await js(code)) return;
      await new Promise((r) => setTimeout(r, 40));
    }
    throw new Error('Timeout: ' + code.slice(0, 140));
  };
  const click = (label) =>
    js(
      `(()=>{const b=[...document.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')===${JSON.stringify(label)}||b.textContent.trim()===${JSON.stringify(label)})&&!b.disabled);if(!b)throw new Error('Missing '+${JSON.stringify(label)});b.click()})()`,
    );
  const canvas =
    'document.querySelector(".workbench-stage .animated-illustration canvas:not(.canvas-pending)")';
  win.webContents.once('did-finish-load', async () => {
    try {
      await wait('window.mori.load().then(r=>!!r.state)');
      const base = await js('window.mori.load().then(r=>r.state)');
      const bytes = fs.readFileSync(path.join(root, 'public/art/cyrene-original-v1.png'));
      const image = fixture.url(bytes),
        digest = createHash('sha256').update(bytes).digest('hex');
      const character = {
        ...base.characters[0],
        visualReferences: [
          { id: 'quality-ref', name: '原始像素测试参考', image, createdAt: new Date().toISOString() },
        ],
      };
      const imported = {
        id: 'native-hd',
        characterId: character.id,
        name: 'Native HD texture fixture',
        style: 'anime',
        kind: 'image',
        generated: false,
        createdAt: new Date().toISOString(),
        images: { neutral: image },
        sprite: {
          width: 128,
          height: 192,
          frames: [
            { rect: [0, 0, 1024, 1536], duration: 100 },
            { rect: [0, 0, 1024, 1536], duration: 140 },
          ],
          clips: { idle: { frames: [0], loop: true }, talk: { frames: [0, 1], loop: true } },
        },
      };
      const saveSkin = (skin) =>
        js(
          `window.mori.load().then(({state})=>window.mori.save({...state,characters:[${JSON.stringify(character)},...state.characters.slice(1)],skins:[...state.skins.filter(s=>s.id!==${JSON.stringify(skin.id)}),${JSON.stringify(skin)}],activeSkinId:${JSON.stringify(skin.id)}}))`,
        );
      await saveSkin(imported);
      await js(`document.querySelector('.workbench').scrollIntoView({block:'center',behavior:'instant'})`);
      await wait(`${canvas}?.dataset.skin==='native-hd'`);
      assert.equal(
        await js(`${canvas}.dataset.sourceSize`),
        '1024x1536',
        'Tiny logical dimensions must not destroy a real HD texture',
      );
      const small = {
        ...imported,
        id: 'native-small',
        name: 'Low source resolution fixture',
        images: { neutral: fixture.url(fixture.image()) },
        sprite: {
          ...imported.sprite,
          width: 32,
          height: 32,
          frames: [{ rect: [0, 0, 128, 128], duration: 100 }],
          clips: { idle: { frames: [0], loop: true } },
        },
      };
      await saveSkin(small);
      await wait(
        `${canvas}?.dataset.skin==='native-small' && !!document.querySelector('.workbench-stage .sprite-resolution-note')`,
      );
      assert.ok(Number(await js(`${canvas}.dataset.upscale`)) > 1.25);
      assert.equal(await js(`${canvas}.dataset.sourceSize`), '128x128');
      const pixel = {
        ...small,
        id: 'native-pixel',
        style: '8bit',
        sprite: { ...small.sprite, width: 48, height: 64, pixelated: true },
      };
      await saveSkin(pixel);
      await wait(`${canvas}?.dataset.skin==='native-pixel'`);
      assert.equal(await js(`${canvas}.dataset.sourceSize`), '48x64');
      assert.equal(await js(`!!document.querySelector('.workbench-stage .sprite-resolution-note')`), false);
      const { referencePack } = require('../electron/references.cjs');
      const candidate = {
        ...imported,
        id: 'native-candidate',
        name: 'Pending animation quality fixture',
        generated: true,
        generation: {
          referenceIds: ['quality-ref'],
          referenceDigest: referencePack(character).digest,
          model: 'offline-fixture',
          prompt: 'Native quality gate fixture, no generation request',
        },
        review: { status: 'pending', referenceDigest: referencePack(character).digest, imageDigest: digest },
      };
      await saveSkin(candidate);
      const blocked = await js(
        `window.mori.reviewSkin({characterId:${JSON.stringify(character.id)},skinId:'native-candidate',decision:'approved'}).then(()=>false,e=>e.message)`,
      );
      assert.match(blocked, /逐帧|变化/, 'Calling IPC directly cannot skip the gate');
      await click('打开桌宠工作台');
      await click('导入与工具');
      await click('绘图实验');
      await wait(
        `document.querySelectorAll('.frame-review-grid input').length===2 && !!document.querySelector('.frame-review-grid canvas')`,
      );
      const confirm = `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='确认基准并使用')`;
      await js(
        `[...document.querySelectorAll('.identity-checks input,.frame-review .generation-checks input')].forEach(el=>el.click())`,
      );
      assert.equal(await js(`${confirm}.disabled`), true);
      await js(`document.querySelectorAll('.frame-review-grid input')[0].click()`);
      assert.equal(await js(`${confirm}.disabled`), true, 'One unreviewed frame must keep release disabled');
      await js(`document.querySelectorAll('.frame-review-grid input')[1].click()`);
      await wait(`!${confirm}.disabled`);
      await js(`document.querySelector('.frame-review').scrollIntoView({block:'center',behavior:'instant'})`);
      fs.writeFileSync(path.join(output, 'frame-review.png'), (await win.webContents.capturePage()).toPNG());
      await click('确认基准并使用');
      await wait(
        `window.mori.load().then(r=>r.state.skins.find(s=>s.id==='native-candidate')?.review.status==='approved')`,
      );
      const approved = await js(
        `window.mori.load().then(r=>r.state.skins.find(s=>s.id==='native-candidate'))`,
      );
      assert.deepEqual(approved.review.animation.frames, [0, 1]);
      assert.equal(approved.review.animation.anatomy, true);
      const altered = {
        ...approved,
        sprite: {
          ...approved.sprite,
          clips: { ...approved.sprite.clips, idle: { frames: [1], loop: true } },
        },
      };
      const mutation = await saveSkin(altered).then(
        () => false,
        (e) => e.message,
      );
      assert.match(mutation, /时序|逐帧|改变/);
      assert.equal(requests, 0);
      const result = {
        nativeHDTexture: '1024x1536 (logical 128x192)',
        nativeLowResolutionWarning: true,
        pixelGridPreserved: '48x64',
        missingFrameBlocksUI: true,
        directIPCBlocksSkippedReview: true,
        approvedFramesPersisted: [0, 1],
        changedTimelineInvalidatesReview: true,
        requests,
      };
      fs.writeFileSync(path.join(output, 'native-verification.json'), JSON.stringify(result, null, 2) + '\n');
      console.log(JSON.stringify(result));
      clearTimeout(timeout);
      app.exit(0);
    } catch (e) {
      clearTimeout(timeout);
      fs.writeFileSync(path.join(output, 'error.png'), (await win.webContents.capturePage()).toPNG());
      console.error(e.stack);
      app.exit(1);
    }
  });
});
require('../electron/main.cjs');
