'use strict';
// Isolated native integration test with public-resource and provider fixtures; no paid API.
const { app, BrowserWindow, nativeImage, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const dir = path.resolve(__dirname, '../.local/visual-pipeline-smoke-' + randomUUID());
fs.mkdirSync(dir, { recursive: true });
process.env.MORI_DATA_DIR = dir;
delete process.env.MORI_DEV_URL;
const png = fs.readFileSync(path.resolve(__dirname, '../public/art/cyrene-reference-v3.png'));
let modelPosts = 0,
  rigPosts = 0,
  downloads = 0,
  failDownload = true;
const bytes = (() => {
  const positions = new Float32Array([-0.5, -0.8, 0, 0.5, -0.8, 0, 0, 0.8, 0]);
  const uv = new Float32Array([0, 0, 1, 0, 0.5, 1]);
  const texture = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
    'base64',
  );
  const geometryBytes = positions.byteLength + uv.byteLength;
  const binary = Buffer.alloc(Math.ceil((geometryBytes + texture.length) / 4) * 4);
  Buffer.from(positions.buffer).copy(binary);
  Buffer.from(uv.buffer).copy(binary, positions.byteLength);
  texture.copy(binary, geometryBytes);
  const data = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'GeneratedFixture' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorFactor: [0.7, 0.3, 0.5, 1],
          baseColorTexture: { index: 0 },
          metallicFactor: 0,
          roughnessFactor: 1,
        },
        doubleSided: true,
      },
    ],
    buffers: [{ byteLength: binary.length }],
    images: [{ bufferView: 2, mimeType: 'image/png' }],
    textures: [{ source: 0 }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: uv.byteLength },
      { buffer: 0, byteOffset: geometryBytes, byteLength: texture.length },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [-0.5, -0.8, 0],
        max: [0.5, 0.8, 0],
      },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' },
    ],
  };
  const json = Buffer.from(JSON.stringify(data)),
    padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32);
  json.copy(padded);
  const b = Buffer.alloc(28 + padded.length + binary.length);
  b.write('glTF');
  b.writeUInt32LE(2, 4);
  b.writeUInt32LE(b.length, 8);
  b.writeUInt32LE(padded.length, 12);
  b.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(b, 20);
  b.writeUInt32LE(binary.length, 20 + padded.length);
  b.writeUInt32LE(0x004e4942, 24 + padded.length);
  binary.copy(b, 28 + padded.length);
  return b;
})();
const json = (data) =>
  new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
global.fetch = async (url, init) => {
  if (url.includes('raw.githubusercontent.com')) {
    assert.equal(init.headers.Authorization, undefined);
    assert.equal(init.credentials, 'omit');
    return url.endsWith('characters.json')
      ? json({ 1415: { name: '昔涟', portrait: 'image/character_portrait/1415.png' } })
      : new Response(png, { headers: { 'Content-Type': 'image/png' } });
  }
  if (url.includes('api.github.com')) {
    assert.equal(init.headers.Authorization, undefined);
    return json({ size: png.length, encoding: 'base64', content: png.toString('base64') });
  }
  if (url.startsWith('https://cdn.mori.example/')) {
    downloads++;
    assert.equal(init.headers.Authorization, undefined);
    if (failDownload) {
      failDownload = false;
      throw new TypeError('Download interrupted once');
    }
    return new Response(bytes, { headers: { 'Content-Type': 'model/gltf-binary' } });
  }
  assert.ok(url.startsWith('https://model.mori.example/'));
  assert.equal(init.headers.Authorization, 'Bearer native-model-fixture');
  if (init.method === 'POST') {
    const body = JSON.parse(init.body);
    if (url.endsWith('/image-to-3d')) {
      modelPosts++;
      assert.deepEqual(Buffer.from(body.image_url.split(',')[1], 'base64'), png);
      return json({ result: 'mesh-fixture' });
    }
    rigPosts++;
    assert.equal(body.input_task_id, 'mesh-fixture');
    return json({ result: 'rig-fixture' });
  }
  return url.includes('/rigging/')
    ? json({
        id: 'rig-fixture',
        status: 'SUCCEEDED',
        progress: 100,
        result: { rigged_character_glb_url: 'https://cdn.mori.example/avatar.glb' },
      })
    : json({ id: 'mesh-fixture', status: 'SUCCEEDED', progress: 100 });
};
const dns = require('node:dns/promises');
const lookup = dns.lookup;
dns.lookup = (host, ...args) =>
  /mori\.example|raw\.githubusercontent\.com|api\.github\.com/.test(host)
    ? Promise.resolve([{ address: '93.184.215.14' }])
    : lookup(host, ...args);
