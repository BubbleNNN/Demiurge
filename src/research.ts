import type { KeyStatus, Settings } from './types';
export const searchProviderNames = {
  none: '暂不使用联网搜索',
  claude: 'Claude 原生搜索',
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
    (keys.searchKey ? 'tavily' : settings.llmProtocol === 'anthropic' ? 'claude' : 'none')
  );
}
