'use strict';
// Local Codex provider: runs the user's own `codex` CLI with their ChatGPT login.
// Executable lookup and login-shell environment recovery are adapted from Anime Codex (MIT, see THIRD_PARTY).
// Each request is a fresh, ephemeral, read-only session in an empty temporary directory.
// Shell, apps, plugins, browser, computer use and image tools are disabled; any other tool
// event stops the run. Web search is enabled only for research requests.
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { createInterface } = require('node:readline');

const MACH_O = new Set([
  'feedface',
  'cefaedfe',
  'feedfacf',
  'cffaedfe',
  'cafebabe',
  'bebafeca',
  'cafebabf',
  'bfbafeca',
]);
const DISABLED_FEATURES = [
  'shell_tool',
  'unified_exec',
  'apps',
  'hooks',
  'plugins',
  'memories',
  'multi_agent',
  'multi_agent_v2',
  'browser_use',
  'browser_use_external',
  'computer_use',
  'image_generation',
];
const EFFORTS = ['minimal', 'low', 'medium', 'high'];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// Never invoke a shell, npm shim or project-relative executable.
async function isCodexExecutable(file, fsApi = fs) {
  if (!file || !path.isAbsolute(file)) return false;
  try {
    if (!(await fsApi.stat(file)).isFile()) return false;
    await fsApi.access(file, constants.X_OK);
    const handle = await fsApi.open(file, 'r');
    try {
      const { buffer, bytesRead } = await handle.read(Buffer.alloc(4), 0, 4, 0);
      return bytesRead === 4 && MACH_O.has(buffer.toString('hex'));
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

async function resolveCodex({ env = process.env, home = os.homedir(), fsApi = fs } = {}) {
  if (env.CODEX_PATH) {
    if (await isCodexExecutable(env.CODEX_PATH, fsApi)) return env.CODEX_PATH;
    throw new Error('CODEX_PATH 指向的文件不是可用的 Codex 程序。');
  }
  // Finder launches do not inherit an interactive shell's PATH.
  const candidates = [
    ...(env.PATH || '')
      .split(':')
      .filter((entry) => path.isAbsolute(entry))
      .map((entry) => path.join(entry, 'codex')),
    path.join(home, '.local/bin/codex'),
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    '/Applications/Codex.app/Contents/Resources/codex',
    '/Applications/ChatGPT.app/Contents/Resources/codex',
    path.join(home, 'Applications/Codex.app/Contents/Resources/codex'),
    path.join(home, 'Applications/ChatGPT.app/Contents/Resources/codex'),
  ];
  for (const candidate of candidates) if (await isCodexExecutable(candidate, fsApi)) return candidate;
  throw new Error('未找到本机 Codex。请先安装 Codex 并在终端运行 codex login 登录 ChatGPT。');
}

// Recover the exported environment of a new login terminal (PATH, proxy settings).
// The output can contain credentials, so it is parsed and never logged.
async function loginEnvironment({ env = process.env, run = require('node:util').promisify(execFile) } = {}) {
  if (process.platform === 'win32') return { ...env };
  const shell = env.SHELL && path.isAbsolute(env.SHELL) ? env.SHELL : '/bin/zsh';
  const marker = 'MORI_CODEX_ENV_START\0';
  try {
    const { stdout } = await run(shell, ['-ilc', "printf 'MORI_CODEX_ENV_START\\0'; /usr/bin/env -0"], {
      env: { ...env },
      cwd: os.homedir(),
      timeout: 15000,
      maxBuffer: 4 * 1024 * 1024,
      encoding: 'utf8',
    });
    const offset = stdout.indexOf(marker);
    if (offset < 0) return { ...env };
    const result = {};
    for (const entry of stdout.slice(offset + marker.length).split('\0')) {
      const i = entry.indexOf('=');
      if (i > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.slice(0, i)))
        result[entry.slice(0, i)] = entry.slice(i + 1);
    }
    return result.HOME ? result : { ...env };
  } catch {
    return { ...env };
  }
}

function codexArgs({
  directory,
  schemaFile,
  images = [],
  search = false,
  generateImage = false,
  effort = 'low',
  model = '',
}) {
  const args = [
    'exec',
    '--ignore-user-config',
    '--ignore-rules',
    '--skip-git-repo-check',
    '--ephemeral',
    '--json',
    '--sandbox',
    'read-only',
    '-C',
    directory,
  ];
  // Codex routes web search and image generation through its code-mode host; keep that host,
  // and the image tool itself, only for the requests that need them.
  const disabled = DISABLED_FEATURES.filter((feature) => !(generateImage && feature === 'image_generation'));
  if (!search && !generateImage) disabled.push('code_mode_host');
  for (const feature of disabled) args.push('--disable', feature);
  for (const setting of [
    `web_search=${search ? '"live"' : '"disabled"'}`,
    'mcp_servers={}',
    `model_reasoning_effort=${JSON.stringify(EFFORTS.includes(effort) ? effort : 'low')}`,
    'project_doc_max_bytes=0',
    'forced_login_method="chatgpt"',
    'approval_policy="never"',
  ])
    args.push('-c', setting);
  if (model) args.push('--model', model);
  if (schemaFile) args.push('--output-schema', schemaFile);
  for (const image of images) args.push('--image', image);
  args.push('-');
  return args;
}

function describeFailure(message, stderr) {
  const evidence = `${message || ''}\n${stderr || ''}`;
  if (
    /not logged in|login required|please log ?in|unauthori[sz]ed|\b401\b|forced_login_method/i.test(evidence)
  )
    return '本机 Codex 尚未用 ChatGPT 登录。请在终端运行 codex login，选择 ChatGPT 账号登录后重试。';
  if (/usage limit|rate limit|quota|\b429\b|too many requests/i.test(evidence))
    return '本机 Codex 的使用额度暂时用完或受限，请稍后再试。';
  if (/model .*(not|unsupported|does not exist)|unknown model/i.test(evidence))
    return '本机 Codex 不支持所填写的模型 ID。可以清空模型 ID，使用 Codex 默认模型。';
  return message ? `本机 Codex 请求失败：${String(message).slice(0, 300)}` : '本机 Codex 没有返回完整结果。';
}

function imageFile(source, index) {
  const match = /^data:(image\/(png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(source || ''));
  if (!match) throw new Error('本机 Codex 只接收应用内的 PNG、JPEG、WebP 或 GIF 原图。');
  const bytes = Buffer.from(match[3], 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('参考图过大，无法交给本机 Codex。');
  return { name: `reference-${index + 1}.${match[2] === 'jpeg' ? 'jpg' : match[2]}`, bytes };
}

// Codex saves generated pictures itself, under its home folder, in a folder named after the session.
function generatedImagesRoot(env) {
  const home =
    env.CODEX_HOME && path.isAbsolute(env.CODEX_HOME)
      ? env.CODEX_HOME
      : path.join(env.HOME || os.homedir(), '.codex');
  return path.join(home, 'generated_images');
}

async function collectGenerated(root, threadId) {
  if (!/^[0-9a-f][0-9a-f-]{15,63}$/i.test(threadId || '')) return [];
  const folder = path.join(root, threadId);
  let names;
  try {
    names = await fs.readdir(folder);
  } catch {
    return [];
  }
  const files = [];
  for (const name of names.filter((entry) => /\.png$/i.test(entry))) {
    const file = path.join(folder, name);
    const stat = await fs.stat(file).catch(() => null);
    if (stat?.isFile() && stat.size > 0 && stat.size <= MAX_IMAGE_BYTES)
      files.push({ file, time: stat.mtimeMs });
  }
  files.sort((a, b) => a.time - b.time);
  const images = [];
  for (const { file } of files) images.push(await fs.readFile(file));
  // This ephemeral session's pictures now live in Mori's workspace; do not leave copies behind.
  await fs.rm(folder, { recursive: true, force: true }).catch(() => {});
  return images;
}

function createCodex({
  codexHome = '',
  spawnFn = spawn,
  environment = loginEnvironment,
  resolve = resolveCodex,
  tmpdir = os.tmpdir,
  imagesRoot = generatedImagesRoot,
  referenceCodec,
} = {}) {
  if (typeof codexHome !== 'string' || (codexHome && !path.isAbsolute(codexHome)))
    throw new Error('Codex 账号目录必须是绝对路径。');
  let ready = null;
  async function prepare() {
    ready ??= (async () => {
      const env = { ...(await environment()) };
      if (codexHome) {
        await fs.access(path.join(codexHome, 'auth.json'), constants.R_OK);
        env.CODEX_HOME = codexHome;
      }
      // The subscription login is the point of this provider; never fall back to API-key billing.
      delete env.OPENAI_API_KEY;
      delete env.CODEX_API_KEY;
      delete env.CODEX_ACCESS_TOKEN;
      return { env, executable: await resolve({ env }) };
    })().catch((error) => {
      ready = null;
      throw error;
    });
    return ready;
  }

  async function run({
    prompt,
    schema,
    images = [],
    search = false,
    generateImage = false,
    effort = 'low',
    model = '',
    signal,
    timeout = 120000,
  }) {
    signal?.throwIfAborted?.();
    const { env, executable } = await prepare();
    const directory = await fs.mkdtemp(path.join(tmpdir(), 'mori-codex-'));
    try {
      let schemaFile;
      if (schema) {
        schemaFile = path.join(directory, 'result-schema.json');
        await fs.writeFile(schemaFile, JSON.stringify(schema));
      }
      const inputImages = images.map(imageFile);
      const references = generateImage
        ? require('./image-reference-budget.cjs').fitImageReferenceBudget(inputImages, referenceCodec)
        : { sources: inputImages, mapping: '' };
      const imageFiles = [];
      for (const { name, bytes } of references.sources) {
        const file = path.join(directory, name);
        await fs.writeFile(file, bytes);
        imageFiles.push(file);
      }
      const args = codexArgs({
        directory,
        schemaFile,
        images: imageFiles,
        search,
        generateImage,
        effort,
        model,
      });
      if (codexHome) args.unshift('-c', 'cli_auth_credentials_store="file"');
      return await new Promise((resolvePromise, reject) => {
        const child = spawnFn(executable, args, {
          cwd: directory,
          env,
          shell: false,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        const results = [];
        const queries = [];
        let threadId = '';
        let text = '',
          complete = false,
          failed = '',
          stderr = '',
          settled = false;
        const finish = (error, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener?.('abort', abort);
          if (error) {
            child.kill();
            setTimeout(() => {
              if (child.exitCode === null) child.kill('SIGKILL');
            }, 2000).unref?.();
            reject(error);
          } else resolvePromise(value);
        };
        const abort = () => finish(new Error('已停止等待本机 Codex。'));
        const timer = setTimeout(() => finish(new Error('本机 Codex 响应超时，请稍后重试。')), timeout);
        signal?.addEventListener?.('abort', abort, { once: true });
        child.on('error', (error) =>
          finish(
            new Error(
              error.code === 'ENOENT' ? '未找到本机 Codex。' : `无法启动本机 Codex：${error.message}`,
            ),
          ),
        );
        child.stdin.on('error', () => {});
        child.stderr.on('data', (chunk) => {
          stderr = (stderr + chunk).slice(-4000);
        });
        createInterface({ input: child.stdout }).on('line', (line) => {
          let event;
          try {
            event = JSON.parse(line);
          } catch {
            return;
          }
          if (event.type === 'thread.started' && typeof event.thread_id === 'string')
            threadId = event.thread_id;
          if (event.type === 'turn.completed') complete = true;
          if (event.type === 'turn.failed') failed = event.error?.message || '本机 Codex 回合失败。';
          if (event.type === 'error')
            failed = event.message || event.error?.message || '本机 Codex 返回错误。';
          const item = event.item;
          if (!item) return;
          const allowed = [
            'agent_message',
            'reasoning',
            'error',
            ...(search ? ['web_search'] : []),
            ...(generateImage ? ['image_generation', 'image_generation_call', 'imageGeneration'] : []),
          ];
          if (!allowed.includes(item.type))
            return finish(
              new Error('本机 Codex 尝试调用未允许的工具，已停止。Demiurge 只使用对话、网页搜索与图像生成。'),
            );
          if (event.type !== 'item.completed') return;
          if (item.type === 'agent_message' && typeof item.text === 'string') text = item.text;
          if (item.type === 'web_search') {
            if (item.query) queries.push(String(item.query).slice(0, 300));
            for (const hit of Array.isArray(item.results) ? item.results : [])
              if (typeof hit?.url === 'string')
                results.push({
                  title: String(hit.title || '').slice(0, 300),
                  url: hit.url,
                  snippet: String(hit.snippet || '').slice(0, 2000),
                  ...(typeof hit.image_url === 'string' ? { image_url: hit.image_url } : {}),
                  ...(typeof hit.img_src === 'string' ? { img_src: hit.img_src } : {}),
                });
          }
        });
        child.on('close', async (code) => {
          if (code !== 0 || failed || !complete || (!generateImage && !text.trim()))
            return finish(new Error(describeFailure(failed, code !== 0 ? stderr : '')));
          if (!generateImage) return finish(null, { text, results, queries });
          const generated = await collectGenerated(imagesRoot(env), threadId).catch(() => []);
          if (!generated.length)
            return finish(
              new Error(
                `本机 Codex 没有生成图像。请确认你的 ChatGPT 账号可以在 Codex 中生成图像，或稍后重试。${
                  text.trim() ? `Codex 说明：${text.trim().slice(0, 160)}` : ''
                }`,
              ),
            );
          finish(null, { text, results, queries, images: generated });
        });
        child.stdin.end(generateImage && imageFiles.length
          ? `${prompt}\n\n${references.mapping}\nImage tool reference contract: the ${imageFiles.length} reference attachments are already saved at these local paths, in order: ${JSON.stringify(imageFiles)}. The image tool accepts at most five reference paths; this list already fits that limit. Pass ALL of these paths to the image generation tool as referenced_image_paths (or its equivalent reference-image input). Looking at the attachments and describing them in text is not sufficient. Do not generate an unreferenced image or omit any listed attachment.`
          : prompt);
      });
    } finally {
      await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    }
  }

  async function status() {
    const { env, executable } = await prepare();
    const { stdout, stderr } = await require('node:util')
      .promisify(execFile)(executable, [...(codexHome ? ['-c', 'cli_auth_credentials_store="file"'] : []), 'login', 'status'], { env, timeout: 15000, encoding: 'utf8' })
      .catch((error) => ({ stdout: error.stdout || '', stderr: error.stderr || '' }));
    const output = `${stdout}\n${stderr}`;
    return {
      executable,
      chatgpt: /ChatGPT/i.test(output),
      loggedIn: /logged in/i.test(output) && !/not logged in/i.test(output),
    };
  }

  return { run, status };
}

module.exports = { createCodex, codexArgs, resolveCodex, isCodexExecutable, describeFailure };
