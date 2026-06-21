export type PracticeNote = {
  index: number;
  measure: number;
  isRest?: boolean;
  step: string;
  alter: number;
  octave: number;
  midi: number;
  durationDivisions: number;
  divisions: number;
  bpm: number;
  beats: number;
  beatType: number;
  startMs: number;
  durationMs: number;
  skipPractice?: boolean;
};