let mainWindow;
const finished = (error) => {
  if (error) {
    console.error(error.stack);
    app.exit(1);
  } else {
    console.log(
      'Native visual pipeline passed: candidate collection, automatic name-matched reference, reload, source bytes, independent encrypted model key, generation/rig resumption, download retry, GLB installation and native rendering.',
    );
    console.log('Artifacts: ' + dir);
    app.exit(0);
  }
};
const timeout = setTimeout(() => finished(new Error('Native visual pipeline timed out')), 60000);
app.on('browser-window-created', (_event, win) => {
  // Animation state is read from the page; a window behind other apps must keep its frames.
  win.webContents.setBackgroundThrottling(false);
  if (mainWindow) return;
  mainWindow = win;
  const js = async (code) => {
    try {
      return await win.webContents.executeJavaScript(code, true);
    } catch (error) {
      console.error('Failed UI operation: ' + code.slice(0, 100));
      throw error;
    }
  };
  win.webContents.on('console-message', (event) => {
    if (event.level >= 2) console.error('Renderer: ' + event.message);
  });
  const wait = async (code) => {
    for (let i = 0; i < 250; i++) {
      if (await js(code)) return;
      await new Promise((r) => setTimeout(r, 80));
    }
    throw new Error('UI did not reach: ' + code);
  };
  const click = (label) =>
    js(
      `(()=>{const b=[...document.querySelectorAll('button')].find(b=>(b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)})&&!b.disabled);if(!b)throw new Error('Missing button '+${JSON.stringify(label)});b.click()})()`,
    );
  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(`!!document.querySelector('.room-rail')`);
      await wait(`window.mori.load().then(r=>!!r.state)`);
      await js(
        `window.mori.load().then(r=>window.mori.saveSettings({...r.state.settings,modelBaseUrl:'https://model.mori.example',modelVersion:'latest'}, {modelKey:'native-model-fixture'}))`,
      );
      await click('Mori 首页');
      await click('角色工作室');
      await click('角色档案');
      await wait(`!!document.querySelector('[aria-label="角色参考原图"]')`);
      await click('自动收集参考图');
      await wait(`window.mori.load().then(r=>r.state.characters[0].visualReferences?.length===1)`);
      const first = await js(`window.mori.load().then(r=>r.state.characters[0].visualReferences[0])`);
      assert.equal(first.match, 'name');
      assert.deepEqual(Buffer.from(first.image.split(',')[1], 'base64'), png);
      assert.ok(nativeImage.createFromDataURL(first.image).getSize().width > 384);
      fs.writeFileSync(
        path.join(dir, 'automatic-reference.png'),
        (await win.webContents.capturePage()).toPNG(),
      );
      await click('直接使用主参考作为立绘');
      await wait(
        `window.mori.load().then(r=>r.state.skins.find(s=>s.id===r.state.activeSkinId)?.name.includes('来源原图'))`,
      );
      const portrait = await js(
        `window.mori.load().then(r=>r.state.skins.find(s=>s.id===r.state.activeSkinId))`,
      );
      assert.equal(portrait.kind, 'image');
      assert.deepEqual(Buffer.from(portrait.images.neutral.split(',')[1], 'base64'), png);
      assert.equal(modelPosts + rigPosts, 0);
      assert.doesNotMatch(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'), /native-model-fixture/);
      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = fs.readFileSync(path.join(dir, 'credentials.enc.json'), 'utf8');
        assert.doesNotMatch(encrypted, /native-model-fixture/);
        const envelope = JSON.parse(encrypted);
        assert.equal(
          JSON.parse(safeStorage.decryptString(Buffer.from(envelope.data, 'base64'))).modelKey,
          'native-model-fixture',
        );
      }
      await new Promise((resolve) => {
        win.webContents.once('did-finish-load', resolve);
        win.webContents.reload();
      });
      await wait(`!!document.querySelector('.room-rail')`);
      assert.equal((await js(`window.mori.load().then(r=>r.keys)`)).modelKey, true);
      await click('Mori 首页');
      await click('角色工作室');
      await click('外观与动作');
      await wait(`!!document.querySelector('[aria-label="制作 3D 模型"]')`);
      await click('制作 3D 模型');
      await wait(`!!document.querySelector('[aria-label="为昔涟制作 3D 模型"]')`);
      await click('开始建模并绑定');
      await wait(`document.body.textContent.includes('mesh-fixture')`);
      // Query explicitly rather than waiting for the timed polling loop.
      await click('查询进度');
      await wait(`document.body.textContent.includes('rig-fixture')`);
      await click('查询进度');
      await wait(`document.querySelector('.inline-error')?.textContent.includes('下载')`);
      await click('查询进度');
      await wait(`document.body.textContent.includes('模型已就绪')`);
      assert.equal(modelPosts, 1);
      assert.equal(rigPosts, 1);
      assert.equal(downloads, 2);
      fs.writeFileSync(path.join(dir, 'model-ready.png'), (await win.webContents.capturePage()).toPNG());
      await click('保存模型并预览');
      await wait(`!document.querySelector('[aria-label="为昔涟制作 3D 模型"]')`);
      await wait(
        `document.querySelector('.avatar-stage.glb canvas') && !document.querySelector('.avatar-stage.glb .model-status')`,
      );
      const state = await js(`window.mori.load().then(r=>r.state)`),
        skin = state.skins.find((s) => s.id === state.activeSkinId);
      assert.equal(skin.kind, 'glb');
      assert.ok(fs.existsSync(path.join(dir, 'models', skin.model.id, 'avatar.glb')));
      assert.deepEqual(require('../electron/persona.cjs').availableActions(skin), ['idle']);
      fs.writeFileSync(path.join(dir, 'generated-glb.png'), (await win.webContents.capturePage()).toPNG());
      await js(`window.mori.openPet()`);
      const pet = BrowserWindow.getAllWindows().find((w) => w !== win);
      assert.ok(pet, 'The generated model can open in the native transparent pet');
      if (pet.webContents.isLoadingMainFrame())
        await new Promise((resolve) => pet.webContents.once('did-finish-load', resolve));
      let petReady = false;
      for (let i = 0; i < 200; i++) {
        petReady = await pet.webContents.executeJavaScript(
          `(()=>{const c=document.querySelector('.pet-draggable .avatar-stage.glb canvas');return !!c && c.clientWidth>100 && c.clientHeight>100 && !document.querySelector('.pet-draggable .model-status')})()`,
        );
        if (petReady) break;
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
      assert.equal(petReady, true, 'A textured GLB loads at usable dimensions in the pet window');
      fs.writeFileSync(
        path.join(dir, 'generated-glb-pet.png'),
        (await pet.webContents.capturePage()).toPNG(),
      );
      await click('制作 3D 模型');
      await wait(`document.body.textContent.includes('模型已就绪')`);
      assert.equal(modelPosts, 1);
      assert.equal(rigPosts, 1);
      clearTimeout(timeout);
      finished();
    } catch (error) {
      clearTimeout(timeout);
      finished(error);
    }
  });
});
require('../electron/main.cjs');
