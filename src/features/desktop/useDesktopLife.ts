import { useEffect, useRef, useState } from 'react';
import { bridge } from '../../bridge';
import { choosePlace, placeVisible, travelStep, type Place } from '../../desktopLife';
import type { PetAction, DesktopRect } from '../../types';
interface Options {
  petMode: boolean;
  enabled: boolean;
  blocked: boolean;
  characterId: string;
  onAction: (a: PetAction) => void;
  onLine: (line: string) => void;
  onResult: (found: boolean) => void;
}
export function useDesktopLife(options: Options) {
  const ref = useRef(options);
  ref.current = options;
  const [phase, setPhase] = useState<'idle' | 'finding' | 'inviting' | 'moving' | 'staying'>('idle');
  const [status, setStatus] = useState('空闲时会寻找读书的位置，也可以点探索桌面。');
  const [mask, setMask] = useState<DesktopRect | null>(null);
  const generation = useRef(0),
    phaseRef = useRef(phase),
    place = useRef<Place | null>(null),
    bounds = useRef<DesktopRect | null>(null),
    until = useRef(0),
    next = useRef(Date.now() + 30000);
  phaseRef.current = phase;
  function stop(found = false) {
    generation.current++;
    const wasHide = place.current?.kind === 'hide' && phaseRef.current === 'staying';
    place.current = null;
    setPhase('idle');
    phaseRef.current = 'idle';
    setMask(null);
    next.current = Date.now() + 8 * 60000;
    ref.current.onAction('idle');
    if (wasHide) ref.current.onResult(found);
  }
  function start() {
    if (!place.current) return;
    setPhase('moving');
    phaseRef.current = 'moving';
    until.current = Date.now() + 30000;
    setStatus('正在走向找到的位置');
  }
  async function explore(kind: 'read' | 'hide' | 'any' = 'any', automatic = false) {
    const o = ref.current;
    if (
      !o.petMode ||
      !o.enabled ||
      o.blocked ||
      phaseRef.current !== 'idle' ||
      (automatic && Date.now() < next.current)
    )
      return false;
    const token = ++generation.current;
    phaseRef.current = 'finding';
    setPhase('finding');
    next.current = Date.now() + 30000;
    try {
      const scene = await bridge.desktopScene(kind !== 'read');
      if (token !== generation.current) return false;
      const figure = document.querySelector('.pet-draggable')?.getBoundingClientRect();
      const foot = {
        x: figure ? figure.x + figure.width / 2 : scene.bounds.width / 2,
        y: figure ? figure.y + figure.height - 5 : scene.bounds.height - 40,
      };
      const target = scene.supported ? choosePlace(scene, foot, kind) : null;
      if (!target) {
        const line =
          scene.reason || '没有找到露出的图标或合适的窗口上沿。可以把一个窗口往下移，或露出桌面后再试。';
        setStatus(line);
        if (!automatic) o.onLine(line);
        setPhase('idle');
        phaseRef.current = 'idle';
        return false;
      }
      place.current = target;
      bounds.current = scene.bounds;
      next.current = Date.now() + 8 * 60000;
      if (automatic && target.kind === 'hide') {
        setPhase('inviting');
        phaseRef.current = 'inviting';
        until.current = Date.now() + 45000;
        setStatus('找到一个可以藏起来的地方，要不要来找我？');
      } else start();
      return true;
    } catch (e) {
      if (token !== generation.current) return false;
      const line = e instanceof Error ? e.message : '暂时无法读取桌面';
      setStatus(line);
      if (!automatic) o.onLine(line);
      setPhase('idle');
      phaseRef.current = 'idle';
      return false;
    }
  }
  function decline() {
    stop();
    ref.current.onResult(false);
  }
  useEffect(() => {
    if (options.blocked || !options.enabled) {
      if (phaseRef.current !== 'idle') stop();
    }
  }, [options.blocked, options.enabled]);
  useEffect(() => {
    stop();
    next.current = Date.now() + 30000;
    return () => {
      generation.current++;
    };
  }, [options.characterId]);
  useEffect(() => {
    if (phase !== 'moving') return;
    let live = true,
      busy = false,
      last = performance.now();
    const timer = setInterval(async () => {
      if (!live || busy || !bounds.current || !place.current) return;
      busy = true;
      try {
        if (Date.now() > until.current) {
          stop();
          return;
        }
        const now = performance.now(),
          step = travelStep(bounds.current, place.current.destination, (now - last) / 1000);
        last = now;
        ref.current.onAction(step.action);
        const moved = await bridge.stepPet(step);
        if (!live) return;
        bounds.current = moved;
        if (step.arrived) {
          const scene = await bridge.desktopScene(place.current.kind === 'hide');
          if (!live) return;
          const valid = placeVisible(place.current, scene);
          if (
            !valid ||
            Math.abs(valid.x - place.current.rect.x) > 2 ||
            Math.abs(valid.y - place.current.rect.y) > 2
          ) {
            stop();
            setStatus('刚才的位置变化了，先停下来。');
            return;
          }
          until.current = Date.now() + (place.current.kind === 'hide' ? 45000 : 90000);
          setPhase('staying');
          phaseRef.current = 'staying';
          if (place.current.kind === 'hide') {
            setMask({ x: valid.x - moved.x, y: valid.y - moved.y, width: valid.width, height: valid.height });
            ref.current.onAction('listen');
            ref.current.onLine('藏好啦，找到我就点一下露出来的地方。');
          } else {
            ref.current.onAction('read');
            ref.current.onLine('这里可以待一会儿，接着读刚才那一段。');
          }
          setStatus(place.current.kind === 'hide' ? '正在捉迷藏' : '在窗口边缘读书');
        }
      } catch {
        if (live) stop();
      } finally {
        busy = false;
      }
    }, 50);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [phase]);
  useEffect(() => {
    if (!['staying', 'inviting'].includes(phase)) return;
    let live = true,
      busy = false;
    const timer = setInterval(async () => {
      if (!live || busy || !place.current) return;
      if (Date.now() > until.current) {
        if (phase === 'inviting') decline();
        else {
          stop();
          ref.current.onLine('先回来啦，待会儿再继续。');
        }
        return;
      }
      if (phase === 'inviting') return;
      busy = true;
      try {
        const scene = await bridge.desktopScene(place.current.kind === 'hide');
        if (!live || !place.current) return;
        const rect = placeVisible(place.current, scene);
        if (!rect) {
          stop();
          setStatus('位置被挡住或移走了，已结束停留。');
          return;
        }
        if (place.current.kind === 'perch') {
          const dx = rect.x - place.current.rect.x,
            dy = rect.y - place.current.rect.y;
          const target = { x: scene.bounds.x + dx, y: scene.bounds.y + dy };
          const result = await bridge.stepPet(target);
          if (Math.abs(result.x - target.x) > 2 || Math.abs(result.y - target.y) > 2) {
            stop();
            return;
          }
          place.current = { ...place.current, rect, destination: target };
        }
      } catch {
        if (live) stop();
      } finally {
        busy = false;
      }
    }, 1000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [phase]);
  return { phase, status, mask, explore, start, decline, stop, active: phase !== 'idle' };
}
