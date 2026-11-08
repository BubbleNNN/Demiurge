'use strict';
const f = require('./pet-images.cjs');
function stageSheet({ sleep = false, frozenLoop = false, size = 384 } = {}) {
  const width = size,
    height = size,
    cw = size / 4,
    ch = size / 3;
  const bitmap = Buffer.alloc(width * height * 4);
  const rect = (n, x, y, w, h, color) => {
    const ox = Math.floor((n % 4) * cw),
      oy = Math.floor(Math.floor(n / 4) * ch);
    for (let yy = Math.floor(y); yy < Math.floor(y + h); yy++)
      for (let xx = Math.floor(x); xx < Math.floor(x + w); xx++) {
        const i = ((oy + yy) * width + ox + xx) * 4;
        bitmap[i] = color[0];
        bitmap[i + 1] = color[1];
        bitmap[i + 2] = color[2];
        bitmap[i + 3] = 255;
      }
  };
  for (let n = 0; n < 12; n++) {
    const phase = frozenLoop && n >= 4 && n < 8 ? 0 : n % 4;
    if (sleep && n >= 3 && n <= 8) {
      rect(n, cw * 0.2, ch * 0.68, cw * 0.6, ch * 0.17, [210, 115, 160]);
      rect(n, cw * (0.22 + phase * 0.08), ch * 0.64, cw * 0.12, ch * 0.05, [100, 80, 150]);
    } else {
      rect(n, cw * 0.3, ch * 0.16, cw * 0.4, ch * 0.25, [210, 115, 160]);
      rect(n, cw * 0.38, ch * 0.41, cw * 0.24, ch * 0.3, [180, 120, 220]);
      rect(n, cw * 0.38, ch * 0.71, cw * 0.08, ch * 0.14, [75, 50, 120]);
      rect(n, cw * 0.54, ch * 0.71, cw * 0.08, ch * 0.14, [75, 50, 120]);
      rect(
        n,
        cw * (0.22 + phase * 0.025),
        ch * (0.46 - phase * 0.035),
        cw * 0.12,
        ch * 0.16,
        [215, 150, 185],
      );
    }
  }
  return f.encode(bitmap, width, height);
}
module.exports = { stageSheet };
