import type { ChatReply, Character } from './types';
export interface PreviewTurn {
  id: string;
  question: string;
  reply: ChatReply;
  feedback?: 'fits' | 'adjust';
  issues: string[];
  note: string;
}
export const previewIssues = ['身份设定', '事实依据', '说话语气', '相处关系', '动作表现'] as const;
export const previewActionNames = {
  walk_left:'向左跑',walk_right:'向右跑',walk_up:'向后跑',walk_down:'向前跑',drag:'被拎起',listen:'倾听',sit:'坐下',lie:'趴着',fly:'飞行',
  office:'办公',
  idle: '待机',
  wave: '招手',
  read: '读书',
  gaming: '玩掌机',
  snack: '吃点心',
  music: '听音乐',
  diary: '写日记',
  nod: '点头',
  shake: '摇头',
  sleep: '休息',
  bounce: '跳跃',
};
export function previewSummary(character: Pick<Character, 'name' | 'work'>, turns: PreviewTurn[]) {
  const excerpt = (text: string, limit: number) => (text.length > limit ? text.slice(0, limit) + '…' : text);
  return [
    `Demiurge 试聊摘要 · ${excerpt(character.name, 80)} · ${excerpt(character.work, 120)}`,
    '以下为用户人工标记；问答为摘录，不是模型自动评分。',
    ...turns
      .slice(-8)
      .map((turn, index) =>
        [
          `\n第 ${index + 1} 轮 · ${turn.feedback === 'fits' ? '贴合角色' : turn.feedback === 'adjust' ? '需要调整' : '尚未标记'}`,
          `问：${excerpt(turn.question, 120)}`,
          `答：${excerpt(turn.reply.text, 240)}`,
          `动作：${previewActionNames[turn.reply.action]}`,
          turn.feedback === 'adjust' && turn.issues.length ? `关注：${turn.issues.join('、')}` : '',
          turn.note ? `备注：${excerpt(turn.note, 100)}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      ),
  ].join('\n');
}
