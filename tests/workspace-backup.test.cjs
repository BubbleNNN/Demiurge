'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { zipSync, unzipSync } = require('fflate');
const { validateState } = require('../electron/store.cjs');
const {
  exportWorkspace,
  importWorkspace,
  recoverInterruptedImport,
  createWorkspaceBackup,
  MAX_TOTAL_BYTES,
  JOURNAL,
} = require('../electron/workspace-backup.cjs');
const timestamp = '2026-10-22T00:00:00.000Z';
const modelId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const sha = (value) => createHash('sha256').update(value).digest('hex');

function state(label = 'old') {
  return {
    settings: {
      llmBaseUrl: 'https://example.org/v1',
      llmModel: 'saved-model',
      imageBaseUrl: 'https://example.org/v1',
      imageModel: '',
      demoMode: false,
      proactiveEnabled: false,
    },
    characters: [
      {
        id: 'mori',
        name: label,
        work: '原创',
        summary: label,
        personality: ['kind'],
        speakingStyle: 'warm',
        appearance: '',
        quotes: [],
        sources: [],
        unknowns: [],
        behavior: { energy: 50, affection: 50, curiosity: 50 },
        createdAt: timestamp,
      },
    ],
    skins: [],
    activeCharacterId: 'mori',
    activeSkinId: '',
    messages: {
      mori: [
        { id: `message-${label}`, role: 'user', content: `private chat ${label}`, createdAt: timestamp },
      ],
    },
    memories: [
      { id: `memory-${label}`, characterId: 'mori', text: `private memory ${label}`, createdAt: timestamp },
    ],
    revision: 5,
  };
}
async function directory(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mori-workspace-backup-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return fs.realpath(dir);
}
async function write(root, name, value) {
  await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
  await fs.writeFile(
    path.join(root, name),
    typeof value === 'object' && !Buffer.isBuffer(value) ? JSON.stringify(value) : value,
  );
}
async function populate(root, label = 'old') {
  await write(root, 'state.json', state(label));
  await write(root, 'state.previous.json', state(`previous-${label}`));
  await write(root, `models/${modelId}/avatar.vrm`, `model-bytes-${label}`);
  await write(root, `models/${modelId}/纹理/颜色.png`, Buffer.from([0, 1, 2, 3]));
  await fs.mkdir(path.join(root, `models/${modelId}/empty`));
  await write(root, 'pet-jobs/task.asset.json', { image: `image-${label}` });
  await write(root, 'model-jobs/task.json', { status: 'generating', taskId: `remote-${label}` });
  await write(root, 'credentials.enc.json', `SECRET-${label}`);
  await write(root, '.local/cache.json', { secret: label });
  await write(root, 'Cache/secret', 'chromium-private-cache');
}
function repack(bytes, edit, options = {}) {
  const files = unzipSync(bytes);
  edit(files);
  return Buffer.from(zipSync(files, { level: 6, ...options }));
}
function changeManifest(files, change) {
  const manifest = JSON.parse(Buffer.from(files['manifest.json']).toString());
  change(manifest);
  files['manifest.json'] = Buffer.from(JSON.stringify(manifest));
}
function addFile(files, name, bytes) {
  files[name] = Buffer.from(bytes);
  changeManifest(files, (manifest) =>
    manifest.files.push({ path: name, size: files[name].length, sha256: sha(files[name]) }),
  );
}
async function assertOld(root) {
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'state.json'), 'utf8')), state('old'));
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(root, 'state.previous.json'), 'utf8')),
    state('previous-old'),
  );
  assert.equal(await fs.readFile(path.join(root, `models/${modelId}/avatar.vrm`), 'utf8'), 'model-bytes-old');
  assert.equal(await fs.readFile(path.join(root, 'credentials.enc.json'), 'utf8'), 'SECRET-old');
  assert.equal(
    JSON.parse(await fs.readFile(path.join(root, 'pet-jobs/task.asset.json'), 'utf8')).image,
    'image-old',
  );
}

