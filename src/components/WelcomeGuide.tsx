import { X, Monitor, MessageCircle, UserPlus } from 'lucide-react';
export function WelcomeGuide({
  onClose,
  onDesktop,
  onChat,
  onCreate,
}: {
  onClose: () => void;
  onDesktop: () => void;
  onChat: () => void;
  onCreate: () => void;
}) {
  return (
    <aside className="welcome-guide" aria-label="初次使用指南">
      <button className="icon-button welcome-close" aria-label="收起初次使用指南" onClick={onClose}>
        <X size={16} />
      </button>
      <span className="eyebrow">从一点陪伴开始</span>
      <h2>先让她住进桌面。</h2>
      <p>内置大昔涟已经准备好了。日常动作和本地互动，不需要填写 API Key。</p>
      <button onClick={onDesktop}>
        <Monitor size={18} />
        <span>
          体验桌面陪伴<small>点击、拖动，或在头顶轻轻抚摸</small>
        </span>
      </button>
      <button onClick={onChat}>
        <MessageCircle size={18} />
        <span>
          配置自由聊天<small>选择服务商，填写模型与 API Key</small>
        </span>
      </button>
      <button onClick={onCreate}>
        <UserPlus size={18} />
        <span>
          迎接另一个角色<small>导入角色包，或从资料与参考图开始</small>
        </span>
      </button>
      <button className="welcome-dismiss" onClick={onClose}>
        我先自己逛逛
      </button>
    </aside>
  );
}
