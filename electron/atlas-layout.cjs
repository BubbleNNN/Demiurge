'use strict';
// Physical frames may have different source resolutions while sharing one
// logical canvas. Shelf packing retains those pixels without forcing a resize.
function layoutFrames(sizes, columns = 4, pixelBudget = 16 * 1024 * 1024) {
  const rects = [];
  let atlasWidth = 0,
    y = 0;
  for (let start = 0; start < sizes.length; start += columns) {
    const row = sizes.slice(start, start + columns);
    let x = 0;
    for (const { width, height } of row) {
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)
        throw new Error('动作帧的物理尺寸无效。');
      rects.push([x, y, width, height]);
      x += width;
    }
    atlasWidth = Math.max(atlasWidth, x);
    y += Math.max(...row.map((f) => f.height));
  }
  if (atlasWidth > 8192 || y > 8192 || atlasWidth * y > pixelBudget)
    throw new Error('保留原始清晰度的图集超过尺寸或内存限制，请减少每个角色包的动作数量；不会自动降清晰度。');
  return { width: atlasWidth, height: y, rects };
}
function assertAtlasBytes(bytes) {
  if (bytes.length > 32 * 1024 * 1024)
    throw new Error('保留原始清晰度的动画图集超过 32 MiB，请减少动作或分成多个角色包；不会自动降清晰度。');
}
function layoutFramesFlexible(sizes, pixelBudget = 16 * 1024 * 1024) {
  try {
    return layoutFrames(sizes, 4, pixelBudget);
  } catch (originalError) {
    // A tall sheet can exceed a dimension limit while the source pixels still
    // fit the area budget. Reflow whole cells; never resize or reorder frames.
    let best;
    for (let columns = 1; columns <= sizes.length; columns++) {
      if (columns === 4) continue;
      try {
        const candidate = layoutFrames(sizes, columns, pixelBudget);
        if (!best || candidate.width * candidate.height < best.width * best.height) best = candidate;
      } catch {
        // This column count cannot contain these cells within the same limits.
      }
    }
    if (!best) throw originalError;
    return best;
  }
}
module.exports = { layoutFrames, layoutFramesFlexible, assertAtlasBytes };
