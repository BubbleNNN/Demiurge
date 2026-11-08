import type { ReactNode } from 'react';
import { ArrowLeft, BookOpen, Heart, Shirt } from 'lucide-react';
import type { AppView } from '../navigation';

export type StudioTab = Extract<AppView, 'characters' | 'wardrobe' | 'memories'>;
const tabs: { id: StudioTab; label: string; icon: typeof BookOpen }[] = [
  { id: 'characters', label: '角色档案', icon: BookOpen },
  { id: 'wardrobe', label: '外观与动作', icon: Shirt },
  { id: 'memories', label: '相处记忆', icon: Heart },
];
export const isStudioTab = (view: AppView): view is StudioTab => tabs.some((tab) => tab.id === view);

function BackButton({ name, onBack }: { name: string; onBack: () => void }) {
  return (
    <button className="room-back" onClick={onBack}>
      <ArrowLeft size={17} />
      回到{name}身边
    </button>
  );
}

// Everything about one character — who they are, how they look, what you share — lives here.
export function StudioFrame({
  name,
  work,
  thumbnail,
  tab,
  onTab,
  onBack,
  children,
}: {
  name: string;
  work: string;
  thumbnail: ReactNode;
  tab: StudioTab;
  onTab: (tab: StudioTab) => void;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <section className="page-frame studio-frame">
      <header className="page-frame-header">
        <BackButton name={name} onBack={onBack} />
        <div className="studio-identity">
          <span className="studio-avatar">{thumbnail}</span>
          <div>
            <span className="page-frame-kicker">角色工作室</span>
            <h1>{name}</h1>
            <small>{work || '原创角色'}</small>
          </div>
        </div>
        <div className="studio-tabs" role="tablist" aria-label="角色工作室">
          {tabs.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={tab === item.id}
              className={tab === item.id ? 'active' : ''}
              onClick={() => onTab(item.id)}
            >
              <item.icon size={16} />
              {item.label}
            </button>
          ))}
        </div>
      </header>
      <div className="page-frame-body" role="tabpanel" aria-label={tabs.find((item) => item.id === tab)!.label}>
        {children}
      </div>
    </section>
  );
}

export function SettingsFrame({
  name,
  onBack,
  children,
}: {
  name: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <section className="page-frame settings-frame">
      <header className="page-frame-header">
        <BackButton name={name} onBack={onBack} />
        <div>
          <span className="page-frame-kicker">Demiurge</span>
          <h1>连接与设置</h1>
        </div>
      </header>
      <div className="page-frame-body">{children}</div>
    </section>
  );
}
