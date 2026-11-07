import type { PetAction, SpriteAnimation } from '../types';
import { clipDuration, clipFrame } from './timeline';

export const isActivity = (action: PetAction) => action === 'read' || action === 'gaming';
export const activityDuration = 60000;
type Transition = 'enter_read' | 'exit_read' | 'enter_gaming' | 'exit_gaming';
export interface ActivityPlayback {
  current: PetAction;
  since: number;
  key: number;
  segment?: { clip: Transition; endAction: PetAction; since: number };
}
export const newActivityPlayback = (): ActivityPlayback => ({ current: 'idle', since: 0, key: -1 });

// Finish the authored segment before adopting the latest target. No fade, inferred
// poses or unbounded click queue. A paused player skips transitions altogether.
export function advanceActivityPlayback(
  state: ActivityPlayback,
  animation: SpriteAnimation,
  target: PetAction,
  time: number,
  key: number,
  paused = false,
  interrupt = false,
): { frame: number; clip: string } | null {
  if (paused || interrupt) {
    state.current = target;
    state.since = time;
    delete state.segment;
  } else if (key !== state.key && target === state.current && !state.segment) {
    state.since = time;
  }
  state.key = key;
  let nextStart = time;
  for (let attempts = 0; attempts < 4; attempts++) {
    if (state.segment) {
      const segment = state.segment;
      const clip = animation.clips[segment.clip]!;
      const end = segment.since + clipDuration(animation, clip);
      if (time < end) return { frame: clipFrame(animation, clip, time - segment.since), clip: segment.clip };
      state.current = segment.endAction;
      state.since = end;
      nextStart = end;
      delete state.segment;
    }
    if (state.current === target) break;
    const exit = `exit_${state.current}` as Transition;
    const enter = `enter_${target}` as Transition;
    const name =
      isActivity(state.current) && animation.clips[exit]
        ? exit
        : isActivity(target) && animation.clips[enter]
          ? enter
          : undefined;
    if (name && !paused && !interrupt) {
      state.segment = { clip: name, endAction: name.startsWith('exit_') ? 'idle' : target, since: nextStart };
    } else {
      state.current = target;
      state.since = nextStart;
    }
  }
  const clip = isActivity(state.current) ? animation.clips[state.current] : undefined;
  return clip
    ? { frame: clipFrame(animation, clip, paused ? 0 : time - state.since), clip: state.current }
    : null;
}
