import { useEffect, useMemo, useRef, useState } from "react";
import {
  AudioModule,
  getRecordingPermissionsAsync,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from "expo-audio";
import { Alert, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { ScoreWebView, ScoreWebViewHandle } from "./src/components/ScoreWebView";
import {
  FocusMeasure,
  getFocusMeasuresForSong,
  getLatestSessionForSong,
  getMistakeNoteIndicesForSongMeasure,
  getSessionsForSong,
  getSongAchievementSummaries,
  savePracticeSession,
  SongAchievementSummary,
  SongPracticeSessionSummary,
} from "./src/db/practiceRepository";
import { initDb } from "./src/db/sqlite";
import {
  deleteSavedSong,
  getSavedSong,
  getSavedSongs,
  saveSong,
  SavedSong,
} from "./src/db/songRepository";
import { pickMusicXmlFile } from "./src/musicxml/filePicker";
import { parseMusicXml } from "./src/musicxml/parseMusicXml";
import { midiToHz } from "./src/musicxml/pitch";
import { comparePitch } from "./src/practice/comparePitch";
import { SAMPLE_MUSIC_XML } from "./src/sample/sampleMusicXml";
import { PracticeMistakeDraft } from "./src/types/practice";
type AppSection = "home" | "library" | "play" | "focus" | "weakScore" | "achievement";
const PITCH_TOLERANCE_CENTS = 50;
export default function App() {
  const SAME_BEAT_MS = 80;
  const scoreRef = useRef<ScoreWebViewHandle>(null);
  const renderTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const noteTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const nativeMeterTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pitchWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nativeRecorderRef = useRef<any>(null);
  const receivedPitchRef = useRef(false);
  const lastPitchPayloadRef = useRef<{ hz: number; clarity: number; receivedAt: number } | null>(null);
  const noteStartedAtRef = useRef(0);
  const matchedRef = useRef(false);
  const currentIndexRef = useRef(0);
  const isListeningRef = useRef(false);
  const sessionMistakesRef = useRef<PracticeMistakeDraft[]>([]);
  const sessionSavedRef = useRef(false);
  const [musicXml, setMusicXml] = useState(SAMPLE_MUSIC_XML);
  const [songTitle, setSongTitle] = useState("Sample Melody");
  const [scoreStatus, setScoreStatus] = useState("Rendering score...");
  const [scorePage, setScorePage] = useState(1);
  const [scoreTotalPages, setScoreTotalPages] = useState(1);
  const [layoutMode, setLayoutMode] = useState<"page" | "flow">("page");
  const [useLowestChordNoteOnly, setUseLowestChordNoteOnly] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [micStarting, setMicStarting] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [waitingToStart, setWaitingToStart] = useState(false);
  const [canResumeFromMistake, setCanResumeFromMistake] = useState(false);
  const [noteColorAvailable, setNoteColorAvailable] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [lastPitch, setLastPitch] = useState("--");
  const [lastPlayedMidi, setLastPlayedMidi] = useState("--");
  const [nativeMicLevel, setNativeMicLevel] = useState("--");
  const [analysisStatus, setAnalysisStatus] = useState("Mic idle");
  const [focusMeasures, setFocusMeasures] = useState<FocusMeasure[]>([]);
  const [resultSummary, setResultSummary] = useState("No saved result yet");
  const [achievementSessions, setAchievementSessions] = useState<SongPracticeSessionSummary[]>([]);
  const [achievementSummaries, setAchievementSummaries] = useState<SongAchievementSummary[]>([]);
  const [activeSection, setActiveSection] = useState<AppSection>("home");
  const [savedSongs, setSavedSongs] = useState<SavedSong[]>([]);
  const [pendingFocusMeasure, setPendingFocusMeasure] = useState<number | null>(null);
  const [focusPracticeMeasure, setFocusPracticeMeasure] = useState<number | null>(null);
  const [weakMistakeNoteIndices, setWeakMistakeNoteIndices] = useState<number[]>([]);
  const [scoreViewVersion, setScoreViewVersion] = useState(0);
  const songId = useMemo(() => createSongId(songTitle), [songTitle]);
  const startMicLabel = countdown
    ? `Start in ${countdown}`
    : micStarting
      ? "Preparing..."
      : isListening
        ? "Listening"
        : "Start Mic";
  const notes = useMemo(
    () => parseMusicXml(musicXml, useLowestChordNoteOnly),
    [musicXml, useLowestChordNoteOnly]
  );
  const currentNote = notes[currentIndex];
  const currentTargetNotes = currentNote ? getNotesAtSameStart(currentNote) : [];
  const currentTargetLabel = currentTargetNotes.length
    ? currentTargetNotes.map(formatNoteName).join(" / ")
    : "--";
  const targetPitchText = currentNote
    ? currentTargetNotes
        .map((note) => `${formatNoteName(note)} ${midiToHz(note.midi - 12).toFixed(1)} Hz`)
        .join(" / ")
    : "--";
  const measureCount = useMemo(() => countMeasures(musicXml), [musicXml]);
  const measuresPerPage = 6;
  const previewMeasuresPerPage = 1;
  const totalMeasurePages = Math.max(1, Math.ceil(measureCount / measuresPerPage));
  const measureFrom = (scorePage - 1) * measuresPerPage + 1;
  const pageMeasureTo = Math.min(measureCount, scorePage * measuresPerPage);
  const previewMeasureFrom = pageMeasureTo + 1;
  const previewMeasureTo = Math.min(measureCount, pageMeasureTo + previewMeasuresPerPage);
  const hasPreviewMeasures = previewMeasureFrom <= previewMeasureTo;
  const measureTo = hasPreviewMeasures ? previewMeasureTo : pageMeasureTo;
  const noteIndexOffset = useMemo(
    () => findFirstNoteIndexForPage(scorePage),
    [scorePage, notes, measureCount]
  );
  useEffect(() => {
    initDb();
    refreshSavedSongs();
    refreshPracticeInsights(songId);
    return () => {
      stopRenderTimeout();
      stopCountdown();
      stopNoteTimer();
      stopNativeMeterFallback();
      stopPitchWatchdog();
    };
  }, [songId]);
  useEffect(() => {
    if (activeSection !== "play" && activeSection !== "weakScore") {
      stopRenderTimeout();
      return;
    }
    setScoreStatus("Rendering score...");
    setScoreTotalPages(totalMeasurePages);
    startRenderTimeout();
  }, [activeSection, musicXml, layoutMode, scorePage, totalMeasurePages]);
  useEffect(() => {
    if (
      (activeSection !== "play" && activeSection !== "weakScore") ||
      pendingFocusMeasure === null
    ) {
      return;
    }
    const page = Math.max(1, Math.ceil(pendingFocusMeasure / measuresPerPage));
    const boundedPage = Math.max(1, Math.min(totalMeasurePages, page));
    const firstIndex = notes.findIndex((note) => note.measure >= pendingFocusMeasure);
    setScorePage(boundedPage);
    if (firstIndex >= 0) {
      currentIndexRef.current = firstIndex;
      setCurrentIndex(firstIndex);
    }
    setAnalysisStatus(`Weak measure ${pendingFocusMeasure}`);
    setIsListening(false);
    setMicStarting(false);
    setScoreStatus("Rendering weak measure...");
    setPendingFocusMeasure(null);
  }, [activeSection, pendingFocusMeasure, notes, totalMeasurePages]);
  useEffect(() => {
    setScorePage(1);
  }, [musicXml]);
  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);
  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);
  useEffect(() => {
    if (!currentNote) return;
    const pageForCurrentNote = Math.ceil(currentNote.measure / measuresPerPage);
    const boundedPage = Math.max(1, Math.min(totalMeasurePages, pageForCurrentNote));
    if (boundedPage !== scorePage) {
      setScorePage(boundedPage);
    }
  }, [currentNote, measuresPerPage, scorePage, totalMeasurePages]);
  function countMeasures(xml: string) {
    return (xml.match(/<measure\b/g) ?? []).length || 1;
  }
  function stopRenderTimeout() {
    if (renderTimeoutRef.current) {
      clearTimeout(renderTimeoutRef.current);
      renderTimeoutRef.current = null;
    }
  }
  function stopCountdown() {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setCountdown(null);
  }
  function stopNoteTimer() {
    if (noteTimerRef.current) {
      clearInterval(noteTimerRef.current);
      noteTimerRef.current = null;
    }
  }
  function stopPitchWatchdog() {
    if (pitchWatchdogRef.current) {
      clearTimeout(pitchWatchdogRef.current);
      pitchWatchdogRef.current = null;
    }
  }
  async function stopNativeMeterFallback() {
    if (nativeMeterTimerRef.current) {
      clearInterval(nativeMeterTimerRef.current);
      nativeMeterTimerRef.current = null;
    }
    if (nativeRecorderRef.current) {
      try {
        await nativeRecorderRef.current.stop();
      } catch {
        // Recorder may already be stopped by the native layer.
      }
      nativeRecorderRef.current = null;
    }
  }
  function startRenderTimeout() {
    stopRenderTimeout();
    renderTimeoutRef.current = setTimeout(() => {
      setScoreStatus("Render timeout");
      Alert.alert(
        "Render timeout",
        "Score rendering took more than 60 seconds. Try a shorter or simpler MusicXML file."
      );
    }, 60000);
  }
  async function importMusicXml() {
    let picked;
    try {
      setScoreStatus("Opening file...");
      picked = await pickMusicXmlFile();
    } catch (error) {
      setScoreStatus("Import failed");
      Alert.alert(
        "Import failed",
        error instanceof Error ? error.message : "Could not read this file as MusicXML."
      );
      return;
    }
    if (!picked) {
      setScoreStatus("Import cancelled");
      return;
    }
    await loadMusicXml(picked.xml, picked.name.replace(/\.(mxl|musicxml|xml)$/i, ""));
    setActiveSection("play");
  }
  function refreshSavedSongs() {
    try {
      setSavedSongs(getSavedSongs());
      setAchievementSummaries(getSongAchievementSummaries());
    } catch {
      setSavedSongs([]);
      setAchievementSummaries([]);
    }
  }
  async function openSavedSong(id: string) {
    const savedSong = getSavedSong(id);
    if (!savedSong) {
      Alert.alert("Song not found", "This song is no longer saved on this device.");
      refreshSavedSongs();
      return;
    }
    await loadMusicXml(savedSong.xmlContent, savedSong.title, false);
    setActiveSection("play");
  }
  function confirmDeleteSong(song: SavedSong) {
    Alert.alert("Delete song", `Delete "${song.title}" from this device?`, [
      {
        text: "Cancel",
        style: "cancel",
      },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          deleteSavedSong(song.id);
          refreshSavedSongs();
          if (createSongId(songTitle) === song.id) {
            setSongTitle("Sample Melody");
            setMusicXml(SAMPLE_MUSIC_XML);
            setCurrentIndex(0);
            setResultSummary("No saved result yet");
            setAnalysisStatus("Mic idle");
            setIsListening(false);
            setMicStarting(false);
          }
        },
      },
    ]);
  }
  async function practiceSampleScore() {
    await loadMusicXml(SAMPLE_MUSIC_XML, "Mixed Rhythm Guitar Test", false);
    setActiveSection("play");
  }
  async function createDemoFocusResult() {
    const demoTitle = "Mixed Rhythm Guitar Test";
    const demoSongId = createSongId(demoTitle);
    const demoNotes = parseMusicXml(SAMPLE_MUSIC_XML, false);
    const weakNotes = [
      ...demoNotes.filter((note) => note.measure === 6).slice(0, 3),
      ...demoNotes.filter((note) => note.measure === 3).slice(0, 1),
    ];
    const mistakes: PracticeMistakeDraft[] = weakNotes.map((note) => ({
      songId: demoSongId,
      measure: note.measure,
      noteIndex: note.index,
      expectedMidi: note.midi,
      playedMidi: null,
      reason: "timeout",
    }));
    const wrongMeasureCount = new Set(mistakes.map((mistake) => mistake.measure)).size;
    saveSong({
      id: demoSongId,
      title: demoTitle,
      xmlContent: SAMPLE_MUSIC_XML,
    });
    savePracticeSession({
      songId: demoSongId,
      totalNotes: demoNotes.length,
      mistakes,
      wrongMeasureCount,
      wrongNoteCount: mistakes.length,
      isMastered: wrongMeasureCount <= 3,
    });
    refreshSavedSongs();
    await loadMusicXml(SAMPLE_MUSIC_XML, demoTitle, false);
    refreshPracticeInsights(demoSongId);
    setResultSummary(
      `MASTER - wrong measures ${wrongMeasureCount}, wrong notes ${mistakes.length}`
    );
    setPendingFocusMeasure(6);
    setScoreViewVersion((version) => version + 1);
    setActiveSection("weakScore");
  }
  async function createDemoAchievementResult() {
    const demoTitle = "Mixed Rhythm Guitar Test";
    const demoSongId = createSongId(demoTitle);
    const demoNotes = parseMusicXml(SAMPLE_MUSIC_XML, false);
    const makeMistakes = (measureNumbers: number[]) =>
      measureNumbers
        .map((measure) => demoNotes.find((note) => note.measure === measure))
        .filter((note): note is NonNullable<(typeof demoNotes)[number]> => Boolean(note))
        .map((note) => ({
          songId: demoSongId,
          measure: note.measure,
          noteIndex: note.index,
          expectedMidi: note.midi,
          playedMidi: null,
          reason: "timeout" as const,
        }));
    const demoSessions = [
      makeMistakes([2, 3, 4, 5, 6]),
      makeMistakes([3, 5, 6, 7]),
      makeMistakes([3, 6]),
    ];
    saveSong({
      id: demoSongId,
      title: demoTitle,
      xmlContent: SAMPLE_MUSIC_XML,
    });
    for (const mistakes of demoSessions) {
      const wrongMeasureCount = new Set(mistakes.map((mistake) => mistake.measure)).size;
      savePracticeSession({
        songId: demoSongId,
        totalNotes: demoNotes.length,
        mistakes,
        wrongMeasureCount,
        wrongNoteCount: mistakes.length,
        isMastered: wrongMeasureCount <= 3,
      });
    }
    refreshSavedSongs();
    await loadMusicXml(SAMPLE_MUSIC_XML, demoTitle, false);
    refreshPracticeInsights(demoSongId);
    setActiveSection("achievement");
  }
  async function loadMusicXml(xml: string, title: string, shouldSave = true) {
    const trimmedXml = xml.trim();
    const nextTitle = title.trim() || "Imported Score";
    if (!trimmedXml.includes("<score-partwise") && !trimmedXml.includes("<score-timewise")) {
      Alert.alert("Invalid MusicXML", "Could not find a MusicXML score tag.");
      return;
    }
    setSongTitle(nextTitle);
    setMusicXml(trimmedXml);
    setCurrentIndex(0);
    setLastPitch("--");
    setLastPlayedMidi("--");
    setNativeMicLevel("--");
    setAnalysisStatus("Mic idle");
    setResultSummary("No saved result yet");
    setIsListening(false);
    setMicStarting(false);
    setWaitingToStart(false);
    setCanResumeFromMistake(false);
    stopCountdown();
    stopNoteTimer();
    stopNativeMeterFallback();
    stopPitchWatchdog();
    sessionMistakesRef.current = [];
    sessionSavedRef.current = false;
    refreshPracticeInsights(createSongId(nextTitle));
    if (shouldSave) {
      try {
        saveSong({
          id: createSongId(nextTitle),
          title: nextTitle,
          xmlContent: trimmedXml,
        });
        refreshSavedSongs();
        setScoreStatus("Score saved on this device");
      } catch {
        Alert.alert(
          "Save failed",
          "The score was imported, but it could not be saved on this device."
        );
      }
    }
  }
  async function requestNativeMicrophonePermission() {
    try {
      const currentPermission = await getRecordingPermissionsAsync();
      if (!currentPermission.granted) {
        await requestRecordingPermissionsAsync();
      }
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
    } catch {
      // Expo Go/WebView microphone behavior can differ by device.
      // Keep the old WebView mic path as the source of truth.
    }
  }
  async function startNativeMeterFallback() {
    if (nativeRecorderRef.current) return;
    try {
      await requestNativeMicrophonePermission();
      const recorder = new AudioModule.AudioRecorder({
        ...RecordingPresets.LOW_QUALITY,
        isMeteringEnabled: true,
        numberOfChannels: 1,
      });
      await recorder.prepareToRecordAsync();
      recorder.record();
      nativeRecorderRef.current = recorder;
      setAnalysisStatus("Native mic fallback");
      nativeMeterTimerRef.current = setInterval(() => {
        const status = recorder.getStatus();
        const metering = status.metering;
        if (typeof metering !== "number") {
          setNativeMicLevel("meter unavailable");
          return;
        }
        setNativeMicLevel(`${metering.toFixed(1)} dB`);
        if (isListeningRef.current && metering > -45) {
          setAnalysisStatus("Native mic hears sound");
        }
      }, 100);
    } catch (error) {
      setNativeMicLevel("native mic failed");
      setAnalysisStatus(
        error instanceof Error ? `Native mic failed: ${error.message}` : "Native mic failed"
      );
    }
  }
  async function startAnalysis(mode: "restart" | "resume" = "restart") {
    if (notes.length === 0) {
      Alert.alert("No notes", "No parsed notes were found in this score.");
      return;
    }
    setAnalysisStatus("Checking mic permission...");
    await requestNativeMicrophonePermission();
    stopCountdown();
    stopNoteTimer();
    const startIndex = mode === "resume" ? currentIndexRef.current : 0;
    currentIndexRef.current = startIndex;
    setCurrentIndex(startIndex);
    setScorePage(Math.max(1, Math.ceil((notes[startIndex]?.measure ?? 1) / measuresPerPage)));
    setAnalysisStatus("Starting mic...");
    setMicStarting(true);
    setWaitingToStart(true);
    setCanResumeFromMistake(false);
    setIsListening(false);
    receivedPitchRef.current = false;
    matchedRef.current = false;
    if (mode === "restart") {
      sessionMistakesRef.current = [];
      sessionSavedRef.current = false;
      setResultSummary("Practice running from start");
      scoreRef.current?.resetScore();
    } else {
      setResultSummary("Practice resumed");
    }
    scoreRef.current?.startMic();
    stopPitchWatchdog();
    pitchWatchdogRef.current = setTimeout(() => {
      if (!receivedPitchRef.current) {
        startNativeMeterFallback();
      }
    }, 5000);
  }
  function stopAnalysis() {
    stopCountdown();
    stopNoteTimer();
    stopPitchWatchdog();
    stopNativeMeterFallback();
    setWaitingToStart(false);
    setMicStarting(false);
    setIsListening(false);
    setCanResumeFromMistake(notes.length > 0 && currentIndexRef.current < notes.length - 1);
    setAnalysisStatus("Stopped");
  }
  function beginCountdown() {
    stopCountdown();
    setCountdown(3);
    setAnalysisStatus("Starting in 3");
    let next = 3;
    countdownTimerRef.current = setInterval(() => {
      next -= 1;
      if (next <= 0) {
        stopCountdown();
        setWaitingToStart(false);
        setIsListening(true);
        setAnalysisStatus("Listening");
        beginCurrentNote();
        return;
      }
      setCountdown(next);
      setAnalysisStatus(`Starting in ${next}`);
    }, 1000);
  }
  function beginCurrentNote() {
    stopNoteTimer();
    const note = notes[currentIndexRef.current];
    if (!note) return;
    matchedRef.current = false;
    noteStartedAtRef.current = Date.now();
    const targetNotes = getNotesAtSameStart(note);
    for (const targetNote of targetNotes) {
      scoreRef.current?.setNoteColor(targetNote.index, "#1565c0");
      scoreRef.current?.setNoteProgress(targetNote.index, 0);
    }
    setAnalysisStatus(`Play ${targetNotes.map(formatNoteName).join("/")}`);
    noteTimerRef.current = setInterval(() => {
      const activeNote = notes[currentIndexRef.current];
      if (!activeNote) return;
      const elapsed = Date.now() - noteStartedAtRef.current;
      const eventDurationMs = getEventDurationMs(activeNote);
      for (const targetNote of getNotesAtSameStart(activeNote)) {
        const progress = elapsed / targetNote.durationMs;
        scoreRef.current?.setNoteProgress(targetNote.index, progress);
      }
      if (matchedRef.current && elapsed >= eventDurationMs) {
        passCurrentNote();
        return;
      }
      if (!matchedRef.current && elapsed >= eventDurationMs + getMissGraceMs(eventDurationMs)) {
        if (matchedRef.current) {
          passCurrentNote();
        } else {
          failCurrentNote();
        }
      }
    }, 50);
  }
  function getMissGraceMs(durationMs: number) {
    return Math.min(260, Math.max(160, durationMs * 0.4));
  }
  function getNextIndexAfterSameStart(note: NonNullable<typeof currentNote>) {
    const groupNotes = getNotesAtSameStart(note);
    const lastGroupIndex = Math.max(...groupNotes.map((groupNote) => groupNote.index));
    return lastGroupIndex + 1;
  }
  function getEventDurationMs(note: NonNullable<typeof currentNote>) {
    const groupNotes = getNotesAtSameStart(note);
    const nextIndex = getNextIndexAfterSameStart(note);
    const nextNote = notes[nextIndex];

    if (nextNote && nextNote.startMs > note.startMs + SAME_BEAT_MS) {
      return Math.max(80, nextNote.startMs - note.startMs);
    }

    return Math.max(...groupNotes.map((groupNote) => groupNote.durationMs));
  }
  function getDelayToNextEvent(note: NonNullable<typeof currentNote>, nextIndex: number) {
    const nextNote = notes[nextIndex];
    if (!nextNote) return 0;

    return Math.max(0, nextNote.startMs - note.startMs - getEventDurationMs(note));
  }
  function shouldFinishFocusPractice(nextIndex: number) {
    if (focusPracticeMeasure === null) return false;
    const nextNote = notes[nextIndex];
    return !nextNote || nextNote.measure !== focusPracticeMeasure;
  }
  function passCurrentNote() {
    stopNoteTimer();
    const note = notes[currentIndexRef.current];
    if (!note) return;
    const groupNotes = getNotesAtSameStart(note);
    for (const groupNote of groupNotes) {
      scoreRef.current?.setNoteColor(groupNote.index, "#2e7d32");
    }
    const nextIndex = getNextIndexAfterSameStart(note);
    if (nextIndex >= notes.length || shouldFinishFocusPractice(nextIndex)) {
      currentIndexRef.current = notes.length - 1;
      setCurrentIndex(Math.min(nextIndex, notes.length - 1));
      setIsListening(false);
      setAnalysisStatus(focusPracticeMeasure === null ? "Finished" : "Focus practice finished");
      saveCurrentPracticeSession();
      setFocusPracticeMeasure(null);
      return;
    }
    currentIndexRef.current = nextIndex;
    setCurrentIndex(nextIndex);
    setAnalysisStatus("Matched");
    const restDelayMs = getDelayToNextEvent(note, nextIndex);
    setTimeout(() => {
      if (isListeningRef.current) {
        beginCurrentNote();
      }
    }, restDelayMs);
  }
  function failCurrentNote() {
    stopNoteTimer();
    const note = notes[currentIndexRef.current];
    if (!note) return;
    const groupNotes = getNotesAtSameStart(note);
    for (const groupNote of groupNotes) {
      scoreRef.current?.setNoteColor(groupNote.index, "#e53935");
    }
    recordMistake(note, "timeout");
    const nextIndex = getNextIndexAfterSameStart(note);
    if (nextIndex >= notes.length || shouldFinishFocusPractice(nextIndex)) {
      currentIndexRef.current = notes.length - 1;
      setCurrentIndex(Math.min(nextIndex, notes.length - 1));
      setIsListening(false);
      setAnalysisStatus(
        focusPracticeMeasure === null ? "Finished with mistakes" : "Focus practice finished"
      );
      saveCurrentPracticeSession();
      setFocusPracticeMeasure(null);
      return;
    }
    currentIndexRef.current = nextIndex;
    setCurrentIndex(nextIndex);
    setCanResumeFromMistake(false);
    setAnalysisStatus("Missed - continuing");
    const restDelayMs = getDelayToNextEvent(note, nextIndex);
    setTimeout(() => {
      if (isListeningRef.current) {
        beginCurrentNote();
      }
    }, restDelayMs);
  }
  function handlePitch(payload: { hz: number; clarity: number }) {
    receivedPitchRef.current = true;
    stopPitchWatchdog();
    lastPitchPayloadRef.current = { ...payload, receivedAt: Date.now() };
    setLastPitch(`${payload.hz.toFixed(1)} Hz / ${payload.clarity.toFixed(2)}`);
    const activeNote = notes[currentIndexRef.current];
    if (!isListening || !activeNote) {
      return;
    }
    matchPitchForNote(activeNote, payload);
  }
  function handleFftPitchClasses(payload: {
    pitchClasses: number[];
    peaks: Array<{ hz: number; db: number }>;
  }) {
    receivedPitchRef.current = true;
    stopPitchWatchdog();
    const activeNote = notes[currentIndexRef.current];
    if (!isListening || !activeNote || !payload.pitchClasses.length) {
      return;
    }
    const candidateNotes = getNotesAtSameStart(activeNote);
    const strongestPeak = payload.peaks[0];
    if (candidateNotes.length < 2 || !strongestPeak || strongestPeak.db < -55) {
      return;
    }
    const matchedCandidate = candidateNotes.find((note) => {
      const targetPitchClass = ((note.midi % 12) + 12) % 12;
      return payload.pitchClasses.includes(targetPitchClass);
    });
    if (matchedCandidate) {
      setLastPlayedMidi(
        strongestPeak ? `FFT ${strongestPeak.hz} Hz / ${strongestPeak.db} dB` : "FFT matched"
      );
      setAnalysisStatus(`FFT matched ${formatNoteName(matchedCandidate)}`);
      matchedRef.current = true;
    }
  }
  function matchPitchForNote(
    activeNote: NonNullable<typeof currentNote>,
    payload: { hz: number; clarity: number }
  ) {
    if (payload.clarity < 0.3) {
      return;
    }
    const candidateNotes = getNotesAtSameStart(activeNote);
    const matchedCandidate = candidateNotes.find((note) => pitchMatchesNote(payload.hz, note));
    const displayNote = matchedCandidate ?? activeNote;
    const writtenPitchResult = comparePitch({
      playedHz: payload.hz,
      targetMidi: displayNote.midi,
      toleranceCents: PITCH_TOLERANCE_CENTS,
    });
    const guitarSoundingResult = comparePitch({
      playedHz: payload.hz,
      targetMidi: displayNote.midi - 12,
      toleranceCents: PITCH_TOLERANCE_CENTS,
    });
    const higherOctaveResult = comparePitch({
      playedHz: payload.hz,
      targetMidi: displayNote.midi + 12,
      toleranceCents: PITCH_TOLERANCE_CENTS,
    });
    const result = guitarSoundingResult.matched
      ? guitarSoundingResult
      : higherOctaveResult.matched
        ? higherOctaveResult
        : writtenPitchResult;
    setLastPlayedMidi(`${result.playedMidi} (${Math.round(result.cents)} cents)`);
    if (matchedCandidate) {
      setAnalysisStatus(`Matched ${formatNoteName(matchedCandidate)}`);
      matchedRef.current = true;
    } else {
      setAnalysisStatus(`Listening for ${candidateNotes.map(formatNoteName).join("/")}`);
    }
  }
  function getNotesAtSameStart(note: NonNullable<typeof currentNote>) {
    return notes.filter(
      (candidate) =>
        candidate.measure === note.measure && Math.abs(candidate.startMs - note.startMs) < SAME_BEAT_MS
    );
  }
  function formatNoteName(note: NonNullable<typeof currentNote>) {
    const accidental = note.alter > 0 ? "#" : note.alter < 0 ? "b" : "";
    return `${note.step}${accidental}${note.octave}`;
  }
  function pitchMatchesNote(hz: number, note: NonNullable<typeof currentNote>) {
    return (
      comparePitch({ playedHz: hz, targetMidi: note.midi, toleranceCents: PITCH_TOLERANCE_CENTS })
        .matched ||
      comparePitch({
        playedHz: hz,
        targetMidi: note.midi - 12,
        toleranceCents: PITCH_TOLERANCE_CENTS,
      }).matched ||
      comparePitch({
        playedHz: hz,
        targetMidi: note.midi + 12,
        toleranceCents: PITCH_TOLERANCE_CENTS,
      }).matched
    );
  }
  function createSongId(title: string) {
    const normalized = title
      .trim()
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60);

    return normalized || `song_${Math.abs(hashString(title))}`;
  }

  function hashString(value: string) {
    let hash = 0;

    for (let i = 0; i < value.length; i += 1) {
      hash = (hash << 5) - hash + value.charCodeAt(i);
      hash |= 0;
    }

    return hash;
  }
  function refreshPracticeInsights(nextSongId = songId) {
    try {
      const focus = getFocusMeasuresForSong(nextSongId, 3);
      const latestSession = getLatestSessionForSong(nextSongId);
      setFocusMeasures(focus);
      if (latestSession) {
        setResultSummary(
          `${latestSession.is_mastered ? "MASTER" : "Not mastered"} - wrong measures ${
            latestSession.wrong_measure_count
          }, wrong notes ${latestSession.wrong_note_count}`
        );
      } else {
        setResultSummary("No saved result yet");
      }
      setAchievementSessions(getSessionsForSong(nextSongId, 8));
      setAchievementSummaries(getSongAchievementSummaries());
    } catch {
      setFocusMeasures([]);
      setAchievementSessions([]);
      setAchievementSummaries([]);
    }
  }
  function recordMistake(note: NonNullable<typeof currentNote>, reason: "timeout" | "wrong_pitch") {
    const alreadyRecorded = sessionMistakesRef.current.some(
      (mistake) => mistake.measure === note.measure && mistake.noteIndex === note.index
    );
    if (alreadyRecorded) return;
    sessionMistakesRef.current.push({
      songId,
      measure: note.measure,
      noteIndex: note.index,
      expectedMidi: note.midi,
      playedMidi: null,
      reason,
    });
  }
  function saveCurrentPracticeSession() {
    if (sessionSavedRef.current || notes.length === 0) return;
    const mistakes = sessionMistakesRef.current;
    const wrongMeasures = new Set(mistakes.map((mistake) => mistake.measure));
    const wrongMeasureCount = wrongMeasures.size;
    const wrongNoteCount = mistakes.length;
    const isMastered = wrongMeasureCount <= 3;
    savePracticeSession({
      songId,
      totalNotes: notes.length,
      mistakes,
      wrongMeasureCount,
      wrongNoteCount,
      isMastered,
    });
    sessionSavedRef.current = true;
    setResultSummary(
      `${isMastered ? "MASTER" : "Not mastered"} - wrong measures ${wrongMeasureCount}, wrong notes ${wrongNoteCount}`
    );
    refreshPracticeInsights(songId);
    refreshSavedSongs();
  }
  function findFirstNoteIndexForPage(page: number) {
    const from = (page - 1) * measuresPerPage + 1;
    const to = Math.min(measureCount, page * measuresPerPage);
    const index = notes.findIndex((note) => note.measure >= from && note.measure <= to);
    return index >= 0 ? index : 0;
  }
  function goToMeasurePage(page: number) {
    const boundedPage = Math.max(1, Math.min(totalMeasurePages, page));
    setScorePage(boundedPage);
    const firstIndex = findFirstNoteIndexForPage(boundedPage);
    currentIndexRef.current = firstIndex;
    setCurrentIndex(firstIndex);
    setAnalysisStatus("Mic idle");
    setIsListening(false);
    setMicStarting(false);
  }
  function openWeakMeasureOnScore(measure: number) {
    setPendingFocusMeasure(measure);
    setWeakMistakeNoteIndices(getMistakeNoteIndicesForSongMeasure(songId, measure));
    setScoreViewVersion((version) => version + 1);
    setActiveSection("weakScore");
  }
  function practiceWeakMeasure(measure: number) {
    const firstIndex = notes.findIndex((note) => note.measure === measure);
    if (firstIndex < 0) {
      Alert.alert("Measure not found", "Could not find this measure in the current score.");
      return;
    }
    setFocusPracticeMeasure(measure);
    currentIndexRef.current = firstIndex;
    setCurrentIndex(firstIndex);
    setScorePage(Math.max(1, Math.ceil(measure / measuresPerPage)));
    setActiveSection("play");
    setAnalysisStatus(`Focus practice: measure ${measure}`);
  }
  function markWeakMeasureOnScore(measure: number) {
    const indices = weakMistakeNoteIndices.length
      ? weakMistakeNoteIndices
      : notes.filter((candidate) => candidate.measure === measure).map((note) => note.index);
    for (const note of notes.filter((candidate) => indices.includes(candidate.index))) {
      scoreRef.current?.setNoteColor(note.index, "#e53935");
    }
  }
  if (activeSection === "home") {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.homeHeader}>
          <Text style={styles.homeTitle}>Guitar Practice</Text>
          <Text style={styles.homeSubtitle}>{songTitle}</Text>
        </View>
        <View style={styles.categoryList}>
          <Pressable style={styles.categoryButton} onPress={() => setActiveSection("library")}>
            <Text style={styles.categoryNumber}>1</Text>
            <View style={styles.categoryTextBlock}>
              <Text style={styles.categoryTitle}>Play</Text>
              <Text style={styles.categorySubtitle}>Choose a saved score and practice</Text>
            </View>
          </Pressable>
          <Pressable style={styles.samplePracticeButton} onPress={practiceSampleScore}>
            <Text style={styles.samplePracticeTitle}>Practice Test Score</Text>
            <Text style={styles.samplePracticeSubtitle}>Practice the built-in rhythm test score</Text>
          </Pressable>
          <Pressable style={styles.categoryButton} onPress={() => setActiveSection("focus")}>
            <Text style={styles.categoryNumber}>2</Text>
            <View style={styles.categoryTextBlock}>
              <Text style={styles.categoryTitle}>Weak Part Practice</Text>
              <Text style={styles.categorySubtitle}>Review frequently missed measures</Text>
            </View>
          </Pressable>
          <Pressable style={styles.categoryButton} onPress={() => setActiveSection("achievement")}>
            <Text style={styles.categoryNumber}>3</Text>
            <View style={styles.categoryTextBlock}>
              <Text style={styles.categoryTitle}>Achievement</Text>
              <Text style={styles.categorySubtitle}>Check recent practice results</Text>
            </View>
          </Pressable>
          <Pressable style={styles.categoryButton} onPress={createDemoFocusResult}>
            <Text style={styles.categoryNumber}>4</Text>
            <View style={styles.categoryTextBlock}>
              <Text style={styles.categoryTitle}>Create Focus Test</Text>
              <Text style={styles.categorySubtitle}>Save measure 6 as a weak section</Text>
            </View>
          </Pressable>
          <Pressable style={styles.categoryButton} onPress={createDemoAchievementResult}>
            <Text style={styles.categoryNumber}>5</Text>
            <View style={styles.categoryTextBlock}>
              <Text style={styles.categoryTitle}>Create Achievement Test</Text>
              <Text style={styles.categorySubtitle}>Check recent practice results</Text>
            </View>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }
  if (activeSection === "library") {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={() => setActiveSection("home")}>
            <Text style={styles.backButtonText}>Home</Text>
          </Pressable>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>Choose Score</Text>
            <Text style={styles.subtitle}>{savedSongs.length} saved songs</Text>
          </View>
          <Pressable style={styles.importButton} onPress={importMusicXml}>
            <Text style={styles.importButtonText}>Import</Text>
          </Pressable>
        </View>
        <ScrollView style={styles.placeholderPanel} contentContainerStyle={styles.placeholderContent}>
          {savedSongs.length ? (
            savedSongs.map((song) => (
              <View key={song.id} style={styles.songRow}>
                <Pressable style={styles.songButton} onPress={() => openSavedSong(song.id)}>
                  <Text style={styles.songTitle}>{song.title}</Text>
                  <Text style={styles.songMeta}>{new Date(song.updatedAt).toLocaleString()}</Text>
                </Pressable>
                <Pressable style={styles.deleteSongButton} onPress={() => confirmDeleteSong(song)}>
                  <Text style={styles.deleteSongButtonText}>Delete</Text>
                </Pressable>
              </View>
            ))
          ) : (
            <Text style={styles.placeholderText}>
              No saved songs yet. Import a MusicXML file to add one.
            </Text>
          )}
          <Pressable style={styles.samplePracticeButton} onPress={practiceSampleScore}>
            <Text style={styles.samplePracticeTitle}>Practice Test Score</Text>
            <Text style={styles.samplePracticeSubtitle}>Practice the built-in rhythm test score</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }
  if (activeSection === "focus") {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={() => setActiveSection("home")}>
            <Text style={styles.backButtonText}>Home</Text>
          </Pressable>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>Weak Part Practice</Text>
            <Text style={styles.subtitle}>{songTitle}</Text>
          </View>
        </View>
        <ScrollView style={styles.placeholderPanel} contentContainerStyle={styles.placeholderContent}>
          <Text style={styles.placeholderTitle}>Weak Measures</Text>
          {focusMeasures.length ? (
            focusMeasures.map((item) => (
              <View key={item.measure} style={styles.focusMeasureRow}>
                <View style={styles.focusMeasureTextBlock}>
                  <Text style={styles.focusMeasureTitle}>Measure {item.measure}</Text>
                  <Text style={styles.focusMeasureMeta}>{item.mistakeCount} mistakes</Text>
                </View>
                <Pressable
                  style={styles.focusMeasureButton}
                  onPress={() => openWeakMeasureOnScore(item.measure)}
                >
                  <Text style={styles.focusMeasureButtonText}>Show Score</Text>
                </Pressable>
                <Pressable
                  style={styles.focusMeasureButton}
                  onPress={() => practiceWeakMeasure(item.measure)}
                >
                  <Text style={styles.focusMeasureButtonText}>Practice</Text>
                </Pressable>
              </View>
            ))
          ) : (
            <Text style={styles.placeholderText}>No weak measures saved yet.</Text>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }
  if (false && activeSection === "focus") {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={() => setActiveSection("home")}>
            <Text style={styles.backButtonText}>Home</Text>
          </Pressable>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>?????????낇뀘??????????????袁⑦꺙</Text>
            <Text style={styles.subtitle}>{songTitle}</Text>
          </View>
        </View>
        <ScrollView style={styles.placeholderPanel} contentContainerStyle={styles.placeholderContent}>
          <Text style={styles.placeholderTitle}>Focus Measures</Text>
          <Text style={styles.placeholderText}>
            {focusMeasures.length
              ? focusMeasures.map((item) => `M${item.measure} (${item.mistakeCount})`).join(" / ")
              : "????썹땟?㏓퉲????逆곷틳爰덂퐲????????꿔꺂???熬곣뵎???嶺? ????ㅿ폍??????딅젩."}
          </Text>
          <Pressable style={styles.primaryWideButton} onPress={() => setActiveSection("play")}>
            <Text style={styles.primaryWideButtonText}>Go to Play Screen</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }
  if (activeSection === "weakScore") {
    const reviewMeasure = currentNote?.measure ?? pendingFocusMeasure ?? measureFrom;
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={() => setActiveSection("home")}>
            <Text style={styles.backButtonText}>Home</Text>
          </Pressable>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>Weak Measure Score</Text>
            <Text style={styles.subtitle}>
              {songTitle} - Measure {reviewMeasure}
            </Text>
          </View>
          <Pressable style={styles.importButton} onPress={() => setActiveSection("focus")}>
            <Text style={styles.importButtonText}>List</Text>
          </Pressable>
        </View>
        <View style={styles.score}>
          <ScoreWebView
            key={`weak-score-${scoreViewVersion}`}
            ref={scoreRef}
            musicXml={musicXml}
            layoutMode={layoutMode}
            measureFrom={measureFrom}
            measureTo={measureTo}
            noteIndexOffset={noteIndexOffset}
            useLowestChordNoteOnly={useLowestChordNoteOnly}
            onPitch={() => {}}
            onFftPitchClasses={() => {}}
            onScoreReady={(payload) => {
              stopRenderTimeout();
              setScoreStatus(
                `Ready - weak measure ${reviewMeasure} - measures ${measureFrom}-${measureTo}/${measureCount}`
              );
              setTimeout(() => markWeakMeasureOnScore(reviewMeasure), 250);
            }}
            onScoreError={(message) => {
              stopRenderTimeout();
              setScoreStatus(message ? `Render fallback needed: ${message}` : "Render fallback needed");
            }}
            onNoteMapWarning={() => {
              setNoteColorAvailable(false);
              setAnalysisStatus("Note color unavailable");
            }}
            onScrollInfo={() => {
              setScoreTotalPages(totalMeasurePages);
            }}
            onMicReady={() => {}}
            onMicUnavailable={() => {}}
          />
        </View>
        <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent}>
          <View style={styles.statusRow}>
            <Text style={styles.label}>Review</Text>
            <Text style={styles.value}>Red notes are the saved mistake area</Text>
          </View>
          <View style={styles.statusRow}>
            <Text style={styles.label}>Score</Text>
            <Text style={styles.value}>{scoreStatus}</Text>
          </View>
          <View style={styles.statusRow}>
            <Text style={styles.label}>Focus</Text>
            <Text style={styles.value}>
              {focusMeasures.length
                ? focusMeasures.map((item) => `M${item.measure}(${item.mistakeCount})`).join(" / ")
                : "No focus section yet"}
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }
  if (activeSection === "achievement") {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={() => setActiveSection("home")}>
            <Text style={styles.backButtonText}>Home</Text>
          </Pressable>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>Achievement</Text>
            <Text style={styles.subtitle}>{songTitle}</Text>
          </View>
        </View>
        <ScrollView style={styles.placeholderPanel} contentContainerStyle={styles.placeholderContent}>
          <Text style={styles.placeholderTitle}>Latest Result</Text>
          <Text style={styles.placeholderText}>{resultSummary}</Text>
          <Text style={styles.placeholderTitle}>All Scores</Text>
          {achievementSummaries.length ? (
            achievementSummaries.map((summary) => (
              <View key={summary.songId} style={styles.achievementRow}>
                <View style={styles.achievementTextBlock}>
                  <Text style={styles.achievementTitle}>{summary.title}</Text>
                  <Text style={styles.achievementMeta}>
                    {summary.sessionCount} sessions · latest{" "}
                    {summary.latestIsMastered ? "MASTER" : "Not mastered"}
                  </Text>
                  <Text style={styles.achievementDate}>
                    best wrong measures: {summary.bestWrongMeasureCount ?? "-"} · last:{" "}
                    {summary.lastPracticedAt
                      ? new Date(summary.lastPracticedAt).toLocaleString()
                      : "not practiced"}
                  </Text>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.placeholderText}>No saved score achievement data yet.</Text>
          )}
          <Text style={styles.placeholderTitle}>Practice History</Text>
          {achievementSessions.length ? (
            achievementSessions.map((session, index) => (
              <View key={session.id} style={styles.achievementRow}>
                <View style={styles.achievementBadge}>
                  <Text style={styles.achievementBadgeText}>{index + 1}</Text>
                </View>
                <View style={styles.achievementTextBlock}>
                  <Text style={styles.achievementTitle}>
                    {session.isMastered ? "MASTER" : "Not mastered"}
                  </Text>
                  <Text style={styles.achievementMeta}>
                    wrong measures {session.wrongMeasureCount} ??wrong notes {session.wrongNoteCount}
                  </Text>
                  <Text style={styles.achievementDate}>
                    {new Date(session.practicedAt).toLocaleString()}
                  </Text>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.placeholderText}>No practice history yet.</Text>
          )}
          <Text style={styles.placeholderTitle}>Master Rule</Text>
          <Text style={styles.placeholderText}>MASTER when wrong measures are 3 or fewer.</Text>
        </ScrollView>
      </SafeAreaView>
    );
  }
  if (false && activeSection === "achievement") {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={() => setActiveSection("home")}>
            <Text style={styles.backButtonText}>Home</Text>
          </Pressable>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>?嚥싲갭큔?????癲ル슢캉???????袁⑦꺙</Text>
            <Text style={styles.subtitle}>{songTitle}</Text>
          </View>
        </View>
        <ScrollView style={styles.placeholderPanel} contentContainerStyle={styles.placeholderContent}>
          <Text style={styles.placeholderTitle}>Latest Result</Text>
          <Text style={styles.placeholderText}>{resultSummary}</Text>
          <Text style={styles.placeholderTitle}>Master Rule</Text>
          <Text style={styles.placeholderText}>?????꿔꺂???熬곣뵎???嶺? 3?????ш끽維??????MASTER???꿔꺂??節뉖き???嶺뚮ㅎ????</Text>
          <Pressable style={styles.primaryWideButton} onPress={() => setActiveSection("play")}>
            <Text style={styles.primaryWideButtonText}>Go to Play Screen</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => setActiveSection("home")}>
          <Text style={styles.backButtonText}>Home</Text>
        </Pressable>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>???????????袁⑦꺙</Text>
          <Text style={styles.subtitle}>
            {songTitle} - {notes.length} parsed notes
          </Text>
        </View>
        <Pressable style={styles.importButton} onPress={importMusicXml}>
          <Text style={styles.importButtonText}>Import</Text>
        </Pressable>
        <Pressable style={styles.sampleButton} onPress={practiceSampleScore}>
          <Text style={styles.sampleButtonText}>Test</Text>
        </Pressable>
      </View>
      <View style={styles.score}>
        <ScoreWebView
          key={`score-${scoreViewVersion}`}
          ref={scoreRef}
          musicXml={musicXml}
          layoutMode={layoutMode}
          measureFrom={measureFrom}
          measureTo={measureTo}
          noteIndexOffset={noteIndexOffset}
          useLowestChordNoteOnly={useLowestChordNoteOnly}
          onPitch={handlePitch}
          onFftPitchClasses={handleFftPitchClasses}
          onScoreReady={(payload) => {
            stopRenderTimeout();
            setScoreStatus(
              `Ready ??measures ${measureFrom}-${measureTo}/${measureCount} ??${notes.length} parsed notes ??${
                payload?.svgCount ?? 0
              } svg ??${payload?.height ?? 0}px ??${payload?.renderMode ?? layoutMode}`
            );
          }}
          onScoreError={(message) => {
            stopRenderTimeout();
            setScoreStatus(
              message ? `Render fallback needed: ${message}` : "Render fallback needed"
            );
          }}
          onNoteMapWarning={() => {
            setNoteColorAvailable(false);
            setAnalysisStatus("Note color unavailable");
          }}
          onScrollInfo={(payload) => {
            setScoreTotalPages(totalMeasurePages);
          }}
          onMicReady={() => {
            setMicStarting(false);
            if (waitingToStart) {
              beginCountdown();
            }
          }}
          onMicUnavailable={(message) => {
            setMicStarting(false);
            setAnalysisStatus(`Mic unavailable: ${message}`);
            startNativeMeterFallback();
            if (waitingToStart) {
              beginCountdown();
            }
          }}
        />
      </View>
      <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent}>
        <View style={styles.toolbar}>
          <Pressable
            style={styles.toolbarButton}
            onPress={() => setLayoutMode((current) => (current === "page" ? "flow" : "page"))}
          >
            <Text style={styles.toolbarButtonText}>
              Layout: {layoutMode === "page" ? "Page" : "Flow"}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.toolbarButton, useLowestChordNoteOnly && styles.activeToolbarButton]}
            onPress={() => setUseLowestChordNoteOnly((current) => !current)}
          >
            <Text
              style={[
                styles.toolbarButtonText,
                useLowestChordNoteOnly && styles.activeToolbarButtonText,
              ]}
            >
              Chord: {useLowestChordNoteOnly ? "Low" : "All"}
            </Text>
          </Pressable>
        </View>
        <View style={styles.pageControls}>
          <Pressable
            style={[styles.pageButton, scorePage <= 1 && styles.disabledButton]}
            disabled={scorePage <= 1}
            onPress={() => goToMeasurePage(scorePage - 1)}
          >
            <Text style={styles.pageButtonText}>Prev</Text>
          </Pressable>
          <Text style={styles.pageText}>
            Page {scorePage}/{totalMeasurePages} - M{measureFrom}-{pageMeasureTo}
            {hasPreviewMeasures ? ` / 다음 페이지의 첫 마디: M${previewMeasureFrom}` : ""}
          </Text>
          <Pressable
            style={[styles.pageButton, scorePage >= totalMeasurePages && styles.disabledButton]}
            disabled={scorePage >= totalMeasurePages}
            onPress={() => goToMeasurePage(scorePage + 1)}
          >
            <Text style={styles.pageButtonText}>Next</Text>
          </Pressable>
        </View>
        <View style={styles.analysisControls}>
          <Pressable
            style={[styles.analysisButton, (isListening || micStarting) && styles.disabledButton]}
            disabled={isListening || micStarting}
            onPress={() => startAnalysis("restart")}
          >
            <Text style={styles.analysisButtonText}>
              {micStarting || isListening || countdown ? startMicLabel : "Restart"}
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.resumeButton,
              (!canResumeFromMistake || isListening || micStarting) && styles.disabledButton,
            ]}
            disabled={!canResumeFromMistake || isListening || micStarting}
            onPress={() => startAnalysis("resume")}
          >
            <Text style={styles.resumeButtonText}>Resume</Text>
          </Pressable>
          <Pressable style={styles.stopButton} onPress={stopAnalysis}>
            <Text style={styles.stopButtonText}>Stop</Text>
          </Pressable>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.label}>Score</Text>
          <Text style={styles.value}>{scoreStatus}</Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.label}>Next Note</Text>
          <Text style={styles.value}>
            {currentNote ? `${currentTargetLabel} - measure ${currentNote.measure}` : "--"}
          </Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.label}>Target Hz</Text>
          <Text style={styles.value}>{targetPitchText}</Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.label}>Pitch</Text>
          <Text style={styles.value}>{lastPitch}</Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.label}>Native Mic</Text>
          <Text style={styles.value}>{nativeMicLevel}</Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.label}>Played</Text>
          <Text style={styles.value}>{lastPlayedMidi}</Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.label}>Analysis</Text>
          <Text style={styles.value}>
            {countdown ? `${analysisStatus}` : `${analysisStatus}${
              noteColorAvailable ? "" : " ??color off"
            }`}
          </Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.label}>Result</Text>
          <Text style={styles.value}>{resultSummary}</Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.label}>Focus</Text>
          <Text style={styles.value}>
            {focusMeasures.length
              ? focusMeasures.map((item) => `M${item.measure}(${item.mistakeCount})`).join(" / ")
              : "No focus section yet"}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#f4f1ea",
  },
  homeHeader: {
    paddingHorizontal: 28,
    paddingTop: 36,
    paddingBottom: 24,
  },
  homeTitle: {
    fontSize: 34,
    fontWeight: "900",
    color: "#1f2a25",
  },
  homeSubtitle: {
    marginTop: 8,
    fontSize: 16,
    color: "#66736b",
    fontWeight: "700",
  },
  categoryList: {
    paddingHorizontal: 24,
    gap: 14,
  },
  categoryButton: {
    minHeight: 104,
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d8d2c4",
    shadowColor: "#304038",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  categoryNumber: {
    width: 44,
    height: 44,
    borderRadius: 22,
    textAlign: "center",
    textAlignVertical: "center",
    overflow: "hidden",
    backgroundColor: "#1f6f5b",
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "900",
  },
  categoryTextBlock: {
    flex: 1,
  },
  categoryTitle: {
    fontSize: 22,
    fontWeight: "900",
    color: "#1f2a25",
  },
  categorySubtitle: {
    marginTop: 6,
    fontSize: 14,
    color: "#66736b",
    fontWeight: "700",
  },
  samplePracticeButton: {
    minHeight: 76,
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 14,
    justifyContent: "center",
    backgroundColor: "#2f5f8f",
    borderWidth: 1,
    borderColor: "#254c73",
  },
  samplePracticeTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "900",
  },
  samplePracticeSubtitle: {
    marginTop: 5,
    color: "#dfeaf5",
    fontSize: 13,
    fontWeight: "700",
  },
  header: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    backgroundColor: "#f4f1ea",
  },
  backButton: {
    minHeight: 40,
    borderRadius: 8,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#c9d2cc",
  },
  backButtonText: {
    color: "#1f2a25",
    fontSize: 14,
    fontWeight: "800",
  },
  titleBlock: {
    flex: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: "#1f2a25",
  },
  subtitle: {
    marginTop: 4,
    fontSize: 13,
    color: "#66736b",
    fontWeight: "700",
  },
  importButton: {
    minHeight: 44,
    borderRadius: 8,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1f6f5b",
    borderWidth: 1,
    borderColor: "#185846",
  },
  importButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "800",
  },
  sampleButton: {
    minHeight: 44,
    borderRadius: 8,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2f5f8f",
    borderWidth: 1,
    borderColor: "#254c73",
  },
  sampleButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "800",
  },
  score: {
    height: 500,
    backgroundColor: "#ffffff",
    marginHorizontal: 12,
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#d8d2c4",
    shadowColor: "#304038",
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  panel: {
    maxHeight: 280,
    marginTop: 10,
    backgroundColor: "#fbfaf7",
    borderTopWidth: 1,
    borderColor: "#d8d2c4",
  },
  panelContent: {
    padding: 16,
    gap: 12,
  },
  placeholderPanel: {
    flex: 1,
    backgroundColor: "#fbfaf7",
    borderTopWidth: 1,
    borderColor: "#d8d2c4",
  },
  placeholderContent: {
    padding: 24,
    gap: 14,
  },
  placeholderTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#1f2a25",
  },
  placeholderText: {
    minHeight: 48,
    borderRadius: 8,
    padding: 14,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d8d2c4",
    color: "#1f2a25",
    fontSize: 15,
    fontWeight: "700",
  },
  primaryWideButton: {
    minHeight: 48,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1f6f5b",
  },
  primaryWideButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "900",
  },
  songRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 10,
  },
  songButton: {
    flex: 1,
    minHeight: 72,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    justifyContent: "center",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d8d2c4",
  },
  songTitle: {
    color: "#1f2a25",
    fontSize: 18,
    fontWeight: "900",
  },
  songMeta: {
    marginTop: 5,
    color: "#66736b",
    fontSize: 12,
    fontWeight: "700",
  },
  focusMeasureRow: {
    minHeight: 76,
    borderRadius: 8,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d8d2c4",
  },
  focusMeasureTextBlock: {
    flex: 1,
  },
  focusMeasureTitle: {
    color: "#1f2a25",
    fontSize: 18,
    fontWeight: "900",
  },
  focusMeasureMeta: {
    marginTop: 5,
    color: "#66736b",
    fontSize: 13,
    fontWeight: "700",
  },
  focusMeasureButton: {
    minHeight: 44,
    borderRadius: 8,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1f6f5b",
  },
  focusMeasureButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900",
  },
  achievementRow: {
    minHeight: 86,
    borderRadius: 8,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d8d2c4",
  },
  achievementBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2f5f8f",
  },
  achievementBadgeText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
  },
  achievementTextBlock: {
    flex: 1,
  },
  achievementTitle: {
    color: "#1f2a25",
    fontSize: 17,
    fontWeight: "900",
  },
  achievementMeta: {
    marginTop: 4,
    color: "#66736b",
    fontSize: 13,
    fontWeight: "800",
  },
  achievementDate: {
    marginTop: 3,
    color: "#7c8780",
    fontSize: 12,
    fontWeight: "700",
  },
  deleteSongButton: {
    minHeight: 72,
    minWidth: 86,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#b3261e",
  },
  deleteSongButtonText: {
    color: "#b3261e",
    fontSize: 13,
    fontWeight: "900",
  },
  toolbar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },
  toolbarButton: {
    minHeight: 36,
    borderRadius: 8,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#c9d2cc",
  },
  toolbarButtonText: {
    color: "#1f2a25",
    fontSize: 13,
    fontWeight: "800",
  },
  activeToolbarButton: {
    backgroundColor: "#1f6f5b",
    borderColor: "#185846",
  },
  activeToolbarButtonText: {
    color: "#ffffff",
  },
  pageControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  pageButton: {
    minHeight: 40,
    minWidth: 92,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#c9d2cc",
  },
  pageButtonText: {
    color: "#1f2a25",
    fontSize: 14,
    fontWeight: "800",
  },
  pageText: {
    flex: 1,
    textAlign: "center",
    color: "#1f2a25",
    fontWeight: "800",
  },
  disabledButton: {
    opacity: 0.45,
  },
  analysisControls: {
    flexDirection: "row",
    gap: 10,
  },
  analysisButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1f6f5b",
  },
  analysisButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "800",
  },
  resumeButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2f5f8f",
  },
  resumeButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "800",
  },
  stopButton: {
    minHeight: 40,
    minWidth: 92,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#c9d2cc",
  },
  stopButtonText: {
    color: "#1f2a25",
    fontSize: 14,
    fontWeight: "800",
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    minHeight: 32,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: "#ffffff",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#d8d2c4",
  },
  label: {
    fontSize: 13,
    color: "#66736b",
    fontWeight: "800",
  },
  value: {
    flex: 1,
    textAlign: "right",
    fontSize: 13,
    fontWeight: "700",
    color: "#1f2a25",
  },
});
