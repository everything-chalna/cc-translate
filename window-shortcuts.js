// Handle window closing before a focused text field consumes the shortcut.
function bindCloseShortcut(window, close) {
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.key?.toLowerCase() !== 'w') return;
    if (!(input.control || input.meta) || input.alt || input.shift) return;
    event.preventDefault();
    close();
  });
}
module.exports = { bindCloseShortcut };
