'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { referencePack, imageDigest, styleReferencePack } = require('./references.cjs');
const { validateSkin, validateStyleReference } = require('./store.cjs');
const { inspectMaster, inspectSheet, packFrames } = require('./pet-frames.cjs');
const { productionOptions } = require('./pet-recipes.cjs');
const styles = Object.keys(require('../shared/art-styles.json'));
// New tasks offer four looks only; earlier looks keep resuming and revising from their saved files.
const creationStyles = require('../shared/creation-styles.json');
// Old task files remain readable; retired styles cannot start or resume generation.
const recognizedStyles = [...styles, 'realistic', 'watercolor', 'plush', 'figurine'];
const motions = require('../shared/pet-motions.json').map((m) => m.id);
const stamp = () => new Date().toISOString();
function validId(id) {
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('桌宠任务编号无效。');
  return id;
}
function configDigest(settings) {
  return createHash('sha256')
    .update(
      JSON.stringify(
        // Unchanged for image APIs, so existing jobs keep their digest.
        settings.imageProvider === 'codex'
          ? ['codex']
          : [settings.imageBaseUrl, settings.imageModel, settings.imageInputFidelity || 'auto'],
      ),
    )
    .digest('hex');
}
function createPetPipeline({ root, services, codec, installSkin, io = fs }) {
  const cache = new Map(),
    pendingPixels = new Map(),
    pendingEdits = new Map(),
    locks = new Map(),
    active = new Set();
  const file = (id) => path.join(root, `${validId(id)}.json`);
  const artifact = (id, index) => path.join(root, `${validId(id)}-${index}.asset.json`);
  const styleFile = (id) => path.join(root, `${validId(id)}.style-reference.json`);
  const editFile = (id, editId, kind) =>
    path.join(root, `${validId(id)}.edit-${validId(editId)}.${kind}.json`);
  const serial = (key, operation) => {
    const previous = locks.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    locks.set(key, current);
    current
      .finally(() => {
        if (locks.get(key) === current) locks.delete(key);
      })
      .catch(() => {});
    return current;
  };
  async function writeJson(target, value) {
    await io.mkdir(root, { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await io.writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
      await io.rename(temporary, target);
    } finally {
      await io.rm(temporary, { force: true });
    }
  }
  async function persist(job) {
    job.updatedAt = stamp();
    if (Buffer.byteLength(JSON.stringify(job)) > 65536)
      throw new Error('桌宠任务记录过大，无法继续添加修图。');
    cache.set(job.id, structuredClone(job));
    await writeJson(file(job.id), job);
    return structuredClone(job);
  }
  async function readJson(target, limit) {
    const stat = await io.stat(target);
    if (!stat.isFile() || stat.size > limit) throw new Error('桌宠任务文件无效或过大。');
    return JSON.parse(await io.readFile(target, 'utf8'));
  }
  async function pixels(job, index) {
    const key = `${job.id}:${index}`;
    if (pendingPixels.has(key)) return pendingPixels.get(key);
    try {
      return await readJson(artifact(job.id, index), 12 * 1024 * 1024);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }
  async function editPixels(job, edit) {
    const key = `${job.id}:${edit.id}`;
    if (pendingEdits.has(key)) return pendingEdits.get(key);
    try {
      return await readJson(editFile(job.id, edit.id, 'asset'), 12 * 1024 * 1024);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }
  async function readStyleReference(job) {
    if (job.styleReference === undefined) return null;
    const summary = validateStyleReference(job.styleReference);
    let saved;
    try {
      saved = await readJson(styleFile(job.id), 12 * 1024 * 1024);
    } catch (error) {
      if (error.code === 'ENOENT')
        throw Object.assign(
          new Error('这个任务保存的画风参考图已丢失。请从工作区备份恢复后再生成或修图；已有候选仍保留。'),
          { code: 'ENOENT' },
        );
      throw error;
    }
    const pack = styleReferencePack(saved?.reference);
    if (!pack || ['id', 'name', 'digest'].some((key) => pack.summary[key] !== summary[key]))
      throw new Error('画风参考文件与任务记录不一致，请恢复原文件后继续。');
    return pack.reference;
  }
  async function load(id) {
    const job = cache.has(id) ? structuredClone(cache.get(id)) : await readJson(file(id), 65536);
    if (
      job.id !== id ||
      job.version !== 1 ||
      job.provider !== 'image-edits' ||
      !['queued', 'running', 'attention', 'ready', 'cancelled'].includes(job.status) ||
      typeof job.characterId !== 'string' ||
      !Array.isArray(job.steps) ||
      !job.steps.length ||
      job.steps.length > 90 ||
      !Array.isArray(job.styles) ||
      !job.styles.length ||
      job.styles.some((s) => !recognizedStyles.includes(s)) ||
      !Array.isArray(job.motions) ||
      !job.motions.length ||
      job.motions.some((m) => !motions.includes(m)) ||
      !Array.isArray(job.results) ||
      !/^[a-f0-9]{64}$/.test(job.referenceDigest) ||
      !/^[a-f0-9]{64}$/.test(job.configDigest)
    )
      throw new Error('桌宠任务记录无效。');
    productionOptions(job);
    if (job.styleReference !== undefined) job.styleReference = validateStyleReference(job.styleReference);
    if (job.awaitingSelection && !job.styles.includes(job.awaitingSelection))
      throw new Error('候选选择状态无效。');
    if (job.selectedBases && (typeof job.selectedBases !== 'object' || Array.isArray(job.selectedBases)))
      throw new Error('基准选择无效。');
    if (job.baseEdits !== undefined) {
      if (!Array.isArray(job.baseEdits) || job.baseEdits.length > 12) throw new Error('角色修图记录无效。');
      const ids = new Set(),
        counts = new Map();
      for (const edit of job.baseEdits) {
        if (
          !edit ||
          typeof edit !== 'object' ||
          typeof edit.id !== 'string' ||
          !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(edit.id) ||
          ids.has(edit.id) ||
          !job.styles.includes(edit.style) ||
          typeof edit.sourceSkinId !== 'string' ||
          edit.sourceSkinId.length > 128 ||
          !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(edit.sourceSkinId) ||
          typeof edit.feedback !== 'string' ||
          !edit.feedback.trim() ||
          edit.feedback.length > 600 ||
          typeof edit.createdAt !== 'string' ||
          edit.createdAt.length > 40 ||
          !Number.isFinite(Date.parse(edit.createdAt)) ||
          !['working', 'done', 'failed', 'unsaved', 'uncertain'].includes(edit.status) ||
          (edit.error !== undefined && (typeof edit.error !== 'string' || edit.error.length > 700))
        )
          throw new Error('角色修图记录无效。');
        ids.add(edit.id);
        counts.set(edit.style, (counts.get(edit.style) || 0) + 1);
        if (counts.get(edit.style) > 6) throw new Error('同画风修图次数超过上限。');
      }
    }
    if (
      job.revision &&
      (!['base', 'motion'].includes(job.revision.kind) ||
        typeof job.revision.feedback !== 'string' ||
        !job.revision.feedback.trim() ||
        job.revision.feedback.length > 600 ||
        (job.revision.kind === 'motion' && !job.motions.includes(job.revision.motion)))
    )
      throw new Error('修正任务记录无效。');
    for (const step of job.steps) {
      if (
        !job.styles.includes(step.style) ||
        !['base', 'sheet', 'pack'].includes(step.kind) ||
        !['queued', 'working', 'done', 'failed', 'unsaved', 'uncertain'].includes(step.status) ||
        (step.kind === 'sheet' && !job.motions.includes(step.motion))
      )
        throw new Error('桌宠任务阶段无效。');
    }
    if (!active.has(id)) {
      let recovered = false;
      for (let i = 0; i < job.steps.length; i++)
        if (job.steps[i].status === 'working') {
          job.steps[i].status = (await pixels(job, i)) ? 'unsaved' : 'uncertain';
          job.steps[i].error =
            job.steps[i].status === 'unsaved'
              ? '已返回素材，继续时只检查并保存本机结果。'
              : '上次请求被中断，未取得可恢复的输出；不会自动重复请求。';
          recovered = true;
        }
      for (const edit of job.baseEdits || [])
        if (edit.status === 'working') {
          edit.status = (await editPixels(job, edit)) ? 'unsaved' : 'uncertain';
          edit.error =
            edit.status === 'unsaved'
              ? '修图已返回，重试只恢复本机保存，不会再次请求图像。'
              : '修图请求被中断，未取得可恢复的输出；明确重试才会再次请求图像。';
          recovered = true;
        }
      if (
        job.awaitingSelection &&
        job.steps.some((s) => s.style === job.awaitingSelection && s.kind === 'base' && s.status !== 'done')
      ) {
        delete job.awaitingSelection;
        recovered = true;
      }
      if (recovered) {
        if (job.status !== 'cancelled') job.status = 'attention';
        await persist(job);
      }
    }
    return job;
  }
  async function list(characterId) {
    await io.mkdir(root, { recursive: true });
    const ids = new Set(
      (await io.readdir(root)).filter((f) => /^[a-f0-9-]{36}\.json$/.test(f)).map((f) => f.slice(0, -5)),
    );
    for (const id of cache.keys()) ids.add(id);
    const jobs = [];
    for (const id of [...ids].slice(-100)) {
      const job = await load(id);
      if (job.characterId === characterId && job.styles.every((s) => styles.includes(s))) jobs.push(job);
    }
    return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async function start(character, input, settings, credentials) {
    if (
      !Array.isArray(input.styles) ||
      !input.styles.length ||
      input.styles.length > styles.length ||
      input.styles.some((s) => !styles.includes(s)) ||
      input.styles.some((s) => !creationStyles.includes(s) && s !== input.sourceSkin?.style) ||
      !Array.isArray(input.motions) ||
      !input.motions.length ||
      input.motions.length > motions.length ||
      input.motions.some((m) => !motions.includes(m))
    )
      throw new Error('请至少选择一种画风和一组动作。');
    const options = productionOptions(input);
    if (input.sourceSkin) options.candidateCount = 1;
    const selectedStyles = [...new Set(input.styles)],
      selectedMotions = [...new Set(input.motions)];
    const guide = styleReferencePack(input.styleReference);
    if (guide && input.sourceSkin)
      throw new Error('沿用已有角色基准时不能添加画风参考；请重新生成角色候选。');
    if (guide && selectedStyles.every((style) => style === 'original'))
      throw new Error('原作画风只使用角色原图，请选择其他画风后再添加画风参考。');
    services.prepareSkinGeneration(
      {
        character,
        mode: 'image',
        sourceSkin: input.sourceSkin,
        ...(guide ? { styleReference: guide.reference } : {}),
      },
      settings,
      credentials,
    );
    const pack = referencePack(character);
    if (input.sourceSkin && (selectedStyles.length !== 1 || selectedStyles[0] !== input.sourceSkin.style))
      throw new Error('使用已有基准时，只能制作这张基准的同画风动作。');
    const duplicate = (await list(character.id)).find(
      (j) =>
        j.referenceDigest === pack.digest &&
        !['ready', 'cancelled'].includes(j.status) &&
        selectedStyles.some((s) => j.styles.includes(s)),
    );
    if (duplicate) throw new Error('这些画风已有未完成任务，请继续原任务，避免重复生成。');
    const job = {
      id: randomUUID(),
      version: 1,
      provider: 'image-edits',
      ...options,
      characterId: character.id,
      name: `${character.name} · 自动桌宠`,
      styles: selectedStyles,
      motions: selectedMotions,
      referenceDigest: pack.digest,
      configDigest: configDigest(settings),
      ...(guide ? { styleReference: guide.summary } : {}),
      status: 'queued',
      createdAt: stamp(),
      updatedAt: stamp(),
      results: [],
      steps: selectedStyles.flatMap((style) => [
        ...Array.from({ length: options.candidateCount }, () => ({ kind: 'base', style, status: 'queued' })),
        ...selectedMotions.map((motion) => ({ kind: 'sheet', style, motion, status: 'queued' })),
        { kind: 'pack', style, status: 'queued' },
      ]),
    };
    if (input.sourceSkin) {
      const skin = validateSkin(input.sourceSkin);
      inspectMaster(skin.images.neutral, codec);
      await writeJson(artifact(job.id, 0), { skin });
      job.steps[0].status = 'done';
      job.selectedBases = { [skin.style]: skin.id };
    }
    if (guide) await writeJson(styleFile(job.id), { reference: guide.reference });
    try {
      return await persist(job);
    } catch (error) {
      cache.delete(job.id);
      throw error;
    }
  }
  async function chosenMaster(job, style) {
    const bases = await collectMasters(job, style);
    for (const skin of bases) {
      if (
        skin &&
        (job.selectedBases?.[style] === skin.id || (bases.length === 1 && !job.selectedBases?.[style]))
      )
        return validateSkin(skin);
    }
    throw new Error('请先选择这套画风的角色基准。');
  }
  async function selectBase(id, style, skinId) {
    const job = await load(id);
    if (
      job.status === 'cancelled' ||
      job.awaitingSelection !== style ||
      job.steps.some((s) => s.style === style && s.kind !== 'base' && s.status !== 'queued')
    )
      throw new Error('当前任务不能更换基准。');
    const candidates = await masters(id);
    if (!candidates.some((s) => s.id === skinId && s.style === style))
      throw new Error('所选候选不属于这个任务或尚未完成。');
    const before = structuredClone(job);
    job.selectedBases = { ...job.selectedBases, [style]: skinId };
    delete job.awaitingSelection;
    job.status = 'queued';
    try {
      return await persist(job);
    } catch (error) {
      cache.set(id, before);
      throw error;
    }
  }
  function checkEditContext(job, style, character, settings, localRecovery = false) {
    const first = job.steps.findIndex((step) => step.style === style);
    const sameStyle = job.steps.filter((step) => step.style === style);
    if (
      ['ready', 'cancelled'].includes(job.status) ||
      !styles.includes(style) ||
      first < 0 ||
      (job.awaitingSelection && job.awaitingSelection !== style) ||
      job.steps.slice(0, first).some((step) => step.status !== 'done') ||
      !sameStyle.some((step) => step.kind === 'base') ||
      sameStyle.some((step) => (step.kind === 'base' ? step.status !== 'done' : step.status !== 'queued'))
    )
      throw new Error('只能在本画风角色候选完成、动作尚未开始时修正形象。');
    if (
      job.characterId !== character.id ||
      (!localRecovery && referencePack(character).digest !== job.referenceDigest)
    )
      throw new Error('角色或参考图已变化，请恢复原参考图后修正。');
    if (!localRecovery && configDigest(settings) !== job.configDigest)
      throw new Error('图像服务配置已变化，请恢复原配置后修正。');
  }
  function editSource(job, edit, value) {
    const skin = validateSkin(value);
    if (
      skin.id !== edit.sourceSkinId ||
      skin.characterId !== job.characterId ||
      skin.style !== edit.style ||
      skin.sprite
    )
      throw new Error('修图源候选与任务不匹配。');
    inspectMaster(skin.images.neutral, codec);
    return skin;
  }
  async function runBaseEdit(job, edit, before, character, settings, credentials, progress, resume) {
    const source = resume
      ? null
      : editSource(job, edit, (await readJson(editFile(job.id, edit.id, 'source'), 12 * 1024 * 1024)).skin);
    const guide = !resume && edit.style !== 'original' ? await readStyleReference(job) : null;
    edit.status = 'working';
    delete edit.error;
    job.status = 'running';
    job.awaitingSelection = edit.style;
    job.selectedBases = { ...job.selectedBases };
    delete job.selectedBases[edit.style];
    active.add(job.id);
    try {
      await persist(job);
    } catch (error) {
      cache.set(job.id, before);
      active.delete(job.id);
      throw error;
    }
    let returned,
      phase = 'generating';
    const key = `${job.id}:${edit.id}`;
    try {
      if (resume) {
        returned = await editPixels(job, edit);
        if (!returned) throw new Error('本机修图输出缺失；请核对上次请求后明确重试，或选择原候选。');
      } else {
        returned = {
          skin: await services.revisePetBase(
            {
              character,
              skin: source,
              style: edit.style,
              referenceDigest: job.referenceDigest,
              feedback: edit.feedback,
              ...(guide ? { styleReference: guide } : {}),
            },
            settings,
            credentials,
            progress,
          ),
        };
        returned.skin = {
          ...returned.skin,
          generation: {
            ...returned.skin?.generation,
            parentSkinId: edit.sourceSkinId,
          },
        };
        pendingEdits.set(key, returned);
      }
      phase = 'persisting';
      await writeJson(editFile(job.id, edit.id, 'asset'), returned);
      phase = 'checking';
      const skin = validateSkin(returned.skin);
      if (
        skin.characterId !== job.characterId ||
        skin.style !== edit.style ||
        skin.sprite ||
        skin.id === edit.sourceSkinId ||
        skin.generation?.parentSkinId !== edit.sourceSkinId ||
        skin.generation?.referenceDigest !== job.referenceDigest
      )
        throw new Error('修图输出与来源候选不匹配。');
      inspectMaster(skin.images.neutral, codec);
      edit.status = 'done';
      job.status = 'queued';
      phase = 'recording';
      await persist(job);
      pendingEdits.delete(key);
      return job;
    } catch (error) {
      edit.status = returned && phase !== 'checking' ? 'unsaved' : returned ? 'failed' : 'uncertain';
      edit.error = String(error.message || '角色修图未完成。').slice(0, 700);
      job.status = 'attention';
      try {
        await persist(job);
      } catch {
        /* Keep acknowledged output and recovery state in memory. */
      }
      return job;
    } finally {
      active.delete(job.id);
    }
  }
  async function refineBase(id, input, character, settings, credentials, progress) {
    const job = await load(id);
    const feedback = typeof input?.feedback === 'string' ? input.feedback.trim() : '';
    if (!feedback || feedback.length > 600) throw new Error('请填写不超过600字的修正要求。');
    checkEditContext(job, input.style, character, settings);
    const edits = job.baseEdits || [];
    if (edits.length >= 12 || edits.filter((edit) => edit.style === input.style).length >= 6)
      throw new Error('每套画风最多修正6次，一个任务最多12次。');
    if (edits.some((edit) => edit.style === input.style && ['working', 'unsaved'].includes(edit.status)))
      throw new Error('请先恢复这套画风尚未保存的修图，再创建新修图。');
    const source = (await collectMasters(job, input.style)).find((skin) => skin.id === input.skinId);
    if (!source) throw new Error('所选源候选不属于这个任务或尚未完成。');
    const before = structuredClone(job);
    const edit = {
      id: randomUUID(),
      style: input.style,
      sourceSkinId: source.id,
      feedback,
      createdAt: stamp(),
      status: 'working',
    };
    job.baseEdits = [...edits, edit];
    // Reserve room for a 700-character UTF-8 failure message and state changes.
    if (Buffer.byteLength(JSON.stringify(job)) + 3000 > 65536)
      throw new Error('桌宠任务记录已接近容量上限，无法安全添加修图。');
    await writeJson(editFile(id, edit.id, 'source'), { skin: editSource(job, edit, source) });
    return runBaseEdit(job, edit, before, character, settings, credentials, progress, false);
  }
  async function retryBaseEdit(id, editId, character, settings, credentials, progress) {
    const job = await load(id);
    const edit = job.baseEdits?.find((candidate) => candidate.id === editId);
    if (!edit || !['failed', 'uncertain', 'unsaved'].includes(edit.status))
      throw new Error('只能重试失败、中断或尚未保存的修图。');
    const before = structuredClone(job),
      resume = edit.status === 'unsaved';
    checkEditContext(job, edit.style, character, settings, resume);
    if (
      !resume &&
      job.baseEdits.some(
        (other) =>
          other.id !== edit.id && other.style === edit.style && ['working', 'unsaved'].includes(other.status),
      )
    )
      throw new Error('请先恢复这套画风尚未保存的修图，再重试其他修图。');
    if (!resume) {
      // Preserve rejected output as evidence; an explicit retry may spend one new request.
      try {
        await io.rename(
          editFile(id, edit.id, 'asset'),
          editFile(id, edit.id, `rejected-${Date.now()}-${randomUUID()}`),
        );
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      pendingEdits.delete(`${id}:${edit.id}`);
    }
    return runBaseEdit(job, edit, before, character, settings, credentials, progress, resume);
  }
  async function revise(id, input, character, settings) {
    const source = await load(id);
    const feedback = typeof input.feedback === 'string' ? input.feedback.trim() : '';
    if (!feedback || feedback.length > 600) throw new Error('请填写不超过600字的修正要求。');
    if (
      source.status !== 'ready' ||
      !source.styles.includes(input.style) ||
      (input.motion && !source.motions.includes(input.motion))
    )
      throw new Error('只能修正已完成任务中的画风与动作。');
    if (
      source.characterId !== character.id ||
      source.referenceDigest !== referencePack(character).digest ||
      source.configDigest !== configDigest(settings)
    )
      throw new Error('角色参考或图像服务已变化，请恢复原配置后修正。');
    const duplicate = (await list(character.id)).find(
      (j) => !['ready', 'cancelled'].includes(j.status) && j.styles.includes(input.style),
    );
    if (duplicate) throw new Error('这套画风已有未完成任务，请先继续或结束它。');
    const master = await chosenMaster(source, input.style);
    const guide = await readStyleReference(source);
    const job = {
      ...source,
      id: randomUUID(),
      styles: [input.style],
      candidateCount: 1,
      status: 'queued',
      createdAt: stamp(),
      updatedAt: stamp(),
      results: [],
      selectedBases: {},
      revision: {
        sourceJobId: id,
        kind: input.motion ? 'motion' : 'base',
        ...(input.motion ? { motion: input.motion } : {}),
        feedback,
      },
      steps: [
        { kind: 'base', style: input.style, status: input.motion ? 'done' : 'queued' },
        ...source.motions.map((motion) => ({
          kind: 'sheet',
          style: input.style,
          motion,
          status: input.motion && motion !== input.motion ? 'done' : 'queued',
        })),
        { kind: 'pack', style: input.style, status: 'queued' },
      ],
    };
    delete job.awaitingSelection;
    delete job.baseEdits;
    if (guide) await writeJson(styleFile(job.id), { reference: guide });
    if (input.motion) {
      await writeJson(artifact(job.id, 0), { skin: master });
      job.selectedBases[input.style] = master.id;
      for (let i = 1; i < job.steps.length - 1; i++)
        if (job.steps[i].status === 'done') {
          const original = source.steps.findIndex(
            (s) => s.style === input.style && s.kind === 'sheet' && s.motion === job.steps[i].motion,
          );
          const data = await pixels(source, original);
          if (!data?.image) throw new Error('原动作素材缺失，无法复用。');
          await writeJson(artifact(job.id, i), data);
        }
    } else await writeJson(path.join(root, `${job.id}.revision.json`), { skin: master });
    try {
      return await persist(job);
    } catch (error) {
      cache.delete(job.id);
      throw error;
    }
  }
  async function advance(id, character, settings, credentials, progress) {
    const job = await load(id);
    if (job.status === 'cancelled') throw new Error('这个任务已结束，已有素材仍保留。');
    if (job.status === 'ready') return job;
    if (job.awaitingSelection) throw new Error('请先选择角色候选，再继续生成动作。');
    if (job.styles.some((style) => !styles.includes(style)))
      throw new Error('任务包含已移除的画风，无法继续生成；已有素材文件仍保留。');
    if (job.characterId !== character.id || referencePack(character).digest !== job.referenceDigest)
      throw new Error('角色或参考图已变化，原任务不能继续；已完成素材仍保留。');
    if (configDigest(settings) !== job.configDigest)
      throw new Error('图像服务配置已变化，请恢复原配置后继续此任务。');
    const index = job.steps.findIndex((s) => s.status !== 'done');
    const step = job.steps[index];
    if (['failed', 'uncertain'].includes(step.status))
      throw new Error(step.error || '请明确重试失败阶段，已有完成阶段不会重做。');
    const before = step.status;
    // A style guide is needed only for a fresh master request. Existing output
    // can always be recovered locally, even if the guide file is unavailable.
    const guide =
      step.kind === 'base' && step.style !== 'original' && before !== 'unsaved' && !(await pixels(job, index))
        ? await readStyleReference(job)
        : null;
    step.status = 'working';
    job.status = 'running';
    delete step.error;
    active.add(id);
    try {
      await persist(job);
    } catch (error) {
      // A durable working marker always precedes a billable POST.
      active.delete(id);
      step.status = before;
      job.status = 'attention';
      cache.set(id, structuredClone(job));
      throw error;
    }
    let returned,
      phase = 'generating';
    try {
      returned = await pixels(job, index);
      if (!returned && before === 'unsaved')
        throw new Error('本机暂存素材不可恢复，请核对上次请求后明确重试。');
      if (!returned) {
        let chibiContext;
        if (step.kind === 'base' && step.style === 'chibi-pet' && !job.revision) {
          const saved = path.join(root, `${id}.chibi-reference.json`);
          try { chibiContext = await readJson(saved, 12 * 1024 * 1024); }
          catch(error) { if(error.code !== 'ENOENT') throw error; }
          if (!chibiContext) {
            chibiContext = await services.discoverChibiReferences(character, settings, credentials, progress);
            await writeJson(saved, chibiContext);
          }
        }
        if (step.kind === 'base')
          returned = {
            skin: validateSkin(
              await (job.revision?.kind === 'base' ? services.revisePetBase : services.generateSkin)(
                {
                  character,
                  style: step.style,
                  ...(chibiContext ? { chibiContext } : {}),
                  mode: 'image',
                  referenceDigest: job.referenceDigest,
                  artDirection: job.artDirection,
                  ...(job.revision?.kind === 'base' ? {} : { candidateVariation: job.candidateVariation }),
                  ...(guide ? { styleReference: guide } : {}),
                  candidateIndex: job.steps
                    .slice(0, index + 1)
                    .filter((s) => s.kind === 'base' && s.style === step.style).length,
                  ...(job.revision?.kind === 'base'
                    ? {
                        skin: (await readJson(path.join(root, `${id}.revision.json`), 12 * 1024 * 1024)).skin,
                        feedback: job.revision.feedback,
                      }
                    : {}),
                },
                settings,
                credentials,
                progress,
              ),
            ),
          };
        else {
          const master = await chosenMaster(job, step.style);
          if (!master) throw new Error('基准素材缺失，不能继续生成或打包。');
          if (step.kind === 'sheet') {
            // Persisted sheets only, same style and chosen master. Retrying a failed
            // step uses the same preceding artifacts; no extra image-model calls.
            const continuityReferences = [];
            if (job.transitionVersion === 3) {
              for (let i = 0; i < index && continuityReferences.length < 2; i++) {
                const previous = job.steps[i];
                if (
                  previous.kind === 'sheet' &&
                  previous.style === step.style &&
                  previous.status === 'done' &&
                  require('./pet-recipes.cjs').motionRecipe(previous.motion, job).aligned
                ) {
                  const asset = await pixels(job, i);
                  if (asset?.image)
                    continuityReferences.push({ motion: previous.motion, image: asset.image });
                }
              }
            }
            returned = await services.generatePetSheet(
              {
                character,
                skin: master,
                motion: step.motion,
                continuityReferences,
                referenceDigest: job.referenceDigest,
                ...productionOptions(job),
                ...(job.revision?.kind === 'motion' && job.revision.motion === step.motion
                  ? { feedback: job.revision.feedback }
                  : {}),
              },
              settings,
              credentials,
              progress,
            );
          } else {
            progress({
              stage: '整理桌宠动画',
              detail: '检查透明留白、对齐待机位置并写入动作时序；本阶段不调用模型。',
            });
            const sheets = {};
            for (let i = 0; i < job.steps.length; i++)
              if (job.steps[i].style === step.style && job.steps[i].kind === 'sheet') {
                const result = await pixels(job, i);
                if (!result?.image) throw new Error('动作素材缺失，无法整理图集。');
                sheets[job.steps[i].motion] = result.image;
              }
            const packed = packFrames(master.images.neutral, sheets, step.style, codec, job);
            returned = {
              skin: validateSkin({
                ...master,
                id: randomUUID(),
                name: `${master.name} · 互动动画`,
                images: { neutral: packed.image },
                sprite: packed.sprite,
                generation: {
                  ...master.generation,
                  prompt: `${master.generation.prompt} Automatic 2D frame atlas; job ${job.id}; clips ${job.motions.join(', ')}. Original reference bytes used for every request.${job.revision ? ` Revision of ${job.revision.sourceJobId}: ${job.revision.feedback}` : ''}`,
                },
                review: {
                  status: 'pending',
                  referenceDigest: job.referenceDigest,
                  imageDigest: imageDigest(packed.image),
                },
                createdAt: stamp(),
              }),
              warnings: packed.warnings,
            };
          }
        }
        pendingPixels.set(`${id}:${index}`, returned); // Preserve acknowledged pixels before any write.
      }
      phase = 'persisting';
      await writeJson(artifact(id, index), returned);
      phase = 'checking';
      if (step.kind === 'base') inspectMaster(validateSkin(returned.skin).images.neutral, codec);
      if (step.kind === 'sheet') inspectSheet(returned.image, codec, step.motion, job);
      if (step.kind === 'pack') {
        const skin = validateSkin(returned.skin);
        phase = 'installing';
        await installSkin(skin, job.referenceDigest);
        if (!job.results.some((r) => r.skinId === skin.id))
          job.results.push({ style: step.style, skinId: skin.id, warnings: returned.warnings || [] });
      }
      step.status = 'done';
      if (step.kind === 'base') {
        const bases = job.steps.filter((s) => s.kind === 'base' && s.style === step.style);
        if (bases.every((s) => s.status === 'done')) {
          if (bases.length > 1) {
            if (!job.selectedBases?.[step.style]) job.awaitingSelection = step.style;
          } else job.selectedBases = { ...job.selectedBases, [step.style]: returned.skin.id };
        }
      }
      job.status = job.steps.every((s) => s.status === 'done') ? 'ready' : 'queued';
      phase = 'recording';
      await persist(job);
      pendingPixels.delete(`${id}:${index}`);
      return job;
    } catch (error) {
      // Written or cached output can be recovered locally. A technical-quality
      // rejection keeps its source output but needs an explicit regeneration.
      const localSaveFailure = returned && phase !== 'checking';
      step.status = localSaveFailure ? 'unsaved' : returned ? 'failed' : 'uncertain';
      if (step.kind === 'base' && job.awaitingSelection === step.style) delete job.awaitingSelection;
      if (step.kind === 'pack') step.status = returned ? 'unsaved' : 'failed';
      step.error = String(error.message || '桌宠制作未完成。').slice(0, 700);
      job.status = 'attention';
      try {
        await persist(job);
      } catch {
        /* Cache retains completed pixels and recovery state. */
      }
      return job;
    } finally {
      active.delete(id);
    }
  }
  async function retry(id, index) {
    const job = await load(id);
    if (job.status === 'cancelled') throw new Error('这个任务已结束，请创建新的制作任务。');
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= job.steps.length ||
      job.steps.slice(0, index).some((s) => s.status !== 'done') ||
      !['failed', 'uncertain'].includes(job.steps[index].status)
    )
      throw new Error('只能重试当前失败或中断的阶段。');
    // Retain rejected pixels as evidence rather than deleting them.
    try {
      await io.rename(artifact(id, index), path.join(root, `${id}-${index}.rejected-${Date.now()}.json`));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    pendingPixels.delete(`${id}:${index}`);
    job.steps[index].status = 'queued';
    delete job.steps[index].error;
    job.status = 'queued';
    return persist(job);
  }
  async function results(id) {
    const job = await load(id),
      skins = [];
    for (let i = 0; i < job.steps.length; i++)
      if (job.steps[i].kind === 'pack' && job.steps[i].status === 'done')
        skins.push(validateSkin((await pixels(job, i)).skin));
    return skins;
  }
  async function collectMasters(job, style) {
    const skins = [];
    for (let i = 0; i < job.steps.length; i++)
      if (
        job.steps[i].kind === 'base' &&
        job.steps[i].status === 'done' &&
        (!style || job.steps[i].style === style)
      )
        skins.push(validateSkin((await pixels(job, i)).skin));
    for (const edit of job.baseEdits || [])
      if (edit.status === 'done' && (!style || edit.style === style))
        skins.push(validateSkin((await editPixels(job, edit)).skin));
    return skins;
  }
  async function masters(id) {
    return collectMasters(await load(id));
  }
  async function cancel(id) {
    const job = await load(id);
    job.status = 'cancelled';
    return persist(job);
  }
  return {
    start: (character, input, settings, credentials) =>
      serial(`char:${character.id}`, () => start(character, input, settings, credentials)),
    advance: (id, character, settings, credentials, progress = () => {}) =>
      serial(`job:${id}`, () => advance(id, character, settings, credentials, progress)),
    retry: (id, index) => serial(`job:${id}`, () => retry(id, index)),
    cancel: (id) => serial(`job:${id}`, () => cancel(id)),
    list,
    load,
    results,
    masters,
    styleReference: async (id) => readStyleReference(await load(id)),
    selectBase: (id, style, skinId) => serial(`job:${id}`, () => selectBase(id, style, skinId)),
    refineBase: (id, input, character, settings, credentials, progress = () => {}) =>
      serial(`job:${id}`, () => refineBase(id, input, character, settings, credentials, progress)),
    retryBaseEdit: (id, editId, character, settings, credentials, progress = () => {}) =>
      serial(`job:${id}`, () => retryBaseEdit(id, editId, character, settings, credentials, progress)),
    revise: (id, input, character, settings) =>
      serial(`char:${character.id}`, () => revise(id, input, character, settings)),
  };
}
module.exports = { createPetPipeline };
