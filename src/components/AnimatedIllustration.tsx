import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { Emotion, PetAction, Skin } from '../types';
import { spriteAnimation } from '../artwork';
import { skinImage } from '../theme';
import { drawSpriteFrame, prepareSpritePage, type SpriteCell } from '../animation/sprites';
import { figureFromFrames, loadImage, pageOf, pageSource } from '../animation/pages';
import { selectSpriteFrame } from '../animation/timeline';
import { playbackAnimation } from '../animation/rest';
import { advanceActivityPlayback, newActivityPlayback, isActivity } from '../animation/activities';
import { measureSequenceBounds, type FigureBounds } from '../animation/framing';
import { SkinArtwork } from './SkinArtwork';
import { headCorrection, measureHead, type HeadMetrics } from '../animation/heads';
import type { SpriteAnimation } from '../types';

// One pack object per pack content. A workspace save hands the page fresh copies of every look;
// keyed on content, the player keeps playing instead of reloading (which showed the fallback
// still for a moment, and with it a head of another size).
const stable = new Map<string, SpriteAnimation>();
function stableAnimation(skin: Skin, image: string | undefined, source: SpriteAnimation | undefined) {
  if (!source) return undefined;
  const pages = (source.pages || []).map((p) =>
    p.src.length > 160 ? `${p.src.slice(0, 80)}#${p.src.length}` : p.src,
  );
  const key = [
    skin.id,
    image && image.length > 160 ? `${image.slice(0, 80)}#${image.length}` : image,
    source.width,
    source.height,
    source.frames.length,
    pages.join(','),
    JSON.stringify(source.clips),
    JSON.stringify(source.mouthFrames || null),
  ].join('|');
  let value = stable.get(key);
  if (!value) {
    value = playbackAnimation(source);
    stable.set(key, value);
    if (stable.size > 24) stable.delete(stable.keys().next().value as string);
  }
  return value;
}
interface Props {
  skin: Skin;
  emotion: Emotion;
  action: PetAction;
  actionKey: number;
  talking: boolean;
  audioDriven: boolean;
  mouth: MutableRefObject<number>;
  tracking: boolean;
  zoom: number;
  enabled: boolean;
  /** A short look to one side: the turn that starts her walk that way, held, then back. */
  glance?: { side: 'left' | 'right'; key: number } | null;
}
// How long a glance lasts, and the turn in and out of it, in milliseconds.
const GLANCE = 1500,
  GLANCE_TURN = 130;
