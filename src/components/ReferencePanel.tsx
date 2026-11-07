import { useRef, useState } from 'react';
import { ImagePlus, LoaderCircle, Trash2, Search, Download } from 'lucide-react';
import { bridge } from '../bridge';
import type { Character, VisualReference } from '../types';

export function ReferencePanel({
  character,
  references,
  disabled = false,
  onChange,
  onUseOriginal,
}: {
  character: Character;
  references: VisualReference[];
  disabled?: boolean;
  onChange: (references: VisualReference[]) => Promise<void>;
  onUseOriginal?: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState('');
  const requestPending = useRef(false);
  async function update(task: () => Promise<void>) {
    if (requestPending.current || disabled) return;
    requestPending.current = true;
    setBusy(true);
    setError('');
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : '参考图保存失败。');
    } finally {
      requestPending.current = false;
      setBusy(false);
    }
  }
  const locked = disabled || busy;
  return (
    <section className="reference-panel" aria-label="角色参考原图">
      <div className="section-heading">
        <div>
          <h3>
            角色参考原图 <span>{references.length} / 4</span>
          </h3>
          <p>
            自动收集会在没有参考时采用社区索引中名字匹配的立绘；其他网页图片先保留为候选。请核对同一形态，第一张确定服装与轮廓。
          </p>
        </div>
        <div className="reference-toolbar">
          <button
            type="button"
            className="button secondary"
            disabled={locked}
            onClick={() =>
              void update(async () => {
                const stop = bridge.onProgress((event) => {
                  if (event.stage === 'references') setDetail(event.detail);
                });
                try {
                  await bridge.discoverReferences(character.id);
                  setSelected([]);
                } finally {
                  stop();
                  setDetail('');
                }
              })
            }
          >
            {busy ? <LoaderCircle size={16} className="spin" /> : <Search size={16} />}自动收集参考图
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={locked || references.length >= 4}
            onClick={() =>
              void update(async () => {
                const added = await bridge.importReferences();
                if (!added.length) return;
                if (references.length + added.length > 4)
                  throw new Error('总共最多 4 张参考图，请减少本次选择或移除旧图。');
                await onChange([...references, ...added]);
              })
            }
          >
            {busy ? <LoaderCircle size={16} className="spin" /> : <ImagePlus size={16} />}添加原图
          </button>
        </div>
      </div>
      {detail && (
        <div className="notice" role="status">
          {detail}
        </div>
      )}
      {!!character.referenceCandidates?.length && (
        <div className="reference-discovery">
          <div className="section-heading">
            <div>
              <h3>已找到 {character.referenceCandidates.length} 张候选原图</h3>
              <p>图片已下载到本机。选择同一服装和形态，优先全身图；不会覆盖已有参考。</p>
            </div>
          </div>
          <div className="reference-grid">
            {character.referenceCandidates.map((candidate) => (
              <label
                className={`reference-card reference-choice ${selected.includes(candidate.id) ? 'selected' : ''}`}
                key={candidate.id}
              >
                <img src={candidate.image} alt={candidate.name} />
                <span>
                  <input
                    type="checkbox"
                    aria-label={`选择参考：${candidate.name}`}
                    checked={selected.includes(candidate.id)}
                    disabled={
                      locked || (!selected.includes(candidate.id) && selected.length >= 4 - references.length)
                    }
                    onChange={(event) =>
                      setSelected((ids) =>
                        event.target.checked
                          ? [...ids, candidate.id]
                          : ids.filter((id) => id !== candidate.id),
                      )
                    }
                  />
                  {candidate.name}
                </span>
                <small>
                  {candidate.width} × {candidate.height} ·{' '}
                  {candidate.origin === 'catalog' ? '社区索引名字匹配' : '网页候选，待核对'}
                </small>
                {candidate.sourceUrl && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => void bridge.openExternal(candidate.sourceUrl!)}
                  >
                    查看来源
                  </button>
                )}
              </label>
            ))}
          </div>
          <button
            type="button"
            className="button primary"
            disabled={locked || !selected.length || selected.length + references.length > 4}
            onClick={() =>
              void update(async () => {
                await onChange([
                  ...references,
                  ...character.referenceCandidates!.filter((candidate) => selected.includes(candidate.id)),
                ]);
                setSelected([]);
              })
            }
          >
            <Download size={16} />
            保存 {selected.length || ''} 张为角色参考
          </button>
        </div>
      )}
      {!references.length ? (
        <div className="reference-empty">
          <ImagePlus size={28} />
          <strong>先找到这个角色真实的样子</strong>
          <p>
            添加 PNG、JPEG 或 WebP 原图，每张不超过 8
            MiB。核对后可以直接作为静态桌宠；选用图像生成服务时才会将参考图传给该服务。
          </p>
        </div>
      ) : (
        <div className="reference-grid">
          {references.map((ref, index) => (
            <article className="reference-card" key={ref.id}>
              <details>
                <summary aria-label={`查看原图：${ref.name}`}>
                  <img src={ref.image} alt={ref.name} />
                  <span>
                    原图 {index + 1}
                    {index === 0 ? ' · 主参考' : ''}
                  </span>
                </summary>
                <div className="reference-full">
                  <img src={ref.image} alt={`${ref.name} 完整参考`} />
                </div>
              </details>
              <strong title={ref.name}>{ref.name}</strong>
              {ref.origin && (
                <p className="fine-print">
                  {ref.width} × {ref.height} ·{' '}
                  {ref.origin === 'catalog' ? '社区索引名字匹配，待核对形态' : '网页参考，待核对身份'}
                </p>
              )}
              <label>
                来源页面（可选）
                <input
                  key={`${ref.id}-${ref.sourceUrl || ''}`}
                  type="url"
                  defaultValue={ref.sourceUrl || ''}
                  placeholder="https://…"
                  aria-label={`${ref.name} 的来源页面`}
                  disabled={locked}
                  maxLength={4096}
                  onBlur={(e) => {
                    const sourceUrl = e.target.value.trim();
                    if (sourceUrl === (ref.sourceUrl || '')) return;
                    void update(async () => {
                      if (sourceUrl) {
                        const parsed = new URL(sourceUrl);
                        if (
                          !['https:', 'http:'].includes(parsed.protocol) ||
                          parsed.username ||
                          parsed.password
                        )
                          throw new Error('来源请填写普通 HTTP(S) 网页地址。');
                      }
                      await onChange(
                        references.map((r) =>
                          r.id === ref.id ? { ...r, sourceUrl: sourceUrl || undefined } : r,
                        ),
                      );
                    });
                  }}
                />
              </label>
              <div className="reference-actions">
                {index > 0 && (
                  <button
                    type="button"
                    className="text-button"
                    disabled={locked}
                    onClick={() =>
                      void update(() => onChange([ref, ...references.filter((r) => r.id !== ref.id)]))
                    }
                  >
                    设为主参考
                  </button>
                )}
                <button
                  type="button"
                  className="text-button"
                  disabled={locked}
                  aria-label={`移除参考图：${ref.name}`}
                  onClick={() => void update(() => onChange(references.filter((r) => r.id !== ref.id)))}
                >
                  <Trash2 size={13} />
                  移除
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      <p className="fine-print">
        原图保存在本机并随角色包导出；来源链接用于追溯，不会被当成图片。更换原图后，旧候选需要重新生成。
      </p>
      {!!references.length && onUseOriginal && (
        <button
          type="button"
          className="button secondary"
          disabled={locked}
          onClick={() => void update(onUseOriginal)}
        >
          <ImagePlus size={16} />
          直接使用主参考作为立绘
        </button>
      )}
      {!!character.referenceWarnings?.length && (
        <p className="fine-print">{character.referenceWarnings.join(' ')}</p>
      )}
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
