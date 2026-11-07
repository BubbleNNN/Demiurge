'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { unzipSync } = require('fflate');
const MAX_TOTAL = 128 * 1024 * 1024;
const MAX_SINGLE = 48 * 1024 * 1024;
function safePath(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 600 ||
    /[\\:%?#\x00-\x1f]/.test(value) ||
    value.startsWith('/') ||
    value.split('/').some((p) => !p || p === '.' || p === '..')
  )
    throw new Error('模型包含不安全的资源路径。');
  return value;
}
function validateLive2D(files) {
  const entries = Object.keys(files).filter((n) => /\.model3\.json$/i.test(n));
  if (entries.length !== 1)
    throw new Error('模型包必须包含且仅包含一个 .model3.json。请压缩单个模型文件夹。');
  const entry = entries[0];
  const manifest = JSON.parse(Buffer.from(files[entry]).toString('utf8'));
  const refs = manifest.FileReferences;
  if (manifest.Version !== 3 || !refs || !Array.isArray(refs.Textures) || !refs.Textures.length)
    throw new Error('不是有效的 Cubism 3/4 model3.json。');
  const base = path.posix.dirname(entry);
  const resolve = (ref) => {
    safePath(ref);
    const file = base === '.' ? ref : `${base}/${ref}`;
    if (!files[file]) throw new Error(`模型缺少资源：${ref}`);
    return file;
  };
  const used = new Set([entry]);
  const moc = resolve(refs.Moc);
  used.add(moc);
  if (Buffer.from(files[moc]).toString('ascii', 0, 4) !== 'MOC3') throw new Error('moc3 文件签名无效。');
  for (const texture of refs.Textures) {
    if (!/\.(png|jpg|jpeg|webp)$/i.test(texture)) throw new Error('模型贴图必须为 PNG/JPEG/WebP。');
    used.add(resolve(texture));
  }
  for (const name of ['Physics', 'Pose', 'UserData', 'DisplayInfo'])
    if (refs[name]) used.add(resolve(refs[name]));
  const expressions = [];
  for (const item of refs.Expressions || []) {
    if (typeof item.Name !== 'string' || item.Name.length > 128) throw new Error('表情名称无效。');
    expressions.push(item.Name);
    used.add(resolve(item.File));
  }
  const motions = {};
  for (const [group, list] of Object.entries(refs.Motions || {})) {
    if (
      !Array.isArray(list) ||
      list.length > 100 ||
      group.length > 128 ||
      ['__proto__', 'constructor', 'prototype'].includes(group)
    )
      throw new Error('动作组格式无效。');
    motions[group] = list.length;
    for (const motion of list) {
      used.add(resolve(motion.File));
      if (motion.Sound) {
        resolve(motion.Sound);
        delete motion.Sound;
      }
    }
  }
  if (expressions.length > 100 || Object.keys(motions).length > 100) throw new Error('模型动作或表情过多。');
  const selected = {};
  for (const file of used) {
    if (!/\.(json|moc3|png|jpg|jpeg|webp)$/i.test(file)) throw new Error('模型包含不支持的资源类型。');
    selected[file] = files[file];
  }
  // Only the validated fields can tell the runtime where to load resources.
  const clean = {
    Version: 3,
    FileReferences: Object.fromEntries(
      Object.entries(refs).filter(([key]) =>
        ['Moc', 'Textures', 'Physics', 'Pose', 'UserData', 'DisplayInfo', 'Expressions', 'Motions'].includes(
          key,
        ),
      ),
    ),
    Groups: manifest.Groups || [],
    HitAreas: manifest.HitAreas || [],
    Layout: manifest.Layout || {},
  };
  selected[entry] = Buffer.from(JSON.stringify(clean));
  return { entry, expressions, motions, files: selected };
}
function validateVrm(bytes) {
  const b = Buffer.from(bytes);
  if (
    b.length < 20 ||
    b.toString('ascii', 0, 4) !== 'glTF' ||
    b.readUInt32LE(4) !== 2 ||
    b.readUInt32LE(8) !== b.length ||
    b.readUInt32LE(16) !== 0x4e4f534a
  )
    throw new Error('请选择有效的二进制 .vrm 文件。');
  const size = b.readUInt32LE(12);
  if (size > b.length - 20) throw new Error('VRM JSON 区块损坏。');
  const json = JSON.parse(b.toString('utf8', 20, 20 + size));
  if (!json.extensions?.VRM && !json.extensions?.VRMC_vrm)
    throw new Error('此文件未包含 VRM 0.x/1.0 元数据。');
  for (const item of [...(json.buffers || []), ...(json.images || [])])
    if (item.uri && !/^data:[^;]+;base64,[A-Za-z0-9+/]+=*$/.test(item.uri))
      throw new Error('VRM 必须自包含，不能引用外部网络或文件资源。');
  return {
    entry: 'avatar.vrm',
    expressions: ['neutral', 'happy', 'angry', 'sad', 'relaxed', 'surprised'],
    motions: {},
    files: { 'avatar.vrm': b },
  };
}
function validateGlb(bytes) {
  const b = Buffer.from(bytes);
  if (
    b.length < 20 ||
    b.length > MAX_SINGLE ||
    b.toString('ascii', 0, 4) !== 'glTF' ||
    b.readUInt32LE(4) !== 2 ||
    b.readUInt32LE(8) !== b.length ||
    b.readUInt32LE(16) !== 0x4e4f534a
  )
    throw new Error('生成结果不是有效的 GLB 模型。');
  const length = b.readUInt32LE(12);
  if (length > b.length - 20 || length > 8 * 1024 * 1024) throw new Error('GLB JSON 区块无效。');
  const data = JSON.parse(b.toString('utf8', 20, 20 + length));
  if (data.asset?.version !== '2.0' || !Array.isArray(data.meshes) || !data.meshes.length)
    throw new Error('GLB 没有可显示的网格。');
  for (const item of data.buffers || [])
    if (item.uri && !/^data:application\/octet-stream;base64,[A-Za-z0-9+/]+=*$/.test(item.uri))
      throw new Error('GLB 不能包含外部缓冲区。');
  for (const item of data.images || [])
    if (item.uri && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(item.uri))
      throw new Error('GLB 不能包含外部贴图或 SVG。');
  if ((data.nodes?.length || 0) > 10000 || (data.animations?.length || 0) > 100)
    throw new Error('GLB 节点或动作数量过多。');
  const motions = {},
    motionMap = {};
  const patterns = {
    idle: /idle|rest|standing/i,
    wave: /wave|greet/i,
    bounce: /jump/i,
    nod: /nod/i,
    shake: /head.*shake/i,
    sleep: /sleep/i,
  };
  for (const [i, clip] of (data.animations || []).entries()) {
    const name = String(clip.name || `clip-${i}`).slice(0, 128);
    if (['__proto__', 'constructor', 'prototype'].includes(name)) throw new Error('GLB 动作名称无效。');
    motions[name] = 1;
    for (const [action, pattern] of Object.entries(patterns))
      if (pattern.test(name) && !motionMap[action]) motionMap[action] = name;
  }
  const jointIndices = new Set((data.skins || []).flatMap((skin) => skin.joints || []));
  const head = (data.nodes || []).find(
    (node, i) => jointIndices.has(i) && /^(mixamorig[:_])?head$/i.test(node.name || ''),
  );
  return {
    entry: 'avatar.glb',
    expressions: [],
    motions,
    motionMap,
    boneMap: head ? { head: head.name } : {},
    files: { 'avatar.glb': b },
  };
}
async function installGeneratedModel(bytes, root, characterId, name) {
  const model = validateGlb(bytes);
  const id = randomUUID();
  const destination = path.join(root, id);
  await fs.mkdir(destination, { recursive: true });
  try {
    await fs.writeFile(path.join(destination, model.entry), bytes, { mode: 0o600 });
  } catch (error) {
    await fs.rm(destination, { recursive: true, force: true });
    throw error;
  }
  return {
    id: randomUUID(),
    characterId,
    name,
    style: '3d',
    kind: 'glb',
    generated: true,
    images: {},
    createdAt: new Date().toISOString(),
    model: {
      id,
      entry: model.entry,
      expressions: model.expressions,
      motions: model.motions,
      motionMap: model.motionMap,
      boneMap: model.boneMap,
    },
  };
}
async function readModel(file, kind) {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > MAX_TOTAL) throw new Error('模型文件必须小于 128 MiB。');
  const bytes = await fs.readFile(file);
  if (kind === 'vrm') return validateVrm(bytes);
  let files;
  if (/\.zip$/i.test(file)) {
    let total = 0;
    let count = 0;
    files = unzipSync(bytes, {
      filter: (item) => {
        if (item.name.endsWith('/') || item.name.startsWith('__MACOSX/')) return false;
        safePath(item.name);
        total += item.originalSize;
        count++;
        if (item.originalSize > MAX_SINGLE || total > MAX_TOTAL || count > 500)
          throw new Error('解压后的模型超出大小或数量限制。');
        return true;
      },
    });
  } else {
    if (!/\.model3\.json$/i.test(file)) throw new Error('请选择 .model3.json 或单个模型的 ZIP。');
    const root = path.dirname(file);
    files = {};
    let total = 0;
    let count = 0;
    const walk = async (dir) => {
      for (const item of await fs.readdir(dir, { withFileTypes: true })) {
        if (item.name.startsWith('.')) continue;
        const full = path.join(dir, item.name);
        if (item.isSymbolicLink()) throw new Error('模型目录不能包含符号链接。');
        if (item.isDirectory()) {
          await walk(full);
          continue;
        }
        if (!/\.(json|moc3|png|jpe?g|webp|wav|mp3)$/i.test(item.name)) continue;
        const info = await fs.stat(full);
        total += info.size;
        count++;
        if (info.size > MAX_SINGLE || total > MAX_TOTAL || count > 500) throw new Error('模型目录过大。');
        files[safePath(path.relative(root, full).split(path.sep).join('/'))] = await fs.readFile(full);
      }
    };
    await walk(root);
  }
  return validateLive2D(files);
}
async function installModel(file, kind, root, characterId) {
  const model = await readModel(file, kind);
  const id = randomUUID();
  const destination = path.join(root, id);
  try {
    for (const [name, bytes] of Object.entries(model.files)) {
      const full = path.join(destination, safePath(name));
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, bytes, { mode: 0o600 });
    }
  } catch (error) {
    await fs.rm(destination, { recursive: true, force: true });
    throw error;
  }
  return {
    id: randomUUID(),
    characterId,
    name: path.basename(file).replace(/\.(model3\.json|zip|vrm)$/i, ''),
    style: 'anime',
    kind,
    images: {},
    generated: false,
    createdAt: new Date().toISOString(),
    model: { id, entry: model.entry, expressions: model.expressions, motions: model.motions },
  };
}
function resolveAsset(root, url) {
  const u = new URL(url);
  if (u.protocol !== 'mori-asset:' || u.hostname !== 'models') throw new Error('无效模型资源。');
  const name = safePath(decodeURIComponent(u.pathname.slice(1)));
  if (!/^[a-f0-9-]{36}\//i.test(name)) throw new Error('无效模型标识符。');
  const resolved = path.resolve(root, name);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) throw new Error('资源路径越界。');
  return resolved;
}
module.exports = {
  safePath,
  validateLive2D,
  validateVrm,
  validateGlb,
  installGeneratedModel,
  readModel,
  installModel,
  resolveAsset,
};
