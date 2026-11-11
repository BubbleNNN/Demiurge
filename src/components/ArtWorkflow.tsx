import { useEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, Film, Layers3, Box, ImagePlus } from 'lucide-react';
import guides from '../../shared/art-styles.json';
import { styles, styleName } from '../theme';
import { bridge } from '../bridge';
import { Modal } from './Modal';
import { AnimationPreview } from './AnimationPreview';
import type { ArtStyle, Character, Skin } from '../types';

export function ArtWorkflow({
  character,
  initialStyle,
  onSaveSkin,
  onClose,
  onBusy,
}: {
  character: Character;
  initialStyle: ArtStyle;
  onSaveSkin: (skin: Skin, activate: boolean) => Promise<void>;
  onClose: () => void;
  onBusy?: (busy: boolean) => void;
}) {
  const [style, setStyle] = useState<ArtStyle>(styles.some(s => s.id === initialStyle) ? initialStyle : 'original');
  const [pending, setPending] = useState<Skin | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    onBusy?.(busy || Boolean(pending));
    return () => onBusy?.(false);
  }, [busy || Boolean(pending), onBusy]);
  const running = useRef(false);
  const preview = useRef<HTMLElement>(null);
  const guide = guides[style as keyof typeof guides];
  useEffect(() => {
    if (!pending) return;
    const frame = requestAnimationFrame(() => preview.current?.scrollIntoView({ block: 'center' }));
    return () => cancelAnimationFrame(frame);
  }, [pending]);
  async function run(task: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作未完成。');
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  async function importAsset(kind: 'frames' | 'sprite' | 'image' | 'live2d' | 'vrm') {
    const skin =
      kind === 'frames'
        ? await bridge.importFrames(character.id, style)
        : kind === 'sprite'
          ? await bridge.importSprite(character.id, style)
          : kind === 'image'
            ? await bridge.importImage(character.id, style)
            : await bridge.importModel(character.id, kind);
    if (skin) setPending({ ...skin, style });
  }
  return (
    <Modal
      title="从素材，做出她的不同模样"
      subtitle="选择画风 → 制作或导入素材 → 试播后保存"
      wide
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="art-workflow">
        <div className="notice">
          <p>
            已有立绘、动画帧或绑定模型，可以直接导入，无需图像 API
            Key。先确认角色长相，再为同一形象制作表情与动作。
          </p>
        </div>
        <div className="art-style-picker" aria-label="素材画风">
          {styles.map((s) => (
            <button
              type="button"
              key={s.id}
              aria-label={`素材画风：${s.name}`}
              aria-pressed={style === s.id}
              disabled={busy || Boolean(pending)}
              onClick={() => setStyle(s.id)}
            >
              <span className="art-style-dot" style={{ background: s.color }} />
              <span>{s.name}</span>
              {style === s.id && <Check size={14} />}
            </button>
          ))}
        </div>
        <section className="art-style-brief" aria-label="画风制作说明">
          <span className="page-kicker">{styleName(style)} · 制作说明</span>
          <h3>让造型、材质与动作一起改变</h3>
          <dl>
            <div>
              <dt>造型</dt>
              <dd>{guide.shape}</dd>
            </div>
            <div>
              <dt>材质</dt>
              <dd>{guide.surface}</dd>
            </div>
            <div>
              <dt>画布</dt>
              <dd>{guide.canvas}</dd>
            </div>
            <div>
              <dt>动作</dt>
              <dd>{guide.motion}</dd>
            </div>
          </dl>
          <div className="toolbar">
            {guide.url && (
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await bridge.openExternal(guide.url);
                  })
                }
              >
                <ExternalLink size={15} />
                查看 {guide.tool}
              </button>
            )}
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await bridge.copyText(
                    [
                      `角色：${character.name}（${character.work}）`,
                      `原角色外貌：${character.appearance || '请直接查看附上的原始角色参考图。'}`,
                      '请同时附上原始参考图片。文字说明不替代图片；保留发型、服装结构、配色关系与标志性饰物。',
                      `目标画风：${styleName(style)}`,
                      `造型：${guide.shape}`,
                      `材质：${guide.surface}`,
                      `画布：${guide.canvas}`,
                      `动作路线：${guide.motion}`,
                      guide.prompt,
                      '先交付单角色透明底基准，再用确认后的同一基准制作动作；固定镜头、角色比例与脚底线。每个手势包含起势、最大姿势与收势；禁止用整张图摇晃代替肢体动作。',
                    ].join('\n\n'),
                  );
                  setNotice('制作说明已复制。使用外部绘图工具时，请同时提供原始角色参考图。');
                })
              }
            >
              <Copy size={15} />
              复制角色制作说明
            </button>
          </div>
        </section>
        <ol className="art-production-steps">
          <li>
            <strong>确认基准形象</strong>
            <span>对照原图检查发型、脸、衣服与饰物。不同画风各自确认一张基准。</span>
          </li>
          <li>
            <strong>制作完整动作</strong>
            <span>使用同一基准绘制关键姿势、补帧或绑定模型；保持画布与脚底位置一致。</span>
          </li>
          <li>
            <strong>试播与聊天映射</strong>
            <span>导入后逐项查看表情与动作；聊天只触发素材中实际存在的动作。</span>
          </li>
        </ol>
        {!pending ? (
          <>
            <div className="engine-grid art-import-grid" aria-label="选择素材格式">
              <button
                aria-label="PNG 动作文件夹"
                disabled={busy}
                onClick={() => void run(() => importAsset('frames'))}
              >
                <Film />
                <strong>PNG 动作文件夹</strong>
                <span>Krita、渲染或动画服务导出的帧</span>
              </button>
              <button
                aria-label="Aseprite / Demiurge 图集"
                disabled={busy}
                onClick={() => void run(() => importAsset('sprite'))}
              >
                <Film />
                <strong>Aseprite / Demiurge 图集</strong>
                <span>已有 PNG 图集与动作 JSON</span>
              </button>
              <button
                aria-label="已绑定 Live2D"
                disabled={busy}
                onClick={() => void run(() => importAsset('live2d'))}
              >
                <Layers3 />
                <strong>已绑定 Live2D</strong>
                <span>model3.json 或 ZIP 模型包</span>
              </button>
              <button
                aria-label="真实 VRM 模型"
                disabled={busy}
                onClick={() => void run(() => importAsset('vrm'))}
              >
                <Box />
                <strong>真实 VRM 模型</strong>
                <span>骨骼、表情与真实三维形体</span>
              </button>
              <button
                aria-label="先导入一张立绘"
                disabled={busy}
                onClick={() => void run(() => importAsset('image'))}
              >
                <ImagePlus />
                <strong>先导入一张立绘</strong>
                <span>保存基准外观，稍后制作动作</span>
              </button>
            </div>
            <details className="art-folder-guide">
              <summary>PNG 文件夹怎么准备？</summary>
              <p>
                选择包含动作子文件夹的角色目录。idle 必须存在；其他动作按需添加。每个文件夹中的 PNG
                按文件名数字顺序播放，默认每帧 100 毫秒。
              </p>
              <pre>
                {
                  '角色素材/\n  idle/001.png, 002.png\n  wave/001.png, 002.png, 003.png\n  blink/001.png, 002.png\n  talk/001.png, 002.png\n  happy/001.png\n  pet.json（可选）'
                }
              </pre>
              <p>
                还支持
                nod、shake、bounce、sleep、neutral、thinking、sad、sleepy、surprised。保留相同尺寸的完整透明画布与脚底位置。总计最多
                256 帧、32 MiB；像素画使用最近邻，其他画风使用平滑显示。
              </p>
              <pre>
                {
                  '{ "name": "角色原作动画", "frameDuration": 100, "clips": { "wave": { "durations": [100, 200, 100], "loop": false } } }'
                }
              </pre>
            </details>
          </>
        ) : (
          <section ref={preview} className="art-import-preview" aria-label="导入素材预览">
            <h3>
              {pending.name} · {styleName(pending.style)}
            </h3>
            <AnimationPreview key={pending.id} skin={pending} />
            <div className="toolbar">
              <button
                className="button primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await onSaveSkin(pending, true);
                    onClose();
                  })
                }
              >
                保存并使用此外观
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await onSaveSkin(pending, false);
                    onClose();
                  })
                }
              >
                保存到衣橱
              </button>
              <button className="text-button" disabled={busy} onClick={() => setPending(null)}>
                重新选择素材
              </button>
            </div>
          </section>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="fine-print" role="status">
            {notice}
          </p>
        )}
      </div>
    </Modal>
  );
}
