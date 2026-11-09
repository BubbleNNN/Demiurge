'use strict';
// Moving between Spaces, she follows from the side the user came from: switching to the Space on
// the right, she runs in from the left, and the other way round.
const test = require('node:test');
const assert = require('node:assert/strict');
const { noteSpaces, onSpaceChange } = require('../electron/desktop-surfaces.cjs');

test('switching Spaces, she enters from the side the user came from', () => {
  const seen = [];
  onSpaceChange((change) => seen.push(change));
  // The first reading only records where each display is.
  noteSpaces([
    { display: 1, index: 0, space: 10 },
    { display: 2, index: 0, space: 20 },
  ]);
  assert.deepEqual(seen, []);
  // To the Space on the right: she comes in from the left.
  noteSpaces([{ display: 1, index: 1, space: 11 }]);
  assert.deepEqual(seen.pop(), { display: 1, from: 'left' });
  // Further right (a full-screen app sits to the right of its desktop): from the left again.
  noteSpaces([{ display: 1, index: 2, space: 12 }]);
  assert.deepEqual(seen.pop(), { display: 1, from: 'left' });
  // Back to the left: she comes in from the right.
  noteSpaces([{ display: 1, index: 0, space: 10 }]);
  assert.deepEqual(seen.pop(), { display: 1, from: 'right' });
  // Nothing changed, nothing happens; another display is tracked on its own.
  noteSpaces([{ display: 1, index: 0, space: 10 }]);
  assert.equal(seen.length, 0);
  noteSpaces([{ display: 2, index: 1, space: 21 }]);
  assert.deepEqual(seen.pop(), { display: 2, from: 'left' });
});
