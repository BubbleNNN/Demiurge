import type { SpriteCell } from './sprites';

/**
 * Keeping her head one size. Image models draw some frames of a motion a few percent larger or
 * smaller than the rest pose (an expression portrait, a lean toward the viewer), and the head is
 * where that shows: it seems to swell or shrink when the clip changes. Each upright frame is
 * measured once when it is decoded, its head band (the top of the drawing) compared with the rest
 * pose's, and the frame drawn scaled around her feet by the difference. Frames whose pose is not
 * upright (sitting, lying, crouching) are left as drawn. Playback only; packs are not changed.
 */
export interface HeadMetrics {
  /** Widest row near the top of the drawing, as a share of the frame's canvas width. */
  head: number;
  /** Height of the drawing, as a share of the frame's canvas height. */
  height: number;
}
const PROBE = 160;
export function measureHead(cell: SpriteCell): HeadMetrics | null {
  const scale = PROBE / cell.width;
  const width = PROBE,
    height = Math.max(1, Math.round(cell.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  try {
    context.drawImage(
      cell.image,
      cell.x * scale,
      cell.y * scale,
      cell.image.width * scale,
      cell.image.height * scale,
    );
    const data = context.getImageData(0, 0, width, height).data;
    const opaque = (x: number, y: number) => data[(y * width + x) * 4 + 3] > 128;
    let top = -1,
      bottom = -1;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (opaque(x, y)) {
          if (top < 0) top = y;
          bottom = y;
          break;
        }
    if (top < 0) return null;
    const band = Math.round(height * 0.18);
    let widest = 0;
    for (let y = top; y < Math.min(height, top + band); y++) {
      let left = -1,
        right = -1;
      for (let x = 0; x < width; x++)
        if (opaque(x, y)) {
          if (left < 0) left = x;
          right = x;
        }
      if (left >= 0) widest = Math.max(widest, right - left + 1);
    }
    return { head: widest / width, height: (bottom - top + 1) / height };
  } catch {
    return null;
  }
}
/** How much to scale a frame so its head matches the rest pose's: 1 to leave it as drawn. */
export function headCorrection(frame: HeadMetrics | null, rest: HeadMetrics | null) {
  if (!frame || !rest || !frame.head || !rest.head) return 1;
  // Not standing upright like the rest pose: a different pose, not a different size.
  if (Math.abs(frame.height / rest.height - 1) > 0.08) return 1;
  const ratio = rest.head / frame.head;
  if (Math.abs(ratio - 1) < 0.025) return 1;
  return Math.max(0.9, Math.min(1.1, ratio));
}
