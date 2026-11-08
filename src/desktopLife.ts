// Adapted from Anime Codex (MIT): visible places, bounded travel, and revalidation.
import type { DesktopScene, DesktopRect, PetAction } from './types';
export type Place = {
  kind: 'perch' | 'hide';
  id: string;
  rect: DesktopRect;
  destination: { x: number; y: number };
};
export function choosePlace(
  scene: DesktopScene,
  foot: { x: number; y: number },
  kind: 'read' | 'hide' | 'any',
): Place | null {
  const { area, bounds, surfaces } = scene;
  // The pet window's bands may hang past the top and bottom of the work area.
  const margins = scene.margins || { top: 0, bottom: 0 };
  const fits = (p: { x: number; y: number }) =>
    p.x >= area.x &&
    p.y >= area.y - margins.top &&
    p.x + bounds.width <= area.x + area.width &&
    p.y + bounds.height <= area.y + area.height + margins.bottom;
  if (kind !== 'hide')
    for (let i = 0; i < surfaces.length; i++) {
      const w = surfaces[i];
      for (const fraction of [0.65, 0.35, 0.5]) {
        const x = w.x + w.width * fraction,
          y = w.y;
        if (
          surfaces.slice(0, i).some((f) => x >= f.x && x <= f.x + f.width && y >= f.y && y <= f.y + f.height)
        )
          continue;
        const destination = { x: Math.round(x - foot.x), y: Math.round(y - foot.y) };
        if (fits(destination)) return { kind: 'perch', id: w.id, rect: w, destination };
      }
    }
  if (kind === 'read') return null;
  for (const icon of scene.icons) {
    if (
      surfaces.some(
        (w) =>
          w.x < icon.x + icon.width &&
          w.x + w.width > icon.x &&
          w.y < icon.y + icon.height &&
          w.y + w.height > icon.y,
      )
    )
      continue;
    const destination = {
      x: Math.round(icon.x - foot.x + icon.width * 0.25),
      y: Math.round(icon.y - foot.y + icon.height + 60),
    };
    if (fits(destination)) return { kind: 'hide', id: icon.id, rect: icon, destination };
  }
  return null;
}
export function travelStep(from: DesktopRect, to: { x: number; y: number }, seconds: number) {
  const dx = to.x - from.x,
    dy = to.y - from.y,
    distance = Math.hypot(dx, dy),
    step = 180 * Math.min(0.1, Math.max(0.016, seconds));
  const action: PetAction =
    Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'walk_left' : 'walk_right') : dy < 0 ? 'walk_up' : 'walk_down';
  return {
    x: distance <= step ? to.x : Math.round(from.x + (dx / distance) * step),
    y: distance <= step ? to.y : Math.round(from.y + (dy / distance) * step),
    arrived: distance <= step,
    action,
  };
}
export function placeVisible(place: Place, scene: DesktopScene) {
  const rect = (place.kind === 'hide' ? scene.icons : scene.surfaces).find((x) => x.id === place.id);
  if (!rect) return null;
  const index = scene.surfaces.findIndex((x) => x.id === place.id);
  const occluders = place.kind === 'hide' ? scene.surfaces : scene.surfaces.slice(0, index);
  const x =
    rect.x +
    (place.kind === 'hide' ? rect.width / 2 : place.destination.x - place.rect.x + scene.bounds.width / 2);
  if (occluders.some((w) => x >= w.x && x <= w.x + w.width && rect.y >= w.y && rect.y <= w.y + w.height))
    return null;
  return rect;
}
