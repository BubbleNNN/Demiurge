import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { Emotion, PetAction, Skin } from '../types';
import { spriteAnimation } from '../artwork';
import { skinImage } from '../theme';
import { drawSpriteFrame, prepareSpriteFrames } from '../animation/sprites';
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
    let cells: HTMLCanvasElement[] | undefined;
    let figure: FigureBounds | undefined;
    let previous = '',
      redraw = true;
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const source = new Image();
    const playback = newActivityPlayback();
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
      const key = `${selected.frame}:${p.zoom}`;
      if (redraw || key !== previous) {
        const placement = drawSpriteFrame(
          node,
          cells[selected.frame],
          Boolean(animation.pixelated),
          p.zoom,
          figure,
        );
        setResolutionNote(
          !animation.pixelated && placement && placement.scale > 1.25
            ? `动作帧 ${cells[selected.frame].width} × ${cells[selected.frame].height} · 当前放大 ${placement.scale.toFixed(1)} 倍`
            : '',
        );
        previous = key;
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
    source.onload = () => {
      if (disposed) return;
      try {
        cells = prepareSpriteFrames(source, animation);
        figure = measureSequenceBounds(cells);
        setReady(true);
        resume();
      } catch {
        setFailed(true);
      }
    };
    source.onerror = () => {
      if (!disposed) setFailed(true);
    };
    source.src = imageUrl!;
    node.addEventListener('mori:render', update);
    document.addEventListener('visibilitychange', visibility);
    media.addEventListener('change', update);
    window.addEventListener('resize', update);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      resize.disconnect();
      source.onload = null;
      source.onerror = null;
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
