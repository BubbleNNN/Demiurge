// How often the character may reach out to the user. She has a life of her own and asks for
// company now and then, never as a stream of pop-ups:
// - an invitation (something that needs an answer) waits for a pause in the user's typing and
//   clicking, keeps a long gap that warmer characters shorten, and at most two come in an hour;
// - a passing remark in her speech bubble keeps a gap of several minutes, at most five an hour;
// - a greeting is for when the user comes back after being away, not on a timer.
import type { Temperament } from './desktopBehavior';

export interface Attention {
  invites: number[];
  remarks: number[];
  greeted: number;
  /** When the user was last seen away from the computer (idle for minutes). */
  awaySince: number;
}
export const freshAttention = (): Attention => ({ invites: [], remarks: [], greeted: 0, awaySince: 0 });
const HOUR = 3600000,
  MINUTE = 60000;
const recent = (list: number[], now: number) => list.filter((t) => now - t < HOUR);

export function restoreAttention(value: unknown): Attention {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<Attention>;
  const times = (list: unknown) =>
    Array.isArray(list) ? list.filter((t): t is number => Number.isFinite(t)).slice(-12) : [];
  return {
    invites: times(v.invites),
    remarks: times(v.remarks),
    greeted: Number.isFinite(v.greeted) ? Number(v.greeted) : 0,
    awaySince: Number.isFinite(v.awaySince) ? Number(v.awaySince) : 0,
  };
}

/** Minimum minutes between invitations: about 18 for a very affectionate character, 40 for a reserved one. */
export const inviteGap = (t: Temperament) => Math.round(40 - t.affection * 0.22);

export function mayInvite(a: Attention, now: number, userIdleSeconds: number, t: Temperament) {
  const last = a.invites.at(-1) || 0;
  if (now - last < inviteGap(t) * MINUTE || recent(a.invites, now).length >= 2) return false;
  // At a pause: not while the user is typing or clicking, and not when they are away.
  return userIdleSeconds >= 20 && userIdleSeconds < 600;
}
export function mayRemark(a: Attention, now: number, userIdleSeconds: number) {
  const last = a.remarks.at(-1) || 0;
  if (now - last < 6 * MINUTE || recent(a.remarks, now).length >= 5) return false;
  // Nobody is there to read it after ten quiet minutes.
  return userIdleSeconds < 600;
}
/**
 * Called on every check: notes when the user goes away, and returns true once when they come
 * back after at least five minutes, so she can greet them. Only an absence that began while she
 * was open counts: an idle computer before Mori started is not someone coming back to her.
 */
export function noticeReturn(a: Attention, now: number, userIdleSeconds: number, openedAt = 0) {
  if (userIdleSeconds >= 300) {
    const since = now - userIdleSeconds * 1000;
    if (!a.awaySince && since >= openedAt) a.awaySince = since;
    return false;
  }
  if (a.awaySince && userIdleSeconds < 5) {
    a.awaySince = 0;
    if (now - a.greeted >= 30 * MINUTE) {
      a.greeted = now;
      return true;
    }
  }
  return false;
}
export function recordInvite(a: Attention, now: number) {
  a.invites = [...recent(a.invites, now), now].slice(-12);
}
export function recordRemark(a: Attention, now: number) {
  a.remarks = [...recent(a.remarks, now), now].slice(-12);
}
