const LEGACY_TRANSLATION_PROMPT = "Translate naturally and accurately into Korean. Preserve the original meaning, tone, formatting, and line breaks. Output only the translation, without explanations or introductions.";
const DEFAULT_TRANSLATION_PROMPT = "Translate naturally and accurately into the selected language. Preserve the original meaning, tone, formatting, and line breaks. Output only the translation, without explanations or introductions.";

function normalizeTargetLanguage(value) {
  if (typeof value !== 'string') throw new Error('Enter a language, such as English or Japanese.');
  const language = value.trim();
  if (!language || language.length > 60 || !/^[\p{L}\p{M}][\p{L}\p{M}\p{N} ()-]*$/u.test(language)) {
    throw new Error('Enter a language name (up to 60 characters).');
  }
  return ({ko:'Korean',en:'English',ja:'Japanese',zh:'Chinese',es:'Spanish',fr:'French',de:'German'})[language.toLowerCase()] || language;
}
function buildTranslationPrompt(customPrompt, targetLanguage = 'Korean') {
  const language = normalizeTargetLanguage(targetLanguage);
  const instructions = typeof customPrompt === 'string' && customPrompt.trim()
    ? customPrompt.trim() : DEFAULT_TRANSLATION_PROMPT;
  return `Translate the given text to ${language}. The selected target language takes precedence over any language mentioned in the style instructions below.\n\n${instructions}`;
}
module.exports = { DEFAULT_TRANSLATION_PROMPT, LEGACY_TRANSLATION_PROMPT, normalizeTargetLanguage, buildTranslationPrompt };
