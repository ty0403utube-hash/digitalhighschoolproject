const fs = require('fs');
const path = 'App.tsx';
let text = fs.readFileSync(path, 'utf8');
function replaceExact(oldText, newText, label) {
  if (!text.includes(oldText)) throw new Error(`Missing block: ${label}`);
  text = text.replace(oldText, newText);
}
replaceExact('const GUITAR_SOUNDING_OCTAVE_OFFSET = -12;\nconst TUNER_STRINGS = [', 'const GUITAR_SOUNDING_OCTAVE_OFFSET = -12;\nconst USE_HIGHEST_CHORD_NOTE_FOR_JUDGMENT = true;\nconst TUNER_STRINGS = [', 'highest chord const');
replaceExact('  const SAME_BEAT_MS = 80;', '  const SAME_START_MS = 2;', 'same start const');
replaceExact(`  function getPracticeStartIndex() {
    if (customNoteRange) {
      return Math.max(0, Math.min(notes.length - 1, customNoteRange.fromIndex));
    }
    if (focusPracticeRange) {
      return findFirstNoteIndexForMeasureRange(focusPracticeRange.from, focusPracticeRange.to);
    }
    if (focusPracticeMeasure !== null) {
      const firstIndex = notes.findIndex((note) => note.measure === focusPracticeMeasure);
      return firstIndex >= 0 ? firstIndex : 0;
    }
    return 0;
  }
`, `  function getPracticeStartIndex() {
    if (customNoteRange) {
      return Math.max(0, Math.min(notes.length - 1, customNoteRange.fromIndex));
    }
    if (focusPracticeRange) {
      return findFirstNoteIndexForMeasureRange(focusPracticeRange.from, focusPracticeRange.to);
    }
    if (focusPracticeMeasure !== null) {
      const firstIndex = notes.findIndex((note) => note.measure === focusPracticeMeasure);
      return firstIndex >= 0 ? firstIndex : 0;
    }
    return 0;
  }
  function findNextPracticeEventIndexFrom(startIndex: number) {
    const boundedStart = Math.max(0, Math.min(notes.length - 1, startIndex));
    const nextIndex = notes.findIndex((note, index) => index >= boundedStart && !note.skipPractice);
    return nextIndex >= 0 ? nextIndex : boundedStart;
  }
`, 'practice start helpers');
const beginStart = text.indexOf('  function beginCurrentNote() {');
const missStart = text.indexOf('  function getMissGraceMs', beginStart);
if (beginStart < 0 || missStart < 0) throw new Error('beginCurrentNote range not found');
text = text.slice(0, beginStart) + `  function beginCurrentNote() {
    stopNoteTimer();
    const practiceIndex = findNextPracticeEventIndexFrom(currentIndexRef.current);
    if (practiceIndex !== currentIndexRef.current) {
      currentIndexRef.current = practiceIndex;
      setCurrentIndex(practiceIndex);
    }
    const note = notes[practiceIndex];
    if (!note) return;
    matchedRef.current = false;
    noteStartedAtRef.current = Date.now();
    currentNoteBestPitchRef.current = null;
    setDiagnosticStatus("--");
    const targetNotes = getNotesAtSameStart(note);
    const eventDurationMs = getEventDurationMs(note);
    attackModeRef.current = !note.isRest && eventDurationMs <= ATTACK_JUDGMENT.fastNoteMs;
    noteAttackSeenRef.current = false;
    attackPitchSamplesRef.current = [];
    scoreRef.current?.scrollToNote(note.index);
    if (attackModeRef.current) {
      attackDecisionTimerRef.current = setTimeout(
        () => decideAttackPitch(note.index),
        getAttackWindowMs(eventDurationMs)
      );
    }
    for (const targetNote of targetNotes) {
      scoreRef.current?.setNoteColor(targetNote.index, "#1565c0");
      scoreRef.current?.setNoteProgress(targetNote.index, 0);
      if (targetNote.isRest) {
        scoreRef.current?.setNoteLabel(targetNote.index, "\\uC27C", "#1565c0");
      }
    }
    const judgmentNotes = getJudgmentNotesAtSameStart(note);
    setAnalysisStatus(note.isRest ? "\\uC27C\\uD45C \\uC9C0\\uB098\\uAC00\\uB294 \\uC911" : \`${'${judgmentNotes.map(formatNoteName).join("/")}'} \\uC5F0\\uC8FC\`);
    noteTimerRef.current = setInterval(() => {
      const activeNote = notes[currentIndexRef.current];
      if (!activeNote) return;
      const elapsed = Date.now() - noteStartedAtRef.current;
      const activeEventDurationMs = getEventDurationMs(activeNote);
      for (const targetNote of getNotesAtSameStart(activeNote)) {
        const progress = elapsed / activeEventDurationMs;
        scoreRef.current?.setNoteProgress(targetNote.index, progress);
      }
      if (activeNote.isRest && elapsed >= activeEventDurationMs) {
        passCurrentNote();
        return;
      }
      if (elapsed >= activeEventDurationMs) {
        matchedRef.current ? passCurrentNote() : failCurrentNote();
      }
    }, 50);
  }
` + text.slice(missStart);
replaceExact(`  function getPracticeTimeScale(note: Pick<PracticeNote, "bpm">) {
    const activePracticeBpm = clampPracticeBpm(practiceBpmRef.current);
    const sourceBpm = Number.isFinite(note.bpm) && note.bpm > 0 ? note.bpm : activePracticeBpm;
    return sourceBpm / activePracticeBpm;
  }
  function scaleDurationForPractice(note: Pick<PracticeNote, "bpm">, durationMs: number) {
    return Math.max(40, durationMs * getPracticeTimeScale(note));
  }
`, `  function getBeatUnitQuarterLength(beatType: number) {
    const safeBeatType = Number.isFinite(beatType) && beatType > 0 ? beatType : 4;
    return 4 / safeBeatType;
  }
  function getNoteDurationForPractice(
    note: Pick<PracticeNote, "durationDivisions" | "divisions" | "beatType">
  ) {
    const activePracticeBpm = clampPracticeBpm(practiceBpmRef.current);
    const safeDivisions = Number.isFinite(note.divisions) && note.divisions > 0 ? note.divisions : 1;
    const safeDurationDivisions = Number.isFinite(note.durationDivisions)
      ? note.durationDivisions
      : 0;
    const quarterCount = safeDurationDivisions / safeDivisions;
    const beatCount = quarterCount / getBeatUnitQuarterLength(note.beatType);
    return Math.max(40, beatCount * (60000 / activePracticeBpm));
  }
`, 'bpm duration helpers');
text = text.replace('    const candidateNotes = getNotesAtSameStart(activeNote);\n    const samples = attackPitchSamplesRef.current.filter(', '    const candidateNotes = getJudgmentNotesAtSameStart(activeNote);\n    const samples = attackPitchSamplesRef.current.filter(');
text = text.replace('      setAnalysisStatus(`Attack matched ${formatNoteName(bestSample.match.note)}`);', '      setAnalysisStatus(`${formatNoteName(bestSample.match.note)} 감지`);');
text = text.replace(`      setDiagnosticStatus(
        \`어택 OK / \${bestSample.sample.elapsedMs}ms / \${Math.round(bestSample.match.result.cents)} cents / \${Math.round(matchRatio * 100)}%\`
      );
`, `      setDiagnosticStatus(
        \`어택 OK / \${bestSample.sample.elapsedMs}ms / \${Math.round(bestSample.match.result.cents)} cents / \${Math.round(matchRatio * 100)}%\`
      );
      setMatchedEventFeedback(activeNote, "OK");
`);
const nextStart = text.indexOf('  function getNextIndexAfterSameStart');
const handlePitchStart = text.indexOf('  function handlePitch', nextStart);
if (nextStart < 0 || handlePitchStart < 0) throw new Error('event block range not found');
text = text.slice(0, nextStart) + `  function getNextIndexAfterSameStart(note: NonNullable<typeof currentNote>) {
    const nextEventIndex = findNextEventIndex(note);
    return nextEventIndex >= 0 ? nextEventIndex : notes.length;
  }
  function isRepeatBoundary(note: NonNullable<typeof currentNote>, nextIndex: number) {
    const nextNote = notes[nextIndex];
    return Boolean(nextNote && nextNote.measure < note.measure);
  }
  async function prepareNewRepeatPass() {
    await saveCurrentPracticeSession();
    sessionMistakesRef.current = [];
    sessionAttemptedEventKeysRef.current = new Set();
    noteFeedbackRef.current = new Map();
    sessionSavedRef.current = false;
    await startPerformanceRecording();
    scoreRef.current?.resetScore();
    setScoreViewVersion((version) => version + 1);
    setResultSummary("도돌이표 이후 새 연습 중");
  }
  function scheduleNextPracticeNote(delayMs: number) {
    setTimeout(() => {
      if (isListeningRef.current) {
        beginCurrentNote();
      }
    }, delayMs);
  }
  async function continueToNextPracticeEvent(
    note: NonNullable<typeof currentNote>,
    nextIndex: number,
    status: string
  ) {
    const crossedRepeat = isRepeatBoundary(note, nextIndex);
    if (crossedRepeat) {
      await prepareNewRepeatPass();
    }
    currentIndexRef.current = nextIndex;
    setCurrentIndex(nextIndex);
    setCanResumeFromMistake(false);
    setAnalysisStatus(crossedRepeat ? "도돌이표 이후 새 악보" : status);
    scheduleNextPracticeNote(crossedRepeat ? 450 : 0);
  }
  function getEventDurationMs(note: NonNullable<typeof currentNote>) {
    const groupNotes = getNotesAtSameStart(note);
    const timingNotes = groupNotes.filter((groupNote) => !groupNote.skipPractice);
    const durationNotes = timingNotes.length ? timingNotes : groupNotes;
    return Math.min(...durationNotes.map((groupNote) => getNoteDurationForPractice(groupNote)));
  }
  function findNextEventIndex(note: NonNullable<typeof currentNote>) {
    return notes.findIndex(
      (candidate) => !candidate.skipPractice && candidate.startMs > note.startMs + SAME_START_MS
    );
  }
  function shouldFinishFocusPractice(nextIndex: number) {
    if (customNoteRange) {
      return nextIndex < 0 || nextIndex > customNoteRange.toIndex;
    }
    if (focusPracticeRange) {
      const nextNote = notes[nextIndex];
      return !nextNote || nextNote.measure > focusPracticeRange.to;
    }
    if (focusPracticeMeasure === null) return false;
    const nextNote = notes[nextIndex];
    return !nextNote || nextNote.measure !== focusPracticeMeasure;
  }
  function getPracticeEventKey(note: NonNullable<typeof currentNote>) {
    return \`${'${note.measure}:${Math.round(note.startMs)}'}\`;
  }
  function markPracticeEventAttempted(note: NonNullable<typeof currentNote>) {
    const judgmentNotes = getJudgmentNotesAtSameStart(note);
    if (judgmentNotes.every((groupNote) => groupNote.isRest || groupNote.skipPractice)) return;
    sessionAttemptedEventKeysRef.current.add(getPracticeEventKey(note));
  }
  function finishCurrentEvent(matched: boolean) {
    stopNoteTimer();
    const note = notes[currentIndexRef.current];
    if (!note) return;
    const groupNotes = getNotesAtSameStart(note);
    markPracticeEventAttempted(note);
    if (matched) {
      setMatchedEventFeedback(note, "OK");
    } else {
      const diagnostic = getFailDiagnostic(note);
      for (const groupNote of groupNotes) {
        setNoteFeedback(groupNote.index, {
          noteColor: "#e53935",
          label: getScoreDiagnosticLabel(diagnostic),
          labelColor: "#c62828",
        });
      }
      setDiagnosticStatus(diagnostic);
      const bestPitch = currentNoteBestPitchRef.current;
      const mistakeNote = groupNotes.find((groupNote) => !groupNote.skipPractice) ?? groupNotes[0] ?? note;
      recordMistake(
        mistakeNote,
        bestPitch ? "wrong_pitch" : "timeout",
        bestPitch ? Math.round(hzToMidi(bestPitch.hz)) : null
      );
    }
    const nextIndex = getNextIndexAfterSameStart(note);
    if (nextIndex >= notes.length || shouldFinishFocusPractice(nextIndex)) {
      const isFocusedPractice = customNoteRange || focusPracticeRange || focusPracticeMeasure !== null;
      currentIndexRef.current = notes.length - 1;
      setCurrentIndex(Math.min(nextIndex, notes.length - 1));
      setIsListening(false);
      setCanResumeFromMistake(false);
      setAnalysisStatus(
        isFocusedPractice
          ? "\\uC9D1\\uC911 \\uC5F0\\uC2B5 \\uC644\\uB8CC"
          : matched
            ? "\\uC644\\uB8CC"
            : "\\uC2E4\\uC218 \\uD3EC\\uD568 \\uC644\\uB8CC"
      );
      void saveCurrentPracticeSession();
      return;
    }
    void continueToNextPracticeEvent(
      note,
      nextIndex,
      matched ? "\\uC815\\uD655" : "\\uB193\\uCE68 - \\uACC4\\uC18D \\uC9C4\\uD589"
    );
  }
  function passCurrentNote() {
    finishCurrentEvent(true);
  }
  function failCurrentNote() {
    finishCurrentEvent(false);
  }
` + text.slice(handlePitchStart);
text = text.replace('    const candidateNotes = getNotesAtSameStart(activeNote);\n    const strongestPeak = payload.peaks[0];', '    const candidateNotes = getJudgmentNotesAtSameStart(activeNote);\n    const strongestPeak = payload.peaks[0];');
text = text.replace('      setAnalysisStatus(`FFT matched ${formatNoteName(fftMatch.note)}`);', '      setAnalysisStatus(`${formatNoteName(fftMatch.note)} 감지`);');
text = text.replace(`      setNoteFeedback(fftMatch.note.index, {
        noteColor: "#2e7d32",
        label: "FFT OK",
        labelColor: "#2e7d32",
      });
      matchedRef.current = true;
`, `      matchedRef.current = true;
      setMatchedEventFeedback(activeNote, "FFT OK");
`);
text = text.replace('    const candidateNotes = getNotesAtSameStart(activeNote);\n    const closestMatch = getClosestPitchMatch(payload.hz, candidateNotes);', '    const candidateNotes = getJudgmentNotesAtSameStart(activeNote);\n    const closestMatch = getClosestPitchMatch(payload.hz, candidateNotes);');
text = text.replace('      setAnalysisStatus(`Matched ${formatNoteName(closestMatch.note)}`);', '      setAnalysisStatus(`${formatNoteName(closestMatch.note)} 감지`);');
text = text.replace(`      setNoteFeedback(closestMatch.note.index, {
        noteColor: "#2e7d32",
        label: "OK",
        labelColor: "#2e7d32",
      });
      matchedRef.current = true;
`, `      matchedRef.current = true;
      setMatchedEventFeedback(activeNote, "OK");
`);
text = text.replace('      setAnalysisStatus(`Listening for ${candidateNotes.map(formatNoteName).join("/")}`);', '      setAnalysisStatus(`${candidateNotes.map(formatNoteName).join("/")} 대기 중`);');
text = text.replace('    const candidateNotes = getNotesAtSameStart(note);\n    const closestMatch = getClosestPitchMatch(payload.hz, candidateNotes);', '    const candidateNotes = getJudgmentNotesAtSameStart(note);\n    const closestMatch = getClosestPitchMatch(payload.hz, candidateNotes);');
replaceExact(`  function setNoteFeedback(index: number, feedback: NoteFeedback) {
    noteFeedbackRef.current.set(index, feedback);
    scoreRef.current?.setNoteColor(index, feedback.noteColor);
    scoreRef.current?.setNoteLabel(index, feedback.label, feedback.labelColor);
  }
`, `  function setNoteFeedback(index: number, feedback: NoteFeedback) {
    noteFeedbackRef.current.set(index, feedback);
    scoreRef.current?.setNoteColor(index, feedback.noteColor);
    scoreRef.current?.setNoteLabel(index, feedback.label, feedback.labelColor);
  }
  function setMatchedEventFeedback(note: NonNullable<typeof currentNote>, label: string) {
    for (const groupNote of getNotesAtSameStart(note)) {
      setNoteFeedback(groupNote.index, {
        noteColor: "#2e7d32",
        label: groupNote.isRest ? "\\uC27C" : label,
        labelColor: "#2e7d32",
      });
    }
  }
`, 'matched event feedback');
text = text.replace('    setShowPracticeHighlights(true);\n    setTimeout(() => applyWeakScoreHighlights(true), 0);', '    setShowPracticeHighlights(true);\n    setTimeout(() => {\n      applyWeakScoreHighlights(true);\n      applyLatestMistakeHighlights(true);\n    }, 0);');
const latestStart = text.indexOf('  function applyLatestMistakeHighlights');
const reapplyStart = text.indexOf('  function reapplyNoteFeedback', latestStart);
if (latestStart < 0 || reapplyStart < 0) throw new Error('latest highlight range not found');
text = text.slice(0, latestStart) + `  function applyLatestMistakeHighlights(force = false) {
    if (!force && !showPracticeHighlights) return;
    if (focusPracticeRange || focusPracticeMeasure !== null) return;
    for (const index of latestMistakeNoteIndices) {
      scoreRef.current?.setNoteColor(index, "#c2410c");
      scoreRef.current?.setNoteLabel(index, "");
    }
  }
` + text.slice(reapplyStart);
const sameStartFn = text.indexOf('  function getNotesAtSameStart');
const formatFn = text.indexOf('  function formatNoteName', sameStartFn);
if (sameStartFn < 0 || formatFn < 0) throw new Error('same start range not found');
text = text.slice(0, sameStartFn) + `  function getNotesAtSameStart(note: NonNullable<typeof currentNote>) {
    const sameStartNotes = notes.filter(
      (candidate) => Math.abs(candidate.startMs - note.startMs) <= SAME_START_MS
    );
    if (note.isRest) {
      return sameStartNotes.filter((candidate) => candidate.isRest);
    }
    const playableNotes = sameStartNotes.filter((candidate) => !candidate.isRest);
    return playableNotes.length ? playableNotes : sameStartNotes;
  }
  function getJudgmentNotesAtSameStart(note: NonNullable<typeof currentNote>) {
    const playableNotes = getNotesAtSameStart(note).filter(
      (candidate) => !candidate.isRest && !candidate.skipPractice
    );
    if (!playableNotes.length) return getNotesAtSameStart(note);
    if (!USE_HIGHEST_CHORD_NOTE_FOR_JUDGMENT || playableNotes.length === 1) return playableNotes;
    return [
      playableNotes.reduce((highest, candidate) =>
        candidate.midi > highest.midi ? candidate : highest
      ),
    ];
  }
` + text.slice(formatFn);
text = text.replace('const playableNotes = noteSource.filter((note) => !note.isRest);', 'const playableNotes = noteSource.filter((note) => !note.isRest && !note.skipPractice);');
fs.writeFileSync(path, text, 'utf8');
