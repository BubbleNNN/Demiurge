'use strict';
// The community catalogue: desktop pets and plugins people share, kept in the project's GitHub
// repository under community/. The app only reads it: it downloads the index and the files the
// index names, checks each one against its recorded size and SHA-256, and validates it exactly
// like a local import. Plugins are data (a behaviour profile and lines for a character, or for
// every character), never code. Sharing goes through GitHub: an issue with the exported pack, or
// a pull request adding it to community/ (see community/README.md).
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const REGISTRIES = [
  'https://raw.githubusercontent.com/BubbleNNN/Demiurge/main/community/',
  // Before the repository was renamed.
  'https://raw.githubusercontent.com/BubbleNNN/Mori/main/community/',
];
const SHARE_URL = 'https://github.com/BubbleNNN/Demiurge/issues/new?template=share-pet.yml';
const INDEX_BYTES = 512 * 1024;
const PLUGIN_BYTES = 64 * 1024;
const PLUGIN_KINDS = ['behavior'];

const fail = (message) => {
  throw new Error(message);
};
const text = (value, max, label, optional = true) => {
  if (value === undefined && optional) return '';
  if (typeof value !== 'string' || value.length > max) fail(`社区目录中的${label}无效。`);
  return value.trim();
};
const ident = (value, label) => {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(value))
    fail(`社区目录中的${label}无效。`);
  return value;
};
// Paths stay inside the catalogue folder: plain relative names, no "..", no absolute or URL forms.
const relative = (value, label) => {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9/_.-]{0,200}$/i.test(value) || value.includes('..'))
    fail(`社区目录中的${label}路径无效。`);
  return value;
};
function entry(value, kind) {
  if (!value || typeof value !== 'object') fail('社区目录条目无效。');
  const out = {
    id: ident(value.id, '编号'),
    name: text(value.name, 80, '名称', false),
    author: text(value.author, 80, '作者'),
    description: text(value.description, 400, '介绍'),
    license: text(value.license, 120, '授权说明'),
    path: relative(value.path, '文件'),
    size: Number.isInteger(value.size) && value.size > 0 ? value.size : fail('社区目录中的文件大小无效。'),
    sha256:
      typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256)
        ? value.sha256
        : fail('社区目录中的校验值无效。'),
  };
  if (kind === 'pet') {
    out.work = text(value.work, 120, '作品');
    if (value.preview !== undefined) out.preview = relative(value.preview, '预览图');
  } else {
    out.kind = PLUGIN_KINDS.includes(value.kind) ? value.kind : fail('社区目录中的插件类型无效。');
  }
  return out;
}
function validateIndex(value) {
  if (!value || typeof value !== 'object' || value.version !== 1) fail('社区目录版本不受支持。');
  const pets = Array.isArray(value.pets) ? value.pets.slice(0, 500).map((p) => entry(p, 'pet')) : [];
  const plugins = Array.isArray(value.plugins)
    ? value.plugins.slice(0, 500).map((p) => entry(p, 'plugin'))
    : [];
  for (const list of [pets, plugins])
    if (new Set(list.map((item) => item.id)).size !== list.length) fail('社区目录中有重复的编号。');
  return { version: 1, updated: text(value.updated, 40, '更新时间'), pets, plugins };
}

/** A plugin as installed: a behaviour profile (and lines) for one character or for all of them. */
function validatePlugin(value, validateDesktopProfile) {
  if (!value || typeof value !== 'object' || value.version !== 1) fail('插件版本不受支持。');
  const kind = PLUGIN_KINDS.includes(value.kind) ? value.kind : fail('插件类型不受支持（只接受数据插件）。');
  const target = value.target === 'all' ? 'all' : text(value.target, 128, '适用角色', false);
  return {
    version: 1,
    id: ident(value.id, '插件编号'),
    name: text(value.name, 80, '插件名称', false),
    author: text(value.author, 80, '插件作者'),
    description: text(value.description, 400, '插件介绍'),
    kind,
    target,
    profile: validateDesktopProfile(value.profile, 'plugin.profile'),
  };
}

function createCommunity({ fetch, dir, validateBundle, validateDesktopProfile }) {
  const installedFile = () => path.join(dir, 'plugins.json');
  async function get(url, limit) {
    const response = await fetch(url, { headers: { Accept: 'application/json, image/png' } });
    if (!response.ok) fail(`社区目录暂时无法访问（${response.status}）。`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > limit) fail('社区目录中的文件超过大小上限。');
    return bytes;
  }
  async function index() {
    let lastError;
    for (const base of REGISTRIES) {
      try {
        return {
          base,
          catalogue: validateIndex(
            JSON.parse((await get(`${base}index.json`, INDEX_BYTES)).toString('utf8')),
          ),
        };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('社区目录暂时无法访问。');
  }
  // A file the index names, checked against the size and digest the index records for it.
  async function file(base, item, limit) {
    if (item.size > limit) fail('社区目录中的文件超过大小上限。');
    const bytes = await get(`${base}${item.path}`, limit);
    if (bytes.length !== item.size || crypto.createHash('sha256').update(bytes).digest('hex') !== item.sha256)
      fail('下载的文件与社区目录记录不一致，已停止使用。');
    return bytes;
  }
  async function installed() {
    try {
      const value = JSON.parse(await fs.readFile(installedFile(), 'utf8'));
      return Array.isArray(value)
        ? value.flatMap((p) => {
            try {
              return [validatePlugin(p, validateDesktopProfile)];
            } catch {
              return [];
            }
          })
        : [];
    } catch {
      return [];
    }
  }
  async function saveInstalled(list) {
    await fs.mkdir(dir, { recursive: true });
    const temporary = `${installedFile()}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(list, null, 2), { mode: 0o600 });
    await fs.rename(temporary, installedFile());
  }
  return {
    shareUrl: SHARE_URL,
    /** The catalogue, with each pet's preview image inlined when it has one. */
    async catalogue() {
      const { base, catalogue } = await index();
      const pets = await Promise.all(
        catalogue.pets.map(async (pet) => {
          if (!pet.preview) return pet;
          try {
            const bytes = await get(`${base}${pet.preview}`, 512 * 1024);
            return { ...pet, previewImage: `data:image/png;base64,${bytes.toString('base64')}` };
          } catch {
            return pet;
          }
        }),
      );
      return { ...catalogue, pets };
    },
    /** A shared pet as a checked character bundle, ready for the usual import. */
    async pet(id, limit) {
      const { base, catalogue } = await index();
      const item = catalogue.pets.find((p) => p.id === id) || fail('社区目录中没有这个桌宠。');
      return validateBundle(JSON.parse((await file(base, item, limit)).toString('utf8')));
    },
    async installPlugin(id) {
      const { base, catalogue } = await index();
      const item = catalogue.plugins.find((p) => p.id === id) || fail('社区目录中没有这个插件。');
      const plugin = validatePlugin(
        JSON.parse((await file(base, item, PLUGIN_BYTES)).toString('utf8')),
        validateDesktopProfile,
      );
      if (plugin.id !== item.id) fail('插件编号与社区目录不一致。');
      const list = (await installed()).filter((p) => p.id !== plugin.id);
      if (list.length >= 30) fail('最多安装 30 个插件。');
      await saveInstalled([...list, plugin]);
      return installed();
    },
    plugins: installed,
    async removePlugin(id) {
      await saveInstalled((await installed()).filter((p) => p.id !== id));
      return installed();
    },
  };
}

module.exports = { createCommunity, validateIndex, validatePlugin, REGISTRIES, SHARE_URL };
