import { ArrowUpRight, X } from 'lucide-react';
import type { ReactNode } from 'react';

interface Props {
  characterName: string;
  skinName?: string;
  desktopAvailable: boolean;
  autonomous?: boolean;
  onAutonomous: (enabled:boolean)=>void;
  onOpen: () => void;
  onClose: () => void;
  preview: ReactNode;
  size: 'small' | 'medium' | 'large';
  onSize: (size: 'small' | 'medium' | 'large') => void;
}

// The desktop pet is one switch plus a size; how it behaves is shown on hover in the pet itself.
export function DesktopPage({
  characterName,
  skinName,
  desktopAvailable,
  autonomous,onAutonomous,
  onOpen,
  onClose,
  preview,
  size,
  onSize,
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
          {characterName} · {skinName || '尚未选择外观'}。拖动人物移动位置，悬停显示工具栏。
        </p>
        <label><input type="checkbox" checked={autonomous!==false} onChange={e=>onAutonomous(e.target.checked)}/> 自主探索桌面与寻找活动位置</label><p className="fine-print">桌宠悬停工具栏的 ⌖ 可立即探索。跑动和被拎起需要先制作对应动作；旧外观仍可使用。</p>
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
