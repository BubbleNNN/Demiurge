import { isActivity } from '../../animation/activities';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Download,
  Film,
  LoaderCircle,
  RefreshCw,
  Settings2,
  Square,
  WandSparkles,
} from 'lucide-react';
import { bridge } from '../../bridge';
import { userError } from '../../errors';
import { styles, styleName } from '../../theme';
import { Modal } from '../../components/Modal';
import { ReferencePanel } from '../../components/ReferencePanel';
import { StyleReferencePanel } from '../../components/StyleReferencePanel';
import { SkinArtwork } from '../../components/SkinArtwork';
import { AnimationPreview } from '../../components/AnimationPreview';
import { ArtworkInspection } from '../../components/ArtworkInspection';
import { FrameReview } from '../../components/FrameReview';
import motions from '../../../shared/pet-motions.json';
import candidateDirections from '../../../shared/pet-candidate-directions.json';
import type {
  ArtStyle,
  Character,
  PetJob,
  PetMotion,
  ProgressEvent,
  PetProductionOptions,
  Skin,
  VisualReference,
  FrameReviewInput,
} from '../../types';

const checks = [
  '发型、脸部和标志性饰物与原图一致',
  '服装结构和配色一致，画风有明确区别',
  '动作衔接自然，没有变脸、肢体缺失或边缘裁切（睡醒、跑停、收起道具逐帧核对）',
];
const candidateDirectionOrder = ['balanced', 'bold', 'soft'] as const;
const stepName = (step: PetJob['steps'][number]) =>
  step.kind === 'base'
    ? '角色图'
    : step.kind === 'pack'
      ? '整理动画'
      : motions.find((m) => m.id === step.motion)?.name || '动作';
const statusName = {
  queued: '等待',
  working: '制作中',
  done: '已保存',
  failed: '需处理',
  unsaved: '待保存',
  uncertain: '请求中断',
};
const baseEditStatusName = {
  working: '正在修正',
  done: '已保存为新候选',
  failed: '修正失败',
  unsaved: '已生成，待本机保存',
  uncertain: '请求中断',
};
const revisionName = (job: PetJob) =>
  job.revision?.kind === 'base'
    ? '修正形象'
    : `修正${motions.find((motion) => motion.id === job.revision?.motion)?.name || '动作'}`;

