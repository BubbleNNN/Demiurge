import type { SpriteAnimation, SpriteFrame } from '../types';

// Logical size controls composition. Texture size controls detail; never use
// the logical size as a forced downsampling target for illustrated frames.
export function spriteCellSize(animation: SpriteAnimation, frame: SpriteFrame) {
  if (animation.pixelated) return { width: animation.width, height: animation.height };
  const scale = Math.max(frame.rect[2] / animation.width, frame.rect[3] / animation.height);
  return {
    width: Math.max(1, Math.round(animation.width * scale)),
    height: Math.max(1, Math.round(animation.height * scale)),
  };
}

export function spritePlacement(
  width: number,
  height: number,
  cellWidth: number,
  cellHeight: number,
  pixelated: boolean,
  zoom = 1,
) {
  let scale = Math.min(width / cellWidth, height / cellHeight) * 0.94 * zoom;
  if (pixelated && scale >= 1) scale = Math.max(1, Math.floor(scale));
  const w = cellWidth * scale,
    h = cellHeight * scale;
  return { x: Math.round((width - w) / 2), y: Math.round(height * 0.98 - h), width: w, height: h, scale };
}
