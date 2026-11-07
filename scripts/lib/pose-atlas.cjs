'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { validateAnimation } = require('../../electron/sprites.cjs');
const { layoutFrames, assertAtlasBytes } = require('../../electron/atlas-layout.cjs');
const { poseRegions } = require('../../electron/pose-regions.cjs');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function geometry(image) {
  const { width, height } = image.getSize(),
    bitmap = image.toBitmap();
  let left = width,
    right = -1,
    top = height,
    bottom = -1,
    pixels = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (bitmap[(y * width + x) * 4 + 3] < 96) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      pixels++;
    }
  if (pixels < width * height * 0.03 || pixels > width * height * 0.9)
    throw new Error('Empty pose or nontransparent background');
  let sum = 0,
    weight = 0;
  for (let y = Math.max(top, bottom - Math.floor((bottom - top) * 0.07)); y <= bottom; y++)
    for (let x = left; x <= right; x++) {
      const alpha = bitmap[(y * width + x) * 4 + 3];
      if (alpha >= 128) {
        sum += x * alpha;
        weight += alpha;
      }
    }
  return {
    left,
    right,
    top,
    bottom,
    anchor: { x: weight ? sum / weight : (left + right) / 2, y: bottom },
    bitmap,
    width,
    height,
  };
}

function readPoses(definition, root, nativeImage) {
  const sources = new Map(),
    groups = new Map(),
    regions = new Map();
  return definition.poses.map((pose) => {
    if (!sources.has(pose.source)) {
      const file = path.resolve(root, pose.source);
      if (!file.startsWith(root + path.sep)) throw new Error('Pose source must be inside the project');
      const bytes = fs.readFileSync(file),
        image = nativeImage.createFromBuffer(bytes);
      if (image.isEmpty()) throw new Error('Invalid pose PNG');
      sources.set(pose.source, { image, sha256: hash(bytes) });
    }
    const source = sources.get(pose.source),
      size = source.image.getSize();
    if (
      !Number.isInteger(pose.columns) ||
      !Number.isInteger(pose.rows) ||
      pose.columns < 1 ||
      pose.rows < 1 ||
      !Number.isInteger(pose.cell) ||
      pose.cell < 0 ||
      pose.cell >= pose.columns * pose.rows
    )
      throw new Error('Invalid pose grid');
    const x = Math.round(((pose.cell % pose.columns) * size.width) / pose.columns),
      y = Math.round((Math.floor(pose.cell / pose.columns) * size.height) / pose.rows),
      width = Math.round((((pose.cell % pose.columns) + 1) * size.width) / pose.columns) - x,
      height = Math.round(((Math.floor(pose.cell / pose.columns) + 1) * size.height) / pose.rows) - y;
    let crop = { x, y, width, height };
    if (pose.crop === 'alpha') {
      const key = `${pose.source}:${pose.columns}:${pose.rows}`;
      if (!regions.has(key))
        regions.set(
          key,
          poseRegions(source.image.toBitmap(), size.width, size.height, pose.columns, pose.rows),
        );
      crop = regions.get(key)[pose.cell];
    }
    const image = source.image.crop(crop),
      bounds = geometry(image);
    const group = pose.group || pose.source;
    if (!groups.has(group)) groups.set(group, bounds.bottom - bounds.top + 1);
    return {
      ...bounds,
      image,
      groupHeight: groups.get(group),
      sha256: hash(Buffer.concat([Buffer.from(`${bounds.width}x${bounds.height}:`), bounds.bitmap])),
      source: pose.source,
      sourceSha256: source.sha256,
      cell: pose.cell,
    };
  });
}

function compileAtlas(definition, poses, nativeImage) {
  const { width, height, pixelated = false, palette, clips, mouthFrames } = definition.animation;
  const base = poses[0].groupHeight;
  const cells = poses.map((p) => ({ ...p, relativeScale: base / p.groupHeight }));
  const extents = cells.reduce(
    (b, c) => ({
      left: Math.min(b.left, (c.left - c.anchor.x) * c.relativeScale),
      right: Math.max(b.right, (c.right - c.anchor.x + 1) * c.relativeScale),
      top: Math.min(b.top, (c.top - c.anchor.y) * c.relativeScale),
    }),
    { left: 0, right: 0, top: 0 },
  );
  const margin = 0.04 * Math.min(width, height);
  const virtualScale = Math.min(
    (width - 2 * margin) / (extents.right - extents.left),
    (height - 2 * margin) / -extents.top,
  );
  const sizes = cells.map((c) => {
    // Texture density comes from source pixels, not a fixed logical canvas.
    const density = 1 / (virtualScale * c.relativeScale);
    return { width: Math.ceil(width * density), height: Math.ceil(height * density) };
  });
  const layout = layoutFrames(sizes),
    bitmap = Buffer.alloc(layout.width * layout.height * 4),
    frames = [];
  cells.forEach((cell, index) => {
    const rect = layout.rects[index],
      density = Math.min(rect[2] / width, rect[3] / height),
      scale = virtualScale * cell.relativeScale * density;
    const rendered =
      Math.abs(scale - 1) < 0.002
        ? cell.image
        : cell.image.resize({
            width: Math.max(1, Math.round(cell.width * scale)),
            height: Math.max(1, Math.round(cell.height * scale)),
            quality: 'best',
          });
    const dimensions = rendered.getSize(),
      input = rendered.toBitmap();
    const dx = Math.round(rect[2] / 2 - cell.anchor.x * scale),
      dy = Math.round(rect[3] - margin * density - cell.anchor.y * scale);
    for (let y = 0; y < dimensions.height; y++)
      for (let x = 0; x < dimensions.width; x++) {
        const tx = dx + x,
          ty = dy + y;
        if (tx < 0 || ty < 0 || tx >= rect[2] || ty >= rect[3]) continue;
        const from = (y * dimensions.width + x) * 4,
          to = ((rect[1] + ty) * layout.width + rect[0] + tx) * 4;
        input.copy(bitmap, to, from, from + 4);
      }
    frames.push({ rect, duration: 140 });
  });
  const bytes = nativeImage
    .createFromBitmap(bitmap, { width: layout.width, height: layout.height, scaleFactor: 1 })
    .toPNG();
  assertAtlasBytes(bytes);
  const animation = validateAnimation(
    {
      width,
      height,
      frames,
      clips,
      pixelated,
      ...(palette ? { palette } : {}),
      ...(mouthFrames ? { mouthFrames } : {}),
    },
    layout,
  );
  return {
    bytes,
    animation,
    sha256: hash(bytes),
    poses: cells.map(({ source, sourceSha256, cell, sha256, width, height, top, bottom }) => ({
      source,
      sourceSha256,
      cell,
      sha256,
      width,
      height,
      subjectHeight: bottom - top + 1,
    })),
  };
}
module.exports = { readPoses, compileAtlas };
