import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  BookOpen,
  Copy,
  Eye,
  Hand,
  Heart,
  History,
  Monitor,
  Moon,
  MoreHorizontal,
  Pointer,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Volume2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { supportsAction } from '../../artwork';
import { createTouchGestures } from '../../touchGestures';
import { hitCharacter, overHead } from '../../animation/framing';
import type { Character, ChatMessage, CompanionEvent, Skin } from '../../types';
import { momentOffers, type MomentId } from '../../life';

// Reveal a new line a few characters at a time, like someone speaking; instant under reduced motion.
function useTypewriter(text: string, enabled: boolean) {
  const [shown, setShown] = useState(text.length);
  useEffect(() => {
    if (!enabled || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(text.length);
      return;
    }
    setShown(0);
    const step = Math.max(1, Math.ceil(text.length / 90));
    const timer = setInterval(() => {
      setShown((count) => {
        if (count + step >= text.length) clearInterval(timer);
        return Math.min(text.length, count + step);
      });
    }, 28);
    return () => clearInterval(timer);
  }, [text, enabled]);
  return text.slice(0, shown);
}

interface Props {
  character: Pick<Character, 'name' | 'work'>;
  skin?: Skin;
  skins: Skin[];
  avatar: ReactNode;
  /** Character zoom on the stage, changed by scrolling or pinching over her. */
  zoom: number;
  onZoom: (zoom: number) => void;
  thumbnail: (skin: Skin) => ReactNode;
  composer: ReactNode;
  setup?: ReactNode;
  drawer?: ReactNode;
  quickReplies: { label: string; text: string }[];
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
  presence: string;
  touchCharacter: (kind: 'headpat' | 'poke') => void;
  interact: (event: CompanionEvent) => void;
  onWatch: () => void;
  copyMessage: (text: string) => void;
  speak: (text: string) => void;
  sendQuick: (text: string) => void;
  chooseSkin: (skin: Skin) => void;
  onHideBubble: () => void;
  onOpenConversation: () => void;
  onOpenStudio: () => void;
  onOpenAppearance: () => void;
  onOpenDesktop: () => void;
  onToggleSettings: () => void;
  onToggleTracking: () => void;
  invitation: string;
  onAcceptInvitation: () => void;
  onDeclineInvitation: () => void;
  onOpenMoment: (id: MomentId) => void;
  momentPanel?: ReactNode;
}

const WARDROBE_LIMIT = 4;

