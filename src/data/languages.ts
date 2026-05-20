export interface Language {
  name: string;
  code: string;
}

/**
 * The 119 ISO 639-1 / BCP-47 language codes Scriptivox accepts.
 *
 * Source of truth: `supabase/functions/api-transcribe/index.ts` →
 * `VALID_LANGUAGE_CODES`. If a code isn't in that set, the API will return
 * `400 INVALID_REQUEST` — so this list must stay in sync. When the API adds
 * support for new codes, mirror them here.
 *
 * `jw` (Javanese) is intentionally listed once with code `jw` — that's the
 * code Whisper actually accepts. ISO 639-1 uses `jv` but Whisper's training
 * data uses the older `jw`. The earlier version of this file had `jv`, which
 * the API rejected.
 */
export const SUPPORTED_LANGUAGES: Language[] = [
  { name: "Afrikaans", code: "af" },
  { name: "Albanian", code: "sq" },
  { name: "Amharic", code: "am" },
  { name: "Arabic", code: "ar" },
  { name: "Armenian", code: "hy" },
  { name: "Assamese", code: "as" },
  { name: "Asturian", code: "ast" },
  { name: "Azerbaijani", code: "az" },
  { name: "Bashkir", code: "ba" },
  { name: "Basque", code: "eu" },
  { name: "Belarusian", code: "be" },
  { name: "Bengali", code: "bn" },
  { name: "Bosnian", code: "bs" },
  { name: "Breton", code: "br" },
  { name: "Bulgarian", code: "bg" },
  { name: "Cantonese", code: "yue" },
  { name: "Catalan", code: "ca" },
  { name: "Cebuano", code: "ceb" },
  { name: "Central Kurdish (Sorani)", code: "ckb" },
  { name: "Chinese", code: "zh" },
  { name: "Croatian", code: "hr" },
  { name: "Czech", code: "cs" },
  { name: "Danish", code: "da" },
  { name: "Dutch", code: "nl" },
  { name: "English", code: "en" },
  { name: "Estonian", code: "et" },
  { name: "Faroese", code: "fo" },
  { name: "Finnish", code: "fi" },
  { name: "French", code: "fr" },
  { name: "Fulah", code: "ff" },
  { name: "Galician", code: "gl" },
  { name: "Georgian", code: "ka" },
  { name: "German", code: "de" },
  { name: "Greek", code: "el" },
  { name: "Gujarati", code: "gu" },
  { name: "Haitian Creole", code: "ht" },
  { name: "Hausa", code: "ha" },
  { name: "Hawaiian", code: "haw" },
  { name: "Hebrew", code: "he" },
  { name: "Hindi", code: "hi" },
  { name: "Hungarian", code: "hu" },
  { name: "Icelandic", code: "is" },
  { name: "Igbo", code: "ig" },
  { name: "Indonesian", code: "id" },
  { name: "Irish", code: "ga" },
  { name: "Italian", code: "it" },
  { name: "Japanese", code: "ja" },
  { name: "Javanese", code: "jw" },
  { name: "Kabuverdianu", code: "kea" },
  { name: "Kamba", code: "kam" },
  { name: "Kannada", code: "kn" },
  { name: "Kazakh", code: "kk" },
  { name: "Khmer", code: "km" },
  { name: "Korean", code: "ko" },
  { name: "Kyrgyz", code: "ky" },
  { name: "Lao", code: "lo" },
  { name: "Latin", code: "la" },
  { name: "Latvian", code: "lv" },
  { name: "Lingala", code: "ln" },
  { name: "Lithuanian", code: "lt" },
  { name: "Luganda", code: "lg" },
  { name: "Luo", code: "luo" },
  { name: "Luxembourgish", code: "lb" },
  { name: "Macedonian", code: "mk" },
  { name: "Malagasy", code: "mg" },
  { name: "Malay", code: "ms" },
  { name: "Malayalam", code: "ml" },
  { name: "Maltese", code: "mt" },
  { name: "Maori", code: "mi" },
  { name: "Marathi", code: "mr" },
  { name: "Mongolian", code: "mn" },
  { name: "Myanmar (Burmese)", code: "my" },
  { name: "Nepali", code: "ne" },
  { name: "Northern Sotho", code: "nso" },
  { name: "Norwegian", code: "no" },
  { name: "Nyanja (Chichewa)", code: "ny" },
  { name: "Nynorsk", code: "nn" },
  { name: "Occitan", code: "oc" },
  { name: "Oriya (Odia)", code: "or" },
  { name: "Oromo", code: "om" },
  { name: "Pashto", code: "ps" },
  { name: "Persian", code: "fa" },
  { name: "Polish", code: "pl" },
  { name: "Portuguese", code: "pt" },
  { name: "Punjabi", code: "pa" },
  { name: "Romanian", code: "ro" },
  { name: "Russian", code: "ru" },
  { name: "Sanskrit", code: "sa" },
  { name: "Serbian", code: "sr" },
  { name: "Shona", code: "sn" },
  { name: "Sindhi", code: "sd" },
  { name: "Sinhala", code: "si" },
  { name: "Slovak", code: "sk" },
  { name: "Slovenian", code: "sl" },
  { name: "Somali", code: "so" },
  { name: "Spanish", code: "es" },
  { name: "Sundanese", code: "su" },
  { name: "Swahili", code: "sw" },
  { name: "Swedish", code: "sv" },
  { name: "Tagalog", code: "tl" },
  { name: "Tajik", code: "tg" },
  { name: "Tamil", code: "ta" },
  { name: "Tatar", code: "tt" },
  { name: "Telugu", code: "te" },
  { name: "Thai", code: "th" },
  { name: "Tibetan", code: "bo" },
  { name: "Turkish", code: "tr" },
  { name: "Turkmen", code: "tk" },
  { name: "Ukrainian", code: "uk" },
  { name: "Umbundu", code: "umb" },
  { name: "Urdu", code: "ur" },
  { name: "Uzbek", code: "uz" },
  { name: "Vietnamese", code: "vi" },
  { name: "Welsh", code: "cy" },
  { name: "Wolof", code: "wo" },
  { name: "Xhosa", code: "xh" },
  { name: "Yiddish", code: "yi" },
  { name: "Yoruba", code: "yo" },
  { name: "Zulu", code: "zu" },
];

export function getLanguagesText(): string {
  const header = `Scriptivox Supported Languages (${SUPPORTED_LANGUAGES.length} languages)\n`;
  const separator = "=".repeat(50) + "\n\n";
  const note =
    "Use the ISO code in the `language` parameter when transcribing.\n" +
    "Recommended: always pass `language` explicitly — auto-detect works for\n" +
    "most cases but has a small failure rate on short clips, code-switched\n" +
    "audio, or files starting with music. Passing the language is also faster.\n\n";
  const list = SUPPORTED_LANGUAGES.map(
    (l) => `  ${l.name.padEnd(28)} ${l.code}`
  ).join("\n");

  return header + separator + note + list;
}
