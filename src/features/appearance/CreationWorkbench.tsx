import type { ReactNode } from 'react';
import { Modal, InlineModalContext } from '../../components/Modal';

export type CreationSection = 'create' | 'expressions' | 'assets' | 'model' | 'packs' | 'pixel';

export function CreationWorkbench({ section, busy, name, onSection, onClose, children }: {
  section: CreationSection;
  busy: boolean;
  name: string;
  onSection: (section: CreationSection) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const tools = ['assets', 'model', 'packs', 'pixel'].includes(section);
  return <Modal title={`${name} · 桌宠工作台`} subtitle="从角色形象到桌面陪伴，在这里制作、核对和使用。" wide onClose={onClose}>
    <nav className="creation-navigation" aria-label="桌宠工作台导航">
      {([
        ['create', '制作与任务'],
        ['expressions', '已有形象与表情'],
        ['assets', '导入与工具'],
      ] as const).map(([value, label]) => <button key={value} type="button"
        aria-current={(value === 'assets' ? tools : section === value) ? 'page' : undefined}
        disabled={busy} onClick={() => onSection(value)}>{label}</button>)}
    </nav>
    {tools && <nav className="creation-tool-navigation" aria-label="工作台工具">
      {([
        ['assets', '导入素材'], ['packs', '角色包与互动'],
        ['model', '3D 模型'], ['pixel', '绘图实验'],
      ] as const).map(([value, label]) => <button type="button" className="text-button" key={value}
        aria-current={section === value ? 'page' : undefined} disabled={busy}
        onClick={() => onSection(value)}>{label}</button>)}
    </nav>}
    {busy && <p className="fine-print" role="status">请先完成当前操作或保存素材，再切换工作台页面。</p>}
    <div className="creation-content" key={section}>
      <InlineModalContext.Provider value={true}>{children}</InlineModalContext.Provider>
    </div>
  </Modal>;
}
