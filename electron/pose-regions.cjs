'use strict';
// A generated grid is a layout suggestion, not guaranteed pixel coordinates.
// Locate whole, separated alpha silhouettes before cropping. This is a
// boundary check, NOT an anatomy detector or a repair for missing body parts.
function poseRegions(bitmap, width, height, columns, rows) {
  const count = columns * rows,
    total = width * height;
  const visited = new Uint8Array(total),
    queue = new Int32Array(total),
    components = [];
  for (let seed = 0; seed < total; seed++) {
    if (visited[seed] || bitmap[seed * 4 + 3] < 96) continue;
    let read = 0,
      write = 1,
      left = width,
      top = height,
      right = 0,
      bottom = 0;
    queue[0] = seed;
    visited[seed] = 1;
    while (read < write) {
      const at = queue[read++],
        x = at % width,
        y = Math.floor(at / width);
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx,
            yy = y + dy;
          if (xx < 0 || xx >= width || yy < 0 || yy >= height) continue;
          const next = yy * width + xx;
          if (!visited[next] && bitmap[next * 4 + 3] >= 96) {
            visited[next] = 1;
            queue[write++] = next;
          }
        }
    }
    if (write >= 4) components.push({ left, top, right, bottom, area: write });
  }
  components.sort((a, b) => b.area - a.area);
  const main = components.slice(0, count);
  if (
    main.length !== count ||
    main.at(-1).area < (total / count) * 0.03 ||
    components[count]?.area > main.at(-1).area * 0.08
  )
    throw new Error(
      '无法可靠分开完整人物帧：人物可能相连、透明背景无效或身体被拆散。请提供独立姿势 PNG 或重新生成。',
    );
  const regions = Array.from({ length: count }, () => undefined);
  for (const item of main) {
    const column = Math.min(columns - 1, Math.floor(((item.left + item.right + 1) / 2 / width) * columns)),
      row = Math.min(rows - 1, Math.floor(((item.top + item.bottom + 1) / 2 / height) * rows)),
      index = row * columns + column;
    if (regions[index]) throw new Error('人物排列与动作网格不匹配，请重新生成或提供独立姿势 PNG。');
    if (item.left === 0 || item.top === 0 || item.right === width - 1 || item.bottom === height - 1)
      throw new Error('人物接触整张图的外边缘，可能已裁切，请重新生成并保留透明留白。');
    // One pixel retains the antialiased outline. Reject layouts without that
    // gutter rather than silently cropping another character into this frame.
    const expanded = {
      left: item.left - 1,
      top: item.top - 1,
      right: item.right + 1,
      bottom: item.bottom + 1,
    };
    if (
      main.some(
        (other) =>
          other !== item &&
          expanded.left <= other.right &&
          expanded.right >= other.left &&
          expanded.top <= other.bottom &&
          expanded.bottom >= other.top,
      )
    )
      throw new Error('人物之间没有足够的透明间隔，无法完整切帧，请重新生成。');
    regions[index] = {
      x: expanded.left,
      y: expanded.top,
      width: expanded.right - expanded.left + 1,
      height: expanded.bottom - expanded.top + 1,
    };
  }
  if (regions.some((region) => !region)) throw new Error('动作网格缺少人物帧。');
  return regions;
}
module.exports = { poseRegions };
