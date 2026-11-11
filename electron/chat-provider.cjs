'use strict';
const presets = require('../shared/chat-providers.json');
function parameters(settings) {
  const provider = settings.llmProvider;
  const json = settings.llmOutputMode ?? (provider === 'minimax' ? 'prompt' : 'json');
  const result = json === 'prompt' ? {} : { response_format: { type: 'json_object' } };
  if (
    settings.llmThinking === 'off' &&
    (provider === 'qwen' ||
      /\.(?:qianwenaiapi\.com|qwencloudapi\.com|aliyuncs\.com)(?:\/|$)/.test(settings.llmBaseUrl || ''))
  )
    result.enable_thinking = false;
  return result;
}
function requestUrl(settings) {
  try {
    const url = new URL(settings.llmBaseUrl);
    if (url.username || url.password || url.search || url.hash) return '地址无效';
    const suffix =
      settings.llmProtocol === 'anthropic'
        ? /\/v1\/?$/.test(url.pathname)
          ? 'messages'
          : 'v1/messages'
        : 'chat/completions';
    return settings.llmEndpointMode === 'exact' ? url.href : url.href.replace(/\/+$/, '') + '/' + suffix;
  } catch {
    return '请填写有效的服务地址';
  }
}
module.exports = { presets, parameters, requestUrl };
