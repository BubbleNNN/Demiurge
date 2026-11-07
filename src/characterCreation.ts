import type { Character } from './types';

export function createLocalCharacter(input: {
  id: string;
  name: string;
  work: string;
  notes: string;
  urls: string;
  createdAt: string;
}): Character {
  const name = input.name.trim();
  if (!name || name.length > 80) throw new Error('请填写角色名字，最多 80 字。');
  if (input.work.trim().length > 120 || input.notes.trim().length > 3000)
    throw new Error('作品名称最多 120 字，补充设定最多 3000 字。');
  const urls = [
    ...new Set(
      input.urls
        .split('\n')
        .map((url) => url.trim())
        .filter(Boolean),
    ),
  ];
  if (urls.length > 6) throw new Error('参考来源最多 6 个，请每行填写一个。');
  for (const url of urls) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('参考来源请填写完整的 HTTPS 网页地址。');
    }
    if (
      url.length > 4096 ||
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.port
    )
      throw new Error('参考来源请填写普通 HTTPS 网页地址，不包含账号、密码或端口。');
    for (const key of parsed.searchParams.keys())
      if (/^(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret)$/i.test(key))
        throw new Error('参考来源不能包含密钥或登录凭据。');
  }
  return {
    id: input.id,
    name,
    work: input.work.trim(),
    summary: input.notes.trim(),
    personality: [],
    speakingStyle: '',
    appearance: '',
    theme: 'auto',
    knowledge: { kind: 'manual', method: 'manual', collectedAt: input.createdAt },
    companion: { version: 1, replies: {} },
    quotes: [],
    sources: urls.map((url) => ({ title: '用户提供的参考来源（正文尚未整理）', url, snippet: '' })),
    unknowns: ['档案来自用户填写；原作设定、语气和台词尚未整理。'],
    behavior: { energy: 50, affection: 50, curiosity: 50 },
    createdAt: input.createdAt,
  };
}
