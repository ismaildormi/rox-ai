'use strict';

const ALLOWED_LANGUAGES = ['auto', 'ar', 'fr', 'en', 'es'];
const ALLOWED_LENGTHS = ['concise', 'balanced', 'detailed'];
const ALLOWED_TONES = ['natural', 'professional', 'creative'];

function normalizeAiPreferences(value = {}) {
  const source =
    value &&
    typeof value === 'object' &&
    !Array.isArray(value)
      ? value
      : {};

  return {
    language: ALLOWED_LANGUAGES.includes(source.language)
      ? source.language
      : 'auto',

    length: ALLOWED_LENGTHS.includes(source.length)
      ? source.length
      : 'balanced',

    tone: ALLOWED_TONES.includes(source.tone)
      ? source.tone
      : 'natural',
  };
}

function buildTextPreferencePrompt(aiPreferences = {}) {
  const preferences = normalizeAiPreferences(aiPreferences);

  const languageInstructions = {
    auto:
      'Match the language and dialect of the latest user message. When the user writes Moroccan Darija, answer naturally in Moroccan Darija.',

    ar:
      'Answer entirely in Arabic regardless of the language used by the user.',

    fr:
      'Answer entirely in clear natural French regardless of the language used by the user.',

    en:
      'Answer entirely in clear natural English regardless of the language used by the user. Do not answer in Arabic, French, or Spanish unless explicitly requested.',

    es:
      'Answer entirely in clear natural Spanish regardless of the language used by the user.',
  };

  const lengthInstructions = {
    concise:
      'Keep normal answers concise, focused, and usually under 80 words. Provide complete code when code is requested.',

    balanced:
      'Give a balanced answer with enough useful explanation and no unnecessary repetition.',

    detailed:
      'Give a thorough and detailed answer with steps and examples when relevant.',
  };

  const toneInstructions = {
    natural:
      'Use a natural, friendly, and direct tone.',

    professional:
      'Use a polished, professional, and precise tone. Avoid slang and unnecessary emojis.',

    creative:
      'Use an engaging and imaginative tone while remaining accurate.',
  };

  return [
    languageInstructions[preferences.language],
    lengthInstructions[preferences.length],
    toneInstructions[preferences.tone],
    'These selected preferences override automatic language detection.',
  ].join(' ');
}

function buildGenerationPrompt(
  prompt,
  aiPreferences = {},
  feature = 'image'
) {
  const preferences = normalizeAiPreferences(aiPreferences);
  const featureName = feature === 'video' ? 'video' : 'image';

  const languageInstructions = {
    auto:
      'Use the language of the original prompt for any visible text, captions, dialogue, or narration.',

    ar:
      'Any visible text, captions, dialogue, or narration must be in Arabic.',

    fr:
      'Any visible text, captions, dialogue, or narration must be in French.',

    en:
      'Any visible text, captions, dialogue, or narration must be in English.',

    es:
      'Any visible text, captions, dialogue, or narration must be in Spanish.',
  };

  const lengthInstructions = {
    concise:
      'Keep visible text, dialogue, captions, and narration concise.',

    balanced:
      'Keep visible text, dialogue, captions, and narration balanced and clear.',

    detailed:
      'Use richer detail in the scene, captions, dialogue, or narration when appropriate.',
  };

  const toneInstructions = {
    natural:
      'Use a natural and realistic style.',

    professional:
      'Use a polished and professional style.',

    creative:
      'Use a creative, distinctive, and visually engaging style.',
  };

  return [
    String(prompt || '').trim(),
    '',
    `[ROX preferences for this ${featureName}]`,
    languageInstructions[preferences.language],
    lengthInstructions[preferences.length],
    toneInstructions[preferences.tone],
  ].join('\n');
}

module.exports = {
  normalizeAiPreferences,
  buildTextPreferencePrompt,
  buildGenerationPrompt,
};