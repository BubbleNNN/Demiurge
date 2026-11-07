export interface CreationDraft {
  name: string;
  work: string;
  notes: string;
  urls: string;
  mode: 'manual' | 'draft' | 'links' | 'search';
}
export const creationDraftKey = 'mori:character-draft:v1';
export const emptyCreationDraft = (): CreationDraft => ({
  name: '',
  work: '',
  notes: '',
  urls: '',
  mode: 'manual',
});
export function parseCreationDraft(value: string | null): CreationDraft {
  try {
    const input = JSON.parse(value || '{}');
    const field = (key: string, max: number) =>
      typeof input?.[key] === 'string' ? input[key].slice(0, max) : '';
    return {
      name: field('name', 80),
      work: field('work', 120),
      notes: field('notes', 3000),
      urls: field('urls', 12000),
      mode: ['manual', 'draft', 'links', 'search'].includes(input?.mode) ? input.mode : 'manual',
    };
  } catch {
    return emptyCreationDraft();
  }
}
