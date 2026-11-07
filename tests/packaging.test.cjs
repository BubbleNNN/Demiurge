'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createRequire } = require('node:module');
const {
  installRuntimeDependencies,
  auditPayload,
  runtimeImports,
} = require('../scripts/package-desktop.cjs');

test('packaging copies a pnpm-style dependency closure without external links or test fixtures', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mori-packaging-unit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source');
  const output = path.join(dir, 'output');
  fs.mkdirSync(source);
  fs.mkdirSync(output);
  fs.writeFileSync(path.join(source, 'package.json'), '{}');
  function pkg(name, deps, code) {
    const location = path.join(source, 'node_modules/.pnpm', `${name}@1.0.0`, 'node_modules', name);
    fs.mkdirSync(path.join(location, 'tests'), { recursive: true });
    fs.writeFileSync(
      path.join(location, 'package.json'),
      JSON.stringify({ name, version: '1.0.0', main: 'index.cjs', dependencies: deps }),
    );
    fs.writeFileSync(path.join(location, 'index.cjs'), code);
    fs.writeFileSync(path.join(location, 'tests/secret-fixture.json'), '{"secret":"do not ship"}');
    return location;
  }
  const shared = pkg('shared', {}, 'module.exports = 42;');
  const a = pkg('a', { shared: '*' }, 'module.exports = require("shared");');
  const b = pkg('b', { shared: '*' }, 'module.exports = require("shared") + 1;');
  for (const [name, target] of [
    ['a', a],
    ['b', b],
  ])
    fs.symlinkSync(target, path.join(source, 'node_modules', name));
  for (const parent of [a, b]) fs.symlinkSync(shared, path.join(path.dirname(parent), 'shared'));
  installRuntimeDependencies(source, output, ['a', 'b']);
  fs.writeFileSync(path.join(output, 'package.json'), '{}');
  fs.rmSync(source, { recursive: true });
  const req = createRequire(path.join(output, 'package.json'));
  assert.equal(req('a'), 42);
  assert.equal(req('b'), 43);
  assert.equal(fs.existsSync(path.join(output, 'node_modules/a/tests')), false);
  assert.equal(fs.existsSync(path.join(output, 'node_modules/a/node_modules/shared/tests')), false);
});

test('payload audit rejects unapproved workspaces and escaping dependency symlinks', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mori-packaging-audit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const payload = path.join(dir, 'app');
  fs.mkdirSync(path.join(payload, '.local'), { recursive: true });
  assert.throws(() => auditPayload(payload), /Unapproved package root/);
  fs.rmSync(path.join(payload, '.local'), { recursive: true });
  fs.mkdirSync(path.join(payload, 'node_modules'));
  fs.symlinkSync(dir, path.join(payload, 'node_modules/outside'));
  assert.throws(() => auditPayload(payload), /symlink escapes/);
  fs.rmSync(path.join(payload, 'node_modules/outside'));
  fs.mkdirSync(path.join(payload, 'dist/art'), { recursive: true });
  fs.writeFileSync(path.join(payload, 'dist/art/credentials.json'), '{}');
  assert.throws(() => auditPayload(payload), /Unapproved package resource/);
});

test('runtime imports include installed production packages, never Electron or Node builtins', () => {
  const imports = runtimeImports(path.join(__dirname, '../electron'));
  assert.ok(imports.includes('fflate'));
  assert.ok(imports.includes('linkedom'));
  assert.ok(imports.includes('@mozilla/readability'));
  assert.ok(imports.every((name) => name !== 'electron' && !name.startsWith('node:')));
});
