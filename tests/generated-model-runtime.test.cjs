'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const exportsObject = {};
new Function(
  'exports',
  ts.transpileModule(fs.readFileSync('src/animation/model.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText,
)(exportsObject);

test('head gestures resolve real GLTF bones after loader name sanitization and ignore ordinary meshes', async () => {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const { Bone, Object3D } = await import('three');
  const gltf = await new GLTFLoader().parseAsync(
    JSON.stringify({
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: 'mixamorig:Head' }],
      skins: [{ joints: [0] }],
    }),
    '',
  );
  const bone = exportsObject.mappedBone(gltf.scene, 'mixamorig:Head');
  assert.ok(bone instanceof Bone);
  assert.notEqual(bone.name, 'mixamorig:Head');
  assert.equal(bone.userData.name, 'mixamorig:Head');
  const ordinary = new Object3D();
  ordinary.name = 'Head';
  gltf.scene.add(ordinary);
  assert.equal(exportsObject.mappedBone(gltf.scene, 'Head'), undefined);
  assert.equal(exportsObject.mappedBone(gltf.scene, 'NoSuchJoint'), undefined);
  assert.equal(exportsObject.mappedBone(gltf.scene), undefined);
});
