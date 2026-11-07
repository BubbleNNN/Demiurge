import packageInfo from '../../package.json';
import { Flower2 } from 'lucide-react';
import { features, type AppView } from './navigation';

interface Props {
  view: AppView;
  onNavigate: (view: AppView) => void;
}

export function FeatureNavigation({ view, onNavigate }: Props) {
  const settings = features.find((feature) => feature.id === 'settings')!;
  return (
    <aside className="icon-rail" aria-label="主要功能">
      <button className="mori-symbol" aria-label="Mori 首页" onClick={() => onNavigate('home')}>
        <Flower2 size={29} />
      </button>
      <nav className="rail-links" aria-label="功能模块">
        {features
          .filter((feature) => feature.id !== 'settings')
          .map((feature) => (
            <button
              key={feature.id}
              title={feature.title}
              aria-label={feature.title}
              aria-current={view === feature.id ? 'page' : undefined}
              className={view === feature.id ? 'active' : ''}
              onClick={() => onNavigate(feature.id)}
            >
              <feature.icon size={20} />
              <span className="rail-label">{feature.label}</span>
              <i className="rail-marker" aria-hidden="true" />
            </button>
          ))}
      </nav>
      <button
        className={`rail-settings ${view === 'settings' ? 'active' : ''}`}
        aria-label={settings.title}
        title={settings.title}
        aria-current={view === 'settings' ? 'page' : undefined}
        onClick={() => onNavigate('settings')}
      >
        <settings.icon size={20} />
        <span className="rail-label">{settings.label}</span>
      </button>
      <span className="rail-version">{packageInfo.version}</span>
    </aside>
  );
}
