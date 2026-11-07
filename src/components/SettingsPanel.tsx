import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  KeyRound,
  Trash2,
  Sprout,
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
import { bridge, isDesktop } from '../bridge';
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
  onSaved: (settings: Settings, keys: KeyStatus) => void;
  notify: (text: string) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const baseSettings = useRef(settings);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [credentials, setCredentials] = useState<Credentials>({});
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [searchResult, setSearchResult] = useState<{ ok: boolean; message: string } | null>(null);
  const provider = selectedSearchProvider(draft, keys);
  const settingsSignature = JSON.stringify(settings);
  useEffect(() => {
    if (JSON.stringify(draftRef.current) === JSON.stringify(baseSettings.current)) {
      baseSettings.current = settings;
      setDraft(settings);
    }
  }, [settingsSignature]);
  async function save(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError('');
    try {
      const value = await bridge.saveSettings(draft, credentials, baseSettings.current);
      const loaded = await bridge.load();
      const saved = loaded.state?.settings || draft;
      baseSettings.current = saved;
      setDraft(saved);
      onSaved(saved, value);
      setCredentials({});
      return true;
    } catch (err) {
      setError(errorText(err));
      return false;
    } finally {
      setBusy(false);
    }
  }
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
          placeholder={keys[key] ? '已保存 · 留空保持原密钥' : '粘贴 API Key，仅保存在本机'}
          disabled={!isDesktop}
        />
        {keys[key] && (
          <button
            type="button"
            onClick={() => {
              setCredentials({ ...credentials, [key]: '' });
              notify('此密钥将在点击「保存设置」后删除。');
            }}
            title="删除已存密钥"
            aria-label={`删除${label}`}
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
      {credentials[key] === '' && keys[key] && <small className="field-warning">保存后将清除此密钥。</small>}
    </label>
  );
  return (
    <>
      <section className="page-heading">
        <div className="eyebrow">服务连接</div>
        <h1>接通她的声音与想法</h1>
        <p>接入自己的 API，让角色拥有更自由的表达。</p>
      </section>
      {!isDesktop && (
        <div className="notice">
          当前为界面预览。真实 API、模型导入和密钥存储在桌面开发版运行：pnpm desktop。
        </div>
      )}
      <form className="settings-form" onSubmit={save}>
        <fieldset className="settings-fields-lock" disabled={busy || testing}>
          <section className="settings-card developer-note">
            <Sprout size={23} />
            <div>
              <h2>你的服务，你的角色</h2>
              <p>角色包、本地台词和日常互动无需 API。自由聊天、绘图与语音合成按需连接各自服务。</p>
            </div>
          </section>
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
                    onSaved(settings, status);
                    notify('原密钥文件已保留，失效凭据已清除。请填写需要的密钥并保存设置。');
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
                <p>支持 OpenAI 兼容接口与 Claude / Anthropic Messages 接口。</p>
              </div>
              <span className={`small-badge ${keys.llmKey ? 'green' : ''}`}>
                {keys.llmKey ? '密钥已配置' : '自由聊天可选'}
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
                  <option value="model">模型对话 · 使用 API</option>
                  <option value="local">本地台词 · 不调用模型</option>
                </select>
                <small>本地台词按场景和关键词选择，不回答开放问题，也不会自动调用语音服务。</small>
              </label>
              {keyField('llmKey', '对话 API Key')}
              <label>
                接口协议
                <select
                  aria-label="对话接口协议"
                  value={draft.llmProtocol || 'openai'}
                  onChange={(e) =>
                    setDraft({ ...draft, llmProtocol: e.target.value as 'openai' | 'anthropic' })
                  }
                >
                  <option value="openai">OpenAI 兼容 · Chat Completions</option>
                  <option value="anthropic">Claude / Anthropic · Messages（Claude Code 接入方式）</option>
                </select>
              </label>
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
                <p>多画风立绘使用图像编辑接口；程序像素动画可使用上方聊天模型。</p>
              </div>
              <span className="small-badge">生成外观时使用</span>
            </summary>
            <div className="settings-fields">
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
                恢复会替换当前工作区；Mori 会先验证备份，并在还原前保留当前副本。恢复成功后自动重新打开。
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
            <button className="button primary" disabled={busy || testing}>
              {busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}保存设置
            </button>
          </div>
        </fieldset>
      </form>
    </>
  );
}