test('workspace ZIP preserves the latest supplied state, models, task artifacts and empty directories without keys or caches', async (t) => {
  const root = await directory(t),
    target = await directory(t);
  await populate(root, 'source');
  await populate(target, 'old');
  const fresh = state('fresh-unsaved-snapshot');
  fresh.skins = [
    {
      id: 'avatar',
      characterId: 'mori',
      name: 'avatar',
      style: '3d',
      kind: 'vrm',
      images: {},
      generated: false,
      createdAt: timestamp,
      model: { id: modelId, entry: 'avatar.vrm', expressions: [], motions: {} },
    },
  ];
  fresh.activeSkinId = 'avatar';
  const zip = await exportWorkspace(root, fresh);
  const files = unzipSync(zip);
  const manifest = JSON.parse(Buffer.from(files['manifest.json']).toString());
  assert.equal(manifest.format, 'mori-workspace');
  assert.equal(manifest.version, 1);
  assert.deepEqual(JSON.parse(Buffer.from(files['state.json']).toString()), validateState(fresh));
  assert.ok(
    Object.keys(files).every(
      (name) =>
        ['state.json', 'manifest.json'].includes(name) || /^(models|pet-jobs|model-jobs)\//.test(name),
    ),
  );
  assert.ok(!Object.keys(files).some((name) => /credentials|Cache|\.local|state\.previous/.test(name)));
  for (const entry of manifest.files) {
    assert.equal(entry.size, files[entry.path].length);
    assert.equal(entry.sha256, sha(files[entry.path]));
  }
  const result = await importWorkspace(target, zip);
  assert.equal(result.status, 'committed');
  assert.equal(result.requiresRelaunch, true);
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(target, 'state.json'), 'utf8')),
    validateState(fresh),
  );
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(target, 'state.previous.json'), 'utf8')),
    validateState(fresh),
  );
  assert.equal(
    await fs.readFile(path.join(target, `models/${modelId}/avatar.vrm`), 'utf8'),
    'model-bytes-source',
  );
  assert.ok((await fs.stat(path.join(target, `models/${modelId}/empty`))).isDirectory());
  assert.equal(await fs.readFile(path.join(target, 'credentials.enc.json'), 'utf8'), 'SECRET-old');
  assert.equal(await fs.readFile(path.join(target, 'Cache/secret'), 'utf8'), 'chromium-private-cache');
  await assertOldExceptCredentials(result.recoveryDirectory);
  await assert.rejects(fs.stat(path.join(result.recoveryDirectory, 'credentials.enc.json')), {
    code: 'ENOENT',
  });
  assert.equal((await recoverInterruptedImport(target)).status, 'none');
  // The retained snapshot is independently re-exportable without any path rewriting.
  const original = JSON.parse(await fs.readFile(path.join(result.recoveryDirectory, 'state.json'), 'utf8'));
  const recoveryZip = await exportWorkspace(result.recoveryDirectory, original);
  const restored = await directory(t);
  await importWorkspace(restored, recoveryZip);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(restored, 'state.json'), 'utf8')), state('old'));
});
async function assertOldExceptCredentials(root) {
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'state.json'), 'utf8')), state('old'));
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(root, 'state.previous.json'), 'utf8')),
    state('previous-old'),
  );
  assert.equal(await fs.readFile(path.join(root, `models/${modelId}/avatar.vrm`), 'utf8'), 'model-bytes-old');
}

test('a workspace with no prior state or asset directories can be restored', async (t) => {
  const source = await directory(t),
    target = await directory(t);
  const archive = await exportWorkspace(source, state('new'));
  const result = await importWorkspace(target, archive);
  assert.equal(result.status, 'committed');
  assert.deepEqual(result.state, state('new'));
  for (const name of ['models', 'pet-jobs', 'model-jobs'])
    assert.ok((await fs.stat(path.join(target, name))).isDirectory());
});

