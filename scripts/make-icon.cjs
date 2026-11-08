'use strict';
// Draws the app icon (public/favicon.svg): Demiurge as a tensor, a cube built from 4×4×4 smaller
// cubes, light glowing through the seams from inside, a few cubelets at the near corner lifting
// out as if it were computing. Original artwork. Deterministic: run
// `node scripts/make-icon.cjs public/favicon.svg` after changing it.
const fs = require('fs');

const N = 4; // cubelets per edge
const GAP = 0.16; // seam between cubelets, in cubelet edges
const S = 62; // screen points per world unit
const C = { x: 512, y: 520 }; // where the cube's centre lands
const cos30 = Math.cos(Math.PI / 6),
  sin30 = 0.5;
const half = (N + (N - 1) * GAP) / 2;
// World: x toward the lower right, y toward the lower left, z up; centred on the cube.
const project = ([x, y, z]) => [C.x + (x - y) * cos30 * S, C.y + (x + y) * sin30 * S - z * S];
const f = (n) => n.toFixed(1);
const points = (corners) => corners.map((p) => project(p).map(f).join(',')).join(' ');

// Cubelets lifting out of the faces they sit in, as if the tensor were computing.
const lifted = new Map([
  ['1,2,3', [0, 0, 0.8]],
  ['0,0,3', [0, 0, 0.38]],
  ['3,0,1', [0.62, 0, 0]],
  ['1,3,0', [0, 0.58, 0]],
]);
// A few faces lit from within, like data passing through.
const glowing = new Set(['top:2,1,3', 'top:0,3,3', 'right:3,2,2', 'right:3,1,0', 'left:2,3,2', 'left:0,3,1']);

const shade = {
  top: ['#f6f1ff', '#e3d9fb'],
  left: ['#dcd0f7', '#c2b0ef'],
  right: ['#b6a2e8', '#927bd9'],
};
const cubes = [];
for (let i = 0; i < N; i++)
  for (let j = 0; j < N; j++)
    for (let k = 0; k < N; k++) {
      // Only the shell facing the viewer shows.
      if (i < N - 1 && j < N - 1 && k < N - 1) continue;
      const key = `${i},${j},${k}`;
      const d = lifted.get(key) || [0, 0, 0];
      const o = [i * (1 + GAP) - half + d[0], j * (1 + GAP) - half + d[1], k * (1 + GAP) - half + d[2]];
      cubes.push({ key, o, depth: o[0] + o[1] + o[2], out: lifted.has(key) });
    }
cubes.sort((a, b) => a.depth - b.depth);

function cubelet({ key, o, out }) {
  const [x, y, z] = o;
  const faces = {
    top: [
      [x, y, z + 1],
      [x + 1, y, z + 1],
      [x + 1, y + 1, z + 1],
      [x, y + 1, z + 1],
    ],
    right: [
      [x + 1, y, z],
      [x + 1, y + 1, z],
      [x + 1, y + 1, z + 1],
      [x + 1, y, z + 1],
    ],
    left: [
      [x, y + 1, z],
      [x + 1, y + 1, z],
      [x + 1, y + 1, z + 1],
      [x, y + 1, z + 1],
    ],
  };
  return Object.entries(faces)
    .map(([side, corners]) => {
      const fill = glowing.has(`${side}:${key}`) ? `url(#lit-${side})` : `url(#${side})`;
      return `<polygon points="${points(corners)}" fill="${fill}" stroke="#ffffff" stroke-opacity="${out ? 0.85 : 0.45}" stroke-width="${out ? 2.4 : 1.5}" stroke-linejoin="round"/>`;
    })
    .join('');
}

// The cube's silhouette, filled with the light inside it: it shows through every seam.
const e = half + 0.02;
const hull = [
  [-e, -e, e],
  [e, -e, e],
  [e, -e, -e],
  [e, e, -e],
  [-e, e, -e],
  [-e, e, e],
];
const gradient = (id, [a, b]) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><defs><linearGradient id="sky" x1="0.15" y1="0" x2="0.85" y2="1"><stop offset="0" stop-color="#1b1734"/><stop offset="0.55" stop-color="#2f2457"/><stop offset="1" stop-color="#5a3a78"/></linearGradient><radialGradient id="halo" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffc9ec" stop-opacity="0.55"/><stop offset="0.45" stop-color="#b48cff" stop-opacity="0.22"/><stop offset="1" stop-color="#7c5cff" stop-opacity="0"/></radialGradient><radialGradient id="core" gradientUnits="userSpaceOnUse" cx="${C.x}" cy="${C.y - 20}" r="300"><stop offset="0" stop-color="#ffffff"/><stop offset="0.35" stop-color="#ffd6f0"/><stop offset="1" stop-color="#ff6fbd"/></radialGradient>${gradient('top', shade.top)}${gradient('left', shade.left)}${gradient('right', shade.right)}${gradient('lit-top', ['#ffffff', '#ffc4e8'])}${gradient('lit-left', ['#ffd9f1', '#ef9fd6'])}${gradient('lit-right', ['#f2b4e2', '#cf7cc6'])}<clipPath id="tile"><rect x="100" y="100" width="824" height="824" rx="186"/></clipPath></defs><rect x="100" y="100" width="824" height="824" rx="186" fill="url(#sky)"/><g clip-path="url(#tile)"><circle cx="${C.x}" cy="${C.y}" r="420" fill="url(#halo)"/><circle cx="246" cy="248" r="5" fill="#ffffff" fill-opacity="0.7"/><circle cx="802" cy="300" r="4" fill="#ffffff" fill-opacity="0.55"/><circle cx="760" cy="812" r="3" fill="#ffffff" fill-opacity="0.45"/><circle cx="214" cy="760" r="3.5" fill="#ffffff" fill-opacity="0.5"/><polygon points="${points(hull)}" fill="url(#core)"/>${cubes.map(cubelet).join('')}</g><rect x="101.5" y="101.5" width="821" height="821" rx="185" fill="none" stroke="#ffffff" stroke-opacity="0.08" stroke-width="3"/></svg>`;
fs.writeFileSync(process.argv[2] || 'public/favicon.svg', svg);
console.log(`${svg.length} bytes, ${cubes.length} cubelets`);
