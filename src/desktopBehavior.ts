// Where the desktop character can stand and what she does next. Pure functions over a snapshot of
// the desktop (screen coordinates, y down); the hook in features/desktop moves the window.
//
// The desktop is a small world she can stand anywhere in: the bottom of the work area is the
// floor, and the top edge of every visible window and desktop icon is a ledge. A ledge partly
// covered by a window in front only exists where it is uncovered. Where the user puts her down
// off any ledge, she stays (there is no gravity); on a ledge she walks, climbs and peeks.
import type { DesktopRect, DesktopScene } from './types';

export interface Temperament {
  energy: number;
  affection: number;
  curiosity: number;
}
export interface Ledge {
  id: string;
  kind: 'floor' | 'window' | 'icon';
  /** The window or icon this ledge belongs to; the floor has none. */
  owner?: string;
  x: number;
  y: number;
  width: number;
}
export interface Point {
  x: number;
  y: number;
}
/** The character's own size on screen, and where her feet sit inside the pet window. */
export interface Body {
  foot: Point;
  width: number;
  height: number;
}
export type Plan =
  | { kind: 'stay'; seconds: number }
  | { kind: 'stroll'; to: Point; ledge: Ledge }
  | { kind: 'climb'; to: Point; ledge: Ledge; takeoff: Point }
  | { kind: 'peek'; to: Point; ledge: Ledge; cover: DesktopRect; takeoff?: Point }
  | { kind: 'watch'; to: Point; ledge?: Ledge; takeoff?: Point }
  | { kind: 'nap'; to: Point; ledge?: Ledge; takeoff?: Point };

const MIN_LEDGE = 70;

// Visible pieces of [x0, x1] at height y after removing what front windows cover.
function uncovered(x0: number, x1: number, y: number, front: DesktopRect[]) {
  let pieces: [number, number][] = [[x0, x1]];
  for (const f of front) {
    if (!(y >= f.y && y <= f.y + f.height)) continue;
    const next: [number, number][] = [];
    for (const [a, b] of pieces) {
      if (f.x + f.width <= a || f.x >= b) next.push([a, b]);
      else {
        if (f.x > a) next.push([a, f.x]);
        if (f.x + f.width < b) next.push([f.x + f.width, b]);
      }
    }
    pieces = next;
  }
  return pieces.filter(([a, b]) => b - a >= MIN_LEDGE);
}

/** Every place she could stand, with room above it for her whole body inside the work area. */
export function ledges(scene: DesktopScene, body: Body): Ledge[] {
  const { area } = scene;
  const margins = scene.margins || { top: 0, bottom: 0 };
  // Window space above her feet that has to stay on screen: the band above her may hang past
  // the top of the work area.
  const headroom = body.foot.y - margins.top;
  // The floor is as low as her feet can get: the window may hang past the bottom of the work
  // area by its lower band.
  const floorY = area.y + area.height - Math.max(0, scene.bounds.height - margins.bottom - body.foot.y);
  const result: Ledge[] = [{ id: 'floor', kind: 'floor', x: area.x, y: floorY, width: area.width }];
  const fits = (y: number) => y - headroom >= area.y && y < area.y + area.height - 8;
  scene.surfaces.forEach((w, index) => {
    const x0 = Math.max(area.x, w.x),
      x1 = Math.min(area.x + area.width, w.x + w.width);
    if (!fits(w.y) || x1 - x0 < MIN_LEDGE) return;
    uncovered(x0, x1, w.y, scene.surfaces.slice(0, index)).forEach(([a, b], piece) =>
      result.push({ id: `window:${w.id}:${piece}`, kind: 'window', owner: w.id, x: a, y: w.y, width: b - a }),
    );
  });
  for (const icon of scene.icons) {
    if (!fits(icon.y)) continue;
    // An icon is only a ledge when no window lies over it.
    if (
      scene.surfaces.some(
        (w) =>
          w.x < icon.x + icon.width &&
          w.x + w.width > icon.x &&
          w.y < icon.y + icon.height &&
          w.y + w.height > icon.y,
      )
    )
      continue;
    result.push({
      id: `icon:${icon.id}`,
      kind: 'icon',
      owner: icon.id,
      x: icon.x,
      y: icon.y,
      width: icon.width,
    });
  }
  return result;
}

