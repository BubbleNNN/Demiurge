import type { ArtStyle, Skin } from './types';

export interface GenerationItem {
  style: ArtStyle;
  status: 'queued' | 'generating' | 'saving' | 'saved' | 'failed' | 'unsaved';
  skin?: Skin;
  error?: string;
}

export function generationQueue(styles: ArtStyle[]): GenerationItem[] {
  return [...new Set(styles)].map((style) => ({ style, status: 'queued' }));
}

export async function runGenerationQueue(
  items: GenerationItem[],
  options: {
    generate: (style: ArtStyle) => Promise<Skin>;
    save: (skin: Skin) => Promise<void>;
    onChange: (items: GenerationItem[]) => void;
    shouldStop: () => boolean;
    styles?: ArtStyle[];
  },
): Promise<GenerationItem[]> {
  const result = items.map((item) => ({ ...item }));
  const update = (index: number, change: Partial<GenerationItem>) => {
    result[index] = { ...result[index], ...change };
    options.onChange(result.map((item) => ({ ...item })));
  };
  for (let index = 0; index < result.length; index++) {
    if (options.shouldStop() || result[index].status === 'unsaved') break;
    if (result[index].status !== 'queued') continue;
    if (options.styles && !options.styles.includes(result[index].style)) continue;
    update(index, { status: 'generating', error: undefined });
    let skin: Skin;
    try {
      skin = await options.generate(result[index].style);
    } catch (error) {
      update(index, {
        status: 'failed',
        error: error instanceof Error ? error.message : '候选生成未完成。',
      });
      continue;
    }
    update(index, { status: 'saving', skin });
    try {
      await options.save(skin);
      update(index, { status: 'saved' });
    } catch (error) {
      // Keep the returned pixels and stop before another paid image request.
      update(index, {
        status: 'unsaved',
        error: error instanceof Error ? error.message : '图片尚未保存到本机。',
      });
      break;
    }
  }
  return result;
}
