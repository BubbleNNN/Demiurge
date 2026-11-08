import type { SpriteAnimation } from '../types';

/**
 * Packs made before 0.3.23 rest on the approved still (frame 0) between gestures. That still is
 * drawn on its own, and the motions the image model draws after it have slightly different
 * proportions (a smaller head), so her head jumped every time a gesture ended or an activity
 * returned to idle. Such packs also hold the blink sheet's own opening pose, a neutral rest drawn
 * like every motion, unused just before the blink frames. The player rests on that pose instead.
 *
 * Only playback changes: the saved pack is never rewritten, because an approved pack's review
 * records a digest of its clips (rewriting them made the workspace unreadable in 0.3.23). Every
 * frame of a pack, this one included, is checked in the frame review before it can be enabled.
 * Any other pack is returned unchanged.
 */
export function restOnMotionSheet(animation: SpriteAnimation): SpriteAnimation {
  const { clips, frames } = animation;
  const blink = clips.blink;
  if (clips.idle?.frames.length !== 1 || clips.idle.frames[0] !== 0) return animation;
  if (!blink || blink.frames.length < 3 || blink.frames[0] !== 0) return animation;
  const rest = blink.frames[1] - 1;
  const first = frames[blink.frames[1]];
  if (rest < 1 || !frames[rest] || (frames[rest].page || 0) !== 0) return animation;
  if (Object.values(clips).some((clip) => clip?.frames.includes(rest))) return animation;
  // Drawn on the same sheet as the blink: the same canvas, give or take a few percent.
  const cell = frames[rest].cell,
    other = first?.cell;
  if (!cell || !other || cell.some((value, i) => Math.abs(value - other[i]) > other[i] * 0.04))
    return animation;
  const swap = (index: number) => (index === 0 ? rest : index);
  return {
    ...animation,
    clips: Object.fromEntries(
      Object.entries(clips).map(([name, clip]) => [name, clip && { ...clip, frames: clip.frames.map(swap) }]),
    ) as SpriteAnimation['clips'],
    ...(animation.mouthFrames
      ? { mouthFrames: { ...animation.mouthFrames, closed: swap(animation.mouthFrames.closed) } }
      : {}),
  };
}

const rested = new WeakMap<SpriteAnimation, SpriteAnimation>();
/** The same result for the same pack object, so a player keyed on it does not restart. */
export function playbackAnimation(animation: SpriteAnimation): SpriteAnimation {
  let value = rested.get(animation);
  if (!value) rested.set(animation, (value = restOnMotionSheet(animation)));
  return value;
}
