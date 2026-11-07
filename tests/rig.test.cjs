'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const exportsObject = {};
new Function(
  'exports',
  ts.transpileModule(fs.readFileSync('src/animation/rig.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText,
)(exportsObject);
const { vrmPose, vrmBlink, sampleCurve } = exportsObject;
test('finite bone gestures recover to the rest pose and leave unrelated joints still', () => {
  const rest = vrmPose('idle', 0);
  for (const action of ['wave', 'nod', 'shake', 'bounce']) {
    assert.deepEqual(vrmPose(action, 0), rest);
    assert.deepEqual(vrmPose(action, 10000), rest);
    assert.deepEqual(vrmPose(action, 700, true), rest);
  }
  assert.deepEqual(vrmPose('idle', 999999), rest);
  assert.ok(vrmPose('wave', 800).lowerArm > 1);
  assert.equal(vrmPose('wave', 800).jump, 0);
  assert.equal(vrmPose('wave', 800).headX, 0);
  assert.ok(vrmPose('nod', 380).headX > 0);
  assert.equal(vrmPose('nod', 380).upperArm, rest.upperArm);
  assert.equal(vrmPose('bounce', 400).jump, 0.06);
  for (let age = 0; age < 4000; age += 13) {
    assert.ok(vrmPose('bounce', age).jump >= 0 && vrmPose('bounce', age).jump <= 0.06);
    assert.ok(Math.abs(vrmPose('shake', age).headY) <= 0.14);
  }
});
test('key curves hold endpoints and blinking stays in a short closed-open interval', () => {
  const curve = [
    [0, 0],
    [100, 1],
    [200, 0],
  ];
  assert.equal(sampleCurve(curve, -1), 0);
  assert.equal(sampleCurve(curve, 50), 0.5);
  assert.equal(sampleCurve(curve, 1000), 0);
  assert.equal(vrmBlink(0), 0);
  assert.equal(vrmBlink(3165), 1);
  assert.equal(vrmBlink(3260), 0);
  assert.equal(vrmBlink(14300 + 3165), 1);
  for (let t = 0; t < 14300; t++) assert.ok(vrmBlink(t) >= 0 && vrmBlink(t) <= 1);
});