test('tampered hashes, invalid state, missing models, unsupported formats and undeclared files never replace the original', async (t) => {
  const source = await directory(t),
    target = await directory(t);
  await populate(source, 'source');
  await populate(target, 'old');
  const zip = await exportWorkspace(source, state('new'));
  const bad = [
    repack(zip, (files) => {
      files['pet-jobs/task.asset.json'][0] ^= 1;
    }),
    repack(zip, (files) =>
      changeManifest(files, (m) => {
        m.version = 9;
      }),
    ),
    repack(zip, (files) => {
      files['pet-jobs/hidden.json'] = Buffer.from('{}');
    }),
    repack(zip, (files) => {
      files['state.json'] = Buffer.from('{}');
      changeManifest(files, (m) => {
        const e = m.files.find((e) => e.path === 'state.json');
        e.size = 2;
        e.sha256 = sha(files['state.json']);
      });
    }),
    repack(zip, (files) => {
      const input = state('broken-model');
      input.skins = [
        {
          id: 'broken',
          characterId: 'mori',
          name: 'broken',
          style: '3d',
          kind: 'vrm',
          images: {},
          generated: false,
          createdAt: timestamp,
          model: {
            id: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
            entry: 'missing.vrm',
            expressions: [],
            motions: {},
          },
        },
      ];
      files['state.json'] = Buffer.from(JSON.stringify(input));
      changeManifest(files, (m) => {
        const e = m.files.find((e) => e.path === 'state.json');
        e.size = files['state.json'].length;
        e.sha256 = sha(files['state.json']);
      });
    }),
  ];
  for (const bytes of bad) {
    await assert.rejects(importWorkspace(target, bytes));
    await assertOld(target);
    assert.equal((await recoverInterruptedImport(target)).status, 'none');
  }
});

test('path traversal, absolute names, backslashes, case/Unicode aliases, symlinks and local-header mismatches are rejected', async (t) => {
  const source = await directory(t),
    target = await directory(t);
  await populate(source, 'source');
  await populate(target, 'old');
  const zip = await exportWorkspace(source, state('new'));
  for (const name of [
    '../state.json',
    '/state.json',
    'models/../../secret',
    'models\\escape',
    'credentials.enc.json',
    'models/a:stream',
    'models/a/../b',
  ]) {
    const modified = repack(zip, (files) => {
      files[name] = Buffer.from('x');
    });
    await assert.rejects(importWorkspace(target, modified), /备份无效/);
  }
  const variants = [
    repack(zip, (files) => {
      files['STATE.JSON'] = Buffer.from('x');
    }),
    repack(zip, (files) => {
      files['models/é'] = Buffer.from('x');
      files['models/e\u0301'] = Buffer.from('x');
    }),
    repack(zip, () => {}, { os: 3, attrs: (0o120777 << 16) >>> 0 }),
    repack(zip, (files) => changeManifest(files, (m) => m.files.push(m.files[0]))),
    repack(zip, (files) => changeManifest(files, (m) => m.directories.push('models/state.json/child'))),
  ];
  for (const bytes of variants) await assert.rejects(importWorkspace(target, bytes), /备份无效/);
  const localMismatch = Buffer.from(zip);
  localMismatch[30] ^= 1;
  await assert.rejects(importWorkspace(target, localMismatch), /路径不一致/);
  await assertOld(target);
});

test('ZIP size lies, duplicate central names and streams exceeding their declared size are rejected before replacement', async (t) => {
  const source = await directory(t),
    target = await directory(t);
  await populate(target, 'old');
  const zip = await exportWorkspace(source, state('new'));
  const bomb = Buffer.from(zip);
  const central = bomb.readUInt32LE(bomb.length - 6);
  bomb.writeUInt32LE(MAX_TOTAL_BYTES + 1, central + 24);
  await assert.rejects(importWorkspace(target, bomb), /大小限制/);
  const duplicate = repack(zip, (files) => {
    files['statz.json'] = files['state.json'];
  });
  for (let offset = 0; offset < duplicate.length - 10; offset++)
    if (duplicate.subarray(offset, offset + 10).toString() === 'statz.json')
      duplicate.write('state.json', offset);
  await assert.rejects(importWorkspace(target, duplicate), /重复/);
  const huge = repack(zip, (files) => {
    addFile(files, 'models/bomb.bin', Buffer.alloc(4 * 1024 * 1024));
    changeManifest(files, (m) => {
      m.directories.push('models');
      const entry = m.files.find((entry) => entry.path === 'models/bomb.bin');
      entry.size = 1;
      entry.sha256 = sha(Buffer.alloc(1));
    });
  });
  const altered = Buffer.from(huge);
  let offset = altered.readUInt32LE(altered.length - 6);
  while (offset < altered.length - 22) {
    const length = altered.readUInt16LE(offset + 28);
    const name = altered.subarray(offset + 46, offset + 46 + length).toString();
    if (name === 'models/bomb.bin') {
      altered.writeUInt32LE(1, offset + 24);
      altered.writeUInt32LE(1, altered.readUInt32LE(offset + 42) + 22);
    }
    offset += 46 + length;
  }
  await assert.rejects(importWorkspace(target, altered), /解压失败或超过声明大小/);
  await assertOld(target);
});

