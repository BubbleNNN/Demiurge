'use strict';
// Config and review files contain artwork decisions; no character, style,
// limb count or bad-frame exceptions live in this release tool.
const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { readPoses, compileAtlas } = require('./lib/pose-atlas.cjs');
const { assertPoseRelease, animationDigest } = require('../electron/animation-quality.cjs');
const root = path.resolve(__dirname, '..');
const configFile = process.env.MORI_MOTION_SOURCE || process.argv[2];
app
  .whenReady()
  .then(() => {
    if (!configFile) throw new Error('Supply a motion source manifest');
    const config = JSON.parse(fs.readFileSync(path.resolve(root, configFile), 'utf8'));
    const inspect = process.argv.includes('--inspect');
    const review = inspect ? {} : JSON.parse(fs.readFileSync(path.resolve(root, config.reviewFile), 'utf8'));
    // Check all reviews before changing any published file.
    const entries = config.entries.map((definition) => {
      const poses = readPoses(definition, root, nativeImage);
      if (!inspect) assertPoseRelease(poses, review.entries?.[definition.builtin]);
      const compiled = compileAtlas(definition, poses, nativeImage);
      if (!inspect && review.animations?.[definition.builtin] !== animationDigest(compiled.animation))
        throw new Error('动画裁切或时序已变化，必须重新核对后发布。');
      return { definition, compiled };
    });
    const metadata = entries.map(({ definition, compiled }) => ({
      builtin: definition.builtin,
      style: definition.style,
      file: definition.file,
      animation: compiled.animation,
      sha256: compiled.sha256,
      bytes: compiled.bytes.length,
      poses: compiled.poses,
      footRegistration: 'translation; one native sampling density per source group',
    }));
    if (inspect) {
      fs.writeFileSync(
        path.resolve(root, config.inspectionFile),
        JSON.stringify({ entries: metadata }, null, 2) + '\n',
      );
    } else {
      for (const { definition, compiled } of entries)
        fs.writeFileSync(path.resolve(root, 'public/art', definition.file), compiled.bytes);
      fs.writeFileSync(
        path.resolve(root, config.outputFile),
        JSON.stringify({ entries: metadata, reviewFile: config.reviewFile }, null, 2) + '\n',
      );
    }
    console.log(
      JSON.stringify({
        inspected: inspect,
        styles: metadata.map((e) => ({ style: e.style, frames: e.animation.frames.length, bytes: e.bytes })),
      }),
    );
    app.exit(0);
  })
  .catch((error) => {
    console.error(error.stack);
    app.exit(1);
  });
