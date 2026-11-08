'use strict';
const f = require('./pet-images.cjs');
// One part image: a simple figure (head, body, legs, an arm that moves per pose) in each cell,
// drawn at `scale` and shifted by `drift` columns, the way a model draws off its own grid.
function partImage({
  columns = 2,
  rows = 2,
  cell = [128, 192],
  scale = 1,
  drift = 0,
  lift = 0,
  sit = false,
  arm = 0,
}) {
  const width = cell[0] * columns,
    height = cell[1] * rows,
    bitmap = Buffer.alloc(width * height * 4);
  const rect = (x, y, w, h, color) => {
    for (let yy = Math.round(y); yy < Math.round(y + h); yy++)
      for (let xx = Math.round(x); xx < Math.round(x + w); xx++) {
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
        const i = (yy * width + xx) * 4;
        bitmap[i] = color[0];
        bitmap[i + 1] = color[1];
        bitmap[i + 2] = color[2];
        bitmap[i + 3] = 255;
      }
  };
  for (let n = 0; n < columns * rows; n++) {
    const col = n % columns,
      row = Math.floor(n / columns);
    const cx = (col + 0.5) * cell[0] - col * drift,
      floor = (row + 1) * cell[1] - 18 - row * lift,
      s = scale;
    const body = sit ? 0.6 : 1;
    rect(cx - 14 * s, floor - 112 * s * body - 30 * s, 28 * s, 28 * s, [210, 115, 160]); // head
    rect(cx - 10 * s, floor - 112 * s * body, 20 * s, 60 * s * body, [180, 120, 220]); // body
    rect(cx - 10 * s, floor - 52 * s * body, 8 * s, 52 * s * body, [75, 50, 120]); // legs
    rect(cx + 2 * s, floor - 52 * s * body, 8 * s, 52 * s * body, [75, 50, 120]);
    rect(cx + 10 * s, floor - 100 * s * body + ((n + arm) % 4) * 6 * s, 14 * s, 6 * s, [215, 150, 185]); // arm
  }
  return f.url(f.encode(bitmap, width, height));
}
module.exports = { partImage };
