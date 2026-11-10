// The desktop character's body: she stays wherever the user puts her down, anywhere on the
// screen. Let go just above a window top, an icon or the bottom of the screen, she steps onto it;
// on such a ledge she walks and climbs according to her temperament and rides a window when it
// moves. When what she stands on goes away she simply stays where she is: there is no gravity.
// While the user works in an app she goes to stand beside its window, out of its way, watches
// and glances at it, and stays quiet (see userContext.ts); when they stop she returns to her own
// life. Adapted in part from Anime Codex (MIT): visible places, bounded travel and revalidation
// before every stay.
import { useEffect, useRef, useState } from 'react';
import { bridge } from '../../bridge';
import { choosePlace, placeVisible, type Place } from '../../desktopLife';
import {
  hopPath,
  ledges as findLedges,
  nextPlan,
  restBetween,
  standingOn,
  supportBelow,
  walkSpeed,
  type Body,
  type Ledge,
  type Plan,
  type Point,
  type Temperament,
} from '../../desktopBehavior';
import type { DesktopRect, DesktopScene, PetAction } from '../../types';
import type { Habit, Travel } from '../../characterBehavior';
import { moodConduct, moodHabits, within, type MoodName } from '../../mood';
import { readyToMove } from '../../animation/activities';
import {
  companySpot,
  coverage,
  perchSpot,
  userContext,
  type Spot,
  type UserContext,
} from '../../userContext';

interface Options {
  petMode: boolean;
  enabled: boolean;
  blocked: boolean;
  characterId: string;
  temperament: Temperament;
  /** Tired or sleeping in her routine: she looks for a quiet corner to nap in. */
  tired: boolean;
  /** An activity is playing in place (reading, gaming…): she does not wander off mid-activity. */
  occupied: boolean;
  /** Something the user just asked for is playing (an activity from the toolbar, a touch…):
   *  keeping company waits until it is over. */
  held?: () => boolean;
  /** `sudden`: start it at once, without the turn that leads into it (she is out of sight). */
  onAction: (a: PetAction, sudden?: boolean) => void;
  /** A line caused by the user (a drop, a failed search): always shown. */
  onLine: (line: string) => void;
  /** A line she says on her own: subject to the attention budget. */
  onRemark: (line: string) => void;
  onResult: (found: boolean) => void;
  /** She touched down after a jump or a fall; height in screen points. */
  onLand: (height: number) => void;
  /** She arrived on a window top to carry on her activity there. */
  onPerch: () => void;
  /** What the user is doing changed (front app, typing, away…); null without that information. */
  onContext: (context: UserContext | null) => void;
  /** She arrived at the user's window to keep them company. With `own`, she may do something of
   *  her own there; returns true when she did (an activity of her routine). */
  onCompany: (own: boolean) => boolean;
  /** Whether her pack has a motion (sitting and lying down need newer packs). */
  supports: (action: PetAction) => boolean;
  /** She fell off a window: yanked away (`flung`) or closed under her (`gone`). Returns true
   *  when she is cross enough to sulk on the floor until comforted. */
  onFall: (cause: 'flung' | 'gone') => boolean;
  /** How she gets about and her small habits (characterBehavior.ts). */
  travel?: Travel;
  habits?: Habit[];
  /** Left alone too long: she goes over to the user's window to ask for attention. */
  lonely?: boolean;
  /** How she feels (mood.ts): it sets her pace, her habits, how long she sits or lies down,
   *  and whether she keeps the user company. */
  mood?: MoodName;
  /** What she shows now, to notice when she has been standing about with nothing to do. */
  current?: () => PetAction;
  /** She would like the user's attention (arrived lonely, or now and then while keeping company);
   *  the app decides whether she asks, and how. */
  onSeek?: () => void;
  /** Vanishing and reappearing, for packs that cannot walk ('out' fades her, 'in' brings her back). */
  onTeleport?: (phase: 'out' | 'in') => void;
  /** A habit with no motion of its own (humming), shown by the app. */
  onHabit?: (habit: Habit) => void;
  /** She has arrived after being summoned or after the user moved to another Space. */
  onEnter?: () => void;
}
type Phase = 'idle' | 'finding' | 'inviting' | 'moving' | 'staying' | 'company' | 'sulking';
const sameContext = (a: UserContext | null, b: UserContext | null) =>
  a === b ||
  Boolean(
    a &&
      b &&
      a.mode === b.mode &&
      a.kind === b.kind &&
      a.app === b.app &&
      a.company === b.company &&
      a.quiet === b.quiet &&
      a.companion === b.companion &&
      a.focus?.id === b.focus?.id,
  );
// Let go this close above a ledge (in points), she steps down onto it.
const SNAP = 36;
// After the user puts her somewhere she stays there a while before setting off on her own; to
// keep the user company she comes over sooner.
const PLACED_STAY = 3 * 60000,
  PLACED_COMPANY = 45000;
// Running to the user's window, or after the window she stands on: this much faster than walking.
const RUN = 2.3;
// Dragged faster than this (points per second), or this far between two looks, a window slips
// out from under her.
const FLING_SPEED = 1100,
  FLING_JUMP = 280;
// How long she sulks on the floor before getting over it by herself.
const SULK = 4 * 60000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// Setting off, she turns first and then speeds up over this long (milliseconds).
const SET_OFF = 350;
// Whether the walk she was asked for is on screen yet, from the playing canvas (see readyToMove).
function turned(action: PetAction, waited: number) {
  const canvas = document.querySelector<HTMLCanvasElement>('.pet-draggable canvas');
  return !canvas || canvas.dataset.motion === 'paused' || readyToMove(canvas.dataset.clip, action, waited);
}

