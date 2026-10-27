const closeBtn = document.getElementById("closeBtn");
const sourcePreview = document.getElementById("sourcePreview");
const translationArea = document.getElementById("translationArea");
const loading = document.getElementById("loading");
const errorMsg = document.getElementById("errorMsg");
const copyBtn = document.getElementById("copyBtn");
const translateBtn = document.getElementById("translateBtn");

const modeBadge = document.getElementById("modeBadge");

let currentSourceText = "";
let requestId = 0; // guard against stale translation responses


let resizeTimer;
function resizeToContent() {
  if (!window.api.resizePopup) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    translationArea.style.height = "0px";
    translationArea.style.height = Math.max(24, translationArea.scrollHeight) + "px";
    const body = document.querySelector(".body");
    const header = document.querySelector(".header");
    const footer = document.querySelector(".footer");
    window.api.resizePopup(body.scrollHeight + header.offsetHeight + footer.offsetHeight + 2);
  }, 60);
}
translationArea.addEventListener("input", resizeToContent);
window.addEventListener("resize", resizeToContent);

// Listen for translation requests from main process
window.api.onTranslationRequest((data) => {
  currentSourceText = data.text;

  modeBadge.textContent = "ChatGPT";
  modeBadge.className = "mode-badge cloud";

  sourcePreview.textContent =
    currentSourceText.length > 150
      ? currentSourceText.substring(0, 150) + "..."
      : currentSourceText;

  // Reset UI
  translationArea.value = "";
  errorMsg.classList.add("hidden");
  loading.classList.add("hidden");
  translateBtn.classList.remove("hidden");
  translateBtn.textContent = "Translate ▶";

  resizeToContent();

  // Translate the selection received from Command+C+C
  if (data.autoTranslate) {
    startTranslation();
  }
});

// Manual translate button
translateBtn.addEventListener("click", () => {
  startTranslation();
});

// Handle streaming chunks from cloud translation
let streamingForId = 0;
window.api.onTranslationChunk((chunk) => {
  // Only accept chunks for the current request
  if (streamingForId !== requestId) return;

  // Hide loading on first chunk — text is arriving
  if (loading.classList.contains("hidden") === false) {
    loading.classList.add("hidden");
  }
  translationArea.value += chunk;
  resizeToContent();
});

async function startTranslation() {
  if (!currentSourceText) return;

  const id = ++requestId;
  streamingForId = id;

  translateBtn.classList.add("hidden");
  loading.classList.remove("hidden");
  errorMsg.classList.add("hidden");
  translationArea.value = "";
  window.api.setBusy(true);
  resizeToContent();

  try {
    const result = await window.api.translate(
      currentSourceText,
      "ko"
    );

    // Only release busy if this is still the current request
    if (id === requestId) {
      window.api.setBusy(false);
    }

    // Discard stale response if a newer request was made
    if (id !== requestId) return;

    loading.classList.add("hidden");

    if (result.error) {
      if (result.error === "cancelled") return;
      errorMsg.textContent = result.error;
      resizeToContent();
      errorMsg.classList.remove("hidden");
      translateBtn.classList.remove("hidden");
      return;
    }

    // Use the final trimmed result as authoritative.
    translationArea.value = result.translation;
    resizeToContent();

  } catch (err) {
    if (id === requestId) {
      window.api.setBusy(false);
      loading.classList.add("hidden");
      errorMsg.textContent = err.message || "Translation failed";
      resizeToContent();
      errorMsg.classList.remove("hidden");
      translateBtn.classList.remove("hidden");
    }
  }
}

// Button actions
document.getElementById("dismissBtn").addEventListener("click", () => {
  window.api.setBusy(false);
  window.api.closePopup();
});
closeBtn.addEventListener("click", () => {
  window.api.setBusy(false);
  window.api.closePopup();
});

copyBtn.addEventListener("click", async () => {
  const text = translationArea.value;
  if (!text) return;

  try {
    await window.api.copyToClipboard(text);

    copyBtn.textContent = "Copied!";
    copyBtn.classList.add("copied");
    setTimeout(() => {
      copyBtn.textContent = "Copy";
      copyBtn.classList.remove("copied");
    }, 1500);
  } catch {
    errorMsg.textContent = "Failed to copy";
    errorMsg.classList.remove("hidden");
  }
});

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    window.api.setBusy(false);
    window.api.closePopup();
  }
  if (e.key === "Enter" && !e.shiftKey && !translationArea.value) {
    e.preventDefault();
    startTranslation();
  }
});
