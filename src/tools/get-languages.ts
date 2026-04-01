import { getLanguagesText } from "../data/languages.js";

export const getLanguagesDefinition = {
  name: "get_supported_languages",
  description:
    "List all languages supported by Scriptivox for audio/video transcription. Returns language names and ISO codes. No API key required.",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
};

export function handleGetLanguages() {
  return {
    content: [{ type: "text" as const, text: getLanguagesText() }],
  };
}
