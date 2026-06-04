export type PracticeMistakeDraft = {
  songId: string;
  measure: number;
  noteIndex: number;
  expectedMidi: number;
  playedMidi: number | null;
  reason: "timeout" | "wrong_pitch";
};

export type SavedPracticeSession = {
  id: string;
  songId: string;
  practicedAt: string;
  totalNotes: number;
  wrongMeasureCount: number;
  wrongNoteCount: number;
  isMastered: boolean;
};
