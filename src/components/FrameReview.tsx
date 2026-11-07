import { useEffect, useRef, useState } from 'react';
import { skinImage } from '../theme';
import { prepareSpriteFrame } from '../animation/sprites';
import type { FrameReviewInput, Skin, SpriteAnimation } from '../types';

function FrameCanvas({
  source,
  animation,
  index,
  full = false,
}: {
  source: HTMLImageElement;
  animation: SpriteAnimation;
  index: number;
  full?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const cell = prepareSpriteFrame(source, animation, index);
    const scale = full ? 1 : Math.min(1, 160 / cell.width, 220 / cell.height);
    node.width = Math.round(cell.width * scale);
    node.height = Math.round(cell.height * scale);
    const context = node.getContext('2d');
    if (context) {
      context.imageSmoothingEnabled = !animation.pixelated;
      context.drawImage(cell, 0, 0, node.width, node.height);
    }
  }, [source, animation, index, full]);
  return (
    <canvas
      ref={ref}
      className={animation.pixelated ? 'pixel-art' : ''}
      role="img"
      aria-label={`动作帧 ${index + 1}`}
    />
  );
}

export function FrameReview({
  skin,
  disabled = false,
  onChange,
}: {
  skin: Skin;
  disabled?: boolean;
  onChange: (review: FrameReviewInput | null) => void;
}) {
  const [source, setSource] = useState<HTMLImageElement | null>(null);
  const [selected, setSelected] = useState(0);
  const [checked, setChecked] = useState<number[]>([]);
  const [checks, setChecks] = useState([false, false, false]);
  const [failed, setFailed] = useState(false);
  const animation = skin.sprite;
  const image = skinImage(skin);
  useEffect(() => {
    setSource(null);
    setChecked([]);
    setChecks([false, false, false]);
    setSelected(0);
    setFailed(false);
    const element = new Image();
    element.onload = () => setSource(element);
    element.onerror = () => setFailed(true);
    if (image) element.src = image;
    return () => {
      element.onload = null;
      element.onerror = null;
    };
  }, [image, skin.id, skin.review?.animationDigest]);
  useEffect(() => {
    onChange(
      animation &&
        source &&
        checked.length === animation.frames.length &&
        checks.every(Boolean) &&
        skin.review?.imageDigest &&
        skin.review?.animationDigest
        ? {
            imageDigest: skin.review.imageDigest,
            animationDigest: skin.review.animationDigest,
            frames: checked,
            anatomy: true,
            identity: true,
            continuity: true,
          }
        : null,
    );
  }, [animation, source, checked, checks, skin.review?.imageDigest, skin.review?.animationDigest, onChange]);
  if (!animation) return null;
  const labels = [
    '每帧肢体数量与参考角色一致，手臂和手相连，旧姿势没有残留',
    '每帧的脸、发型、服装和饰物保持角色一致性',
    '已试播动作，姿势衔接和脚底位置合理，没有裁切',
  ];
  return (
    <section className="frame-review" aria-label="动画逐帧验收">
      <div className="frame-review-heading">
        <strong>
          逐帧检查 · {checked.length} / {animation.frames.length}
        </strong>
        <span>选择小图查看原始像素</span>
      </div>
      <p>透明背景和尺寸检查无法判断多出一只手。请对照角色参考，检查全部姿势；肢体数量以该角色为准。</p>
      {failed && <p role="alert">图集无法加载，不能确认动画。</p>}
      {source && (
        <>
          <div className="frame-review-detail">
            <FrameCanvas source={source} animation={animation} index={selected} full />
            <span>
              第 {selected + 1} 帧 · {animation.frames[selected].rect[2]} ×{' '}
              {animation.frames[selected].rect[3]} 像素
            </span>
          </div>
          <div className="frame-review-grid">
            {animation.frames.map((_, index) => (
              <div className={checked.includes(index) ? 'reviewed' : ''} key={index}>
                <button
                  type="button"
                  aria-label={`查看动作帧 ${index + 1}`}
                  aria-pressed={selected === index}
                  onClick={() => setSelected(index)}
                >
                  <FrameCanvas source={source} animation={animation} index={index} />
                  <small>
                    帧 {index + 1} ·{' '}
                    {Object.entries(animation.clips)
                      .filter(([, clip]) => clip?.frames.includes(index))
                      .map(([name]) => name)
                      .join(' / ') || '基准姿势'}
                  </small>
                </button>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    aria-label={`确认动作帧 ${index + 1} 正常`}
                    disabled={disabled}
                    checked={checked.includes(index)}
                    onChange={(event) =>
                      setChecked((old) =>
                        event.target.checked ? [...old, index] : old.filter((n) => n !== index),
                      )
                    }
                  />
                  已核对，形象正常
                </label>
              </div>
            ))}
          </div>
          <div className="generation-checks">
            {labels.map((label, index) => (
              <label className="checkbox-label" key={label}>
                <input
                  type="checkbox"
                  checked={checks[index]}
                  disabled={disabled}
                  onChange={(event) =>
                    setChecks((old) => old.map((v, n) => (n === index ? event.target.checked : v)))
                  }
                />
                {label}
              </label>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
