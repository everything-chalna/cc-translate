const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  clipboard,
  screen,
  nativeImage,
  dialog,
  shell,
} = require("electron");
const path = require("path");
const Store = require("electron-store");
const { translateOpenAI, getCodexToken, loginOpenAI, listOpenAIModels } = require("./translate");
const { DEFAULT_TRANSLATION_PROMPT, LEGACY_TRANSLATION_PROMPT, PREVIOUS_TRANSLATION_PROMPT, normalizeTargetLanguage } = require("./translation-prompt");
const doubleCopy = require("./double-copy");
const { popupWidth, popupBounds } = require("./popup-layout");

// ─── Single Instance Lock ───────────────────────────────────────────────────

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

// ─── Store ──────────────────────────────────────────────────────────────────

const POPUP_MIN_WIDTH = 320;
const POPUP_MIN_HEIGHT = 100;

// Preserve settings from installations made before the app was renamed.
app.setPath("userData", path.join(app.getPath("appData"), "translator-widget"));

const store = new Store({
  defaults: {
    openaiModel: "gpt-5.6-luna",
    translationPrompt: DEFAULT_TRANSLATION_PROMPT,
    targetLanguage: "Korean",
  },
});

// Migrate only the old default; preserve custom prompts.
if ([LEGACY_TRANSLATION_PROMPT, PREVIOUS_TRANSLATION_PROMPT].includes(store.get("translationPrompt"))) {
  store.set("translationPrompt", DEFAULT_TRANSLATION_PROMPT);
}

// ─── App State ──────────────────────────────────────────────────────────────

let tray = null;
let popupWindow = null;
let settingsWindow = null;
let popupBusy = false;

// Translation cancellation
let currentTranslationController = null;

// ─── Tray Icon ──────────────────────────────────────────────────────────────

