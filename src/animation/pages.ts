import type { SpriteAnimation } from '../types';
import type { FigureBounds } from './framing';

/** Where the image for one atlas page comes from: page 0 is the skin's own image. */
export function pageSource(image: string, animation: SpriteAnimation, page: number) {
  return page ? animation.pages?.[page - 1]?.src : image;
}
export const pageOf = (animation: SpriteAnimation, index: number) => animation.frames[index]?.page || 0;

/**
 * Load an atlas image. Stored atlases come from the app's own asset scheme, a different origin
 * from the page, so they are requested with CORS: a canvas that draws them stays readable, which
 * the click hit-testing and framing rely on.
 */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (src.startsWith('mori-asset:')) image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('动画图集无法加载'));
    image.src = src;
  });
}

/**
 * The crop shared by a whole trimmed animation, from frame metadata alone: every frame records
 * where its visible pixels sit in its canvas, so no page has to be decoded to know it.
 */
export function figureFromFrames(animation: SpriteAnimation): FigureBounds | null {
  let left = 1,
    top = 1,
    right = 0,
    bottom = 0;
  for (const frame of animation.frames) {
    if (!frame.cell || !frame.offset) return null;
    const [cw, ch] = frame.cell,
      [ox, oy] = frame.offset;
    left = Math.min(left, ox / cw);
    top = Math.min(top, oy / ch);
    right = Math.max(right, (ox + frame.rect[2]) / cw);
    bottom = Math.max(bottom, (oy + frame.rect[3]) / ch);
  }
  if (right <= left || bottom <= top) return null;
  const pad = 2 / 128;
  left = Math.max(0, left - pad);
  top = Math.max(0, top - pad);
  right = Math.min(1, right + pad);
  bottom = Math.min(1, bottom + pad);
  return { x: left, y: top, width: right - left, height: bottom - top };
}
