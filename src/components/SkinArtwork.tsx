import type { Skin } from '../types';
import { useId, useEffect, useRef } from 'react';
import { skinImage } from '../theme';
import { legacyAtlas, spriteAnimation } from '../artwork';
import { prepareSpriteFrame } from '../animation/sprites';
export function SkinArtwork({
  skin,
  alt = '',
  emotion = 'neutral',
}: {
  skin?: Skin;
  alt?: string;
  emotion?: string;
}) {
  const clip = useId();
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = skinImage(skin, emotion);
  const animation = spriteAnimation(skin);
  useEffect(() => {
    if (!animation || !image || !canvas.current) return;
    const node = canvas.current,
      source = new Image();
    // Stored atlases are another origin; CORS keeps the drawn canvas readable.
    if (image.startsWith('mori-asset:')) source.crossOrigin = 'anonymous';
    let disposed = false;
    source.onload = () => {
      if (disposed) return;
      try {
        const cell = prepareSpriteFrame(source, animation, animation.clips.idle.frames[0]);
        node.width = cell.width;
        node.height = cell.height;
        node.getContext('2d')?.drawImage(cell, 0, 0);
      } catch {
        /* The stage reports invalid animation assets. */
      }
    };
    source.src = image;
    return () => {
      disposed = true;
      source.onload = null;
    };
  }, [image, animation]);
  if (!image) return null;
  if (animation)
    return (
      <canvas
        ref={canvas}
        className={`skin-portrait ${animation.pixelated ? 'pixel-art' : ''}`}
        aria-label={alt || undefined}
        role={alt ? 'img' : undefined}
        aria-hidden={!alt}
      />
    );
  return legacyAtlas(skin) ? (
    <svg
      className={`skin-portrait ${skin?.style === 'pixel' ? 'pixel-art' : ''}`}
      viewBox="0 0 512 768"
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
      aria-hidden={!alt}
    >
      <defs>
        <clipPath id={clip}>
          <rect width="512" height="768" />
        </clipPath>
      </defs>
      <image href={image} width="1024" height="1536" clipPath={`url(#${clip})`} />
    </svg>
  ) : (
    <img src={image} alt={alt} draggable={false} />
  );
}
