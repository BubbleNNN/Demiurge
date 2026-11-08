'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { safePath } = require('./models.cjs');
const CLIPS = new Set([
  'idle',
  ...['walk_left','walk_right','walk_up','walk_down','drag','listen','sleep'].flatMap(id=>[id,`enter_${id}`,`exit_${id}`]),
  ...require('../shared/activities.json').activities.flatMap(({ id }) => [id, `enter_${id}`, `exit_${id}`]),
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
]);
function integer(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`动画${label}无效。`);
  return value;
}
function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('动画数据格式无效。');
  return value;
}
// A large pack keeps its frames on several atlas pages. Page 0 is the skin's own image; the
// rest are listed here, each an embedded PNG or a stored file named by its SHA-256.
const PAGE_ASSET = /^mori-asset:\/\/skins\/[0-9a-f]{64}\.png$/;
function validatePages(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.length || value.length > 16) throw new Error('动画图集分页无效。');
  return value.map((page) => {
    const p = object(page);
    const width = integer(p.width, 1, 8192, '分页宽度'),
      height = integer(p.height, 1, 8192, '分页高度');
    if (typeof p.src !== 'string') throw new Error('动画图集分页无效。');
    if (p.src.startsWith('data:image/png;base64,')) {
      const head = Buffer.from(p.src.slice(22, 22 + 44), 'base64');
      if (head.length < 24 || head.readUInt32BE(16) !== width || head.readUInt32BE(20) !== height)
        throw new Error('动画图集分页尺寸与图片不符。');
    } else if (!PAGE_ASSET.test(p.src)) throw new Error('动画图集分页只能是本机 PNG。');
    return { src: p.src, width, height };
  });
}
function validateAnimation(value, bounds) {
  const a = object(value);
  const width = integer(a.width, 1, 2048, '宽度'),
    height = integer(a.height, 1, 2048, '高度');
  if (!Array.isArray(a.frames) || !a.frames.length || a.frames.length > 256)
    throw new Error('动画需要 1–256 帧。');
  const pages = validatePages(a.pages);
  const frames = a.frames.map((value) => {
    const f = object(value);
    if (!Array.isArray(f.rect) || f.rect.length !== 4) throw new Error('动画帧坐标无效。');
    const rect = f.rect.map((v, i) => integer(v, i < 2 ? 0 : 1, 8192, '帧坐标'));
    const page = f.page === undefined ? 0 : integer(f.page, 1, pages ? pages.length : 0, '分页');
    const limit = page ? pages[page - 1] : bounds;
    if (limit && (rect[0] + rect[2] > limit.width || rect[1] + rect[3] > limit.height))
      throw new Error('动画帧超出图片边界。');
    let offset;
    if (f.offset !== undefined) {
      if (!Array.isArray(f.offset) || f.offset.length !== 2) throw new Error('动画帧偏移无效。');
      offset = f.offset.map((v) => integer(v, -2048, 2048, '帧偏移'));
    }
    // A trimmed frame: `cell` is the physical size of its full canvas and `offset` is where the
    // stored rect sits inside that canvas, in the same physical pixels.
    let cell;
    if (f.cell !== undefined) {
      if (!Array.isArray(f.cell) || f.cell.length !== 2) throw new Error('动画帧画布无效。');
      cell = f.cell.map((v) => integer(v, 1, 8192, '帧画布'));
      if (!offset || offset[0] < 0 || offset[1] < 0 || offset[0] + rect[2] > cell[0] || offset[1] + rect[3] > cell[1])
        throw new Error('裁边后的动画帧超出其画布。');
    }
    return {
      rect,
      duration: integer(f.duration, 16, 30000, '帧时长'),
      ...(offset ? { offset } : {}),
      ...(cell ? { cell } : {}),
      ...(page ? { page } : {}),
    };
  });
  const clips = {};
  for (const [name, value] of Object.entries(object(a.clips))) {
    if (!CLIPS.has(name)) throw new Error(`不支持的动画名称：${name}`);
    const c = object(value);
    if (!Array.isArray(c.frames) || !c.frames.length || c.frames.length > 512)
      throw new Error('动作帧序列无效。');
    const indices = c.frames.map((v) => integer(v, 0, frames.length - 1, '帧索引'));
    let durations;
    if (c.durations !== undefined) {
      if (!Array.isArray(c.durations) || c.durations.length !== indices.length)
        throw new Error('动作时长需要与帧数一致。');
      durations = c.durations.map((v) => integer(v, 16, 30000, '动作时长'));
    }
    if (c.loop !== undefined && typeof c.loop !== 'boolean') throw new Error('动画循环标记无效。');
    clips[name] = {
      frames: indices,
      ...(durations ? { durations } : {}),
      ...(c.loop !== undefined ? { loop: c.loop } : {}),
    };
  }
  if (!clips.idle) throw new Error('动画包需要 idle 待机动作。');
  let mouthFrames;
  if (a.mouthFrames !== undefined) {
    if (!clips.talk) throw new Error('指定口型需要 talk 说话动作。');
    const value = object(a.mouthFrames);
    mouthFrames = Object.fromEntries(
      ['closed', 'small', 'wide'].map((name) => [
        name,
        integer(value[name], 0, frames.length - 1, '口型索引'),
      ]),
    );
  }
  if (a.pixelated !== undefined && typeof a.pixelated !== 'boolean') throw new Error('像素显示标记无效。');
  let palette;
  if (a.palette !== undefined) {
    if (
      !Array.isArray(a.palette) ||
      a.palette.length < 1 ||
      a.palette.length > 256 ||
      a.palette.some((v) => typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v))
    )
      throw new Error('动画调色板无效。');
    palette = a.palette;
  }
  return {
    width,
    height,
    frames,
    clips,
    ...(a.pixelated !== undefined ? { pixelated: a.pixelated } : {}),
    ...(palette ? { palette } : {}),
    ...(mouthFrames ? { mouthFrames } : {}),
    ...(pages ? { pages } : {}),
  };
}
function parseAseprite(input) {
  const a = object(input),
    meta = object(a.meta);
  const values = Array.isArray(a.frames) ? a.frames : Object.values(object(a.frames));
  if (!values.length || values.some((f) => f.rotated || f.trimmed))
    throw new Error('请在 Aseprite 导出时关闭 trim 和 rotate，使用完整画布帧。');
  const first = object(values[0].frame);
  const frames = values.map((value) => {
    const f = object(value),
      rect = object(f.frame);
    if (rect.w !== first.w || rect.h !== first.h) throw new Error('所有动画帧需要使用相同的画布尺寸。');
    return { rect: [rect.x, rect.y, rect.w, rect.h], duration: f.duration };
  });
  const clips = {};
  const tags = meta.frameTags || [];
  if (!Array.isArray(tags) || tags.length > 100) throw new Error('动画标签格式无效。');
  for (const tag of tags) {
    if (typeof tag.name !== 'string') throw new Error('动画标签名称无效。');
    const name = tag.name.toLowerCase();
    if (!CLIPS.has(name)) continue;
    const from = integer(tag.from, 0, frames.length - 1, '标签起点'),
      to = integer(tag.to, from, frames.length - 1, '标签终点');
    let indices = Array.from({ length: to - from + 1 }, (_, i) => from + i);
    if (tag.direction === 'reverse' || tag.direction === 'pingpong_reverse') indices.reverse();
    if (tag.direction === 'pingpong' || tag.direction === 'pingpong_reverse')
      indices = [...indices, ...indices.slice(1, -1).reverse()];
    clips[name] = { frames: indices, loop: ['idle', 'talk', 'sleep', ...require('../shared/activities.json').activities.map((a) => a.id)].includes(name) };
  }
  clips.idle ||= { frames: clips.neutral?.frames || [0], loop: true };
  return {
    image: meta.image,
    animation: validateAnimation({ width: first.w, height: first.h, frames, clips, pixelated: true }),
  };
}
async function readSprite(file, characterId, style, decodeSize) {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > 512 * 1024) throw new Error('动画 JSON 需要小于 512 KiB。');
  const input = JSON.parse(await fs.readFile(file, 'utf8'));
  const pack =
    input.version === 1 && input.animation
      ? { image: input.image, animation: validateAnimation(input.animation) }
      : parseAseprite(input);
  const imagePath = safePath(pack.image);
  if (!/\.png$/i.test(imagePath)) throw new Error('动画图集需要为透明 PNG。');
  const root = await fs.realpath(path.dirname(file)),
    target = await fs.realpath(path.resolve(root, imagePath));
  if (!target.startsWith(root + path.sep)) throw new Error('图集必须位于动画 JSON 的同一目录或子目录内。');
  const imageStat = await fs.stat(target);
  if (!imageStat.isFile() || imageStat.size > 8 * 1024 * 1024) throw new Error('动画图集需要小于 8 MiB。');
  const bytes = await fs.readFile(target);
  const bounds = decodeSize(bytes);
  if (!bounds?.width || !bounds?.height || bounds.width > 8192 || bounds.height > 8192)
    throw new Error('动画图集无法解码或尺寸超过限制。');
  const sprite = validateAnimation(
    input.version === 1 && input.animation
      ? pack.animation
      : { ...pack.animation, pixelated: ['pixel', '8bit'].includes(style) },
    bounds,
  );
  return {
    id: randomUUID(),
    characterId,
    name: path.basename(file, '.json'),
    style,
    kind: 'image',
    sprite,
    images: { neutral: `data:image/png;base64,${bytes.toString('base64')}` },
    generated: false,
    createdAt: new Date().toISOString(),
  };
}
module.exports = { validateAnimation, parseAseprite, readSprite };
