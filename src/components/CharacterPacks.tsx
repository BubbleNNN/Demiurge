import { useEffect, useState } from 'react';
import { Check, Download, FolderHeart, LoaderCircle, MessageCircle, Upload } from 'lucide-react';
import { Modal } from './Modal';
import { AnimationPreview } from './AnimationPreview';
import { SkinArtwork } from './SkinArtwork';
import { starterPack } from '../characterPacks';
import { interactionNames } from '../companion';
import { styleName } from '../theme';
import { supportsAction, spriteAnimation } from '../artwork';
import { userError } from '../errors';
import type { ArtStyle, Character, CompanionEvent, CompanionProfile, Skin } from '../types';

const events = Object.keys(interactionNames) as CompanionEvent[];
const actionLabels = {
  idle: '待机',
  wave: '招呼',
  sleep: '休息',
  nod: '点头',
  shake: '摇头',
  bounce: '小跳',
} as const;
export function CharacterPacks({
  character,
  skins,
  onInstall,
  onSaveProfile,
  onExport,
  onImport,
  onAssets,
  onSetup,
  onClose,
  onBusy,
}: {
  character: Character;
  skins: Skin[];
  onInstall: (style: ArtStyle) => Promise<void>;
  onSaveProfile: (profile: CompanionProfile, base: CompanionProfile | undefined) => Promise<void>;
  onExport: () => Promise<boolean>;
  onImport: () => Promise<void>;
  onAssets: () => void;
  onSetup: () => void;
  onClose: () => void;
  onBusy?: (busy: boolean) => void;
}) {
  const [tab, setTab] = useState<'current' | 'library' | 'lines'>(
    character.id === starterPack.character.id ? 'library' : 'current',
  );
  const [selected, setSelected] = useState(
    starterPack.skins.find((skin) => skin.style === '8bit') || starterPack.skins[0],
  );
  const [draft, setDraft] = useState(character.companion?.replies || {});
  const [base, setBase] = useState(character.companion);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    onBusy?.(busy);
    return () => onBusy?.(false);
  }, [busy, onBusy]);
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await task();
    } catch (error) {
      setError(userError(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="角色包与本地互动"
      subtitle="选择已经制作好的外观和动作，配上属于角色的日常回应。"
      onClose={onClose}
      wide
    >
      <div className="pack-tabs" role="tablist" aria-label="角色包内容">
        <button role="tab" aria-selected={tab === 'current'} onClick={() => setTab('current')}>
          <FolderHeart size={16} />
          {character.name}的素材
        </button>
        <button role="tab" aria-selected={tab === 'library'} onClick={() => setTab('library')}>
          <FolderHeart size={16} />
          精选角色包
        </button>
        <button role="tab" aria-selected={tab === 'lines'} onClick={() => setTab('lines')}>
          <MessageCircle size={16} />
          {character.name}的互动台词
        </button>
      </div>
      {tab === 'current' ? (
        <section className="pack-current">
          <span className="page-kicker">当前人物 · {character.work || '原创角色'}</span>
          <h3>{character.name}的外观与动作</h3>
          <p>
            {skins.length
              ? `这个人物有 ${skins.length} 套已保存外观。新画风和动作可以继续通过素材导入添加。`
              : '这个人物还没有自己的外观。收集真实原图后可以直接作为立绘，或导入已经制作好的动画。'}
          </p>
          <div className="toolbar">
            <button className="button primary" onClick={onSetup}>
              设置当前角色外观
            </button>
            <button className="button secondary" disabled={busy} onClick={onAssets}>
              添加外观与动作
            </button>
            <button className="button secondary" disabled={busy} onClick={() => void run(onImport)}>
              <Upload size={15} />
              导入角色包
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (await onExport()) setNotice('已导出当前角色包。');
                })
              }
            >
              <Download size={15} />
              导出当前角色包
            </button>
          </div>
          <p className="fine-print">
            精选包目前提供昔涟。打开精选库只是预览；使用其他人物的角色包会切换人物，不会变成这个角色的新画风。
          </p>
        </section>
      ) : tab === 'library' ? (
        <>
          <div className="pack-layout">
            <section className="pack-description">
              <span className="page-kicker">随项目提供 · 本地播放</span>
              <h3>{starterPack.title}</h3>
              <p>{starterPack.description}</p>
              <div className="pack-outfits">
                {starterPack.skins.map((skin) => (
                  <button
                    key={skin.id}
                    aria-label={`角色包外观：${styleName(skin.style)}`}
                    aria-pressed={selected.id === skin.id}
                    className={selected.id === skin.id ? 'selected' : ''}
                    onClick={() => setSelected(skin)}
                  >
                    <span>
                      <SkinArtwork skin={skin} />
                    </span>
                    <strong>{styleName(skin.style)}</strong>
                    <small>
                      {spriteAnimation(skin)
                        ? `${spriteAnimation(skin)!.frames.length} 个完整姿势 / 原画逐帧`
                        : `${styleName(skin.style)} / 静态展示`}
                    </small>
                    {selected.id === skin.id && <Check size={15} />}
                  </button>
                ))}
              </div>
              <div className="pack-capabilities">
                <strong>这套外观可以做什么</strong>
                <div>
                  {Object.entries(actionLabels)
                    .filter(([action]) => supportsAction(selected, action as keyof typeof actionLabels))
                    .map(([action, label]) => (
                      <span key={action}>{label}</span>
                    ))}
                  {spriteAnimation(selected)?.clips.blink && <span>眨眼</span>}
                  {spriteAnimation(selected)?.clips.talk && <span>口型</span>}
                </div>
                <p>
                  {spriteAnimation(selected)
                    ? '休息使用已有闭眼姿势。没有走路、跳舞或投喂动作；可通过素材制作入口继续补充。'
                    : '复用已经制作的立绘。要让手、头发或身体活动，需要额外的动作图片或已绑定模型。'}
                </p>
              </div>
              <p className="fine-print">
                外观沿用此前制作的二次创作素材。本地台词由项目编写，可编辑，不作为原作语音或剧情证据。
              </p>
              <button
                className="button primary full"
                aria-label="使用昔涟角色包"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await onInstall(selected.style);
                    onClose();
                  })
                }
              >
                {busy ? <LoaderCircle className="spin" size={16} /> : <FolderHeart size={16} />}使用这套角色包
              </button>
            </section>
            <section className="pack-preview" aria-label="角色包动作预览">
              <AnimationPreview key={selected.id} skin={selected} />
            </section>
          </div>
          <section className="pack-transfer">
            <div>
              <strong>你的 {character.name} 角色包</strong>
              <p>
                {skins.filter((skin) => !skin.model).length} 套图片外观 · 携带设定、图片、逐帧动作与本地台词
              </p>
            </div>
            <div className="toolbar">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (await onExport()) setNotice('已导出可离线导入的角色包。');
                  })
                }
              >
                <Download size={15} />
                导出当前角色包
              </button>
              <button className="button secondary" disabled={busy} onClick={() => void run(onImport)}>
                <Upload size={15} />
                导入角色包
              </button>
              <button className="text-button" disabled={busy} onClick={onAssets}>
                添加外观与动作
              </button>
            </div>
            <small>Live2D、VRM 和 GLB 文件请单独导入。角色包不携带聊天记录、个人记忆或 API Key。</small>
          </section>
        </>
      ) : (
        <section className="pack-lines">
          <div className="notice">
            <p>
              本地台词根据明确的场景或关键词选择，不调用模型。每个场景最多 12
              句，每行一句；留空时使用简短通用回应。自由聊天仍可切换到模型对话。
            </p>
          </div>
          <div className="pack-line-grid">
            {events.map((event) => (
              <label key={event}>
                {interactionNames[event]}
                <textarea
                  aria-label={`互动台词：${interactionNames[event]}`}
                  rows={3}
                  maxLength={12000}
                  value={(draft[event] || []).join('\n')}
                  onChange={(e) => setDraft({ ...draft, [event]: e.target.value.split('\n') })}
                />
              </label>
            ))}
          </div>
          <button
            className="button primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const replies = Object.fromEntries(
                  events.map((event) => [
                    event,
                    (draft[event] || []).map((line) => line.trim()).filter(Boolean),
                  ]),
                );
                if (
                  Object.values(replies).some(
                    (lines) => lines.length > 12 || lines.some((line) => line.length > 1000),
                  )
                )
                  throw new Error('每个场景最多 12 句，每句最多 1000 字。');
                const profile: CompanionProfile = { version: 1, replies };
                await onSaveProfile(profile, base);
                setBase(profile);
                setNotice('互动台词已保存。');
              })
            }
          >
            {busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}保存互动台词
          </button>
        </section>
      )}
      {error && <div className="inline-error">{error}</div>}
      {notice && (
        <div className="success-note" role="status">
          {notice}
        </div>
      )}
    </Modal>
  );
}
