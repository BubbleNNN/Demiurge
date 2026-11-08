import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { Emotion, PetAction, Skin } from '../types';
import { spriteAnimation } from '../artwork';
import { skinImage } from '../theme';
import { drawSpriteFrame, prepareSpritePage, type SpriteCell } from '../animation/sprites';
import { figureFromFrames, loadImage, pageOf, pageSource } from '../animation/pages';
import { selectSpriteFrame } from '../animation/timeline';
import { advanceActivityPlayback, newActivityPlayback, isActivity } from '../animation/activities';
import { measureSequenceBounds, type FigureBounds } from '../animation/framing';
import { SkinArtwork } from './SkinArtwork';
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
}
export function AnimatedIllustration(props: Props) {
  const animation = spriteAnimation(props.skin);
  const imageUrl = skinImage(props.skin);
  const canvas = useRef<HTMLCanvasElement>(null);
  const current = useRef(props);
  current.current = props;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [resolutionNote, setResolutionNote] = useState('');
  useEffect(() => {
    const node = canvas.current;
    if (!node || !animation) return;
    setReady(false);
    setFailed(false);
    setResolutionNote('');
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
    let figure: FigureBounds | undefined;
    let previous = '',
      redraw = true,
      lastDrawn = -1;
    const pages = new Map<number, { frames: number[]; pixels: number; used: number }>();
    const loading = new Set<number>();
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const playback = newActivityPlayback();
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
      const selected =
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
        const placement = drawSpriteFrame(node, cell, Boolean(animation.pixelated), p.zoom, figure);
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
      {(!ready || failed) && (
        <div className="sprite-fallback" style={{ transform: `scale(${props.zoom * 0.94})` }}>
          <SkinArtwork skin={props.skin} alt={`${props.skin.name}角色立绘`} />
        </div>
      )}
      <canvas
        ref={canvas}
        className={ready && !failed ? '' : 'canvas-pending'}
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
