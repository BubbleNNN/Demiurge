'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const exportsObject = {};
new Function(
  'exports',
  ts.transpileModule(fs.readFileSync('src/generationQueue.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
)(exportsObject);
const { generationQueue, runGenerationQueue } = exportsObject;
const all = ['original', 'anime', 'chibi', 'sticker', 'powerpuff', 'pixel', '8bit', '3d'];

test('all selected styles run serially and save each candidate before starting the next image request', async () => {
  const events = [],
    snapshots = [];
  let active = 0,
    maximum = 0;
  const result = await runGenerationQueue(generationQueue([...all, 'anime']), {
    async generate(style) {
      maximum = Math.max(maximum, ++active);
      events.push('generate:' + style);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return { id: style, style };
    },
    async save(skin) {
      events.push('save:' + skin.style);
    },
    onChange: (items) => snapshots.push(items),
    shouldStop: () => false,
  });
  assert.equal(maximum, 1);
  assert.deepEqual(
    events,
    all.flatMap((style) => ['generate:' + style, 'save:' + style]),
  );
  assert.equal(result.length, all.length);
  assert.ok(result.every((item) => item.status === 'saved'));
  assert.equal(snapshots[0][0].status, 'generating', 'Published snapshots do not mutate after later steps');
});

test('a failed style does not discard other results and explicit retry never regenerates saved candidates', async () => {
  const calls = [];
  let fail = true;
  const options = {
    async generate(style) {
      calls.push(style);
      if (style === 'chibi' && fail) throw new Error('Style provider unavailable');
      return { id: style };
    },
    save: async () => {},
    onChange: () => {},
    shouldStop: () => false,
  };
  const first = await runGenerationQueue(generationQueue(['anime', 'chibi', '3d']), options);
  assert.deepEqual(
    first.map((item) => item.status),
    ['saved', 'failed', 'saved'],
  );
  fail = false;
  const retry = await runGenerationQueue(
    first.map((item) => (item.status === 'failed' ? { ...item, status: 'queued' } : item)),
    options,
  );
  assert.deepEqual(calls, ['anime', 'chibi', '3d', 'chibi']);
  assert.ok(retry.every((item) => item.status === 'saved'));
});

test('local save failure retains returned pixels and pauses subsequent paid requests until local recovery', async () => {
  const calls = [],
    returned = { id: 'anime', images: { neutral: 'original-returned-pixels' } };
  const options = {
    async generate(style) {
      calls.push(style);
      return returned;
    },
    async save() {
      throw new Error('Disk full');
    },
    onChange: () => {},
    shouldStop: () => false,
  };
  const first = await runGenerationQueue(generationQueue(['anime', '3d']), options);
  assert.deepEqual(
    first.map((item) => item.status),
    ['unsaved', 'queued'],
  );
  assert.equal(first[0].skin, returned);
  await runGenerationQueue(first, options);
  assert.deepEqual(calls, ['anime']);
  // A separate local-only save succeeds, then the user explicitly continues.
  const recovered = first.map((item) => (item.status === 'unsaved' ? { ...item, status: 'saved' } : item));
  const continued = await runGenerationQueue(recovered, { ...options, save: async () => {} });
  assert.deepEqual(calls, ['anime', '3d']);
  assert.ok(continued.every((item) => item.status === 'saved'));
});

test('stopping completes and saves the current image, while a later continue only processes untouched styles', async () => {
  const calls = [];
  let stop = false;
  const options = {
    async generate(style) {
      calls.push(style);
      stop = true;
      return { id: style };
    },
    save: async () => {},
    onChange: () => {},
    shouldStop: () => stop,
  };
  const first = await runGenerationQueue(generationQueue(['anime', '3d', '8bit']), options);
  assert.deepEqual(
    first.map((item) => item.status),
    ['saved', 'queued', 'queued'],
  );
  const rest = await runGenerationQueue(first, { ...options, shouldStop: () => false });
  assert.deepEqual(calls, ['anime', '3d', '8bit']);
  assert.ok(rest.every((item) => item.status === 'saved'));
});

test('retrying one failure leaves unrelated queued styles untouched', async () => {
  const calls = [];
  const result = await runGenerationQueue(
    [
      { style: 'anime', status: 'saved', skin: { id: 'old' } },
      { style: 'chibi', status: 'queued' },
      { style: '3d', status: 'queued' },
    ],
    {
      async generate(style) {
        calls.push(style);
        return { id: style };
      },
      save: async () => {},
      onChange: () => {},
      shouldStop: () => false,
      styles: ['chibi'],
    },
  );
  assert.deepEqual(calls, ['chibi']);
  assert.deepEqual(
    result.map((item) => item.status),
    ['saved', 'saved', 'queued'],
  );
});
