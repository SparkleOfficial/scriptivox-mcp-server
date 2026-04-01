import { getApiDocsText } from "../data/api-docs.js";

export const apiDocsResource = {
  uri: "scriptivox://api-docs",
  name: "Scriptivox API Documentation",
  description: "Complete API reference for the Scriptivox transcription API",
  mimeType: "text/plain",
};

export function handleApiDocsResource() {
  return {
    contents: [
      {
        uri: apiDocsResource.uri,
        mimeType: apiDocsResource.mimeType,
        text: getApiDocsText("all"),
      },
    ],
  };
}
