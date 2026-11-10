'use strict';
// The desktop pet window: her figure may stand anywhere on screen, its transparent bands may hang
// past the edges, and the page is told which bands are on screen.
const test = require('node:test');
const assert = require('node:assert/strict');
const { petBounds, clampPetPosition, figureCentre, petRoom, bands } = require('../electron/pet-layout.cjs');
const shared = require('../shared/pet-window.json');
const area = { x: 0, y: 25, width: 1440, height: 850 };

test('the bands come from the shared file the page lays itself out with', () => {
  assert.deepEqual(bands, shared);
  const bounds = petBounds('medium', 0.75, area, undefined, 0.8);
  assert.equal(bounds.height, 240 + shared.top + shared.bottom);
  assert.ok(bounds.width >= shared.minWidth);
});

test('a first window has her standing at the bottom right; resizing keeps her feet and centre', () => {
  const first = petBounds('medium', 0.75, area, undefined, 1);
  assert.equal(
    first.y + first.height,
    area.y + area.height,
    'as low as she goes, her toolbar still on screen',
  );
  assert.ok(first.x + first.width / 2 > area.x + area.width * 0.8);
  const bigger = petBounds('medium', 0.75, area, { ...first, x: 400, y: 300 }, 1.6);
  assert.equal(bigger.y + bigger.height, 300 + first.height, 'feet stay put');
  assert.equal(bigger.x + bigger.width / 2, 400 + first.width / 2, 'centre line stays put');
});

test('her figure can reach every edge of the work area; only the band above her hangs past it', () => {
  const bounds = petBounds('medium', 0.75, area, undefined, 1);
  const figure = bounds.height - shared.top - shared.bottom;
  const top = clampPetPosition(500, -5000, bounds, area, 0.75);
  assert.equal(top.y + shared.top, area.y, 'her head can touch the menu bar');
  const bottom = clampPetPosition(500, 5000, bounds, area, 0.75);
  assert.equal(bottom.y + bounds.height, area.y + area.height, 'the band with her toolbar stays on screen');
  const left = clampPetPosition(-5000, 300, bounds, area, 0.75);
  // Whole points: within one of the edge.
  assert.ok(
    Math.abs(left.x + bounds.width / 2 - (figure * 0.75) / 2 - area.x) <= 1,
    'her side can touch the left edge',
  );
  const right = clampPetPosition(5000, 300, bounds, area, 0.75);
  assert.ok(Math.abs(right.x + bounds.width / 2 + (figure * 0.75) / 2 - (area.x + area.width)) <= 1);
  // Anywhere in between she stays exactly where she is put.
  assert.deepEqual(clampPetPosition(400, 200, bounds, area, 0.75), { x: 400, y: 200 });
  assert.deepEqual(figureCentre({ ...bounds, x: 400, y: 200 }), {
    x: 400 + bounds.width / 2,
    y: 200 + shared.top + figure / 2,
  });
});

test('the page learns which bands are on screen, to move her speech and the controls', () => {
  const bounds = petBounds('medium', 0.75, area, undefined, 1);
  const middle = { ...bounds, ...clampPetPosition(500, 300, bounds, area, 0.75) };
  assert.deepEqual(petRoom(middle, area), { above: shared.top, below: shared.bottom, left: 0, right: 0 });
  const high = { ...bounds, ...clampPetPosition(500, -5000, bounds, area, 0.75) };
  assert.deepEqual(petRoom(high, area), { above: 0, below: shared.bottom, left: 0, right: 0 });
  const low = { ...bounds, ...clampPetPosition(500, 5000, bounds, area, 0.75) };
  assert.deepEqual(
    petRoom(low, area),
    { above: shared.top, below: shared.bottom, left: 0, right: 0 },
    'the toolbar never moves',
  );
  // At a side of the screen part of the window hangs past the edge (her figure stays on it): the
  // page keeps her speech and the controls to the part on screen.
  const right = { ...bounds, ...clampPetPosition(5000, 300, bounds, area, 0.75) };
  const past = right.x + bounds.width - (area.x + area.width);
  assert.ok(past > 20, 'the window does hang past the right edge');
  assert.deepEqual(petRoom(right, area), { above: shared.top, below: shared.bottom, left: 0, right: past });
  const left = { ...bounds, ...clampPetPosition(-5000, 300, bounds, area, 0.75) };
  assert.equal(petRoom(left, area).left, area.x - left.x);
  assert.equal(petRoom(left, area).right, 0);
  // Running in from off screen, she may start just past a side.
  const outside = clampPetPosition(-5000, 300, bounds, area, 0.75, bounds.width);
  assert.ok(outside.x + bounds.width / 2 < area.x, 'her middle is off the left edge');
});
