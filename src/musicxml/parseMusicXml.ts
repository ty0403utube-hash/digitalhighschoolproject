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

function descendantsNamed(node: OrderedXmlNode, name: string): OrderedXmlNode[] {
  const matches: OrderedXmlNode[] = [];

  for (const child of nodeChildren(node)) {
    if (nodeName(child) === name) {
      matches.push(child);
    }
    matches.push(...descendantsNamed(child, name));
  }

  return matches;
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

function safePositiveNumber(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getQuarterNoteMs(bpm: number) {
  return 60000 / safePositiveNumber(bpm, 80);
}

function getDivisionMs(divisions: number, bpm: number) {
  return getQuarterNoteMs(bpm) / safePositiveNumber(divisions, 1);
}

function quantizeMs(valueMs: number, quantumMs: number) {
  if (!Number.isFinite(valueMs) || !Number.isFinite(quantumMs) || quantumMs <= 0) {
    return 0;
  }

  return Math.max(0, Math.round(valueMs / quantumMs) * quantumMs);
}

function divisionsToMs(duration: number, divisions: number, bpm: number) {
  const safeDivisions = safePositiveNumber(divisions, 1);
  const safeDuration = Number.isFinite(duration) ? duration : 0;
  const divisionMs = getDivisionMs(safeDivisions, bpm);
  return Math.max(0, safeDuration * divisionMs);
}

function quantizeMusicTime(valueMs: number, divisions: number, bpm: number) {
  return quantizeMs(valueMs, getDivisionMs(divisions, bpm) / 96);
}

function beatUnitToQuarterMultiplier(beatUnit: string | undefined) {
  switch (beatUnit) {
    case "whole":
      return 4;
    case "half":
      return 2;
    case "quarter":
      return 1;
    case "eighth":
      return 0.5;
    case "16th":
      return 0.25;
    case "32nd":
      return 0.125;
    default:
      return 1;
  }
}

function noteTypeToQuarterMultiplier(type: string | undefined) {
  switch (type) {
    case "maxima":
      return 32;
    case "long":
      return 16;
    case "breve":
      return 8;
    case "whole":
      return 4;
    case "half":
      return 2;
    case "quarter":
      return 1;
    case "eighth":
      return 0.5;
    case "16th":
      return 0.25;
    case "32nd":
      return 0.125;
    case "64th":
      return 0.0625;
    case "128th":
      return 0.03125;
    case "256th":
      return 0.015625;
    default:
      return null;
  }
}

function getDotMultiplier(noteNode: OrderedXmlNode) {
  let multiplier = 1;
  let addition = 0.5;
  for (const _dot of childrenNamed(noteNode, "dot")) {
    multiplier += addition;
    addition /= 2;
  }
  return multiplier;
}

function getTimeModificationMultiplier(noteNode: OrderedXmlNode) {
  const timeModification = firstChild(noteNode, "time-modification");
  if (!timeModification) return 1;

  const actualNotes = Number(childText(timeModification, "actual-notes") ?? 0);
  const normalNotes = Number(childText(timeModification, "normal-notes") ?? 0);
  if (!Number.isFinite(actualNotes) || !Number.isFinite(normalNotes)) return 1;
  if (actualNotes <= 0 || normalNotes <= 0) return 1;
  return normalNotes / actualNotes;
}

function getNotationDurationDivisions(noteNode: OrderedXmlNode, divisions: number) {
  const typeMultiplier = noteTypeToQuarterMultiplier(childText(noteNode, "type"));
  if (typeMultiplier === null) return null;

  return (
    safePositiveNumber(divisions, 1) *
    typeMultiplier *
    getDotMultiplier(noteNode) *
    getTimeModificationMultiplier(noteNode)
  );
}

function readTempoFromDirection(directionNode: OrderedXmlNode, fallback: number) {
  const soundTempo = attrValue(firstChild(directionNode, "sound") ?? directionNode, "tempo");
  if (soundTempo) return Number(soundTempo);

  const directionType = firstChild(directionNode, "direction-type");
  const metronome = directionType ? firstChild(directionType, "metronome") : undefined;
  const perMinute = metronome ? childText(metronome, "per-minute") : undefined;
  const beatUnit = metronome ? childText(metronome, "beat-unit") : undefined;

  return perMinute ? Number(perMinute) * beatUnitToQuarterMultiplier(beatUnit) : fallback;
}

function readDuration(node: OrderedXmlNode, divisions: number, bpm: number) {
  const rawDurationDivisions = Number(childText(node, "duration") ?? 0);
  const notationDurationDivisions = getNotationDurationDivisions(node, divisions);
  const durationDivisions =
    Number.isFinite(rawDurationDivisions) && rawDurationDivisions > 0
      ? rawDurationDivisions
      : notationDurationDivisions ?? 0;

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

function isPullOffContinuation(noteNode: OrderedXmlNode) {
  if (firstChild(noteNode, "grace")) return true;

  return descendantsNamed(noteNode, "pull-off").length > 0;
}

function repeatDirection(measureNode: OrderedXmlNode, direction: "forward" | "backward") {
  return childrenNamed(measureNode, "barline").some((barline) => {
    const repeat = firstChild(barline, "repeat");
    return repeat ? attrValue(repeat, "direction") === direction : false;
  });
}

function backwardRepeatTimes(measureNode: OrderedXmlNode) {
  for (const barline of childrenNamed(measureNode, "barline")) {
    const repeat = firstChild(barline, "repeat");
    if (repeat && attrValue(repeat, "direction") === "backward") {
      const times = Number(attrValue(repeat, "times") ?? 2);
      return Number.isFinite(times) && times > 1 ? Math.floor(times) : 2;
    }
  }

  return 2;
}

function endingNumbers(measureNode: OrderedXmlNode) {
  const numbers = new Set<number>();

  for (const barline of childrenNamed(measureNode, "barline")) {
    const ending = firstChild(barline, "ending");
    const rawNumber = ending ? attrValue(ending, "number") : undefined;
    if (!rawNumber) continue;

    for (const part of String(rawNumber).split(",")) {
      const value = Number(part.trim());
      if (Number.isFinite(value) && value > 0) {
        numbers.add(Math.floor(value));
      }
    }
  }

  return numbers;
}

function shouldPlayMeasureOnRepeatPass(measureNode: OrderedXmlNode, passNumber: number) {
  const endings = endingNumbers(measureNode);
  return endings.size === 0 || endings.has(passNumber);
}

function expandRepeats(measures: OrderedXmlNode[]) {
  const expanded: OrderedXmlNode[] = [];
  let repeatStartIndex = 0;

  for (let index = 0; index < measures.length; index += 1) {
    const measure = measures[index];
    expanded.push(measure);

    if (repeatDirection(measure, "forward")) {
      repeatStartIndex = index;
    }

    if (repeatDirection(measure, "backward")) {
      const times = backwardRepeatTimes(measure);
      const repeatedSection = measures.slice(repeatStartIndex, index + 1);

      for (let passNumber = 2; passNumber <= times; passNumber += 1) {
        for (const repeatedMeasure of repeatedSection) {
          if (shouldPlayMeasureOnRepeatPass(repeatedMeasure, passNumber)) {
            expanded.push(repeatedMeasure);
          }
        }
      }

      repeatStartIndex = index + 1;
    }
  }

  return expanded;
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

  for (const measureNode of expandRepeats(measures)) {
    const measure = Number(attrValue(measureNode, "number") ?? 0);
    const measureStartMs = globalCursorMs;
    let localCursorMs = 0;
    let lastNoteStartMs = 0;
    let measureEndMs = 0;
    let pendingGroupStartMs: number | null = null;
    let pendingGroupDurationMs: number | null = null;
    const candidatesByStart = new Map<string, PracticeNoteDraft>();
    const candidates: PracticeNoteDraft[] = [];

    function flushPendingNoteGroup() {
      if (pendingGroupStartMs === null || pendingGroupDurationMs === null) return;

      localCursorMs = quantizeMusicTime(
        pendingGroupStartMs + pendingGroupDurationMs,
        divisions,
        bpm
      );
      measureEndMs = Math.max(measureEndMs, localCursorMs);
      pendingGroupStartMs = null;
      pendingGroupDurationMs = null;
    }

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
        flushPendingNoteGroup();
        const { durationMs } = readDuration(child, divisions, bpm);
        localCursorMs = quantizeMusicTime(Math.max(0, localCursorMs - durationMs), divisions, bpm);
        continue;
      }

      if (name === "forward") {
        flushPendingNoteGroup();
        const { durationMs } = readDuration(child, divisions, bpm);
        localCursorMs = quantizeMusicTime(localCursorMs + durationMs, divisions, bpm);
        measureEndMs = Math.max(measureEndMs, localCursorMs);
        continue;
      }

      if (name !== "note") {
        continue;
      }

      const isChordTone = firstChild(child, "chord") !== undefined;
      if (!isChordTone) {
        flushPendingNoteGroup();
      }
      const { durationDivisions, durationMs } = readDuration(child, divisions, bpm);
      const noteStartMs = quantizeMusicTime(
        isChordTone ? lastNoteStartMs : localCursorMs,
        divisions,
        bpm
      );
      const pitch = readPitch(child);
      const shouldSkipPracticeEvent = isPullOffContinuation(child);
      const practiceDurationDivisions = shouldSkipPracticeEvent ? 0 : durationDivisions;
      const practiceDurationMs = shouldSkipPracticeEvent ? 0 : durationMs;

      if (pitch) {
        const candidate: PracticeNoteDraft = {
          isRest: false,
          skipPractice: shouldSkipPracticeEvent,
          measure,
          step: pitch.step,
          alter: pitch.alter,
          octave: pitch.octave,
          midi: pitch.midi,
          durationDivisions: practiceDurationDivisions,
          divisions,
          bpm,
          beats,
          beatType,
          startMs: quantizeMusicTime(measureStartMs + noteStartMs, divisions, bpm),
          durationMs: practiceDurationMs,
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
      } else if (firstChild(child, "rest")) {
        candidates.push({
          isRest: true,
          measure,
          step: "Rest",
          alter: 0,
          octave: 0,
          midi: -1,
          durationDivisions: practiceDurationDivisions,
          divisions,
          bpm,
          beats,
          beatType,
          startMs: quantizeMusicTime(measureStartMs + noteStartMs, divisions, bpm),
          durationMs: practiceDurationMs,
        });
      }

      if (!isChordTone) {
        lastNoteStartMs = noteStartMs;
        pendingGroupStartMs = noteStartMs;
        pendingGroupDurationMs = shouldSkipPracticeEvent ? null : durationMs;
      } else if (pendingGroupStartMs !== null && !shouldSkipPracticeEvent) {
        pendingGroupDurationMs = pendingGroupDurationMs === null
          ? durationMs
          : Math.min(pendingGroupDurationMs, durationMs);
      }
    }

    flushPendingNoteGroup();

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
