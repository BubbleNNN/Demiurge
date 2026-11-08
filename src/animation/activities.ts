import type { Activity, PetAction, SpriteAnimation } from '../types';
import * as activityData from '../../shared/activities.json';
import { clipDuration, clipFrame } from './timeline';

export const activities = activityData.activities as {
  id: Activity;
  name: string;
  doing: string;
  prop: string;
}[];
export const isActivity = (action: PetAction | string): action is Activity =>
  activities.some((activity) => activity.id === action);
export const activityDuration = 60000;
type Transition = `enter_${PetAction}` | `exit_${PetAction}`;
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
      state.current !== 'idle' && state.current !== 'drag' && target !== 'drag' && animation.clips[exit]
        ? exit
        : target !== 'drag' && animation.clips[enter]
          ? enter
          : undefined;
    if (name && !paused && !interrupt) {
      state.segment = { clip: name, endAction: name.startsWith('exit_') ? 'idle' : target, since: nextStart };
    } else {
      state.current = target;
      state.since = nextStart;
    }
  }
  const clip = state.current !== 'idle' ? animation.clips[state.current] : undefined;
  if (!clip) return null;
  const age = paused ? 0 : time - state.since;
  // A one-shot gesture that has played through hands back to the ordinary timeline, so idle,
  // blinking and talking resume instead of holding its last pose until the next action.
  if (!clip.loop && age >= clipDuration(animation, clip)) return null;
  return { frame: clipFrame(animation, clip, age), clip: state.current };
}