test('export and replacement refuse symlinks in local model trees and do not follow user-data links', async (t) => {
  const root = await directory(t),
    other = await directory(t);
  await populate(root, 'old');
  await fs.symlink(path.join(root, 'credentials.enc.json'), path.join(root, `models/${modelId}/secret.png`));
  await assert.rejects(exportWorkspace(root, state()), /符号链接/);
  await fs.unlink(path.join(root, `models/${modelId}/secret.png`));
  const zip = await exportWorkspace(root, state());
  await fs.symlink(path.join(root, 'credentials.enc.json'), path.join(root, `models/${modelId}/secret.png`));
  await assert.rejects(importWorkspace(root, zip), /符号链接/);
  await assertOld(root);
  await fs.symlink(root, path.join(other, 'linked'));
  await assert.rejects(exportWorkspace(path.join(other, 'linked'), state()), /符号链接/);
  await fs.unlink(path.join(root, `models/${modelId}/secret.png`));
  await fs.link(path.join(root, 'credentials.enc.json'), path.join(root, `models/${modelId}/hardlink.png`));
  await assert.rejects(exportWorkspace(root, state()), /硬链接/);
});

test('an install rename failure rolls back every prior target and preserves credentials and the complete recovery copy', async (t) => {
  const source = await directory(t),
    target = await directory(t);
  await populate(source, 'source');
  await populate(target, 'old');
  const zip = await exportWorkspace(source, state('new'));
  let failed = false;
  const backend = createWorkspaceBackup({
    io: {
      ...fs,
      rename: async (from, to) => {
        if (!failed && from.includes('/incoming/') && to === path.join(target, 'pet-jobs')) {
          failed = true;
          throw Object.assign(new Error('injected disk failure'), { code: 'EIO' });
        }
        return fs.rename(from, to);
      },
    },
  });
  await assert.rejects(backend.importWorkspace(target, zip), /injected disk failure/);
  assert.equal(failed, true);
  await assertOld(target);
  const recovery = (await fs.readdir(target)).find((name) => name.startsWith('recovery-'));
  assert.ok(recovery);
  await assertOldExceptCredentials(path.join(target, recovery));
  assert.equal((await recoverInterruptedImport(target)).status, 'none');
});

test('process termination during replacement is recovered idempotently on next startup', async (t) => {
  const source = await directory(t),
    target = await directory(t),
    temp = await directory(t);
  await populate(source, 'source');
  await populate(target, 'old');
  await fs.writeFile(path.join(temp, 'backup.zip'), await exportWorkspace(source, state('new')));
  const modulePath = path.resolve(__dirname, '../electron/workspace-backup.cjs');
  const childScript = `
    const fs = require('node:fs/promises'), path = require('node:path');
    const { createWorkspaceBackup } = require(${JSON.stringify(modulePath)});
    const root = process.argv[1];
    const backend = createWorkspaceBackup({io:{...fs,rename:async(from,to)=>{
      await fs.rename(from,to);
      if(from.includes('/incoming/') && to===path.join(root,'models')) process.exit(73);
    }}});
    fs.readFile(process.argv[2]).then(bytes=>backend.importWorkspace(root,bytes)).catch(e=>{console.error(e);process.exit(1)});
  `;
  const child = spawnSync(process.execPath, ['-e', childScript, target, path.join(temp, 'backup.zip')], {
    encoding: 'utf8',
    timeout: 20000,
  });
  assert.equal(child.status, 73, child.stderr);
  assert.ok(await fs.stat(path.join(target, JOURNAL)));
  const result = await recoverInterruptedImport(target);
  assert.equal(result.status, 'rolled-back');
  await assertOld(target);
  assert.equal((await recoverInterruptedImport(target)).status, 'none');
});

