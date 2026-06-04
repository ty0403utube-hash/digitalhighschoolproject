const STEP_TO_SEMITONE: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

export function pitchToMidi(step: string, alter: number, octave: number) {
  return 12 * (octave + 1) + STEP_TO_SEMITONE[step] + alter;
}

export function midiToHz(midi: number) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function hzToMidi(hz: number) {
  return Math.round(69 + 12 * Math.log2(hz / 440));
}

export function centsFromMidi(hz: number, midi: number) {
  return 1200 * Math.log2(hz / midiToHz(midi));
}
