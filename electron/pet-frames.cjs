'use strict';
const { createHash } = require('node:crypto');
const { imageBytes } = require('./references.cjs');
const { validateAnimation } = require('./sprites.cjs');
const { layoutFramesFlexible, assertAtlasBytes } = require('./atlas-layout.cjs');
const { motionRecipe, motionClip, activityTransitions, productionOptions } = require('./pet-recipes.cjs');

function decodePng(dataUrl, codec) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,'))
    throw new Error('桌宠动画需要真正透明的 PNG，不能使用 JPEG 或带棋盘格背景的图片。');
  const { bytes } = imageBytes(dataUrl);
  if (bytes.length > 8 * 1024 * 1024 || bytes.length < 24) throw new Error('桌宠帧图片无效或超过 8 MiB。');
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  if (width < 32 || height < 32 || width > 2048 || height > 2048)
    throw new Error('桌宠帧画布需在 32–2048 像素以内。');
  const decoded = codec.decode(bytes);
  if (
    !decoded ||
    decoded.width !== width ||
    decoded.height !== height ||
    !Buffer.isBuffer(decoded.bitmap) ||
    decoded.bitmap.length !== width * height * 4
  )
    throw new Error('无法解码桌宠 PNG。');
  return decoded;
}
function bounds(frame) {
  let left = frame.width,
    top = frame.height,
    right = -1,
    bottom = -1,
    opaque = 0;
  for (let y = 0; y < frame.height; y++)
    for (let x = 0; x < frame.width; x++) {
      if (frame.bitmap[(y * frame.width + x) * 4 + 3] < 24) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      opaque++;
    }
  const margin = Math.max(1, Math.floor(Math.min(frame.width, frame.height) * 0.015));
  if (opaque < frame.width * frame.height * 0.015) throw new Error('生成帧没有足够的角色内容。');
  if (opaque > frame.width * frame.height * 0.9)
    throw new Error('生成帧没有透明背景，请换用支持透明 PNG 的图像接口。');
  if (left < margin || top < margin || right >= frame.width - margin || bottom >= frame.height - margin)
    throw new Error('人物贴近画布或分格边缘，可能被裁切。请重新生成这个动作，保留头发、手和脚的留白。');
  return { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 };
}
function footAnchor(frame, box) {
  let sum = 0,
    count = 0;
  for (let y = Math.max(box.top, box.bottom - Math.floor(box.height * 0.12)); y <= box.bottom; y++)
    for (let x = box.left; x <= box.right; x++) {
      const alpha = frame.bitmap[(y * frame.width + x) * 4 + 3];
      if (alpha >= 24) {
        sum += x * alpha;
        count += alpha;
      }
    }
  return { x: count ? sum / count : (box.left + box.right) / 2, y: box.bottom };
}
// Adapted from Anime Codex pet-artifacts.cjs; see docs/THIRD_PARTY.md.
// Only small aspect deviations are repairable: never reinterpret a 4-frame sheet
// as 8 frames. Inspect the ORIGINAL cell before padding so clipping stays an error.
function splitSheet(dataUrl, codec, motion, options = {}) {
  const sheet = decodePng(dataUrl, codec);
  const recipe = motionRecipe(motion, options);
  const targetAspect = recipe.count === 8 ? 1.5 : 1;
  if (Math.abs(sheet.width / sheet.height / targetAspect - 1) > 0.2)
    throw new Error(
      recipe.count === 4
        ? '四帧动作需要接近正方形的 2×2 等分画布，长宽比偏差不能超过 20%。'
        : '八帧动作需要接近 3:2 的 4×2 等分画布，长宽比偏差不能超过 20%。',
    );
  const cw = Math.ceil(sheet.width / recipe.columns),
    ch = Math.ceil(sheet.height / recipe.rows);
  const unit = recipe.count === 8 ? Math.ceil(Math.max(cw / 3, ch / 4)) : Math.max(cw, ch);
  const width = recipe.count === 8 ? unit * 3 : unit;
  const height = recipe.count === 8 ? unit * 4 : unit;
  const frames = Array.from({ length: recipe.count }, (_, index) => {
    const col = index % recipe.columns,
      row = Math.floor(index / recipe.columns);
    const x0 = Math.floor((col * sheet.width) / recipe.columns);
    const y0 = Math.floor((row * sheet.height) / recipe.rows);
    const w = Math.floor(((col + 1) * sheet.width) / recipe.columns) - x0;
    const h = Math.floor(((row + 1) * sheet.height) / recipe.rows) - y0;
    const source = { width: w, height: h, bitmap: Buffer.alloc(w * h * 4) };
    for (let y = 0; y < h; y++) {
      const offset = ((y0 + y) * sheet.width + x0) * 4;
      sheet.bitmap.copy(source.bitmap, y * w * 4, offset, offset + w * 4);
    }
    bounds(source);
    const bitmap = Buffer.alloc(width * height * 4);
    const dx = Math.floor((width - w) / 2),
      dy = height - h;
    for (let y = 0; y < h; y++)
      source.bitmap.copy(bitmap, ((y + dy) * width + dx) * 4, y * w * 4, (y + 1) * w * 4);
    return { width, height, bitmap };
  });
  const unique = new Set(frames.map((f) => createHash('sha256').update(f.bitmap).digest('hex')));
  if (unique.size < 2) throw new Error('所有帧完全相同，没有实际动作或表情变化，请重新生成这个动作。');
  if (recipe.count === 8 && unique.size < 6)
    throw new Error('八帧动作少于六个不同姿势，请重新生成，避免重复帧充数。');
  const representatives = [];
  for (const frame of frames)
    if (!representatives.some((other) => !visiblyDifferent(frame, other))) representatives.push(frame);
  if (representatives.length < (recipe.count === 8 ? 6 : 2))
    throw new Error(
      recipe.count === 8
        ? '八帧动作少于六个有可见变化的帧；透明像素和轻微噪点不算动作，请检查后重新生成。'
        : '动作没有足够的可见变化；透明像素和轻微噪点不算动作，请检查后重新生成。',
    );
  return {
    frames,
    report: {
      sourceWidth: sheet.width,
      sourceHeight: sheet.height,
      cellWidth: width,
      cellHeight: height,
      padded: sheet.width !== width * recipe.columns || sheet.height !== height * recipe.rows,
      distinctFrames: representatives.length,
    },
  };
}

