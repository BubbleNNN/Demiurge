'use strict';

// ZIP layout: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
// Callers must suspend ALL workspace writes until import returns and relaunch after success.
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { inflateRawSync } = require('node:zlib');
const { zipSync } = require('fflate');
const { validateState, MAX_FILE_BYTES } = require('./store.cjs');

const FORMAT = 'mori-workspace';
const VERSION = 1;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = MAX_TOTAL_BYTES + 32 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 10000;
const DIRECTORIES = ['models', 'pet-jobs', 'model-jobs', 'skin-assets'];
const TARGETS = ['state.json', ...DIRECTORIES, 'state.previous.json'];
const JOURNAL = '.workspace-import-journal.json';
const RECOVERY_MANIFEST = '.mori-recovery.json';
const activeRoots = new Set();
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const utf8 = new TextDecoder('utf-8', { fatal: true });
const fault = (detail) => new Error(`工作区备份无效：${detail}`);
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const canonical = (value) => value.normalize('NFC').toLowerCase();
function recoveryRequired(message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = 'MORI_RECOVERY_REQUIRED';
  error.recoveryRequired = true;
  return error;
}

function safePath(value, { directory = false, recovery = false } = {}) {
  if (
    typeof value !== 'string' ||
    !value ||
    Buffer.byteLength(value) > 1024 ||
    /[\\:%?#\x00-\x1f\x7f]/.test(value)
  )
    throw fault('不安全的文件路径。');
  const pieces = value.split('/');
  if (
    pieces.length > 24 ||
    pieces.some(
      (part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        /[. ]$/.test(part) ||
        Buffer.byteLength(part) > 240 ||
        /^(?:__proto__|prototype|constructor)$/i.test(part),
    )
  )
    throw fault('不安全的文件路径。');
  if (pieces[0] === 'state.json' || (recovery && pieces[0] === 'state.previous.json')) {
    if (pieces.length !== 1 || directory) throw fault('状态文件路径无效。');
  } else if (!DIRECTORIES.includes(pieces[0]) || (!directory && pieces.length < 2)) {
    throw fault('包含非工作区文件。');
  }
  return value;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function parseZip(input) {
  if (!(input instanceof Uint8Array) || input.byteLength < 22 || input.byteLength > MAX_ARCHIVE_BYTES)
    throw fault('ZIP 大小超出限制。');
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const end = bytes.length - 22;
  if (
    bytes.readUInt32LE(end) !== 0x06054b50 ||
    bytes.readUInt16LE(end + 20) !== 0 ||
    bytes.readUInt16LE(end + 4) !== 0 ||
    bytes.readUInt16LE(end + 6) !== 0
  )
    throw fault('只支持 Mori 生成的单卷 ZIP。');
  const count = bytes.readUInt16LE(end + 10);
  const centralSize = bytes.readUInt32LE(end + 12);
  const centralStart = bytes.readUInt32LE(end + 16);
  if (
    !count ||
    count > MAX_FILES + 1 ||
    count !== bytes.readUInt16LE(end + 8) ||
    centralStart + centralSize !== end
  )
    throw fault('ZIP 目录无效或文件过多。');
  const records = new Map();
  const names = new Set();
  const ranges = [];
  let offset = centralStart,
    total = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) throw fault('ZIP 目录截断。');
    const flags = bytes.readUInt16LE(offset + 8),
      method = bytes.readUInt16LE(offset + 10);
    const crc = bytes.readUInt32LE(offset + 16),
      compressed = bytes.readUInt32LE(offset + 20);
    const size = bytes.readUInt32LE(offset + 24),
      nameLength = bytes.readUInt16LE(offset + 28);
    const extra = bytes.readUInt16LE(offset + 30),
      comment = bytes.readUInt16LE(offset + 32);
    const attributes = bytes.readUInt32LE(offset + 38),
      local = bytes.readUInt32LE(offset + 42);
    if (
      flags & ~0x0806 ||
      ![0, 8].includes(method) ||
      extra ||
      comment ||
      bytes.readUInt16LE(offset + 6) > 20 ||
      bytes.readUInt16LE(offset + 34) !== 0 ||
      offset + 46 + nameLength > end ||
      !nameLength ||
      nameLength > 1024
    )
      throw fault('ZIP 使用了不支持或不安全的编码。');
    const mode = (attributes >>> 16) & 0o170000;
    if ((mode && mode !== 0o100000) || attributes & 0x10) throw fault('ZIP 不能包含符号链接或特殊文件。');
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
    let name;
    try {
      name = utf8.decode(nameBytes);
    } catch {
      throw fault('文件名不是有效 UTF-8。');
    }
    if (!(flags & 0x0800) && nameBytes.some((b) => b > 127)) throw fault('文件名编码不明确。');
    if (name !== 'manifest.json') safePath(name);
    if (names.has(canonical(name))) throw fault('ZIP 含重复或大小写冲突的文件。');
    names.add(canonical(name));
    const limit = name === 'manifest.json' ? MAX_MANIFEST_BYTES : MAX_FILE_BYTES;
    total += size;
    if (size > limit || total > MAX_TOTAL_BYTES + MAX_MANIFEST_BYTES || (method === 0 && compressed !== size))
      throw fault('解压后文件超出大小限制。');
    if (
      local + 30 > centralStart ||
      bytes.readUInt32LE(local) !== 0x04034b50 ||
      bytes.readUInt16LE(local + 4) !== bytes.readUInt16LE(offset + 6) ||
      bytes.readUInt16LE(local + 6) !== flags ||
      bytes.readUInt16LE(local + 8) !== method ||
      bytes.readUInt32LE(local + 14) !== crc ||
      bytes.readUInt32LE(local + 18) !== compressed ||
      bytes.readUInt32LE(local + 22) !== size ||
      bytes.readUInt16LE(local + 26) !== nameLength ||
      bytes.readUInt16LE(local + 28) !== 0
    )
      throw fault('ZIP 文件头和目录不一致。');
    const start = local + 30 + nameLength;
    if (start + compressed > centralStart || !bytes.subarray(local + 30, start).equals(nameBytes))
      throw fault('ZIP 文件范围或路径不一致。');
    ranges.push([local, start + compressed]);
    records.set(name, { name, size, compressed, method, crc, start });
    offset += 46 + nameLength;
  }
  if (offset !== end || !records.has('manifest.json') || !records.has('state.json'))
    throw fault('ZIP 缺少清单或状态。');
  let boundary = 0;
  for (const [start, finish] of ranges.sort((a, b) => a[0] - b[0])) {
    if (start !== boundary) throw fault('ZIP 包含重叠、隐藏或缺失的数据。');
    boundary = finish;
  }
  if (boundary !== centralStart) throw fault('ZIP 数据边界无效。');
  const extract = (name) => {
    const record = records.get(name);
    if (!record) throw fault(`缺少文件 ${name}。`);
    const packed = bytes.subarray(record.start, record.start + record.compressed);
    let result;
    try {
      if (!record.method) result = packed;
      else {
        const decoded = inflateRawSync(packed, { maxOutputLength: Math.max(1, record.size), info: true });
        if (decoded.engine.bytesWritten !== packed.length) throw fault('压缩流含多余数据。');
        result = decoded.buffer;
      }
    } catch {
      throw fault(`文件解压失败或超过声明大小：${name}。`);
    }
    if (result.length !== record.size || crc32(result) !== record.crc) throw fault(`文件校验失败：${name}。`);
    return result;
  };
  return { records, extract };
}

function validateManifest(value, { recovery = false } = {}) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.format !== (recovery ? 'mori-workspace-recovery' : FORMAT) ||
    value.version !== VERSION ||
    !Array.isArray(value.files) ||
    value.files.length > MAX_FILES ||
    !Array.isArray(value.directories) ||
    value.directories.length > MAX_FILES
  )
    throw fault('备份清单格式无效。');
  const seen = new Map();
  let size = 0;
  const files = value.files.map((entry) => {
    if (!entry || typeof entry !== 'object') throw fault('文件清单无效。');
    const name = safePath(entry.path, { recovery });
    if (
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0 ||
      entry.size > MAX_FILE_BYTES ||
      typeof entry.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(entry.sha256)
    )
      throw fault('文件清单校验值无效。');
    const key = canonical(name);
    if (seen.has(key)) throw fault('清单含重复或大小写冲突的路径。');
    seen.set(key, 'file');
    size += entry.size;
    return { path: name, size: entry.size, sha256: entry.sha256 };
  });
  if (size > MAX_TOTAL_BYTES + (recovery ? MAX_FILE_BYTES : 0)) throw fault('备份总大小超出限制。');
  const directories = value.directories.map((name) => {
    safePath(name, { directory: true, recovery });
    const key = canonical(name);
    if (seen.has(key)) throw fault('文件夹路径重复或与文件冲突。');
    seen.set(key, 'directory');
    return name;
  });
  for (const name of [...files.map((item) => item.path), ...directories]) {
    const pieces = name.split('/');
    for (let i = 1; i < pieces.length; i++)
      if (seen.get(canonical(pieces.slice(0, i).join('/'))) !== 'directory')
        throw fault('清单缺少父文件夹或存在路径冲突。');
  }
  if (!recovery && !files.some((entry) => entry.path === 'state.json')) throw fault('清单缺少状态文件。');
  return { files, directories, size };
}

