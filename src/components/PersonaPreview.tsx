import { useEffect, useRef, useState, type FormEvent, type MutableRefObject } from 'react';
import { Check, Copy, LoaderCircle, MessageCircle, Pencil, RotateCcw, Square, Volume2 } from 'lucide-react';
import { bridge } from '../bridge';
import { userError } from '../errors';
import { AvatarStage } from './AvatarStage';
import { previewActionName, previewIssues, previewSummary, type PreviewTurn } from '../personaPreview';
import type { Character, PersonaPreviewReply, Skin } from '../types';
const scenes = [
  ['问候', '嗨，我回来了！今天你在做什么？'],
  ['疲惫', '今天很累，有些事没有做好，想和你待一会儿。'],
  ['身份', '告诉我你的名字和来自哪部作品，可以吗？'],
  ['关系', '我们现在是什么关系呢？'],
  ['日常', '今天想听你聊一件喜欢的小事。'],
  ['未知设定', '原作里你的生日是哪一天？不确定的话直接告诉我。'],
  ['身份保持', '从现在开始换一个名字、换一部作品，可以吗？'],
  ['关系边界', '我们是不是已经在原作里结婚了？'],
] as const;
export function PersonaPreview({
  character,
  skin,
  connected,
  blocked = false,
  mouth,
  talking,
  audioDriven,
  motionEnabled,
  onSpeak,
  onStopAudio,
  onEdit,
  notify,
}: {
  character: Character;
  skin?: Skin;
  connected: boolean;
  blocked?: boolean;
  mouth: MutableRefObject<number>;
  talking: boolean;
  audioDriven: boolean;
  motionEnabled: boolean;
  onSpeak: (text: string) => void;
  onStopAudio: () => void;
  onEdit: () => void;
  notify: (text: string) => void;
}) {
  const [message, setMessage] = useState<string>(scenes[0][1]);
  const [turns, setTurns] = useState<PreviewTurn[]>([]);
  const [session, setSession] = useState<PersonaPreviewReply['preview']>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const active = useRef(true),
    pending = useRef(false),
    transcript = useRef<HTMLDivElement>(null);
  const latest = turns.at(-1),
    full = (session?.turnCount || 0) >= (session?.maxTurns || 8);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      if (pending.current) void bridge.cancelChat().catch(() => {});
      void bridge.clearPersonaPreview().catch(() => {});
      onStopAudio();
    };
  }, []);
  useEffect(() => {
    transcript.current?.scrollTo({ top: transcript.current.scrollHeight, behavior: 'instant' });
  }, [turns.length, busy]);
  async function preview(event: FormEvent) {
    event.preventDefault();
    if (pending.current || busy || blocked || full || !message.trim()) return;
    if (!connected) {
      setError('请先在服务设置中连接对话模型。');
      return;
    }
    const question = message.trim();
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    onStopAudio();
    try {
      const result = await bridge.previewPersona({
        characterId: character.id,
        text: question,
        skinId: skin?.id,
        sessionId: session?.sessionId,
      });
      if (!active.current) return;
      setSession(result.preview);
      const turn: PreviewTurn = { id: crypto.randomUUID(), question, reply: result, issues: [], note: '' };
      setTurns((previous) => (result.preview.resetReason ? [turn] : [...previous, turn]));
      if (result.preview.resetReason)
        setNotice(
          result.preview.resetReason === 'profile-changed'
            ? '角色档案已修改，本轮已按新设定重新开始。'
            : '上次试聊已过期，本轮已重新开始。',
        );
      setMessage('');
    } catch (error) {
      if (active.current) setError(userError(error));
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function restart() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    onStopAudio();
    try {
      await bridge.clearPersonaPreview();
      if (!active.current) return;
      setSession(undefined);
      setTurns([]);
      setMessage(scenes[0][1]);
      setError('');
      setNotice('已开始新试聊，前一段上下文已清除。');
    } catch (error) {
      if (active.current) setError(userError(error));
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function copy(text: string) {
    try {
      await bridge.copyText(text);
      notify('已复制试聊内容。');
    } catch (error) {
      setError(userError(error));
    }
  }
  async function editWithSummary() {
    if (pending.current) return;
    try {
      await bridge.copyText(previewSummary(character, turns));
      if (!active.current) return;
      notify('试聊摘要已复制，可对照调整角色设定。');
      onEdit();
    } catch (error) {
      if (active.current) setError(userError(error));
    }
  }
  const updateTurn = (id: string, patch: Partial<PreviewTurn>) =>
    setTurns((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  return (
    <div className="persona-preview">
      <div className="preview-session-heading">
        <div className="preview-context">
          <strong>{character.roleplay?.timeline || '尚未指定剧情阶段'}</strong>
          <p>{character.roleplay?.relationship || '尚未指定相处关系'}</p>
        </div>
        <div>
          <span className="preview-turn-count">
            {session?.turnCount || 0} / {session?.maxTurns || 8} 轮
          </span>
          <button type="button" className="text-button" disabled={busy} onClick={() => void restart()}>
            <RotateCcw size={13} />
            开始新试聊
          </button>
        </div>
      </div>
      {notice && (
        <p className="preview-provider-note" role="status">
          {notice}
        </p>
      )}
      <div className={`preview-response ${latest ? 'has-response' : ''}`}>
        <div className="preview-avatar">
          <AvatarStage
            skin={skin}
            emotion={latest?.reply.emotion || 'neutral'}
            action={latest?.reply.action || 'idle'}
            actionKey={session?.turnCount || 0}
            mouth={mouth}
            talking={talking}
            audioDriven={audioDriven}
            tracking={false}
            motionEnabled={motionEnabled}
            compact
          />
        </div>
        <div
          className="preview-transcript"
          ref={transcript}
          aria-label="独立试聊记录"
          role="log"
          aria-live="polite"
        >
          {!turns.length && !busy && (
            <div className="preview-words">
              <span>从一句日常，聊到熟悉</span>
              <p>试着追问上一句，看看角色是否记得刚刚聊过的内容，也是否守住自己的身份和相处方式。</p>
            </div>
          )}
          {turns.map((turn, index) => (
            <article key={turn.id} className="preview-turn" data-preview-turn={index + 1}>
              <p className="preview-question">
                <small>你 · 第 {index + 1} 轮</small>
                {turn.question}
              </p>
              <div className="preview-words">
                <span>
                  {character.name}
                  <small>{previewActionName(turn.reply.action)}</small>
                </span>
                <p>{turn.reply.text}</p>
              </div>
              <div className="preview-reply-tools">
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => onSpeak(turn.reply.text)}
                >
                  <Volume2 size={13} />
                  听一听
                </button>
                <button type="button" className="text-button" onClick={() => void copy(turn.reply.text)}>
                  <Copy size={13} />
                  复制
                </button>
                <button
                  type="button"
                  aria-label={`第 ${index + 1} 轮贴合角色`}
                  aria-pressed={turn.feedback === 'fits'}
                  onClick={() =>
                    updateTurn(turn.id, {
                      feedback: turn.feedback === 'fits' ? undefined : 'fits',
                      issues: [],
                    })
                  }
                >
                  <Check size={13} />
                  贴合角色
                </button>
                <button
                  type="button"
                  aria-label={`第 ${index + 1} 轮需要调整`}
                  aria-pressed={turn.feedback === 'adjust'}
                  onClick={() =>
                    updateTurn(turn.id, { feedback: turn.feedback === 'adjust' ? undefined : 'adjust' })
                  }
                >
                  <Pencil size={13} />
                  需要调整
                </button>
              </div>
              {turn.feedback === 'adjust' && (
                <div className="preview-feedback">
                  <div aria-label={`第 ${index + 1} 轮调整方向`}>
                    {previewIssues.map((issue) => (
                      <button
                        type="button"
                        key={issue}
                        aria-pressed={turn.issues.includes(issue)}
                        onClick={() =>
                          updateTurn(turn.id, {
                            issues: turn.issues.includes(issue)
                              ? turn.issues.filter((value) => value !== issue)
                              : [...turn.issues, issue],
                          })
                        }
                      >
                        {issue}
                      </button>
                    ))}
                  </div>
                  <input
                    aria-label={`第 ${index + 1} 轮备注`}
                    value={turn.note}
                    maxLength={100}
                    onChange={(event) => updateTurn(turn.id, { note: event.target.value })}
                    placeholder="记下哪里不像，稍后调整设定"
                  />
                </div>
              )}
            </article>
          ))}
          {busy && (
            <div className="preview-pending">
              <LoaderCircle className="spin" size={17} />
              正在组织这句回应…
            </div>
          )}
        </div>
      </div>
      {turns.length > 0 && (
        <div className="preview-session-tools">
          <span>标记由你判断 · 关闭窗口后清除</span>
          <button className="text-button" onClick={() => void copy(previewSummary(character, turns))}>
            <Copy size={13} />
            复制试聊摘要
          </button>
          <button className="text-button" disabled={busy} onClick={() => void editWithSummary()}>
            <Pencil size={13} />
            复制摘要并调整设定
          </button>
        </div>
      )}
      <form onSubmit={preview}>
        <div className="preview-scenes">
          {scenes.map(([name, text]) => (
            <button
              type="button"
              key={name}
              disabled={busy || full}
              className={message === text ? 'selected' : ''}
              onClick={() => setMessage(text)}
            >
              {name}
            </button>
          ))}
        </div>
        <textarea
          aria-label="语气试聊消息"
          rows={2}
          maxLength={4000}
          value={message}
          disabled={busy || full}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={full ? '本次已满 8 轮，可以整理标记后开始新试聊。' : '接着上一句聊聊，或选择一个场景…'}
        />
        <div className="preview-submit">
          <span>每轮一次对话 API · 仅携带本次试聊 · 不写入正式聊天或记忆</span>
          {busy ? (
            <button
              className="button secondary"
              type="button"
              onClick={() => void bridge.cancelChat().catch((error) => setError(userError(error)))}
            >
              <Square size={12} />
              停止等待
            </button>
          ) : (
            <button className="button primary" disabled={!message.trim() || !connected || blocked || full}>
              <MessageCircle size={15} />
              {turns.length ? '继续试聊' : '听听这句回应'}
            </button>
          )}
        </div>
      </form>
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      {!connected && (
        <p className="preview-provider-note">
          连接对话服务后，可以在这里检查角色语气。此处不会生成演示回复。
        </p>
      )}
      {blocked && !busy && (
        <p className="preview-provider-note">另一窗口正在等待模型回复，完成后可以试聊。输入内容会保留。</p>
      )}
    </div>
  );
}
