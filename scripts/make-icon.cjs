'use strict';
// Draws the app icon (public/favicon.svg): lavender cubes tumbling in a ring around a burst of
// white light. Deterministic; run `node scripts/make-icon.cjs public/favicon.svg` after changing it.
const fs = require('fs');
let seed = 11;
const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
const C = { x: 506, y: 512 };
const tilt = (-28 * Math.PI) / 180;
const place = (a, r) => {
  const ex = Math.cos(a) * r * 1.08,
    ey = Math.sin(a) * r * 0.9;
  return {
    x: C.x + ex * Math.cos(tilt) - ey * Math.sin(tilt),
    y: C.y + ex * Math.sin(tilt) + ey * Math.cos(tilt),
  };
};
const cubes = [];
for (const [count, radius, base, spread] of [
  [30, 205, 40, 26],
  [34, 285, 52, 34],
]) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rnd() * 0.14;
    // Upper right (around -45 degrees): the ring breaks open and cubes fly outward.
    const gap = Math.max(0, Math.cos(a + Math.PI / 4));
    const r = radius + (rnd() - 0.5) * 50 + gap * gap * 150;
    const near = 0.5 + 0.5 * Math.cos(a - 2.4);
    const s = (base + near * spread + rnd() * 10) * (1 - gap * 0.45);
    cubes.push({ ...place(a, r), s, rot: (rnd() - 0.5) * (50 + gap * 80), near });
  }
}
for (let i = 0; i < 7; i++) {
  const a = -Math.PI / 4 + (rnd() - 0.5) * 1.3;
  cubes.push({ ...place(a, 420 + rnd() * 70), s: 16 + rnd() * 20, rot: (rnd() - 0.5) * 120, near: 0.1 });
}
cubes.sort((p, q) => p.s - q.s);
const f = (n) => n.toFixed(1);
const mix = (a, b, t) =>
  '#' +
  [0, 2, 4]
    .map((i) =>
      Math.round(parseInt(a.slice(1 + i, 3 + i), 16) * (1 - t) + parseInt(b.slice(1 + i, 3 + i), 16) * t)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');
function cube({ x, y, s, rot, near }) {
  const h = s * 0.866;
  const poly = (pts, fill) =>
    `<polygon points="${pts.map((p) => p.map(f).join(',')).join(' ')}" fill="${fill}"/>`;
  const lit = Math.max(0, 1 - Math.hypot(x - C.x, y - C.y) / 380);
  return `<g transform="rotate(${f(rot)} ${f(x)} ${f(y)})" stroke="#3f3488" stroke-opacity="${f(0.3 + near * 0.3)}" stroke-width="${f(Math.max(1.6, s / 24))}" stroke-linejoin="round">${poly(
    [
      [x, y - s],
      [x + h, y - s / 2],
      [x, y],
      [x - h, y - s / 2],
    ],
    mix('#cbc2f8', '#ffffff', lit * 0.75),
  )}${poly(
    [
      [x - h, y - s / 2],
      [x, y],
      [x, y + s],
      [x - h, y + s / 2],
    ],
    mix('#9f91ec', '#e2dcff', lit * 0.65),
  )}${poly(
    [
      [x, y],
      [x + h, y - s / 2],
      [x + h, y + s / 2],
      [x, y + s],
    ],
    mix('#7563d6', '#c3b8f7', lit * 0.55),
  )}</g>`;
}
// Soft beams of light out of the middle.
const rays = [-80, -35, 10, 55, 100, 150, 200, 250, 300]
  .map((deg, i) => {
    const a = (deg * Math.PI) / 180,
      w = 0.07 + (i % 3) * 0.025,
      L = 520;
    const p = (t) => `${f(C.x + Math.cos(t) * L)},${f(C.y + Math.sin(t) * L)}`;
    return `<polygon points="${C.x},${C.y} ${p(a - w)} ${p(a + w)}" fill="url(#ray)"/>`;
  })
  .join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><defs><radialGradient id="bg" cx="0.5" cy="0.5" r="0.72"><stop offset="0" stop-color="#ffffff"/><stop offset="0.45" stop-color="#eee9fe"/><stop offset="1" stop-color="#b6a6ef"/></radialGradient><radialGradient id="ray" gradientUnits="userSpaceOnUse" cx="${C.x}" cy="${C.y}" r="520"><stop offset="0" stop-color="#ffffff" stop-opacity="0.85"/><stop offset="0.6" stop-color="#ffffff" stop-opacity="0.18"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient><radialGradient id="light" gradientUnits="userSpaceOnUse" cx="${C.x}" cy="${C.y}" r="360"><stop offset="0" stop-color="#ffffff" stop-opacity="1"/><stop offset="0.3" stop-color="#ffffff" stop-opacity="0.92"/><stop offset="0.55" stop-color="#f7f3ff" stop-opacity="0.4"/><stop offset="1" stop-color="#f1ecff" stop-opacity="0"/></radialGradient><clipPath id="tile"><rect x="100" y="100" width="824" height="824" rx="186"/></clipPath></defs><rect x="100" y="100" width="824" height="824" rx="186" fill="url(#bg)"/><g clip-path="url(#tile)">${rays}${cubes.map(cube).join('')}<circle cx="${C.x}" cy="${C.y}" r="360" fill="url(#light)"/></g><rect x="101.5" y="101.5" width="821" height="821" rx="185" fill="none" stroke="#a593e6" stroke-opacity="0.55" stroke-width="3"/></svg>`;
fs.writeFileSync(process.argv[2], svg);
console.log(svg.length, 'bytes,', cubes.length, 'cubes');
