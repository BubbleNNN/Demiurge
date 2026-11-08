import manifest from '../../shared/features.json';

// View ids double as deep links (`?view=`, `pnpm desktop --module`). In the Room layout,
// `chat` opens the home screen's history drawer and `desktop` opens settings.
export type AppView = 'home' | 'chat' | 'characters' | 'wardrobe' | 'memories' | 'desktop' | 'settings';
const views = manifest.map((feature) => feature.id as AppView);
export function startupView(search: string): AppView {
  const view = new URLSearchParams(search).get('view');
  return views.find((id) => id === view) || 'home';
}
