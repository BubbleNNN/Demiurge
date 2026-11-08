// The desktop character's body: she stands on the floor, on window tops or on desktop icons,
// walks and climbs between them according to her temperament, rides a window when it moves and
// falls when what she stands on goes away. Adapted in part from Anime Codex (MIT): visible places,
// bounded travel and revalidation before every stay.
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
  onAction: (a: PetAction) => void;
  /** A line caused by the user (a drop, a failed search): always shown. */
  onLine: (line: string) => void;
  /** A line she says on her own: subject to the attention budget. */
  onRemark: (line: string) => void;
  onResult: (found: boolean) => void;
  /** She touched down after a jump or a fall; height in screen points. */
  onLand: (height: number) => void;
  /** She arrived on a window top to carry on her activity there. */
  onPerch: () => void;
}
type Phase = 'idle' | 'finding' | 'inviting' | 'moving' | 'staying';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  const generation = useRef(0),
    phaseRef = useRef<Phase>('idle'),
    place = useRef<Place | null>(null),
    bounds = useRef<DesktopRect | null>(null),
    until = useRef(0),
    lifted = useRef(false),
    support = useRef<{ ledge: Ledge; window?: DesktopRect & { id: string } } | null>(null),
    lastFront = useRef(''),
    focusChanged = useRef(false),
    icons = useRef<{ at: number; list: DesktopScene['icons']; denied: boolean }>({ at: 0, list: [], denied: false }),
    nextDecision = useRef(Date.now() + 15000),
    nextHide = useRef(Date.now() + 30000);
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
      icons.current = { at: Date.now(), list: value.icons, denied: value.icons.length === 0 && Boolean(value.reason) };
      if (icons.current.denied) icons.current.at = Date.now() + 30 * 60000;
    }
    bounds.current = value.bounds;
    const front = value.surfaces[0]?.id || '';
    if (front && lastFront.current && front !== lastFront.current) focusChanged.current = true;
    lastFront.current = front;
    return { ...value, icons: value.icons.length ? value.icons : icons.current.list };
  }
  const feetOf = (body: Body, at: DesktopRect) => ({ x: at.x + body.foot.x, y: at.y + body.foot.y });
  async function place2(target: Point, body: Body) {
    const moved = await bridge.stepPet({ x: Math.round(target.x - body.foot.x), y: Math.round(target.y - body.foot.y) });
    bounds.current = moved;
    return moved;
  }

  // Horizontal walk along the ledge she stands on. Her own wandering (yieldable) gives way the
  // moment an activity starts; walking to a spot chosen for an activity does not.
  async function walkTo(to: Point, token: number, yieldable = false) {
    const body = measureBody();
    if (!body || !bounds.current) return false;
    const speed = walkSpeed(ref.current.temperament);
    const started = Date.now();
    let last = performance.now();
    for (;;) {
      if (!alive(token) || lifted.current || (yieldable && ref.current.occupied)) return false;
      const feet = feetOf(body, bounds.current);
      const dx = to.x - feet.x;
      if (Math.abs(dx) <= 2) break;
      if (Date.now() - started > 40000) return false;
      const now = performance.now(),
        step = Math.min(Math.abs(dx), speed * Math.min(0.1, (now - last) / 1000));
      last = now;
      ref.current.onAction(dx < 0 ? 'walk_left' : 'walk_right');
      const moved = await place2({ x: feet.x + Math.sign(dx) * Math.max(1, step), y: to.y }, body);
      // The window could not go further (screen edge): stop here.
      if (Math.abs(feetOf(body, moved).x - feet.x) < 0.5 && step >= 1) break;
      await sleep(30);
    }
    if (!(yieldable && ref.current.occupied)) ref.current.onAction('idle');
    return true;
  }
  // A jump along an arc to another ledge.
  async function hopTo(to: Point, token: number, yieldable = false) {
    const body = measureBody();
    if (!body || !bounds.current || (yieldable && ref.current.occupied)) return false;
    const from = feetOf(body, bounds.current),
      path = hopPath(from, to),
      start = performance.now();
    ref.current.onAction(to.y < from.y ? 'bounce' : 'drag');
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
  // Gravity: down to the ledge below.
  async function fallTo(ledge: Ledge, token: number) {
    const body = measureBody();
    if (!body || !bounds.current) return false;
    const from = feetOf(body, bounds.current);
    if (ledge.y - from.y <= 3) return true;
    let y = from.y,
      v = 0,
      last = performance.now();
    ref.current.onAction('drag');
    setAirborne(true);
    try {
      while (y < ledge.y) {
        if (!alive(token) || lifted.current) return false;
        const now = performance.now(),
          dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        v = Math.min(2200, v + 2600 * dt);
        y = Math.min(ledge.y, y + v * dt);
        await place2({ x: from.x, y }, body);
        await sleep(16);
      }
    } finally {
      setAirborne(false);
    }
    ref.current.onAction('idle');
    ref.current.onLand(ledge.y - from.y);
    return true;
  }
  // Find what is under her now; fall onto it if she is not standing on it.
  async function settle(token: number, announce: boolean) {
    const body = measureBody();
    if (!body) return;
    const value = await scene();
    if (!alive(token)) return;
    const all = findLedges(value, body),
      feet = feetOf(body, value.bounds),
      below = supportBelow(all, feet);
    if (!below) return;
    const height = below.y - feet.y;
    // A few points (a resize, the first placement) is a quiet adjustment, not a fall that would
    // interrupt whatever she is doing.
    if (height > 24) await fallTo(below, token);
    else if (height > 1) await place2({ x: feet.x, y: below.y }, body);
    if (!alive(token)) return;
    support.current = { ledge: below, window: value.surfaces.find((w) => w.id === below.owner) };
    if (announce && height > 140)
      ref.current.onLine(
        below.kind === 'window'
          ? '稳稳落在窗口上了。'
          : height > 400
            ? '呜哇——从那么高的地方！下次轻一点放我下来嘛。'
            : '哎呀，落地了。',
      );
  }

  function stop(found = false) {
    generation.current++;
    const wasHide = place.current?.kind === 'hide' && phaseRef.current === 'staying';
    place.current = null;
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
        await walkTo({ x: destination.x + Math.sign(feet.x - destination.x) * Math.min(160, Math.abs(feet.x - destination.x)), y: feet.y }, token);
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
          ledge: { id: `window:${target.id}`, kind: 'window', owner: target.id, x: valid.x, y: valid.y, width: valid.width },
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
    const token = ++generation.current;
    go('finding');
    try {
      const value = await scene(kind !== 'read');
      if (!alive(token)) return false;
      const body = measureBody();
      const foot = body?.foot || { x: value.bounds.width / 2, y: value.bounds.height - 40 };
      const target = value.supported ? choosePlace(value, foot, kind) : null;
      if (!target) {
        const line = value.reason || '没有找到露出的图标或合适的窗口上沿。可以把一个窗口往下移，或露出桌面后再试。';
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
        if (walkFirst && !(await walkTo(walkFirst, token, true))) return;
        if (!(await hopTo(plan.to, token, true))) return;
        setStatus(plan.ledge.kind === 'window' ? '爬到窗口上看看' : plan.ledge.kind === 'icon' ? '站到图标上' : '回到地面');
        if (plan.ledge.kind !== 'floor' && Math.random() < 0.35)
          ref.current.onRemark(plan.ledge.kind === 'icon' ? '这个图标站起来软软的。' : '从这里看，你的屏幕好热闹。');
      } else {
        if (walkFirst) {
          if (!(await walkTo(walkFirst, token, true))) return;
          if (!(await hopTo({ x: walkFirst.x, y: plan.ledge.y }, token, true))) return;
        }
        if (!(await walkTo(plan.to, token, true))) return;
      }
      if (!alive(token)) return;
      const value = await scene();
      if (!alive(token)) return;
      const body = measureBody();
      if (body) {
        const all = findLedges(value, body);
        const under = supportBelow(all, feetOf(body, value.bounds));
        if (under) support.current = { ledge: under, window: value.surfaces.find((w) => w.id === under.owner) };
      }
      if (plan.kind === 'peek') {
        const cover = value.surfaces.find((w) => w.id === (plan.cover as DesktopRect & { id: string }).id);
        if (cover) {
          setMask({ x: cover.x - value.bounds.x, y: cover.y - value.bounds.y, width: cover.width, height: cover.height });
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
            await walkTo({ x: feet.x + away, y: feet.y }, token, true);
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
      if (Date.now() < nextDecision.current) return;
      nextDecision.current = Date.now() + restBetween(o.temperament) * 1000;
      const token = ++generation.current;
      try {
        const curious = o.temperament.curiosity / 100;
        const value = await scene(Math.random() < curious * 0.25);
        const body = measureBody();
        if (!live || !alive(token) || !body) return;
        const all = findLedges(value, body),
          feet = feetOf(body, value.bounds),
          current = supportBelow(all, feet);
        if (!standingOn(current, feet)) return void settle(token, false);
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
  // Riding: while she stands on a window top, follow the window; fall when it goes away.
  useEffect(() => {
    if (!options.petMode) return;
    let live = true,
      busy = false;
    const timer = setInterval(async () => {
      const held = support.current;
      if (!live || busy || lifted.current || !held?.window || !['idle', 'staying'].includes(phaseRef.current)) return;
      if (place.current?.kind === 'hide') return;
      busy = true;
      const token = generation.current;
      try {
        const value = await scene();
        if (!live || !alive(token) || lifted.current) return;
        const body = measureBody();
        if (!body) return;
        const now = value.surfaces.find((w) => w.id === held.window!.id);
        const feet = feetOf(body, value.bounds);
        if (now && (now.x !== held.window.x || now.y !== held.window.y)) {
          const target = { x: feet.x + now.x - held.window.x, y: feet.y + now.y - held.window.y };
          for (let i = 0; i < 6; i++) {
            const moved = await place2(target, body);
            const f = feetOf(body, moved);
            if (Math.abs(f.x - target.x) < 2 && Math.abs(f.y - target.y) < 2) break;
          }
          held.window = now;
        }
        const all = findLedges(value, body),
          after = feetOf(body, bounds.current || value.bounds),
          under = supportBelow(all, after);
        // The window closed, shrank away or something now covers her spot: she falls.
        if (!standingOn(under, after) || under?.owner !== held.window.id) {
          if (phaseRef.current === 'staying') stop();
          const fall = ++generation.current;
          support.current = null;
          await settle(fall, true);
          if (alive(fall)) ref.current.onAction('idle');
        }
      } catch {
        /* Next tick. */
      } finally {
        busy = false;
      }
    }, 1200);
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
    explore,
    start,
    decline,
    stop,
    active: phase !== 'idle',
    /** The user picked her up: everything she was doing stops. */
    lift() {
      lifted.current = true;
      generation.current++;
      place.current = null;
      setMask(null);
      go('idle');
    },
    /** The user let go: she falls onto whatever is below. */
    async drop() {
      lifted.current = false;
      support.current = null;
      const token = ++generation.current;
      try {
        await settle(token, true);
      } catch {
        /* She stays where she was put. */
      }
      nextDecision.current = Date.now() + restBetween(ref.current.temperament) * 1000;
    },
  };
}
