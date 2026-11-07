'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { acquireWorkspaceInstance } = require('../electron/instance.cjs');

test('only the primary instance may continue initialization; another launch activates it', () => {
  let focused = 0,
    quits = 0;
  const primary = Object.assign(new EventEmitter(), {
    requestSingleInstanceLock: () => true,
    quit: () => assert.fail('Primary instance must stay open'),
  });
  const secondary = Object.assign(new EventEmitter(), {
    requestSingleInstanceLock: () => false,
    quit: () => quits++,
  });
  assert.equal(
    acquireWorkspaceInstance(primary, () => focused++),
    true,
  );
  assert.equal(
    acquireWorkspaceInstance(secondary, () => assert.fail('Secondary may not open a window')),
    false,
  );
  assert.equal(quits, 1);
  primary.emit('second-instance');
  assert.equal(focused, 1);
  assert.equal(secondary.listenerCount('second-instance'), 0);
});