// Position of an element inside the window from layout alone: the swing and the landing squash
// are transforms and must not move where her feet are taken to be.
function layoutBox(el: HTMLElement) {
  let x = 0,
    y = 0;
  for (let node: HTMLElement | null = el; node; node = node.offsetParent as HTMLElement | null) {
    x += node.offsetLeft;
    y += node.offsetTop;
  }
  return { x, y, width: el.offsetWidth, height: el.offsetHeight };
}
// Where her feet are inside the pet window, and her drawn size, read from the playing canvas.
function measureBody(): Body | null {
  const holder = document.querySelector<HTMLElement>('.pet-draggable');
  if (!holder) return null;
  const box = layoutBox(holder);
  let foot = { x: box.x + box.width / 2, y: box.y + box.height - 5 },
    width = box.width * 0.6,
    height = box.height * 0.9;
  const canvas = document.querySelector<HTMLCanvasElement>('.pet-draggable canvas[data-figure-bounds]');
  try {
    const figure = canvas && JSON.parse(canvas.dataset.figureBounds || 'null');
    if (canvas && figure && canvas.width && canvas.offsetWidth) {
      const r = layoutBox(canvas),
        sx = r.width / canvas.width,
        sy = r.height / canvas.height;
      foot = { x: r.x + (figure.x + figure.width / 2) * sx, y: r.y + (figure.y + figure.height) * sy };
      width = figure.width * sx;
      height = figure.height * sy;
    }
  } catch {
    /* The DOM estimate above stands. */
  }
  return { foot, width, height };
}

