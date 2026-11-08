import { useEffect, useRef, useState } from 'react';
import { Check, ImagePlus, LoaderCircle, ShieldCheck, Square, RefreshCw, AlertCircle } from 'lucide-react';
import { bridge } from '../bridge';
import { styles, styleName } from '../theme';
import guides from '../../shared/art-styles.json';
import { Modal } from './Modal';
import { ReferencePanel } from './ReferencePanel';
import { SkinArtwork } from './SkinArtwork';
import { AnimationPreview } from './AnimationPreview';
import { FrameReview } from './FrameReview';
import { generationQueue, runGenerationQueue } from '../generationQueue';
import type { GenerationItem } from '../generationQueue';
import type { ArtStyle, Character, ProgressEvent, Skin, VisualReference, FrameReviewInput } from '../types';

const checks = ['发型、脸部与标志性饰物一致', '服装结构与配色关系一致', '画风改变后仍能认出是同一角色'];
const faces = {
  neutral: '基准',
  happy: '开心',
  thinking: '思考',
  sad: '低落',
  sleepy: '困倦',
  surprised: '惊讶',
} as const;
function reviewLabel(skin?: Skin) {
  return skin?.review?.status === 'approved'
    ? '已确认'
    : skin?.review?.status === 'rejected'
      ? '需重做'
      : '待核对';
}
function currentReferences(skin: Skin, refs: VisualReference[]) {
  return Boolean(
    refs.length &&
      skin.generation &&
      JSON.stringify(skin.generation.referenceIds) === JSON.stringify(refs.map((r) => r.id)),
  );
}
export function GenerationStudio({
  character,
  skins,
  imageReady,
  llmReady,
  onSaveSkin,
  onReferences,
  onClose,
  onBusy,
  onOpenAssets,
}: {
  character: Character;
  skins: Skin[];
  imageReady: boolean;
  llmReady: boolean;
  onSaveSkin: (skin: Skin, activate: boolean) => Promise<void>;
  onReferences: (references: VisualReference[]) => Promise<void>;
  onClose: () => void;
  onBusy: (busy: boolean) => void;
  onOpenAssets: () => void;
}) {
  const references = character.visualReferences || [];
  const candidates = skins.filter((s) => s.generation);
  const [selectedId, setSelectedId] = useState(candidates.at(-1)?.id || '');
  const candidate = candidates.find((s) => s.id === selectedId);
  const [mode, setMode] = useState<'image' | 'program'>('image');
  const [selectedStyles, setSelectedStyles] = useState<ArtStyle[]>(['chibi-pet']);
  const availableStyles =
    mode === 'program' ? styles.filter((s) => s.id === 'pixel' || s.id === '8bit') : styles;
  const [sourceId, setSourceId] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [checked, setChecked] = useState<boolean[]>([false, false, false]);
  const [frameReview, setFrameReview] = useState<FrameReviewInput | null>(null);
  const [refIndex, setRefIndex] = useState(0);
  const comparisonRef = useRef<HTMLDivElement>(null);
  const [unsaved, setUnsaved] = useState<{ skin: Skin; activate: boolean } | null>(null);
  const [batch, setBatch] = useState<GenerationItem[]>([]);
  const batchRef = useRef<GenerationItem[]>([]);
  const batchContext = useRef<{
    characterId: string;
    referenceDigest: string;
    sourceSkinId?: string;
    mode: 'image' | 'program';
  } | null>(null);
  const running = useRef(false);
  const stopRequested = useRef(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const matching = candidate && currentReferences(candidate, references);
  const approved = matching && candidate?.review?.status === 'approved';
  const sources = candidates.filter(
    (s) => !s.sprite && s.review?.status === 'approved' && currentReferences(s, references),
  );
  const locked = busy || Boolean(unsaved);
  useEffect(() => bridge.onProgress(setProgress), []);
  useEffect(() => {
    setChecked([false, false, false]);
    setFrameReview(null);
    setFeedback('');
  }, [selectedId, character.visualReferences]);
  useEffect(() => {
    if (!selectedId || busy) return;
    const frame = requestAnimationFrame(() => comparisonRef.current?.scrollIntoView({ block: 'center' }));
    return () => cancelAnimationFrame(frame);
  }, [selectedId, busy]);
  useEffect(() => {
    if (sourceId && !sources.some((s) => s.id === sourceId)) setSourceId('');
  }, [sourceId, sources]);
  async function run(task: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    onBusy(true);
    setError('');
    setNotice('');
    setProgress(null);
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作未完成。');
    } finally {
      running.current = false;
      setBusy(false);
      onBusy(false);
      setProgress(null);
    }
  }
  async function persist(skin: Skin, activate = false) {
    setUnsaved({ skin, activate });
    await onSaveSkin(skin, activate);
    setUnsaved(null);
    setSelectedId(skin.id);
  }
  function updateBatch(items: GenerationItem[]) {
    batchRef.current = items;
    setBatch(items);
  }
  async function executeBatch(items: GenerationItem[], onlyStyles?: ArtStyle[]) {
    const context = batchContext.current;
    if (!context) throw new Error('请先选择画风并开始生成。');
    const prepared = await bridge.prepareSkinGeneration(context);
    if (prepared.referenceDigest !== context.referenceDigest)
      throw new Error('原图已变化，请使用当前原图开始新的批次，避免混用角色参考。');
    stopRequested.current = false;
    setStopping(false);
    setBatchRunning(true);
    updateBatch(items);
    let result: GenerationItem[];
    try {
      result = await runGenerationQueue(items, {
        generate: async (style) => {
          try {
            return await bridge.generateSkin({ ...context, style });
          } catch (e) {
            if (e instanceof Error && e.message.includes('批量生成的参考图已变化'))
              stopRequested.current = true;
            throw e;
          }
        },
        save: (skin) => persist(skin),
        onChange: updateBatch,
        shouldStop: () => stopRequested.current,
        styles: onlyStyles,
      });
    } finally {
      setBatchRunning(false);
      setStopping(false);
    }
    const saved = result.filter((item) => item.status === 'saved').length;
    const failed = result.filter((item) => item.status === 'failed').length;
    const pending = result.filter((item) => item.status === 'queued').length;
    if (result.some((item) => item.status === 'unsaved'))
      setError('图片已生成，但本机保存失败，队列已暂停。请先仅重试本地保存，再继续剩余画风。');
    else if (failed) setError(`${failed} 种画风未生成成功，可单独重试失败项；已保存的候选会保留。`);
    setNotice(
      `已保存 ${saved} 份待核对候选。${pending ? `还有 ${pending} 种画风未开始，可继续队列。` : context.mode === 'program' ? '请对照原图核对，并试播候选动作。' : '请逐张对照原图核对，尚未生成表情。'}`,
    );
  }
  async function startBatch() {
    const context = {
      characterId: character.id,
      mode,
      ...(mode === 'image' && sourceId ? { sourceSkinId: sourceId } : {}),
    };
    const prepared = await bridge.prepareSkinGeneration(context);
    batchContext.current = { ...context, referenceDigest: prepared.referenceDigest };
    await executeBatch(
      generationQueue(availableStyles.filter((s) => selectedStyles.includes(s.id)).map((s) => s.id)),
    );
  }
  const queued = batch.filter((item) => item.status === 'queued').length;
  const failures = batch.filter((item) => item.status === 'failed').length;
  const finished = batch.filter((item) => item.status === 'saved' || item.status === 'failed').length;
  const reference = references[Math.min(refIndex, references.length - 1)];
  return (
    <Modal
      title="从原图，保留熟悉的她"
      subtitle="原图输入 → 选择制作方式 → 核对形象与动作"
      wide
      onClose={() => {
        if (!busy && !unsaved) onClose();
      }}
    >
      <div className="generation-studio">
        <div className="generation-asset-entry">
          <div>
            <strong>已有素材，也能直接做桌宠</strong>
            <p>查看各画风制作说明，导入 PNG 动作帧、图集或已绑定模型。</p>
          </div>
          <button type="button" className="button secondary" disabled={locked} onClick={onOpenAssets}>
            画风与素材制作
          </button>
        </div>
        <ReferencePanel
          character={character}
          references={references}
          disabled={locked}
          onChange={onReferences}
          onUseOriginal={async () => {
            const result = await bridge.useReferenceImage(character.id);
            await onSaveSkin(result, true);
            onClose();
          }}
        />
        <section className="generation-step">
          <div className="section-heading">
            <div>
              <span className="page-kicker">01 · 生成基准候选</span>
              <h3>只改变画风，保留角色</h3>
            </div>
          </div>
          <div className="generation-methods" aria-label="选择制作方式">
            {(['program', 'image'] as const).map((value) => (
              <button
                type="button"
                key={value}
                className={`generation-method ${mode === value ? 'selected' : ''}`}
                aria-label={value === 'program' ? '聊天模型 · 程序像素动画' : '图像服务 · 多画风立绘'}
                aria-pressed={mode === value}
                disabled={locked}
                onClick={() => {
                  setMode(value);
                  setSelectedStyles(value === 'program' ? ['8bit'] : ['chibi-pet']);
                  setSourceId('');
                }}
              >
                <strong>{value === 'program' ? '聊天模型 · 程序像素动画' : '图像服务 · 多画风立绘'}</strong>
                <span>
                  {value === 'program'
                    ? '原图输入 · 绘图指令 · 表情与动作'
                    : '原图编辑 · 9 种画风 · 核对后扩展表情'}
                </span>
                <small>
                  {value === 'program'
                    ? '实验功能 · 美术质量不稳定 · 使用聊天 Key'
                    : imageReady
                      ? '图像服务已配置'
                      : '尚未配置图像 Key 或模型，请到连接与设置填写'}
                </small>
              </button>
            ))}
          </div>
          {mode === 'program' && (
            <div className="notice">
              <p>
                让聊天模型直接查看参考图，编写像素绘图指令。生成的动画包含待机、招手、点头、摇头、跳跃、睡眠，以及眨眼、说话和
                6 种表情。美术质量不稳定，可能无法还原角色，仅适合实验。需要聊天模型及网关支持图片输入。
              </p>
            </div>
          )}
          {mode === 'image' && !imageReady && (
            <div className="notice">
              <p>
                此方式需要独立的图像 API Key 和模型。已有昔涟素材是在开发时制作并随项目提供的，聊天 Key
                不会自动成为图像 Key。可以从角色包或素材制作入口直接使用已有外观和动作。
              </p>
            </div>
          )}
          <div className="generation-selection-toolbar">
            <p>
              可多选 · 已选 <strong>{selectedStyles.length}</strong> / {availableStyles.length} 种画风
            </p>
            <div className="toolbar">
              <button
                type="button"
                className="text-button"
                disabled={locked || selectedStyles.length === availableStyles.length}
                onClick={() => setSelectedStyles(availableStyles.map((s) => s.id))}
              >
                全选画风
              </button>
              <button
                type="button"
                className="text-button"
                disabled={locked || !selectedStyles.length}
                onClick={() => setSelectedStyles([])}
              >
                清空选择
              </button>
            </div>
          </div>
          <div className="style-grid">
            {availableStyles.map((s) => (
              <button
                type="button"
                key={s.id}
                className={`style-option ${selectedStyles.includes(s.id) ? 'selected' : ''}`}
                disabled={locked}
                aria-label={`选择画风：${s.name}`}
                aria-pressed={selectedStyles.includes(s.id)}
                onClick={() =>
                  setSelectedStyles((old) =>
                    old.includes(s.id) ? old.filter((id) => id !== s.id) : [...old, s.id],
                  )
                }
              >
                <span className={`style-swatch ${s.id}`} style={{ background: s.color }}>
                  ✧
                </span>
                <strong>{s.name}</strong>
                <small>{guides[s.id as keyof typeof guides].shape}</small>
                {selectedStyles.includes(s.id) && <Check aria-hidden="true" />}
              </button>
            ))}
          </div>
          {mode === 'image' && sources.length > 0 && (
            <label className="generation-source">
              补充已确认的基准图
              <select value={sourceId} disabled={locked} onChange={(e) => setSourceId(e.target.value)}>
                <option value="">仅使用原始参考图</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <small>选择基准图后，原始参考图仍会一起传入。</small>
            </label>
          )}
          <button
            type="button"
            className="button primary full"
            disabled={
              locked ||
              !references.length ||
              !selectedStyles.length ||
              (mode === 'image' ? !imageReady : !llmReady)
            }
            onClick={() => void run(startBatch)}
          >
            {batchRunning ? <LoaderCircle className="spin" size={16} /> : <ImagePlus size={16} />}
            {!batchRunning && (queued > 0 || failures > 0) ? '开始新批次 · 用 ' : '用 '}
            {references.length} 张原图{mode === 'program' ? '制作' : '生成'} {selectedStyles.length}{' '}
            {mode === 'program' ? '份动画候选' : '张候选'}
          </button>
          <p className="fine-print">
            {mode === 'program'
              ? `每种画风 1 次聊天模型请求，本次共 ${selectedStyles.length} 次。由同一套角色分组制作完整姿势图集，生成后可先试播，再核对使用。`
              : `每种画风 1 次图像请求，本次共 ${selectedStyles.length} 次，逐张生成并保存。每张都使用原图，输出保留为待核对候选，不会自动成为桌宠或触发表情生成。`}
          </p>
          {mode === 'program' && !llmReady && (
            <p className="fine-print">请先在连接与设置中保存聊天模型与 API Key。</p>
          )}
          {!batchRunning && (queued > 0 || failures > 0) && (
            <p className="fine-print">
              本批还有未完成项，可用下方按钮继续或重试。开始新批次会重新生成全部所选画风。
            </p>
          )}
          {batch.length > 0 && (
            <section className="generation-batch" aria-label="批量画风生成进度">
              <div className="section-heading">
                <div>
                  <h4>
                    本批候选 · 已处理 {finished} / {batch.length}
                  </h4>
                  <p>
                    {batchRunning
                      ? progress?.detail || '正在逐张生成所选画风…'
                      : '每张候选分别保存、核对与重试。'}
                  </p>
                </div>
                {batchRunning && queued > 0 && (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={stopping}
                    onClick={() => {
                      stopRequested.current = true;
                      setStopping(true);
                    }}
                  >
                    <Square size={14} />
                    {stopping ? '当前候选保存后停止' : '停止队列'}
                  </button>
                )}
              </div>
              <progress max={batch.length} value={finished} aria-label="画风批次完成进度" />
              <div className="generation-batch-list" aria-live="polite">
                {batch.map((item) => (
                  <article
                    className={`generation-batch-item ${item.status}`}
                    key={item.style}
                    data-style={item.style}
                    data-status={item.status}
                  >
                    <div className="generation-batch-thumbnail">
                      {item.skin ? (
                        <SkinArtwork skin={item.skin} alt={`${styleName(item.style)}候选`} />
                      ) : item.status === 'generating' || item.status === 'saving' ? (
                        <LoaderCircle className="spin" size={19} />
                      ) : (
                        <ImagePlus size={19} />
                      )}
                    </div>
                    <div className="generation-batch-info">
                      <strong>{styleName(item.style)}</strong>
                      <span>
                        {item.status === 'saved'
                          ? `已保存 · ${reviewLabel(skins.find((skin) => skin.id === item.skin?.id))}`
                          : item.status === 'failed'
                            ? '生成未成功'
                            : item.status === 'unsaved'
                              ? '图片已返回 · 等待本机保存'
                              : item.status === 'generating'
                                ? '正在生成'
                                : item.status === 'saving'
                                  ? '正在保存'
                                  : batchRunning
                                    ? '等待生成'
                                    : '未开始'}
                      </span>
                      {item.error && <p className="generation-batch-error">{item.error}</p>}
                    </div>
                    {item.status === 'saved' && item.skin && (
                      <button
                        type="button"
                        className="text-button"
                        disabled={locked}
                        aria-label={`核对${styleName(item.style)}候选`}
                        onClick={() => setSelectedId(item.skin!.id)}
                      >
                        <Check size={15} />
                        核对
                      </button>
                    )}
                    {item.status === 'failed' && (
                      <button
                        type="button"
                        className="text-button"
                        disabled={locked}
                        aria-label={`重试${styleName(item.style)}`}
                        onClick={() =>
                          void run(() =>
                            executeBatch(
                              batchRef.current.map((old) =>
                                old.style === item.style
                                  ? { ...old, status: 'queued', error: undefined }
                                  : old,
                              ),
                              [item.style],
                            ),
                          )
                        }
                      >
                        <RefreshCw size={15} />
                        重试
                      </button>
                    )}
                    {item.status === 'unsaved' && <AlertCircle size={18} aria-label="本机保存未完成" />}
                  </article>
                ))}
              </div>
              {!batchRunning && (failures > 0 || queued > 0) && (
                <div className="toolbar">
                  {failures > 0 && (
                    <button
                      type="button"
                      className="button secondary"
                      disabled={locked}
                      onClick={() =>
                        void run(() =>
                          executeBatch(
                            batchRef.current.map((item) =>
                              item.status === 'failed'
                                ? { ...item, status: 'queued', error: undefined }
                                : item,
                            ),
                            batchRef.current
                              .filter((item) => item.status === 'failed')
                              .map((item) => item.style),
                          ),
                        )
                      }
                    >
                      <RefreshCw size={15} />
                      重试失败的 {failures} 种画风
                    </button>
                  )}
                  {queued > 0 && (
                    <button
                      type="button"
                      className="button secondary"
                      disabled={locked}
                      onClick={() => void run(() => executeBatch(batchRef.current))}
                    >
                      继续剩余 {queued} 种画风
                    </button>
                  )}
                </div>
              )}
              {batchRunning && queued > 0 && (
                <p className="fine-print">停止队列会让当前请求完成并保存，再停止后续画风。</p>
              )}
            </section>
          )}
        </section>
        {candidates.length > 0 && (
          <section className="generation-step">
            <div className="section-heading">
              <div>
                <span className="page-kicker">02 · 对照原图</span>
                <h3>确认她还是她</h3>
              </div>
              <select
                aria-label="选择基准候选"
                value={selectedId}
                disabled={locked}
                onChange={(e) => setSelectedId(e.target.value)}
              >
                <option value="" disabled>
                  选择候选
                </option>
                {[...candidates].reverse().map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {reviewLabel(s)}
                  </option>
                ))}
              </select>
            </div>
            {candidate && (
              <>
                <div className="reference-comparison" ref={comparisonRef}>
                  <figure>
                    <figcaption>
                      <strong>参考原图</strong>
                      {references.length > 1 && (
                        <select
                          aria-label="切换对照原图"
                          value={Math.min(refIndex, references.length - 1)}
                          onChange={(e) => setRefIndex(Number(e.target.value))}
                        >
                          {references.map((r, i) => (
                            <option key={r.id} value={i}>
                              原图 {i + 1} · {r.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </figcaption>
                    {reference ? (
                      <img src={reference.image} alt={`原图对照：${reference.name}`} />
                    ) : (
                      <p>尚无参考原图</p>
                    )}
                  </figure>
                  <figure>
                    <figcaption>
                      <strong>生成候选</strong>
                      <span>{styleName(candidate.style)}</span>
                    </figcaption>
                    <SkinArtwork skin={candidate} alt={`${character.name} 基准候选`} />
                  </figure>
                </div>
                {candidate.sprite && <AnimationPreview key={candidate.id} skin={candidate} />}
                {candidate.sprite && !approved && (
                  <FrameReview
                    key={`review-${candidate.id}`}
                    skin={candidate}
                    disabled={locked}
                    onChange={setFrameReview}
                  />
                )}
                {candidate.drawing && (
                  <div className="candidate-revision">
                    <label>
                      想修正哪些细节？
                      <textarea
                        aria-label="程序动画修正意见"
                        maxLength={1200}
                        rows={3}
                        value={feedback}
                        disabled={locked}
                        placeholder="例如：眼睛重复了；头发应更长；招手时手臂与肩膀要保持连接。"
                        onChange={(event) => setFeedback(event.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={locked || !llmReady || !feedback.trim()}
                      onClick={() =>
                        void run(async () => {
                          const result = await bridge.generateSkin({
                            characterId: character.id,
                            mode: 'program',
                            style: candidate.style,
                            programSkinId: candidate.id,
                            feedback: feedback.trim(),
                          });
                          await persist(result);
                          setNotice('已保留旧候选，并保存新的修正版。请重新核对形象和动作。');
                        })
                      }
                    >
                      <RefreshCw size={15} />
                      按意见修正动画（1 次聊天请求）
                    </button>
                    <p className="fine-print">
                      同时传入原始参考图和已有绘图源数据，生成独立的新候选。旧候选保留，修正版需要重新核对。
                    </p>
                  </div>
                )}
                {!matching && (
                  <div className="notice">
                    参考图已经变化，请使用当前原图重新生成候选。旧候选保留在外观收藏中供比较。
                  </div>
                )}
                {matching && !approved && (
                  <div className="identity-checks">
                    {checks.map((label, i) => (
                      <label className="checkbox-label" key={label}>
                        <input
                          type="checkbox"
                          checked={checked[i]}
                          disabled={locked}
                          onChange={(e) =>
                            setChecked(checked.map((v, j) => (j === i ? e.target.checked : v)))
                          }
                        />
                        {label}
                      </label>
                    ))}
                    <div className="toolbar">
                      <button
                        type="button"
                        className="button primary"
                        disabled={locked || !checked.every(Boolean) || (!!candidate.sprite && !frameReview)}
                        onClick={() =>
                          void run(async () => {
                            await persist(
                              await bridge.reviewSkin({
                                characterId: character.id,
                                skinId: candidate.id,
                                decision: 'approved',
                                ...(frameReview ? { frameReview } : {}),
                              }),
                              true,
                            );
                            setNotice('已记录你对基准图的确认，并将它用于桌宠。现在可以扩展表情。');
                          })
                        }
                      >
                        <ShieldCheck size={16} />
                        确认基准并使用
                      </button>
                      <button
                        type="button"
                        className="button secondary"
                        disabled={locked}
                        onClick={() =>
                          void run(async () => {
                            await persist(
                              await bridge.reviewSkin({
                                characterId: character.id,
                                skinId: candidate.id,
                                decision: 'rejected',
                              }),
                            );
                            setNotice('已标记为需要重做。请调整参考图或重新生成候选。');
                          })
                        }
                      >
                        不像，保留待重做
                      </button>
                    </div>
                  </div>
                )}
                {approved && (
                  <div className="notice">
                    <ShieldCheck size={17} />
                    <p>基准形象已由你对照原图确认。记录绑定当前原图与基准图内容；修改后需要重新核对。</p>
                  </div>
                )}
              </>
            )}
          </section>
        )}
        {approved && candidate && !candidate.sprite && (
          <section className="generation-step">
            <div className="section-heading">
              <div>
                <span className="page-kicker">03 · 表情扩展</span>
                <h3>让同一个她，有更多表情</h3>
              </div>
            </div>
            <div className="expression-preview">
              {Object.entries(faces).map(([key, label]) => (
                <figure key={key}>
                  {candidate.images[key as keyof typeof faces] ? (
                    <img src={candidate.images[key as keyof typeof faces]} alt={`${label}表情`} />
                  ) : (
                    <span>待生成</span>
                  )}
                  <figcaption>{label}</figcaption>
                </figure>
              ))}
            </div>
            <button
              type="button"
              className="button primary full"
              disabled={
                locked || Object.keys(faces).every((key) => candidate.images[key as keyof typeof faces])
              }
              onClick={() =>
                void run(async () => {
                  const result = await bridge.generateExpressions({
                    characterId: character.id,
                    skinId: candidate.id,
                  });
                  await persist(result.skin);
                  if (result.warning) setError(result.warning);
                  else setNotice('表情已保存，请检查每张图是否保持角色一致。');
                })
              }
            >
              <ImagePlus size={16} />
              生成缺失表情（最多 5 次请求）
            </button>
            <p className="fine-print">
              每次同时传入已确认的基准图与全部原图。中断后保留已完成图片，继续时只补缺失项。
            </p>
          </section>
        )}
        {busy && (
          <div className="progress-card" role="status">
            <LoaderCircle className="spin" size={18} />
            <div>
              <strong>{progress?.stage || '正在处理'}</strong>
              <p>{progress?.detail || '正在保存结果…'}</p>
              {progress?.total && <progress value={progress.completed || 0} max={progress.total} />}
            </div>
          </div>
        )}
        {notice && (
          <div className="notice" role="status">
            <Check size={16} />
            <p>{notice}</p>
          </div>
        )}
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        {unsaved && !busy && (
          <div className="notice">
            <div>
              <strong>图片已返回，尚未保存到本机。</strong>
              <p>重试保存不会重新调用图像服务。请先保存结果再关闭窗口。</p>
              <button
                type="button"
                className="button secondary"
                onClick={() =>
                  void run(async () => {
                    await persist(unsaved.skin, unsaved.activate);
                    updateBatch(
                      batchRef.current.map((item) =>
                        item.status === 'unsaved' && item.skin?.id === unsaved.skin.id
                          ? { ...item, status: 'saved', error: undefined }
                          : item,
                      ),
                    );
                    setNotice('图片已保存到本机。剩余画风可点击继续，不会重新生成已保存的候选。');
                  })
                }
              >
                仅重试本地保存
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
