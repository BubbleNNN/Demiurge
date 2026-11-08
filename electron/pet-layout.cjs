'use strict';
// The desktop pet window: her figure in the middle, a band above it for what she says and a band
// below it for the controls and the message box. The bands are transparent and let clicks through.
// The band above may hang past the top of the screen, so her head can reach the menu bar (her
// speech then moves below her, see `petRoom`). The band below always stays on screen: the toolbar
// and the message box open in the same place, under her feet, wherever she stands.
const { top, bottom, side, minWidth } = require('../shared/pet-window.json');

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** Figure height in points: a free scale (slider, scrolling or pinching) wins over the preset. */
function figureHeight(size, area, scale) {
  const target =
    Number.isFinite(scale) && scale > 0
      ? Math.round(300 * clamp(scale, 0.45, 2.6))
      : { small: 220, medium: 300, large: 390 }[size] || 300;
  return Math.min(target, Math.max(100, area.height - 24));
}

/** How far the window may hang past each edge of the work area while her figure stays on it. */
function slack(bounds, aspect) {
  const figure = Math.max(0, bounds.height - top - bottom);
  const ratio = Number.isFinite(aspect) ? clamp(aspect, 0.45, 1.6) : 0.75;
  const width = Math.min(bounds.width - 2 * side, figure * ratio);
  return { x: Math.max(side, (bounds.width - width) / 2), top, bottom: 0 };
}

// `beyond`: points her figure may go past the left and right edges (running in from off screen).
function clampPetPosition(x, y, bounds, area, aspect, beyond = 0) {
  const s = slack(bounds, aspect);
  s.x += beyond;
  const range = (value, low, high) => (low > high ? (low + high) / 2 : clamp(value, low, high));
  return {
    x: Math.round(range(x, area.x - s.x, area.x + area.width - bounds.width + s.x)),
    y: Math.round(range(y, area.y - s.top, area.y + area.height - bounds.height + s.bottom)),
  };
}

function petBounds(size, aspect, area, previous, scale) {
  const ratio = Number.isFinite(aspect) ? clamp(aspect, 0.45, 1.6) : 0.75;
  const figure = figureHeight(size, area, scale);
  const width = Math.round(Math.max(minWidth, figure * ratio + 2 * side));
  const height = figure + top + bottom;
  // Resizing keeps her feet where they stand and her centre line; a first window starts with her
  // standing at the bottom right of the screen.
  const x = previous
    ? previous.x + (previous.width - width) / 2
    : area.x + area.width - width / 2 - (figure * ratio) / 2 - 24;
  const y = previous ? previous.y + previous.height - height : area.y + area.height - height;
  return { ...clampPetPosition(x, y, { width, height }, area, ratio), width, height };
}

/** The point her figure is centred on: the window's display is the one nearest to it. */
function figureCentre(bounds) {
  return {
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + top + Math.max(0, bounds.height - top - bottom) / 2),
  };
}

/** Points of each band that are on screen: where her speech and the controls can be shown. */
function petRoom(bounds, area) {
  const figureTop = bounds.y + top,
    figureBottom = bounds.y + bounds.height - bottom;
  return {
    above: Math.round(clamp(figureTop - area.y, 0, top)),
    below: Math.round(clamp(area.y + area.height - figureBottom, 0, bottom)),
  };
}

module.exports = {
  petBounds,
  clampPetPosition,
  figureCentre,
  petRoom,
  bands: { top, bottom, side, minWidth },
};
