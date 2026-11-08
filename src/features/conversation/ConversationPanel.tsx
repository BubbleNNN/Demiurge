import type { ReactNode, RefObject } from 'react';
import {
  ArrowUp,
  ArrowUpRight,
  History,
  ChevronDown,
  ChevronUp,
  Copy,
  LoaderCircle,
  MessageCircle,
  MoreHorizontal,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Square,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { Character, ChatMessage, ChatStatus, PetAction } from '../../types';

// room: the composer pill under the character. history: the message list inside the drawer.
export type ConversationMode = 'compact' | 'full' | 'pet' | 'room' | 'history';
interface Props {
  mode: ConversationMode;
  character: Pick<Character, 'id' | 'name'>;
  thumbnail: ReactNode;
  messages: ChatMessage[];
  message: string;
  localChat: boolean;
  connected: boolean;
  chatBusy: boolean;
  sharedChatStatus: ChatStatus;
  chatError: string;
  chatStopping: boolean;
  chatExpanded: boolean;
  audioBusy: boolean;
  talking: boolean;
  // True only while synthesized speech is playing (talking also covers scripted mouth motion).
  speaking?: boolean;
  newTopicPending: boolean;
  replyNeedsSave: boolean;
  historyRef: RefObject<HTMLDivElement | null>;
  actionNames: Record<PetAction, string>;
  switchChatMode: (mode: 'model' | 'local') => Promise<void>;
  sendChat: (text?: string, retry?: boolean) => Promise<void>;
  copyMessage: (text: string) => void;
  speak: (text: string) => void;
  stopChat: () => void;
  stopAudio: () => void;
  beginTopic: () => void;
  onDraft: (value: string) => void;
  onCancelTopic: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  onToggleExpanded: () => void;
}

export function ConversationPanel({
  mode,
  character,
  thumbnail,
  messages,
  message,
  localChat,
  connected,
  chatBusy,
  sharedChatStatus,
  chatError,
  chatStopping,
  chatExpanded,
  audioBusy,
  talking,
  speaking = false,
  newTopicPending,
  replyNeedsSave,
  historyRef,
  actionNames,
  switchChatMode,
  sendChat,
  copyMessage,
  speak,
  stopChat,
  stopAudio,
  beginTopic,
  onDraft,
  onCancelTopic,
  onOpenHistory,
  onOpenSettings,
  onToggleExpanded,
}: Props) {
  const petMode = mode === 'pet';
  const room = mode === 'room';
  const historyOnly = mode === 'history';
  const interactionBusy = chatBusy || sharedChatStatus.busy;
  const connection = (
    <span className="connection-text">
      <i className={connected || localChat ? 'online' : ''} />
      {chatBusy
        ? '正在组织语言…'
        : sharedChatStatus.busy
          ? sharedChatStatus.mode === 'preview'
            ? '正在试聊角色语气…'
            : '另一窗口正在等待回复…'
          : localChat
            ? '本地台词 · 无模型请求'
            : connected
              ? '对话服务已配置'
              : '等待连接对话服务'}
    </span>
  );
  // Model chat without a configured service gets a visible warning on the mode pill.
  const offline = !localChat && !connected;
  const chatPreferences = (
    <details
      className={`chat-preferences ${room && offline ? 'offline' : ''}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.currentTarget.open = false;
          event.currentTarget.querySelector('summary')?.focus();
        }
      }}
    >
      <summary>
        <Settings2 size={13} />
        <span className="chat-options-label">对话选项</span>
        <span className="chat-mode-label">{localChat ? '本地台词' : '模型对话'}</span>
        <ChevronDown size={13} />
      </summary>
      <div className="chat-mode-picker" aria-label="选择对话方式">
        <button
          aria-pressed={!localChat}
          disabled={interactionBusy}
          onClick={() => void switchChatMode('model')}
        >
          模型对话
        </button>
        <button
          aria-pressed={localChat}
          disabled={interactionBusy}
          onClick={() => void switchChatMode('local')}
        >
          本地台词
        </button>
        {room ? connection : <span>{localChat ? '按场景回应' : '自由聊天'}</span>}
      </div>
    </details>
  );
  const history = (
    <div className="chat-history" id="conversation-history" ref={historyRef} aria-label="展开的对话记录">
      {!messages.length && (
        <div className="conversation-empty">
          <span className="empty-orbit">
            <MessageCircle size={25} />
            <i>✦</i>
          </span>
          <h3>故事，从一句你好开始</h3>
          <p>
            {localChat
              ? '试试“你好”“给我一点鼓励”或“晚安”。本地模式使用已编写的台词。'
              : connected
                ? `和${character.name}说说今天发生的事。`
                : '接入对话模型，让熟悉的角色回应你的日常。'}
          </p>
          {!connected && !localChat && (
            <button className="button secondary" onClick={onOpenSettings}>
              连接对话服务
              <ArrowUpRight size={14} />
            </button>
          )}
        </div>
      )}
      {messages.map((item) => (
        <div key={item.id} data-message-id={item.id} className={`chat-message ${item.role}`}>
          {item.contextStart && <div className="topic-divider">新话题</div>}
          <div className="message-meta">
            <span>{item.role === 'assistant' ? character.name : '你'}</span>
            <time>
              {new Date(item.createdAt).toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </time>
          </div>
          <div className="chat-bubble">{item.content}</div>
          {item.role === 'assistant' && (
            <div className="reply-tools">
              <small>
                {item.origin === 'script' ? '本地台词 · ' : ''}
                {item.action && item.action !== 'idle' ? `${actionNames[item.action]}回应` : '轻声回应'}
              </small>
              <button
                title="复制这条回复"
                aria-label="复制这条回复"
                onClick={() => copyMessage(item.content)}
              >
                <Copy size={13} />
              </button>
              <button
                title="朗读这条回复"
                aria-label="朗读这条回复"
                onClick={() => speak(item.content)}
                disabled={audioBusy || item.origin === 'script'}
              >
                <Volume2 size={13} />
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
  if (historyOnly) return history;
  const send = (
    <button
      className="send-button"
      type="submit"
      disabled={!message.trim() || interactionBusy}
      aria-label="发送消息"
    >
      {interactionBusy ? <LoaderCircle className="spin" size={18} /> : <ArrowUp size={20} />}
    </button>
  );
  const input = (
    <textarea
      aria-label="聊天消息"
      placeholder={room ? `和${character.name}说点什么…` : `想对${character.name}说些什么？`}
      value={message}
      onChange={(e) => {
        const value = e.target.value;
        onDraft(value);
      }}
      maxLength={4000}
      rows={petMode ? 2 : 1}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          void sendChat();
        }
      }}
    />
  );
  const topicButton = messages.length > 0 && (
    <button
      type="button"
      className="voice-button"
      aria-label="开启新话题"
      title="开启新话题 · 保留历史与长期记忆"
      disabled={interactionBusy || replyNeedsSave || newTopicPending}
      onClick={beginTopic}
    >
      <RefreshCw size={15} />
    </button>
  );
  const feedback = (
    <div className="chat-feedback" aria-live="polite">
      {chatBusy && (
        <div className="chat-waiting">
          <div className="typing-indicator">
            <i />
            <i />
            <i />
          </div>
          <button className="text-button" disabled={chatStopping} onClick={stopChat}>
            <Square size={11} />
            {chatStopping ? '正在停止…' : '停止等待'}
          </button>
        </div>
      )}
      {!chatBusy && sharedChatStatus.busy && (
        <div className="chat-shared-wait" role="status">
          <LoaderCircle className="spin" size={13} />
          <span>
            {sharedChatStatus.mode === 'preview' ? '语气试聊进行中' : '另一窗口正在等待回复'}
            ，输入草稿会保留。
          </span>
        </div>
      )}
      {chatError && (
        <div className="inline-error">
          {chatError}
          {(connected || replyNeedsSave) && (
            <button disabled={interactionBusy} onClick={() => sendChat('', true)}>
              {replyNeedsSave ? '仅重试本机保存' : '重试这次回复'}
            </button>
          )}
        </div>
      )}
      {newTopicPending && (
        <div className="topic-notice" role="status">
          <span>下一句开启新话题，历史与长期记忆仍然保留。</span>
          <button className="icon-button" aria-label="取消开启新话题" onClick={onCancelTopic}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
  if (room)
    return (
      <>
        {feedback}
        <form
          className="chat-compose room-compose"
          onSubmit={(e) => {
            e.preventDefault();
            void sendChat();
          }}
        >
          <button
            type="button"
            className="voice-button"
            aria-label={chatExpanded ? '收起对话记录' : '查看对话记录'}
            aria-expanded={chatExpanded}
            title="对话记录"
            onClick={onToggleExpanded}
          >
            <History size={18} />
          </button>
          {input}
          {speaking && (
            <button type="button" className="voice-button speaking" aria-label="停止朗读" onClick={stopAudio}>
              <VolumeX size={17} />
            </button>
          )}
          {topicButton}
          {chatPreferences}
          {send}
        </form>
      </>
    );
  return (
    <>
      <div className="chat-header">
        <span className="chat-avatar">{thumbnail}</span>
        <div>
          <strong>{petMode ? character.name : `和${character.name}聊聊`}</strong>
          {connection}
        </div>
        <button
          className="icon-button"
          title="查找与导出对话"
          aria-label="查找与导出对话"
          onClick={() => {
            onOpenHistory();
          }}
        >
          <Search size={18} />
        </button>
        <button className="icon-button" title="服务连接" aria-label="服务连接" onClick={onOpenSettings}>
          <MoreHorizontal size={22} />
        </button>
        {!petMode && chatPreferences}
        {mode === 'compact' && (
          <button
            className="conversation-toggle"
            aria-label={chatExpanded ? '收起对话栏' : '展开对话栏'}
            aria-expanded={chatExpanded}
            aria-controls="conversation-history"
            onClick={onToggleExpanded}
          >
            {chatExpanded ? <ChevronUp size={16} /> : <MessageCircle size={16} />}
            {chatExpanded ? '收起对话' : '展开对话'}
          </button>
        )}
      </div>
      {petMode && chatPreferences}
      {(mode !== 'compact' || chatExpanded) && history}
      {feedback}
      <div className="chat-bottom">
        {messages.length < 2 && (
          <div className="quick-prompts">
            <button
              disabled={interactionBusy}
              onClick={() => sendChat(localChat ? '你好' : '今天过得怎么样？')}
            >
              {localChat ? '打个招呼' : '聊聊今天'}
            </button>
            <button disabled={interactionBusy} onClick={() => sendChat('给我一点鼓励吧')}>
              给我一点鼓励
            </button>
          </div>
        )}
        <form
          className="chat-compose"
          onSubmit={(e) => {
            e.preventDefault();
            void sendChat();
          }}
        >
          {input}
          <div className="compose-bottom">
            <button
              type="button"
              className={`voice-button ${talking ? 'speaking' : ''}`}
              aria-label={talking ? '停止朗读' : '语音设置'}
              onClick={() => (talking ? stopAudio() : onOpenSettings())}
            >
              {audioBusy ? (
                <LoaderCircle className="spin" size={17} />
              ) : talking ? (
                <VolumeX size={17} />
              ) : (
                <Volume2 size={17} />
              )}
            </button>
            {topicButton}
            <span>Enter 发送</span>
            {send}
          </div>
        </form>
        <div className="chat-footer">
          <ShieldCheck size={11} />
          记忆保存在本机<span>{localChat ? '本地台词仅支持已设置场景' : '模型回复可能出错'}</span>
        </div>
      </div>
    </>
  );
}
