import { getLanguagesText } from "../data/languages.js";

export const languagesResource = {
  uri: "scriptivox://languages",
  name: "Scriptivox Supported Languages",
  description:
    "Full list of 98+ supported transcription languages with ISO codes",
  mimeType: "text/plain",
};

export function handleLanguagesResource() {
  return {
    contents: [
      {
        uri: languagesResource.uri,
        mimeType: languagesResource.mimeType,
        text: getLanguagesText(),
      },
    ],
  };
}