function createTrayIcon() {
  // Lives in assets/, not build/ — electron-builder treats the top-level
  // build/ dir as its own build-time resources (icon.icns, entitlements)
  // and never copies it into the packaged app's Resources/app.
  // @2x variant (assets/trayTemplate@2x.png) is picked up automatically for
  // Retina displays. Regenerate both via `npm run tray-icon`.
  const img = nativeImage.createFromPath(path.join(__dirname, "assets", "trayTemplate.png"));
  img.setTemplateImage(true);
  return img;
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip("CC Translate");

  const contextMenu = Menu.buildFromTemplate([
    { label: "CC Translate", enabled: false },
    { type: "separator" },
    { label: "Settings...", click: () => openSettings() },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);

  tray.setContextMenu(contextMenu);
}

// Resolve the auth state for the current cloud provider. Catches refresh
// failures (e.g. OpenAI's refresh_token_reused, network errors) so they
// don't bubble up as unhandled rejections from the double-copy detector and
// silently swallow the popup trigger.
async function resolveAuth() {
  try {
    return { ok: !!(await getCodexToken()) };
  } catch (err) {
    return { ok: false, error: err };
  }
}

async function onDoubleCopy(text, cursorPoint, error) {
  if (error) { dialog.showErrorBox("CC Translate", error); return; }
  if (!text || !text.trim()) return;

  const auth = await resolveAuth();
  if (!auth.ok) {
    if (auth.error) {
      dialog.showErrorBox(
        "CC Translate: re-sign in required",
        `${auth.error.message || auth.error}\n\nOpening Settings — please re-authenticate.`
      );
    }
    openSettings();
    return;
  }

  showPopup(text, null, true, cursorPoint);
}

// ─── Popup Window ───────────────────────────────────────────────────────────

let popupAnchor = null;
let popupDisplay = null;
function createPopupWindow() {
  const w = 360;
  const h = 150;

  popupWindow = new BrowserWindow({
    width: w,
    height: h,
    minWidth: POPUP_MIN_WIDTH,
    minHeight: POPUP_MIN_HEIGHT,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    vibrancy: "popover",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Follow the user across Spaces / fullscreen apps instead of pulling them
  // back to the Space where the window was last shown.
  popupWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  popupWindow.loadFile(path.join(__dirname, "renderer", "popup.html"));

  // Keep the result visible while content-driven resizing changes focus.
  // Escape or the close button dismisses the card.

}

function showPopup(text, targetLangOverride, autoTranslate, cursorPoint) {
  popupBusy = !!autoTranslate;
  const point = cursorPoint || screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const { workArea } = display;

  if (!popupWindow || popupWindow.isDestroyed()) {
    createPopupWindow();
  }

  popupAnchor = point;
  popupDisplay = workArea;
  popupWindow.setBounds(popupBounds(point, popupWidth(text.length, workArea), 150, workArea));

  const sendRequest = () => {
    const defaultTarget = store.get("targetLanguage");
    popupWindow.webContents.send("translation-request", {
      text,
      targetLang: defaultTarget,
      autoTranslate: !!targetLangOverride || !!autoTranslate,
    });
  };

  if (popupWindow.webContents.isLoading()) {
    popupWindow.webContents.once("did-finish-load", () => {
      popupWindow.show();
      sendRequest();
    });
  } else {
    popupWindow.show();
    sendRequest();
  }
}

// ─── Settings Window ────────────────────────────────────────────────────────

function openSettings() {
  doubleCopy.syncMode();

  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 480,
    height: 574,
    title: "CC Translate Settings",
    resizable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  settingsWindow.loadFile(path.join(__dirname, "renderer", "settings.html"));
  settingsWindow.setMenuBarVisibility(false);

  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

// ─── IPC: Translation (with cancellation + streaming) ───────────────────────

ipcMain.handle("translate", async (_event, text, targetLang) => {
  targetLang = store.get("targetLanguage");

  // Cancel any in-flight cloud translation
  if (currentTranslationController) {
    currentTranslationController.abort();
    currentTranslationController = null;
  }

  // Cloud mode — create AbortController for cancellation
  const controller = new AbortController();
  currentTranslationController = controller;


  // Stream chunks to popup as they arrive
  const sendChunk = (chunk) => {
    if (popupWindow && !popupWindow.isDestroyed()) {
      popupWindow.webContents.send("translation-chunk", chunk);
    }
  };

  try {
    let result;
    const codexToken = await getCodexToken();
    if (!codexToken) {
      currentTranslationController = null;
      return { error: 'Sign in to ChatGPT in Settings.' };
    }
    result = await translateOpenAI(text, codexToken, targetLang, controller.signal, sendChunk, store.get("openaiModel"), store.get("translationPrompt"));
    currentTranslationController = null;
    return result;
  } catch (err) {
    currentTranslationController = null;
    if (controller.signal.aborted) {
      return { error: "cancelled" };
    }
    return { error: err.message || "Translation failed" };
  }
});

// ─── IPC: Settings ──────────────────────────────────────────────────────────

ipcMain.handle("get-settings", () => ({
  translationPrompt: store.get("translationPrompt"),
  defaultTranslationPrompt: DEFAULT_TRANSLATION_PROMPT,
  targetLanguage: store.get("targetLanguage"),
  openaiModel: store.get("openaiModel"),
  accessibility: { trusted: doubleCopy.isAccessibilityTrusted(), mode: doubleCopy.getMode() },
}));

ipcMain.handle("open-accessibility-settings", () => {
  doubleCopy.requestAccessibilityAccess();
  return { success: true };
});

// Fit permission notices and status messages without leaving a blank footer.
ipcMain.on("resize-settings", (event, height) => {
  if (!settingsWindow || settingsWindow.isDestroyed() || event.sender !== settingsWindow.webContents) return;
  if (!Number.isFinite(height)) return;
  const bounds = settingsWindow.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  const [width, contentHeight] = settingsWindow.getContentSize();
  const chromeHeight = bounds.height - contentHeight;
  const nextHeight = Math.min(Math.max(100, Math.ceil(height)), area.height - chromeHeight - 24);
  if (contentHeight !== nextHeight) settingsWindow.setContentSize(width, nextHeight);
  const nextBounds = settingsWindow.getBounds();
  const y = Math.max(area.y, Math.min(nextBounds.y, area.y + area.height - nextBounds.height));
  if (y !== nextBounds.y) settingsWindow.setPosition(nextBounds.x, y);
});

ipcMain.on("close-settings", (event) => {
  if (settingsWindow && !settingsWindow.isDestroyed() && event.sender === settingsWindow.webContents) {
    settingsWindow.close();
  }
});

ipcMain.handle("save-settings", (_event, settings) => {
  if (settings.targetLanguage !== undefined) {
    try { settings.targetLanguage = normalizeTargetLanguage(settings.targetLanguage); }
    catch (err) { return { error: err.message }; }
  }
  if (settings.openaiModel !== undefined) store.set("openaiModel", settings.openaiModel);
  if (settings.translationPrompt !== undefined) {
    if (typeof settings.translationPrompt !== "string" || settings.translationPrompt.length > 20000) {
      return { error: "Keep the translation prompt under 20,000 characters." };
    }
    store.set("translationPrompt", settings.translationPrompt.trim() || DEFAULT_TRANSLATION_PROMPT);
  }
  if (settings.targetLanguage !== undefined) store.set("targetLanguage", settings.targetLanguage);
  return { success: true };
});

// ─── IPC: Codex Auth Status ────────────────────────────────────────────────

ipcMain.handle("get-codex-status", async () => {
  const token = await getCodexToken();
  return { authorized: !!token };
});

ipcMain.handle("get-openai-models", async () => {
  try {
    return { models: await listOpenAIModels() };
  } catch (err) {
    return { error: err.message };
  }
});

// Dedup concurrent login attempts (e.g. a double-click on the button) so we
// don't pop open two browser tabs / bind the callback server twice.
let openaiLoginInProgress = null;

ipcMain.handle("openai-login", async () => {
  if (!openaiLoginInProgress) {
    openaiLoginInProgress = loginOpenAI({ openExternal: (url) => shell.openExternal(url) }).finally(
      () => { openaiLoginInProgress = null; }
    );
  }
  try {
    await openaiLoginInProgress;
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

// ─── IPC: Clipboard & Popup ─────────────────────────────────────────────────

ipcMain.handle("copy-to-clipboard", (_event, text) => {
  clipboard.writeText(text);
  return { success: true };
});

ipcMain.on("resize-popup", (event, height) => {
  if (!popupWindow || popupWindow.isDestroyed() || event.sender !== popupWindow.webContents) return;
  if (!Number.isFinite(height) || !popupAnchor || !popupDisplay) return;
  const width = popupWindow.getBounds().width;
  popupWindow.setBounds(popupBounds(popupAnchor, width, height, popupDisplay));
});

ipcMain.on("popup-busy", (_event, busy) => {
  popupBusy = busy;
});

ipcMain.on("close-popup", () => {
  popupBusy = false;
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.hide();
  }
});

// ─── App Lifecycle ──────────────────────────────────────────────────────────

app.dock?.hide();

app.whenReady().then(async () => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "CC Translate", submenu: [
      { label: "Settings…", accelerator: "Command+,", click: openSettings },
      { type: "separator" }, { role: "quit" },
    ] },
    { role: "editMenu" },
  ]));
  createTray();
  createPopupWindow();
  openSettings();

  doubleCopy.start(onDoubleCopy);

  const auth = await resolveAuth();
  if (!auth.ok) openSettings();

  if (
    process.platform === "darwin" &&
    !doubleCopy.isAccessibilityTrusted()
  ) {
    openSettings();
  }

});

app.on("second-instance", () => { if (app.isReady()) openSettings(); });

app.on("will-quit", () => {
  doubleCopy.stop();
});

app.on("window-all-closed", (e) => {
  e.preventDefault();
});
