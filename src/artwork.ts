import type { Skin, SpriteAnimation, PetAction, Emotion } from './types';
import * as authoredCyrene from '../shared/cyrene-sprite.json';
import * as motionPack from '../shared/cyrene-motion-pack.json';

type BuiltinMotion = {
  builtin: string;
  file: string;
  style: string;
  animation: SpriteAnimation;
  pageFiles?: string[];
};
const renderedBuiltins = (motionPack.entries as unknown as BuiltinMotion[]).map((entry) => ({
  ...entry,
  animation: {
    ...entry.animation,
    ...(entry.animation.pages
      ? { pages: entry.animation.pages.map((page, i) => ({ ...page, src: `./art/${entry.pageFiles![i]}` })) }
      : {}),
  },
}));
export function builtinMotion(skin?: Skin): BuiltinMotion | undefined {
  if (!skin?.builtin || skin.images.neutral || skin.sprite) return undefined;
  return renderedBuiltins.find((entry) => entry.builtin === skin.builtin);
}

export const pixelPalette = [
  '#30213d',
  '#583a69',
  '#815488',
  '#ad5887',
  '#e88bb3',
  '#ffd1df',
  '#fff2db',
  '#e8b2a0',
  '#c47b86',
  '#ffffff',
  '#c8c4e4',
  '#897bba',
  '#4a398a',
  '#302765',
  '#69a6eb',
  '#f6d37e',
];
// Renderer and exported character packs use the same authored frame timings.
export const pixelAnimation = authoredCyrene as unknown as SpriteAnimation;
export function spriteAnimation(skin?: Skin): SpriteAnimation | undefined {
  if (skin?.sprite) return skin.sprite;
  const authored = builtinMotion(skin);
  if (authored) return authored.animation;
  return skin?.builtin === 'cyrene-8bit-v5' && !skin.images.neutral ? pixelAnimation : undefined;
}
export function legacyAtlas(skin?: Skin) {
  return Boolean(skin?.builtin?.endsWith('-v4') && !skin.images.neutral);
}
export function supportsAction(skin: Skin | undefined, action: PetAction) {
  if (action === 'idle') return true;
  const animation = spriteAnimation(skin);
  if (animation) return Boolean(animation.clips[action]);
  if (skin?.kind === 'live2d') {
    const group = skin.model?.motionMap?.[action] || action;
    return Boolean(skin.model?.motions[group]);
  }
  if (skin?.kind === 'glb')
    return Boolean(
      skin.model?.motionMap?.[action] ||
        ((action === 'nod' || action === 'shake') && skin.model?.boneMap?.head),
    );
  return skin?.kind === 'vrm' && ['idle', 'wave', 'nod', 'shake', 'sleep', 'bounce'].includes(action);
}
export function supportsEmotion(skin: Skin | undefined, emotion: Emotion) {
  if (emotion === 'neutral') return true;
  const animation = spriteAnimation(skin);
  if (animation) return Boolean(animation.clips[emotion]);
  if (skin?.kind === 'live2d' || skin?.kind === 'vrm') return true;
  return Boolean(skin?.images[emotion]);
}
export function animationDescription(skin?: Skin) {
  const animation = spriteAnimation(skin);
  if (animation)
    return animation.pixelated
      ? `${animation.width} × ${animation.height} · ${animation.palette?.length || '原始'} 色 · 原画逐帧播放`
      : '原画逐帧播放 · 按素材时序切换';
  return skin?.style === '3d' ? '低多边形 3D 风格立绘 · 静态图像' : '静态立绘 · 可导入动画素材';
}
