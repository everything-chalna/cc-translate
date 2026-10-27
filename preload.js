const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  platform: process.platform,

  // Translation
  translate: (text, targetLang) =>
    ipcRenderer.invoke("translate", text, targetLang),

  // Settings
  resizeSettings: (height) => ipcRenderer.send("resize-settings", height),
  closeSettings: () => ipcRenderer.send("close-settings"),
  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (settings) => ipcRenderer.invoke("save-settings", settings),
  getCodexStatus: () => ipcRenderer.invoke("get-codex-status"),
  loginOpenAI: () => ipcRenderer.invoke("openai-login"),
  getOpenAIModels: () => ipcRenderer.invoke("get-openai-models"),
  openAccessibilitySettings: () => ipcRenderer.invoke("open-accessibility-settings"),

  // Popup actions
  copyToClipboard: (text) => ipcRenderer.invoke("copy-to-clipboard", text),
  resizePopup: (height) => ipcRenderer.send("resize-popup", height),
  setBusy: (busy) => ipcRenderer.send("popup-busy", busy),
  closePopup: () => ipcRenderer.send("close-popup"),

  // Events from main process
  onTranslationRequest: (callback) =>
    ipcRenderer.on("translation-request", (_event, data) => callback(data)),
  onTranslationChunk: (callback) =>
    ipcRenderer.on("translation-chunk", (_event, chunk) => callback(chunk)),
});
