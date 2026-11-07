'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const features = require('../shared/features.json');
const args = process.argv.slice(2).filter((arg) => arg !== '--');
let feature;
if (args.length) {
  feature =
    args.length === 2 && args[0] === '--module'
      ? features.find((item) => item.module === args[1])
      : undefined;
  if (!feature) {
    console.error(`Usage: pnpm desktop --module <${features.map((item) => item.module).join('|')}>`);
    process.exit(1);
  }
}
const devUrl = 'http://127.0.0.1:5173';
let electron;
let stopping = false;
const token = randomUUID();
const vite = spawn(
  process.execPath,
  [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1'],
  { cwd: root, stdio: 'inherit', env: { ...process.env, MORI_DEV_TOKEN: token } },
);
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  vite.kill();
  electron?.kill();
  process.exitCode = code;
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
vite.on('error', (error) => {
  console.error(error.message);
  stop(1);
});
vite.on('exit', (code) => {
  if (!stopping) stop(code || 1);
});
(async () => {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (stopping) return;
    try {
      const response = await fetch(`${devUrl}/__mori_ready`, { signal: AbortSignal.timeout(500) });
      if (response.ok && (await response.text()) === token) break;
    } catch {
      /* server is booting */
    }
    if (attempt === 79) throw new Error('Vite did not start on port 5173.');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (stopping) return;
  const executable = require('electron');
  const env = {
    ...process.env,
    MORI_DEV_URL: devUrl,
    MORI_DEV_VIEW: feature?.id || 'home',
    MORI_DATA_DIR: process.env.MORI_DATA_DIR || path.join(root, '.local/development-v2'),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  electron = spawn(executable, [root], { cwd: root, stdio: 'inherit', env });
  electron.on('error', (error) => {
    console.error(error.message);
    stop(1);
  });
  electron.on('exit', (code) => stop(code || 0));
})().catch((error) => {
  console.error(error.message);
  stop(1);
});
