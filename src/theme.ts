import type { CSSProperties } from 'react';
import type { ArtStyle, Character, Skin, ThemeName } from './types';
import * as motionPack from '../shared/cyrene-motion-pack.json';
export const styles: { id: ArtStyle; name: string; detail: string; color: string }[] = [
  { id: 'original', name: '原作', detail: '原作线条、上色与比例', color: '#f0dce9' },
  { id: '8bit', name: '8bit', detail: '粗像素 · 16 色 · 逐帧姿势', color: '#d7dbf0' },
  { id: '3d', name: '3D', detail: '立体造型与光照', color: '#d6e4ef' },
  { id: 'chibi-pet', name: 'Q版', detail: '先搜索现成形象 · 无参考时用芙宁娜贴纸画风', color: '#d7eceb' },
];
export const availableStyle = (style: ArtStyle) => styles.some((entry) => entry.id === style) || ['anime','chibi','sticker','pastel','powerpuff','pixel','figure'].includes(style);
export const themes: {
  id: ThemeName;
  name: string;
  accent: string;
  companion: string;
  paper: string;
  ink: string;
}[] = [
  { id: 'rose', name: '花与记忆', accent: '#b95882', companion: '#a899cf', paper: '#fcf8fa', ink: '#493342' },
  {
    id: 'violet',
    name: '紫色月光',
    accent: '#8063b5',
    companion: '#afa8d9',
    paper: '#faf8fd',
    ink: '#3f3456',
  },
  {
    id: 'ocean',
    name: '晴空回信',
    accent: '#427da8',
    companion: '#88bdc5',
    paper: '#f6fafc',
    ink: '#304755',
  },
  {
    id: 'forest',
    name: '森林来客',
    accent: '#4f806a',
    companion: '#aeb998',
    paper: '#f8faf7',
    ink: '#354b40',
  },
  {
    id: 'amber',
    name: '日落琥珀',
    accent: '#a96c43',
    companion: '#d3aa79',
    paper: '#fcf9f5',
    ink: '#554131',
  },
];
export function resolveTheme(character: Character) {
  if (character.theme && character.theme !== 'auto')
    return themes.find((t) => t.id === character.theme) ?? themes[0];
  const text = `${character.name} ${character.appearance}`;
  const index = /昔涟|昔漣|爱莉希雅|cyrene|elysia|粉|pink|rose/i.test(text)
    ? 0
    : /紫|雷电|violet|purple/i.test(text)
      ? 1
      : /蓝|水色|blue|ocean/i.test(text)
        ? 2
        : /绿|森林|green|forest/i.test(text)
          ? 3
          : /金|橙|amber|orange|gold/i.test(text)
            ? 4
            : 0;
  return themes[index];
}
export function themeVars(character: Character): CSSProperties {
  const theme = resolveTheme(character);
  return {
    '--accent': character.accent || theme.accent,
    '--companion': theme.companion,
    '--paper': theme.paper,
    '--ink': theme.ink,
  } as CSSProperties;
}
export function skinImage(skin?: Skin, emotion = 'neutral'): string | undefined {
  if (!skin) return undefined;
  return (
    skin.images[emotion as keyof Skin['images']] ||
    skin.images.neutral ||
    (skin.builtin
      ? `./art/${!skin.sprite ? (motionPack.entries as { builtin: string; file: string }[]).find((entry) => entry.builtin === skin.builtin)?.file || skin.builtin + '.png' : skin.builtin + '.png'}`
      : undefined)
  );
}
export const styleName = (style: ArtStyle) => styles.find((s) => s.id === style)?.name || ({anime:'旧版精绘',chibi:'旧版 Q 版',sticker:'旧版清爽贴纸',pastel:'旧版柔彩',powerpuff:'旧版飞天小女警',pixel:'旧版像素',figure:'旧版手办'} as Partial<Record<ArtStyle,string>>)[style] || style;
export const engineName = (skin?: Skin) =>
  skin?.kind === 'glb'
    ? '生成的 3D 模型'
    : skin?.kind === 'live2d'
      ? 'Live2D'
      : skin?.kind === 'vrm'
        ? 'VRM 3D'
        : skin?.sprite ||
            (skin?.builtin &&
              !skin.images.neutral &&
              (skin.builtin === 'cyrene-8bit-v5' ||
                (motionPack.entries as { builtin: string }[]).some(
                  (entry) => entry.builtin === skin.builtin,
                )))
          ? '逐帧动画'
          : skin?.style === '3d'
            ? '3D 风格立绘'
            : '2D 立绘';
