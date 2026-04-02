export const meetingNotesPrompt = {
  name: "meeting-notes",
  description:
    "Transcribe a meeting recording and generate structured meeting notes with action items, key decisions, and speaker attribution.",
  arguments: [
    {
      name: "url",
      description: "Public URL to the meeting recording",
      required: true,
    },
  ],
};

export function handleMeetingNotesPrompt(args: { url: string }) {
  return {
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Please transcribe this meeting recording and generate structured meeting notes.

Meeting recording URL: ${args.url}

Steps:
1. Use the transcription_url tool with diarize=true to transcribe the recording with speaker identification
2. Once you have the transcript, organize it into structured meeting notes with:
   - Meeting summary (2-3 sentences)
   - Key decisions made
   - Action items (with assigned person if identifiable)
   - Discussion topics covered
   - Full transcript with speaker labels

Use the transcription_url tool now to start the transcription.`,
        },
      },
    ],
  };
}
