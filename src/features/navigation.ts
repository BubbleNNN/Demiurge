import { BookOpen, Heart, Layers3, MessageCircle, Monitor, Orbit, Settings2 } from 'lucide-react';
import manifest from '../../shared/features.json';

const icons = {
  home: Heart,
  chat: MessageCircle,
  characters: BookOpen,
  wardrobe: Layers3,
  memories: Orbit,
  desktop: Monitor,
  settings: Settings2,
};
export type AppView = keyof typeof icons;
export const features = manifest.map((feature) => ({
  ...feature,
  id: feature.id as AppView,
  icon: icons[feature.id as AppView],
}));
export function startupView(search: string): AppView {
  const view = new URLSearchParams(search).get('view');
  return features.find((feature) => feature.id === view)?.id || 'home';
}
export function featureTitle(view: AppView): string {
  return features.find((feature) => feature.id === view)!.title;
}
