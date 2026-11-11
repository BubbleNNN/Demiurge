import { desktopProfile, leadingManner, pickLine, type DesktopProfile } from './characterBehavior';
import * as rules from '../shared/companion-events.json';
import type { Character, CompanionEvent, Emotion, PetAction } from './types';

export const interactionNames: Record<CompanionEvent, string> = {
  greet: '打招呼',
  touch: '轻轻点一下',
  headpat: '摸摸头',
  poke: '戳一戳',
  drag: '拖动后',
  rest: '休息',
  wake: '唤醒',
  comfort: '鼓励',
  thanks: '感谢',
  focus: '专心工作',
  farewell: '告别',
  unknown: '其他消息',
};
export function interactionPlan(
  event: CompanionEvent,
  character: Character,
  actions: PetAction[],
  emotions: Emotion[],
  count = 0,
  resolvedProfile?: DesktopProfile,
) {
  const rule = rules[event];
  if (event === 'headpat' || event === 'poke') {
    const profile = resolvedProfile || desktopProfile(character);
    const manner = leadingManner(profile);
    const reserved = character.behavior.affection < 35 || manner === 'calm' || manner === 'shy';
    const candidates: PetAction[] = reserved
      ? ['idle']
      : manner === 'playful' && event === 'poke'
        ? ['wave', 'nod', 'idle']
        : ['nod', 'idle'];
    const face: Emotion = reserved ? 'neutral' : 'happy';
    const authored = character.companion?.replies[event];
    return {
      action: candidates.find((action) => actions.includes(action)) || 'idle',
      emotion: emotions.includes(face) ? face : ('neutral' as Emotion),
      text: authored?.length
        ? authored[count % authored.length]
        : pickLine(
            profile,
            event,
            () =>
              (count % Math.max(1, profile.lines[event]?.length || 1)) /
              Math.max(1, profile.lines[event]?.length || 1),
          ) || rule.lines[count % rule.lines.length],
    };
  }
  const energeticTouch =
    event === 'touch' && character.behavior.energy >= 65 && character.behavior.affection >= 50;
  const baseActions = character.behavior.energy < 35 ? rule.quietActions : rule.actions;
  const candidates = energeticTouch ? ['wave', ...baseActions] : baseActions;
  const face = character.behavior.affection < 35 ? rule.reservedEmotion : rule.emotion;
  const authored = character.companion?.replies[event];
  const lines = authored?.length ? authored : rule.lines;
  return {
    action: (candidates.find((action) => actions.includes(action as PetAction)) || 'idle') as PetAction,
    emotion: emotions.includes(face as Emotion) ? (face as Emotion) : ('neutral' as Emotion),
    text: lines[count % lines.length],
  };
}
export interface BehaviorState {
  resting: boolean;
  until: number;
  priority: number;
  cooldowns: Record<string, number>;
}
export const freshBehavior = (): BehaviorState => ({ resting: false, until: 0, priority: 0, cooldowns: {} });
export function admitBehavior(
  state: BehaviorState,
  input: {
    event: string;
    now: number;
    duration: number;
    priority: number;
    cooldown: number;
    rest?: boolean;
    wake?: boolean;
  },
): BehaviorState | null {
  if (state.resting && !input.wake && !input.rest) return null;
  if ((state.cooldowns[input.event] || 0) > input.now) return null;
  if (state.until > input.now && state.priority > input.priority) return null;
  return {
    resting: input.wake ? false : input.rest || state.resting,
    until: input.now + input.duration,
    priority: input.priority,
    cooldowns: { ...state.cooldowns, [input.event]: input.now + input.cooldown },
  };
}
export function proactiveInterval(character: Character) {
  // A quieter character checks in less often. No model request or random pose.
  return Math.round(360000 - character.behavior.energy * 2200 - character.behavior.affection * 500);
}
