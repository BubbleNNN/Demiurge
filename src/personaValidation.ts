import type { Character } from './types';
export function personaDraftError(character: Character): string {
  for (const entries of Object.values(character.dossier || {})) {
    if (entries.length>32) return '每类人物资料最多32条。';
    if (entries.some(entry=>!entry.title.trim() || !entry.detail.trim())) return '请补全人物资料的标题和内容，或删除空条目。';
  }
  if (!character.roleplay) return '';
  for (const [field, label, count, length] of [
    ['voiceRules', '语气习惯', 12, 400],
    ['avoid', '应避免的表达', 12, 400],
    ['customFacts', '创作设定', 24, 500],
  ] as const) {
    const lines = character.roleplay[field];
    if (lines.length > count) return `${label}最多 ${count} 条，请合并一些行后保存。`;
    const index = lines.findIndex((line) => line.length > length);
    if (index >= 0)
      return `${label}第 ${index + 1} 条有 ${lines[index].length} 字，每条最多 ${length} 字。可以分成多条。`;
  }
  return '';
}
