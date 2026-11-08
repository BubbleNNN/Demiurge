import type { KeyStatus, Settings } from './types';
export const searchProviderNames = {
  none: '暂不使用联网搜索',
  claude: 'Claude 原生搜索',
  codex: '本机 Codex 搜索（ChatGPT 登录）',
  searxng: 'SearXNG',
  wiki: '公开 Wiki',
  tavily: 'Tavily',
};
export function selectedSearchProvider(
  settings: Settings,
  keys: KeyStatus,
): keyof typeof searchProviderNames {
  return (
    settings.searchProvider ||
    (keys.searchKey
      ? 'tavily'
      : settings.llmProtocol === 'anthropic'
        ? 'claude'
        : settings.llmProtocol === 'codex'
          ? 'codex'
          : 'none')
  );
}
export function imageServiceReady(settings: Settings, keys: KeyStatus): boolean {
  return settings.imageProvider === 'codex' || (keys.imageKey && Boolean(settings.imageModel));
}
// Local Codex uses the CLI's own ChatGPT login: no API key or model ID is required.
export function chatServiceReady(settings: Settings, keys: KeyStatus): boolean {
  return settings.llmProtocol === 'codex' || (keys.llmKey && Boolean(settings.llmModel));
}