test('termination after durable commit keeps the imported data and finishes cleanup', async (t) => {
  const source = await directory(t),
    target = await directory(t),
    temp = await directory(t);
  await populate(source, 'source');
  await populate(target, 'old');
  await fs.writeFile(path.join(temp, 'backup.zip'), await exportWorkspace(source, state('new')));
  const modulePath = path.resolve(__dirname, '../electron/workspace-backup.cjs');
  const code = `
    const fs=require('node:fs/promises'),path=require('node:path');
    const {createWorkspaceBackup}=require(${JSON.stringify(modulePath)});
    const root=process.argv[1];
    const backend=createWorkspaceBackup({io:{...fs,rm:async(file,options)=>{
      if(path.dirname(file)===root && path.basename(file).startsWith('.workspace-import-') && !file.endsWith('.tmp'))process.exit(74);
      return fs.rm(file,options);
    }}});
    fs.readFile(process.argv[2]).then(bytes=>backend.importWorkspace(root,bytes)).catch(e=>{console.error(e);process.exit(1)});
  `;
  const child = spawnSync(process.execPath, ['-e', code, target, path.join(temp, 'backup.zip')], {
    encoding: 'utf8',
    timeout: 20000,
  });
  assert.equal(child.status, 74, child.stderr);
  assert.equal((await recoverInterruptedImport(target)).status, 'committed');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(target, 'state.json'), 'utf8')), state('new'));
  assert.equal(await fs.readFile(path.join(target, 'credentials.enc.json'), 'utf8'), 'SECRET-old');
  assert.equal((await recoverInterruptedImport(target)).status, 'none');
});

test('malformed journals fail closed without erasing current data', async (t) => {
  const root = await directory(t);
  await populate(root, 'old');
  await write(root, JOURNAL, {
    format: 'mori-workspace-import',
    version: 1,
    id: '../escape',
    phase: 'installing',
    recovery: '../other',
  });
  await assert.rejects(recoverInterruptedImport(root), /日志无效/);
  await assertOld(root);
});

test('a second failure during rollback keeps the journal and can be recovered on a later startup', async (t) => {
  const source = await directory(t),
    target = await directory(t);
  await populate(source, 'source');
  await populate(target, 'old');
  const zip = await exportWorkspace(source, state('new'));
  const backend = createWorkspaceBackup({
    io: {
      ...fs,
      rename: async (from, to) => {
        if (from.includes('/incoming/') && to === path.join(target, 'pet-jobs'))
          throw new Error('install failure');
        if (from.includes('/rollback/') && to === path.join(target, 'models'))
          throw new Error('rollback failure');
        return fs.rename(from, to);
      },
    },
  });
  await assert.rejects(
    backend.importWorkspace(target, zip),
    (error) => error.code === 'MORI_RECOVERY_REQUIRED' && error.recoveryRequired,
  );
  assert.ok(await fs.stat(path.join(target, JOURNAL)));
  await assert.rejects(exportWorkspace(target, state()), /上次中断/);
  const recovered = await recoverInterruptedImport(target);
  assert.equal(recovered.status, 'rolled-back');
  await assertOld(target);
});

