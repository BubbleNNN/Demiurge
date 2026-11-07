'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { zipSync, unzipSync } = require('fflate');
const {
  exportWorkspace,
  importWorkspace,
  createWorkspaceBackup,
  JOURNAL,
} = require('../electron/workspace-backup.cjs');
const state = (name) => ({
  settings: {
    llmBaseUrl: '',
    llmModel: '',
    imageBaseUrl: '',
    imageModel: '',
    demoMode: false,
    proactiveEnabled: false,
  },
  characters: [
    {
      id: 'character',
      name,
      work: '',
      summary: '',
      personality: [],
      speakingStyle: '',
      appearance: '',
      quotes: [],
      sources: [],
      unknowns: [],
      behavior: { energy: 50, affection: 50, curiosity: 50 },
      createdAt: '2026-10-22T00:00:00Z',
    },
  ],
  skins: [],
  activeCharacterId: 'character',
  activeSkinId: '',
  messages: {},
  memories: [],
});
async function setup(t) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'mori-backup-review-'));
  t.after(() => fs.rm(parent, { force: true, recursive: true }));
  const root = await fs.realpath(parent),
    source = path.join(root, 'source'),
    target = path.join(root, 'target'),
    outside = path.join(root, 'outside');
  for (const dir of [source, target, outside]) await fs.mkdir(dir);
  await fs.writeFile(path.join(target, 'state.json'), JSON.stringify(state('old')));
  await fs.mkdir(path.join(target, 'models'));
  await fs.writeFile(path.join(target, 'models', 'user-model.bin'), 'original-model');
  await fs.writeFile(path.join(target, 'credentials.enc.json'), 'private-keys');
  await fs.writeFile(path.join(target, 'unrelated-user-file.txt'), 'user-file');
  await fs.writeFile(path.join(outside, 'keep.txt'), 'outside-file');
  return { source, target, outside, zip: await exportWorkspace(source, state('new')) };
}
async function untouched(target, outside) {
  assert.equal(await fs.readFile(path.join(target, 'credentials.enc.json'), 'utf8'), 'private-keys');
  assert.equal(await fs.readFile(path.join(target, 'unrelated-user-file.txt'), 'utf8'), 'user-file');
  assert.equal(await fs.readFile(path.join(outside, 'keep.txt'), 'utf8'), 'outside-file');
}

test('rollback unlinks a substituted target symlink without following it or deleting unrelated user files', async (t) => {
  const { target, outside, zip } = await setup(t);
  let injected = false;
  const backend = createWorkspaceBackup({
    io: {
      ...fs,
      rename: async (from, to) => {
        if (!injected && from.includes('/incoming/') && to === path.join(target, 'models')) {
          injected = true;
          await fs.symlink(outside, to);
          throw new Error('Injected target replacement failure');
        }
        return fs.rename(from, to);
      },
    },
  });
  await assert.rejects(backend.importWorkspace(target, zip), /Injected target replacement failure/);
  await untouched(target, outside);
  assert.equal(await fs.readFile(path.join(target, 'models', 'user-model.bin'), 'utf8'), 'original-model');
  assert.equal(
    JSON.parse(await fs.readFile(path.join(target, 'state.json'), 'utf8')).characters[0].name,
    'old',
  );
});

test('a substituted symlink in the recovery copy stops rollback before deleting current targets', async (t) => {
  const { target, outside, zip } = await setup(t);
  let injected = false;
  const backend = createWorkspaceBackup({
    io: {
      ...fs,
      rename: async (from, to) => {
        if (!injected && from.includes('/incoming/') && to === path.join(target, 'models')) {
          injected = true;
          const recovery = (await fs.readdir(target)).find((name) => name.startsWith('recovery-'));
          const models = path.join(target, recovery, 'models');
          await fs.rm(models, { recursive: true });
          await fs.symlink(outside, models);
          throw new Error('Injected recovery copy substitution');
        }
        return fs.rename(from, to);
      },
    },
  });
  await assert.rejects(backend.importWorkspace(target, zip), { code: 'MORI_RECOVERY_REQUIRED' });
  await untouched(target, outside);
  assert.equal(
    JSON.parse(await fs.readFile(path.join(target, 'state.json'), 'utf8')).characters[0].name,
    'new',
  );
  const journal = JSON.parse(await fs.readFile(path.join(target, JOURNAL), 'utf8'));
  assert.equal(
    await fs.readFile(path.join(target, journal.staging, 'displaced', 'models', 'user-model.bin'), 'utf8'),
    'original-model',
  );
});

test('credential-shaped extras in a valid archive are stripped from imported state and previous state', async (t) => {
  const { target, outside, zip } = await setup(t),
    files = unzipSync(zip);
  const input = JSON.parse(Buffer.from(files['state.json']).toString());
  input.credentials = { llmKey: 'archive-secret' };
  input.settings.ttsKey = 'archive-secret';
  files['state.json'] = Buffer.from(JSON.stringify(input));
  const manifest = JSON.parse(Buffer.from(files['manifest.json']).toString());
  const entry = manifest.files.find((item) => item.path === 'state.json');
  entry.size = files['state.json'].length;
  entry.sha256 = createHash('sha256').update(files['state.json']).digest('hex');
  files['manifest.json'] = Buffer.from(JSON.stringify(manifest));
  const result = await importWorkspace(target, Buffer.from(zipSync(files)));
  assert.equal(result.status, 'committed');
  for (const name of ['state.json', 'state.previous.json'])
    assert.doesNotMatch(await fs.readFile(path.join(target, name), 'utf8'), /archive-secret/);
  await untouched(target, outside);
});
