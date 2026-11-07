'use strict';
// The author supplies every pose. This importer only packs pixels and timing.
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { validateAnimation } = require('./sprites.cjs');
const names = [
  'idle',
  'read',
  'gaming',
  'enter_read',
  'exit_read',
  'enter_gaming',
  'exit_gaming',
  'wave',
  'nod',
  'shake',
  'bounce',
  'sleep',
  'blink',
  'talk',
  'neutral',
  'happy',
  'thinking',
  'sad',
  'sleepy',
  'surprised',
];
const pixelStyles = new Set(['pixel', '8bit']);
async function readSequenceFolder(folder, characterId, style, codec) {
  const root = await fs.realpath(folder);
  let settings = {};
  try {
    const meta = path.join(root, 'pet.json');
    const stat = await fs.lstat(meta);
    if (!stat.isFile() || stat.size > 16 * 1024) throw new Error('pet.json 需要是小于 16 KiB 的文件。');
    settings = JSON.parse(await fs.readFile(meta, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings))
    throw new Error('pet.json 格式无效。');
  const duration = settings.frameDuration ?? 100;
  if (!Number.isInteger(duration) || duration < 16 || duration > 30000)
    throw new Error('每帧时长需要为 16–30000 毫秒。');
  const overrides = settings.clips ?? {};
  if (
    !overrides ||
    typeof overrides !== 'object' ||
    Array.isArray(overrides) ||
    Object.keys(overrides).some((n) => !names.includes(n))
  )
    throw new Error('pet.json 动作名称无效。');
  let width,
    height,
    totalBytes = 0;
  const bitmaps = [],
    frames = [],
    clips = {};
  for (const name of names) {
    const dir = path.join(root, name);
    let entries;
    try {
      const stat = await fs.lstat(dir);
      if (!stat.isDirectory()) throw new Error(`动作 ${name} 需要是真实文件夹。`);
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (e) {
      if (e.code === 'ENOENT') continue;
      throw e;
    }
    const files = entries
      .filter((e) => /\.png$/i.test(e.name))
      .sort(
        (a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }) || a.name.localeCompare(b.name, 'en'),
      );
    if (!files.length) continue;
    if (bitmaps.length + files.length > 256) throw new Error('动画包最多包含 256 帧。');
    const indices = [];
    for (const entry of files) {
      const target = path.join(dir, entry.name);
      const stat = await fs.lstat(target);
      if (!stat.isFile() || stat.size > 8 * 1024 * 1024)
        throw new Error(`动画帧 ${name}/${entry.name} 需要是真实 PNG 文件且小于 8 MiB。`);
      totalBytes += stat.size;
      if (totalBytes > 32 * 1024 * 1024) throw new Error('全部动画帧需要小于 32 MiB。');
      const bytes = await fs.readFile(target);
      if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        throw new Error(`动画帧 ${entry.name} 不是 PNG。`);
      // Inspect dimensions before decoding to bound native decoder allocations.
      const w = bytes.length >= 24 ? bytes.readUInt32BE(16) : 0;
      const h = bytes.length >= 24 ? bytes.readUInt32BE(20) : 0;
      if (!w || !h || w > 2048 || h > 2048) throw new Error('每帧画布需要在 1–2048 像素以内。');
      if (width && (w !== width || h !== height))
        throw new Error('所有动作帧需要相同画布尺寸。请保留原画布和脚底位置，关闭裁剪。');
      width = w;
      height = h;
      if (width * height * (bitmaps.length + 1) > 16 * 1024 * 1024)
        throw new Error('动画包的解码像素过多，请降低画布尺寸或帧数。');
      const decoded = codec.decode(bytes);
      if (
        !decoded ||
        decoded.width !== w ||
        decoded.height !== h ||
        !Buffer.isBuffer(decoded.bitmap) ||
        decoded.bitmap.length !== w * h * 4
      )
        throw new Error(`动画帧 ${entry.name} 无法解码。`);
      indices.push(frames.length);
      frames.push({ rect: [0, 0, w, h], duration });
      bitmaps.push(decoded.bitmap);
    }
    const options = overrides[name] ?? {};
    if (!options || typeof options !== 'object' || Array.isArray(options))
      throw new Error(`动作 ${name} 设置无效。`);
    clips[name] = { frames: indices, loop: ['idle', 'sleep', 'talk', 'read', 'gaming'].includes(name), ...options };
    // Frame indices come only from the selected local files.
    clips[name].frames = indices;
  }
  if (!clips.idle) throw new Error('请创建 idle 文件夹并放入待机 PNG 帧。其他动作可按需添加。');
  const columns = Math.min(Math.floor(8192 / width), Math.ceil(Math.sqrt((bitmaps.length * height) / width)));
  const rows = Math.ceil(bitmaps.length / columns),
    atlasWidth = width * columns,
    atlasHeight = height * rows;
  if (atlasHeight > 8192 || atlasWidth * atlasHeight > 16 * 1024 * 1024)
    throw new Error('合成图集过大，请降低画布尺寸或帧数。');
  const bitmap = Buffer.alloc(atlasWidth * atlasHeight * 4);
  bitmaps.forEach((source, i) => {
    const x = (i % columns) * width,
      y = Math.floor(i / columns) * height;
    frames[i].rect = [x, y, width, height];
    for (let row = 0; row < height; row++)
      source.copy(bitmap, ((y + row) * atlasWidth + x) * 4, row * width * 4, (row + 1) * width * 4);
  });
  const sprite = validateAnimation(
    { width, height, frames, clips, pixelated: pixelStyles.has(style) },
    { width: atlasWidth, height: atlasHeight },
  );
  const png = codec.encode(bitmap, atlasWidth, atlasHeight);
  if (!Buffer.isBuffer(png) || png.length > 8 * 1024 * 1024)
    throw new Error('合成图集需要小于 8 MiB。请减少帧数或分辨率。');
  return {
    id: randomUUID(),
    characterId,
    name: typeof settings.name === 'string' ? settings.name.slice(0, 120) : path.basename(root),
    style,
    kind: 'image',
    sprite,
    images: { neutral: `data:image/png;base64,${png.toString('base64')}` },
    generated: false,
    createdAt: new Date().toISOString(),
  };
}
module.exports = { readSequenceFolder };
