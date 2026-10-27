const openaiModelSelect = document.getElementById("openaiModel");
const openaiModelHint = document.getElementById("openaiModelHint");
const codexStatusEl = document.getElementById("codexStatus");
const openaiLoginBtn = document.getElementById("openaiLoginBtn");
const accessibilityHint = document.getElementById("accessibilityHint");
const accessibilityBtn = document.getElementById("accessibilityBtn");
const statusEl = document.getElementById("status");
const promptInput = document.getElementById("translationPrompt");
const promptStatus = document.getElementById("promptStatus");
const targetLanguageInput = document.getElementById("targetLanguage");
let defaultPrompt = "";
function updateVariableHint() {
  document.getElementById("promptVariableValue").textContent = " → " + (targetLanguageInput.value.trim() || "Language");
}


function showSaved() {
  statusEl.textContent = "Saved";
  clearTimeout(showSaved._timer);
  showSaved._timer = setTimeout(() => { statusEl.textContent = ""; }, 1500);
}
function refreshAccessibilityStatus(accessibility) {
  accessibilityHint.hidden = accessibility?.trusted && accessibility?.mode === "command-cc";
}
async function loadSettings() {
  try {
    const settings = await window.api.getSettings();
    targetLanguageInput.value = settings.targetLanguage || "Korean";
    updateVariableHint();
    defaultPrompt = settings.defaultTranslationPrompt;
    promptInput.value = settings.translationPrompt || defaultPrompt;
    window.renderPromptHighlight?.();
    refreshAccessibilityStatus(settings.accessibility);
    await Promise.all([loadOpenAIModels(settings.openaiModel || ""), updateCodexStatus()]);
  } catch { statusEl.textContent = "Could not load settings."; }
}
async function savePrompt(value, closeAfterSave = false) {
  try {
    const result = await window.api.saveSettings({ translationPrompt: value, ...(closeAfterSave ? { targetLanguage: targetLanguageInput.value } : {}) });
    if (result.error) throw new Error(result.error);
    promptInput.value = value.trim() || defaultPrompt;
    window.renderPromptHighlight?.();
    promptStatus.textContent = "Saved. Applies to the next translation.";
    if (closeAfterSave) window.api.closeSettings();
  } catch (err) { promptStatus.textContent = "Could not save: " + err.message; }
}
targetLanguageInput.addEventListener("input", () => { updateVariableHint(); promptStatus.textContent = "Unsaved changes"; });
promptInput.addEventListener("input", () => { promptStatus.textContent = "Unsaved changes"; });
document.getElementById("savePrompt").addEventListener("click", () => savePrompt(promptInput.value, true));
document.getElementById("resetPrompt").addEventListener("click", () => savePrompt(defaultPrompt));
accessibilityBtn.addEventListener("click", () => window.api.openAccessibilitySettings());
window.addEventListener("focus", async () => {
  const settings = await window.api.getSettings();
  refreshAccessibilityStatus(settings.accessibility);
});
loadSettings();

// Populates the ChatGPT Model dropdown from the live catalog for this
// account (see translate.js listOpenAIModels — the hardcoded model IDs this
// used to ship with keep going stale as OpenAI retires/renames models).
async function loadOpenAIModels(selectedSlug) {
  if (selectedSlug) {
    const saved = document.createElement("option");
    saved.value = selectedSlug;
    saved.textContent = selectedSlug;
    openaiModelSelect.replaceChildren(saved);
  }
  openaiModelHint.textContent = "Loading…";
  try {
    const result = await window.api.getOpenAIModels();
    if (result.error) throw new Error(result.error);
    const models = result.models || [];

    openaiModelSelect.innerHTML = "";
    for (const m of models) {
      const opt = document.createElement("option");
      opt.value = m.slug;
      opt.textContent = m.displayName;
      opt.title = m.description;
      openaiModelSelect.appendChild(opt);
    }

    // A previously-saved model no longer in the live catalog (renamed or
    // retired, like gpt-5.4-mini was) can't actually be used — fall back to
    // the first available model instead of reproducing the same 400.
    const stillValid = selectedSlug && models.some((m) => m.slug === selectedSlug);
    const nextSlug = stillValid ? selectedSlug : models[0]?.slug || "";

    openaiModelSelect.value = nextSlug;
    if (nextSlug && nextSlug !== selectedSlug) {
      await window.api.saveSettings({ openaiModel: nextSlug });
    }
    openaiModelHint.textContent = "";
  } catch (err) {
    openaiModelHint.textContent = "Couldn't load model list: " + err.message;
    openaiModelSelect.innerHTML = "";
    if (selectedSlug) {
      const opt = document.createElement("option");
      opt.value = selectedSlug;
      opt.textContent = selectedSlug;
      openaiModelSelect.appendChild(opt);
    }
  }
}

openaiModelSelect.addEventListener("change", async () => {
  await window.api.saveSettings({ openaiModel: openaiModelSelect.value });
  showSaved();
});

async function updateCodexStatus() {
  try {
    const status = await window.api.getCodexStatus();
    codexStatusEl.textContent = status.authorized ? "Connected" : "Not connected";
    codexStatusEl.className = "codex-status " + (status.authorized ? "ok" : "err");
    openaiLoginBtn.textContent = status.authorized ? "Reconnect" : "Sign in";
  } catch {
    codexStatusEl.textContent = "Connection unavailable";
    codexStatusEl.className = "codex-status err";
  }
}

openaiLoginBtn.addEventListener("click", async () => {
  openaiLoginBtn.disabled = true;
  openaiLoginBtn.textContent = "Opening…";
  codexStatusEl.textContent = "Finish signing in in your browser.";
  codexStatusEl.className = "codex-status";

  try {
    const result = await window.api.loginOpenAI();
    if (result.error) {
      codexStatusEl.textContent = "Error: " + result.error;
      codexStatusEl.className = "codex-status err";
    } else {
      loadOpenAIModels(openaiModelSelect.value);
    }
  } catch {
    codexStatusEl.textContent = "Sign-in failed";
    codexStatusEl.className = "codex-status err";
  } finally {
    openaiLoginBtn.disabled = false;
    await updateCodexStatus();
  }
});

setInterval(async () => {
  try { refreshAccessibilityStatus((await window.api.getSettings()).accessibility); } catch {}
}, 2000);

// Observe content rather than the viewport so the window can shrink as well as grow.
let settingsResizeFrame;
const settingsContent = document.querySelector(".settings");
new ResizeObserver(() => {
  cancelAnimationFrame(settingsResizeFrame);
  settingsResizeFrame = requestAnimationFrame(() => {
    const style = getComputedStyle(document.body);
    const height = settingsContent.getBoundingClientRect().height
      + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    window.api.resizeSettings(height);
  });
}).observe(settingsContent);