export function PetProductionStudio({
  character,
  skins,
  imageReady,
  onClose,
  onBusy,
  onOpenSettings,
  onReferences,
  onSaveSkin,
}: {
  character: Character;
  skins: Skin[];
  imageReady: boolean;
  onClose: () => void;
  onBusy: (busy: boolean) => void;
  onOpenSettings: () => void;
  onReferences: (references: VisualReference[]) => Promise<void>;
  onSaveSkin: (skin: Skin, activate: boolean) => Promise<void>;
}) {
  const [selectedStyles, setSelectedStyles] = useState<ArtStyle[]>(['chibi-pet']);
  const [selectedMotions, setSelectedMotions] = useState<PetMotion[]>(motions.map((m) => m.id as PetMotion));
  const [frameCount, setFrameCount] = useState<4 | 8>(4);
  const [candidateCount, setCandidateCount] = useState<1 | 2 | 3>(1);
  const [candidateVariation, setCandidateVariation] =
    useState<NonNullable<PetProductionOptions['candidateVariation']>>('explore');
  const [temperament, setTemperament] = useState<NonNullable<PetProductionOptions['temperament']>>('natural');
  const [artDirection, setArtDirection] = useState('');
  const [styleReference, setStyleReference] = useState<VisualReference | null>(null);
  const [taskStyleReference, setTaskStyleReference] = useState<VisualReference | null>(null);
  const [taskStyleReferenceError, setTaskStyleReferenceError] = useState('');
  const [pauseAfterBase, setPauseAfterBase] = useState(true);
  const [masters, setMasters] = useState<Skin[]>([]);
  const [inspectedMasterId, setInspectedMasterId] = useState('');
  const [baseEditSkinId, setBaseEditSkinId] = useState('');
  const [baseEditFeedback, setBaseEditFeedback] = useState('');
  const [originalOutputs, setOriginalOutputs] = useState<Skin[]>([]);
  const [comparisonError, setComparisonError] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [autoCollect, setAutoCollect] = useState(true);
  const [jobs, setJobs] = useState<PetJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState('');
  const [outputs, setOutputs] = useState<Skin[]>([]);
  const [selectedSkinId, setSelectedSkinId] = useState('');
  const [revisionTarget, setRevisionTarget] = useState<PetMotion | 'base'>('base');
  const [revisionFeedback, setRevisionFeedback] = useState('');
  const [checked, setChecked] = useState<boolean[]>(checks.map(() => false));
  const [frameReview, setFrameReview] = useState<FrameReviewInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const running = useRef(false),
    stop = useRef(false),
    alive = useRef(true);
  const taskRef = useRef<HTMLElement>(null);
  const reviewRef = useRef<HTMLElement>(null);
  const baseRef = useRef<HTMLDivElement>(null);
  const resultRequest = useRef(0);
  const job = jobs.find((j) => j.id === selectedJobId);
  const candidate =
    skins.find((s) => s.id === selectedSkinId) || outputs.find((s) => s.id === selectedSkinId);
  const originalCandidate = originalOutputs.find((item) => item.style === candidate?.style);
  const editSource = masters.find((item) => item.id === baseEditSkinId);
  const inspectedMaster = masters.find((item) => item.id === inspectedMasterId);
  const inspectionOriginal = masters.find((item) => item.id === inspectedMaster?.generation?.parentSkinId);
  const pending = job?.steps.findIndex((s) => s.status !== 'done') ?? -1;
  const currentStep = pending >= 0 ? job?.steps[pending] : undefined;
  const sources = skins.filter(
    (s) =>
      !s.sprite &&
      !s.builtin &&
      s.images.neutral &&
      s.review?.status === 'approved' &&
      s.generation?.referenceIds.join(',') === character.visualReferences?.map((r) => r.id).join(','),
  );
  const requests = selectedStyles.length * (selectedMotions.length + (sourceId ? 0 : candidateCount));
  const revisionRequests = revisionTarget === 'base' ? 1 + (job?.motions.length || 0) : 1;
  const styleReferenceNeedsStyle =
    !sourceId &&
    !!styleReference &&
    selectedStyles.length > 0 &&
    selectedStyles.every((style) => style === 'original');
  const inputReady =
    selectedStyles.length > 0 &&
    selectedMotions.length > 0 &&
    !styleReferenceNeedsStyle &&
    (Boolean(character.visualReferences?.length) || autoCollect);
  const canReview = checked.every(Boolean) && candidate && (!candidate.sprite || !!frameReview) && !busy;
  const canEditBase = (style: ArtStyle) => {
    if (!job || ['ready', 'cancelled'].includes(job.status)) return false;
    const styleIndex = job.styles.indexOf(style);
    const bases = job.steps.filter((step) => step.style === style && step.kind === 'base');
    return (
      styleIndex >= 0 &&
      bases.length > 0 &&
      bases.every((step) => step.status === 'done') &&
      job.steps.every((step) => step.style !== style || step.kind === 'base' || step.status === 'queued') &&
      job.steps.every(
        (step) => !job.styles.slice(0, styleIndex).includes(step.style) || step.status === 'done',
      )
    );
  };
  const baseEditLimit = (style: ArtStyle) => {
    const edits = job?.baseEdits?.filter((edit) => edit.style === style) || [];
    if (edits.some((edit) => edit.status === 'unsaved'))
      return '已有修正图等待本机保存，请先恢复保存，或选择已有候选继续。';
    if (edits.some((edit) => edit.status === 'working')) return '正在修正这个画风的候选，请等待本次完成。';
    if (edits.length >= 6) return '这套画风已达到 6 次候选修正，请比较已有候选后选择。';
    if ((job?.baseEdits?.length || 0) >= 12) return '这个任务已达到 12 次候选修正，请比较已有候选后选择。';
    return '';
  };

  const updateJob = (value: PetJob) => {
    if (!alive.current) return;
    setJobs((items) => [value, ...items.filter((j) => j.id !== value.id)]);
  };
  async function showResults(id: string, inspectLatestFrom?: string) {
    const request = ++resultRequest.current;
    const previous = selectedSkinId;
    setOutputs([]);
    setMasters([]);
    setTaskStyleReference(null);
    setTaskStyleReferenceError('');
    setInspectedMasterId('');
    setSelectedSkinId('');
    try {
      const [result, bases, guide] = await Promise.all([
        bridge.petJobResults(id),
        bridge.petJobMasters(id),
        bridge.petJobStyleReference(id).then(
          (reference) => ({ reference, error: '' }),
          (error) => ({ reference: null, error: userError(error) }),
        ),
      ]);
      if (!alive.current || request !== resultRequest.current) return;
      setOutputs(result);
      setMasters(bases);
      setTaskStyleReference(guide.reference);
      setTaskStyleReferenceError(guide.error);
      if (inspectLatestFrom)
        setInspectedMasterId(
          bases.filter((base) => base.generation?.parentSkinId === inspectLatestFrom).at(-1)?.id ||
            inspectLatestFrom,
        );
      setSelectedSkinId(result.some((s) => s.id === previous) ? previous : result[0]?.id || '');
    } catch (error) {
      if (alive.current && request === resultRequest.current) throw error;
    }
  }
  async function refresh() {
    const request = ++resultRequest.current;
    try {
      const items = await bridge.listPetJobs(character.id);
      if (!alive.current || request !== resultRequest.current) return;
      setJobs(items);
      const selected = items.find((j) => j.id === selectedJobId) || items[0];
      if (selected) {
        setSelectedJobId(selected.id);
        await showResults(selected.id).catch((error) => {
          if (alive.current) setError(userError(error));
        });
      }
    } catch (e) {
      if (alive.current && request === resultRequest.current) setError(userError(e));
    }
  }
  useEffect(() => {
    let stale = false;
    setOriginalOutputs([]);
    setComparisonError('');
    const sourceId = job?.revision?.sourceJobId;
    if (sourceId)
      void bridge.petJobResults(sourceId).then(
        (items) => {
          if (!stale) setOriginalOutputs(items);
        },
        () => {
          if (!stale) setComparisonError('原成品暂时无法读取，可以先核对当前修正版，或重新打开任务再对比。');
        },
      );
    return () => {
      stale = true;
    };
  }, [job?.id, job?.revision?.sourceJobId]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const unsubscribe = bridge.onProgress((value) => {
      if (alive.current) setProgress(value);
    });
    return () => {
      alive.current = false;
      resultRequest.current++;
      stop.current = true;
      unsubscribe();
    };
  }, [character.id]);
  useEffect(() => {
    setBaseEditSkinId('');
    setBaseEditFeedback('');
  }, [selectedJobId]);
  useEffect(() => {
    setChecked(checks.map(() => false));
    setFrameReview(null);
    setRevisionFeedback('');
    setRevisionTarget('base');
  }, [selectedSkinId, character.visualReferences]);

  async function execute(value: PetJob, oneStep = false) {
    let current = value;
    let reviewingBase = false;
    for (let n = 0; n <= value.steps.length * 4; n++) {
      if (stop.current || current.awaitingSelection || ['ready', 'cancelled'].includes(current.status)) break;
      const index = current.steps.findIndex((step) => step.status !== 'done');
      if (index < 0) break;
      updateJob({
        ...current,
        status: 'running',
        steps: current.steps.map((step, i) =>
          i === index ? { ...step, status: 'working', error: undefined } : step,
        ),
      });
      try {
        current = await bridge.advancePetJob(current.id);
      } catch (e) {
        updateJob(current);
        throw e;
      }
      updateJob(current);
      if (current.awaitingSelection) {
        reviewingBase = true;
        break;
      }
      if (
        pauseAfterBase &&
        current.steps[index].kind === 'base' &&
        current.steps[index].status === 'done' &&
        current.steps.every(
          (step) =>
            step.kind !== 'base' || step.style !== current.steps[index].style || step.status === 'done',
        )
      ) {
        reviewingBase = true;
        break;
      }
      if (current.status === 'attention' || oneStep) break;
    }
    await showResults(current.id);
    if (reviewingBase)
      requestAnimationFrame(() => baseRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    if (current.status === 'ready' && !stop.current)
      requestAnimationFrame(() => reviewRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    if (alive.current)
      setNotice(
        current.awaitingSelection
          ? `${styleName(current.awaitingSelection)}候选已保存。对比形象后选择一张，再继续制作动作；选择本身不产生图像请求。`
          : reviewingBase
            ? '已暂停，角色图已保存。请先核对下方基准预览。满意后继续动作；需要改进时可点击候选卡片上的「修正这张」。'
            : stop.current
              ? '已暂停。完成的角色图和动作已保存在本机，可以继续原任务。'
              : current.status === 'ready'
                ? '角色图与动画已整理完成。请对照原图核对并试播，再启用为桌宠。'
                : current.status === 'attention'
                  ? '制作停在需要处理的阶段，已完成素材保留。'
                  : '本机结果已恢复。继续制作需要单独点击。',
      );
  }
  async function run(operation: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    stop.current = false;
    setBusy(true);
    setStopping(false);
    setError('');
    setNotice('');
    onBusy(true);
    try {
      await operation();
    } catch (e) {
      if (alive.current) setError(userError(e));
    } finally {
      running.current = false;
      onBusy(false);
      if (alive.current) {
        setBusy(false);
        setStopping(false);
        setProgress(null);
      }
    }
  }
  async function start() {
    if (!inputReady) return;
    resultRequest.current++;
    const created = await bridge.startPetJob({
      characterId: character.id,
      transitionVersion: 3,
      styles: selectedStyles,
      frameCount,
      candidateCount: sourceId ? 1 : candidateCount,
      candidateVariation: !sourceId && candidateCount > 1 ? candidateVariation : 'subtle',
      temperament,
      artDirection: sourceId ? '' : artDirection,
      motions: selectedMotions,
      autoCollect,
      ...(sourceId ? { sourceSkinId: sourceId } : {}),
      ...(!sourceId && styleReference ? { styleReference } : {}),
    });
    updateJob(created);
    setSelectedJobId(created.id);
    setOutputs([]);
    setMasters([]);
    setSelectedSkinId('');
    requestAnimationFrame(() => taskRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    await execute(created);
  }
  async function revise() {
    if (!job || job.status !== 'ready' || !candidate || !revisionFeedback.trim()) return;
    resultRequest.current++;
    const created = await bridge.revisePetJob({
      jobId: job.id,
      style: candidate.style,
      ...(revisionTarget !== 'base' ? { motion: revisionTarget } : {}),
      feedback: revisionFeedback.trim(),
    });
    updateJob(created);
    setSelectedJobId(created.id);
    setOutputs([]);
    setMasters([]);
    setSelectedSkinId('');
    requestAnimationFrame(() => taskRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    await execute(created);
  }
  async function finishBaseEdit(updated: PetJob, sourceSkinId: string, editId?: string) {
    updateJob(updated);
    const edit = editId ? updated.baseEdits?.find((item) => item.id === editId) : updated.baseEdits?.at(-1);
    await showResults(updated.id, edit?.status === 'done' ? sourceSkinId : undefined);
    if (edit?.status === 'done') {
      setBaseEditSkinId('');
      setBaseEditFeedback('');
      setNotice('修正图已保存，原候选仍保留。请放大比较后选择一张，动作尚未开始。');
      requestAnimationFrame(() => baseRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    } else {
      setNotice(
        edit?.status === 'unsaved'
          ? '修正图已经生成，等待恢复本机保存；恢复不会再次调用图像服务。已有候选仍可选择。'
          : '这次修正尚未完成。请查看修正状态；已有候选仍可选择，动作尚未开始。',
      );
    }
  }
  async function refineBase() {
    if (
      !job ||
      !editSource ||
      !canEditBase(editSource.style) ||
      baseEditLimit(editSource.style) ||
      !baseEditFeedback.trim()
    )
      return;
    const sourceSkinId = editSource.id;
    const updated = await bridge.refinePetBase({
      jobId: job.id,
      style: editSource.style,
      skinId: sourceSkinId,
      feedback: baseEditFeedback.trim(),
    });
    await finishBaseEdit(updated, sourceSkinId);
  }
  function toggleStyle(style: ArtStyle) {
    setSourceId('');
    setSelectedStyles((items) =>
      items.includes(style) ? items.filter((s) => s !== style) : [...items, style],
    );
  }
  return (
    <Modal
      title="自动制作桌宠"
      subtitle="角色原图 → 多画风角色图 → 姿势帧 → 互动动画"
      wide
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="pet-production">
        <header className="production-heading">
          <span className="production-icon">
            <WandSparkles size={24} />
          </span>
          <div>
            <h3>先确认形象，再制作动作。</h3>
            <p>先比较角色形象，再做动作。不满意的动作可以单独修正，逐步做成喜欢的样子。</p>
          </div>
        </header>
        {!imageReady && (
          <div className="production-connection">
            <div>
              <strong>先连接图像服务</strong>
              <p>需要支持参考图编辑和透明 PNG 的图像 API。Claude 聊天配置不能产生这些图片。</p>
            </div>
            <button className="button secondary" disabled={busy} onClick={onOpenSettings}>
              <Settings2 size={15} />
              配置图像服务
              <ArrowUpRight size={14} />
            </button>
          </div>
        )}
        <details className="production-sources">
          <summary>
            角色参考原图 <span>{character.visualReferences?.length || 0} / 4</span>
          </summary>
          <ReferencePanel
            character={character}
            references={character.visualReferences || []}
            disabled={busy}
            onChange={onReferences}
          />
          <label className="production-check">
            <input
              type="checkbox"
              checked={autoCollect}
              disabled={busy}
              onChange={(e) => setAutoCollect(e.target.checked)}
            />
            没有原图时自动收集；只自动采用名字匹配的角色立绘，其他图片留待核对。
          </label>
        </details>
        <section className="production-section" aria-label="自动制作画风">
          <div className="production-section-heading">
            <div>
              <small>01 · 角色图</small>
              <h4>选择角色画风</h4>
            </div>
            <div className="toolbar">
              <button
                className="text-button"
                disabled={busy}
                onClick={() => {
                  setSourceId('');
                  setSelectedStyles(styles.map((s) => s.id));
                }}
              >
                全选画风
              </button>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => {
                  setSourceId('');
                  setSelectedStyles([]);
                }}
              >
                清空画风
              </button>
            </div>
          </div>
          <div className="production-style-grid">
            {styles.map((s) => (
              <button
                key={s.id}
                className={selectedStyles.includes(s.id) ? 'selected' : ''}
                aria-label={`桌宠画风：${s.name}`}
                aria-pressed={selectedStyles.includes(s.id)}
                disabled={busy}
                onClick={() => toggleStyle(s.id)}
              >
                <span className="art-style-dot" style={{ background: s.color }} />
                <strong>{s.name}</strong>
                <small>{s.detail}</small>
                {selectedStyles.includes(s.id) && <Check size={14} />}
              </button>
            ))}
          </div>
          {selectedStyles.includes('chibi-pet') && (
            <p className="notice">
              Q版先搜索并核对这个角色已有的 Q 版／表情包形象；找到后参考其设计制作。
              未找到可用参考时，使用 Anime Codex 芙宁娜贴纸画风。网络或搜索失败会提示重试。
              搜索和图片核对可能产生模型用量，完成后会显示采用的来源。
            </p>
          )}
          {sources.length > 0 && (
            <label className="production-master-select">
              或者，为已确认的角色图补动作
              <select
                aria-label="桌宠制作基准"
                value={sourceId}
                disabled={busy}
                onChange={(e) => {
                  const source = sources.find((s) => s.id === e.target.value);
                  setSourceId(e.target.value);
                  if (source) setSelectedStyles([source.style]);
                }}
              >
                <option value="">重新生成所选画风的角色图</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </section>
        <section className="production-section" aria-label="制作细节">
          <h4>外观与动作的细节</h4>
          <StyleReferencePanel
            reference={styleReference}
            title="画风参考（选填）"
            description={
              sourceId
                ? '当前沿用已确认角色图，本次补动作不使用画风参考。'
                : '为新任务添加一张喜欢的画风：参考线条、上色方式与材质，人物身份和服装仍以角色原图为准。'
            }
            disabled={busy || !!sourceId}
            onImport={() =>
              void run(async () => {
                const imported = await bridge.importStyleReference();
                if (alive.current && imported) setStyleReference(imported);
              })
            }
            onRemove={() => setStyleReference(null)}
          />
          {!sourceId && styleReference && (
            <p className="empty-note" aria-label="画风参考适用范围">
              {styleReferenceNeedsStyle
                ? '原作画风沿用角色原图。请移除画风参考，或选择至少一种其他画风后开始。'
                : `用于新任务中${
                    selectedStyles
                      .filter((style) => style !== 'original')
                      .map(styleName)
                      .join('、') || '所选的非原作'
                  }画风；原作画风始终沿用角色原图。图片随任务保存在本机，不增加图像请求次数。`}
            </p>
          )}
          <label className="production-master-select">
            外观要求（选填）
            <textarea
              aria-label="外观要求"
              rows={3}
              maxLength={600}
              value={artDirection}
              disabled={busy || !!sourceId}
              onChange={(e) => setArtDirection(e.target.value)}
              placeholder="例如：轮廓圆润、线条干净，缩小后仍能看清眼睛；保留发饰与裙装花纹。"
            />
          </label>
          <p className="empty-note">
            {sourceId
              ? '沿用已确认角色图的外观，只为它补动作。'
              : '要求用于生成基准图，动作继续沿用这张图。服装与身份仍以原图为准。'}
          </p>
          <label className="production-master-select">
            每种画风的角色候选
            <select
              aria-label="角色候选数量"
              value={sourceId ? 1 : candidateCount}
              disabled={busy || !!sourceId}
              onChange={(e) => setCandidateCount(Number(e.target.value) as 1 | 2 | 3)}
            >
              <option value={1}>一张 · 直接核对形象</option>
              <option value={2}>两张 · 比较后选择</option>
              <option value={3}>三张 · 探索更多表现</option>
            </select>
          </label>
          {!sourceId && candidateCount > 1 && (
            <>
              <p className="empty-note">
                每种画风先制作 {candidateCount}{' '}
                张候选，再暂停等待你选择。只有选中的形象继续做动作；每多一张候选增加一次图像请求。
              </p>
              <label className="production-master-select">
                候选变化
                <select
                  aria-label="角色候选变化"
                  value={candidateVariation}
                  disabled={busy}
                  onChange={(event) => setCandidateVariation(event.target.value as 'subtle' | 'explore')}
                >
                  <option value="subtle">同一方向微调</option>
                  <option value="explore">探索不同表现</option>
                </select>
              </label>
              {candidateVariation === 'explore' && (
                <>
                  <ol className="production-candidate-directions" aria-label="本次候选方向">
                    {candidateDirectionOrder.slice(0, candidateCount).map((direction, index) => (
                      <li key={direction}>
                        <strong>
                          候选 {index + 1} · {candidateDirections[direction].label}
                        </strong>
                        <p>{candidateDirections[direction].description}</p>
                      </li>
                    ))}
                  </ol>
                  {selectedStyles.includes('original') && (
                    <p className="empty-note">
                      原作画风保持原有画法、比例和服装细节，通过站姿与神态做轻微变化。
                    </p>
                  )}
                </>
              )}
            </>
          )}
          <div className="production-options-grid">
            <label className="production-master-select">
              动作细腻程度
              <select
                aria-label="动作帧数"
                value={frameCount}
                disabled={busy}
                onChange={(e) => setFrameCount(Number(e.target.value) as 4 | 8)}
              >
                <option value={4}>四帧 · 简洁关键姿势</option>
                <option value={8}>八帧 · 更细的表情与手势</option>
              </select>
            </label>
            <label className="production-master-select">
              动作气质
              <select
                aria-label="动作气质"
                value={temperament}
                disabled={busy}
                onChange={(e) =>
                  setTemperament(e.target.value as NonNullable<PetProductionOptions['temperament']>)
                }
              >
                <option value="natural">自然 · 日常陪伴</option>
                <option value="gentle">轻柔 · 小幅度、慢节奏</option>
                <option value="lively">活泼 · 鲜明姿势、轻快节奏</option>
              </select>
            </label>
          </div>
          {frameCount === 8 && (
            <p className="notice">
              八帧需要图像服务支持 1536×1024；每格
              384×512。帧数增加不保证更流畅，仍需逐帧核对。四种表情保持四帧；同样的请求次数不代表相同费用。
            </p>
          )}
          <label className="production-check">
            <input
              type="checkbox"
              aria-label="角色图完成后暂停"
              checked={pauseAfterBase}
              disabled={busy}
              onChange={(e) => setPauseAfterBase(e.target.checked)}
            />
            单张角色图完成后暂停，让我先看形象再继续动作；多候选始终先等待选择
          </label>
        </section>
        <section className="production-section" aria-label="自动制作动作">
          <div className="production-section-heading">
            <div>
              <small>02 · 动画</small>
              <h4>选择需要的动作</h4>
            </div>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => setSelectedMotions(motions.map((m) => m.id as PetMotion))}
            >
              完整桌宠动作包
            </button>
          </div>
          <p className="muted">
            新版动作流程：生活活动、四向跑动、倾听和睡眠各十二帧，进入、循环、退出各四帧， 每组一次 1024×1024
            图像请求。默认已选完整动作包与新版 Q 版。其他动作沿用上方帧数。
            原帧不自动降清晰度；图集超限会保留已生成素材并提示处理。
          </p>
          <div className="production-motion-grid">
            {motions.map((m) => (
              <button
                key={m.id}
                aria-label={`制作动作：${m.name}`}
                aria-pressed={selectedMotions.includes(m.id as PetMotion)}
                className={selectedMotions.includes(m.id as PetMotion) ? 'selected' : ''}
                disabled={busy}
                onClick={() =>
                  setSelectedMotions((items) =>
                    items.includes(m.id as PetMotion)
                      ? items.filter((item) => item !== m.id)
                      : [...items, m.id as PetMotion],
                  )
                }
              >
                <span>
                  <strong>{m.name}</strong>
                  <small>{m.description}</small>
                </span>
                <i>
                  {selectedMotions.includes(m.id as PetMotion) ? <Check size={14} /> : <Film size={14} />}
                </i>
              </button>
            ))}
          </div>
        </section>
        <div className="production-start">
          <div>
            <strong>
              {selectedStyles.length} 种画风 · {selectedMotions.length} 组动作
            </strong>
            <p>预计 {requests} 次图像请求；整理动画不调用模型。动作图未通过本机检查（裁切、重复帧等）时会自动重做，最多 3 次，每次都是一次图像请求；网络或服务错误不自动重试。</p>
          </div>
          <button
            className="button primary"
            aria-label="开始自动制作桌宠"
            disabled={busy || !imageReady || !inputReady}
            onClick={() => void run(start)}
          >
            <WandSparkles size={16} />
            {jobs.some((j) => !['ready', 'cancelled'].includes(j.status))
              ? '创建新的制作任务'
              : '开始自动制作'}
          </button>
        </div>
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="success-note" role="status">
            {notice}
          </div>
        )}
        <section ref={taskRef} className="production-section production-jobs" aria-label="桌宠制作任务">
          <div className="production-section-heading">
            <div>
              <small>03 · 桌宠素材</small>
              <h4>制作进度与结果</h4>
            </div>
            <button className="text-button" disabled={busy} onClick={() => void refresh()}>
              <RefreshCw size={13} />
              刷新任务
            </button>
          </div>
          {!jobs.length && (
            <p className="empty-note">完成的角色图和动作会逐步保存在本机，关闭后可以从原任务继续。</p>
          )}
          {jobs.length > 0 && (
            <div className="production-job-tabs">
              {jobs.map((item) => (
                <button
                  key={item.id}
                  aria-pressed={item.id === selectedJobId}
                  disabled={busy}
                  onClick={() => {
                    setSelectedJobId(item.id);
                    setError('');
                    setNotice('');
                    void showResults(item.id).catch((e) => setError(userError(e)));
                  }}
                >
                  {item.styles.map(styleName).join(' / ')}
                  <small>
                    {item.revision ? `${revisionName(item)} · ` : ''}
                    {item.awaitingSelection
                      ? '待选角色图'
                      : item.status === 'ready'
                        ? '已完成'
                        : item.status === 'cancelled'
                          ? '已结束'
                          : `${item.steps.filter((s) => s.status === 'done').length}/${item.steps.length} 阶段`}
                  </small>
                </button>
              ))}
            </div>
          )}
          {job && (
            <>
              <p className="empty-note">
                当前任务：常规动作 {job.frameCount || 4} 帧 ·{' '}
                {{ natural: '自然', gentle: '轻柔', lively: '活泼' }[job.temperament || 'natural']}
                {job.transitionVersion === 3
                  ? ' · 新版十二帧动作流程'
                  : job.motions.some((m) => isActivity(m))
                    ? ' · 旧版八帧流程；请新建任务使用新版'
                    : ' · 旧版流程；请新建任务使用新版'}
                {(job.candidateCount || 1) > 1 ? ` · 每种画风 ${job.candidateCount} 张候选` : ''}
                {(job.candidateCount || 1) > 1 && job.candidateVariation
                  ? ` · ${job.candidateVariation === 'explore' ? '探索不同表现' : '同一方向微调'}`
                  : ''}
                {job.artDirection ? ` · ${job.artDirection}` : ''}
              </p>
              {job.revision && (
                <p className="empty-note" aria-label="本次修正说明">
                  <strong>{revisionName(job)}</strong> · {job.revision.feedback}
                </p>
              )}
              {job.styleReference && (
                <>
                  <StyleReferencePanel
                    reference={taskStyleReference?.id === job.styleReference.id ? taskStyleReference : null}
                    title="本任务使用的画风参考"
                    description={`${job.styleReference.name} · 用于本任务的非原作画风，后续角色修正沿用这张图片。上方新任务的设置不会改变它。`}
                  />
                  {taskStyleReferenceError && (
                    <p className="inline-error" role="alert">
                      画风参考暂时无法显示：{taskStyleReferenceError}
                    </p>
                  )}
                </>
              )}
              {masters.length > 0 && (
                <div ref={baseRef} className="production-base-review" aria-label="角色基准预览">
                  {job.awaitingSelection && (
                    <div className="production-selection-heading" role="status">
                      <strong>为{styleName(job.awaitingSelection)}选一个喜欢的形象</strong>
                      <p>核对脸部、发饰与衣服细节，选中的角色图会用于这套画风的全部动作。</p>
                    </div>
                  )}
                  <div className="production-base-grid">
                    {masters.map((base) => {
                      const siblings = masters.filter((item) => item.style === base.style);
                      const ordinal = siblings.findIndex((item) => item.id === base.id) + 1;
                      const selected = job.selectedBases?.[base.style] === base.id;
                      const selectable = job.awaitingSelection === base.style && job.status !== 'cancelled';
                      return (
                        <figure key={base.id} className={selected ? 'selected' : ''}>
                          <img
                            src={base.images.neutral}
                            alt={`${styleName(base.style)}角色候选 ${ordinal}`}
                          />
                          <figcaption>
                            <strong>
                              {styleName(base.style)}
                              {siblings.length > 1 ? ` · 候选 ${ordinal}` : ''}
                            </strong>
                            {base.generation?.chibiResearch && (
                              <div aria-label="Q版形象来源">
                                <span>{base.generation.chibiResearch.status === 'found' ? '已参考现成 Q 版形象' : '未找到可用参考 · 芙宁娜贴纸画风'}</span>
                                <small>{base.generation.chibiResearch.reason}</small>
                                {base.generation.chibiResearch.sources.map((source) => (
                                  <button type="button" className="text-button" key={source.url} onClick={() => void bridge.openExternal(source.url)}>{source.title}</button>
                                ))}
                              </div>
                            )}
                            {base.generation?.candidateDirection && (
                              <span className="production-candidate-direction" aria-label="候选表现方向">
                                {candidateDirections[base.generation.candidateDirection].label}
                              </span>
                            )}
                            <span>
                              {selected
                                ? '已选中 · 动作沿用此形象'
                                : siblings.length === 1
                                  ? '动作将沿用此形象'
                                  : '保留的角色候选'}
                            </span>
                            {base.generation?.parentSkinId &&
                              masters.some((item) => item.id === base.generation?.parentSkinId) && (
                                <span>根据已有候选修正</span>
                              )}
                          </figcaption>
                          <button
                            type="button"
                            className="text-button"
                            aria-label={`放大核对${styleName(base.style)}候选 ${ordinal}`}
                            aria-expanded={inspectedMasterId === base.id}
                            onClick={() => setInspectedMasterId(base.id)}
                          >
                            放大核对细节
                          </button>
                          {canEditBase(base.style) && (
                            <button
                              type="button"
                              className="button secondary"
                              aria-label={`修正${styleName(base.style)}候选 ${ordinal}`}
                              aria-expanded={baseEditSkinId === base.id}
                              disabled={busy || !imageReady || !!baseEditLimit(base.style)}
                              onClick={() => {
                                if (baseEditSkinId !== base.id) setBaseEditFeedback('');
                                setBaseEditSkinId(base.id);
                              }}
                            >
                              <WandSparkles size={14} />
                              修正这张
                            </button>
                          )}
                          {selectable && (
                            <button
                              className="button primary"
                              aria-label={`选择${styleName(base.style)}候选 ${ordinal} 并继续`}
                              disabled={busy || !imageReady}
                              onClick={() =>
                                void run(async () => {
                                  const selected = await bridge.selectPetBase({
                                    jobId: job.id,
                                    style: base.style,
                                    skinId: base.id,
                                  });
                                  updateJob(selected);
                                  await execute(selected);
                                })
                              }
                            >
                              <Check size={14} />
                              用这张继续
                            </button>
                          )}
                        </figure>
                      );
                    })}
                  </div>
                  {editSource && canEditBase(editSource.style) && (
                    <section className="production-revision production-base-edit" aria-label="修正角色候选">
                      <div>
                        <h4>先把这张角色图修满意</h4>
                        <p>
                          正在修正{styleName(editSource.style)} · 候选{' '}
                          {masters
                            .filter((item) => item.style === editSource.style)
                            .findIndex((item) => item.id === editSource.id) + 1}
                          。 新图与原候选都会保留，完成后先比较，再决定用哪张做动作。
                        </p>
                      </div>
                      <label className="production-master-select">
                        希望怎样改进（必填）
                        <textarea
                          aria-label="角色候选修正要求"
                          rows={3}
                          maxLength={600}
                          value={baseEditFeedback}
                          disabled={busy}
                          onChange={(event) => setBaseEditFeedback(event.target.value)}
                          placeholder="例如：保留发型、衣服和发饰，让眼睛更清晰，手指完整，裙摆边缘干净。"
                        />
                      </label>
                      <div className="production-revision-actions">
                        <p>预计 1 次图像编辑请求。完成后暂停等待选择，不自动生成动作。</p>
                        <div className="toolbar">
                          <button
                            type="button"
                            className="text-button"
                            aria-label="取消角色候选修正"
                            disabled={busy}
                            onClick={() => {
                              setBaseEditSkinId('');
                              setBaseEditFeedback('');
                            }}
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            className="button primary"
                            aria-label="生成角色候选修正版"
                            disabled={
                              busy ||
                              !imageReady ||
                              !baseEditFeedback.trim() ||
                              !!baseEditLimit(editSource.style)
                            }
                            onClick={() => void run(refineBase)}
                          >
                            <WandSparkles size={15} />
                            生成修正版
                          </button>
                        </div>
                      </div>
                    </section>
                  )}
                  {job.styles.filter(canEditBase).map(
                    (style) =>
                      baseEditLimit(style) && (
                        <p className="notice" role="status" key={`limit-${style}`}>
                          {styleName(style)}：{baseEditLimit(style)}
                        </p>
                      ),
                  )}
                  {job.styles.map((style) => {
                    const edit = job.baseEdits?.filter((item) => item.style === style).at(-1);
                    if (!edit) return null;
                    const recoverable =
                      canEditBase(style) && ['unsaved', 'failed', 'uncertain'].includes(edit.status);
                    return (
                      <section
                        className="production-base-edit-status"
                        aria-label={`${styleName(style)}候选修正状态`}
                        key={edit.id}
                      >
                        <div>
                          <strong>
                            {styleName(style)} · {baseEditStatusName[edit.status]}
                          </strong>
                          <p>{edit.feedback}</p>
                          {edit.error && (
                            <p className="inline-error" role="alert">
                              {edit.error}
                            </p>
                          )}
                        </div>
                        {recoverable && (
                          <button
                            type="button"
                            className="button secondary"
                            aria-label={
                              edit.status === 'unsaved'
                                ? `恢复${styleName(style)}候选修正保存`
                                : `重试${styleName(style)}候选修正`
                            }
                            disabled={busy || (edit.status !== 'unsaved' && !imageReady)}
                            onClick={() =>
                              void run(async () => {
                                const updated = await bridge.retryPetBaseEdit({
                                  jobId: job.id,
                                  editId: edit.id,
                                });
                                await finishBaseEdit(updated, edit.sourceSkinId, edit.id);
                              })
                            }
                          >
                            {edit.status === 'unsaved'
                              ? '仅恢复本机保存（不调用模型）'
                              : '重试这次修正（1 次图像请求）'}
                          </button>
                        )}
                      </section>
                    );
                  })}
                  {inspectedMasterId && (
                    <ArtworkInspection
                      candidates={masters}
                      references={character.visualReferences || []}
                      selectedId={inspectedMasterId}
                      comparisonSkin={inspectionOriginal}
                      onSelect={setInspectedMasterId}
                      onClose={() => setInspectedMasterId('')}
                    />
                  )}
                </div>
              )}
              <div className="production-step-list">
                {job.styles.map((style) => (
                  <div className="production-style-progress" key={style}>
                    <strong>{styleName(style)}</strong>
                    <div>
                      {job.steps
                        .filter((s) => s.style === style)
                        .map((step, index) => (
                          <span className={`production-step ${step.status}`} key={index}>
                            <i />
                            {stepName(step)}
                            <small>
                              {statusName[step.status]}
                              {step.attempts ? ` · 自动重做 ${step.attempts}/3` : ''}
                            </small>
                          </span>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
              {busy && progress && (
                <div className="progress-card" role="status">
                  <LoaderCircle className="spin" size={18} />
                  <div>
                    <strong>{progress.stage}</strong>
                    <p>{progress.detail}</p>
                  </div>
                </div>
              )}
              {currentStep?.error && (
                <div className="inline-error">
                  {styleName(currentStep.style)} · {stepName(currentStep)}：{currentStep.error}
                </div>
              )}
              <div className="toolbar production-task-actions">
                {busy ? (
                  <button
                    className="button secondary"
                    disabled={stopping}
                    onClick={() => {
                      stop.current = true;
                      setStopping(true);
                    }}
                  >
                    <Square size={13} />
                    {stopping ? '完成当前阶段后暂停…' : '完成当前阶段后暂停'}
                  </button>
                ) : currentStep &&
                  !job.awaitingSelection &&
                  !['failed', 'uncertain'].includes(currentStep.status) &&
                  job.status !== 'cancelled' ? (
                  <button
                    className="button primary"
                    onClick={() => void run(() => execute(job, currentStep.status === 'unsaved'))}
                  >
                    {currentStep.status === 'unsaved' ? '仅恢复本机保存' : '继续自动制作'}
                  </button>
                ) : null}
                {!busy &&
                  !job.awaitingSelection &&
                  currentStep &&
                  ['failed', 'uncertain'].includes(currentStep.status) &&
                  job.status !== 'cancelled' && (
                    <button
                      className="button secondary"
                      onClick={() =>
                        void run(async () => {
                          const retried = await bridge.retryPetStep({ jobId: job.id, index: pending });
                          updateJob(retried);
                          await execute(retried, currentStep.kind === 'pack');
                        })
                      }
                    >
                      {currentStep.kind === 'pack'
                        ? '重新整理图集（不调用模型）'
                        : `重新生成${stepName(currentStep)}并继续（调用图像 API）`}
                    </button>
                  )}
                {!busy && !['ready', 'cancelled'].includes(job.status) && (
                  <button
                    className="text-button"
                    onClick={() =>
                      void run(async () => {
                        const ended = await bridge.cancelPetJob(job.id);
                        updateJob(ended);
                        setNotice('任务已结束，已完成素材仍保留。');
                      })
                    }
                  >
                    结束此任务，保留素材
                  </button>
                )}
              </div>
              {job.results
                .flatMap((r) => r.warnings)
                .map((warning, i) => (
                  <p className="notice" key={i}>
                    {warning}
                  </p>
                ))}
            </>
          )}
        </section>
        {outputs.length > 0 && (
          <section ref={reviewRef} className="production-review" aria-label="自动桌宠核对">
            <div className="production-output-tabs">
              {outputs.map((s) => (
                <button
                  key={s.id}
                  aria-pressed={selectedSkinId === s.id}
                  disabled={busy}
                  onClick={() => setSelectedSkinId(s.id)}
                >
                  <SkinArtwork skin={s} />
                  <strong>{styleName(s.style)}</strong>
                  <small>
                    {skins.find((saved) => saved.id === s.id)?.review?.status === 'approved'
                      ? '已确认'
                      : skins.find((saved) => saved.id === s.id)?.review?.status === 'rejected'
                        ? '不采用'
                        : '待核对'}
                  </small>
                </button>
              ))}
            </div>
            {candidate && (
              <>
                <div className={`production-comparison${originalCandidate ? ' with-revision' : ''}`}>
                  <figure>
                    {character.visualReferences?.[0] && (
                      <img src={character.visualReferences[0].image} alt="角色主参考原图" />
                    )}
                    <figcaption>主参考原图 · 形象依据</figcaption>
                  </figure>
                  <AnimationPreview
                    key={`${candidate.id}:${originalCandidate?.id || ''}`}
                    skin={candidate}
                    comparisonSkin={originalCandidate}
                  />
                </div>
                {comparisonError && (
                  <p className="notice" role="status">
                    {comparisonError}
                  </p>
                )}
                {candidate.sprite && (
                  <FrameReview
                    key={candidate.id}
                    skin={candidate}
                    disabled={busy}
                    onChange={setFrameReview}
                  />
                )}
                {job?.status === 'ready' && job.results.some((result) => result.skinId === candidate.id) && (
                  <section className="production-revision" aria-label="修正桌宠成品">
                    <div>
                      <h4>把不满意的地方再做好一点</h4>
                      <p>为{styleName(candidate.style)}创建一份修正版。原成品仍保留，新成品核对后再启用。</p>
                    </div>
                    <label className="production-master-select">
                      修正范围
                      <select
                        aria-label="桌宠修正范围"
                        value={revisionTarget}
                        disabled={busy}
                        onChange={(e) => setRevisionTarget(e.target.value as PetMotion | 'base')}
                      >
                        <option value="base">修正角色形象并重做动作</option>
                        {job.motions.map((motion) => (
                          <option key={motion} value={motion}>
                            只修正{motions.find((item) => item.id === motion)?.name || motion}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="production-master-select">
                      希望怎样改进（必填）
                      <textarea
                        aria-label="桌宠修正要求"
                        rows={3}
                        maxLength={600}
                        value={revisionFeedback}
                        disabled={busy}
                        onChange={(e) => setRevisionFeedback(e.target.value)}
                        placeholder={
                          revisionTarget === 'base'
                            ? '例如：保留发型和服装，让脸部更圆润、眼睛更清晰，缩小后仍能看清发饰。'
                            : '例如：手掌保持五指，手臂动作更轻柔；各帧脸部和服装保持一致。'
                        }
                      />
                    </label>
                    <div className="production-revision-actions">
                      <p>
                        预计 {revisionRequests} 次图像请求。
                        {revisionTarget === 'base'
                          ? '先修正角色图，再重做这套画风的全部动作。'
                          : '沿用角色图和其他动作，只重新生成所选动作并整理动画。'}
                      </p>
                      <button
                        className="button secondary"
                        aria-label="创建桌宠修正版"
                        disabled={busy || !imageReady || !revisionFeedback.trim()}
                        onClick={() => void run(revise)}
                      >
                        <WandSparkles size={15} />
                        制作修正版
                      </button>
                    </div>
                  </section>
                )}
                <div className="generation-checks">
                  {checks.map((label, i) => (
                    <label className="checkbox-label" key={label}>
                      <input
                        type="checkbox"
                        checked={checked[i]}
                        disabled={busy}
                        onChange={(e) =>
                          setChecked((values) =>
                            values.map((value, n) => (n === i ? e.target.checked : value)),
                          )
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <div className="toolbar">
                  <button
                    className="button primary"
                    aria-label="确认形象并启用桌宠"
                    disabled={!canReview}
                    onClick={() =>
                      void run(async () => {
                        const reviewed = await bridge.reviewSkin({
                          characterId: character.id,
                          skinId: candidate.id,
                          decision: 'approved',
                          ...(frameReview ? { frameReview } : {}),
                        });
                        await onSaveSkin(reviewed, true);
                        setNotice('已启用为当前桌宠。点击人物、休息和聊天会播放素材实际支持的动作。');
                      })
                    }
                  >
                    <Check size={15} />
                    确认形象并启用桌宠
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy || candidate.review?.status !== 'approved'}
                    onClick={() =>
                      void run(async () => {
                        await onSaveSkin(candidate, true);
                        await bridge.openPet();
                      })
                    }
                  >
                    来到桌面
                    <ArrowUpRight size={14} />
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy || candidate.review?.status !== 'approved'}
                    onClick={() =>
                      void run(async () => {
                        if (await bridge.exportCharacter({ character, skins: [candidate] }))
                          setNotice('角色图、动作时序与角色资料已导出，不含密钥和聊天记录。');
                      })
                    }
                  >
                    <Download size={15} />
                    导出桌宠角色包
                  </button>
                  <button
                    className="text-button"
                    disabled={busy || candidate.review?.status !== 'pending'}
                    onClick={() =>
                      void run(async () => {
                        const reviewed = await bridge.reviewSkin({
                          characterId: character.id,
                          skinId: candidate.id,
                          decision: 'rejected',
                        });
                        await onSaveSkin(reviewed, false);
                        setNotice(
                          '已标记为不采用并保留素材。可以创建这套画风的新任务，调整原图或动作后重新制作。',
                        );
                      })
                    }
                  >
                    形象不对，标记为不采用
                  </button>
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </Modal>
  );
}
