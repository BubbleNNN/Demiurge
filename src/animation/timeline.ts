import type { Emotion, PetAction, SpriteAnimation, SpriteClip } from '../types';

export function clipDuration(animation: SpriteAnimation, clip: SpriteClip) {
  return clip.frames.reduce(
    (total, frame, i) => total + (clip.durations?.[i] ?? animation.frames[frame].duration),
    0,
  );
}
export function clipFrame(animation: SpriteAnimation, clip: SpriteClip, age: number): number {
  const duration = clipDuration(animation, clip);
  let position = Math.max(0, age);
  if (clip.loop) position %= duration;
  else if (position >= duration) return clip.frames.at(-1)!;
  for (let i = 0; i < clip.frames.length; i++) {
    const step = clip.durations?.[i] ?? animation.frames[clip.frames[i]].duration;
    if (position < step) return clip.frames[i];
    position -= step;
  }
  return clip.frames.at(-1)!;
}
export function selectSpriteFrame(
  animation: SpriteAnimation,
  input: {
    time: number;
    age: number;
    action: PetAction;
    emotion: Emotion;
    talking: boolean;
    audioDriven: boolean;
    mouth: number;
    paused: boolean;
  },
): { frame: number; clip: string } {
  const { clips } = animation;
  if (input.action === 'sleep' && clips.sleep)
    return { frame: clipFrame(animation, clips.sleep, input.paused ? 0 : input.age), clip: 'sleep' };
  if (!input.paused) {
    const gesture = input.action !== 'idle' ? clips[input.action] : undefined;
    if (gesture && (gesture.loop || input.age < clipDuration(animation, gesture)))
      return { frame: clipFrame(animation, gesture, input.age), clip: input.action };
    const talk = clips.talk;
    if (input.talking && talk) {
      if (input.audioDriven && animation.mouthFrames) {
        const mouth = Number.isFinite(input.mouth) ? Math.max(0, Math.min(1, input.mouth)) : 0;
        const frames = animation.mouthFrames;
        return {
          frame: mouth <= 0.08 ? frames.closed : mouth < 0.45 ? frames.small : frames.wide,
          clip: 'talk',
        };
      }
      if (!input.audioDriven || input.mouth > 0.08)
        return { frame: clipFrame(animation, talk, input.time), clip: 'talk' };
      return { frame: clips.idle.frames[0], clip: 'idle' };
    }
    const cycle = input.time % 14300;
    const blink = clips.blink;
    if (
      blink &&
      (input.emotion === 'neutral' || !clips[input.emotion]) &&
      [3100, 7800, 12700].some((t) => cycle >= t && cycle < t + clipDuration(animation, blink))
    ) {
      const start = [3100, 7800, 12700].filter((t) => cycle >= t).at(-1)!;
      return { frame: clipFrame(animation, blink, cycle - start), clip: 'blink' };
    }
  }
  const face = input.emotion !== 'neutral' ? clips[input.emotion] : undefined;
  if (face) return { frame: clipFrame(animation, face, 0), clip: input.emotion };
  return { frame: clipFrame(animation, clips.idle, input.paused ? 0 : input.time), clip: 'idle' };
}
