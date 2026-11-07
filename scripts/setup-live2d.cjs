'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const url = 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js';
(async () => {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Live2D Core download failed: HTTP ${response.status}`);
  const script = await response.text();
  if (
    script.length > 2000000 ||
    !script.includes('Live2DCubismCore') ||
    !script.includes('Live2D Cubism Core')
  )
    throw new Error('Unexpected Live2D Core response; no file was installed.');
  const target = path.join(__dirname, '../public/vendor/live2dcubismcore.min.js');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, script);
  console.log('Live2D Core downloaded from Live2D. Restart the development app or rebuild for local use.');
  console.log(
    'The vendor runtime keeps its original license. See docs/THIRD_PARTY.md before redistribution.',
  );
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
