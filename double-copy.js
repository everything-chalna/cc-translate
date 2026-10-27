const { systemPreferences, shell, screen } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
let child = null;
let callback = null;
let retryTimer = null;
let mode = null;
function isAccessibilityTrusted() {
  return process.platform === 'darwin' && systemPreferences.isTrustedAccessibilityClient(false);
}
function requestAccessibilityAccess() {
  systemPreferences.isTrustedAccessibilityClient(true);
  return shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
}
function syncMode() {
  if (!callback || child || !isAccessibilityTrusted()) return;
  const worker = spawn(path.join(__dirname, 'native/selection-shortcut'), [], { stdio: ['ignore', 'pipe', 'pipe'] });
  child = worker;
  worker.stdout.setEncoding?.('utf8');
  let buffer = '';
  worker.stdout.on('data', chunk => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (event.type === 'ready') mode = 'command-cc';
      if (event.type === 'selection' && event.text?.trim()) callback?.(event.text, screen.getCursorScreenPoint());
      if (event.type === 'error') callback?.('', screen.getCursorScreenPoint(), event.message);
    }
  });
  worker.stderr.on('data', () => {});
  worker.on('error', () => { if (child === worker) { child = null; mode = null; } });
  worker.on('exit', () => { if (child === worker) { child = null; mode = null; } });
}
function start(fn) {
  stop();
  callback = fn;
  syncMode();
  retryTimer = setInterval(syncMode, 2000);
}
function stop() {
  callback = null;
  clearInterval(retryTimer);
  retryTimer = null;
  if (child) child.kill();
  child = null;
  mode = null;
}
module.exports = { start, stop, syncMode, isAccessibilityTrusted, requestAccessibilityAccess,
  getMode: () => mode };