/** The ledge directly under a point: the nearest one at or below it. */
export function supportBelow(all: Ledge[], foot: Point, tolerance = 6): Ledge | null {
  let best: Ledge | null = null;
  for (const l of all)
    if (foot.x >= l.x && foot.x <= l.x + l.width && l.y >= foot.y - tolerance && (!best || l.y < best.y))
      best = l;
  return best;
}

/** Whether the feet rest on that ledge now. */
export const standingOn = (ledge: Ledge | null, foot: Point, tolerance = 6) =>
  Boolean(
    ledge && Math.abs(ledge.y - foot.y) <= tolerance && foot.x >= ledge.x && foot.x <= ledge.x + ledge.width,
  );

// Feet x kept far enough from a ledge's ends that the whole body stays on it.
function spotOn(ledge: Ledge, body: Body, fraction: number) {
  const margin = Math.min(ledge.width / 2, body.width * 0.35);
  return Math.round(ledge.x + margin + (ledge.width - 2 * margin) * fraction);
}

function pick<T>(items: [T, number][], random: () => number): T | null {
  const total = items.reduce((s, [, w]) => s + Math.max(0, w), 0);
  if (total <= 0) return null;
  let r = random() * total;
  for (const [item, w] of items) {
    r -= Math.max(0, w);
    if (r <= 0) return item;
  }
  return items.at(-1)?.[0] ?? null;
}

// To reach another ledge she walks along her own to the point nearest the target, then jumps.
function takeoffFor(current: Ledge, target: Point, foot: Point, body: Body) {
  const margin = Math.min(current.width / 2, body.width * 0.35);
  const x = Math.max(current.x + margin, Math.min(current.x + current.width - margin, target.x));
  return Math.abs(x - foot.x) > 4 ? { x: Math.round(x), y: current.y } : undefined;
}

export interface PlanInput {
  scene: DesktopScene;
  ledges: Ledge[];
  body: Body;
  /** Feet in screen coordinates. */
  feet: Point;
  current: Ledge | null;
  temperament: Temperament;
  hour: number;
  /** Seconds since the user last touched keyboard or mouse. */
  userIdle: number;
  /** The front window changed since she last looked. */
  focusChanged: boolean;
  tired: boolean;
  random?: () => number;
}

/** What to do next while she has nothing else to do; weighted by temperament and the moment. */
export function nextPlan(input: PlanInput): Plan {
  const { body, feet, temperament, random = Math.random } = input;
  const current = input.current;
  const calm = (100 - temperament.energy) / 100,
    lively = temperament.energy / 100,
    curious = temperament.curiosity / 100,
    warm = temperament.affection / 100;
  const night = input.hour >= 23 || input.hour < 6;
  const stay: Plan = { kind: 'stay', seconds: Math.round(25 + calm * 70 + random() * 30) };
  // Put down off any ledge (in the middle of the screen, say): she stays where the user wants
  // her. She naps there when tired and turns to watch when the user switches windows.
  if (!current) {
    if (input.tired) return { kind: 'nap', to: feet };
    if (input.focusChanged && random() < 0.3 + warm * 0.5) return { kind: 'watch', to: feet };
    return stay;
  }
  const floor = input.ledges.find((l) => l.kind === 'floor')!;
  const options: [() => Plan | null, number][] = [];
  options.push([() => stay, 1.4 + calm * 2.2 + (night ? 2 : 0)]);
  // Strolling along whatever she stands on.
  options.push([
    () => {
      if (current.width < body.width * 1.4) return null;
      const x = spotOn(current, body, random());
      return Math.abs(x - feet.x) < 40 ? null : { kind: 'stroll', to: { x, y: current.y }, ledge: current };
    },
    0.8 + lively * 2,
  ]);
  // Climbing onto a window's top edge or a desktop icon: the curious explore.
  const higher = input.ledges.filter(
    (l) => l !== current && l.kind !== 'floor' && l.width >= body.width * 0.5,
  );
  options.push([
    () => {
      const ledge = higher[Math.floor(random() * higher.length)];
      if (!ledge) return null;
      const to = { x: spotOn(ledge, body, 0.2 + random() * 0.6), y: ledge.y };
      return { kind: 'climb', to, ledge, takeoff: takeoffFor(current, to, feet, body) || feet };
    },
    higher.length ? 0.4 + curious * 2.2 : 0,
  ]);
  // Now and then back down to the floor after a while up high; she is not drawn there.
  options.push([
    () => {
      const to = {
        x: Math.round(
          Math.max(
            floor.x + body.width,
            Math.min(floor.x + floor.width - body.width, feet.x + (random() - 0.5) * 300),
          ),
        ),
        y: floor.y,
      };
      return { kind: 'climb', to, ledge: floor, takeoff: feet };
    },
    current.kind === 'floor' ? 0 : 0.4 + calm * 0.5,
  ]);
  // Peeking out from behind the side of a window: playful, curious and fond of the user. Only
  // from the floor, where window sides stand.
  options.push([
    () => peekPlan(input, current),
    (curious * 1.2 + warm) * (input.scene.surfaces.length && current.kind === 'floor' ? 1 : 0),
  ]);
  // When the user switches to another window she turns to see what they are doing: on the floor
  // she walks over below it, anywhere else she watches from where she is.
  options.push([
    () => {
      const front = input.scene.surfaces[0];
      if (!front) return null;
      if (current.kind !== 'floor') return { kind: 'watch', to: feet, ledge: current };
      const x = Math.round(
        Math.max(
          current.x + body.width,
          Math.min(current.x + current.width - body.width, front.x + front.width / 2),
        ),
      );
      if (Math.abs(x - feet.x) < 60) return null;
      return { kind: 'watch', to: { x, y: current.y }, ledge: current };
    },
    input.focusChanged ? 1 + warm * 3 : 0,
  ]);
  // Tired or late: she curls up where she is.
  options.push([() => ({ kind: 'nap', to: feet, ledge: current }), input.tired ? 4 : 0]);
  for (let attempt = 0; attempt < 4; attempt++) {
    const builder = pick(options, random);
    const plan = builder?.();
    if (plan) return plan;
  }
  return stay;
}

