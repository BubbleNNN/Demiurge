'use strict';
// Figure height in points: a free scale (from scrolling or pinching on the pet) wins over the preset.
function petBounds(size, aspect, area, previous, scale) {
  const target =
    Number.isFinite(scale) && scale > 0
      ? Math.round(300 * Math.max(0.45, Math.min(2.6, scale)))
      : { small: 220, medium: 300, large: 390 }[size] || 300;
  const ratio = Number.isFinite(aspect) ? Math.max(0.45, Math.min(1.6, aspect)) : 0.75;
  const figure = Math.min(target, Math.max(100, area.height - 156));
  const width = Math.round(Math.min(area.width - 16, Math.max(280, figure * ratio + 32)));
  const height = Math.round(Math.min(area.height - 16, figure + 132));
  const x = previous ? previous.x + (previous.width - width) / 2 : area.x + area.width - width - 20;
  const y = previous ? previous.y + previous.height - height : area.y + area.height - height - 16;
  return {
    x: Math.round(Math.max(area.x, Math.min(area.x + area.width - width, x))),
    y: Math.round(Math.max(area.y, Math.min(area.y + area.height - height, y))),
    width,
    height,
  };
}
function clampPetPosition(x, y, bounds, area) {
  return {
    x: Math.round(Math.max(area.x, Math.min(area.x + area.width - bounds.width, x))),
    y: Math.round(Math.max(area.y, Math.min(area.y + area.height - bounds.height, y))),
  };
}
module.exports = { petBounds, clampPetPosition };
