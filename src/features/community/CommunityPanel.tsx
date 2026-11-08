import { useEffect, useState } from 'react';
import { Download, ExternalLink, LoaderCircle, Puzzle, Share2, Trash2, Users } from 'lucide-react';
import type { CommunityCatalogue, CommunityPlugin } from '../../types';

interface Props {
  /** The current character's name, for sharing her. */
  characterName: string;
  catalogue: () => Promise<CommunityCatalogue>;
  installedPlugins: CommunityPlugin[];
  onInstallPet: (id: string) => Promise<void>;
  onInstallPlugin: (id: string) => Promise<void>;
  onRemovePlugin: (id: string) => Promise<void>;
  /** Exports the current character's pack and opens the page to share it. */
  onShare: () => Promise<void>;
}

// Pets and plugins people share, from the project's GitHub repository (community/). Everything is
// checked against the catalogue's recorded digest and validated like a local import.
export function CommunityPanel({
  characterName,
  catalogue,
  installedPlugins,
  onInstallPet,
  onInstallPlugin,
  onRemovePlugin,
  onShare,
}: Props) {
  const [tab, setTab] = useState<'pets' | 'plugins' | 'share'>('pets');
  const [data, setData] = useState<CommunityCatalogue | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const load = () => {
    setError('');
    setData(null);
    catalogue().then(setData, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  useEffect(load, []);
  const run = async (key: string, job: () => Promise<void>) => {
    setBusy(key);
    setError('');
    try {
      await job();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };
  const installed = new Set(installedPlugins.map((p) => p.id));
  return (
    <section className="community" aria-label="社区桌宠与插件">
      <div className="community-tabs" role="tablist">
        {(
          [
            ['pets', '桌宠', Users],
            ['plugins', '插件', Puzzle],
            ['share', '分享我的桌宠', Share2],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'active' : ''}
            onClick={() => setTab(id)}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}{' '}
          <button className="text-button" onClick={load}>
            重试
          </button>
        </p>
      )}
      {tab !== 'share' && !data && !error && (
        <p className="community-empty">
          <LoaderCircle className="spin" size={16} /> 正在读取社区目录…
        </p>
      )}
      {tab === 'pets' && data && (
        <div className="community-list">
          {data.pets.length === 0 && (
            <p className="community-empty">
              还没有人分享桌宠。做好自己的角色后，可以在「分享我的桌宠」里成为第一个。
            </p>
          )}
          {data.pets.map((pet) => (
            <article key={pet.id} className="community-card">
              {pet.previewImage ? (
                <img src={pet.previewImage} alt="" />
              ) : (
                <span className="community-thumb" aria-hidden="true" />
              )}
              <div>
                <strong>{pet.name}</strong>
                <small>
                  {[pet.work, pet.author && `作者 ${pet.author}`, `${(pet.size / 1024 / 1024).toFixed(1)} MB`]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
                {pet.description && <p>{pet.description}</p>}
                {pet.license && <small className="community-license">{pet.license}</small>}
              </div>
              <button
                className="button secondary"
                aria-label={`下载并添加${pet.name}`}
                disabled={Boolean(busy)}
                onClick={() => void run(pet.id, () => onInstallPet(pet.id))}
              >
                {busy === pet.id ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}
                添加
              </button>
            </article>
          ))}
        </div>
      )}
      {tab === 'plugins' && data && (
        <div className="community-list">
          <p className="fine-print">
            插件只包含数据（性格习惯、动作偏好和台词），不运行代码。安装后立即生效，可随时移除。
          </p>
          {data.plugins.map((plugin) => (
            <article key={plugin.id} className="community-card">
              <span className="community-thumb plugin" aria-hidden="true">
                <Puzzle size={18} />
              </span>
              <div>
                <strong>{plugin.name}</strong>
                <small>{[plugin.author && `作者 ${plugin.author}`].filter(Boolean).join(' · ')}</small>
                {plugin.description && <p>{plugin.description}</p>}
              </div>
              {installed.has(plugin.id) ? (
                <button
                  className="button secondary"
                  aria-label={`移除插件${plugin.name}`}
                  disabled={Boolean(busy)}
                  onClick={() => void run(plugin.id, () => onRemovePlugin(plugin.id))}
                >
                  <Trash2 size={15} />
                  移除
                </button>
              ) : (
                <button
                  className="button secondary"
                  aria-label={`安装插件${plugin.name}`}
                  disabled={Boolean(busy)}
                  onClick={() => void run(plugin.id, () => onInstallPlugin(plugin.id))}
                >
                  {busy === plugin.id ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}
                  安装
                </button>
              )}
            </article>
          ))}
          {installedPlugins
            .filter((p) => !data.plugins.some((item) => item.id === p.id))
            .map((plugin) => (
              <article key={plugin.id} className="community-card">
                <span className="community-thumb plugin" aria-hidden="true">
                  <Puzzle size={18} />
                </span>
                <div>
                  <strong>{plugin.name}</strong>
                  <small>已安装（社区目录中已不再提供）</small>
                </div>
                <button
                  className="button secondary"
                  onClick={() => void run(plugin.id, () => onRemovePlugin(plugin.id))}
                >
                  <Trash2 size={15} />
                  移除
                </button>
              </article>
            ))}
        </div>
      )}
      {tab === 'share' && (
        <div className="community-share">
          <p>
            把「{characterName}」分享给大家：先导出她的角色包（档案、外观和动作），再在打开的 GitHub
            页面里附上这个文件提交。维护者核对后会把她加入社区目录，大家就能直接下载使用，不用重新制作。
          </p>
          <p className="fine-print">
            请只分享原创角色，或你有权分享的角色与素材，并写明授权方式。角色包不包含密钥、聊天记录或本机模型路径。
          </p>
          <button
            className="button primary"
            disabled={Boolean(busy)}
            onClick={() => void run('share', onShare)}
          >
            {busy === 'share' ? <LoaderCircle className="spin" size={15} /> : <ExternalLink size={15} />}
            导出并打开分享页面
          </button>
        </div>
      )}
    </section>
  );
}
