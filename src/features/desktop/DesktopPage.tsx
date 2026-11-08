import { ArrowUpRight, X } from 'lucide-react';
import type { ReactNode } from 'react';

interface Props {
  characterName: string;
  skinName?: string;
  desktopAvailable: boolean;
  autonomous?: boolean;
  onAutonomous: (enabled: boolean) => void;
  onOpen: () => void;
  onClose: () => void;
  preview: ReactNode;
  size: 'small' | 'medium' | 'large';
  onSize: (size: 'small' | 'medium' | 'large') => void;
  /** Free size, as a multiple of the medium size. */
  scale: number;
  onScale: (scale: number) => void;
}

// The desktop pet is one switch plus a size; how it behaves is shown on hover in the pet itself.
export function DesktopPage({
  characterName,
  skinName,
  desktopAvailable,
  autonomous,
  onAutonomous,
  onOpen,
  onClose,
  preview,
  size,
  onSize,
  scale,
  onScale,
}: Props) {
  return (
    <section className="desktop-workspace settings-card" aria-label="桌宠窗口模块">
      <div className={`desktop-preview size-${size}`} aria-label="桌宠比例预览">
        <div className="desktop-preview-desk" />
        <div className="desktop-preview-pet">{preview}</div>
      </div>
      <div className="desktop-size-controls">
        <h2>桌面陪伴</h2>
        <p>
          {characterName} · {skinName || '尚未选择外观'}
          。可以把她拖到屏幕上任何地方，她会待在那里；把鼠标移到她脚下会出现工具栏，点其中的对话按钮就能直接和她说话。
        </p>
        <label>
          <input
            type="checkbox"
            checked={autonomous !== false}
            onChange={(e) => onAutonomous(e.target.checked)}
          />{' '}
          自主探索桌面与寻找活动位置
        </label>
        <p className="fine-print">
          工具栏里的指南针可让她立即去探索。刚被你放下后，她会在原地待几分钟再自己走动。跑动和被拎起需要先制作对应动作；旧外观仍可使用。
        </p>
        <div className="pet-size-options" role="group" aria-label="桌宠大小">
          {(['small', 'medium', 'large'] as const).map((value, index) => (
            <button
              key={value}
              aria-pressed={size === value}
              className={size === value ? 'selected' : ''}
              onClick={() => onSize(value)}
            >
              <i className={value} />
              <strong>{['轻巧', '适中', '醒目'][index]}</strong>
            </button>
          ))}
        </div>
        <label className="pet-scale-control">
          自由调整大小 <span>{Math.round(scale * 100)}%</span>
          <input
            type="range"
            min="0.45"
            max="2.6"
            step="0.05"
            value={scale}
            aria-label="桌宠大小"
            onChange={(e) => onScale(Number(e.target.value))}
          />
        </label>
        <p className="fine-print">
          桌宠工具栏里也有同样的大小滑块；把鼠标放在她身上滚动滚轮，或在触控板上捏合，也能放大缩小。
        </p>
        <div className="toolbar">
          <button className="button primary" disabled={!desktopAvailable || !skinName} onClick={onOpen}>
            打开桌宠
            <ArrowUpRight size={15} />
          </button>
          <button className="button secondary" disabled={!desktopAvailable} onClick={onClose}>
            <X size={14} />
            收起桌宠
          </button>
        </div>
        {!desktopAvailable && <p className="fine-print">请在桌面版中打开原生窗口。</p>}
      </div>
    </section>
  );
}
