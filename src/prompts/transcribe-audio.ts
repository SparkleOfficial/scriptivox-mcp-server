export const transcribeAudioPrompt = {
  name: "transcribe-audio",
  description:
    "Transcribe audio or video from a URL. Paste a link and get the full transcript with optional speaker identification.",
  arguments: [
    {
      name: "url",
      description: "Public URL to the audio or video file",
      required: true,
    },
    {
      name: "language",
      description:
        'ISO 639-1 language code (e.g. "en", "es"). Omit for auto-detection.',
      required: false,
    },
    {
      name: "diarize",
      description:
        'Set to "true" to enable speaker identification. Default: false.',
      required: false,
    },
  ],
};

export function handleTranscribeAudioPrompt(args: {
  url: string;
  language?: string;
  diarize?: string;
}) {
  const diarize = args.diarize === "true";
  let instruction = `Please transcribe the audio/video at this URL: ${args.url}`;
  if (args.language) {
    instruction += `\nLanguage: ${args.language}`;
  }
  if (diarize) {
    instruction += `\nPlease identify different speakers in the transcription.`;
  }
  instruction += `\n\nUse the transcribe_url tool to perform the transcription.`;

  return {
    messages: [
      {
        role: "user" as const,
        content: { type: "text" as const, text: instruction },
      },
    ],
  };
}
