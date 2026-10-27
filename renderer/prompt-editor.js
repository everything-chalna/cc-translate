// Keep the native textarea for selection, undo, IME and plain-text clipboard handling.
// A matching display layer highlights variables without changing the stored prompt.
(() => {
  const input = document.getElementById('translationPrompt');
  const highlight = document.getElementById('promptHighlight');
  const token = '{targetLanguage}';
  function syncScroll() {
    highlight.scrollTop = input.scrollTop;
    highlight.scrollLeft = input.scrollLeft;
  }
  window.renderPromptHighlight = () => {
    const fragment = document.createDocumentFragment();
    const parts = input.value.split(token);
    parts.forEach((part, index) => {
      if (index) {
        const code = document.createElement('code');
        code.textContent = token;
        fragment.append(code);
      }
      fragment.append(document.createTextNode(part));
    });
    fragment.append(document.createTextNode('\u200b'));
    highlight.replaceChildren(fragment);
    syncScroll();
  };
  input.addEventListener('input', window.renderPromptHighlight);
  input.addEventListener('scroll', syncScroll);
  new ResizeObserver(syncScroll).observe(input);
  window.renderPromptHighlight();
})();