export function AnimatedIllustration(props: Props) {
  // Older generated packs play on a rest pose drawn like their motions (see animation/rest.ts).
  const imageUrl = skinImage(props.skin);
  const animation = stableAnimation(props.skin, imageUrl, spriteAnimation(props.skin));
  const canvas = useRef<HTMLCanvasElement>(null);
  const current = useRef(props);
  current.current = props;
  const [ready, setReady] = useState(false);
  // Once a frame is on screen, a reload keeps it there instead of showing the fallback still.
  const [drawn, setDrawn] = useState(false);
  const [failed, setFailed] = useState(false);
  const [resolutionNote, setResolutionNote] = useState('');
  useEffect(() => {
    const node = canvas.current;
    if (!node || !animation) return;
    setReady(false);
    setFailed(false);
    setResolutionNote('');
    if (node.dataset.skin && node.dataset.skin !== props.skin.id) setDrawn(false);
    delete node.dataset.skin;
    delete node.dataset.frame;
    delete node.dataset.clip;
    delete node.dataset.motion;
    let disposed = false,
      raf = 0,
      time = 0,
      last = 0,
      inView = true;
    // Frames are decoded per atlas page, when a clip on that page is first needed. A large pack
    // keeps its idle and short clips on page 0 and each activity on a later page, so the player
    // holds only what it plays; least-recently used pages are dropped past a memory budget.
    let cells: (SpriteCell | undefined)[] | undefined;
    // Per-frame head sizes and the scale that brings each upright frame to the rest pose's.
    const heads: (HeadMetrics | null | undefined)[] = [];
    const adjust: number[] = [];
    let rest: HeadMetrics | null = null;
    const measure = (indices: Iterable<number>) => {
      if (animation.pixelated || !cells) return;
      for (const index of indices) {
        const cell = cells[index];
        if (!cell || heads[index] !== undefined) continue;
        heads[index] = measureHead(cell);
        adjust[index] = headCorrection(heads[index]!, rest);
      }
    };
    let figure: FigureBounds | undefined;
    let previous = '',
      redraw = true,
      lastDrawn = -1;
    const pages = new Map<number, { frames: number[]; pixels: number; used: number }>();
    const loading = new Set<number>();
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const playback = newActivityPlayback();
    let glanceKey = 0,
      glanceAt = -Infinity,
      glanceSide: 'left' | 'right' = 'left';
    const ensurePage = (page: number) => {
      if (pages.has(page) || loading.has(page)) return;
      const src = pageSource(imageUrl!, animation, page);
      if (!src) return;
      loading.add(page);
      loadImage(src)
        .then((image) => {
          if (disposed || !cells) return;
          const prepared = prepareSpritePage(image, animation, page);
          let pixels = 0;
          for (const [index, cell] of prepared) {
            cells[index] = cell;
            pixels += cell.image.width * cell.image.height;
          }
          pages.set(page, { frames: [...prepared.keys()], pixels, used: performance.now() });
          measure(prepared.keys());
          let total = [...pages.values()].reduce((n, p) => n + p.pixels, 0);
          while (total > 28 * 1024 * 1024) {
            const oldest = [...pages.entries()]
              .filter(([n]) => n !== 0 && n !== page)
              .sort((a, b) => a[1].used - b[1].used)[0];
            if (!oldest) break;
            for (const index of oldest[1].frames) cells[index] = undefined;
            pages.delete(oldest[0]);
            total -= oldest[1].pixels;
          }
          update();
        })
        .catch(() => {
          if (!disposed && page === 0) setFailed(true);
        })
        .finally(() => loading.delete(page));
    };
    const tick = (stamp: number) => {
      raf = 0;
      if (disposed || !cells || !inView || document.hidden) return;
      const p = current.current,
        paused = media.matches || !p.enabled;
      if (!paused) time += Math.min(stamp - last, 100);
      last = stamp;
      const speechInterrupt =
        p.talking && (isActivity(p.action) || isActivity(playback.current) || Boolean(playback.segment));
      const target = speechInterrupt ? 'idle' : p.action;
      const activity = advanceActivityPlayback(
        playback,
        animation,
        target,
        time,
        p.actionKey,
        paused,
        speechInterrupt,
      );
      let selected =
        activity ||
        selectSpriteFrame(animation, {
          time,
          age: time - playback.since,
          action: target,
          emotion: p.emotion,
          talking: p.talking,
          audioDriven: p.audioDriven,
          mouth: p.mouth.current,
          paused,
        });
      // A glance interrupts only standing still: idle, blinking or listening.
      if (p.glance && p.glance.key !== glanceKey) {
        glanceKey = p.glance.key;
        glanceAt = time;
        glanceSide = p.glance.side;
      }
      const turn = animation.clips[`enter_walk_${glanceSide}`];
      const looked = time - glanceAt;
      if (
        !paused &&
        looked >= 0 &&
        looked < GLANCE &&
        turn &&
        turn.frames.length >= 2 &&
        ['idle', 'blink', 'listen'].includes(selected.clip)
      )
        selected = {
          frame: looked < GLANCE_TURN || looked > GLANCE - GLANCE_TURN ? turn.frames[0] : turn.frames[1],
          clip: 'glance',
        };
      // A frame whose page is still loading keeps the last drawn frame on screen meanwhile.
      let shown = selected.frame;
      if (!cells[shown]) {
        ensurePage(pageOf(animation, shown));
        shown = cells[lastDrawn] ? lastDrawn : -1;
      } else {
        const entry = pages.get(pageOf(animation, shown));
        if (entry) entry.used = stamp;
      }
      const key = `${shown}:${p.zoom}`;
      if (shown >= 0 && (redraw || key !== previous)) {
        const cell = cells[shown]!;
        const placement = drawSpriteFrame(
          node,
          cell,
          Boolean(animation.pixelated),
          p.zoom,
          figure,
          adjust[shown] || 1,
        );
        setDrawn(true);
        setResolutionNote(
          !animation.pixelated && placement && placement.scale > 1.25
            ? `动作帧 ${cell.width} × ${cell.height} · 当前放大 ${placement.scale.toFixed(1)} 倍`
            : '',
        );
        previous = key;
        lastDrawn = shown;
        redraw = false;
      }
      node.dataset.frame = String(selected.frame);
      node.dataset.clip = selected.clip;
      node.dataset.skin = props.skin.id;
      node.dataset.motion = paused ? 'paused' : 'active';
      if (!paused) raf = requestAnimationFrame(tick);
    };
    const resume = () => {
      if (!disposed && !raf && cells && inView && !document.hidden) {
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    };
    const update = () => {
      redraw = true;
      resume();
    };
    const visibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else resume();
    };
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      if (!inView) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else resume();
    });
    observer.observe(node);
    const resize = new ResizeObserver(update);
    resize.observe(node);
    loadImage(imageUrl!)
      .then((image) => {
        if (disposed) return;
        cells = new Array(animation.frames.length);
        const prepared = prepareSpritePage(image, animation, 0);
        let pixels = 0;
        for (const [index, cell] of prepared) {
          cells[index] = cell;
          pixels += cell.image.width * cell.image.height;
        }
        pages.set(0, { frames: [...prepared.keys()], pixels, used: performance.now() });
        // Head sizes are compared with the rest pose, which is always on the first page.
        const restCell = cells[animation.clips.idle.frames[0]];
        rest = !animation.pixelated && restCell ? measureHead(restCell) : null;
        measure(prepared.keys());
        // One crop for the whole animation: from metadata when frames are spread over pages,
        // otherwise measured from the decoded frames as before.
        figure =
          (animation.pages?.length && figureFromFrames(animation)) ||
          measureSequenceBounds(prepared.size ? [...prepared.values()] : []);
        setReady(true);
        resume();
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    node.addEventListener('mori:render', update);
    document.addEventListener('visibilitychange', visibility);
    media.addEventListener('change', update);
    window.addEventListener('resize', update);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      resize.disconnect();
      node.removeEventListener('mori:render', update);
      document.removeEventListener('visibilitychange', visibility);
      media.removeEventListener('change', update);
      window.removeEventListener('resize', update);
    };
  }, [props.skin.id, animation, imageUrl]);
  useEffect(() => {
    canvas.current?.dispatchEvent(new Event('mori:render'));
  }, [
    props.enabled,
    props.emotion,
    props.zoom,
    props.action,
    props.actionKey,
    props.talking,
    props.audioDriven,
  ]);
  return (
    <div className={`animated-illustration ${spriteAnimation(props.skin)?.pixelated ? 'pixel-art' : ''}`}>
      {((!ready && !drawn) || failed) && (
        <div className="sprite-fallback" style={{ transform: `scale(${props.zoom * 0.94})` }}>
          <SkinArtwork skin={props.skin} alt={`${props.skin.name}角色立绘`} />
        </div>
      )}
      <canvas
        ref={canvas}
        className={(ready || drawn) && !failed ? '' : 'canvas-pending'}
        aria-label={`${props.skin.name}，逐帧动画`}
        role="img"
      />
      {failed && <span className="sprite-fallback-note">动画素材无法播放</span>}
      {!failed && ready && resolutionNote && (
        <span
          className="sprite-resolution-note"
          title="此处显示真实单帧像素。放大不会增加细节；高清动画需要更高分辨率的原始动作帧。"
        >
          {resolutionNote}
        </span>
      )}
    </div>
  );
}
