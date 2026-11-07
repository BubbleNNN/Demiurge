import { ArrowUpRight, MessageCircle, Monitor, Move, Palette, Settings2, X } from 'lucide-react';
import type { ReactNode } from 'react';

interface Props {
  characterName: string;
  skinName?: string;
  desktopAvailable: boolean;
  onOpen: () => void;
  onClose: () => void;
  onAppearance: () => void;
  onSettings: () => void;
  preview: ReactNode;
  size: 'small' | 'medium' | 'large';
  onSize: (size: 'small' | 'medium' | 'large') => void;
}

export function DesktopPage({
  characterName,
  skinName,
  desktopAvailable,
  onOpen,
  onClose,
  onAppearance,
  onSettings,
  preview,
  size,
  onSize,
}: Props) {
  return (
    <section className="desktop-workspace" aria-label="桌宠窗口模块">
      <header className="page-intro">
        <span className="eyebrow">桌宠窗口</span>
        <h1>让陪伴，留在桌面上。</h1>
        <p>窗口位置与互动，在这里单独调整。外观、对话和角色资料沿用当前角色。</p>
      </header>
      <div className="desktop-customizer">
        <div className={`desktop-preview size-${size}`} aria-label="桌宠比例预览">
          <div className="desktop-preview-desk" />
          <div className="desktop-preview-pet">{preview}</div>
          <span>桌面上的{characterName}</span>
        </div>
        <div className="desktop-size-controls">
          <span className="eyebrow">刚刚好的陪伴</span>
          <h2>留一点空间，给日常。</h2>
          <p>人物保持自己的比例。大小调整会同步到已打开的桌宠，脚底位置保持稳定。</p>
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
                <small>{['留在一角', '日常陪伴', '看清细节'][index]}</small>
              </button>
            ))}
          </div>
          <small>悬停显示工具栏 · 点击头部或身体互动 · 拖动改变位置</small>
        </div>
      </div>
      <article className="desktop-launch-card">
        <span className="desktop-module-icon">
          <Monitor size={30} />
        </span>
        <div>
          <h2>{characterName}</h2>
          <p>{skinName || '尚未选择外观'} · 透明置顶窗口</p>
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
      </article>
      {!desktopAvailable && <p className="empty-note">请在桌面开发版中调试原生窗口。</p>}
      <div className="desktop-help-grid">
        <article>
          <Move size={20} />
          <h3>拖到喜欢的位置</h3>
          <p>拖动人物移动窗口；透明区域允许鼠标穿透。</p>
        </article>
        <article>
          <MessageCircle size={20} />
          <h3>在桌面上聊两句</h3>
          <p>人物上方的对话按钮打开小窗口，聊天记录与主窗口同步。</p>
        </article>
        <article>
          <Monitor size={20} />
          <h3>陪伴与休息</h3>
          <p>轻点人物触发本地回应；月亮按钮让角色休息，再点太阳唤醒。</p>
        </article>
      </div>
      <div className="desktop-related-links">
        <button className="text-button" onClick={onAppearance}>
          <Palette size={15} />
          调整外观与动作
          <ArrowUpRight size={13} />
        </button>
        <button className="text-button" onClick={onSettings}>
          <Settings2 size={15} />
          设置桌宠行为
          <ArrowUpRight size={13} />
        </button>
      </div>
    </section>
  );
}
