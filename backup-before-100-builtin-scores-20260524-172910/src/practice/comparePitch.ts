import { centsFromMidi, hzToMidi } from "../musicxml/pitch";

export function comparePitch(params: {
  playedHz: number;
  targetMidi: number;
  toleranceSemitone?: number;
  toleranceCents?: number;
}) {
  const playedMidi = hzToMidi(params.playedHz);
  const cents = centsFromMidi(params.playedHz, params.targetMidi);

  if (params.toleranceCents !== undefined) {
    return {
      playedMidi,
      cents,
      matched: Math.abs(cents) <= params.toleranceCents,
    };
  }

  const tolerance = params.toleranceSemitone ?? 0;
  return {
    playedMidi,
    cents,
    matched: Math.abs(playedMidi - params.targetMidi) <= tolerance,
  };
}
