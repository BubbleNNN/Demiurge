export interface FigureBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export const fullFigure: FigureBounds = { x: 0, y: 0, width: 1, height: 1 };

// One shared crop for the entire sequence: a raised arm must not resize the body.
export function measureSequenceBounds(cells: HTMLCanvasElement[]): FigureBounds {
  const probe = document.createElement('canvas');
  probe.width = probe.height = 128;
  const context = probe.getContext('2d', { willReadFrequently: true });
  if (!context) return fullFigure;
  let left = 128,
    top = 128,
    right = -1,
    bottom = -1;
  try {
    for (const cell of cells) {
      context.clearRect(0, 0, 128, 128);
      context.drawImage(cell, 0, 0, 128, 128);
      const data = context.getImageData(0, 0, 128, 128).data;
      for (let y = 0; y < 128; y++)
        for (let x = 0; x < 128; x++) {
          if (data[(y * 128 + x) * 4 + 3] < 64) continue;
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
        }
    }
  } catch {
    return fullFigure;
  }
  if (right < left || bottom < top) return fullFigure;
  left = Math.max(0, left - 2);
  top = Math.max(0, top - 2);
  right = Math.min(127, right + 2);
  bottom = Math.min(127, bottom + 2);
  return { x: left / 128, y: top / 128, width: (right - left + 1) / 128, height: (bottom - top + 1) / 128 };
}

export function hitCharacter(root: Element, clientX: number, clientY: number): 'headpat' | 'poke' | null {
  const canvas = root.querySelector<HTMLCanvasElement>('.animated-illustration canvas:not(.canvas-pending)');
  if (canvas) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = Math.floor(((clientX - rect.left) * canvas.width) / rect.width);
    const y = Math.floor(((clientY - rect.top) * canvas.height) / rect.height);
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null;
    try {
      if ((canvas.getContext('2d')?.getImageData(x, y, 1, 1).data[3] || 0) < 40) return null;
      const bounds = JSON.parse(canvas.dataset.figureBounds || 'null') as FigureBounds | null;
      const localY = bounds ? (y - bounds.y) / bounds.height : y / canvas.height;
      const style = root.querySelector<HTMLElement>('[data-art-style]')?.dataset.artStyle;
      const head =
        style === 'powerpuff' ? 0.6 : ['chibi-pet', 'chibi', 'sticker', 'pastel', 'figure', '8bit', 'pixel'].includes(style || '') ? 0.42 : 0.28;
      return localY < head ? 'headpat' : 'poke';
    } catch {
      return null;
    }
  }
  if (root.querySelector('.animated-illustration')) return null;
  // Static pictures and imported models have no readable sprite alpha map.
  const rect = root.getBoundingClientRect();
  const x = (clientX - rect.left) / rect.width,
    y = (clientY - rect.top) / rect.height;
  return x >= 0.25 && x <= 0.75 && y >= 0.08 && y <= 0.95 ? (y < 0.38 ? 'headpat' : 'poke') : null;
}
