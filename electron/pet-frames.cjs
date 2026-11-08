'use strict';
const { createHash } = require('node:crypto');
const { imageBytes } = require('./references.cjs');
const { validateAnimation } = require('./sprites.cjs');
const { layoutFramesFlexible, assertAtlasBytes } = require('./atlas-layout.cjs');
const { motionRecipe, motionParts, motionClip, activityTransitions, productionOptions } = require('./pet-recipes.cjs');

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
// Image models space the poses of a sheet evenly, but rarely on the equal grid: a row of four
// is often drawn about 8% narrower than the canvas and each row sits at its own height. Cutting
// equal cells and keeping one registration per clip turns that layout error into motion, and a
// hair tip crossing a grid line is cut off one pose and pasted into the next.
//
// Twelve-frame sheets are therefore read by shape: every connected figure is assigned to the
// cell holding its centre and copied whole, foreign pieces are removed from each cell, and each
// pose is registered by where the model actually put its column and its floor line. Pixels move
// by whole steps only; nothing is resized.
function labelFigures(sheet) {
  const { width, height, bitmap } = sheet;
  const labels = new Int32Array(width * height);
  const stack = new Int32Array(width * height);
  const figures = [];
  for (let start = 0; start < width * height; start++) {
    if (labels[start] || bitmap[start * 4 + 3] < 24) continue;
    const figure = { id: figures.length + 1, count: 0, sumX: 0, sumY: 0, left: width, right: -1, top: height, bottom: -1 };
    figures.push(figure);
    let top = 0;
    stack[top++] = start;
    labels[start] = figure.id;
    while (top) {
      const p = stack[--top],
        x = p % width,
        y = (p - x) / width;
      figure.count++;
      figure.sumX += x;
      figure.sumY += y;
      if (x < figure.left) figure.left = x;
      if (x > figure.right) figure.right = x;
      if (y < figure.top) figure.top = y;
      if (y > figure.bottom) figure.bottom = y;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const q = ny * width + nx;
          if (!labels[q] && bitmap[q * 4 + 3] >= 24) {
            labels[q] = figure.id;
            stack[top++] = q;
          }
        }
    }
  }
  return { labels, figures };
}
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
function registeredFrames(sheet, recipe, width, height, edgeContacts) {
  const { columns, rows, count } = recipe;
  // How rows are put on one level: activities stand, sit or lie on the floor (median lowest
  // point); a jump has one grounded pose per row (lowest point); a lifted character hangs from
  // the same grip (highest point).
  const rowMode = recipe.aligned ? 'floor' : recipe.id === 'drag' ? 'grip' : 'ground';
  const cellW = sheet.width / columns,
    cellH = sheet.height / rows;
  const { labels, figures } = labelFigures(sheet);
  if (figures.reduce((n, figure) => n + figure.count, 0) > sheet.width * sheet.height * 0.6)
    throw new Error('生成帧没有透明背景，请换用支持透明 PNG 的图像接口。');
  const owner = new Map(); // figure id -> frame index
  const parts = Array.from({ length: count }, () => []);
  for (const figure of figures) {
    if (figure.right - figure.left + 1 > cellW * 1.4 || figure.bottom - figure.top + 1 > cellH * 1.4)
      throw new Error('相邻两格的人物连在一起，无法分开成单独的帧。请重新生成这个动作，让每个姿势之间留出透明间隔。');
    const col = Math.min(columns - 1, Math.max(0, Math.floor(figure.sumX / figure.count / cellW)));
    const row = Math.min(rows - 1, Math.max(0, Math.floor(figure.sumY / figure.count / cellH)));
    owner.set(figure.id, row * columns + col);
    parts[row * columns + col].push(figure);
  }
  // The largest shape in a cell is the character; its centre and lowest point register the pose.
  const main = parts.map((list, index) => {
    if (!list.length) throw new Error(`第 ${index + 1} 帧没有角色内容。请重新生成这个动作。`);
    return list.reduce((a, b) => (b.count > a.count ? b : a));
  });
  const margin = Math.max(1, Math.floor(Math.min(cellW, cellH) * 0.015));
  // A figure cut by the sheet border is really clipped; a narrow graze is kept and reported.
  for (let index = 0; index < count; index++)
    for (const figure of parts[index]) {
      const own = (x, y) => labels[y * sheet.width + x] === figure.id && sheet.bitmap[(y * sheet.width + x) * 4 + 3] >= 128;
      for (const [side, touches, length, at] of [
        ['top', figure.top < margin, cellW, (i, d) => [i, d]],
        ['bottom', figure.bottom >= sheet.height - margin, cellW, (i, d) => [i, sheet.height - 1 - d]],
        ['left', figure.left < margin, cellH, (i, d) => [d, i]],
        ['right', figure.right >= sheet.width - margin, cellH, (i, d) => [sheet.width - 1 - d, i]],
      ]) {
        if (!touches) continue;
        const along = side === 'top' || side === 'bottom' ? sheet.width : sheet.height;
        let span = 0;
        for (let i = 0; i < along; i++)
          for (let d = 0; d < margin; d++) {
            const [x, y] = at(i, d);
            if (own(x, y)) {
              span++;
              break;
            }
          }
        if (!span) continue;
        if (span > length * 0.1)
          throw new Error('人物贴近画布或分格边缘，可能被裁切。请重新生成这个动作，保留头发、手和脚的留白。');
        edgeContacts.push({ frame: index + 1, side, span });
      }
    }
  // Columns: the model's real column centres, fitted across every row. A layout that already
  // matches the equal grid keeps exact grid spacing, so well-drawn sheets are untouched.
  const centres = main.map((figure) => figure.sumX / figure.count);
  const columnCentre = Array.from({ length: columns }, (_, c) =>
    median(centres.filter((_, index) => index % columns === c)),
  );
  const meanC = (columns - 1) / 2,
    meanX = columnCentre.reduce((a, b) => a + b, 0) / columns;
  let slope =
    columnCentre.reduce((s, x, c) => s + (c - meanC) * (x - meanX), 0) /
    columnCentre.reduce((s, _, c) => s + (c - meanC) ** 2, 0);
  if (!Number.isFinite(slope) || Math.abs(slope / cellW - 1) <= 0.02 || Math.abs(slope / cellW - 1) > 0.25)
    slope = cellW;
  const slotX = (col) => meanX + (col - meanC) * slope;
  // Rows: put every row on one level; poses inside a row keep their own heights.
  const inRow = (r) => main.filter((_, index) => Math.floor(index / columns) === r);
  const level = Array.from({ length: rows }, (_, r) =>
    rowMode === 'floor'
      ? median(inRow(r).map((figure) => figure.bottom))
      : rowMode === 'ground'
        ? Math.max(...inRow(r).map((figure) => figure.bottom - r * cellH)) + r * cellH
        : Math.min(...inRow(r).map((figure) => figure.top - r * cellH)) + r * cellH,
  );
  // Row 1 keeps its old place in the canvas, so a sheet already on the grid packs as before.
  const floorY = height - cellH + level[0];
  const offsets = main.map((_, index) => {
    const col = index % columns,
      row = Math.floor(index / columns);
    return [Math.round(width / 2 - slotX(col)), Math.round(floorY - level[row])];
  });
  // A loop is one activity repeated in place: a body that creeps sideways from phase to phase
  // and snaps back each cycle reads as vibration. Each loop phase is laid over the first one by
  // its upper body (head and shoulders stay put while legs, arms and props move), searching only
  // a small sideways range so a deliberate lean survives.
  // The loop is frames 5-8 of a whole sheet, or all four frames of a sharp loop segment.
  const loop = !recipe.aligned ? [] : recipe.part === undefined ? (count >= 8 ? [4, 5, 6, 7] : []) : recipe.part === 1 ? [0, 1, 2, 3] : [];
  if (loop.length) {
    const upper = (figure) => {
      const list = [],
        limit = figure.top + Math.floor((figure.bottom - figure.top) * 0.6);
      for (let y = figure.top; y <= limit; y++)
        for (let x = figure.left; x <= figure.right; x++)
          if (labels[y * sheet.width + x] === figure.id && sheet.bitmap[(y * sheet.width + x) * 4 + 3] >= 128)
            list.push(x, y);
      return list;
    };
    const reference = main[loop[0]],
      [rox, roy] = offsets[loop[0]];
    const ref = new Set();
    const refPoints = upper(reference);
    for (let i = 0; i < refPoints.length; i += 2) ref.add((refPoints[i] + rox) * 65536 + refPoints[i + 1] + roy);
    const radius = Math.round(cellW * 0.05);
    for (const index of loop.slice(1)) {
      const list = upper(main[index]),
        [ox, oy] = offsets[index];
      let best = -1,
        shift = 0,
        still = 0;
      for (let dx = -radius; dx <= radius; dx++) {
        let hits = 0;
        for (let i = 0; i < list.length; i += 2) if (ref.has((list[i] + ox + dx) * 65536 + list[i + 1] + oy)) hits++;
        if (dx === 0) still = hits;
        if (hits > best || (hits === best && Math.abs(dx) < Math.abs(shift))) {
          best = hits;
          shift = dx;
        }
      }
      // Ties keep the smallest move, so a pose only moves when the overlap really improves.
      if (best > still) offsets[index][0] += shift;
    }
  }
  // Grow the canvas only as much as the placed figures need, keeping the safety margin.
  let padLeft = 0,
    padRight = 0,
    padTop = 0,
    padBottom = 0;
  // Wider than the edge check's own margin, which grows with the canvas.
  const frameMargin = Math.floor(Math.min(width, height) * 0.02) + 2;
  for (let index = 0; index < count; index++)
    for (const figure of parts[index]) {
      const [ox, oy] = offsets[index];
      padLeft = Math.max(padLeft, frameMargin - (figure.left + ox));
      padRight = Math.max(padRight, figure.right + ox - (width - 1 - frameMargin));
      padTop = Math.max(padTop, frameMargin - (figure.top + oy));
      padBottom = Math.max(padBottom, figure.bottom + oy - (height - 1 - frameMargin));
    }
  const padX = Math.max(padLeft, padRight),
    canvasW = width + 2 * padX,
    canvasH = height + padTop + padBottom;
  const frames = offsets.map(([ox, oy], index) => {
    const bitmap = Buffer.alloc(canvasW * canvasH * 4);
    const col = index % columns,
      row = Math.floor(index / columns);
    const x0 = Math.floor(col * cellW),
      x1 = Math.floor((col + 1) * cellW),
      y0 = Math.floor(row * cellH),
      y1 = Math.floor((row + 1) * cellH);
    const tx = ox + padX,
      ty = oy + padTop;
    const put = (x, y) => {
      const cx = x + tx,
        cy = y + ty;
      if (cx < 0 || cy < 0 || cx >= canvasW || cy >= canvasH) return;
      sheet.bitmap.copy(bitmap, (cy * canvasW + cx) * 4, (y * sheet.width + x) * 4, (y * sheet.width + x) * 4 + 4);
    };
    // The cell itself, faint edge pixels included, minus pieces of neighbouring poses.
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const id = labels[y * sheet.width + x];
        if (!id || owner.get(id) === index) put(x, y);
      }
    // Parts of this pose that cross the grid line into a neighbouring cell.
    for (const figure of parts[index])
      if (figure.left < x0 || figure.right >= x1 || figure.top < y0 || figure.bottom >= y1)
        for (let y = figure.top; y <= figure.bottom; y++)
          for (let x = figure.left; x <= figure.right; x++)
            if ((x < x0 || x >= x1 || y < y0 || y >= y1) && labels[y * sheet.width + x] === figure.id) put(x, y);
    return { width: canvasW, height: canvasH, bitmap };
  });
  // The vertical centre line and the floor (or grip) line every pose was registered to, and each
  // pose's own height, so separately drawn images of one motion can be joined and matched.
  return {
    frames,
    centerX: width / 2 + padX,
    floorY: floorY + padTop,
    heights: main.map((figure) => figure.bottom - figure.top + 1),
  };
}
// Adapted from Anime Codex pet-artifacts.cjs; see docs/THIRD_PARTY.md.
// Only small aspect deviations are repairable: never reinterpret a 4-frame sheet
// as 8 frames. Inspect the ORIGINAL cell before padding so clipping stays an error.
// `image` is one sheet, or for a sharp motion the list of its separately drawn images; with
// `options.part` a single image is checked as that part.
function splitSheet(image, codec, motion, options = {}) {
  if (Array.isArray(image)) return joinParts(image, codec, motion, options);
  return splitOne(image, codec, motion, options);
}
function splitOne(dataUrl, codec, motion, options) {
  const sheet = decodePng(dataUrl, codec);
  const recipe = motionRecipe(motion, options);
  if (recipe.part !== undefined) {
    // A part is placed by the shapes it contains, so any reasonable canvas shape works.
    const aspect = sheet.width / sheet.height;
    if (aspect < 0.5 || aspect > 2.2) throw new Error('动作分段图片的长宽比异常，请重新生成这一段。');
  } else {
    const targetAspect = recipe.count === 8 ? 1.5 : 1;
    if (Math.abs(sheet.width / sheet.height / targetAspect - 1) > 0.2)
      throw new Error(
        recipe.count === 4
          ? '四帧动作需要接近正方形的 2×2 等分画布，长宽比偏差不能超过 20%。'
          : recipe.count === 12
            ? '十二帧动作需要接近正方形的 4×3 等分画布，长宽比偏差不能超过 20%。'
            : '八帧动作需要接近 3:2 的 4×2 等分画布，长宽比偏差不能超过 20%。',
      );
  }
  const cw = Math.ceil(sheet.width / recipe.columns),
    ch = Math.ceil(sheet.height / recipe.rows);
  const unit = recipe.count === 8 ? Math.ceil(Math.max(cw / 3, ch / 4)) : Math.max(cw, ch);
  const width = recipe.count === 8 ? unit * 3 : unit;
  const height = recipe.count === 8 ? unit * 4 : unit;
  const edgeContacts = [];
  const registered = recipe.aligned || options.transitionVersion === 3;
  let layout;
  const frames = registered
    ? (layout = registeredFrames(sheet, recipe, width, height, edgeContacts)).frames
    : Array.from({ length: recipe.count }, (_, index) => {
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
  // Registered frames still need real content on a transparent background.
  if (registered) frames.forEach((frame) => bounds(frame));
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
    const segments = [
      ['进入', 0],
      ['循环', 4],
      ['退出', 8],
    ];
    for (const [label, start] of recipe.part === undefined ? segments : [[segments[recipe.part][0], 0]]) {
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
    layout: layout || {
      centerX: width / 2,
      floorY: height,
      heights: frames.map((frame) => bounds(frame).height),
    },
    report: {
      sourceWidth: sheet.width,
      sourceHeight: sheet.height,
      cellWidth: frames[0].width,
      cellHeight: frames[0].height,
      padded: sheet.width !== width * recipe.columns || sheet.height !== height * recipe.rows,
      distinctFrames: representatives.length,
      edgeContacts,
    },
  };
}
// The separately drawn images of one sharp motion become one motion: every pose shares one
// centre line and one floor line, and each image gets a size factor from poses the prompt
// promises to match across images, because the model rarely draws two images at exactly the
// same scale. Pixels are only copied; the factor is applied as display density when packing.
function joinParts(images, codec, motion, options) {
  const parts = motionParts(motion, options);
  if (images.length !== parts) throw new Error(`动作 ${motion} 需要 ${parts} 段图片，目前只有 ${images.length} 段。`);
  const split = images.map((image, part) => splitOne(image, codec, motion, { ...options, part }));
  const full = motionRecipe(motion, options);
  const per = full.count / parts;
  const height = (part, frame) => split[part].layout.heights[frame];
  // Pairs of matching poses: [part, frame in part] of this image against an earlier one.
  const pairs = full.aligned
    ? [null, [[1, 0], [0, 3]], [[2, 3], [0, 0]]] // loop start = entrance end; exit end = entrance start
    : motion === 'bounce'
      ? [null, [[1, 1], [0, 1]]] // landing crouch = anticipation crouch
      : motion === 'drag'
        ? [null, [[1, 0], [0, 0]]]
        : [];
  const scales = split.map((_, part) => {
    const pair = pairs[part];
    if (!pair) return 1;
    const [[p, f], [q, g]] = pair;
    const ratio = height(q, g) / height(p, f);
    // A very different height means the poses do not match after all: keep the drawn size.
    return ratio >= 0.8 && ratio <= 1.25 ? ratio : 1;
  });
  const left = Math.max(...split.map((s) => Math.max(s.layout.centerX, s.frames[0].width - s.layout.centerX)));
  const above = Math.max(...split.map((s) => s.layout.floorY)),
    below = Math.max(...split.map((s) => s.frames[0].height - s.layout.floorY));
  const width = Math.ceil(left * 2),
    canvasHeight = Math.ceil(above + below);
  const frames = split.flatMap((s) =>
    s.frames.map((frame) => {
      const bitmap = Buffer.alloc(width * canvasHeight * 4);
      const dx = Math.round(width / 2 - s.layout.centerX),
        dy = Math.round(above - s.layout.floorY);
      for (let y = 0; y < frame.height; y++)
        frame.bitmap.copy(bitmap, ((y + dy) * width + dx) * 4, y * frame.width * 4, (y + 1) * frame.width * 4);
      return { width, height: canvasHeight, bitmap };
    }),
  );
  return {
    frames,
    layout: { centerX: width / 2, floorY: above, heights: split.flatMap((s) => s.layout.heights) },
    report: {
      sourceWidth: split[0].report.sourceWidth,
      sourceHeight: split[0].report.sourceHeight,
      cellWidth: width,
      cellHeight: canvasHeight,
      padded: false,
      distinctFrames: split.reduce((n, s) => n + s.report.distinctFrames, 0),
      edgeContacts: split.flatMap((s, part) => s.report.edgeContacts.map((c) => ({ ...c, frame: c.frame + part * per }))),
      parts,
      // Per frame: how much larger this image's poses must be shown to match the first image.
      scales: split.flatMap((s, part) => s.frames.map(() => scales[part])),
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

// Stored pixels per atlas page before a pack is split into pages; well under the per-page limits.
const PAGE_PIXELS = 12 * 1024 * 1024;
// Clips that redraw the idle pose with a small change (eyes, mouth, head, one arm, a face).
const OVER_IDLE = new Set(['blink', 'talk', 'nod', 'shake', 'wave', 'emotions']);
// Where a frame sits over the idle frame: the translation that overlaps their opaque shapes most,
// found coarse to fine. Scale is the clip's own (the model draws a sheet at one size). Returns
// the frame point that lands on the idle frame's foot anchor.
function alignToIdle(master, masterBox, masterAnchor, frame, scale, start, searchScale = false) {
  const levels = [64, 256, 768].map((h) => Math.min(1, h / masterBox.height));
  const masks = levels.map((k) => {
    const w = Math.ceil(master.width * k),
      h = Math.ceil(master.height * k),
      mask = new Uint8Array(w * h);
    let count = 0;
    for (let v = 0; v < h; v++)
      for (let u = 0; u < w; u++) {
        const x = Math.min(master.width - 1, Math.floor(u / k)),
          y = Math.min(master.height - 1, Math.floor(v / k));
        if (master.bitmap[(y * master.width + x) * 4 + 3] >= 128) {
          mask[v * w + u] = 1;
          count++;
        }
      }
    return { w, h, mask, count };
  });
  const box = bounds(frame);
  const points = (k, s) => {
    const f = s * k,
      list = [];
    for (let v = Math.floor(box.top * f); v <= Math.ceil(box.bottom * f); v++)
      for (let u = Math.floor(box.left * f); u <= Math.ceil(box.right * f); u++) {
        const x = Math.min(frame.width - 1, Math.floor(u / f)),
          y = Math.min(frame.height - 1, Math.floor(v / f));
        if (frame.bitmap[(y * frame.width + x) * 4 + 3] >= 128) list.push(u, v);
      }
    return list;
  };
  // Best translation (in idle pixels) at one level for one scale, scored by overlap / union so
  // that different scales compare fairly. Ties keep the smallest correction.
  const fit = (level, s, tx, ty, radius) => {
    const { w, h, mask, count } = masks[level],
      k = levels[level],
      list = points(k, s);
    const cx = Math.round(tx * k),
      cy = Math.round(ty * k);
    let best = -1,
      bx = cx,
      by = cy;
    for (let dy = -radius; dy <= radius; dy++)
      for (let dx = -radius; dx <= radius; dx++) {
        let hits = 0;
        for (let i = 0; i < list.length; i += 2) {
          const u = list[i] + cx + dx,
            v = list[i + 1] + cy + dy;
          if (u >= 0 && v >= 0 && u < w && v < h && mask[v * w + u]) hits++;
        }
        const score = hits / (list.length / 2 + count - hits || 1);
        if (score > best || (score === best && Math.abs(dx) + Math.abs(dy) < Math.abs(bx - cx) + Math.abs(by - cy))) {
          best = score;
          bx = cx + dx;
          by = cy + dy;
        }
      }
    return { score: best, tx: bx / k, ty: by / k, s };
  };
  // Translation that maps the frame's foot anchor onto the idle frame's, at a given scale.
  const fromFeet = (s) => ({ tx: masterAnchor.x - start.x * s, ty: masterAnchor.y - start.y * s });
  let result;
  if (searchScale) {
    // A separately drawn image may be a few percent larger or smaller than the idle frame.
    let top = null;
    for (const f of [0.88, 0.91, 0.94, 0.97, 1, 1.03, 1.06, 1.09, 1.12]) {
      const s = scale * f,
        { tx, ty } = fromFeet(s),
        r = fit(0, s, tx, ty, 10);
      if (!top || r.score > top.score) top = r;
    }
    let refined = null;
    for (const f of [0.985, 1, 1.015]) {
      const r = fit(1, top.s * f, top.tx, top.ty, 4);
      if (!refined || r.score > refined.score) refined = r;
    }
    result = fit(2, refined.s, refined.tx, refined.ty, 4);
  } else {
    let { tx, ty } = fromFeet(scale);
    for (let level = 0; level < levels.length; level++) ({ tx, ty } = fit(level, scale, tx, ty, level === 0 ? 10 : 4));
    result = { tx, ty, s: scale };
  }
  return { x: (masterAnchor.x - result.tx) / result.s, y: (masterAnchor.y - result.ty) / result.s, scale: result.s };
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
    // A sharp motion joins separately drawn images; each frame's size factor relative to the first.
    const relative = report.scales || frames.map(() => 1);
    // One fixed transform for the whole clip: do not individually ground a jumping frame
    // or scale away a nod. The model authors the poses; this only aligns the clip's rest pose.
    if (
      motion !== 'emotions' &&
      frames.some((f, i) => {
        const b = bounds(f),
          h = b.height * relative[i];
        return h < first.height * (aligned ? 0.18 : 0.55) || h > first.height * (aligned ? 1.8 : 1.45);
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
    let footY;
    const sourceScales = relative.map((r) => sourceScale * r);
    // Blinks, mouths, nods, waves and expressions redraw the idle pose. Each such frame is laid
    // exactly over the idle frame, so nothing but the authored change moves between them. When
    // the motion was drawn as several images, each frame's size is matched to the idle frame too.
    if (aligned && OVER_IDLE.has(motion)) {
      const anchors = frames.map((frame) =>
        alignToIdle(master, masterBox, masterAnchor, frame, sourceScale, footAnchor(frame, bounds(frame)), Boolean(report.parts)),
      );
      anchors.forEach((a, i) => {
        footX[i] = a.x;
        sourceScales[i] = a.scale;
      });
      footY = anchors.map((a) => a.y);
    }
    groups.push({ name: motion, frames, anchor: footAnchor(frames[0], first), footX, footY, sourceScale, sourceScales });
  }
  const pixelated = style === 'pixel' || style === '8bit';
  if (style === 'sticker' || style === 'pastel' || style === 'chibi-pet')
    warnings.push(
      '贴纸成品已清理 alpha 小于 24/255 的背景残留；此范围内的淡色半透明细节也会被清理。任务中的原始图片保持不变。',
    );
  function build(width, height, quality = 1) {
    const records = groups.flatMap((g) =>
      g.frames.map((f, i) => ({
        ...f,
        group: g,
        box: bounds(f),
        anchorX: g.footX[i],
        anchorY: g.footY ? g.footY[i] : g.anchor.y,
        sourceScale: g.sourceScales ? g.sourceScales[i] : g.sourceScale,
      })),
    );
    let left = 0,
      right = 0,
      top = 0,
      bottom = 0;
    for (const f of records) {
      const { sourceScale } = f;
      left = Math.min(left, (f.box.left - f.anchorX) * sourceScale);
      right = Math.max(right, (f.box.right - f.anchorX + 1) * sourceScale);
      top = Math.min(top, (f.box.top - f.anchorY) * sourceScale);
      bottom = Math.max(bottom, (f.box.bottom - f.anchorY + 1) * sourceScale);
    }
    const scale = Math.min((width - 24) / (right - left), (height - 24) / (bottom - top));
    const dx = width / 2 - ((left + right) * scale) / 2,
      dy = 12 - top * scale;
    // Render every frame onto its own full logical canvas at its native density, then keep only
    // the pixels the figure occupies. The frame records where that piece sits in the canvas, so
    // the atlas stores no transparent margins and no sample is resized.
    const pieces = records.map((f) => {
      const g = f.group;
      // Keep each clip at its own native sampling density. The logical canvas
      // is identical, so changing resolution does not change pose scale.
      const density = pixelated ? 1 : quality / (scale * f.sourceScale);
      const cw = Math.ceil(width * density),
        ch = Math.ceil(height * density);
      const canvas = Buffer.alloc(cw * ch * 4);
      const s = scale * f.sourceScale * density;
      if (aligned && !pixelated) {
        // Preserve authored RGBA samples exactly. Frame canvas dimensions encode
        // the clip's display scale; alignment only translates by whole pixels.
        const ox = Math.round(dx * density - f.anchorX);
        const oy = Math.round(dy * density - f.anchorY);
        const startX = Math.max(0, -ox),
          endX = Math.min(f.width, cw - ox);
        for (let sy = Math.max(0, -oy); sy < Math.min(f.height, ch - oy); sy++) {
          if (endX <= startX) continue;
          const source = (sy * f.width + startX) * 4;
          f.bitmap.copy(canvas, ((sy + oy) * cw + startX + ox) * 4, source, source + (endX - startX) * 4);
        }
      } else {
        for (let y = 0; y < ch; y++)
          for (let x = 0; x < cw; x++) {
            const sx = (x - dx * density) / s + f.anchorX,
              sy = (y - dy * density) / s + f.anchorY;
            if (sx < 0 || sy < 0 || sx >= f.width - 1 || sy >= f.height - 1) continue;
            const target = (y * cw + x) * 4;
            if (pixelated) {
              const offset = (Math.round(sy) * f.width + Math.round(sx)) * 4;
              f.bitmap.copy(canvas, target, offset, offset + 4);
            } else {
              const ix = Math.floor(sx),
                iy = Math.floor(sy),
                fx = sx - ix,
                fy = sy - iy;
              for (let c = 0; c < 4; c++) {
                const sample = (xx, yy) => f.bitmap[(yy * f.width + xx) * 4 + c];
                canvas[target + c] = Math.round(
                  sample(ix, iy) * (1 - fx) * (1 - fy) +
                    sample(ix + 1, iy) * fx * (1 - fy) +
                    sample(ix, iy + 1) * (1 - fx) * fy +
                    sample(ix + 1, iy + 1) * fx * fy,
                );
              }
            }
          }
      }
      // Tight box of anything visible, with one transparent pixel of padding for sampling.
      let bl = cw,
        bt = ch,
        br = -1,
        bb = -1;
      for (let y = 0; y < ch; y++)
        for (let x = 0; x < cw; x++)
          if (canvas[(y * cw + x) * 4 + 3]) {
            if (x < bl) bl = x;
            if (x > br) br = x;
            if (y < bt) bt = y;
            if (y > bb) bb = y;
          }
      if (br < 0) throw new Error('对齐后的动作帧没有可见内容，请重新生成此动作。');
      bl = Math.max(0, bl - 1);
      bt = Math.max(0, bt - 1);
      br = Math.min(cw - 1, br + 1);
      bb = Math.min(ch - 1, bb + 1);
      const pw = br - bl + 1,
        ph = bb - bt + 1;
      const piece = Buffer.alloc(pw * ph * 4);
      for (let y = 0; y < ph; y++) canvas.copy(piece, y * pw * 4, ((bt + y) * cw + bl) * 4, ((bt + y) * cw + bl + pw) * 4);
      return { width: pw, height: ph, bitmap: piece, cell: [cw, ch], offset: [bl, bt] };
    });
    // Which atlas page each frame goes on. A pack that fits comfortably stays one image. A large
    // one (sharp motion) is split: page 0 holds the idle frame and the short clips shown next to
    // it, and every later page holds whole activities, so a player only decodes what it plays.
    const total = pieces.reduce((n, piece) => n + piece.width * piece.height, 0);
    const pageOf = records.map(() => 0);
    // `pagePixels` lets tests exercise paging without building huge images.
    const pageLimit = options.pagePixels ?? PAGE_PIXELS;
    if (aligned && total > pageLimit) {
      const firstPage = new Set(['idle', ...OVER_IDLE, 'bounce', 'drag']);
      let page = 0,
        used = 0,
        at = 0;
      for (const g of groups) {
        const span = g.frames.length,
          area = pieces.slice(at, at + span).reduce((n, piece) => n + piece.width * piece.height, 0);
        let target = 0;
        if (!firstPage.has(g.name)) {
          if (page === 0 || (used > 0 && used + area > pageLimit)) {
            page++;
            used = 0;
          }
          target = page;
          used += area;
        }
        for (let i = at; i < at + span; i++) pageOf[i] = target;
        at += span;
      }
    }
    const pageCount = Math.max(...pageOf) + 1;
    const layouts = Array.from({ length: pageCount }, (_, page) => {
      const members = pieces.map((piece, i) => ({ piece, i })).filter(({ i }) => pageOf[i] === page);
      const layout = layoutFramesFlexible(
        members.map(({ piece }) => ({ width: piece.width, height: piece.height })),
        (aligned ? 32 : 16) * 1024 * 1024,
      );
      const bitmap = Buffer.alloc(layout.width * layout.height * 4);
      const rects = new Map();
      members.forEach(({ piece, i }, n) => {
        const rect = layout.rects[n];
        rects.set(i, rect);
        for (let y = 0; y < piece.height; y++)
          piece.bitmap.copy(bitmap, ((rect[1] + y) * layout.width + rect[0]) * 4, y * piece.width * 4, (y + 1) * piece.width * 4);
      });
      return { width: layout.width, height: layout.height, bitmap, rects };
    });
    const atlasWidth = layouts[0].width,
      atlasHeight = layouts[0].height;
    const frames = [],
      clips = {};
    let mouthFrames;
    let index = 0;
    for (const g of groups) {
      const indices = [];
      for (let frameIndex = 0; frameIndex < g.frames.length; frameIndex++) {
        const piece = pieces[index],
          page = pageOf[index];
        frames.push({
          rect: layouts[page].rects.get(index),
          duration: 140,
          cell: piece.cell,
          offset: piece.offset,
          ...(page ? { page } : {}),
        });
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
    const encoded = layouts.map((layout) => codec.encode(layout.bitmap, layout.width, layout.height));
    const pages = layouts.slice(1).map((layout, i) => ({
      src: `data:image/png;base64,${encoded[i + 1].toString('base64')}`,
      width: layout.width,
      height: layout.height,
    }));
    return {
      bytes: encoded[0],
      pageBytes: encoded.slice(1),
      sprite: validateAnimation(
        {
          width,
          height,
          frames,
          clips,
          pixelated,
          ...(mouthFrames ? { mouthFrames } : {}),
          ...(pages.length ? { pages } : {}),
        },
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
      built.pageBytes.forEach(assertAtlasBytes);
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
