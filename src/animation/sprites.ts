import type { SpriteAnimation } from '../types';
import { spriteCellSize, spritePlacement } from './resolution';
import type { FigureBounds } from './framing';

/**
 * A decoded frame that keeps only its visible pixels. `image` holds them; `width` and `height`
 * are the frame's full canvas, and `x`, `y` are where `image` sits inside it.
 */
export interface SpriteCell {
  image: HTMLCanvasElement;
  width: number;
  height: number;
  x: number;
  y: number;
}
type Drawable = SpriteCell | HTMLCanvasElement;
const isCell = (value: Drawable): value is SpriteCell => 'image' in value;
export function asSpriteCell(value: Drawable): SpriteCell {
  return isCell(value) ? value : { image: value, width: value.width, height: value.height, x: 0, y: 0 };
}

// Convert to display cells once. Indexed pixel rendering is an explicit art
// constraint. Other styles retain their authored RGBA pixels with no warping.
export function prepareSpriteFrame(image: HTMLImageElement, animation: SpriteAnimation, index: number) {
  return paint(image, animation, index, false).image;
}
function paint(image: HTMLImageElement, animation: SpriteAnimation, index: number, trim: boolean): SpriteCell {
  const frame = animation.frames[index];
  if (!frame) throw new Error('动画帧索引无效');
  const palette = animation.palette?.map((color) =>
    [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)),
  );
  const canvas = document.createElement('canvas');
  const size = spriteCellSize(animation, frame);
  if (size.width > 8192 || size.height > 8192 || size.width * size.height > 16 * 1024 * 1024)
    throw new Error('单帧纹理超过安全尺寸，请拆分动画素材');
  const [x, y, width, height] = frame.rect;
  // A trimmed frame decodes into a canvas of its stored size only; the transparent rest of its
  // full canvas is never allocated.
  const piece = trim && Boolean(frame.cell);
  canvas.width = piece ? width : size.width;
  canvas.height = piece ? height : size.height;
  const context = canvas.getContext('2d', { willReadFrequently: Boolean(palette) });
  if (!context) throw new Error('无法创建逐帧画布');
  if (x + width > image.naturalWidth || y + height > image.naturalHeight)
    throw new Error('动画帧超出图集边界');
  context.imageSmoothingEnabled = !animation.pixelated;
  if (!animation.pixelated) context.imageSmoothingQuality = 'high';
  if (piece) context.drawImage(image, x, y, width, height, 0, 0, width, height);
  else if (frame.cell) {
    // Trimmed frame: the stored pixels go back where they came from, one to one.
    context.drawImage(image, x, y, width, height, frame.offset?.[0] || 0, frame.offset?.[1] || 0, width, height);
  } else {
    const scale = Math.min(canvas.width / width, canvas.height / height);
    context.drawImage(
      image,
      x,
      y,
      width,
      height,
      (canvas.width - width * scale) / 2 + ((frame.offset?.[0] || 0) * canvas.width) / animation.width,
      (canvas.height - height * scale) / 2 + ((frame.offset?.[1] || 0) * canvas.height) / animation.height,
      width * scale,
      height * scale,
    );
  }
  if (palette?.length) {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = pixels.data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 180) {
        data[i + 3] = 0;
        continue;
      }
      let nearest = palette[0],
        distance = Infinity;
      for (const color of palette) {
        const d = (data[i] - color[0]) ** 2 + (data[i + 1] - color[1]) ** 2 + (data[i + 2] - color[2]) ** 2;
        if (d < distance) {
          nearest = color;
          distance = d;
        }
      }
      data[i] = nearest[0];
      data[i + 1] = nearest[1];
      data[i + 2] = nearest[2];
      data[i + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
  }
  return piece
    ? { image: canvas, width: size.width, height: size.height, x: frame.offset?.[0] || 0, y: frame.offset?.[1] || 0 }
    : { image: canvas, width: canvas.width, height: canvas.height, x: 0, y: 0 };
}
/** Decode the frames that live on one atlas page, keyed by frame index. */
export function prepareSpritePage(image: HTMLImageElement, animation: SpriteAnimation, page: number) {
  const indices = animation.frames.map((frame, index) => ((frame.page || 0) === page ? index : -1)).filter((i) => i >= 0);
  const pixels = indices.reduce((sum, index) => {
    const frame = animation.frames[index];
    if (frame.cell) return sum + frame.rect[2] * frame.rect[3];
    const size = spriteCellSize(animation, frame);
    return sum + size.width * size.height;
  }, 0);
  if (pixels > 32 * 1024 * 1024) throw new Error('动画解码超过内存预算，请拆分素材包');
  return new Map(indices.map((index) => [index, paint(image, animation, index, true)] as const));
}
export function prepareSpriteFrames(image: HTMLImageElement, animation: SpriteAnimation): SpriteCell[] {
  // Budget what is actually decoded: a trimmed frame costs its stored pixels, not its canvas.
  const pixels = animation.frames.reduce((sum, frame) => {
    if (frame.cell) return sum + frame.rect[2] * frame.rect[3];
    const size = spriteCellSize(animation, frame);
    return sum + size.width * size.height;
  }, 0);
  if (pixels > 32 * 1024 * 1024) throw new Error('动画解码超过内存预算，请拆分素材包');
  return animation.frames.map((_, index) => paint(image, animation, index, true));
}
// The canvas's size on screen. A rotation (the pet swinging while carried) must not change it,
// but a zoom from a scaled ancestor must, so the drawing stays sharp. Layout size times the
// rotation-free scale of every transformed ancestor gives exactly that.
function displaySize(canvas: HTMLCanvasElement) {
  if (!canvas.offsetWidth || typeof getComputedStyle !== 'function' || typeof DOMMatrixReadOnly !== 'function') {
    const rect = canvas.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }
  let scale = 1;
  for (let node: Element | null = canvas; node; node = node.parentElement) {
    const transform = getComputedStyle(node).transform;
    if (transform && transform !== 'none') {
      const m = new DOMMatrixReadOnly(transform);
      scale *= Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
    }
  }
  return { width: canvas.offsetWidth * scale, height: canvas.offsetHeight * scale };
}
export function drawSpriteFrame(
  canvas: HTMLCanvasElement,
  drawable: Drawable,
  pixelated: boolean,
  zoom = 1,
  figure?: FigureBounds,
) {
  const cell = asSpriteCell(drawable);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法绘制动画');
  const bounds = displaySize(canvas);
  // Respect Retina/HiDPI screens beyond 2x, with an explicit viewport memory
  // budget instead of silently capping every screen at 2x.
  const ratio = Math.min(
    Math.max(1, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1),
    Math.sqrt((16 * 1024 * 1024) / Math.max(1, bounds.width * bounds.height)),
  );
  const width = Math.max(1, Math.round(bounds.width * ratio));
  const height = Math.max(1, Math.round(bounds.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.clearRect(0, 0, width, height);
  context.imageSmoothingEnabled = !pixelated;
  // Frames are usually enlarged on the stage; the high-quality filter keeps edges cleaner.
  if (!pixelated) context.imageSmoothingQuality = 'high';
  const placement = spritePlacement(
    width,
    height,
    cell.width * (figure?.width || 1),
    cell.height * (figure?.height || 1),
    pixelated,
    zoom,
  );
  context.drawImage(
    cell.image,
    placement.x + (cell.x - (figure?.x || 0) * cell.width) * placement.scale,
    placement.y + (cell.y - (figure?.y || 0) * cell.height) * placement.scale,
    cell.image.width * placement.scale,
    cell.image.height * placement.scale,
  );
  canvas.dataset.figureBounds = JSON.stringify({
    x: placement.x,
    y: placement.y,
    width: placement.width,
    height: placement.height,
  });
  canvas.dataset.sourceSize = `${cell.width}x${cell.height}`;
  canvas.dataset.displaySize = `${Math.round(placement.width)}x${Math.round(placement.height)}`;
  canvas.dataset.upscale = placement.scale.toFixed(2);
  return placement;
}
