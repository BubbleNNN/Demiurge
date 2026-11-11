/** Pointer gestures: time and distance are supplied by either the page or native pointer feed. */
export type Gesture = 'headpat' | 'hold' | 'watch';
export function createTouchGestures() {
  let anchor = 0,
    direction = 0,
    turns = 0,
    started = 0,
    last = 0;
  let nextWatch = 0;
  let cooldown = 0,
    heldAt = 0,
    held = false,
    hovering = false,
    watchAt = 0;
  return {
    reset() {
      turns = 0;
      started = 0;
      last = 0;
      held = false;
      hovering = false;
    },
    down(now: number) {
      heldAt = now;
      held = true;
    },
    up() {
      held = false;
    },
    sample(x: number, now: number, head: boolean, figure: boolean, dragging = false): Gesture | null {
      if (dragging || !figure) {
        this.reset();
        return null;
      }
      if (!hovering) {
        hovering = true;
        watchAt = now;
      }
      if (now < cooldown) return null;
      if (held && now - heldAt >= 650) {
        held = false;
        cooldown = now + 2500;
        return 'hold';
      }
      if (head) {
        if (!started || now - last > 800 || now - started > 2200) {
          anchor = x;
          direction = 0;
          turns = 0;
          started = now || 1;
        }
        last = now;
        const delta = x - anchor;
        if (Math.abs(delta) >= 5) {
          const next = Math.sign(delta);
          if (direction && next !== direction) turns++;
          direction = next;
          anchor = x;
          if (turns >= 2) {
            turns = 0;
            started = 0;
            cooldown = now + 2500;
            watchAt = now;
            return 'headpat';
          }
        }
      } else {
        started = 0;
        turns = 0;
      }
      if (!held && now >= nextWatch && now - watchAt >= 2200) {
        watchAt = now;
        nextWatch = now + 12000;
        return 'watch';
      }
      return null;
    },
  };
}
