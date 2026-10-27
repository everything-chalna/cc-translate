const DEFAULT_TRANSLATION_PROMPT = "Translate naturally and accurately into Korean. Preserve the original meaning, tone, formatting, and line breaks. Output only the translation, without explanations or introductions.";

function buildTranslationPrompt(customPrompt) {
  const instructions = typeof customPrompt === "string" && customPrompt.trim()
    ? customPrompt.trim() : DEFAULT_TRANSLATION_PROMPT;
  return "Translate the given text to Korean. The output language must always be Korean.\n\n" + instructions;
}
module.exports = { DEFAULT_TRANSLATION_PROMPT, buildTranslationPrompt };
