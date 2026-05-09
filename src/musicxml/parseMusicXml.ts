import { XMLParser } from "fast-xml-parser";
import { pitchToMidi } from "./pitch";
import { PracticeNote } from "../types/music";

type OrderedXmlNode = Record<string, any>;
type PracticeNoteDraft = Omit<PracticeNote, "index">;

function nodeName(node: OrderedXmlNode) {
  return Object.keys(node).find((key) => key !== ":@");
}

function nodeChildren(node: OrderedXmlNode) {
  const name = nodeName(node);
  const children = name ? node[name] : [];
  return Array.isArray(children) ? children : [];
}

function childrenNamed(node: OrderedXmlNode, name: string) {
  return nodeChildren(node).filter((child) => nodeName(child) === name);
}

function firstChild(node: OrderedXmlNode, name: string) {
  return childrenNamed(node, name)[0];
}

function textValue(node: OrderedXmlNode | undefined): string | undefined {
  if (!node) return undefined;

  for (const child of nodeChildren(node)) {
    if (Object.prototype.hasOwnProperty.call(child, "#text")) {
      return String(child["#text"]);
    }
  }

  return undefined;
}

function childText(node: OrderedXmlNode, name: string) {
  return textValue(firstChild(node, name));
}

function attrValue(node: OrderedXmlNode, name: string) {
  return node[":@"]?.[`@_${name}`];
}

function findFirstNode(nodes: OrderedXmlNode[], name: string): OrderedXmlNode | undefined {
  for (const node of nodes) {
    if (nodeName(node) === name) return node;

    const found = findFirstNode(nodeChildren(node), name);
    if (found) return found;
  }

  return undefined;
}

function divisionsToMs(duration: number, divisions: number, bpm: number) {
  const quarterNoteMs = 60000 / bpm;
  return (duration / divisions) * quarterNoteMs;
}

function readTempoFromDirection(directionNode: OrderedXmlNode, fallback: number) {
  const soundTempo = attrValue(firstChild(directionNode, "sound") ?? directionNode, "tempo");
  if (soundTempo) return Number(soundTempo);

  const directionType = firstChild(directionNode, "direction-type");
  const metronome = directionType ? firstChild(directionType, "metronome") : undefined;
  const perMinute = metronome ? childText(metronome, "per-minute") : undefined;

  return perMinute ? Number(perMinute) : fallback;
}

function readDuration(node: OrderedXmlNode, divisions: number, bpm: number) {
  const durationDivisions = Number(childText(node, "duration") ?? 0);

  return {
    durationDivisions,
    durationMs: divisionsToMs(durationDivisions, divisions, bpm),
  };
}

function readPitch(noteNode: OrderedXmlNode) {
  const pitch = firstChild(noteNode, "pitch");
  if (!pitch) return null;

  const step = childText(pitch, "step");
  const octave = childText(pitch, "octave");
  if (!step || octave === undefined) return null;

  const alter = Number(childText(pitch, "alter") ?? 0);
  const octaveNumber = Number(octave);

  return {
    step,
    alter,
    octave: octaveNumber,
    midi: pitchToMidi(step, alter, octaveNumber),
  };
}

export function parseMusicXml(xml: string, useLowestChordNoteOnly = false): PracticeNote[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: true,
    preserveOrder: true,
    trimValues: true,
  });

  const doc = parser.parse(xml) as OrderedXmlNode[];
  const score = findFirstNode(doc, "score-partwise") ?? findFirstNode(doc, "score-timewise");
  const part = score ? firstChild(score, "part") : undefined;
  const measures = part ? childrenNamed(part, "measure") : [];

  let divisions = 1;
  let bpm = 80;
  let beats = 4;
  let beatType = 4;
  let globalCursorMs = 0;
  let index = 0;
  const notes: PracticeNote[] = [];

  for (const measureNode of measures) {
    const measure = Number(attrValue(measureNode, "number") ?? 0);
    const measureStartMs = globalCursorMs;
    let localCursorMs = 0;
    let lastNoteStartMs = 0;
    let measureEndMs = 0;
    const candidatesByStart = new Map<string, PracticeNoteDraft>();
    const candidates: PracticeNoteDraft[] = [];

    for (const child of nodeChildren(measureNode)) {
      const name = nodeName(child);

      if (name === "attributes") {
        const nextDivisions = childText(child, "divisions");
        const time = firstChild(child, "time");

        if (nextDivisions) divisions = Number(nextDivisions);
        if (time) {
          const nextBeats = childText(time, "beats");
          const nextBeatType = childText(time, "beat-type");
          if (nextBeats) beats = Number(nextBeats);
          if (nextBeatType) beatType = Number(nextBeatType);
        }
        continue;
      }

      if (name === "direction") {
        bpm = readTempoFromDirection(child, bpm);
        continue;
      }

      if (name === "sound") {
        const soundTempo = attrValue(child, "tempo");
        if (soundTempo) bpm = Number(soundTempo);
        continue;
      }

      if (name === "backup") {
        const { durationMs } = readDuration(child, divisions, bpm);
        localCursorMs = Math.max(0, localCursorMs - durationMs);
        continue;
      }

      if (name === "forward") {
        const { durationMs } = readDuration(child, divisions, bpm);
        localCursorMs += durationMs;
        measureEndMs = Math.max(measureEndMs, localCursorMs);
        continue;
      }

      if (name !== "note") {
        continue;
      }

      const isChordTone = firstChild(child, "chord") !== undefined;
      const { durationDivisions, durationMs } = readDuration(child, divisions, bpm);
      const noteStartMs = isChordTone ? lastNoteStartMs : localCursorMs;
      const pitch = readPitch(child);

      if (pitch) {
        const candidate: PracticeNoteDraft = {
          measure,
          step: pitch.step,
          alter: pitch.alter,
          octave: pitch.octave,
          midi: pitch.midi,
          durationDivisions,
          divisions,
          bpm,
          beats,
          beatType,
          startMs: measureStartMs + noteStartMs,
          durationMs,
        };
        if (useLowestChordNoteOnly) {
          const key = String(Math.round(candidate.startMs));
          const current = candidatesByStart.get(key);

          if (!current || candidate.midi < current.midi) {
            candidatesByStart.set(key, candidate);
          }
        } else {
          candidates.push(candidate);
        }
      }

      if (!isChordTone) {
        lastNoteStartMs = noteStartMs;
        localCursorMs += durationMs;
        measureEndMs = Math.max(measureEndMs, localCursorMs);
      }
    }

    const measureNotes = (useLowestChordNoteOnly
      ? Array.from(candidatesByStart.values())
      : candidates
    ).sort((a, b) => {
      if (a.startMs !== b.startMs) return a.startMs - b.startMs;
      return a.midi - b.midi;
    });

    for (const note of measureNotes) {
      notes.push({
        ...note,
        index,
      });
      index += 1;
    }

    globalCursorMs = measureStartMs + measureEndMs;
  }

  return notes;
}
