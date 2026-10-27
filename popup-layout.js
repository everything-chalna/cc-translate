// Keep content-sized popups inside the current display, including small screens.
function popupWidth(textLength, area) {
  const preferred = textLength < 140 ? 360 : textLength < 700 ? 440 : 520;
  return Math.min(preferred, Math.max(100, area.width - 24));
}
function popupBounds(point, width, requestedHeight, area) {
  const height = Math.min(Math.max(120, Math.ceil(requestedHeight)), Math.min(760, area.height - 24));
  return {
    width, height,
    x: Math.round(Math.max(area.x + 12, Math.min(point.x - width / 2, area.x + area.width - width - 12))),
    y: Math.round(Math.max(area.y + 12, Math.min(point.y + 16, area.y + area.height - height - 12))),
  };
}
// Resize from the current window position, including after a manual drag.
// Only clamp position when the window is outside the current screen's usable area.
function resizedPopupBounds(current, requestedHeight, area) {
  const width = Math.min(current.width, Math.max(100, area.width - 24));
  const minHeight = Math.min(120, area.height - 24);
  const x = Math.round(Math.max(area.x + 12, Math.min(current.x, area.x + area.width - width - 12)));
  const y = Math.round(Math.max(area.y + 12, Math.min(current.y, area.y + area.height - minHeight - 12)));
  const availableHeight = area.y + area.height - y - 12;
  const height = Math.min(Math.max(minHeight, Math.ceil(requestedHeight)), 760, availableHeight);
  return { x, y, width, height };
}
module.exports = { popupWidth, popupBounds, resizedPopupBounds };