export function useDesktopLife(options: Options) {
  const ref = useRef(options);
  ref.current = options;
  const [phase, setPhase] = useState<Phase>('idle');
  const [status, setStatus] = useState('会在桌面上走动、爬上窗口、偶尔偷看你。');
  const [mask, setMask] = useState<DesktopRect | null>(null);
  const [airborne, setAirborne] = useState(false);
  // A short look toward the user's window while keeping them company.
  const [glance, setGlance] = useState<{ side: 'left' | 'right'; key: number } | null>(null);
  const [context, setContext] = useState<UserContext | null>(null);
  const generation = useRef(0),
    phaseRef = useRef<Phase>('idle'),
    place = useRef<Place | null>(null),
    bounds = useRef<DesktopRect | null>(null),
    until = useRef(0),
    lifted = useRef(false),
    support = useRef<{ ledge: Ledge; window?: DesktopRect & { id: string } } | null>(null),
    lastFront = useRef(''),
    focusChanged = useRef(false),
    icons = useRef<{ at: number; list: DesktopScene['icons']; denied: boolean }>({
      at: 0,
      list: [],
      denied: false,
    }),
    nextDecision = useRef(Date.now() + 15000),
    nextHide = useRef(Date.now() + 30000),
    placedAt = useRef(0),
    contextRef = useRef<UserContext | null>(null),
    company = useRef<{ focus: DesktopRect & { id: string }; spot: Spot } | null>(null),
    // What she is doing at the user's window: a pose, or something of her own.
    pose = useRef<PetAction | 'own'>('listen'),
    sulkUntil = useRef(0),
    // Running in from off screen: steps may take her past a side of it.
    free = useRef(false);
  phaseRef.current = phase;
  const go = (value: Phase) => {
    phaseRef.current = value;
    setPhase(value);
  };
  const alive = (token: number) => token === generation.current;

  async function scene(withIcons = false): Promise<DesktopScene> {
    const fresh = withIcons && !icons.current.denied && Date.now() - icons.current.at > 120000;
    const value = await bridge.desktopScene(fresh);
    if (fresh) {
      // No icons with a reason means Finder access is off or icons are hidden: ask again much later.
      icons.current = {
        at: Date.now(),
        list: value.icons,
        denied: value.icons.length === 0 && Boolean(value.reason),
      };
      if (icons.current.denied) icons.current.at = Date.now() + 30 * 60000;
    }
    bounds.current = value.bounds;
    // The app the user is in, when known; otherwise the front window.
    const front = value.activity?.app?.bundle || value.activity?.app?.name || value.surfaces[0]?.id || '';
    if (front && lastFront.current && front !== lastFront.current) focusChanged.current = true;
    lastFront.current = front;
    return { ...value, icons: value.icons.length ? value.icons : icons.current.list };
  }
  const feetOf = (body: Body, at: DesktopRect) => ({ x: at.x + body.foot.x, y: at.y + body.foot.y });
  async function place2(target: Point, body: Body) {
    const moved = await bridge.stepPet({
      x: Math.round(target.x - body.foot.x),
      y: Math.round(target.y - body.foot.y),
      ...(free.current ? { free: true } : {}),
    });
    bounds.current = moved;
    return moved;
  }

  // Horizontal walk along the ledge she stands on. Her own wandering (yieldable) gives way the
  // moment an activity starts; walking to a spot chosen for an activity does not.
  const canWalk = () => ref.current.supports('walk_left') || ref.current.supports('walk_right');
  const conduct = () => moodConduct(ref.current.mood || 'calm');
  // `sudden`: she starts already walking, without the turn (coming in from off screen).
  // `jumping`: a jump follows, so she does not stop and turn back to the front at the end.
  async function walkTo(
    to: Point,
    token: number,
    { yieldable = false, pace = 1, sudden = false, jumping = false } = {},
  ) {
    const body = measureBody();
    if (!body || !bounds.current) return false;
    // A pack without walking never slides along: it hops there, or vanishes and reappears.
    if (!canWalk() && Math.abs(to.x - feetOf(body, bounds.current).x) > 2) {
      if (!ref.current.supports('bounce')) return teleportTo(to, token);
      for (let n = 0; n < 40; n++) {
        if (!alive(token) || lifted.current || (yieldable && ref.current.occupied)) return false;
        const at = feetOf(body, bounds.current!);
        const dx = to.x - at.x;
        if (Math.abs(dx) <= 2) break;
        if (
          !(await hopTo({ x: at.x + Math.sign(dx) * Math.min(90, Math.abs(dx)), y: to.y }, token, yieldable))
        )
          return false;
      }
      return true;
    }
    const speed = walkSpeed(ref.current.temperament) * pace * conduct().pace;
    const started = Date.now();
    let last = performance.now(),
      facing: PetAction | null = null,
      asked = 0,
      // When she set off; 0 while she is still turning.
      off = 0;
    for (;;) {
      if (!alive(token) || lifted.current || (yieldable && ref.current.occupied)) return false;
      const feet = feetOf(body, bounds.current);
      const dx = to.x - feet.x;
      if (Math.abs(dx) <= 2) break;
      if (Date.now() - started > 40000) return false;
      const way: PetAction = dx < 0 ? 'walk_left' : 'walk_right',
        now = performance.now();
      if (way !== facing) {
        ref.current.onAction(way, sudden && !facing);
        off = sudden && !facing ? now : 0;
        facing = way;
        asked = now;
      } else ref.current.onAction(way);
      if (!off) {
        last = now;
        if (!turned(way, now - asked)) {
          await sleep(30);
          continue;
        }
        off = now;
      }
      const ramp = sudden ? 1 : Math.min(1, 0.3 + (0.7 * (now - off)) / SET_OFF),
        step = Math.min(Math.abs(dx), speed * ramp * Math.min(0.1, (now - last) / 1000));
      last = now;
      const moved = await place2({ x: feet.x + Math.sign(dx) * Math.max(1, step), y: to.y }, body);
      // The window could not go further (screen edge): stop here.
      if (Math.abs(feetOf(body, moved).x - feet.x) < 0.5 && step >= 1) break;
      await sleep(30);
    }
    if (!jumping && !(yieldable && ref.current.occupied)) ref.current.onAction('idle');
    return true;
  }
  // A jump along an arc to another ledge.
  async function hopTo(to: Point, token: number, yieldable = false) {
    const body = measureBody();
    if (!body || !bounds.current || (yieldable && ref.current.occupied)) return false;
    const from = feetOf(body, bounds.current),
      path = hopPath(from, to),
      start = performance.now();
    // She is in the air at once, so the jump shows at once (no turn back from a walk first).
    ref.current.onAction(to.y < from.y ? 'bounce' : 'drag', true);
    setAirborne(true);
    try {
      for (;;) {
        if (!alive(token) || lifted.current) return false;
        const t = (performance.now() - start) / 1000;
        await place2(path.at(t), body);
        if (t >= path.duration) break;
        await sleep(16);
      }
    } finally {
      setAirborne(false);
    }
    ref.current.onAction('idle');
    ref.current.onLand(Math.max(0, to.y - Math.min(from.y, to.y)));
    return true;
  }
  // What is she standing on? Only a ledge right under her feet counts; she steps onto it when
  // she is a little above it. Anywhere else she stays exactly where she is.
  async function settle(token: number, landing: boolean) {
    const body = measureBody();
    if (!body) return;
    const value = await scene();
    if (!alive(token)) return;
    const all = findLedges(value, body),
      feet = feetOf(body, value.bounds),
      below = supportBelow(all, feet);
    const height = below ? below.y - feet.y : Infinity;
    if (!below || height > SNAP) {
      support.current = null;
      return;
    }
    if (height > 1) await place2({ x: feet.x, y: below.y }, body);
    if (!alive(token)) return;
    support.current = { ledge: below, window: value.surfaces.find((w) => w.id === below.owner) };
    if (landing) ref.current.onLand(Math.max(0, height));
  }

  // Gone in a blink, back somewhere else: for packs that can neither walk nor hop.
  async function teleportTo(to: Point, token: number) {
    const body = measureBody();
    if (!body || !bounds.current) return false;
    ref.current.onTeleport?.('out');
    await sleep(280);
    if (!alive(token) || lifted.current) {
      ref.current.onTeleport?.('in');
      return false;
    }
    bounds.current = await bridge.stepPet({
      x: Math.round(to.x - body.foot.x),
      y: Math.round(to.y - body.foot.y),
      jump: true,
      ...(free.current ? { free: true } : {}),
    });
    ref.current.onTeleport?.('in');
    await sleep(280);
    return alive(token);
  }
  // Through the air, in her own way (characterBehavior.ts travel 'fly' with a fly motion).
  // `sudden`: out of sight, she is already flying when she comes into view.
  async function flyTo(to: Point, token: number, sudden = false) {
    const body = measureBody();
    if (!body || !bounds.current) return false;
    const from = feetOf(body, bounds.current);
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const duration = Math.max(0.7, Math.min(4, distance / 320));
    const lift = Math.min(120, 30 + distance * 0.12);
    ref.current.onAction('fly', sudden);
    // Her takeoff plays where she stands; she leaves the ground once she is flying.
    const asked = performance.now();
    while (!sudden && !turned('fly', performance.now() - asked)) {
      if (!alive(token) || lifted.current) return false;
      await sleep(30);
    }
    const start = performance.now();
    setAirborne(true);
    try {
      for (;;) {
        if (!alive(token) || lifted.current) return false;
        const t = Math.min(1, (performance.now() - start) / 1000 / duration);
        const ease = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        await place2(
          {
            x: from.x + (to.x - from.x) * ease,
            y: from.y + (to.y - from.y) * ease - Math.sin(Math.PI * t) * lift,
          },
          body,
        );
        if (t >= 1) break;
        await sleep(16);
      }
    } finally {
      setAirborne(false);
    }
    ref.current.onAction('idle');
    ref.current.onLand(0);
    return true;
  }
  // Walk (or run, with pace), then jump if the target is higher or lower, to any point on screen.
  // A character who flies flies there instead.
  async function travelTo(to: Point, token: number, pace = 1) {
    const body = measureBody();
    if (!body || !bounds.current) return false;
    // Lonely or cross, she walks, whatever her usual way of getting about.
    const walks = ref.current.travel === 'walk' || conduct().walksOnly;
    if (ref.current.travel === 'fly' && ref.current.supports('fly') && !walks) return flyTo(to, token);
    if (walks) pace = Math.min(pace, 1.3);
    if (!canWalk() && !ref.current.supports('bounce')) return teleportTo(to, token);
    const feet = feetOf(body, bounds.current);
    if (Math.abs(to.y - feet.y) > 6) {
      const lead = { x: to.x + Math.sign(feet.x - to.x) * Math.min(160, Math.abs(feet.x - to.x)), y: feet.y };
      if (!(await walkTo(lead, token, { pace, jumping: true }))) return false;
      if (!(await hopTo(to, token))) return false;
    } else if (!(await walkTo(to, token, { pace }))) return false;
    return alive(token);
  }
  // Gravity, for when the window she stood on is gone from under her: down to the ground.
  async function fallTo(ground: number, token: number) {
    const body = measureBody();
    if (!body || !bounds.current) return false;
    const from = feetOf(body, bounds.current);
    if (ground - from.y <= 3) return true;
    let y = from.y,
      v = 0,
      last = performance.now();
    ref.current.onAction('drag', true);
    setAirborne(true);
    try {
      while (y < ground) {
        if (!alive(token) || lifted.current) return false;
        const now = performance.now(),
          dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        v = Math.min(2200, v + 2600 * dt);
        y = Math.min(ground, y + v * dt);
        await place2({ x: from.x, y }, body);
        await sleep(16);
      }
    } finally {
      setAirborne(false);
    }
    ref.current.onAction('idle');
    ref.current.onLand(ground - from.y);
    return true;
  }
  const floorOf = (value: DesktopScene, body: Body) =>
    findLedges(value, body).find((l) => l.kind === 'floor')?.y ?? feetOf(body, value.bounds).y;
  // On the user's window she sits or lies on its top edge (when her pack can), or stands and
  // listens beside it; now and then she does something of her own instead.
  // Not standing there staring at the user: she sits or lies down (on the window or beside it),
  // or does her own thing, and her habits fill the rest.
  function settlePose(own: boolean) {
    const o = ref.current;
    if (own && o.onCompany(true)) {
      pose.current = 'own';
      return;
    }
    const choices = (['sit', 'lie'] as const).filter((a) => o.supports(a));
    if (!choices.length && o.onCompany(true)) {
      pose.current = 'own';
      return;
    }
    const next: PetAction = choices.length
      ? choices.length > 1 && pose.current === choices[0]
        ? choices[1]
        : choices[Math.floor(Math.random() * choices.length)]
      : 'idle';
    pose.current = next;
    o.onAction(next);
  }
  function arrive(focus: DesktopRect & { id: string }, spot: Spot) {
    company.current = { focus, spot };
    support.current = spot.perch
      ? {
          ledge: {
            id: `window:${focus.id}`,
            kind: 'window',
            owner: focus.id,
            x: focus.x,
            y: focus.y,
            width: focus.width,
          },
          window: focus,
        }
      : null;
    go('company');
    setStatus(spot.perch ? '在你的窗口上陪着你' : spot.over ? '在你窗口的角落陪着你' : '在你窗口旁边陪着你');
    if (!ref.current.occupied) settlePose(Math.random() < conduct().ownChance);
    else ref.current.onCompany(false);
  }
  // The window under her is gone: yanked away or closed. She falls to the bottom of the screen;
  // flung off, she may sit there sulking until the user comforts her.
  async function tumble(value: DesktopScene, body: Body, cause: 'flung' | 'gone') {
    const token = ++generation.current;
    support.current = null;
    company.current = null;
    place.current = null;
    setMask(null);
    go('moving');
    setStatus(cause === 'flung' ? '从窗口上摔了下来' : '窗口不见了，掉了下来');
    await fallTo(floorOf(value, body), token);
    if (!alive(token)) return;
    if (ref.current.onFall(cause)) {
      sulkUntil.current = Date.now() + SULK;
      go('sulking');
      setStatus('在生气，等你哄哄');
    } else {
      go('idle');
      nextDecision.current = Date.now() + restBetween(ref.current.temperament) * 1000;
    }
  }
  // The window she stands on moves slowly: she rides it up and down, and runs to keep her spot
  // on it as it slides sideways. Faster, or off its end, and she falls.
  // `from`/`seenAt`: the window as the riding check last judged it, so the move it already
  // measured is not measured again over a few milliseconds (which would look like a fling).
  async function chase(
    held: { ledge: Ledge; window?: DesktopRect & { id: string } },
    body: Body,
    from: number,
    seenAt?: DesktopRect & { id: string },
  ) {
    const token = ++generation.current;
    const before = phaseRef.current;
    const id = held.window!.id;
    const offset = feetOf(body, bounds.current!).x - held.window!.x;
    let win = seenAt || held.window!,
      stamp = from,
      still = Date.now(),
      last = performance.now(),
      ran = false,
      // The window's left edge when she was last placed, and the way she turned to run.
      under = win.x,
      facing: PetAction | null = null,
      asked = 0;
    for (;;) {
      if (!alive(token) || lifted.current) return;
      const value = await scene();
      if (!alive(token) || lifted.current) return;
      const now = value.surfaces.find((w) => w.id === id);
      if (!now) return void (await tumble(value, body, 'gone'));
      const at = value.at || Date.now();
      if (at !== stamp) {
        const moved = Math.hypot(now.x - win.x, now.y - win.y);
        if (moved > FLING_JUMP || moved / Math.max(0.05, (at - stamp) / 1000) > FLING_SPEED)
          return void (await tumble(value, body, 'flung'));
        if (moved > 0.5) still = Date.now();
        stamp = at;
        win = now;
      }
      held.window = now;
      held.ledge = { ...held.ledge, x: now.x, y: now.y, width: now.width };
      if (company.current?.focus.id === id) company.current.focus = { ...company.current.focus, ...now };
      const feet = feetOf(body, bounds.current!);
      if (feet.x < now.x - body.width * 0.2 || feet.x > now.x + now.width + body.width * 0.2)
        return void (await tumble(value, body, 'flung'));
      const t = performance.now(),
        dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      const dx = now.x + offset - feet.x;
      let step = Math.sign(dx) * Math.min(Math.abs(dx), walkSpeed(ref.current.temperament) * RUN * dt);
      if (Math.abs(dx) > 3) {
        const way: PetAction = dx < 0 ? 'walk_left' : 'walk_right';
        if (way !== facing) {
          facing = way;
          asked = t;
        }
        ref.current.onAction(way);
        ran = true;
        // Still turning to run: the window carries her along meanwhile.
        if (!turned(way, t - asked)) step = now.x - under;
      }
      under = now.x;
      if (Math.abs(step) >= 0.5 || Math.abs(now.y - feet.y) >= 0.5)
        await place2({ x: feet.x + step, y: now.y }, body);
      if (Math.abs(dx) <= 3 && Date.now() - still > 500) break;
      await sleep(30);
    }
    if (!alive(token)) return;
    go(before);
    // Back on her spot: carry on with what she was doing.
    if (!ran) return;
    if (before === 'company') settlePose(pose.current === 'own');
    else if (before === 'staying') ref.current.onPerch();
    else ref.current.onAction('idle');
  }
  function leaveCompany() {
    company.current = null;
    go('idle');
    setStatus('在桌面上自己待着');
    if (!ref.current.occupied) ref.current.onAction('idle');
    nextDecision.current = Date.now() + restBetween(ref.current.temperament) * 1000;
  }

  function stop(found = false) {
    generation.current++;
    const wasHide = place.current?.kind === 'hide' && phaseRef.current === 'staying';
    place.current = null;
    company.current = null;
    go('idle');
    setMask(null);
    setAirborne(false);
    nextDecision.current = Date.now() + restBetween(ref.current.temperament) * 1000;
    ref.current.onAction('idle');
    if (wasHide) ref.current.onResult(found);
    // Whatever she was on may have changed; land on what is below her now.
    if (ref.current.petMode && !lifted.current) {
      const token = generation.current;
      void sleep(120).then(() => {
        if (alive(token)) void settle(token, false).catch(() => {});
      });
    }
  }
  function start() {
    if (!place.current) return;
    const token = ++generation.current;
    go('moving');
    setStatus('正在过去');
    void travel(place.current, token);
  }
  // Walk and jump to an explored place (a window top to read on, or a hiding spot).
  async function travel(target: Place, token: number) {
    try {
      const body = measureBody();
      if (!body || !bounds.current) return stop();
      const feet = feetOf(body, bounds.current);
      const destination = { x: target.destination.x + body.foot.x, y: target.destination.y + body.foot.y };
      if (Math.abs(destination.y - feet.y) > 6) {
        await walkTo(
          {
            x:
              destination.x +
              Math.sign(feet.x - destination.x) * Math.min(160, Math.abs(feet.x - destination.x)),
            y: feet.y,
          },
          token,
          { jumping: true },
        );
        if (!alive(token)) return;
        if (!(await hopTo(destination, token))) return;
      } else if (!(await walkTo(destination, token))) return;
      if (!alive(token)) return;
      const value = await scene(target.kind === 'hide');
      if (!alive(token)) return;
      const valid = placeVisible(target, value);
      if (!valid || Math.abs(valid.x - target.rect.x) > 2 || Math.abs(valid.y - target.rect.y) > 2) {
        setStatus('刚才的位置变化了，先停下来。');
        return stop();
      }
      until.current = Date.now() + (target.kind === 'hide' ? 45000 : 90000);
      go('staying');
      const moved = value.bounds;
      if (target.kind === 'hide') {
        setMask({ x: valid.x - moved.x, y: valid.y - moved.y, width: valid.width, height: valid.height });
        ref.current.onAction('listen');
        ref.current.onLine('藏好啦，找到我就点一下露出来的地方。');
        setStatus('正在捉迷藏');
      } else {
        support.current = {
          ledge: {
            id: `window:${target.id}`,
            kind: 'window',
            owner: target.id,
            x: valid.x,
            y: valid.y,
            width: valid.width,
          },
          window: { ...valid, id: target.id },
        };
        ref.current.onPerch();
        setStatus('在窗口边缘待着');
      }
    } catch {
      if (alive(token)) stop();
    }
  }
  async function explore(kind: 'read' | 'hide' | 'any' = 'any', automatic = false) {
    const o = ref.current;
    if (!o.petMode || !o.enabled || o.blocked || lifted.current || phaseRef.current !== 'idle') return false;
    if (automatic && kind === 'hide' && Date.now() < nextHide.current) return false;
    if (automatic && Date.now() - placedAt.current < PLACED_STAY) return false;
    const token = ++generation.current;
    go('finding');
    try {
      const value = await scene(kind !== 'read');
      if (!alive(token)) return false;
      const body = measureBody();
      const foot = body?.foot || { x: value.bounds.width / 2, y: value.bounds.height - 40 };
      const target = value.supported ? choosePlace(value, foot, kind) : null;
      if (!target) {
        const line =
          value.reason || '没有找到露出的图标或合适的窗口上沿。可以把一个窗口往下移，或露出桌面后再试。';
        setStatus(line);
        if (!automatic) o.onLine(line);
        go('idle');
        return false;
      }
      place.current = target;
      nextHide.current = Date.now() + 8 * 60000;
      if (automatic && target.kind === 'hide') {
        go('inviting');
        until.current = Date.now() + 45000;
        setStatus('找到一个可以藏起来的地方，要不要来找我？');
      } else start();
      return true;
    } catch (e) {
      if (!alive(token)) return false;
      const line = e instanceof Error ? e.message : '暂时无法读取桌面';
      setStatus(line);
      if (!automatic) o.onLine(line);
      go('idle');
      return false;
    }
  }
  function decline() {
    stop();
    ref.current.onResult(false);
  }

  // Her own decisions between activities.
  async function act(plan: Plan, token: number) {
    if (plan.kind === 'stay') return;
    go('moving');
    try {
      const walkFirst = 'takeoff' in plan && plan.takeoff ? plan.takeoff : null;
      if (plan.kind === 'climb') {
        if (walkFirst && !(await walkTo(walkFirst, token, { yieldable: true, jumping: true }))) return;
        if (!(await hopTo(plan.to, token, true))) return;
        setStatus(
          plan.ledge.kind === 'window'
            ? '爬到窗口上看看'
            : plan.ledge.kind === 'icon'
              ? '站到图标上'
              : '回到地面',
        );
        if (plan.ledge.kind !== 'floor' && Math.random() < 0.35)
          ref.current.onRemark(
            plan.ledge.kind === 'icon' ? '这个图标站起来软软的。' : '从这里看，你的屏幕好热闹。',
          );
      } else {
        if (walkFirst && plan.ledge) {
          if (!(await walkTo(walkFirst, token, { yieldable: true, jumping: true }))) return;
          if (!(await hopTo({ x: walkFirst.x, y: plan.ledge.y }, token, true))) return;
        }
        if (!(await walkTo(plan.to, token, { yieldable: true }))) return;
      }
      if (!alive(token)) return;
      const value = await scene();
      if (!alive(token)) return;
      const body = measureBody();
      if (body) {
        const all = findLedges(value, body);
        const under = supportBelow(all, feetOf(body, value.bounds));
        if (under)
          support.current = { ledge: under, window: value.surfaces.find((w) => w.id === under.owner) };
      }
      if (plan.kind === 'peek') {
        const cover = value.surfaces.find((w) => w.id === (plan.cover as DesktopRect & { id: string }).id);
        if (cover) {
          setMask({
            x: cover.x - value.bounds.x,
            y: cover.y - value.bounds.y,
            width: cover.width,
            height: cover.height,
          });
          go('staying');
          ref.current.onAction('listen');
          setStatus('躲在窗口后面偷看你');
          if (Math.random() < 0.5) ref.current.onRemark('……（从窗口边上偷偷看你）');
          until.current = Date.now() + 18000 + Math.random() * 20000;
          while (Date.now() < until.current) {
            if (!alive(token)) return;
            await sleep(1000);
            const now = await scene();
            const still = now.surfaces.find((w) => w.id === cover.id);
            if (!still || still.x !== cover.x || still.y !== cover.y) break;
          }
          if (!alive(token)) return;
          setMask(null);
          // Step back out into the open.
          const b2 = measureBody();
          if (b2 && bounds.current) {
            const feet = feetOf(b2, bounds.current);
            const away = feet.x < cover.x + cover.width / 2 ? -b2.width * 0.7 : b2.width * 0.7;
            await walkTo({ x: feet.x + away, y: feet.y }, token, { yieldable: true });
          }
        }
      } else if (plan.kind === 'watch') {
        ref.current.onAction('listen');
        setStatus('在看你在做什么');
        if (Math.random() < 0.4) ref.current.onRemark('你在忙什么呀？我就在旁边看一下下。');
        await sleep(6000);
      } else if (plan.kind === 'nap') {
        go('staying');
        ref.current.onAction('sleep');
        setStatus('在角落里打盹');
        while (alive(token) && ref.current.tired) await sleep(4000);
      }
    } catch {
      /* A failed step ends this plan; she settles below. */
    } finally {
      if (alive(token)) {
        setMask(null);
        go('idle');
        if (!ref.current.occupied) ref.current.onAction('idle');
        nextDecision.current = Date.now() + restBetween(ref.current.temperament) * 1000;
        await settle(token, false).catch(() => {});
      }
    }
  }

  useEffect(() => {
    if (options.blocked || !options.enabled) {
      if (phaseRef.current !== 'idle') stop();
    }
  }, [options.blocked, options.enabled]);
  useEffect(() => {
    stop();
    nextDecision.current = Date.now() + 15000;
    return () => {
      generation.current++;
    };
  }, [options.characterId]);
  // The decision loop: when nothing else is going on, every so often pick something to do.
  useEffect(() => {
    if (!options.petMode) return;
    let live = true;
    const timer = setInterval(async () => {
      const o = ref.current;
      if (!live || !o.enabled || o.blocked || lifted.current || phaseRef.current !== 'idle') return;
      if (o.occupied && !o.tired) return;
      if (Date.now() < nextDecision.current || Date.now() - placedAt.current < PLACED_STAY) return;
      nextDecision.current = Date.now() + restBetween(o.temperament) * 1000;
      const token = ++generation.current;
      try {
        const curious = o.temperament.curiosity / 100;
        const value = await scene(Math.random() < curious * 0.25);
        const body = measureBody();
        if (!live || !alive(token) || !body) return;
        const all = findLedges(value, body),
          feet = feetOf(body, value.bounds),
          below = supportBelow(all, feet),
          // Off any ledge she is where the user put her, and plans from there.
          current = standingOn(below, feet) ? below : null;
        const userIdle = await bridge.userIdle().catch(() => 0);
        const plan = nextPlan({
          scene: value,
          ledges: all,
          body,
          feet,
          current,
          temperament: o.temperament,
          hour: new Date().getHours(),
          userIdle,
          focusChanged: focusChanged.current,
          tired: o.tired,
        });
        focusChanged.current = false;
        await act(plan, token);
      } catch {
        /* Try again next time. */
      }
    }, 2500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [options.petMode]);
  // Standing on a window while it moves. Dragged slowly she rides it and runs to keep her spot;
  // yanked away fast it slips out from under her and she falls to the bottom of the screen; when
  // it closes she falls too. Window positions arrive four times a second from the desktop helper.
  useEffect(() => {
    if (!options.petMode) return;
    let live = true,
      busy = false,
      seen = 0;
    const timer = setInterval(async () => {
      const held = support.current;
      if (!live || busy || lifted.current || !held?.window) return;
      if (!['idle', 'staying', 'company'].includes(phaseRef.current) || place.current?.kind === 'hide')
        return;
      busy = true;
      try {
        const value = await scene();
        if (!live || lifted.current || support.current !== held) return;
        const body = measureBody();
        if (!body) return;
        const now = value.surfaces.find((w) => w.id === held.window!.id);
        const at = value.at || Date.now();
        if (!now) return void (await tumble(value, body, 'gone'));
        const moved = Math.hypot(now.x - held.window.x, now.y - held.window.y);
        if (!moved) {
          seen = at;
          return;
        }
        const since = seen && at > seen ? (at - seen) / 1000 : 0.25;
        if (moved > FLING_JUMP || moved / Math.max(0.05, since) > FLING_SPEED)
          return void (await tumble(value, body, 'flung'));
        await chase(held, body, at, now);
        seen = 0;
      } catch {
        /* Next look. */
      } finally {
        busy = false;
      }
    }, 150);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [options.petMode]);
  // Keeping the user company. Every moment she looks at what the user is doing; while they work
  // in an app she goes to stand beside its window (never over it if there is room), watches it,
  // glances at it while they type, and moves along when it moves. When they stop working or the
  // user picks her up, she goes back to her own life. A window that is in front only for a moment
  // (a quick switch) does not send her anywhere.
  useEffect(() => {
    if (!options.petMode) return;
    let live = true,
      busy = false,
      stableKey = '',
      stableSince = 0,
      nextGlance = 0,
      nextPose = 0,
      nextSeek = 0,
      seeking = false,
      shown: PetAction | undefined,
      idleSince = Date.now(),
      habitGap = 12000,
      habitUntil = 0,
      habitAction: PetAction | null = null;
    // One of her small habits, so she never just stands there.
    const habit = () => {
      const o = ref.current;
      const usable = moodHabits(o.mood || 'calm', o.habits || ['lookAround']).filter((h) =>
        h === 'sit' || h === 'lie'
          ? o.supports(h)
          : h === 'lookAround'
            ? canWalk()
            : h === 'stretch'
              ? o.supports('bounce')
              : true,
      );
      const chosen = usable[Math.floor(Math.random() * usable.length)];
      if (!chosen) return;
      if (chosen === 'sit' || chosen === 'lie') {
        habitAction = chosen;
        habitUntil = Date.now() + within(conduct().hold);
        o.onAction(chosen);
      } else if (chosen === 'lookAround') {
        const first = Math.random() < 0.5 ? 'left' : 'right';
        setGlance({ side: first, key: Date.now() });
        setTimeout(() => setGlance({ side: first === 'left' ? 'right' : 'left', key: Date.now() }), 2100);
      } else if (chosen === 'stretch') o.onAction('bounce');
      else o.onHabit?.(chosen);
    };
    const timer = setInterval(async () => {
      if (!live || busy) return;
      busy = true;
      try {
        const value = await scene();
        if (!live) return;
        const ctx = userContext(value.activity);
        if (!sameContext(contextRef.current, ctx)) {
          contextRef.current = ctx;
          setContext(ctx);
          ref.current.onContext(ctx);
        }
        const key = ctx ? `${ctx.app}|${ctx.focus?.id || ''}|${ctx.company}` : '';
        if (key !== stableKey) {
          stableKey = key;
          stableSince = Date.now();
        }
        const o = ref.current;
        const steady = Date.now() - stableSince >= 4000;
        // Sulking on the floor: nothing until she is comforted, or gets over it by herself.
        if (phaseRef.current === 'sulking') {
          if (Date.now() < sulkUntil.current) return;
          go('idle');
          setStatus('不生气了');
        }
        // Standing about with nothing to do: after a little while, one of her habits.
        const now = o.current?.();
        if (now !== shown) {
          shown = now;
          idleSince = Date.now();
        }
        if (habitAction && now === habitAction && Date.now() > habitUntil) {
          habitAction = null;
          o.onAction('idle');
        }
        if (
          o.enabled &&
          !o.blocked &&
          !o.held?.() &&
          !lifted.current &&
          (now === 'idle' || (now === 'listen' && phaseRef.current === 'company')) &&
          ['idle', 'company'].includes(phaseRef.current) &&
          Date.now() - idleSince > habitGap
        ) {
          habitGap = within(conduct().habitGap);
          idleSince = Date.now();
          habit();
        }
        const area = value.area,
          f = ctx?.focus;
        // A window on another display is out of her reach: she stays on her own screen.
        const reachable =
          f &&
          f.x < area.x + area.width &&
          f.x + f.width > area.x &&
          f.y < area.y + area.height &&
          f.y + f.height > area.y;
        // She goes to the user's window when they work in it, or, left alone too long, to ask for
        // their attention there.
        const wanted = Boolean(
          ctx &&
            ctx.focus &&
            reachable &&
            o.enabled &&
            // Cross with the user, she keeps away from their window.
            conduct().keepsCompany &&
            (ctx.company || (o.lonely && ctx.mode !== 'away')),
        );
        if (!ctx || !ctx.focus || !wanted) {
          if (phaseRef.current === 'company' && (steady || !ctx || ctx.mode === 'away')) leaveCompany();
          return;
        }
        if (!ctx.company && !seeking) {
          seeking = true;
          nextSeek = Date.now() + 6000;
        }
        if (ctx.company) seeking = false;
        if (o.blocked || o.held?.() || lifted.current || Date.now() - placedAt.current < PLACED_COMPANY)
          return;
        if (!['idle', 'company'].includes(phaseRef.current) || !steady) return;
        const body = measureBody();
        if (!body) return;
        const focus = ctx.focus;
        const feet = feetOf(body, value.bounds);
        const held = company.current;
        const shifted =
          !held ||
          held.focus.id !== focus.id ||
          Math.abs(held.focus.x - focus.x) +
            Math.abs(held.focus.y - focus.y) +
            Math.abs(held.focus.width - focus.width) +
            Math.abs(held.focus.height - focus.height) >
            60;
        if (phaseRef.current === 'company' && held && !shifted) {
          // Standing beside the window, she looks over at what the user is typing now and then.
          if (!held.spot.perch && !o.occupied && ctx.mode === 'typing' && Date.now() >= nextGlance) {
            nextGlance = Date.now() + 6000 + Math.random() * 7000;
            setGlance({ side: held.spot.side === 'left' ? 'right' : 'left', key: Date.now() });
          }
          // Now and then she asks for a little attention: soon after coming over lonely, otherwise
          // every ten minutes or so while the user is not typing.
          if (Date.now() >= nextSeek && ctx.mode !== 'typing') {
            if (nextSeek) o.onSeek?.();
            nextSeek = Date.now() + 8 * 60000 + Math.random() * 7 * 60000;
          }
          // Now and then she shifts: sits, lies down, or does something of her own. How long she
          // stays down and how often she busies herself instead follow her mood.
          if (Date.now() >= nextPose) {
            if (nextPose && (!o.occupied || pose.current === 'own'))
              settlePose(Math.random() < conduct().ownChance * 0.75);
            nextPose = Date.now() + within(conduct().hold);
          }
          return;
        }
        // On the window's top edge when it leaves her room, otherwise just beside it.
        const spot = perchSpot(value.area, body, focus, feet) || companySpot(value.area, body, focus, feet);
        nextPose = Date.now() + within(conduct().hold);
        if (!seeking) nextSeek = Date.now() + 8 * 60000 + Math.random() * 7 * 60000;
        if (
          Math.hypot(spot.to.x - feet.x, spot.to.y - feet.y) < 40 ||
          (!spot.perch &&
            !spot.over &&
            coverage(feet, body, focus) === 0 &&
            Math.abs(spot.to.y - feet.y) < 40 &&
            Math.abs(spot.to.x - feet.x) < body.width)
        ) {
          arrive(focus, spot);
          return;
        }
        const token = ++generation.current;
        place.current = null;
        setMask(null);
        go('moving');
        setStatus(spot.perch ? '跑到你的窗口上' : '跑到你的窗口旁边');
        const reached = await travelTo(spot.to, token, RUN);
        if (!live || !alive(token)) return;
        if (reached) arrive(focus, spot);
        else go('idle');
      } catch {
        /* Look again next time. */
      } finally {
        busy = false;
      }
    }, 1500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [options.petMode]);
  // Stays and invitations end on their own.
  useEffect(() => {
    if (!['staying', 'inviting'].includes(phase) || !place.current) return;
    let live = true;
    const timer = setInterval(() => {
      if (!live || Date.now() <= until.current) return;
      if (phaseRef.current === 'inviting') decline();
      else if (place.current) {
        stop();
        ref.current.onLine('先回来啦，待会儿再继续。');
      }
    }, 1000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [phase]);

  return {
    phase,
    status,
    mask,
    airborne,
    glance,
    context,
    explore,
    start,
    decline,
    stop,
    /** Busy with something of her own on the desktop (keeping company or sulking is not that). */
    active: phase !== 'idle' && phase !== 'company' && phase !== 'sulking',
    company: phase === 'company',
    sulking: phase === 'sulking',
    /** Comforted: she stops sulking and goes back to the user's window if they are working. */
    forgive() {
      if (phaseRef.current !== 'sulking') return false;
      sulkUntil.current = 0;
      go('idle');
      setStatus('不生气了');
      return true;
    },
    /** The user picked her up: everything she was doing stops. */
    /** Run in from a side of the screen to where she was: when summoned, or when the user moves
     *  to another Space (she was left behind and catches up). */
    // `always`: also when she is busy (a Space change leaves her behind whatever she was doing);
    // otherwise only when she is free (being summoned does not cancel what the user started).
    async enterFrom(side: 'left' | 'right', always = false) {
      if (!ref.current.petMode || lifted.current) return;
      if (!always && phaseRef.current !== 'idle') return;
      const token = ++generation.current;
      place.current = null;
      company.current = null;
      support.current = null;
      setMask(null);
      go('moving');
      setStatus('跑过来了');
      try {
        const value = await scene();
        const body = measureBody();
        if (!body || !alive(token)) return;
        const home = feetOf(body, value.bounds);
        const flies = ref.current.travel === 'fly' && ref.current.supports('fly') && !conduct().walksOnly;
        if (!flies && !canWalk() && !ref.current.supports('bounce')) {
          ref.current.onTeleport?.('out');
          await sleep(120);
          ref.current.onTeleport?.('in');
          await sleep(280);
          return;
        }
        const outside =
          side === 'right'
            ? value.area.x + value.area.width + body.width * 0.55
            : value.area.x - body.width * 0.55;
        free.current = true;
        bounds.current = await bridge.stepPet({
          x: Math.round(outside - body.foot.x),
          y: Math.round(home.y - body.foot.y),
          free: true,
          jump: true,
        });
        // Out of sight she has already turned or taken off: she comes into view on her way.
        if (flies) await flyTo(home, token, true);
        else await walkTo(home, token, { pace: RUN, sudden: true });
      } catch {
        /* She stays wherever she got to. */
      } finally {
        free.current = false;
        if (alive(token)) {
          go('idle');
          setStatus('在桌面上自己待着');
          ref.current.onEnter?.();
        }
      }
    },
    lift() {
      lifted.current = true;
      company.current = null;
      generation.current++;
      place.current = null;
      setMask(null);
      go('idle');
    },
    /** The user let go: she stays there, or steps onto a ledge just below her feet. */
    async drop() {
      lifted.current = false;
      placedAt.current = Date.now();
      support.current = null;
      const token = ++generation.current;
      try {
        await settle(token, true);
      } catch {
        /* She stays where she was put. */
      }
      // Wherever she was put, she spends a while there before deciding anything herself.
      nextDecision.current = Date.now() + restBetween(ref.current.temperament) * 1000;
    },
  };
}
