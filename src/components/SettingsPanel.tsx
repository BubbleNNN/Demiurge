import chatProviders from '../../shared/chat-providers.json';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  KeyRound,
  Trash2,
  MessageCircle,
  Search,
  WandSparkles,
  Heart,
  ShieldCheck,
  LoaderCircle,
  Check,
  Volume2,
  Box,
  Download,
  Upload,
  FolderOpen,
  Archive,
} from 'lucide-react';
import { bridge, flushBeforeClose, isDesktop } from '../bridge';
import { userError } from '../errors';
import { selectedSearchProvider, searchProviderNames } from '../research';
import type { Settings, KeyStatus, Credentials } from '../types';
const errorText = userError;
export function SettingsPanel({
  settings,
  keys,
  onSaved,
  notify,
}: {
  settings: Settings;
  keys: KeyStatus;
  onSaved: (settings: Settings, keys: KeyStatus, manual: boolean) => void;
  notify: (text: string) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const baseSettings = useRef(settings);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [credentials, setCredentials] = useState<Credentials>({});
  const credentialsRef = useRef(credentials);
  credentialsRef.current = credentials;
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'pending' | 'saving' | 'error'>('saved');
  const inflight = useRef<Promise<boolean> | null>(null);
  const queued = useRef(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [searchResult, setSearchResult] = useState<{ ok: boolean; message: string } | null>(null);
  const provider = selectedSearchProvider(draft, keys);
  const codex = draft.llmProtocol === 'codex';
  const settingsSignature = JSON.stringify(settings);
  const unsaved = () =>
    JSON.stringify(draftRef.current) !== JSON.stringify(baseSettings.current) ||
    Object.keys(credentialsRef.current).length > 0;
  useEffect(() => {
    if (JSON.stringify(draftRef.current) === JSON.stringify(baseSettings.current)) {
      baseSettings.current = settings;
      setDraft(settings);
    }
  }, [settingsSignature]);
  // Settings save themselves: each change is written shortly after it is made, so leaving the
  // page or quitting never discards it. API keys are written when their field loses focus.
  async function persist(manual = false): Promise<boolean> {
    if (!isDesktop) return false;
    if (inflight.current) {
      queued.current = true;
      return inflight.current;
    }
    const sentDraft = draftRef.current,
      sentCredentials = credentialsRef.current;
    setSaveStatus('saving');
    inflight.current = (async () => {
      try {
        const value = await bridge.saveSettings(sentDraft, sentCredentials, baseSettings.current);
        const loaded = await bridge.load();
        const saved = loaded.state?.settings || sentDraft;
        baseSettings.current = saved;
        // Edits made while this save was in flight stay in the form and are saved next.
        if (draftRef.current === sentDraft) setDraft(saved);
        setCredentials((current) => {
          const next = { ...current };
          for (const key of Object.keys(sentCredentials) as (keyof Credentials)[])
            if (next[key] === sentCredentials[key]) delete next[key];
          return next;
        });
        onSaved(saved, value, manual);
        setError('');
        setSaveStatus('saved');
        return true;
      } catch (err) {
        setError(errorText(err));
        setSaveStatus('error');
        return false;
      } finally {
        inflight.current = null;
        if (queued.current) {
          queued.current = false;
          void persist();
        }
      }
    })();
    return inflight.current;
  }
  const persistRef = useRef(persist);
  persistRef.current = persist;
  async function save(event?: FormEvent) {
    event?.preventDefault();
    return persist(Boolean(event));
  }
  useEffect(() => {
    if (JSON.stringify(draft) === JSON.stringify(baseSettings.current)) return;
    setSaveStatus('pending');
    const timer = setTimeout(() => void persistRef.current(), 600);
    return () => clearTimeout(timer);
  }, [draft]);
  useEffect(() => {
    // Leaving the page, closing the window or quitting writes whatever is still pending.
    const flush = async () => {
      await inflight.current;
      if (unsaved()) await persistRef.current();
    };
    const release = flushBeforeClose(flush);
    return () => {
      release();
      void flush();
    };
  }, []);
  async function manageData(operation: () => Promise<void>) {
    if (busy || testing) return;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  const keyField = (key: keyof Credentials, label: string) => (
    <label>
      {label}
      <div className="key-input">
        <KeyRound size={15} />
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          aria-label={label}
          value={credentials[key] ?? ''}
          onChange={(e) => setCredentials({ ...credentials, [key]: e.target.value })}
          onBlur={() => {
            if (credentialsRef.current[key] !== undefined) void persist();
          }}
          placeholder={keys[key] ? '已保存 · 留空保持原密钥' : '粘贴 API Key，仅保存在本机'}
          disabled={!isDesktop}
        />
        {keys[key] && (
          <button
            type="button"
            onClick={() => {
              credentialsRef.current = { ...credentialsRef.current, [key]: '' };
              setCredentials(credentialsRef.current);
              void persist().then((ok) => ok && notify('密钥已删除。'));
            }}
            title="删除已存密钥"
            aria-label={`删除${label}`}
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
      {credentials[key] === '' && keys[key] && <small className="field-warning">正在删除此密钥…</small>}
    </label>
  );
  return (
    <>
      {!isDesktop && (
        <div className="notice">
          当前为界面预览。真实 API、模型导入和密钥存储在桌面开发版运行：pnpm desktop。
        </div>
      )}
      <form className="settings-form" onSubmit={save}>
        <fieldset className="settings-fields-lock" disabled={busy || testing}>
          <p className="settings-intro">本地台词和日常互动无需任何服务。自由聊天、绘图与语音按需连接。</p>
          {keys.credentialError && (
            <section className="settings-card" aria-label="密钥存储恢复">
              <div className="inline-error" role="alert">
                <strong>已保存的密钥暂时无法读取</strong>
                <p>{keys.credentialError}</p>
                <p>
                  角色、对话与本地互动仍可使用。重新配置会保留原密钥文件，清除失效凭据，再由你填写新的密钥。
                </p>
              </div>
              <button
                type="button"
                className="button secondary"
                aria-label="重新配置密钥"
                disabled={busy || testing || !isDesktop}
                onClick={() =>
                  void manageData(async () => {
                    const status = await bridge.resetCredentials();
                    setCredentials({});
                    onSaved(settings, status, false);
                    notify('原密钥文件已保留，失效凭据已清除。请填写需要的密钥，离开输入框后自动保存。');
                  })
                }
              >
                <KeyRound size={16} />
                重新配置密钥
              </button>
            </section>
          )}
          <details className="settings-card settings-group">
            <summary className="setting-card-heading">
              <div className="setting-icon">
                <MessageCircle size={20} />
              </div>
              <div>
                <h2>对话与角色理解</h2>
                <p>本机 Codex（ChatGPT 登录）、OpenAI 兼容接口或 Claude / Anthropic Messages。</p>
              </div>
              <span className={`small-badge ${codex || keys.llmKey ? 'green' : ''}`}>
                {codex ? '本机 Codex' : keys.llmKey ? '密钥已配置' : '自由聊天可选'}
              </span>
            </summary>
            <div className="settings-fields">
              <label>
                对话方式
                <select
                  aria-label="对话方式"
                  value={draft.chatMode || 'model'}
                  onChange={(e) => setDraft({ ...draft, chatMode: e.target.value as 'model' | 'local' })}
                >
                  <option value="model">模型对话 · 使用所选模型服务</option>
                  <option value="local">本地台词 · 不调用模型</option>
                </select>
                <small>本地台词按场景和关键词选择，不回答开放问题，也不会自动调用语音服务。</small>
              </label>
              <label>对话供应商
                <select aria-label="对话供应商" value={draft.llmProvider || 'custom'} onChange={e=>{
                  const p=chatProviders.find(p=>p.id===e.target.value)!;
                  setDraft({...draft,llmProvider:p.id as Settings['llmProvider'],llmProtocol:p.protocol as Settings['llmProtocol'],
                    llmBaseUrl:p.id==='custom'?draft.llmBaseUrl:p.base,llmEndpointMode:p.id==='custom'?draft.llmEndpointMode:'base',
                    llmOutputMode:p.output as Settings['llmOutputMode'],llmThinking:p.id==='qwen'?'off':'auto'});
                  setTestResult(null);
                }}>
                  {chatProviders.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                <small>{chatProviders.find(p=>p.id===draft.llmProvider)?.note || '已有配置保持原样。选择预设会填入基础地址，Key 和模型仍需匹配该服务。'}</small>
              </label>
              <label>
                接口协议
                <select
                  aria-label="对话接口协议"
                  value={draft.llmProtocol || 'openai'}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      llmProtocol: e.target.value as NonNullable<Settings['llmProtocol']>,
                    })
                  }
                >
                  <option value="codex">本机 Codex · 使用 ChatGPT 订阅，无需 API Key</option>
                  <option value="openai">OpenAI 兼容 · Chat Completions</option>
                  <option value="anthropic">Claude / Anthropic · Messages（Claude Code 接入方式）</option>
                </select>
              </label>
              {!codex && keyField('llmKey', '对话 API Key')}
              {draft.llmProtocol === 'anthropic' && (
                <label>
                  密钥发送方式
                  <select
                    aria-label="Claude 密钥发送方式"
                    value={draft.llmAuthMode || 'api-key'}
                    onChange={(e) =>
                      setDraft({ ...draft, llmAuthMode: e.target.value as 'api-key' | 'bearer' })
                    }
                  >
                    <option value="api-key">API Key · 对应 ANTHROPIC_API_KEY</option>
                    <option value="bearer">Bearer Token · 对应 ANTHROPIC_AUTH_TOKEN</option>
                  </select>
                </label>
              )}
              {(codex || draft.imageProvider === 'codex' || draft.searchProvider === 'codex') && (
                <label>
                  Codex 账号目录
                  <input
                    aria-label="Codex 账号目录"
                    value={draft.codexHome || ''}
                    onChange={(e) => setDraft({ ...draft, codexHome: e.target.value.trim() })}
                    placeholder="留空使用默认登录；也可填写另一个账号目录的完整路径"
                  />
                  <span className="form-hint">聊天、资料搜索与图片生成共用此账号。目录需已登录 ChatGPT；只影响 Demiurge，保存后新请求生效。</span>
                </label>
              )}
              {codex ? (
                <>
                  <label>
                    模型 ID
                    <input
                      value={draft.llmModel}
                      aria-label="对话模型 ID"
                      onChange={(e) => setDraft({ ...draft, llmModel: e.target.value })}
                      placeholder="留空使用 Codex 默认模型"
                    />
                  </label>
                  <p className="form-hint">
                    通过本机 codex 命令和它的 ChatGPT
                    登录调用，用量计入你的订阅额度。每次请求都是只读的临时会话，不开放命令行、文件、插件或图像工具；角色建档时可以使用
                    Codex 网页搜索。图像、语音和 3D 仍需各自的服务。每次回复通常需要几秒钟。
                  </p>
                </>
              ) : (
                <>
                  <label>
                    地址形式
                    <select
                      aria-label="对话地址形式"
                      value={draft.llmEndpointMode || 'base'}
                      onChange={(e) =>
                        setDraft({ ...draft, llmEndpointMode: e.target.value as 'base' | 'exact' })
                      }
                    >
                      <option value="base">
                        {draft.llmProtocol === 'anthropic'
                          ? '服务基础地址 · 与 Claude Code 的 Base URL 相同'
                          : '基础地址 · 追加 /chat/completions'}
                      </option>
                      <option value="exact">完整请求地址 · 直接使用填写的 URL</option>
                    </select>
                  </label>
                  <div className="form-row">
                    <label>
                      {draft.llmEndpointMode === 'exact' ? '完整请求 URL' : 'Base URL'}
                      <input
                        aria-label="对话服务地址"
                        value={draft.llmBaseUrl}
                        onChange={(e) => setDraft({ ...draft, llmBaseUrl: e.target.value })}
                        placeholder={
                          draft.llmEndpointMode === 'exact'
                            ? '填写服务商提供的完整请求地址'
                            : draft.llmProtocol === 'anthropic'
                              ? 'https://api.anthropic.com'
                              : 'https://api.example.com/v1'
                        }
                      />
                    </label>
                    <label>
                      模型 ID
                      <input
                        value={draft.llmModel}
                        aria-label="对话模型 ID"
                        onChange={(e) => setDraft({ ...draft, llmModel: e.target.value })}
                        placeholder="填写服务商支持的模型名称"
                      />
                    </label>
                  </div>
                  <p className="form-hint">
                    {draft.llmEndpointMode === 'exact'
                      ? `直接向填写的 URL 发送请求，不追加任何路径。请求内容使用所选的${draft.llmProtocol === 'anthropic' ? ' Anthropic Messages' : ' OpenAI Chat Completions'} 格式，模型需要能够输出 JSON。`
                      : draft.llmProtocol === 'anthropic'
                        ? '填写与 Claude Code 的 ANTHROPIC_BASE_URL 相同的服务地址；程序使用 /v1/messages 接口，地址已包含 /v1 时不会重复追加。无需填写 chat/completions。'
                        : '基础地址按服务商文档填写，程序会追加 /chat/completions。模型需要能够输出 JSON。'}
                  </p>
                </>
              )}
              {!codex && (draft.llmProtocol || 'openai') === 'openai' && <div className="form-row">
                <label>结构化回复<select aria-label="结构化回复方式" value={draft.llmOutputMode || 'json'} onChange={e=>setDraft({...draft,llmOutputMode:e.target.value as 'json'|'prompt'})}>
                  <option value="json">JSON 模式（服务需支持）</option><option value="prompt">提示词约束（兼容服务）</option>
                </select><small>两种方式都会检查回复结构；不会自动重发请求。</small></label>
                <label>思考模式<select aria-label="思考模式" value={draft.llmThinking || 'auto'} onChange={e=>setDraft({...draft,llmThinking:e.target.value as 'auto'|'off'})}>
                  <option value="auto">服务默认</option><option value="off">关闭千问深度思考</option>
                </select><small>千问非流式对话可关闭深度思考；其他服务不发送这一专用参数。</small></label>
              </div>}
              {!codex && <p className="fine-print">实际请求地址：{(() => {try {const u=new URL(draft.llmBaseUrl);const suffix=draft.llmProtocol==='anthropic'?(/\/v1\/?$/.test(u.pathname)?'messages':'v1/messages'):'chat/completions';return draft.llmEndpointMode==='exact'?u.href:u.href.replace(/\/+$/,'')+'/'+suffix;}catch{return '请填写有效地址';}})()}</p>}
              {!codex && draft.llmEndpointMode==='exact' && /\/(?:compatible-mode\/v1|api\/v3|api\/paas\/v4|v1)\/?$/.test(draft.llmBaseUrl) && <p className="inline-error">这里看起来是基础地址。请选择“服务基础地址”，或填写完整的接口路径；系统不会擅自改写完整 URL。</p>}
              <label>
                近期对话回顾
                <select
                  value={draft.chatHistoryBudget || 12000}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      chatHistoryBudget: Number(event.target.value) as 6000 | 12000 | 24000,
                    })
                  }
                >
                  <option value={6000}>精简 · 适合短对话与较小模型</option>
                  <option value={12000}>均衡 · 日常陪伴</option>
                  <option value={24000}>较长 · 保留更多近期细节</option>
                </select>
              </label>
              <p className="form-hint">
                控制发送给模型的近期对话长度；角色设定与相关记忆单独提供。本机完整记录不因此删减。
              </p>
            </div>
          </details>
          <details className="settings-card settings-group">
            <summary className="setting-card-heading">
              <div className="setting-icon lavender">
                <Search size={20} />
              </div>
              <div>
                <h2>角色资料搜集</h2>
                <p>选择资料检索方式。模型草稿和资料链接导入无需搜索密钥。</p>
              </div>
              <span className="small-badge">联网搜集时使用 · 选配</span>
            </summary>
            <div className="settings-fields">
              <label>
                搜索提供商
                <select
                  aria-label="搜索提供商"
                  value={provider}
                  onChange={(event) => {
                    setDraft({ ...draft, searchProvider: event.target.value as Settings['searchProvider'] });
                    setSearchResult(null);
                  }}
                >
                  {Object.entries(searchProviderNames).map(([value, name]) => (
                    <option key={value} value={value}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              {provider === 'tavily' && keyField('searchKey', 'Tavily API Key')}
              {provider === 'searxng' && (
                <label>
                  SearXNG 服务基础地址
                  <input
                    aria-label="SearXNG 服务地址"
                    value={draft.searxngBaseUrl || ''}
                    placeholder="https://search.example.com"
                    onChange={(event) => {
                      setDraft({ ...draft, searxngBaseUrl: event.target.value });
                      setSearchResult(null);
                    }}
                  />
                </label>
              )}
              {provider === 'wiki' && (
                <label>
                  MediaWiki API 地址
                  <input
                    aria-label="Wiki API 地址"
                    value={draft.wikiApiUrl ?? 'https://zh.wikipedia.org/w/api.php'}
                    placeholder="https://zh.wikipedia.org/w/api.php"
                    onChange={(event) => {
                      setDraft({ ...draft, wikiApiUrl: event.target.value });
                      setSearchResult(null);
                    }}
                  />
                </label>
              )}
              <p className="form-hint">
                {provider === 'claude'
                  ? '沿用聊天 key；需要 Claude / Anthropic 协议和服务商对原生 web_search 的支持。最多搜索两次，搜索与模型用量由服务商计费。聊天测试成功不代表搜索可用。'
                  : provider === 'searxng'
                    ? '不需要第三方搜索 key。填写你部署或确认可用的实例；需在实例配置中启用 JSON 结果。'
                    : provider === 'wiki'
                      ? '仅检索这个 Wiki，无需额外搜索 key。站点可能限制自动访问；若出现 567，可在角色档案中使用已保存资料整理。网页和 API 可能同时不可用。'
                      : provider === 'tavily'
                        ? '仅此提供商需要 Tavily key；其他建档方式不依赖它。'
                        : '联网搜索已关闭；仍可使用模型草稿、资料链接和手动设定建立角色。'}
              </p>
              {searchResult && (
                <div className={searchResult.ok ? 'notice' : 'inline-error'} role="status">
                  {searchResult.message}
                </div>
              )}
              <button
                type="button"
                className="button secondary"
                disabled={busy || testing || !isDesktop || provider === 'none'}
                onClick={async () => {
                  setSearchResult(null);
                  if (!(await save())) return;
                  setTesting(true);
                  try {
                    setSearchResult(await bridge.testSearchConnection());
                  } catch (error) {
                    setSearchResult({ ok: false, message: errorText(error) });
                  } finally {
                    setTesting(false);
                  }
                }}
              >
                {testing ? <LoaderCircle className="spin" size={16} /> : <Search size={16} />}保存并测试搜索
              </button>
              <p className="form-hint">
                测试会实际搜索昔涟并读取来源，检查接口与名称匹配。建档时还会核对人物身份；测试不创建角色，不写聊天记录。
              </p>
            </div>
          </details>
          <details className="settings-card settings-group">
            <summary className="setting-card-heading">
              <div className="setting-icon peach">
                <WandSparkles size={20} />
              </div>
              <div>
                <h2>外观与表情生成</h2>
                <p>本机 Codex（ChatGPT 登录）或图像编辑接口；程序像素动画可使用上方聊天模型。</p>
              </div>
              <span className={`small-badge ${draft.imageProvider === 'codex' ? 'green' : ''}`}>
                {draft.imageProvider === 'codex' ? '本机 Codex' : '生成外观时使用'}
              </span>
            </summary>
            <div className="settings-fields">
              <label>
                图像服务
                <select
                  aria-label="图像服务"
                  value={draft.imageProvider || 'api'}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      imageProvider: e.target.value as NonNullable<Settings['imageProvider']>,
                    })
                  }
                >
                  <option value="codex">本机 Codex · 使用 ChatGPT 订阅，无需 API Key</option>
                  <option value="api">图像编辑 API · Images Edits</option>
                </select>
              </label>
              {draft.imageProvider === 'codex' ? (
                <p className="form-hint">
                  通过本机 codex 命令的图像生成工具绘制，用量计入你的 ChatGPT
                  订阅额度。每张图会附上角色原图作为参考，通常需要约一分钟；一整套桌宠动作约需 7
                  张以上。会话保持只读，不开放命令行或文件工具，生成的图片取回后从 Codex
                  文件夹删除。每张结果仍需你核对后才会启用。
                </p>
              ) : (
                <>
                  {keyField('imageKey', '图像 API Key')}
                  <div className="form-row">
                    <label>
                      图像 Base URL
                      <input
                        value={draft.imageBaseUrl}
                        onChange={(e) => setDraft({ ...draft, imageBaseUrl: e.target.value })}
                      />
                    </label>
                    <label>
                      图像模型 ID
                      <input
                        value={draft.imageModel}
                        onChange={(e) => setDraft({ ...draft, imageModel: e.target.value })}
                        placeholder="需支持透明 PNG 与图片编辑"
                      />
                    </label>
                  </div>
                  <p className="form-hint">
                    可多选画风，逐张制作候选，核对通过后扩展表情。图像路线需要支持原图输入的 Images Edits
                    接口，多图需要支持 image[] 文件数组。程序像素路线使用聊天 Key
                    和支持图片输入的聊天模型，不需要此处的图像 Key。
                  </p>
                  <label>
                    原图细节保留
                    <select
                      value={draft.imageInputFidelity || 'auto'}
                      onChange={(e) =>
                        setDraft({ ...draft, imageInputFidelity: e.target.value as 'auto' | 'high' })
                      }
                    >
                      <option value="auto">使用模型默认能力</option>
                      <option value="high">高保真（服务商须支持 input_fidelity）</option>
                    </select>
                    <small>仅对支持该参数的模型开启；两种选项都会传入完整参考原图。</small>
                  </label>
                </>
              )}
            </div>
          </details>
          <details className="settings-card settings-group">
            <summary className="setting-card-heading">
              <div className="setting-icon peach">
                <Box size={20} />
              </div>
              <div>
                <h2>3D 建模与骨骼绑定</h2>
                <p>Meshy 图生 3D 与自动人形绑定，任务可继续查询。</p>
              </div>
              <span className="small-badge">独立制作服务</span>
            </summary>
            <div className="settings-fields">
              {keyField('modelKey', 'Meshy API Key')}
              <div className="form-row">
                <label>
                  Meshy 服务地址
                  <input
                    aria-label="Meshy 服务地址"
                    value={draft.modelBaseUrl || 'https://api.meshy.ai'}
                    onChange={(e) => setDraft({ ...draft, modelBaseUrl: e.target.value })}
                  />
                </label>
                <label>
                  3D 模型版本
                  <input
                    aria-label="3D 模型版本"
                    value={draft.modelVersion || 'latest'}
                    onChange={(e) => setDraft({ ...draft, modelVersion: e.target.value })}
                    placeholder="latest"
                  />
                </label>
              </div>
              <p className="form-hint">
                在外观工作台点击“制作 3D 模型”。使用已保存的主参考，分别创建模型与绑定任务；聊天 Key
                不会自动发送给此服务。绑定适用于身体结构清楚的人形，结果需要预览检查。
              </p>
            </div>
          </details>
          <details className="settings-card settings-group">
            <summary className="setting-card-heading">
              <div className="setting-icon">
                <Volume2 size={20} />
              </div>
              <div>
                <h2>语音合成</h2>
                <p>OpenAI 兼容 audio/speech；播放音频时驱动模型口型。</p>
              </div>
              <span className="small-badge">可选</span>
            </summary>
            <div className="settings-fields">
              {keyField('ttsKey', '语音 API Key')}
              <div className="form-row">
                <label>
                  语音 Base URL
                  <input
                    value={draft.ttsBaseUrl || ''}
                    onChange={(e) => setDraft({ ...draft, ttsBaseUrl: e.target.value })}
                    placeholder="https://api.example.com/v1"
                  />
                </label>
                <label>
                  语音模型 ID
                  <input
                    value={draft.ttsModel || ''}
                    onChange={(e) => setDraft({ ...draft, ttsModel: e.target.value })}
                    placeholder="服务商支持的 TTS 模型"
                  />
                </label>
              </div>
              <div className="form-row">
                <label>
                  音色 ID
                  <input
                    value={draft.ttsVoice || ''}
                    onChange={(e) => setDraft({ ...draft, ttsVoice: e.target.value })}
                    placeholder="例如 alloy"
                  />
                </label>
                <label>
                  语速
                  <select
                    value={draft.voiceRate || 1}
                    onChange={(e) => setDraft({ ...draft, voiceRate: Number(e.target.value) })}
                  >
                    {[0.75, 1, 1.25, 1.5].map((rate) => (
                      <option key={rate} value={rate}>
                        {rate}×
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={Boolean(draft.voiceEnabled)}
                  onChange={(e) => setDraft({ ...draft, voiceEnabled: e.target.checked })}
                />
                自动朗读新回复（每次会调用语音 API）
              </label>
            </div>
          </details>
          <details className="settings-card settings-group">
            <summary className="setting-card-heading">
              <div className="setting-icon">
                <Heart size={20} />
              </div>
              <div>
                <h2>轻轻打个招呼</h2>
                <p>按角色活跃程度和亲近程度调整招呼间隔；休息、说话与忙碌时暂停，不调用 API。</p>
              </div>
            </summary>
            <div className="settings-fields proactive-setting">
              <span>允许角色主动打招呼</span>
              <button
                type="button"
                role="switch"
                aria-checked={draft.proactiveEnabled}
                aria-label="桌宠主动动作"
                className={`toggle ${draft.proactiveEnabled ? 'on' : ''}`}
                onClick={() => setDraft({ ...draft, proactiveEnabled: !draft.proactiveEnabled })}
              >
                <span />
              </button>
            </div>
          </details>
          <details className="settings-card settings-group">
            <summary className="setting-card-heading">
              <div className="setting-icon">
                <Archive size={20} />
              </div>
              <div>
                <h2>工作区备份与恢复</h2>
                <p>把角色、相处记录与制作素材一起保存，无需配置模型。</p>
              </div>
            </summary>
            <div className="settings-fields">
              <p className="form-hint">
                备份包含角色、对话、记忆、外观素材、制作任务和本机模型，不含 API 密钥。
              </p>
              <div className="toolbar" style={{ flexWrap: 'wrap', marginBottom: 0 }}>
                <button
                  type="button"
                  className="button secondary"
                  aria-label="导出工作区备份"
                  disabled={busy || testing || !isDesktop}
                  onClick={() =>
                    void manageData(async () => {
                      if (await bridge.exportWorkspace()) notify('工作区备份已导出，不含 API 密钥。');
                    })
                  }
                >
                  <Download size={16} />
                  导出工作区备份…
                </button>
                <button
                  type="button"
                  className="button secondary"
                  aria-label="从备份恢复工作区"
                  disabled={busy || testing || !isDesktop}
                  onClick={() => {
                    if (
                      !window.confirm(
                        '从备份恢复将替换当前工作区的角色、对话、记忆、素材与任务。恢复前会保留当前工作区副本，API 密钥保持不变。尚未保存的设置不会保留。继续选择备份文件？',
                      )
                    )
                      return;
                    void manageData(async () => {
                      if (await bridge.importWorkspace()) location.reload();
                    });
                  }}
                >
                  <Upload size={16} />
                  从备份恢复工作区…
                </button>
                <button
                  type="button"
                  className="text-button"
                  aria-label="打开数据文件夹"
                  disabled={busy || testing || !isDesktop}
                  onClick={() => void manageData(() => bridge.openDataDirectory())}
                >
                  <FolderOpen size={16} />
                  打开数据文件夹
                </button>
              </div>
              <p className="form-hint">
                恢复会替换当前工作区；Demiurge 会先验证备份，并在还原前保留当前副本。恢复成功后自动重新打开。
              </p>
            </div>
          </details>
          <div className="security-note">
            <ShieldCheck size={18} />
            <p>
              {isDesktop
                ? keys.secure
                  ? '密钥由系统安全存储能力加密保存，不进入角色包、聊天记录或网页存储。'
                  : '系统加密能力暂不可用时，密钥仅在本次应用会话中保留，不会明文落盘。'
                : '界面预览不接收 API Key。桌面版通过主进程访问服务，渲染页面无法读取已存密钥。'}
            </p>
          </div>
          {error && (
            <div className="inline-error" role="alert">
              {error}
            </div>
          )}
          {testResult && (
            <div className={testResult.ok ? 'success-note' : 'inline-error'}>{testResult.message}</div>
          )}
          <div className="settings-save">
            <button
              type="button"
              className="button secondary"
              disabled={busy || testing || !isDesktop}
              onClick={async () => {
                setTesting(true);
                setTestResult(null);
                try {
                  if (await save()) setTestResult(await bridge.testConnection());
                } catch (err) {
                  setTestResult({ ok: false, message: errorText(err) });
                } finally {
                  setTesting(false);
                }
              }}
            >
              {testing ? <LoaderCircle className="spin" size={16} /> : <KeyRound size={16} />}
              保存并测试对话连接
            </button>
            <span className={`settings-status ${saveStatus}`} role="status" data-status={saveStatus}>
              {saveStatus === 'saving' ? (
                <LoaderCircle className="spin" size={14} />
              ) : saveStatus === 'saved' ? (
                <Check size={14} />
              ) : null}
              {saveStatus === 'saving'
                ? '正在保存…'
                : saveStatus === 'pending'
                  ? '有更改，即将自动保存'
                  : saveStatus === 'error'
                    ? '未保存，请检查上方提示'
                    : '更改会自动保存'}
            </span>
            <button className="button primary" disabled={busy || testing}>
              <Check size={16} />
              保存设置
            </button>
          </div>
        </fieldset>
      </form>
    </>
  );
}