/** A spot beside a window edge where part of her body is hidden behind the window. */
export function peekPlan(input: PlanInput, current: Ledge): Plan | null {
  const { body, feet, random = Math.random } = input;
  const floor = input.ledges.find((l) => l.kind === 'floor')!;
  const stand = current.kind === 'floor' ? current : floor;
  const candidates: { to: Point; cover: DesktopRect }[] = [];
  for (const w of input.scene.surfaces) {
    // The window must cover the middle of her body where she would stand.
    const top = stand.y - body.height * 0.75,
      middle = stand.y - body.height * 0.35;
    if (!(w.y < top && w.y + w.height > middle)) continue;
    for (const side of ['left', 'right'] as const) {
      const edge = side === 'left' ? w.x : w.x + w.width;
      const x = Math.round(side === 'left' ? edge - body.width * 0.12 : edge + body.width * 0.12);
      if (x - body.width / 2 < stand.x || x + body.width / 2 > stand.x + stand.width) continue;
      candidates.push({ to: { x, y: stand.y }, cover: w });
    }
  }
  if (!candidates.length) return null;
  const choice = candidates[Math.floor(random() * candidates.length)];
  return { kind: 'peek', ...choice, ledge: stand, takeoff: stand === current ? undefined : feet };
}

/** A parabolic jump between two points, highest a little above the higher end. */
export function hopPath(from: Point, to: Point) {
  const rise = Math.max(40, Math.min(160, Math.abs(to.x - from.x) * 0.25)) + Math.max(0, from.y - to.y);
  const duration = Math.max(0.45, Math.min(1.3, 0.35 + Math.hypot(to.x - from.x, to.y - from.y) / 900));
  return {
    duration,
    at(t: number): Point {
      const s = Math.max(0, Math.min(1, t / duration));
      const peak = Math.min(from.y, to.y) - (rise - Math.max(0, from.y - to.y));
      // Quadratic through from (s=0), peak (s=.5 approx) and to (s=1).
      const y =
        (1 - s) * (1 - s) * from.y + 2 * (1 - s) * s * (2 * peak - (from.y + to.y) / 2) + s * s * to.y;
      return { x: from.x + (to.x - from.x) * s, y };
    },
  };
}

/** Walking speed in screen points per second: livelier characters move faster. */
export const walkSpeed = (t: Temperament) => 70 + t.energy * 1.1;

/** Seconds between independent decisions while nothing else is going on. */
export const restBetween = (t: Temperament, random = Math.random) =>
  Math.round(20 + (100 - t.energy) * 0.6 + random() * 25);
