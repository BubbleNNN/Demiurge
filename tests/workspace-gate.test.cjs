'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkspaceGate } = require('../electron/workspace-gate.cjs');

const maintenanceNames = [
  'export-workspace',
  'import-workspace',
  'restore-previous-state',
  'reset-credentials',
];
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

for (const name of ['import-model', 'list-pet-jobs', 'save']) {
  test(`maintenance rejects while an earlier ${name} callback can still write`, async () => {
    const gate = createWorkspaceGate();
    const paused = deferred();
    const writes = [];
    const operation = gate.run(name, async () => {
      await paused.promise;
      writes.push('previous workspace');
    });
    for (const maintenance of maintenanceNames)
      await assert.rejects(
        gate.run(maintenance, () => writes.push('replaced workspace')),
        /当前操作完成/,
      );
    assert.deepEqual(writes, []);
    paused.resolve();
    await operation;
    await gate.run('import-workspace', () => writes.push('replaced workspace'));
    assert.deepEqual(writes, ['previous workspace', 'replaced workspace']);
  });
}

test('ordinary requests remain concurrent and duplicate names are tracked separately', async () => {
  const gate = createWorkspaceGate();
  const first = deferred();
  const second = deferred();
  const started = [];
  const a = gate.run('save', async () => {
    started.push('a');
    await first.promise;
  });
  const b = gate.run('save', async () => {
    started.push('b');
    await second.promise;
  });
  assert.deepEqual(started, ['a', 'b']);
  first.resolve();
  await a;
  await assert.rejects(
    gate.run('export-workspace', () => {}),
    /当前操作完成/,
  );
  second.resolve();
  await b;
  assert.equal(await gate.run('export-workspace', () => 'archive'), 'archive');
});

test('maintenance synchronously excludes all new operations until its callback settles', async () => {
  for (const name of maintenanceNames) {
    const gate = createWorkspaceGate();
    const paused = deferred();
    const operation = gate.run(name, () => paused.promise);
    let invoked = false;
    for (const blocked of ['save', 'import-model', 'load', ...maintenanceNames])
      await assert.rejects(
        gate.run(blocked, () => {
          invoked = true;
        }),
        /正在备份或恢复/,
      );
    assert.equal(invoked, false);
    assert.equal(await gate.run('open-data-directory', () => 'opened'), 'opened');
    paused.resolve(false);
    assert.equal(await operation, false);
    assert.equal(await gate.run('save', () => 'saved'), 'saved');
  }
});

test('opening the data directory neither blocks maintenance nor releases its exclusion', async () => {
  const gate = createWorkspaceGate();
  const directory = deferred();
  const importing = deferred();
  const open = gate.run('open-data-directory', () => directory.promise);
  const restore = gate.run('import-workspace', () => importing.promise);
  directory.resolve();
  await open;
  await assert.rejects(
    gate.run('save', () => {}),
    /正在备份或恢复/,
  );
  importing.resolve();
  await restore;
  await gate.run('save', () => {});
});

test('ordinary synchronous errors and asynchronous failures release their active entries', async () => {
  const gate = createWorkspaceGate();
  await assert.rejects(
    gate.run('import-model', () => {
      throw new Error('invalid model');
    }),
    /invalid model/,
  );
  await gate.run('export-workspace', () => {});
  await assert.rejects(
    gate.run('list-pet-jobs', async () => {
      await Promise.resolve();
      throw new Error('read failed');
    }),
    /read failed/,
  );
  await gate.run('export-workspace', () => {});
});

test('maintenance cancellation and failures release the gate', async () => {
  const gate = createWorkspaceGate();
  assert.equal(await gate.run('import-workspace', () => false), false);
  await gate.run('save', () => {});
  await assert.rejects(
    gate.run('restore-previous-state', () => {
      throw new Error('no snapshot');
    }),
    /no snapshot/,
  );
  await gate.run('save', () => {});
  await assert.rejects(
    gate.run('export-workspace', async () => {
      await Promise.resolve();
      throw new Error('disk full');
    }),
    /disk full/,
  );
  await gate.run('reset-credentials', () => {});
});

for (const fail of [false, true]) {
  test(`sealed import keeps old caches blocked after ${fail ? 'recovery failure' : 'success'}`, async () => {
    const gate = createWorkspaceGate();
    const importResult = gate.run('import-workspace', async () => {
      await Promise.resolve();
      gate.seal();
      if (fail) throw new Error('recovery required');
      return true;
    });
    if (fail) await assert.rejects(importResult, /recovery required/);
    else assert.equal(await importResult, true);
    let invoked = false;
    for (const name of ['save', 'list-pet-jobs', ...maintenanceNames])
      await assert.rejects(
        gate.run(name, () => {
          invoked = true;
        }),
        /正在备份或恢复/,
      );
    assert.equal(invoked, false);
    await gate.run('open-data-directory', () => {});
    await assert.rejects(
      gate.run('save', () => {}),
      /正在备份或恢复/,
    );
  });
}
