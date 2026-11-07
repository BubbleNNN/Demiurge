import type { ReactNode } from 'react';
import {
  ArrowUpRight,
  ChevronDown,
  Copy,
  Eye,
  Hand,
  Monitor,
  Moon,
  Pointer,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Volume2,
  X,
} from 'lucide-react';
import { supportsAction } from '../../artwork';
import { hitCharacter } from '../../animation/framing';
import { engineName } from '../../theme';
import type { Character, ChatMessage, CompanionEvent, Skin } from '../../types';

interface Props {
  character: Pick<Character, 'name' | 'work'>;
  skin?: Skin;
  avatar: ReactNode;
  interactionBusy: boolean;
  talking: boolean;
  resting: boolean;
  touchFeedback: { kind: 'headpat' | 'poke'; key: number } | null;
  bubbleHidden: boolean;
  interactionLine: string;
  lastReply?: ChatMessage;
  audioBusy: boolean;
  sceneSettingsOpen: boolean;
  tracking: boolean;
  motionEnabled: boolean;
  skinReview: string;
  presence: string;
  touchCharacter: (kind: 'headpat' | 'poke') => void;
  interact: (event: CompanionEvent) => void;
  copyMessage: (text: string) => void;
  speak: (text: string) => void;
  onHideBubble: () => void;
  onOpenConversation: () => void;
  onOpenProfile: () => void;
  onOpenAppearance: () => void;
  onOpenDesktop: () => void;
  onToggleSettings: () => void;
  onToggleTracking: () => void;
}

export function CompanionScene({
  character,
  skin,
  avatar,
  interactionBusy,
  talking,
  resting,
  touchFeedback,
  bubbleHidden,
  interactionLine,
  lastReply,
  audioBusy,
  sceneSettingsOpen,
  tracking,
  motionEnabled,
  skinReview,
  presence,
  touchCharacter,
  interact,
  copyMessage,
  speak,
  onHideBubble,
  onOpenConversation,
  onOpenProfile,
  onOpenAppearance,
  onOpenDesktop,
  onToggleSettings,
  onToggleTracking,
}: Props) {
  return (
    <section className={`character-scene ${skin ? '' : 'no-appearance'}`}>
      <div className="scene-floor" aria-hidden="true" />
      <div className="scene-intro">
        <span className="character-work">{character.work || '你的原创角色'}</span>
        <h1>{character.name}</h1>
        <button className="scene-profile" onClick={onOpenProfile}>
          角色档案
          <ArrowUpRight size={14} />
        </button>
      </div>
      <div
        className="scene-artwork"
        onPointerUp={(event) => {
          if (!skin || interactionBusy || talking || resting || event.button !== 0) return;
          const hit = hitCharacter(event.currentTarget, event.clientX, event.clientY);
          if (hit) touchCharacter(hit);
        }}
      >
        {avatar}
        {skin && (
          <div className="character-touch-zones" aria-label="人物互动区域">
            <button
              className="touch-zone head-zone"
              aria-label="摸摸角色的头"
              title="摸摸头"
              disabled={interactionBusy || talking || resting}
              onClick={(event) => {
                if (event.detail === 0) touchCharacter('headpat');
              }}
            >
              <span>
                <Hand size={14} />
                摸摸头
              </span>
            </button>
            <button
              className="touch-zone poke-zone"
              aria-label="戳一戳角色"
              title="戳一戳"
              disabled={interactionBusy || talking || resting}
              onClick={(event) => {
                if (event.detail === 0) touchCharacter('poke');
              }}
            >
              <span>
                <Pointer size={14} />
                戳一戳
              </span>
            </button>
          </div>
        )}
        {touchFeedback && (
          <div key={touchFeedback.key} className={`touch-feedback ${touchFeedback.kind}`} aria-hidden="true">
            <i>{touchFeedback.kind === 'headpat' ? '♡' : '✧'}</i>
            <i>{touchFeedback.kind === 'headpat' ? '♡' : '✦'}</i>
            <i>{touchFeedback.kind === 'headpat' ? '♡' : '✧'}</i>
          </div>
        )}
      </div>
      {((!bubbleHidden && (interactionLine || lastReply)) || interactionBusy) && (
        <section className="scene-reply-bubble" aria-label="角色回复气泡" role="status">
          <div className="scene-bubble-heading">
            <strong>{character.name}</strong>
            <small>
              {interactionBusy
                ? '正在想怎么回应你'
                : interactionLine
                  ? '日常互动'
                  : lastReply?.origin === 'script'
                    ? '本地台词'
                    : '角色回复'}
            </small>
            {!interactionBusy && (
              <button aria-label="收起回复气泡" onClick={onHideBubble}>
                <X size={14} />
              </button>
            )}
          </div>
          <p>{interactionBusy ? '让我想一想……' : interactionLine || lastReply?.content}</p>
          {!interactionBusy && !interactionLine && lastReply && (
            <div className="scene-bubble-tools">
              <button className="text-button" onClick={() => copyMessage(lastReply.content)}>
                <Copy size={12} />
                复制
              </button>
              <button
                className="text-button"
                disabled={audioBusy || lastReply.origin === 'script'}
                onClick={() => speak(lastReply.content)}
              >
                <Volume2 size={12} />
                朗读
              </button>
              <button className="text-button" onClick={onOpenConversation}>
                展开对话
                <ChevronDown size={12} />
              </button>
            </div>
          )}
        </section>
      )}
      {sceneSettingsOpen && (
        <div className="scene-engine">
          <span />
          <span>{engineName(skin)}</span>
          {skin && skinReview && <small>{skinReview}</small>}
        </div>
      )}
      <div className="scene-controls">
        <button
          aria-label={sceneSettingsOpen ? '收起人物设置' : '展开人物设置'}
          aria-expanded={sceneSettingsOpen}
          onClick={onToggleSettings}
          title="人物设置"
        >
          <Settings2 size={16} />
        </button>
        {sceneSettingsOpen && (
          <>
            <button
              className={tracking ? 'active' : ''}
              onClick={onToggleTracking}
              disabled={skin?.kind !== 'live2d' && skin?.kind !== 'vrm'}
              aria-label="切换视线跟随"
              title="模型视线跟随"
            >
              <Eye size={16} />
            </button>
            <button
              disabled={!motionEnabled || !supportsAction(skin, 'wave')}
              onClick={() => interact('greet')}
              aria-label="让角色打招呼"
              title={supportsAction(skin, 'wave') ? '打招呼' : '当前外观没有招呼动作'}
            >
              <Sparkles size={16} />
            </button>
            <button
              disabled={interactionBusy || talking}
              aria-label={resting ? '唤醒角色' : '让角色休息'}
              title={resting ? '唤醒' : '休息'}
              onClick={() => interact(resting ? 'wake' : 'rest')}
            >
              {resting ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button onClick={onOpenAppearance} aria-label="打开外观调整" title="调整外观">
              <SlidersHorizontal size={16} />
            </button>
          </>
        )}
      </div>
      <div className="scene-bottom">
        <div className="scene-presence">
          <i />
          <span>
            {resting ? '正在休息' : presence}
            <small>{resting ? '轻声陪伴，醒来再继续' : '试着点一下头顶或身体'}</small>
          </span>
        </div>
        <button className="button primary desktop-shortcut" onClick={onOpenDesktop}>
          <Monitor size={16} />
          来到桌面
          <ArrowUpRight size={14} />
        </button>
      </div>
    </section>
  );
}