function checkModelEntries(state, records) {
  for (const skin of state.skins) {
    // Stored animation atlases must travel with the state that refers to them.
    for (const source of [skin.images?.neutral, ...(skin.sprite?.pages || []).map((p) => p.src)]) {
      const stored = typeof source === 'string' && require('./skin-assets.cjs').ASSET.exec(source);
      if (stored && !records.has(`skin-assets/${stored[1]}.png`))
        throw fault(`备份缺少动画图集：${skin.name}。`);
    }
    if (!skin.model) continue;
    const name = safePath(`models/${skin.model.id}/${skin.model.entry}`);
    if (!records.has(name)) throw fault(`备份缺少角色模型入口：${skin.name}。`);
  }
}

function createWorkspaceBackup({ io = fs } = {}) {
  async function statMaybe(file) {
    try {
      return await io.lstat(file);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }
  async function directory(file, create = false) {
    if (create) await io.mkdir(file, { recursive: true, mode: 0o700 });
    const stat = await io.lstat(file);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw fault('工作区文件夹不能是符号链接。');
  }
  async function syncDirectory(dir) {
    const handle = await io.open(dir, constants.O_RDONLY);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  async function writeFile(file, bytes) {
    const handle = await io.open(
      file,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  async function readFile(file, limit = MAX_FILE_BYTES) {
    const stat = await io.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size > limit)
      throw fault('文件类型无效、含符号链接/硬链接或超过大小限制。');
    const handle = await io.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat();
      if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size)
        throw fault('备份过程中原文件发生变化。');
      const bytes = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) throw fault('备份过程中原文件被截断。');
        offset += bytesRead;
      }
      const tail = await handle.read(Buffer.alloc(1), 0, 1, offset);
      const final = await handle.stat();
      if (tail.bytesRead || final.mtimeMs !== opened.mtimeMs || final.size !== stat.size)
        throw fault('备份过程中原文件发生变化。');
      return bytes;
    } finally {
      await handle.close();
    }
  }
  async function json(file, limit) {
    try {
      return JSON.parse(utf8.decode(await readFile(file, limit)));
    } catch (error) {
      throw fault(`无法读取 ${path.basename(file)}：${error.message}`);
    }
  }
  async function durableJson(file, value) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, Buffer.from(JSON.stringify(value)));
      await io.rename(temporary, file);
      await syncDirectory(path.dirname(file));
    } finally {
      await io.rm(temporary, { force: true });
    }
  }
  async function withRoot(input, action) {
    if (typeof input !== 'string' || !input) throw fault('缺少工作区目录。');
    await directory(path.resolve(input), true);
    const root = await io.realpath(path.resolve(input));
    if (activeRoots.has(root)) throw new Error('工作区备份或恢复正在进行。');
    activeRoots.add(root);
    try {
      return await action(root);
    } finally {
      activeRoots.delete(root);
    }
  }
  async function inventory(root, targets, recovery = false) {
    const files = [],
      directories = [],
      present = {};
    let total = 0;
    async function visit(name) {
      const full = path.join(root, name);
      const stat = await io.lstat(full);
      if (stat.isSymbolicLink()) throw fault('工作区不能包含符号链接。');
      if (stat.isDirectory()) {
        safePath(name, { directory: true, recovery });
        directories.push(name);
        if (directories.length > MAX_FILES) throw fault('工作区文件夹数量过多。');
        for (const child of (await io.readdir(full)).sort()) await visit(`${name}/${child}`);
      } else {
        safePath(name, { recovery });
        if (!stat.isFile() || stat.nlink > 1 || stat.size > MAX_FILE_BYTES)
          throw fault('工作区含硬链接、特殊文件或过大文件。');
        files.push({ path: name, size: stat.size });
        total += stat.size;
        if (files.length > MAX_FILES || total > MAX_TOTAL_BYTES + (recovery ? MAX_FILE_BYTES : 0))
          throw fault('工作区超过备份容量限制。');
      }
    }
    for (const name of targets) {
      present[name] = Boolean(await statMaybe(path.join(root, name)));
      if (present[name]) await visit(name);
    }
    return { files, directories, present };
  }
  async function createDirectories(root, directories) {
    for (const name of [...directories].sort((a, b) => a.split('/').length - b.split('/').length))
      await io.mkdir(path.join(root, name), { recursive: true, mode: 0o700 });
  }
  async function syncTree(root, directories) {
    for (const name of [...directories].sort((a, b) => b.split('/').length - a.split('/').length))
      await syncDirectory(path.join(root, name));
    await syncDirectory(root);
  }
  async function snapshot(root, recoveryDir) {
    const listing = await inventory(root, TARGETS, true);
    await directory(recoveryDir, true);
    await createDirectories(recoveryDir, listing.directories);
    const files = [];
    for (const file of listing.files) {
      const bytes = await readFile(path.join(root, file.path));
      if (bytes.length !== file.size) throw fault('创建恢复副本时文件发生变化。');
      await writeFile(path.join(recoveryDir, file.path), bytes);
      files.push({ path: file.path, size: bytes.length, sha256: digest(bytes) });
    }
    const metadata = {
      format: 'mori-workspace-recovery',
      version: VERSION,
      createdAt: new Date().toISOString(),
      files,
      directories: listing.directories,
      present: listing.present,
    };
    validateManifest(metadata, { recovery: true });
    await durableJson(path.join(recoveryDir, RECOVERY_MANIFEST), metadata);
    await syncTree(recoveryDir, listing.directories);
    await syncDirectory(root);
    return metadata;
  }
  async function readJournal(root) {
    if (!(await statMaybe(path.join(root, JOURNAL)))) return null;
    let value;
    try {
      value = await json(path.join(root, JOURNAL), 16384);
    } catch (error) {
      throw recoveryRequired('恢复事务日志无法读取；为保护本机数据，已停止写入。', error);
    }
    if (
      value?.format !== 'mori-workspace-import' ||
      value.version !== VERSION ||
      !/^[a-f0-9-]{36}$/.test(value.id) ||
      !['installing', 'committed'].includes(value.phase) ||
      value.staging !== `.workspace-import-${value.id}` ||
      typeof value.recovery !== 'string' ||
      !new RegExp(`^recovery-[0-9]{13}-${value.id}$`).test(value.recovery)
    )
      throw recoveryRequired('恢复事务日志无效；为保护本机数据，已停止写入。');
    return value;
  }
  async function cleanupCommitted(root, journal) {
    const staging = path.join(root, journal.staging);
    try {
      if (await statMaybe(staging)) {
        await directory(staging);
        await io.rm(staging, { recursive: true, force: true });
      }
      await io.unlink(path.join(root, JOURNAL));
      await syncDirectory(root);
      return { status: 'committed', recoveryDirectory: path.join(root, journal.recovery) };
    } catch (error) {
      return {
        status: 'committed',
        recoveryDirectory: path.join(root, journal.recovery),
        cleanupPending: true,
        warning: `工作区已恢复，临时文件清理将在下次启动重试：${error.message}`,
      };
    }
  }
  async function rollback(root, journal) {
    const recoveryDir = path.join(root, journal.recovery);
    await directory(recoveryDir);
    const metadata = await json(path.join(recoveryDir, RECOVERY_MANIFEST), MAX_MANIFEST_BYTES);
    const validated = validateManifest(metadata, { recovery: true });
    if (!metadata.present || TARGETS.some((name) => typeof metadata.present[name] !== 'boolean'))
      throw fault('恢复副本缺少原工作区清单。');
    const actual = await inventory(recoveryDir, TARGETS, true);
    if (
      JSON.stringify(actual.present) !==
        JSON.stringify(Object.fromEntries(TARGETS.map((name) => [name, metadata.present[name]]))) ||
      actual.files.length !== validated.files.length ||
      actual.directories.length !== validated.directories.length ||
      actual.directories.some((name) => !validated.directories.includes(name))
    )
      throw fault('恢复副本不完整，未改动当前文件。');
    const records = new Map(validated.files.map((entry) => [entry.path, entry]));
    for (const file of actual.files) {
      const expected = records.get(file.path);
      if (
        !expected ||
        file.size !== expected.size ||
        digest(await readFile(path.join(recoveryDir, file.path))) !== expected.sha256
      )
        throw fault('恢复副本校验失败，未改动当前文件。');
    }
    const staging = path.join(root, journal.staging);
    await directory(staging, true);
    const restore = path.join(staging, 'rollback');
    await io.rm(restore, { recursive: true, force: true });
    await directory(restore, true);
    await createDirectories(restore, validated.directories);
    for (const file of validated.files) {
      const bytes = await readFile(path.join(recoveryDir, file.path));
      if (digest(bytes) !== file.sha256) throw fault('恢复副本在回滚期间发生变化。');
      await writeFile(path.join(restore, file.path), bytes);
    }
    await syncTree(restore, validated.directories);
    for (const name of TARGETS) {
      await io.rm(path.join(root, name), { recursive: true, force: true });
      if (metadata.present[name]) await io.rename(path.join(restore, name), path.join(root, name));
      await syncDirectory(root);
    }
    // Keep the durable journal until every original target is back. Repeating rollback is safe.
    await io.unlink(path.join(root, JOURNAL));
    await syncDirectory(root);
    let cleanupPending = false;
    try {
      await io.rm(staging, { recursive: true, force: true });
    } catch {
      cleanupPending = true;
    }
    return {
      status: 'rolled-back',
      recoveryDirectory: recoveryDir,
      ...(cleanupPending ? { cleanupPending: true } : {}),
    };
  }
  async function recover(root) {
    const journal = await readJournal(root);
    if (!journal) return { status: 'none' };
    if (journal.phase === 'committed') return cleanupCommitted(root, journal);
    try {
      return await rollback(root, journal);
    } catch (error) {
      throw recoveryRequired(`工作区回滚尚未完成，已停止写入。${error.message}`, error);
    }
  }
  async function exportWorkspace(input, state) {
    return withRoot(input, async (root) => {
      if (await readJournal(root)) throw recoveryRequired('请先恢复上次中断的工作区导入。');
      const clean = validateState(state);
      const stateBytes = Buffer.from(JSON.stringify(clean));
      if (stateBytes.length > MAX_FILE_BYTES) throw fault('状态文件过大。');
      const listing = await inventory(root, DIRECTORIES);
      const files = [{ path: 'state.json', size: stateBytes.length, sha256: digest(stateBytes) }];
      const archive = Object.create(null);
      archive['state.json'] = stateBytes;
      for (const file of listing.files) {
        const bytes = await readFile(path.join(root, file.path));
        if (bytes.length !== file.size) throw fault('备份期间文件发生变化。');
        files.push({ path: file.path, size: bytes.length, sha256: digest(bytes) });
        archive[file.path] = bytes;
      }
      const manifest = {
        format: FORMAT,
        version: VERSION,
        createdAt: new Date().toISOString(),
        files,
        directories: listing.directories,
      };
      validateManifest(manifest);
      checkModelEntries(clean, new Map(files.map((entry) => [entry.path, entry])));
      const manifestBytes = Buffer.from(JSON.stringify(manifest));
      if (manifestBytes.length > MAX_MANIFEST_BYTES) throw fault('备份清单过大。');
      archive['manifest.json'] = manifestBytes;
      const bytes = Buffer.from(zipSync(archive, { level: 6, os: 3, attrs: (0o100600 << 16) >>> 0 }));
      if (bytes.length > MAX_ARCHIVE_BYTES) throw fault('ZIP 超过容量限制。');
      return bytes;
    });
  }
  async function importWorkspace(input, bytes) {
    // Parse all ZIP headers before creating any staging files or touching a workspace.
    const zip = parseZip(bytes);
    let metadata;
    try {
      metadata = JSON.parse(utf8.decode(zip.extract('manifest.json')));
    } catch (error) {
      throw fault(`清单无法读取：${error.message}`);
    }
    const manifest = validateManifest(metadata);
    if (
      zip.records.size !== manifest.files.length + 1 ||
      manifest.files.some((entry) => zip.records.get(entry.path)?.size !== entry.size)
    )
      throw fault('清单与 ZIP 文件集合不一致。');
    const stateEntry = manifest.files.find((entry) => entry.path === 'state.json');
    const stateBytes = zip.extract('state.json');
    if (digest(stateBytes) !== stateEntry.sha256) throw fault('状态文件 SHA-256 不匹配。');
    let state;
    try {
      state = validateState(JSON.parse(utf8.decode(stateBytes)));
    } catch (error) {
      throw fault(`角色与聊天数据不合法：${error.message}`);
    }
    checkModelEntries(state, zip.records);
    return withRoot(input, async (root) => {
      const previous = await recover(root);
      if (previous.cleanupPending || (await readJournal(root)))
        throw new Error('上次恢复尚未完成清理，请重启后再试。');
      const id = randomUUID();
      const journal = {
        format: 'mori-workspace-import',
        version: VERSION,
        id,
        phase: 'installing',
        staging: `.workspace-import-${id}`,
        recovery: `recovery-${Date.now()}-${id}`,
      };
      const staging = path.join(root, journal.staging);
      const incoming = path.join(staging, 'incoming');
      const displaced = path.join(staging, 'displaced');
      let published = false,
        committed = false;
      try {
        await directory(incoming, true);
        await directory(displaced, true);
        const directories = [...new Set([...DIRECTORIES, ...manifest.directories])];
        await createDirectories(incoming, directories);
        for (const entry of manifest.files) {
          const content = zip.extract(entry.path);
          if (digest(content) !== entry.sha256) throw fault(`SHA-256 不匹配：${entry.path}。`);
          // validateState strips unrecognized fields, including accidental credential-shaped extras.
          await writeFile(
            path.join(incoming, entry.path),
            entry.path === 'state.json' ? Buffer.from(JSON.stringify(state)) : content,
          );
        }
        await writeFile(path.join(incoming, 'state.previous.json'), Buffer.from(JSON.stringify(state)));
        await syncTree(incoming, directories);
        await snapshot(root, path.join(root, journal.recovery));
        await syncDirectory(staging);
        await durableJson(path.join(root, JOURNAL), journal);
        published = true;
        for (const name of TARGETS) {
          if (await statMaybe(path.join(root, name)))
            await io.rename(path.join(root, name), path.join(displaced, name));
          await io.rename(path.join(incoming, name), path.join(root, name));
          await syncDirectory(root);
          await syncDirectory(incoming);
          await syncDirectory(displaced);
        }
        await durableJson(path.join(root, JOURNAL), { ...journal, phase: 'committed' });
        committed = true;
      } catch (error) {
        // A rename may have succeeded before a subsequent directory fsync failed.
        const onDisk = await readJournal(root);
        if (onDisk?.id === id && onDisk.phase === 'committed') committed = true;
        else if (published || onDisk?.id === id) {
          try {
            await rollback(root, onDisk || journal);
          } catch (restoreError) {
            throw recoveryRequired(
              `工作区恢复中断，自动回滚尚未完成。请重启 Mori 继续恢复；原数据仍在 ${journal.recovery}。${restoreError.message}`,
              error,
            );
          }
        } else {
          await io.rm(staging, { recursive: true, force: true }).catch(() => {});
          await io.rm(path.join(root, journal.recovery), { recursive: true, force: true }).catch(() => {});
        }
        if (!committed) throw error;
      }
      const result = await cleanupCommitted(root, journal);
      return {
        ...result,
        state,
        fileCount: manifest.files.length,
        totalBytes: manifest.size,
        requiresRelaunch: true,
      };
    });
  }
  return { exportWorkspace, importWorkspace, recoverInterruptedImport: (root) => withRoot(root, recover) };
}

module.exports = {
  ...createWorkspaceBackup(),
  createWorkspaceBackup,
  FORMAT,
  VERSION,
  MAX_TOTAL_BYTES,
  MAX_ARCHIVE_BYTES,
  MAX_FILES,
  JOURNAL,
};
