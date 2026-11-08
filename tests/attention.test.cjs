'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function load(file) {
  const result = {};
  new Function('exports', 'require', ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(result, require);
  return result;
}
const a = load(path.resolve(__dirname, '../src/attention.ts'));
const MIN = 60000;
const warm = { energy: 50, affection: 90, curiosity: 50 },
  reserved = { energy: 50, affection: 10, curiosity: 50 };

test('invitations wait for a pause, keep a long gap and never exceed two an hour', () => {
  const s = a.freshAttention();
  const t0 = 10 * 3600000;
  assert.equal(a.mayInvite(s, t0, 2, warm), false, 'not while the user is typing');
  assert.equal(a.mayInvite(s, t0, 1200, warm), false, 'not when the user is away');
  assert.equal(a.mayInvite(s, t0, 45, warm), true, 'at a pause');
  a.recordInvite(s, t0);
  assert.equal(a.mayInvite(s, t0 + 10 * MIN, 45, warm), false, 'gap after an invitation');
  assert.equal(a.mayInvite(s, t0 + 22 * MIN, 45, warm), true);
  a.recordInvite(s, t0 + 22 * MIN);
  assert.equal(a.mayInvite(s, t0 + 50 * MIN, 45, warm), false, 'at most two within an hour');
  assert.equal(a.mayInvite(s, t0 + 90 * MIN, 45, warm), true);
  assert.ok(a.inviteGap(reserved) > a.inviteGap(warm), 'reserved characters ask less often');
  const restored = a.restoreAttention(JSON.parse(JSON.stringify(s)));
  assert.equal(a.mayInvite(restored, t0 + 50 * MIN, 45, warm), false, 'limits survive a restart');
  assert.deepEqual(a.restoreAttention('nonsense'), a.freshAttention());
});

test('remarks are spaced, capped and skipped when nobody is there; greetings come on return', () => {
  const s = a.freshAttention();
  const t0 = 10 * 3600000;
  assert.equal(a.mayRemark(s, t0, 3), true);
  a.recordRemark(s, t0);
  assert.equal(a.mayRemark(s, t0 + 3 * MIN, 3), false);
  assert.equal(a.mayRemark(s, t0 + 7 * MIN, 3), true);
  assert.equal(a.mayRemark(s, t0 + 7 * MIN, 900), false, 'not into an empty room');
  for (let i = 1; i <= 4; i++) a.recordRemark(s, t0 + i * 7 * MIN);
  assert.equal(a.mayRemark(s, t0 + 40 * MIN, 3), false, 'at most five an hour');
  const g = a.freshAttention();
  assert.equal(a.noticeReturn(g, t0, 2), false, 'no greeting without having been away');
  assert.equal(a.noticeReturn(g, t0 + 10 * MIN, 400), false);
  assert.equal(a.noticeReturn(g, t0 + 11 * MIN, 1), true, 'welcome back');
  assert.equal(a.noticeReturn(g, t0 + 11 * MIN + 5000, 1), false, 'once');
  a.noticeReturn(g, t0 + 20 * MIN, 400);
  assert.equal(a.noticeReturn(g, t0 + 21 * MIN, 1), false, 'not again within half an hour');
  const fresh = a.freshAttention();
  // The computer sat idle before she was opened: the user starting Mori is not a return.
  assert.equal(a.noticeReturn(fresh, t0 + MIN, 900, t0), false);
  assert.equal(a.noticeReturn(fresh, t0 + MIN + 2000, 1, t0), false);
});
