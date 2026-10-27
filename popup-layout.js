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
module.exports = { popupWidth, popupBounds };
