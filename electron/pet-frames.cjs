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
  // A hair tip or a shoe grazing a cell edge is not a cut figure. Measure how much SOLID content
  // sits in the edge band: a narrow touch is kept and reported, a wide one means the body crosses
  // the border and the frame really is clipped.
  const contacts = [];
  for (const [side, span, length] of [
    ['top', top < margin ? bandSpan(frame, 'top', margin) : 0, frame.width],
    ['bottom', bottom >= frame.height - margin ? bandSpan(frame, 'bottom', margin) : 0, frame.width],
    ['left', left < margin ? bandSpan(frame, 'left', margin) : 0, frame.height],
    ['right', right >= frame.width - margin ? bandSpan(frame, 'right', margin) : 0, frame.height],
  ]) {
    if (!span) continue;
    if (span > length * 0.1)
      throw new Error('人物贴近画布或分格边缘，可能被裁切。请重新生成这个动作，保留头发、手和脚的留白。');
    contacts.push({ side, span });
  }
  return { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1, contacts };
}
// Distinct rows or columns in an edge band holding solid (alpha >= 128) pixels.
function bandSpan(frame, side, margin) {
  const touched = new Set();
  const along = side === 'top' || side === 'bottom' ? frame.width : frame.height;
  for (let i = 0; i < along; i++)
    for (let d = 0; d < margin; d++) {
      const x = side === 'left' ? d : side === 'right' ? frame.width - 1 - d : i;
      const y = side === 'top' ? d : side === 'bottom' ? frame.height - 1 - d : i;
      if (frame.bitmap[(y * frame.width + x) * 4 + 3] >= 128) {
        touched.add(i);
        break;
      }
    }
  return touched.size;
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
        : recipe.count === 12
          ? '十二帧动作需要接近正方形的 4×3 等分画布，长宽比偏差不能超过 20%。'
          : '八帧动作需要接近 3:2 的 4×2 等分画布，长宽比偏差不能超过 20%。',
    );
  const cw = Math.ceil(sheet.width / recipe.columns),
    ch = Math.ceil(sheet.height / recipe.rows);
  const unit = recipe.count === 8 ? Math.ceil(Math.max(cw / 3, ch / 4)) : Math.max(cw, ch);
  const width = recipe.count === 8 ? unit * 3 : unit;
  const height = recipe.count === 8 ? unit * 4 : unit;
  const edgeContacts = [];
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
    for (const contact of bounds(source).contacts) edgeContacts.push({ frame: index + 1, ...contact });
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
  if (recipe.aligned) {
    // Check each segment, not just the sheet: an animated entrance cannot hide
    // a frozen loop. Require all four gait phases so one half-stride is not lost.
    for (const [label, start] of [
      ['进入', 0],
      ['循环', 4],
      ['退出', 8],
    ]) {
      const distinct = [];
      for (const frame of frames.slice(start, start + 4))
        if (!distinct.some((other) => !visiblyDifferent(frame, other))) distinct.push(frame);
      const minimum = label === '循环' && motion.startsWith('walk_') ? 4 : label === '循环' ? 2 : 3;
      if (distinct.length < minimum)
        throw new Error(`动作 ${motion} 的${label}段缺少真实姿势变化，请修正此动作；不会用重复图片补帧。`);
    }
  }
  return {
    frames,
    report: {
      sourceWidth: sheet.width,
      sourceHeight: sheet.height,
      cellWidth: width,
      cellHeight: height,
      padded: sheet.width !== width * recipe.columns || sheet.height !== height * recipe.rows,
      distinctFrames: representatives.length,
      edgeContacts,
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
  if (style === 'sticker' || style === 'pastel' || style === 'chibi-pet') cleanStickerAlpha(master);
  const aligned = options.transitionVersion === 3;
  const warnings = [];
  const groups = [
    { name: 'idle', frames: [master], anchor: masterAnchor, footX: [masterAnchor.x], sourceScale: 1 },
  ];
  for (const [motion, image] of Object.entries(sheets)) {
    const { frames, report } = splitSheet(image, codec, motion, options);
    if (report.padded)
      warnings.push(
        `动作 ${motion} 的原始图集为 ${report.sourceWidth}×${report.sourceHeight}；已按等分网格补透明留白，每帧 ${report.cellWidth}×${report.cellHeight}，未拉伸或裁切原图。`,
      );
    if (report.edgeContacts.length)
      warnings.push(
        `动作 ${motion} 第 ${[...new Set(report.edgeContacts.map((c) => c.frame))].join('、')} 帧的发梢、手或脚贴到分格边缘（最宽 ${Math.max(...report.edgeContacts.map((c) => c.span))} 像素），已按原样保留；若试播时看到缺角，可单独重做这个动作。`,
      );
    if (style === 'sticker' || style === 'pastel' || style === 'chibi-pet') frames.forEach(cleanStickerAlpha);
    const first = bounds(frames[0]);
    const sourceScale = masterBox.height / first.height;
    // One fixed transform for the whole clip: do not individually ground a jumping frame
    // or scale away a nod. The model authors the poses; this only aligns the clip's rest pose.
    if (
      motion !== 'emotions' &&
      frames.some((f) => {
        const b = bounds(f);
        return (
          b.height < first.height * (aligned ? 0.18 : 0.55) ||
          b.height > first.height * (aligned ? 1.8 : 1.45)
        );
      })
    )
      throw new Error(`动作 ${motion} 的人物比例变化过大，请重新生成此动作。`);
    // Image models rarely centre each pose exactly in its grid cell, so a single registration per
    // clip makes the character slide sideways from cell to cell. Register every frame horizontally
    // by where its feet stand (planted in all current motions); keep ONE vertical registration per
    // clip so jumps, crouches and nods keep their authored height.
    // New sheets author locomotion/crouching in a fixed canvas. Register once
    // using neutral; following alternating feet per frame causes lateral jitter.
    const fixedAnchor = footAnchor(frames[0], first);
    const footX = frames.map((frame) => (aligned ? fixedAnchor.x : footAnchor(frame, bounds(frame)).x));
    groups.push({ name: motion, frames, anchor: footAnchor(frames[0], first), footX, sourceScale });
  }
  const pixelated = style === 'pixel' || style === '8bit';
  if (style === 'sticker' || style === 'pastel' || style === 'chibi-pet')
    warnings.push(
      '贴纸成品已清理 alpha 小于 24/255 的背景残留；此范围内的淡色半透明细节也会被清理。任务中的原始图片保持不变。',
    );
  function build(width, height, quality = 1) {
    const records = groups.flatMap((g) =>
      g.frames.map((f, i) => ({ ...f, group: g, box: bounds(f), anchorX: g.footX[i] })),
    );
    let left = 0,
      right = 0,
      top = 0,
      bottom = 0;
    for (const f of records) {
      const { anchor, sourceScale } = f.group;
      left = Math.min(left, (f.box.left - f.anchorX) * sourceScale);
      right = Math.max(right, (f.box.right - f.anchorX + 1) * sourceScale);
      top = Math.min(top, (f.box.top - anchor.y) * sourceScale);
      bottom = Math.max(bottom, (f.box.bottom - anchor.y + 1) * sourceScale);
    }
    const scale = Math.min((width - 24) / (right - left), (height - 24) / (bottom - top));
    const dx = width / 2 - ((left + right) * scale) / 2,
      dy = 12 - top * scale;
    const sizes = records.map((f) => {
      // Keep each clip at its own native sampling density. The logical canvas
      // is identical, so changing resolution does not change pose scale.
      const density = pixelated ? 1 : quality / (scale * f.group.sourceScale);
      return { width: Math.ceil(width * density), height: Math.ceil(height * density) };
    });
    const layout = layoutFramesFlexible(sizes, (aligned ? 32 : 16) * 1024 * 1024),
      atlasWidth = layout.width,
      atlasHeight = layout.height;
    const bitmap = Buffer.alloc(atlasWidth * atlasHeight * 4),
      frames = [],
      clips = {};
    let mouthFrames;
    let index = 0;
    for (const g of groups) {
      const indices = [];
      for (const [frameIndex, f] of g.frames.entries()) {
        const anchorX = g.footX[frameIndex];
        const rect = layout.rects[index];
        const density = Math.min(rect[2] / width, rect[3] / height);
        const s = scale * g.sourceScale * density;
        if (aligned && !pixelated) {
          // Preserve authored RGBA samples exactly. Frame canvas dimensions encode
          // the clip's display scale; alignment only translates by whole pixels.
          const ox = Math.round(dx * density - anchorX);
          const oy = Math.round(dy * density - g.anchor.y);
          const startX = Math.max(0, -ox),
            endX = Math.min(f.width, rect[2] - ox);
          for (let sy = Math.max(0, -oy); sy < Math.min(f.height, rect[3] - oy); sy++) {
            if (endX <= startX) continue;
            const source = (sy * f.width + startX) * 4;
            const target = ((rect[1] + sy + oy) * atlasWidth + rect[0] + startX + ox) * 4;
            f.bitmap.copy(bitmap, target, source, source + (endX - startX) * 4);
          }
        } else {
          for (let y = 0; y < rect[3]; y++)
            for (let x = 0; x < rect[2]; x++) {
              const sx = (x - dx * density) / s + anchorX,
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
        if (g.name === 'sleep') clips.sleepy = { frames: [indices[indices.length >= 8 ? 4 : 2]], loop: true };
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
  // Prefer every frame at its native sampling density. When many large frames cannot share one
  // atlas, shrink them all by the smallest uniform step that fits and say so, instead of
  // discarding the finished production.
  let result, quality, overflow;
  for (const step of pixelated || aligned ? [1] : [1, 0.9, 0.8, 0.7, 0.6, 0.5]) {
    try {
      const built = build(384, 512, step);
      assertAtlasBytes(built.bytes);
      result = built;
      quality = step;
      break;
    } catch (error) {
      if (!/图集超过/.test(error.message)) throw error;
      overflow = error;
    }
  }
  if (!result) throw overflow;
  if (quality < 1)
    warnings.push(
      `动作较多，保留原始清晰度的图集超出单张上限；所有帧已统一按原始采样的 ${Math.round(quality * 100)}% 保存，动作和显示尺寸不变。减少动作或分成多个角色包可保留全部像素。`,
    );
  if (!pixelated && quality === 1) {
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