function visiblyDifferent(a, b) {
  let visible = 0,
    changed = 0;
  for (let i = 0; i < a.bitmap.length; i += 4) {
    const aa = a.bitmap[i + 3],
      ba = b.bitmap[i + 3];
    if (Math.max(aa, ba) < 24) continue;
    visible++;
    // Premultiplication ignores hidden RGB and measures displayed color/opacity.
    if (
      Math.abs(aa - ba) > 12 ||
      [0, 1, 2].some((c) => Math.abs((a.bitmap[i + c] * aa) / 255 - (b.bitmap[i + c] * ba) / 255) > 12)
    )
      changed++;
  }
  return changed >= Math.max(4, Math.ceil(visible * 0.001));
}

// Flat sticker art only. Original files and other media retain their alpha.
function cleanStickerAlpha(frame) {
  for (let i = 0; i < frame.bitmap.length; i += 4)
    if (frame.bitmap[i + 3] < 24) frame.bitmap.fill(0, i, i + 4);
}
function inspectMaster(dataUrl, codec) {
  return bounds(decodePng(dataUrl, codec));
}
function inspectSheet(dataUrl, codec, motion, options = {}) {
  return splitSheet(dataUrl, codec, motion, options).report;
}

function packFrames(masterImage, sheets, style, codec, options = {}) {
  productionOptions(options);
  const master = decodePng(masterImage, codec),
    masterBox = bounds(master),
    masterAnchor = footAnchor(master, masterBox);
  if (style === 'sticker') cleanStickerAlpha(master);
  const warnings = [];
  const groups = [{ name: 'idle', frames: [master], anchor: masterAnchor, sourceScale: 1 }];
  for (const [motion, image] of Object.entries(sheets)) {
    const { frames, report } = splitSheet(image, codec, motion, options);
    if (report.padded)
      warnings.push(
        `动作 ${motion} 的原始图集为 ${report.sourceWidth}×${report.sourceHeight}；已按等分网格补透明留白，每帧 ${report.cellWidth}×${report.cellHeight}，未拉伸或裁切原图。`,
      );
    if (style === 'sticker') frames.forEach(cleanStickerAlpha);
    const first = bounds(frames[0]);
    const sourceScale = masterBox.height / first.height;
    // One fixed transform for the whole clip: do not individually ground a jumping frame
    // or scale away a nod. The model authors the poses; this only aligns the clip's rest pose.
    if (
      motion !== 'emotions' &&
      frames.some((f) => {
        const b = bounds(f);
        return b.height < first.height * 0.55 || b.height > first.height * 1.45;
      })
    )
      throw new Error(`动作 ${motion} 的人物比例变化过大，请重新生成此动作。`);
    groups.push({ name: motion, frames, anchor: footAnchor(frames[0], first), sourceScale });
  }
  const pixelated = style === 'pixel' || style === '8bit';
  if (style === 'sticker')
    warnings.push(
      '贴纸成品已清理 alpha 小于 24/255 的背景残留；此范围内的淡色半透明细节也会被清理。任务中的原始图片保持不变。',
    );
  function build(width, height) {
    const records = groups.flatMap((g) => g.frames.map((f) => ({ ...f, group: g, box: bounds(f) })));
    let left = 0,
      right = 0,
      top = 0,
      bottom = 0;
    for (const f of records) {
      const { anchor, sourceScale } = f.group;
      left = Math.min(left, (f.box.left - anchor.x) * sourceScale);
      right = Math.max(right, (f.box.right - anchor.x + 1) * sourceScale);
      top = Math.min(top, (f.box.top - anchor.y) * sourceScale);
      bottom = Math.max(bottom, (f.box.bottom - anchor.y + 1) * sourceScale);
    }
    const scale = Math.min((width - 24) / (right - left), (height - 24) / (bottom - top));
    const dx = width / 2 - ((left + right) * scale) / 2,
      dy = 12 - top * scale;
    const sizes = records.map((f) => {
      // Keep each clip at its own native sampling density. The logical canvas
      // is identical, so changing resolution does not change pose scale.
      const density = pixelated ? 1 : 1 / (scale * f.group.sourceScale);
      return { width: Math.ceil(width * density), height: Math.ceil(height * density) };
    });
    const layout = layoutFramesFlexible(sizes),
      atlasWidth = layout.width,
      atlasHeight = layout.height;
    const bitmap = Buffer.alloc(atlasWidth * atlasHeight * 4),
      frames = [],
      clips = {};
    let mouthFrames;
    let index = 0;
    for (const g of groups) {
      const indices = [];
      for (const f of g.frames) {
        const rect = layout.rects[index];
        const density = Math.min(rect[2] / width, rect[3] / height);
        const s = scale * g.sourceScale * density;
        for (let y = 0; y < rect[3]; y++)
          for (let x = 0; x < rect[2]; x++) {
            const sx = (x - dx * density) / s + g.anchor.x,
              sy = (y - dy * density) / s + g.anchor.y;
            if (sx < 0 || sy < 0 || sx >= f.width - 1 || sy >= f.height - 1) continue;
            const target = ((rect[1] + y) * atlasWidth + rect[0] + x) * 4;
            if (pixelated) {
              const offset = (Math.round(sy) * f.width + Math.round(sx)) * 4;
              f.bitmap.copy(bitmap, target, offset, offset + 4);
            } else {
              const ix = Math.floor(sx),
                iy = Math.floor(sy),
                fx = sx - ix,
                fy = sy - iy;
              for (let c = 0; c < 4; c++) {
                const sample = (xx, yy) => f.bitmap[(yy * f.width + xx) * 4 + c];
                bitmap[target + c] = Math.round(
                  sample(ix, iy) * (1 - fx) * (1 - fy) +
                    sample(ix + 1, iy) * fx * (1 - fy) +
                    sample(ix, iy + 1) * (1 - fx) * fy +
                    sample(ix + 1, iy + 1) * fx * fy,
                );
              }
            }
          }
        frames.push({ rect, duration: 140 });
        indices.push(index++);
      }
      if (g.name === 'idle') {
        clips.idle = { frames: [0], loop: true };
        clips.neutral = { frames: [0], loop: true };
      } else if (g.name === 'emotions')
        ['happy', 'thinking', 'sad', 'surprised'].forEach((name, i) => {
          clips[name] = { frames: [indices[i]], loop: true };
        });
      else {
        clips[g.name] = motionClip(g.name, indices, options);
        Object.assign(clips, activityTransitions(g.name, indices, options));
        if (g.name === 'sleep')
          clips.sleepy = { frames: [indices[indices.length === 8 ? 4 : 2]], loop: true };
        if (g.name === 'talk')
          mouthFrames = { closed: 0, small: indices[1], wide: indices[indices.length === 8 ? 3 : 2] };
      }
    }
    return {
      bytes: codec.encode(bitmap, atlasWidth, atlasHeight),
      sprite: validateAnimation(
        { width, height, frames, clips, pixelated, ...(mouthFrames ? { mouthFrames } : {}) },
        { width: atlasWidth, height: atlasHeight },
      ),
    };
  }
  const result = build(384, 512);
  assertAtlasBytes(result.bytes);
  if (!pixelated) {
    const smallest = Math.min(...groups.flatMap((g) => g.frames.map((f) => bounds(f).height)));
    warnings.push(
      `最小原始姿势的人物高度为 ${smallest} 像素；图集保留各帧的原始采样密度。大尺寸或高 DPI 展示需要足够清晰的独立动作原帧，插值放大不会增加细节。`,
    );
  }
  return {
    image: `data:image/png;base64,${result.bytes.toString('base64')}`,
    sprite: result.sprite,
    warnings,
  };
}
module.exports = { inspectMaster, inspectSheet, packFrames, splitSheet };
