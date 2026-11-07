'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { imageBytes, imageDigest } = require('./references.cjs');
const taskId = (value) => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(value))
    throw new Error('3D 服务未返回有效任务编号。');
  return value;
};
function createModelPipeline({ root, services, installBytes }) {
  const cache = new Map();
  const pending = new Map();
  // IPC calls from multiple windows may arrive together. Serialize each creation
  // and task transition so a second caller sees the newly persisted remote ID.
  function serialized(key, operation) {
    const previous = pending.get(key) || Promise.resolve();
    const result = previous.catch(() => {}).then(operation);
    pending.set(key, result);
    result
      .finally(() => {
        if (pending.get(key) === result) pending.delete(key);
      })
      .catch(() => {});
    return result;
  }
  const filename = (id) => path.join(root, `${taskId(id)}.json`);
  async function persist(job) {
    cache.set(job.id, structuredClone(job));
    await fs.mkdir(root, { recursive: true });
    const temp = `${filename(job.id)}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(job), { mode: 0o600 });
      await fs.rename(temp, filename(job.id));
    } finally {
      await fs.rm(temp, { force: true });
    }
    return job;
  }
  async function load(id) {
    if (cache.has(id)) return structuredClone(cache.get(id));
    const file = filename(id);
    const stat = await fs.stat(file);
    if (stat.size > 65536) throw new Error('3D 任务记录过大。');
    const job = JSON.parse(await fs.readFile(file, 'utf8'));
    if (
      job.id !== id ||
      job.provider !== 'meshy' ||
      ![
        'submitting',
        'generating',
        'rig-submitting',
        'rigging',
        'downloading',
        'ready',
        'failed',
        'uncertain',
      ].includes(job.status)
    )
      throw new Error('3D 任务记录无效。');
    if (job.taskId) taskId(job.taskId);
    if (job.rigTaskId) taskId(job.rigTaskId);
    return job;
  }
  async function list(characterId) {
    await fs.mkdir(root, { recursive: true });
    const result = [];
    for (const file of (await fs.readdir(root)).filter((f) => /^[a-zA-Z0-9-]+\.json$/.test(f)).slice(-100)) {
      const job = await load(file.slice(0, -5));
      if (job.characterId === characterId) result.push(job);
    }
    return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async function start(character, settings, credentials) {
    const ref = character.visualReferences?.[0];
    if (!ref) throw new Error('请先保存角色主参考图，再开始建模。');
    const { mime } = imageBytes(ref.image);
    if (!['image/png', 'image/jpeg'].includes(mime))
      throw new Error('Meshy 建模目前需要 PNG 或 JPEG 主参考图。');
    services.modelConfiguration(settings, credentials); // Preflight before recording/submitting.
    const sourceDigest = imageDigest(ref.image);
    const active = (await list(character.id)).find(
      (j) => j.sourceDigest === sourceDigest && !['ready', 'failed'].includes(j.status),
    );
    if (active) throw new Error('同一主参考已有未完成任务，请继续查询原任务，避免重复创建。');
    const job = {
      id: randomUUID(),
      provider: 'meshy',
      characterId: character.id,
      name: `${character.name} · 3D 模型`,
      endpoint: settings.modelBaseUrl || 'https://api.meshy.ai',
      sourceReferenceId: ref.id,
      sourceDigest,
      status: 'submitting',
      progress: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await persist(job);
    try {
      job.taskId = taskId(await services.createModelTask(ref.image, settings, credentials));
      job.status = 'generating';
      await persist(job);
      return job;
    } catch (error) {
      job.status = job.taskId
        ? 'generating'
        : /HTTP (400|401|402|403|404|422|429)/.test(error.message)
          ? 'failed'
          : 'uncertain';
      job.error = job.taskId
        ? '任务已创建，记录保存失败；继续查询会保留此任务编号。'
        : job.status === 'failed'
          ? String(error.message).slice(0, 500)
          : `创建结果未确认，请到服务商查看任务后再处理，勿重复提交。${String(error.message).slice(0, 250)}`;
      try {
        await persist(job);
      } catch {
        /* In-memory recovery retains an acknowledged task ID. */
      }
      return job;
    }
  }
  async function advance(id, settings, credentials) {
    const job = await load(id);
    if (new URL(settings.modelBaseUrl || 'https://api.meshy.ai').href !== new URL(job.endpoint).href)
      throw new Error('3D 服务地址已改变，请恢复创建此任务时的地址后查询。');
    if (job.status === 'ready' || job.status === 'failed') return job;
    if (['submitting', 'rig-submitting', 'uncertain'].includes(job.status))
      throw new Error('这次任务创建结果未确认，请先在服务商核对，不能自动重复创建。');
    const phase = job.rigTaskId ? 'rigging' : 'image-to-3d';
    const remote = await services.getModelTask(phase, job.rigTaskId || job.taskId, settings, credentials);
    if (remote.id && remote.id !== (job.rigTaskId || job.taskId))
      throw new Error('3D 服务返回了另一任务的数据。');
    job.updatedAt = new Date().toISOString();
    job.progress = Math.max(0, Math.min(100, Number(remote.progress) || 0));
    delete job.error;
    if (['FAILED', 'CANCELED'].includes(remote.status)) {
      job.status = 'failed';
      job.error = String(remote.task_error?.message || '3D 服务任务失败，已有资料和图片仍保留。').slice(
        0,
        500,
      );
      return persist(job);
    }
    if (remote.status !== 'SUCCEEDED') {
      if (!['PENDING', 'IN_PROGRESS'].includes(remote.status)) throw new Error('3D 服务返回了未知任务状态。');
      return persist(job);
    }
    if (!job.rigTaskId) {
      job.status = 'rig-submitting';
      await persist(job); // Mark submission before the next billable POST; never blindly repeat it.
      try {
        job.rigTaskId = taskId(await services.createRigTask(job.taskId, settings, credentials));
        job.status = 'rigging';
        job.progress = 0;
        return await persist(job);
      } catch (error) {
        job.status = job.rigTaskId
          ? 'rigging'
          : /HTTP (400|401|402|403|404|422|429)/.test(error.message)
            ? 'failed'
            : 'uncertain';
        job.error = `绑定创建结果需核对。${String(error.message).slice(0, 250)}`;
        try {
          await persist(job);
        } catch {
          /* Retain any known remote ID in cache. */
        }
        return job;
      }
    }
    const url = remote.result?.rigged_character_glb_url;
    if (typeof url !== 'string') throw new Error('绑定任务完成，但没有返回 GLB 模型文件。');
    job.status = 'downloading';
    await persist(job);
    // Download/install retry only repeats GETs, not generation or rigging.
    if (!job.skin) {
      const bytes = await services.downloadModel(url);
      job.skin = await installBytes(bytes, job.characterId, job.name);
    }
    job.status = 'ready';
    job.progress = 100;
    return persist(job);
  }
  async function recover(id, remoteId, settings, credentials) {
    const job = await load(id);
    if (!['submitting', 'rig-submitting', 'uncertain'].includes(job.status))
      throw new Error('此任务已有明确编号，请直接查询。');
    if (new URL(settings.modelBaseUrl || 'https://api.meshy.ai').href !== new URL(job.endpoint).href)
      throw new Error('3D 服务地址已改变，请恢复原地址。');
    const phase = job.taskId ? 'rigging' : 'image-to-3d';
    const confirmed = taskId(remoteId);
    const data = await services.getModelTask(phase, confirmed, settings, credentials);
    if (data.id && data.id !== confirmed) throw new Error('3D 服务返回了另一任务。');
    if (!['PENDING', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'CANCELED'].includes(data.status))
      throw new Error('服务商没有确认此任务。');
    if (phase === 'rigging') job.rigTaskId = confirmed;
    else job.taskId = confirmed;
    job.status = phase === 'rigging' ? 'rigging' : 'generating';
    job.updatedAt = new Date().toISOString();
    delete job.error;
    return persist(job);
  }
  return {
    start: (character, settings, credentials) =>
      serialized(`character:${character.id}`, () => start(character, settings, credentials)),
    advance: (id, settings, credentials) => serialized(`job:${id}`, () => advance(id, settings, credentials)),
    recover: (id, remoteId, settings, credentials) =>
      serialized(`job:${id}`, () => recover(id, remoteId, settings, credentials)),
    list,
  };
}
module.exports = { createModelPipeline };