test('a corrupt recovery copy is rejected before rollback touches any current target', async (t) => {
  const source = await directory(t),
    target = await directory(t);
  await populate(source, 'source');
  await populate(target, 'old');
  const zip = await exportWorkspace(source, state('new'));
  const backend = createWorkspaceBackup({
    io: {
      ...fs,
      rename: async (from, to) => {
        if (from.includes('/incoming/') && to === path.join(target, 'pet-jobs'))
          throw new Error('install failure');
        if (from.includes('/rollback/') && to === path.join(target, 'models'))
          throw new Error('rollback failure');
        return fs.rename(from, to);
      },
    },
  });
  await assert.rejects(backend.importWorkspace(target, zip), { code: 'MORI_RECOVERY_REQUIRED' });
  const journal = JSON.parse(await fs.readFile(path.join(target, JOURNAL), 'utf8'));
  const savedModel = path.join(target, journal.recovery, `models/${modelId}/avatar.vrm`);
  const original = await fs.readFile(savedModel);
  const before = await fs.readFile(path.join(target, 'state.json'));
  await fs.writeFile(savedModel, 'CORRUPT');
  await assert.rejects(
    recoverInterruptedImport(target),
    (error) => error.code === 'MORI_RECOVERY_REQUIRED' && /副本校验失败/.test(error.message),
  );
  assert.deepEqual(await fs.readFile(path.join(target, 'state.json')), before);
  assert.ok(await fs.stat(path.join(target, JOURNAL)));
  await fs.writeFile(savedModel, original);
  assert.equal((await recoverInterruptedImport(target)).status, 'rolled-back');
  await assertOld(target);
});

test('cleanup errors after commit still report successful import and are retried at startup', async (t) => {
  const source = await directory(t),
    target = await directory(t);
  await populate(source, 'source');
  await populate(target, 'old');
  const zip = await exportWorkspace(source, state('new'));
  const backend = createWorkspaceBackup({
    io: {
      ...fs,
      rm: async (file, options) => {
        if (
          path.dirname(file) === target &&
          path.basename(file).startsWith('.workspace-import-') &&
          !file.endsWith('.tmp')
        )
          throw new Error('cleanup failure');
        return fs.rm(file, options);
      },
    },
  });
  const result = await backend.importWorkspace(target, zip);
  assert.equal(result.status, 'committed');
  assert.equal(result.requiresRelaunch, true);
  assert.equal(result.cleanupPending, true);
  assert.equal((await recoverInterruptedImport(target)).status, 'committed');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(target, 'state.json'), 'utf8')), state('new'));
  assert.equal((await recoverInterruptedImport(target)).status, 'none');
});

test('journal rename success followed by directory fsync failure follows the journal actually on disk', async (t) => {
  for (const phase of ['installing', 'committed']) {
    await t.test(phase, async (t) => {
      const source = await directory(t),
        target = await directory(t);
      await populate(source, 'source');
      await populate(target, 'old');
      const zip = await exportWorkspace(source, state('new'));
      let failed = false;
      const backend = createWorkspaceBackup({
        io: {
          ...fs,
          open: async (file, ...args) => {
            const handle = await fs.open(file, ...args);
            if (file !== target) return handle;
            return {
              close: () => handle.close(),
              sync: async () => {
                let journal;
                try {
                  journal = JSON.parse(await fs.readFile(path.join(target, JOURNAL), 'utf8'));
                } catch (error) {
                  if (error.code !== 'ENOENT') throw error;
                }
                if (!failed && journal?.phase === phase) {
                  failed = true;
                  throw Object.assign(new Error('injected journal directory fsync failure'), { code: 'EIO' });
                }
                return handle.sync();
              },
            };
          },
        },
      });
      if (phase === 'installing') {
        await assert.rejects(
          backend.importWorkspace(target, zip),
          /injected journal directory fsync failure/,
        );
        await assertOld(target);
      } else {
        const result = await backend.importWorkspace(target, zip);
        assert.equal(result.status, 'committed');
        assert.equal(result.requiresRelaunch, true);
        assert.deepEqual(
          JSON.parse(await fs.readFile(path.join(target, 'state.json'), 'utf8')),
          state('new'),
        );
        assert.equal(await fs.readFile(path.join(target, 'credentials.enc.json'), 'utf8'), 'SECRET-old');
      }
      assert.equal(failed, true);
      assert.equal((await recoverInterruptedImport(target)).status, 'none');
    });
  }
});
