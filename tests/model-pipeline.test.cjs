'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createServices } = require('../electron/services.cjs');
const { createModelPipeline } = require('../electron/model-pipeline.cjs');
const { validateGlb } = require('../electron/models.cjs');
const { availableActions } = require('../electron/persona.cjs');
const image =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const character = { id: 'hero', name: '小森', visualReferences: [{ id: 'ref', image }] };
const settings = { modelBaseUrl: 'https://model.example', modelVersion: 'latest' },
  credentials = { modelKey: 'model-secret', llmKey: 'chat-secret' };
const json = (data) =>
  new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
async function folder(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mori-model-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
function glb(data) {
  const text = Buffer.from(JSON.stringify(data)),
    padded = Buffer.alloc(Math.ceil(text.length / 4) * 4, 32);
  text.copy(padded);
  const b = Buffer.alloc(20 + padded.length);
  b.write('glTF');
  b.writeUInt32LE(2, 4);
  b.writeUInt32LE(b.length, 8);
  b.writeUInt32LE(padded.length, 12);
  b.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(b, 20);
  return b;
}

test('model creation uses only dedicated credentials and real reference pixels; polling resumes after reopening without extra POSTs', async (t) => {
  const root = await folder(t),
    calls = [];
  const bytes = glb({
    asset: { version: '2.0' },
    meshes: [{ primitives: [] }],
    nodes: [{ name: 'Head' }],
    skins: [{ joints: [0] }],
  });
  const services = createServices(
    async (url, init) => {
      calls.push({ url, init });
      if (url.includes('cdn.example')) {
        assert.equal(init.headers.Authorization, undefined);
        assert.equal(init.credentials, 'omit');
        return new Response(bytes);
      }
      assert.equal(init.headers.Authorization, 'Bearer model-secret');
      if (init.method === 'POST') {
        const data = JSON.parse(init.body);
        if (url.endsWith('/image-to-3d')) {
          assert.equal(data.image_url, image);
          assert.equal(data.image_enhancement, false);
          assert.equal(data.pose_mode, 'a-pose');
          return json({ result: 'mesh-task' });
        }
        assert.deepEqual(data, { input_task_id: 'mesh-task', height_meters: 1.7 });
        return json({ result: 'rig-task' });
      }
      return url.includes('/rigging/')
        ? json({
            id: 'rig-task',
            status: 'SUCCEEDED',
            result: { rigged_character_glb_url: 'https://cdn.example/model.glb' },
          })
        : json({ id: 'mesh-task', status: 'SUCCEEDED', progress: 100 });
    },
    { resolveHost: async () => [{ address: '93.184.215.14' }] },
  );
  let installs = 0;
  const installBytes = async (b) => {
    installs++;
    assert.deepEqual(b, bytes);
    return { id: 'skin', kind: 'glb' };
  };
  let pipeline = createModelPipeline({ root, services, installBytes });
  const job = await pipeline.start(character, settings, credentials);
  await assert.rejects(pipeline.start(character, settings, credentials), /已有未完成任务/);
  pipeline = createModelPipeline({ root, services, installBytes });
  const rig = await pipeline.advance(job.id, settings, credentials);
  assert.equal(rig.status, 'rigging');
  pipeline = createModelPipeline({ root, services, installBytes });
  const completed = await pipeline.advance(job.id, settings, credentials);
  assert.equal(completed.status, 'ready');
  await pipeline.advance(job.id, settings, credentials);
  assert.equal(calls.filter((c) => c.init.method === 'POST').length, 2);
  assert.equal(installs, 1);
  assert.doesNotMatch(
    await fs.readFile(path.join(root, `${job.id}.json`), 'utf8'),
    /model-secret|chat-secret|data:image/,
  );
});

test('download retry retains completed model and rig IDs and does not create another paid task', async (t) => {
  const root = await folder(t);
  let posts = 0,
    downloads = 0;
  const services = {
    modelConfiguration() {},
    async createModelTask() {
      posts++;
      return 'mesh-task';
    },
    async createRigTask() {
      posts++;
      return 'rig-task';
    },
    async getModelTask(phase) {
      return {
        status: 'SUCCEEDED',
        result: phase === 'rigging' ? { rigged_character_glb_url: 'https://cdn.example/model.glb' } : {},
      };
    },
    async downloadModel() {
      if (++downloads === 1) throw new Error('连接中断');
      return Buffer.from('model');
    },
  };
  const pipeline = createModelPipeline({ root, services, installBytes: async () => ({ id: 'skin' }) });
  const job = await pipeline.start(character, settings, credentials);
  await pipeline.advance(job.id, settings, credentials);
  await assert.rejects(pipeline.advance(job.id, settings, credentials), /连接中断/);
  assert.equal((await pipeline.advance(job.id, settings, credentials)).status, 'ready');
  assert.equal(posts, 2);
  assert.equal(downloads, 2);
});

test('missing reference/key cannot submit, ambiguous creation is preserved and changed endpoints cannot receive credentials', async (t) => {
  const root = await folder(t);
  let calls = 0;
  const services = createServices(async () => {
    calls++;
    throw new Error('Connection lost after submission');
  });
  const pipeline = createModelPipeline({ root, services, installBytes: async () => ({}) });
  await assert.rejects(
    pipeline.start({ ...character, visualReferences: [] }, settings, credentials),
    /主参考/,
  );
  await assert.rejects(pipeline.start(character, settings, {}), /Meshy/);
  assert.equal(calls, 0);
  const job = await pipeline.start(character, settings, credentials);
  assert.equal(job.status, 'uncertain');
  await assert.rejects(pipeline.start(character, settings, credentials), /已有未完成任务/);
  await assert.rejects(
    pipeline.advance(job.id, { modelBaseUrl: 'https://other.example' }, credentials),
    /地址已改变/,
  );
  assert.equal(calls, 1);
});

test('generated GLB rejects external resources and advertises only actual clips or an existing head bone', () => {
  const data = {
    asset: { version: '2.0' },
    meshes: [{ primitives: [] }],
    nodes: [{ name: 'mixamorig:Head' }],
    skins: [{ joints: [0] }],
    animations: [{ name: 'Wave' }],
  };
  const model = validateGlb(glb(data));
  assert.equal(model.boneMap.head, 'mixamorig:Head');
  assert.equal(model.motionMap.wave, 'Wave');
  assert.deepEqual(availableActions({ kind: 'glb', model }), ['idle', 'nod', 'shake', 'wave']);
  assert.deepEqual(availableActions({ kind: 'glb', model: { motions: {}, motionMap: {}, boneMap: {} } }), [
    'idle',
  ]);
  assert.throws(
    () => validateGlb(glb({ ...data, images: [{ uri: 'https://private.example/texture.png' }] })),
    /外部贴图/,
  );
  assert.throws(() => validateGlb(glb({ ...data, buffers: [{ uri: '../secret.bin' }] })), /外部缓冲区/);
});

test('an uncertain creation can attach a provider-confirmed ID without submitting another task', async (t) => {
  const root = await folder(t);
  let creates = 0,
    queries = 0;
  const services = {
    modelConfiguration() {},
    async createModelTask() {
      creates++;
      throw new Error('Response lost');
    },
    async getModelTask(phase, id) {
      queries++;
      assert.equal(phase, 'image-to-3d');
      return { id, status: 'IN_PROGRESS' };
    },
  };
  const pipeline = createModelPipeline({ root, services, installBytes: async () => ({}) });
  const job = await pipeline.start(character, settings, credentials);
  const recovered = await pipeline.recover(job.id, 'provider-confirmed', settings, credentials);
  assert.equal(recovered.status, 'generating');
  assert.equal(recovered.taskId, 'provider-confirmed');
  assert.equal(creates, 1);
  assert.equal(queries, 1);
});

test('simultaneous window submissions and queries cannot duplicate generation or rigging', async (t) => {
  const root = await folder(t);
  let creates = 0,
    rigs = 0,
    downloads = 0;
  const services = {
    modelConfiguration() {},
    async createModelTask() {
      creates++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return 'mesh-task';
    },
    async createRigTask() {
      rigs++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return 'rig-task';
    },
    async getModelTask() {
      return { status: 'SUCCEEDED', result: { rigged_character_glb_url: 'https://cdn.example/model.glb' } };
    },
    async downloadModel() {
      downloads++;
      return Buffer.from('model');
    },
  };
  const pipeline = createModelPipeline({ root, services, installBytes: async () => ({ id: 'skin' }) });
  const starts = await Promise.allSettled([
    pipeline.start(character, settings, credentials),
    pipeline.start(character, settings, credentials),
  ]);
  assert.equal(starts.filter((r) => r.status === 'fulfilled').length, 1);
  assert.match(starts.find((r) => r.status === 'rejected').reason.message, /已有未完成任务/);
  const job = starts.find((r) => r.status === 'fulfilled').value;
  await Promise.all([
    pipeline.advance(job.id, settings, credentials),
    pipeline.advance(job.id, settings, credentials),
    pipeline.advance(job.id, settings, credentials),
  ]);
  assert.equal(creates, 1);
  assert.equal(rigs, 1);
  assert.equal(downloads, 1);
});