export function CompanionScene({
  character,
  skin,
  skins,
  avatar,
  zoom,
  onZoom,
  thumbnail,
  composer,
  setup,
  drawer,
  quickReplies,
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
  presence,
  touchCharacter,
  interact,
  copyMessage,
  speak,
  sendQuick,
  chooseSkin,
  onHideBubble,
  onOpenConversation,
  onOpenStudio,
  onOpenAppearance,
  onOpenDesktop,
  onWatch,
  onToggleSettings,
  onToggleTracking,
  invitation,
  onAcceptInvitation,
  onDeclineInvitation,
  onOpenMoment,
  momentPanel,
}: Props) {
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clearHold = () => clearTimeout(holdTimer.current);
  useEffect(() => { clearHold(); gesture.current.reset(); suppressClick.current = false; return clearHold; }, [character.name, skin?.id, interactionBusy, talking, resting]);
  const gesture = useRef(createTouchGestures());
  const suppressClick = useRef(false);
  const [wardrobeOpen, setWardrobeOpen] = useState(false);
  const [momentMenu, setMomentMenu] = useState(false);
  const showBubble =
    Boolean(invitation) || (!bubbleHidden && Boolean(interactionLine || lastReply)) || interactionBusy;
  const spoken = invitation || interactionLine || lastReply?.content || '';
  const typed = useTypewriter(spoken, motionEnabled && !interactionBusy);
  // Keep the current outfit visible even when it falls outside the first few.
  const shelf = skins.slice(0, WARDROBE_LIMIT);
  if (skin && !shelf.some((item) => item.id === skin.id)) shelf[shelf.length - 1] = skin;
  return (
    <section
      className={`room-scene ${skin ? '' : 'no-appearance'} ${drawer ? 'drawer-open' : ''} ${momentPanel ? 'moment-open' : ''}`}
    >
      <header className="room-header">
        <div className="room-identity">
          <h1>{character.name}</h1>
          <span className="room-presence">
            <i aria-hidden="true" />
            {character.work || '原创角色'}
            <span aria-hidden="true">·</span>
            {resting ? '正在休息' : presence}
          </span>
        </div>
        <div className="room-actions">
          <button className="room-pill" onClick={onOpenStudio}>
            <BookOpen size={17} />
            角色工作室
          </button>
          <button className="room-pill dark" disabled={!skin} onClick={onOpenDesktop}>
            <Monitor size={17} />
            放到桌面
          </button>
        </div>
      </header>

      {setup && <div className="room-setup">{setup}</div>}

      <div className="room-floor" aria-hidden="true" />
      <div
        className="scene-artwork room-figure"
        style={{ '--stage-zoom': zoom } as CSSProperties}
        onWheel={(event) => {
          // A trackpad pinch arrives as a wheel event with ctrlKey.
          onZoom(zoom * Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.001)));
        }}
        onPointerDown={(event) => {
          if (event.button === 0 && skin && !interactionBusy && !talking && !resting && hitCharacter(event.currentTarget, event.clientX, event.clientY)) {
            suppressClick.current = false;
            gesture.current.down(performance.now());
            clearHold();
            holdTimer.current = setTimeout(() => { gesture.current.up(); suppressClick.current = true; touchCharacter('headpat'); }, 650);
          }
        }}
        onPointerLeave={() => { clearHold(); gesture.current.reset(); }}
        onPointerCancel={() => { clearHold(); gesture.current.reset(); }}
        onPointerMove={(event) => {
          if (!skin || interactionBusy || talking || resting || event.pointerType === 'touch') return;
          const head = overHead(event.currentTarget, event.clientX, event.clientY);
          const figure = head || !!hitCharacter(event.currentTarget, event.clientX, event.clientY);
          const result = gesture.current.sample(event.clientX, performance.now(), head, figure);
          if (result) {
            suppressClick.current = true;
            if (result === 'watch') onWatch(); else touchCharacter('headpat');
          }
        }}
        onPointerUp={(event) => {
          clearHold();
          gesture.current.up();
          if (suppressClick.current) { suppressClick.current = false; return; }
          if (!skin || interactionBusy || talking || resting || event.button !== 0) return;
          const hit = hitCharacter(event.currentTarget, event.clientX, event.clientY);
          if (hit) touchCharacter(hit);
        }}
      >
        {avatar}
        {skin && <span className="room-gesture-hint">轻点回应 · 头顶来回轻抚 · 按住陪伴</span>}
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

      <div className="room-dialogue">
        {showBubble && (
          <section className="room-bubble" aria-label="角色回复气泡" role="status">
            <span className="room-bubble-tail" aria-hidden="true" />
            <div className="room-bubble-heading">
              <strong>{character.name}</strong>
              {!interactionBusy && (invitation || interactionLine || lastReply?.origin === 'script') && (
                <small>{invitation ? '想邀请你' : interactionLine ? '日常互动' : '本地台词'}</small>
              )}
              {!interactionBusy && !invitation && (
                <button aria-label="收起回复气泡" onClick={onHideBubble}>
                  <X size={14} />
                </button>
              )}
            </div>
            {interactionBusy ? (
              <p className="room-thinking" aria-label="正在想怎么回应你">
                <i />
                <i />
                <i />
              </p>
            ) : (
              <p>
                {/* Screen readers get the whole line at once; the typed reveal is decorative. */}
                <span className="room-line">{spoken}</span>
                <span aria-hidden="true">{typed}</span>
              </p>
            )}
            {invitation && !interactionBusy && (
              <div className="room-invite">
                <button className="primary" onClick={onAcceptInvitation}>
                  好呀
                </button>
                <button onClick={onDeclineInvitation}>等会儿</button>
              </div>
            )}
            {!interactionBusy && !invitation && !interactionLine && lastReply && (
              <div className="room-bubble-tools">
                <button aria-label="复制回复" title="复制" onClick={() => copyMessage(lastReply.content)}>
                  <Copy size={14} />
                </button>
                <button
                  aria-label="朗读回复"
                  title="朗读"
                  disabled={audioBusy || lastReply.origin === 'script'}
                  onClick={() => speak(lastReply.content)}
                >
                  <Volume2 size={14} />
                </button>
                <button aria-label="查看对话记录" title="对话记录" onClick={onOpenConversation}>
                  <History size={14} />
                </button>
              </div>
            )}
          </section>
        )}
        {!interactionBusy && !invitation && (
          <div className="room-quick" role="group" aria-label="快捷回复">
            {quickReplies.map((reply) => (
              <button key={reply.label} onClick={() => sendQuick(reply.text)}>
                {reply.label}
              </button>
            ))}
            <button
              className="room-quick-moments"
              aria-expanded={momentMenu}
              onClick={() => setMomentMenu(!momentMenu)}
            >
              <Heart size={14} />
              一起做点什么
            </button>
          </div>
        )}
        {momentMenu && !interactionBusy && !invitation && (
          <div className="room-moment-menu" role="group" aria-label="一起做点什么">
            {(Object.keys(momentOffers) as MomentId[]).map((id) => (
              <button
                key={id}
                onClick={() => {
                  setMomentMenu(false);
                  onOpenMoment(id);
                }}
              >
                {momentOffers[id].title}
              </button>
            ))}
          </div>
        )}
      </div>
      {momentPanel && <div className="room-moment">{momentPanel}</div>}

      {skins.length > 0 && (
        <div className={`room-wardrobe ${wardrobeOpen ? 'open' : ''}`} role="group" aria-label="换装">
          <span>换装</span>
          {(wardrobeOpen ? skins : shelf).map((item) => (
            <button
              key={item.id}
              className={skin?.id === item.id ? 'active' : ''}
              aria-pressed={skin?.id === item.id}
              aria-label={item.name}
              title={item.name}
              onClick={() => chooseSkin(item)}
            >
              {thumbnail(item)}
            </button>
          ))}
          {skins.length > WARDROBE_LIMIT && (
            <button
              className="room-wardrobe-more"
              aria-label={wardrobeOpen ? '收起外观' : `全部 ${skins.length} 套外观`}
              aria-expanded={wardrobeOpen}
              onClick={() => setWardrobeOpen(!wardrobeOpen)}
            >
              {wardrobeOpen ? <X size={16} /> : <MoreHorizontal size={18} />}
            </button>
          )}
        </div>
      )}

      <div className="room-tools">
        {sceneSettingsOpen && (
          <div className="room-tools-menu">
            <button
              disabled={!motionEnabled || !supportsAction(skin, 'wave') || interactionBusy}
              onClick={() => interact('greet')}
              aria-label="让角色打招呼"
              title={supportsAction(skin, 'wave') ? '打招呼' : '当前外观没有招呼动作'}
            >
              <Sparkles size={16} />
              打招呼
            </button>
            <button
              disabled={interactionBusy || talking}
              aria-label={resting ? '唤醒角色' : '让角色休息'}
              onClick={() => interact(resting ? 'wake' : 'rest')}
            >
              {resting ? <Sun size={16} /> : <Moon size={16} />}
              {resting ? '唤醒' : '休息'}
            </button>
            <button
              className={tracking ? 'active' : ''}
              onClick={onToggleTracking}
              disabled={skin?.kind !== 'live2d' && skin?.kind !== 'vrm'}
              aria-label="切换视线跟随"
              aria-pressed={tracking}
            >
              <Eye size={16} />
              视线跟随
            </button>
            <button aria-label="缩小角色" onClick={() => onZoom(zoom / 1.12)} disabled={zoom <= 0.6}>
              <ZoomOut size={16} />
              缩小
            </button>
            <button aria-label="放大角色" onClick={() => onZoom(zoom * 1.12)} disabled={zoom >= 1.6}>
              <ZoomIn size={16} />
              放大 {Math.round(zoom * 100)}%
            </button>
            <button onClick={onOpenAppearance} aria-label="打开外观调整">
              <SlidersHorizontal size={16} />
              动作与表情
            </button>
          </div>
        )}
        <button
          className="room-tools-toggle"
          aria-label={sceneSettingsOpen ? '收起人物设置' : '展开人物设置'}
          aria-expanded={sceneSettingsOpen}
          title="人物设置"
          onClick={onToggleSettings}
        >
          {sceneSettingsOpen ? <X size={18} /> : <MoreHorizontal size={18} />}
        </button>
      </div>

      {drawer}
      <div className="room-composer">{composer}</div>
    </section>
  );
}
