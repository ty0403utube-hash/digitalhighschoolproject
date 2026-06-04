import { useEffect, useMemo, useRef, useState } from "react";
import {
  AudioModule,
  getRecordingPermissionsAsync,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from "expo-audio";
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ScoreWebView, ScoreWebViewHandle } from "./src/components/ScoreWebView";
import {
  FocusMeasure,
  FocusRange,
  getFocusMeasuresForSong,
  getFocusRangesForSong,
  getLatestSessionForSong,
  getMistakeNoteIndicesForSongMeasure,
  getMistakeNoteIndicesForSongMeasureRange,
  getSessionsForSong,
  getSongAchievementSummaries,
  getWeakPracticeSessionsForSong,
  savePracticeSession,
  SongAchievementSummary,
  SongPracticeSessionSummary,
  WeakPracticeSession,
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
import { hzToMidi, midiToHz } from "./src/musicxml/pitch";
import { comparePitch } from "./src/practice/comparePitch";
import { BUILTIN_SCORES, BuiltinScore } from "./src/sample/builtinScores";
import { SAMPLE_MUSIC_XML } from "./src/sample/sampleMusicXml";
import { PracticeMistakeDraft } from "./src/types/practice";
type AppSection = "home" | "library" | "play" | "focus" | "weakScore" | "achievement";
const PITCH_TOLERANCE_CENTS = 70;
const PITCH_NEAR_MISS_CENTS = 120;
const MIN_DIRECT_CLARITY = 0.22;
const MIN_ATTACK_CLARITY = 0.18;
const ATTACK_FAST_NOTE_MS = 500;
const ATTACK_MIN_WINDOW_MS = 95;
const ATTACK_MAX_WINDOW_MS = 190;
const ATTACK_MATCH_RATIO = 0.45;
const ACCURACY_TEST_SONG_TITLE = "\uC815\uD655\uB3C4 \uD655\uC778 \uACE1";
const HARMONIC_CORRECTION_FACTORS = [1, 2, 3, 4];
type NoteFeedback = {
  noteColor: string;
  label: string;
  labelColor: string;
};
export default function App() {
  const SAME_BEAT_MS = 80;
  const scoreRef = useRef<ScoreWebViewHandle>(null);
  const renderTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const noteTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const attackDecisionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nativeMeterTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pitchWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nativeRecorderRef = useRef<any>(null);
  const receivedPitchRef = useRef(false);
  const lastPitchPayloadRef = useRef<{
    hz: number;
    clarity: number;
    receivedAt: number;
    rms?: number;
    isAttack?: boolean;
  } | null>(null);
  const noteStartedAtRef = useRef(0);
  const matchedRef = useRef(false);
  const attackModeRef = useRef(false);
  const attackPitchSamplesRef = useRef<Array<{ hz: number; clarity: number; elapsedMs: number }>>([]);
  const currentNoteBestPitchRef = useRef<{
    cents: number;
    elapsedMs: number;
    hz: number;
    clarity: number;
  } | null>(null);
  const noteFeedbackRef = useRef<Map<number, NoteFeedback>>(new Map());
  const currentIndexRef = useRef(0);
  const isListeningRef = useRef(false);
  const sessionMistakesRef = useRef<PracticeMistakeDraft[]>([]);
  const sessionSavedRef = useRef(false);
  const [musicXml, setMusicXml] = useState(SAMPLE_MUSIC_XML);
  const [songTitle, setSongTitle] = useState("Sample Melody");
  const [editableScoreTitle, setEditableScoreTitle] = useState("Sample Melody");
  const [scoreStatus, setScoreStatus] = useState("\uC545\uBCF4 \uB80C\uB354\uB9C1 \uC911...");
  const [scorePage, setScorePage] = useState(1);
  const [scoreTotalPages, setScoreTotalPages] = useState(1);
  const layoutMode: "page" | "flow" = "page";
  const useLowestChordNoteOnly = false;
  const [isListening, setIsListening] = useState(false);
  const [micStarting, setMicStarting] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [waitingToStart, setWaitingToStart] = useState(false);
  const [canResumeFromMistake, setCanResumeFromMistake] = useState(false);
  const [noteColorAvailable, setNoteColorAvailable] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [lastPitch, setLastPitch] = useState("--");
  const [lastPlayedMidi, setLastPlayedMidi] = useState("--");
  const [diagnosticStatus, setDiagnosticStatus] = useState("--");
  const [nativeMicLevel, setNativeMicLevel] = useState("--");
  const [analysisStatus, setAnalysisStatus] = useState("\uB9C8\uC774\uD06C \uB300\uAE30 \uC911");
  const [focusMeasures, setFocusMeasures] = useState<FocusMeasure[]>([]);
  const [focusRanges, setFocusRanges] = useState<FocusRange[]>([]);
  const [weakPracticeSessions, setWeakPracticeSessions] = useState<WeakPracticeSession[]>([]);
  const [focusSelectedSongId, setFocusSelectedSongId] = useState<string | null>(null);
  const [resultSummary, setResultSummary] = useState("\uC544\uC9C1 \uC800\uC7A5\uB41C \uACB0\uACFC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4");
  const [achievementSessions, setAchievementSessions] = useState<SongPracticeSessionSummary[]>([]);
  const [achievementSummaries, setAchievementSummaries] = useState<SongAchievementSummary[]>([]);
  const [showAllMasteredSongs, setShowAllMasteredSongs] = useState(false);
  const [showAllInProgressSongs, setShowAllInProgressSongs] = useState(false);
  const [achievementView, setAchievementView] = useState<"mastered" | "progress">("progress");
  const [activeSection, setActiveSection] = useState<AppSection>("home");
  const [playReturnSection, setPlayReturnSection] = useState<"library" | "focus" | "home">("library");
  const [savedSongs, setSavedSongs] = useState<SavedSong[]>([]);
  const [pendingFocusMeasure, setPendingFocusMeasure] = useState<number | null>(null);
  const [weakScoreRange, setWeakScoreRange] = useState<{ from: number; to: number } | null>(null);
  const [focusPracticeMeasure, setFocusPracticeMeasure] = useState<number | null>(null);
  const [focusPracticeRange, setFocusPracticeRange] = useState<{ from: number; to: number } | null>(
    null
  );
  const [customRangeStart, setCustomRangeStart] = useState("1");
  const [customRangeEnd, setCustomRangeEnd] = useState("1");
  const [weakMistakeNoteIndices, setWeakMistakeNoteIndices] = useState<number[]>([]);
  const [scoreViewVersion, setScoreViewVersion] = useState(0);
  const songId = useMemo(() => createSongId(songTitle), [songTitle]);
  const startMicLabel = countdown
    ? `${countdown}\uCD08 \uD6C4 \uC2DC\uC791`
    : micStarting
      ? "\uC900\uBE44 \uC911..."
      : isListening
        ? "\uB4E3\uB294 \uC911"
        : "\uB9C8\uC774\uD06C \uC2DC\uC791";
  const restartButtonLabel = canResumeFromMistake ? "\uCC98\uC74C\uBD80\uD130" : "\uB179\uC74C \uC2DC\uC791";
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
    ? currentNote.isRest
      ? "\uC27C\uD45C"
      : currentTargetNotes
        .map((note) => `${formatNoteName(note)} ${midiToHz(note.midi - 12).toFixed(1)} Hz`)
        .join(" / ")
    : "--";
  const masteredAchievementSummaries = useMemo(
    () => achievementSummaries.filter((summary) => summary.latestIsMastered),
    [achievementSummaries]
  );
  const inProgressAchievementSummaries = useMemo(
    () =>
      achievementSummaries.filter(
        (summary) => summary.sessionCount > 0 && !summary.latestIsMastered
      ),
    [achievementSummaries]
  );
  const visibleMasteredAchievementSummaries = showAllMasteredSongs
    ? masteredAchievementSummaries
    : masteredAchievementSummaries.slice(0, 5);
  const visibleInProgressAchievementSummaries = showAllInProgressSongs
    ? inProgressAchievementSummaries
    : inProgressAchievementSummaries.slice(0, 3);
  const visibleSavedSongs = useMemo(
    () => savedSongs.filter((song) => song.id !== createSongId(ACCURACY_TEST_SONG_TITLE)),
    [savedSongs]
  );
  const focusSelectableSongs = useMemo(
    () =>
      [...savedSongs].sort((a, b) => {
        if (a.id === createSongId(ACCURACY_TEST_SONG_TITLE)) return -1;
        if (b.id === createSongId(ACCURACY_TEST_SONG_TITLE)) return 1;
        return b.updatedAt.localeCompare(a.updatedAt);
      }),
    [savedSongs]
  );
  const scoreDisplayXml = useMemo(
    () => hideTempoMarksForScore(sanitizeMusicXmlDisplayText(musicXml, editableScoreTitle || songTitle)),
    [editableScoreTitle, musicXml, songTitle]
  );
  const measureCount = useMemo(() => countMeasures(musicXml), [musicXml]);
  const measuresPerPage = 6;
  const totalMeasurePages = Math.max(1, Math.ceil(measureCount / measuresPerPage));
  const measureFrom = focusPracticeRange
    ? focusPracticeRange.from
    : (scorePage - 1) * measuresPerPage + 1;
  const measureTo = focusPracticeRange
    ? focusPracticeRange.to
    : Math.min(measureCount, measureFrom + measuresPerPage - 1);
  const noteIndexOffset = useMemo(
    () =>
      focusPracticeRange
        ? findFirstNoteIndexForMeasureRange(focusPracticeRange.from, focusPracticeRange.to)
        : findFirstNoteIndexForMeasureRange(measureFrom, measureTo),
    [focusPracticeRange, measureFrom, measureTo, notes, measureCount]
  );
  useEffect(() => {
    initDb();
    seedAccuracyTestSong();
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
    setScoreStatus("\uC545\uBCF4 \uB80C\uB354\uB9C1 \uC911...");
    setScoreTotalPages(totalMeasurePages);
    startRenderTimeout();
  }, [activeSection, musicXml, layoutMode, totalMeasurePages]);
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
    setAnalysisStatus(`${pendingFocusMeasure}\uB9C8\uB514 \uCDE8\uC57D \uAD6C\uAC04`);
    setIsListening(false);
    setMicStarting(false);
    setScoreStatus("\uCDE8\uC57D \uB9C8\uB514 \uB80C\uB354\uB9C1 \uC911...");
    setPendingFocusMeasure(null);
  }, [activeSection, pendingFocusMeasure, notes, totalMeasurePages]);
  useEffect(() => {
    setScorePage(1);
    setFocusPracticeRange(null);
    setFocusPracticeMeasure(null);
    setCustomRangeStart("1");
    setCustomRangeEnd("1");
  }, [musicXml]);
  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);
  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);
  useEffect(() => {
    if (!currentNote) return;
    if (focusPracticeRange) return;
    const pageForCurrentNote = Math.ceil(currentNote.measure / measuresPerPage);
    const boundedPage = Math.max(1, Math.min(totalMeasurePages, pageForCurrentNote));
    if (boundedPage !== scorePage) {
      setScorePage(boundedPage);
    }
  }, [currentNote, focusPracticeRange, measuresPerPage, scorePage, totalMeasurePages]);
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
    if (attackDecisionTimerRef.current) {
      clearTimeout(attackDecisionTimerRef.current);
      attackDecisionTimerRef.current = null;
    }
    attackModeRef.current = false;
    attackPitchSamplesRef.current = [];
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
      setScoreStatus("\uD30C\uC77C \uC5EC\uB294 \uC911...");
      picked = await pickMusicXmlFile();
    } catch (error) {
      setScoreStatus("\uBD88\uB7EC\uC624\uAE30 \uC2E4\uD328");
      Alert.alert(
        "Import failed",
        error instanceof Error ? error.message : "Could not read this file as MusicXML."
      );
      return;
    }
    if (!picked) {
      setScoreStatus("\uBD88\uB7EC\uC624\uAE30 \uCDE8\uC18C");
      return;
    }
    await loadMusicXml(picked.xml, getBestImportedTitle(picked.xml, picked.name));
    setPlayReturnSection("library");
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
  function seedAccuracyTestSong() {
    const testSongId = createSongId(ACCURACY_TEST_SONG_TITLE);
    if (getSavedSong(testSongId)) return;
    saveSong({
      id: testSongId,
      title: ACCURACY_TEST_SONG_TITLE,
      xmlContent: sanitizeMusicXmlDisplayText(SAMPLE_MUSIC_XML, ACCURACY_TEST_SONG_TITLE),
    });
  }
  async function openSavedSong(id: string) {
    const savedSong = getSavedSong(id);
    if (!savedSong) {
      Alert.alert("Song not found", "This song is no longer saved on this device.");
      refreshSavedSongs();
      return;
    }
    const repairedTitle =
      sanitizeScoreTitle(savedSong.title) ||
      extractTitleFromMusicXml(savedSong.xmlContent) ||
      "Imported Score";
    await loadMusicXml(savedSong.xmlContent, repairedTitle, false);
    const repairedXml = sanitizeMusicXmlDisplayText(savedSong.xmlContent, repairedTitle);
    if (repairedTitle !== savedSong.title || repairedXml !== savedSong.xmlContent) {
      saveSong({
        id: createSongId(repairedTitle),
        title: repairedTitle,
        xmlContent: repairedXml,
      });
      deleteSavedSong(savedSong.id);
      refreshSavedSongs();
    }
    setPlayReturnSection("library");
    setActiveSection("play");
  }
  async function selectFocusSong(song: SavedSong) {
    const repairedTitle =
      sanitizeScoreTitle(song.title) ||
      extractTitleFromMusicXml(song.xmlContent) ||
      "Imported Score";
    const nextSongId = createSongId(repairedTitle);
    await loadMusicXml(song.xmlContent, repairedTitle, false);
    setFocusSelectedSongId(nextSongId);
    refreshPracticeInsights(nextSongId);
    setCustomRangeStart("1");
    setCustomRangeEnd("1");
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
            setResultSummary("\uC544\uC9C1 \uC800\uC7A5\uB41C \uACB0\uACFC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4");
            setAnalysisStatus("\uB9C8\uC774\uD06C \uB300\uAE30 \uC911");
            setIsListening(false);
            setMicStarting(false);
          }
        },
      },
    ]);
  }
  async function practiceSampleScore() {
    await loadMusicXml(SAMPLE_MUSIC_XML, ACCURACY_TEST_SONG_TITLE, false);
    setPlayReturnSection(activeSection === "focus" ? "focus" : "library");
    setActiveSection("play");
  }
  async function openBuiltinScore(score: BuiltinScore) {
    const cleanXml = sanitizeMusicXmlDisplayText(score.xmlContent, score.title);
    saveSong({
      id: createSongId(score.title),
      title: score.title,
      xmlContent: cleanXml,
    });
    refreshSavedSongs();
    await loadMusicXml(cleanXml, score.title, false);
    setPlayReturnSection("library");
    setActiveSection("play");
  }
  async function createDemoFocusResult() {
    const demoTitle = ACCURACY_TEST_SONG_TITLE;
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
    const accuracy = Math.max(0, Math.round(((demoNotes.length - mistakes.length) / demoNotes.length) * 100));
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
      isMastered: accuracy >= 90,
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
    const demoTitle = ACCURACY_TEST_SONG_TITLE;
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
      const accuracy = Math.max(0, Math.round(((demoNotes.length - mistakes.length) / demoNotes.length) * 100));
      savePracticeSession({
        songId: demoSongId,
        totalNotes: demoNotes.length,
        mistakes,
        wrongMeasureCount,
        wrongNoteCount: mistakes.length,
        isMastered: accuracy >= 90,
      });
    }
    refreshSavedSongs();
    await loadMusicXml(SAMPLE_MUSIC_XML, demoTitle, false);
    refreshPracticeInsights(demoSongId);
    setActiveSection("achievement");
  }
  async function loadMusicXml(xml: string, title: string, shouldSave = true) {
    const trimmedXml = xml.trim();
    const nextTitle =
      sanitizeScoreTitle(title) || extractTitleFromMusicXml(trimmedXml) || "Imported Score";
    const displayXml = sanitizeMusicXmlDisplayText(trimmedXml, nextTitle);
    if (!trimmedXml.includes("<score-partwise") && !trimmedXml.includes("<score-timewise")) {
      Alert.alert("Invalid MusicXML", "Could not find a MusicXML score tag.");
      return;
    }
    setSongTitle(nextTitle);
    setEditableScoreTitle(nextTitle);
    setMusicXml(displayXml);
    setCurrentIndex(0);
    setLastPitch("--");
    setLastPlayedMidi("--");
    setNativeMicLevel("--");
    setAnalysisStatus("\uB9C8\uC774\uD06C \uB300\uAE30 \uC911");
    setResultSummary("\uC544\uC9C1 \uC800\uC7A5\uB41C \uACB0\uACFC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4");
    setIsListening(false);
    setMicStarting(false);
    setWaitingToStart(false);
    setCanResumeFromMistake(false);
    setWeakScoreRange(null);
    setFocusSelectedSongId(null);
    stopCountdown();
    stopNoteTimer();
    stopNativeMeterFallback();
    stopPitchWatchdog();
    sessionMistakesRef.current = [];
    noteFeedbackRef.current = new Map();
    sessionSavedRef.current = false;
    refreshPracticeInsights(createSongId(nextTitle));
    if (shouldSave) {
      try {
        saveSong({
          id: createSongId(nextTitle),
          title: nextTitle,
          xmlContent: displayXml,
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
      setAnalysisStatus("\uB9C8\uC774\uD06C \uAD8C\uD55C \uD655\uC778 \uC911...");
    await requestNativeMicrophonePermission();
    stopCountdown();
    stopNoteTimer();
    const startIndex = mode === "resume" ? currentIndexRef.current : 0;
    currentIndexRef.current = startIndex;
    setCurrentIndex(startIndex);
    setScorePage(Math.max(1, Math.ceil((notes[startIndex]?.measure ?? 1) / measuresPerPage)));
    setAnalysisStatus("\uB9C8\uC774\uD06C \uC2DC\uC791 \uC911...");
    setMicStarting(true);
    setWaitingToStart(true);
    setCanResumeFromMistake(false);
    setIsListening(false);
    receivedPitchRef.current = false;
    matchedRef.current = false;
    if (mode === "restart") {
      sessionMistakesRef.current = [];
      noteFeedbackRef.current = new Map();
      sessionSavedRef.current = false;
      setResultSummary("\uCC98\uC74C\uBD80\uD130 \uC5F0\uC2B5 \uC911");
      scoreRef.current?.resetScore();
    } else {
      setResultSummary("\uC774\uC5B4\uC11C \uC5F0\uC2B5 \uC911");
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
    setAnalysisStatus("\uC815\uC9C0\uB428");
  }
  function beginCountdown() {
    stopCountdown();
    setCountdown(3);
    setAnalysisStatus("3\uCD08 \uD6C4 \uC2DC\uC791");
    let next = 3;
    countdownTimerRef.current = setInterval(() => {
      next -= 1;
      if (next <= 0) {
        stopCountdown();
        setWaitingToStart(false);
        setIsListening(true);
        setAnalysisStatus("\uB4E3\uB294 \uC911");
        beginCurrentNote();
        return;
      }
      setCountdown(next);
      setAnalysisStatus(`${next}\uCD08 \uD6C4 \uC2DC\uC791`);
    }, 1000);
  }
  function beginCurrentNote() {
    stopNoteTimer();
    const note = notes[currentIndexRef.current];
    if (!note) return;
    matchedRef.current = false;
    noteStartedAtRef.current = Date.now();
    currentNoteBestPitchRef.current = null;
    setDiagnosticStatus("--");
    const targetNotes = getNotesAtSameStart(note);
    const eventDurationMs = getEventDurationMs(note);
    attackModeRef.current = !note.isRest && eventDurationMs <= ATTACK_FAST_NOTE_MS;
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
        scoreRef.current?.setNoteLabel(targetNote.index, "\uC27C", "#1565c0");
      }
    }
    setAnalysisStatus(note.isRest ? "\uC27C\uD45C \uC9C0\uB098\uAC00\uB294 \uC911" : `${targetNotes.map(formatNoteName).join("/")} \uC5F0\uC8FC`);
    noteTimerRef.current = setInterval(() => {
      const activeNote = notes[currentIndexRef.current];
      if (!activeNote) return;
      const elapsed = Date.now() - noteStartedAtRef.current;
      const activeEventDurationMs = getEventDurationMs(activeNote);
      for (const targetNote of getNotesAtSameStart(activeNote)) {
        const progress = elapsed / targetNote.durationMs;
        scoreRef.current?.setNoteProgress(targetNote.index, progress);
      }
      if (activeNote.isRest && elapsed >= activeEventDurationMs) {
        passCurrentNote();
        return;
      }
      if (matchedRef.current && elapsed >= activeEventDurationMs) {
        passCurrentNote();
        return;
      }
      if (!matchedRef.current && elapsed >= activeEventDurationMs + getMissGraceMs(activeEventDurationMs)) {
        if (matchedRef.current) {
          passCurrentNote();
        } else {
          failCurrentNote();
        }
      }
    }, 50);
  }
  function getMissGraceMs(durationMs: number) {
    return Math.min(340, Math.max(220, durationMs * 0.5));
  }
  function getAttackWindowMs(durationMs: number) {
    return Math.min(ATTACK_MAX_WINDOW_MS, Math.max(ATTACK_MIN_WINDOW_MS, durationMs * 0.65));
  }
  function getAttackIgnoreMs(durationMs: number) {
    return Math.min(30, Math.max(12, durationMs * 0.08));
  }
  function collectAttackPitch(
    activeNote: NonNullable<typeof currentNote>,
    payload: { hz: number; clarity: number }
  ) {
    const elapsedMs = Date.now() - noteStartedAtRef.current;
    const eventDurationMs = getEventDurationMs(activeNote);
    const ignoreMs = getAttackIgnoreMs(eventDurationMs);
    const windowMs = getAttackWindowMs(eventDurationMs);
    if (elapsedMs < ignoreMs || elapsedMs > windowMs || payload.clarity < MIN_ATTACK_CLARITY) return;
    attackPitchSamplesRef.current.push({ hz: payload.hz, clarity: payload.clarity, elapsedMs });
  }
  function decideAttackPitch(noteIndex: number) {
    attackDecisionTimerRef.current = null;
    if (!isListeningRef.current || currentIndexRef.current !== noteIndex || matchedRef.current) return;
    const activeNote = notes[noteIndex];
    if (!activeNote) return;
    const candidateNotes = getNotesAtSameStart(activeNote);
    const samples = attackPitchSamplesRef.current.filter((sample) => sample.clarity >= MIN_ATTACK_CLARITY);
    const bestSample = samples
      .map((sample) => ({ sample, match: getClosestPitchMatch(sample.hz, candidateNotes) }))
      .filter((item) => item.match.result.matched)
      .sort(
        (a, b) =>
          Math.abs(a.match.result.cents) - Math.abs(b.match.result.cents) ||
          b.sample.clarity - a.sample.clarity
      )[0];
    if (bestSample) {
      matchedRef.current = true;
      setLastPlayedMidi(
        `${bestSample.match.result.playedMidi} (${Math.round(bestSample.match.result.cents)} cents)`
      );
      setAnalysisStatus(`Attack matched ${formatNoteName(bestSample.match.note)}`);
    }
  }
  function getNextIndexAfterSameStart(note: NonNullable<typeof currentNote>) {
    const nextEventIndex = findNextEventIndex(note);
    return nextEventIndex >= 0 ? nextEventIndex : notes.length;
  }
  function getEventDurationMs(note: NonNullable<typeof currentNote>) {
    const groupNotes = getNotesAtSameStart(note);
    const nextIndex = findNextEventIndex(note);
    const nextNote = nextIndex >= 0 ? notes[nextIndex] : undefined;

    if (nextNote && nextNote.startMs > note.startMs + SAME_BEAT_MS) {
      return Math.max(80, nextNote.startMs - note.startMs);
    }

    return Math.min(...groupNotes.map((groupNote) => groupNote.durationMs));
  }
  function findNextEventIndex(note: NonNullable<typeof currentNote>) {
    return notes.findIndex(
      (candidate) =>
        candidate.measure > note.measure ||
        (candidate.measure === note.measure && candidate.startMs > note.startMs + SAME_BEAT_MS)
    );
  }
  function getDelayToNextEvent(note: NonNullable<typeof currentNote>, nextIndex: number) {
    const nextNote = notes[nextIndex];
    if (!nextNote) return 0;

    return Math.max(0, nextNote.startMs - note.startMs - getEventDurationMs(note));
  }
  function shouldFinishFocusPractice(nextIndex: number) {
    if (focusPracticeRange) {
      const nextNote = notes[nextIndex];
      return !nextNote || nextNote.measure > focusPracticeRange.to;
    }
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
      setNoteFeedback(groupNote.index, {
        noteColor: "#2e7d32",
        label: groupNote.isRest ? "\uC27C" : "OK",
        labelColor: "#2e7d32",
      });
    }
    const nextIndex = getNextIndexAfterSameStart(note);
    if (nextIndex >= notes.length || shouldFinishFocusPractice(nextIndex)) {
      currentIndexRef.current = notes.length - 1;
      setCurrentIndex(Math.min(nextIndex, notes.length - 1));
      setIsListening(false);
      setCanResumeFromMistake(false);
      setAnalysisStatus(focusPracticeMeasure === null ? "\uC644\uB8CC" : "\uC9D1\uC911 \uC5F0\uC2B5 \uC644\uB8CC");
      saveCurrentPracticeSession();
      setFocusPracticeMeasure(null);
      setFocusPracticeRange(null);
      return;
    }
    currentIndexRef.current = nextIndex;
    setCurrentIndex(nextIndex);
    setAnalysisStatus("\uC815\uD655");
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
    recordMistake(
      note,
      bestPitch ? "wrong_pitch" : "timeout",
      bestPitch ? Math.round(hzToMidi(bestPitch.hz)) : null
    );
    const nextIndex = getNextIndexAfterSameStart(note);
    if (nextIndex >= notes.length || shouldFinishFocusPractice(nextIndex)) {
      currentIndexRef.current = notes.length - 1;
      setCurrentIndex(Math.min(nextIndex, notes.length - 1));
      setIsListening(false);
      setCanResumeFromMistake(false);
      setAnalysisStatus(
        focusPracticeMeasure === null ? "\uC2E4\uC218 \uD3EC\uD568 \uC644\uB8CC" : "\uC9D1\uC911 \uC5F0\uC2B5 \uC644\uB8CC"
      );
      saveCurrentPracticeSession();
      setFocusPracticeMeasure(null);
      setFocusPracticeRange(null);
      return;
    }
    currentIndexRef.current = nextIndex;
    setCurrentIndex(nextIndex);
    setCanResumeFromMistake(false);
    setAnalysisStatus("\uB193\uCE68 - \uACC4\uC18D \uC9C4\uD589");
    const restDelayMs = getDelayToNextEvent(note, nextIndex);
    setTimeout(() => {
      if (isListeningRef.current) {
        beginCurrentNote();
      }
    }, restDelayMs);
  }
  function handlePitch(payload: { hz: number; clarity: number; rms?: number; isAttack?: boolean }) {
    receivedPitchRef.current = true;
    stopPitchWatchdog();
    lastPitchPayloadRef.current = { ...payload, receivedAt: Date.now() };
    setLastPitch(`${payload.hz.toFixed(1)} Hz / ${payload.clarity.toFixed(2)}`);
    const activeNote = notes[currentIndexRef.current];
    if (!isListening || !activeNote || activeNote.isRest) {
      return;
    }
    if (attackModeRef.current) {
      collectAttackPitch(activeNote, payload);
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
    if (!isListening || !activeNote || activeNote.isRest || !payload.pitchClasses.length) {
      return;
    }
    const candidateNotes = getNotesAtSameStart(activeNote);
    const strongestPeak = payload.peaks[0];
    if (!strongestPeak || strongestPeak.db < -58) {
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
      setDiagnosticStatus(
        `FFT \uBCF4\uC870 \uAC10\uC9C0 / ${Date.now() - noteStartedAtRef.current}ms / ${strongestPeak.db} dB`
      );
      setNoteFeedback(matchedCandidate.index, {
        noteColor: "#2e7d32",
        label: "FFT OK",
        labelColor: "#2e7d32",
      });
      matchedRef.current = true;
    }
  }
  function matchPitchForNote(
    activeNote: NonNullable<typeof currentNote>,
    payload: { hz: number; clarity: number; rms?: number; isAttack?: boolean }
  ) {
    if (payload.clarity < MIN_DIRECT_CLARITY) {
      return;
    }
    const candidateNotes = getNotesAtSameStart(activeNote);
    const closestMatch = getClosestPitchMatch(payload.hz, candidateNotes);
    const result = closestMatch.result;
    const elapsedMs = Date.now() - noteStartedAtRef.current;
    updateCurrentNoteBestPitch({
      cents: result.cents,
      elapsedMs,
      hz: payload.hz,
      clarity: payload.clarity,
    });
    setLastPlayedMidi(
      `${result.playedMidi} (${Math.round(result.cents)} cents${
        closestMatch.harmonicFactor > 1 ? `, /${closestMatch.harmonicFactor}` : ""
      })`
    );
    if (result.matched) {
      setAnalysisStatus(`Matched ${formatNoteName(closestMatch.note)}`);
      setDiagnosticStatus(
        `\uC74C OK / ${elapsedMs}ms / ${Math.round(result.cents)} cents`
      );
      setNoteFeedback(closestMatch.note.index, {
        noteColor: "#2e7d32",
        label: "OK",
        labelColor: "#2e7d32",
      });
      matchedRef.current = true;
    } else {
      setAnalysisStatus(`Listening for ${candidateNotes.map(formatNoteName).join("/")}`);
      setDiagnosticStatus(
        `\uC74C \uB2E4\uB984 / ${elapsedMs}ms / ${Math.round(result.cents)} cents`
      );
    }
  }
  function updateCurrentNoteBestPitch(attempt: {
    cents: number;
    elapsedMs: number;
    hz: number;
    clarity: number;
  }) {
    const currentBest = currentNoteBestPitchRef.current;
    if (!currentBest || Math.abs(attempt.cents) < Math.abs(currentBest.cents)) {
      currentNoteBestPitchRef.current = attempt;
    }
  }
  function getFailDiagnostic(note: NonNullable<typeof currentNote>) {
    const payload = lastPitchPayloadRef.current;
    const elapsed = Date.now() - noteStartedAtRef.current;
    const eventDurationMs = getEventDurationMs(note);
    const allowedMs = eventDurationMs + getMissGraceMs(eventDurationMs);
    const bestPitch = currentNoteBestPitchRef.current;
    if (bestPitch) {
      const bestCents = Math.round(bestPitch.cents);
      if (Math.abs(bestPitch.cents) <= PITCH_NEAR_MISS_CENTS) {
        return `\uC74C\uC815 \uD754\uB4E4\uB9BC / ${bestPitch.elapsedMs}ms / ${bestCents} cents`;
      }
    }
    const pitchGraceBeforeNoteMs = 140;
    if (!payload || payload.receivedAt < noteStartedAtRef.current - pitchGraceBeforeNoteMs) {
      return `\uD53C\uCE58 \uAC10\uC9C0 \uC5C6\uC74C / ${elapsed}ms / \uD5C8\uC6A9 ${allowedMs}ms`;
    }
    const pitchElapsed = Math.max(0, payload.receivedAt - noteStartedAtRef.current);
    const candidateNotes = getNotesAtSameStart(note);
    const closestMatch = getClosestPitchMatch(payload.hz, candidateNotes);
    const cents = Math.round(closestMatch.result.cents);
    if (pitchElapsed > allowedMs) {
      return `\uBC15\uC790 \uB2A6\uC74C / ${pitchElapsed}ms / \uD5C8\uC6A9 ${allowedMs}ms / ${cents} cents`;
    }
    if (Math.abs(cents) > PITCH_TOLERANCE_CENTS) {
      return `\uC74C \uAD6C\uBCC4 \uC2E4\uD328 / ${pitchElapsed}ms / ${cents} cents`;
    }
    return `\uBC15\uC790 \uCC3D \uC9C0\uB098\uAC10 / ${elapsed}ms / \uD5C8\uC6A9 ${allowedMs}ms`;
  }
  function getScoreDiagnosticLabel(diagnostic: string) {
    if (diagnostic.includes("\uD53C\uCE58 \uAC10\uC9C0 \uC5C6\uC74C")) return "\uAC10\uC9C0X";
    if (diagnostic.includes("\uBC15\uC790 \uB2A6\uC74C")) return "\uB2A6\uC74C";
    if (diagnostic.includes("\uC74C\uC815 \uD754\uB4E4\uB9BC")) return "\uC74C\uC815";
    if (diagnostic.includes("\uC74C \uAD6C\uBCC4 \uC2E4\uD328")) return "\uC74C\uD2C0";
    if (diagnostic.includes("\uBC15\uC790 \uCC3D")) return "\uBC15\uC790";
    return "\uC2E4\uD328";
  }
  function setNoteFeedback(index: number, feedback: NoteFeedback) {
    noteFeedbackRef.current.set(index, feedback);
    scoreRef.current?.setNoteColor(index, feedback.noteColor);
    scoreRef.current?.setNoteLabel(index, feedback.label, feedback.labelColor);
  }
  function reapplyNoteFeedback() {
    setTimeout(() => {
      for (const [index, feedback] of noteFeedbackRef.current.entries()) {
        scoreRef.current?.setNoteColor(index, feedback.noteColor);
        scoreRef.current?.setNoteLabel(index, feedback.label, feedback.labelColor);
      }
    }, 0);
  }
  function getClosestPitchMatch(
    hz: number,
    candidateNotes: Array<NonNullable<typeof currentNote>>
  ) {
    const comparisons = candidateNotes.filter((note) => !note.isRest).flatMap((note) =>
      HARMONIC_CORRECTION_FACTORS.flatMap((harmonicFactor) =>
        [note.midi - 12, note.midi, note.midi + 12].map((targetMidi) => ({
          note,
          harmonicFactor,
          result: comparePitch({
            playedHz: hz / harmonicFactor,
            targetMidi,
            toleranceCents: PITCH_TOLERANCE_CENTS,
          }),
        }))
      )
    );
    if (!comparisons.length) {
      return {
        note: candidateNotes[0],
        harmonicFactor: 1,
        result: { playedMidi: 0, cents: Number.POSITIVE_INFINITY, matched: false },
      };
    }
    return comparisons.sort(
      (a, b) =>
        Math.abs(a.result.cents) - Math.abs(b.result.cents) ||
        a.harmonicFactor - b.harmonicFactor
    )[0];
  }
  function getNotesAtSameStart(note: NonNullable<typeof currentNote>) {
    const sameStartNotes = notes.filter(
      (candidate) =>
        candidate.measure === note.measure && Math.abs(candidate.startMs - note.startMs) < SAME_BEAT_MS
    );
    if (note.isRest) {
      return sameStartNotes.filter((candidate) => candidate.isRest);
    }
    const playableNotes = sameStartNotes.filter((candidate) => !candidate.isRest);
    return playableNotes.length ? playableNotes : sameStartNotes;
  }
  function formatNoteName(note: NonNullable<typeof currentNote>) {
    if (note.isRest) return "\uC27C\uD45C";
    const accidental = note.alter > 0 ? "#" : note.alter < 0 ? "b" : "";
    return `${note.step}${accidental}${note.octave}`;
  }
  function pitchMatchesNote(hz: number, note: NonNullable<typeof currentNote>) {
    return getClosestPitchMatch(hz, [note]).result.matched;
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
  function formatAchievementAccuracy(summary: SongAchievementSummary) {
    return summary.latestAccuracy === null ? "-" : `${summary.latestAccuracy}%`;
  }
  function formatAchievementWeakMeasures(summary: SongAchievementSummary) {
    return summary.weakMeasures.length
      ? summary.weakMeasures.map((item) => `${item.measure}\uB9C8\uB514`).join(" / ")
      : "\uC5C6\uC74C";
  }
  function formatWeakPracticeMeasures(session: WeakPracticeSession) {
    return session.weakMeasures.length
      ? session.weakMeasures.map((item) => `${item.measure}\uB9C8\uB514(${item.mistakeCount})`).join(" / ")
      : "\uC5C6\uC74C";
  }
  function formatFocusRange(range: FocusRange | { fromMeasure: number; toMeasure: number }) {
    return range.fromMeasure === range.toMeasure
      ? `${range.fromMeasure}\uB9C8\uB514`
      : `${range.fromMeasure}-${range.toMeasure}\uB9C8\uB514`;
  }
  function getPageForMeasure(measure: number) {
    return Math.max(1, Math.ceil(measure / measuresPerPage));
  }
  function formatFocusRangePages(range: FocusRange | { fromMeasure: number; toMeasure: number }) {
    const fromPage = getPageForMeasure(range.fromMeasure);
    const toPage = getPageForMeasure(range.toMeasure);
    return fromPage === toPage
      ? `${fromPage}\uD398\uC774\uC9C0`
      : `${fromPage},${toPage}\uD398\uC774\uC9C0`;
  }
  function refreshPracticeInsights(nextSongId = songId) {
    try {
      const focus = getFocusMeasuresForSong(nextSongId, 3);
      const latestSession = getLatestSessionForSong(nextSongId);
      setFocusMeasures(focus);
      setFocusRanges(getFocusRangesForSong(nextSongId, 5));
      setWeakPracticeSessions(getWeakPracticeSessionsForSong(nextSongId, 8));
      if (latestSession) {
        setResultSummary(
          `${latestSession.is_mastered ? "\uC644\uB8CC" : "\uC9C4\uD589 \uC911"} - \uD2C0\uB9B0 \uB9C8\uB514 ${
            latestSession.wrong_measure_count
          }\uAC1C, \uD2C0\uB9B0 \uC74C ${latestSession.wrong_note_count}\uAC1C`
        );
      } else {
        setResultSummary("\uC544\uC9C1 \uC800\uC7A5\uB41C \uACB0\uACFC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4");
      }
      setAchievementSessions(getSessionsForSong(nextSongId, 8));
      setAchievementSummaries(getSongAchievementSummaries());
    } catch {
      setFocusMeasures([]);
      setFocusRanges([]);
      setWeakPracticeSessions([]);
      setAchievementSessions([]);
      setAchievementSummaries([]);
    }
  }
  function recordMistake(
    note: NonNullable<typeof currentNote>,
    reason: "timeout" | "wrong_pitch",
    playedMidi: number | null = null
  ) {
    const alreadyRecorded = sessionMistakesRef.current.some(
      (mistake) => mistake.measure === note.measure && mistake.noteIndex === note.index
    );
    if (alreadyRecorded) return;
    sessionMistakesRef.current.push({
      songId,
      measure: note.measure,
      noteIndex: note.index,
      expectedMidi: note.midi,
      playedMidi,
      reason,
    });
  }
  function saveCurrentPracticeSession() {
    if (sessionSavedRef.current || notes.length === 0) return;
    const mistakes = sessionMistakesRef.current;
    const wrongMeasures = new Set(mistakes.map((mistake) => mistake.measure));
    const wrongMeasureCount = wrongMeasures.size;
    const wrongNoteCount = mistakes.length;
    const accuracy = Math.max(0, Math.round(((notes.length - wrongNoteCount) / notes.length) * 100));
    const isMastered = accuracy >= 90;
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
      `${isMastered ? "\uC644\uB8CC" : "\uC9C4\uD589 \uC911"} - \uD2C0\uB9B0 \uB9C8\uB514 ${wrongMeasureCount}\uAC1C, \uD2C0\uB9B0 \uC74C ${wrongNoteCount}\uAC1C`
    );
    refreshPracticeInsights(songId);
    refreshSavedSongs();
  }
  function findFirstNoteIndexForPage(page: number) {
    const from = (page - 1) * measuresPerPage + 1;
    const to = Math.min(measureCount, page * measuresPerPage);
    return findFirstNoteIndexForMeasureRange(from, to);
  }
  function findFirstNoteIndexForMeasureRange(from: number, to: number) {
    const index = notes.findIndex((note) => note.measure >= from && note.measure <= to);
    return index >= 0 ? index : 0;
  }
  function goToMeasurePage(page: number) {
    const boundedPage = Math.max(1, Math.min(totalMeasurePages, page));
    setScorePage(boundedPage);
    if (isListeningRef.current || micStarting || waitingToStart || countdown !== null) {
      return;
    }
    const firstIndex = findFirstNoteIndexForPage(boundedPage);
    currentIndexRef.current = firstIndex;
    setCurrentIndex(firstIndex);
    setAnalysisStatus("\uB9C8\uC774\uD06C \uB300\uAE30 \uC911");
    setIsListening(false);
    setMicStarting(false);
  }
  function openWeakMeasureOnScore(measure: number) {
    setPendingFocusMeasure(measure);
    setWeakScoreRange({ from: measure, to: measure });
    setWeakMistakeNoteIndices(getMistakeNoteIndicesForSongMeasure(songId, measure));
    setScoreViewVersion((version) => version + 1);
    setActiveSection("weakScore");
  }
  function openWeakRangeOnScore(range: FocusRange) {
    setPendingFocusMeasure(range.fromMeasure);
    setWeakScoreRange({ from: range.fromMeasure, to: range.toMeasure });
    setWeakMistakeNoteIndices(
      getMistakeNoteIndicesForSongMeasureRange(songId, range.fromMeasure, range.toMeasure)
    );
    setScoreViewVersion((version) => version + 1);
    setActiveSection("weakScore");
  }
  function practiceWeakMeasure(measure: number) {
    const firstIndex = notes.findIndex((note) => note.measure === measure);
    if (firstIndex < 0) {
      Alert.alert("Measure not found", "Could not find this measure in the current score.");
      return;
    }
    setFocusPracticeRange(null);
    setFocusPracticeMeasure(measure);
    currentIndexRef.current = firstIndex;
    setCurrentIndex(firstIndex);
    setScorePage(Math.max(1, Math.ceil(measure / measuresPerPage)));
    setPlayReturnSection("focus");
    setActiveSection("play");
    setAnalysisStatus(`\uC9D1\uC911 \uC5F0\uC2B5: ${measure}\uB9C8\uB514`);
  }
  function practiceCustomRange(centerMeasure?: number) {
    const fallbackFrom = centerMeasure ? Math.max(1, centerMeasure - 1) : 1;
    const fallbackTo = centerMeasure ? Math.min(measureCount, centerMeasure + 1) : fallbackFrom;
    const parsedFrom = Number(customRangeStart);
    const parsedTo = Number(customRangeEnd);
    const from = centerMeasure
      ? fallbackFrom
      : Math.max(1, Math.min(measureCount, Number.isFinite(parsedFrom) ? parsedFrom : fallbackFrom));
    const to = centerMeasure
      ? fallbackTo
      : Math.max(from, Math.min(measureCount, Number.isFinite(parsedTo) ? parsedTo : fallbackTo));
    const firstIndex = findFirstNoteIndexForMeasureRange(from, to);
    const firstNote = notes[firstIndex];
    if (!firstNote || firstNote.measure < from || firstNote.measure > to) {
      Alert.alert("Section not found", "Could not find playable notes in this measure range.");
      return;
    }
    setCustomRangeStart(String(from));
    setCustomRangeEnd(String(to));
    setFocusPracticeMeasure(null);
    setFocusPracticeRange({ from, to });
    setScoreViewVersion((version) => version + 1);
    currentIndexRef.current = firstIndex;
    setCurrentIndex(firstIndex);
    setScorePage(Math.max(1, Math.ceil(from / measuresPerPage)));
    setPlayReturnSection("focus");
    setActiveSection("play");
    setAnalysisStatus(`\uAD6C\uAC04 \uC5F0\uC2B5: ${from}-${to}\uB9C8\uB514`);
  }
  function returnFromPlay() {
    stopAnalysis();
    setActiveSection(playReturnSection);
  }
  function returnFromLibrary() {
    setActiveSection("home");
  }
  function returnFromFocus() {
    setActiveSection("home");
  }
  function returnFromWeakScore() {
    setActiveSection("focus");
  }
  function returnFromAchievement() {
    setActiveSection("home");
  }
  function markWeakMeasureOnScore(measure: number) {
    const indices = weakMistakeNoteIndices.length
      ? weakMistakeNoteIndices
      : notes.filter((candidate) => candidate.measure === measure).map((note) => note.index);
    for (const note of notes.filter((candidate) => indices.includes(candidate.index))) {
      scoreRef.current?.setNoteColor(note.index, "#e53935");
    }
  }
  function markWeakRangeOnScore(from: number, to: number) {
    const indices = weakMistakeNoteIndices.length
      ? weakMistakeNoteIndices
      : notes
        .filter((candidate) => candidate.measure >= from && candidate.measure <= to)
        .map((note) => note.index);
    for (const note of notes.filter((candidate) => indices.includes(candidate.index))) {
      scoreRef.current?.setNoteColor(note.index, "#e53935");
    }
  }
  function applyManualScoreTitle() {
    const nextTitle = sanitizeScoreTitle(editableScoreTitle) || "Imported Score";
    const nextXml = sanitizeMusicXmlDisplayText(musicXml, nextTitle);
    setSongTitle(nextTitle);
    setEditableScoreTitle(nextTitle);
    setMusicXml(nextXml);
    setScoreViewVersion((version) => version + 1);
    try {
      saveSong({
        id: createSongId(nextTitle),
        title: nextTitle,
        xmlContent: nextXml,
      });
      refreshSavedSongs();
    } catch {
      // Keep the manual title in the current session even if local save fails.
    }
  }
  function getBestImportedTitle(xml: string, fileName: string) {
    return (
      extractTitleFromMusicXml(xml) ||
      sanitizeScoreTitle(fileName.replace(/\.(mxl|musicxml|xml)$/i, "")) ||
      "Imported Score"
    );
  }
  function extractTitleFromMusicXml(xml: string) {
    const titleTags = ["movement-title", "work-title", "credit-words"];
    for (const tag of titleTags) {
      const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
      const title = match ? sanitizeScoreTitle(decodeXmlText(match[1])) : "";
      if (title) return title;
    }
    return "";
  }
  function decodeXmlText(text: string) {
    return text
      .replace(/<[^>]*>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
  }
  function encodeXmlText(text: string) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }
  function sanitizeMusicXmlDisplayText(xml: string, title: string) {
    let nextXml = xml;

    nextXml = nextXml.replace(/<credit\b[^>]*>[\s\S]*?<\/credit>/gi, "");
    nextXml = nextXml.replace(/<identification\b[^>]*>[\s\S]*?<\/identification>/gi, "");
    nextXml = nextXml.replace(/<creator\b[^>]*>[\s\S]*?<\/creator>/gi, "");
    nextXml = nextXml.replace(/<rights\b[^>]*>[\s\S]*?<\/rights>/gi, "");
    nextXml = nextXml.replace(/<movement-title\b[^>]*>[\s\S]*?<\/movement-title>/gi, "");
    nextXml = nextXml.replace(/<work-title\b[^>]*>[\s\S]*?<\/work-title>/gi, "");
    nextXml = nextXml.replace(/<work-number\b[^>]*>[\s\S]*?<\/work-number>/gi, "");
    nextXml = nextXml.replace(/<part-name\b[^>]*>[\s\S]*?<\/part-name>/gi, "<part-name>Guitar</part-name>");
    nextXml = nextXml.replace(
      /<instrument-name\b[^>]*>[\s\S]*?<\/instrument-name>/gi,
      "<instrument-name>Guitar</instrument-name>"
    );

    return nextXml;
  }
  function hideTempoMarksForScore(xml: string) {
    return xml
      .replace(/<direction\b[^>]*>[\s\S]*?<metronome\b[\s\S]*?<\/direction>/gi, "")
      .replace(/\s*<sound\b[^>]*tempo="[^"]*"[^/]*\/>/gi, "");
  }
  function replaceXmlTextTag(xml: string, tag: string, safeText: string) {
    const pattern = new RegExp(`<${tag}\\b([^>]*)>[\\s\\S]*?<\\/${tag}>`, "gi");
    if (pattern.test(xml)) {
      return xml.replace(pattern, `<${tag}$1>${safeText}</${tag}>`);
    }

    return xml;
  }
  function sanitizeScoreTitle(title: string) {
    const cleaned = title.replace(/\s+/g, " ").trim();
    if (!cleaned || isProbablyGarbledTitle(cleaned)) return "";
    return cleaned;
  }
  function isProbablyGarbledTitle(title: string) {
    const questionMarks = (title.match(/\?/g) ?? []).length;
    const suspiciousChars = (title.match(/[熬곭솾?η넭?곕쳜?좑옙]/g) ?? []).length;
    return (
      title.includes("\uFFFD") ||
      /\?{3,}/.test(title) ||
      questionMarks >= Math.max(3, Math.ceil(title.length * 0.25)) ||
      suspiciousChars >= 2
    );
  }
  if (activeSection === "home") {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.homeHeader}>
          <Text style={styles.homeTitle}>{"\uAE30\uD0C0 \uC5F0\uC2B5"}</Text>
          <Text style={styles.homeSubtitle}>{songTitle}</Text>
        </View>
        <View style={styles.categoryList}>
          <Pressable style={styles.categoryButton} onPress={() => setActiveSection("library")}>
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryBadgeText}>1</Text>
            </View>
            <View style={styles.categoryTextBlock}>
              <Text style={styles.categoryTitle}>{"\uC5F0\uC8FC\uD558\uAE30"}</Text>
              <Text style={styles.categorySubtitle}>{"\uC800\uC7A5\uB41C \uC545\uBCF4\uB97C \uC120\uD0DD\uD558\uACE0 \uC5F0\uC2B5\uD569\uB2C8\uB2E4"}</Text>
            </View>
          </Pressable>
          <Pressable style={styles.categoryButton} onPress={() => setActiveSection("focus")}>
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryBadgeText}>2</Text>
            </View>
            <View style={styles.categoryTextBlock}>
              <Text style={styles.categoryTitle}>{"\uCDE8\uC57D \uBD80\uBD84 \uC5F0\uC2B5\uD558\uAE30"}</Text>
              <Text style={styles.categorySubtitle}>{"\uC790\uC8FC \uD2C0\uB9B0 \uB9C8\uB514\uB97C \uB2E4\uC2DC \uC5F0\uC2B5\uD569\uB2C8\uB2E4"}</Text>
            </View>
          </Pressable>
          <Pressable style={styles.categoryButton} onPress={() => setActiveSection("achievement")}>
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryBadgeText}>3</Text>
            </View>
            <View style={styles.categoryTextBlock}>
              <Text style={styles.categoryTitle}>{"\uC131\uCDE8\uB3C4 \uD655\uC778\uD558\uAE30"}</Text>
              <Text style={styles.categorySubtitle}>{"\uD604\uC7AC \uC9C4\uD589 \uC911\uC778 \uACE1\uACFC \uC644\uB8CC\uD55C \uACE1\uC744 \uD655\uC778\uD569\uB2C8\uB2E4"}</Text>
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
          <Pressable style={styles.backButton} onPress={returnFromLibrary}>
            <Text style={styles.backButtonText}>{"\uD648"}</Text>
          </Pressable>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>{"\uC545\uBCF4 \uC120\uD0DD"}</Text>
            <Text style={styles.subtitle}>{"\uC800\uC7A5\uB41C \uC545\uBCF4 "}{visibleSavedSongs.length}{"\uAC1C"}</Text>
          </View>
          <Pressable style={styles.importButton} onPress={importMusicXml}>
            <Text style={styles.importButtonText}>{"\uBD88\uB7EC\uC624\uAE30"}</Text>
          </Pressable>
        </View>
        <ScrollView style={styles.placeholderPanel} contentContainerStyle={styles.placeholderContent}>
          <Pressable style={styles.samplePracticeButton} onPress={practiceSampleScore}>
            <Text style={styles.samplePracticeTitle}>{"\uC815\uD655\uB3C4 \uD655\uC778 \uACE1"}</Text>
            <Text style={styles.samplePracticeSubtitle}>{"8\uBD84\uC74C\uD45C\uC640 \uBE60\uB978 \uC74C \uD310\uC815\uC744 \uD655\uC778\uD569\uB2C8\uB2E4"}</Text>
          </Pressable>
          <View style={styles.sectionHeaderBlock}>
            <Text style={styles.sectionHeaderTitle}>{"\uAE30\uBCF8 \uC81C\uACF5 \uC545\uBCF4"}</Text>
            <Text style={styles.sectionHeaderSubtitle}>
              {"\uC800\uC791\uAD8C \uC704\uD5D8\uC744 \uC904\uC774\uAE30 \uC704\uD574 \uACF5\uC720 \uAC00\uB2A5\uD55C \uC791\uACE1\uAC00 \uAE30\uBC18\uC758 \uC5F0\uC2B5\uC6A9 MusicXML\uB9CC \uB123\uC5C8\uC2B5\uB2C8\uB2E4."}
            </Text>
          </View>
          {BUILTIN_SCORES.map((score) => (
            <Pressable
              key={score.id}
              style={styles.builtinScoreButton}
              onPress={() => openBuiltinScore(score)}
            >
              <View style={styles.builtinScoreTextBlock}>
                <Text style={styles.songTitle}>{score.title}</Text>
                <Text style={styles.songMeta}>
                  {score.composer}{" / "}{score.difficulty}
                </Text>
                <Text style={styles.builtinLicense}>{score.license}</Text>
              </View>
              <Text style={styles.builtinScoreAction}>{"\uBD88\uB7EC\uC624\uAE30"}</Text>
            </Pressable>
          ))}
          <View style={styles.sectionHeaderBlock}>
            <Text style={styles.sectionHeaderTitle}>{"\uC800\uC7A5\uB41C \uC545\uBCF4"}</Text>
          </View>
          {visibleSavedSongs.length ? (
            visibleSavedSongs.map((song) => (
              <View key={song.id} style={styles.songRow}>
                <Pressable style={styles.songButton} onPress={() => openSavedSong(song.id)}>
                  <Text style={styles.songTitle}>{song.title}</Text>
                  <Text style={styles.songMeta}>{new Date(song.updatedAt).toLocaleString()}</Text>
                </Pressable>
                <Pressable style={styles.deleteSongButton} onPress={() => confirmDeleteSong(song)}>
                  <Text style={styles.deleteSongButtonText}>{"\uC0AD\uC81C"}</Text>
                </Pressable>
              </View>
            ))
          ) : (
            <Text style={styles.placeholderText}>
              {"\uC800\uC7A5\uB41C \uC545\uBCF4\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4. MusicXML \uD30C\uC77C\uC744 \uBD88\uB7EC\uC640 \uCD94\uAC00\uD558\uC138\uC694."}
            </Text>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }
  if (activeSection === "focus") {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={returnFromFocus}>
            <Text style={styles.backButtonText}>{"\uD648"}</Text>
          </Pressable>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>{"\uCDE8\uC57D \uBD80\uBD84 \uC5F0\uC2B5\uD558\uAE30"}</Text>
            <Text style={styles.subtitle}>
              {focusSelectedSongId ? songTitle : "\uACE1\uC744 \uC120\uD0DD\uD558\uC138\uC694"}
            </Text>
          </View>
        </View>
        <ScrollView style={styles.placeholderPanel} contentContainerStyle={styles.placeholderContent}>
          <Text style={styles.placeholderTitle}>{"\uACE1 \uC120\uD0DD"}</Text>
          {focusSelectableSongs.length ? (
            focusSelectableSongs.map((song) => {
              const isSelected = focusSelectedSongId === createSongId(song.title);
              return (
                <View key={song.id} style={styles.songRow}>
                  <Pressable
                    style={[styles.songButton, isSelected && styles.activeSongButton]}
                    onPress={() => selectFocusSong(song)}
                  >
                    <Text style={styles.songTitle}>{song.title}</Text>
                    <Text style={styles.songMeta}>
                      {isSelected ? "\uC120\uD0DD\uB428" : new Date(song.updatedAt).toLocaleString()}
                    </Text>
                  </Pressable>
                </View>
              );
            })
          ) : (
            <Text style={styles.placeholderText}>
              {"\uD655\uC778\uD560 \uC545\uBCF4\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4. \uBA3C\uC800 MusicXML \uD30C\uC77C\uC744 \uBD88\uB7EC\uC624\uC138\uC694."}
            </Text>
          )}
          {focusSelectedSongId ? (
            <>
              <Text style={styles.placeholderTitle}>{"\uBC18\uBCF5 \uC5F0\uC2B5 \uD544\uC694 \uAD6C\uAC04"}</Text>
              {focusRanges.length ? (
                focusRanges.map((item, index) => (
                  <Pressable
                    key={`${item.fromMeasure}-${item.toMeasure}`}
                    style={styles.focusMeasureRow}
                    onPress={() => openWeakRangeOnScore(item)}
                  >
                    <View style={styles.focusMeasureTextBlock}>
                      <Text style={styles.focusMeasureTitle}>
                        {index + 1}{". \uAC00\uC7A5 \uB9CE\uC774 \uD2C0\uB9B0 \uAD6C\uAC04 "}{formatFocusRangePages(item)}
                      </Text>
                      <Text style={styles.focusMeasureMeta}>
                        {formatFocusRange(item)}{" / \uC774\uC804 \uC5F0\uC2B5\uC5D0\uC11C "}{item.mistakeCount}{"\uBC88 \uD2C0\uB9BC / \uB204\uB974\uBA74 \uC545\uBCF4 \uD655\uC778"}
                      </Text>
                    </View>
                    <Text style={styles.focusMeasureChevron}>{">"}</Text>
                  </Pressable>
                ))
              ) : (
                <Text style={styles.placeholderText}>{"\uC544\uC9C1 \uBC18\uBCF5\uD574\uC11C \uD2C0\uB9B0 \uAD6C\uAC04\uC774 \uC5C6\uC2B5\uB2C8\uB2E4."}</Text>
              )}
              <View style={styles.customRangeBox}>
                <Text style={styles.customRangeTitle}>{"\uC5F0\uC2B5 \uD544\uC694 \uAD6C\uAC04 \uC124\uC815\uD558\uAE30"}</Text>
                <View style={styles.customRangeControls}>
                  <TextInput
                    style={styles.rangeInput}
                    value={customRangeStart}
                    keyboardType="number-pad"
                    onChangeText={setCustomRangeStart}
                    placeholder="Start"
                  />
                  <Text style={styles.rangeSeparator}>-</Text>
                  <TextInput
                    style={styles.rangeInput}
                    value={customRangeEnd}
                    keyboardType="number-pad"
                    onChangeText={setCustomRangeEnd}
                    placeholder="End"
                  />
                  <Pressable style={styles.focusMeasureButton} onPress={() => practiceCustomRange()}>
                    <Text style={styles.focusMeasureButtonText}>{"\uB179\uC74C \uC2DC\uC791"}</Text>
                  </Pressable>
                </View>
              </View>
            </>
          ) : (
            <Text style={styles.placeholderText}>
              {"\uACE1\uC744 \uC120\uD0DD\uD558\uBA74 \uCDE8\uC57D \uBD80\uBD84\uC774 \uD45C\uC2DC\uB429\uB2C8\uB2E4."}
            </Text>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }
  if (activeSection === "weakScore") {
    const reviewMeasure = currentNote?.measure ?? pendingFocusMeasure ?? measureFrom;
    const reviewRange = weakScoreRange ?? { from: reviewMeasure, to: reviewMeasure };
    const reviewMeasureFrom = reviewRange.from;
    const reviewMeasureTo = reviewRange.to;
    const reviewNoteIndexOffset = findFirstNoteIndexForMeasureRange(reviewMeasureFrom, reviewMeasureTo);
    const reviewRangeLabel =
      reviewMeasureFrom === reviewMeasureTo
        ? `${reviewMeasureFrom}\uB9C8\uB514`
        : `${reviewMeasureFrom}-${reviewMeasureTo}\uB9C8\uB514`;
    const reviewPageLabel = formatFocusRangePages({
      fromMeasure: reviewMeasureFrom,
      toMeasure: reviewMeasureTo,
    });
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={returnFromWeakScore}>
            <Text style={styles.backButtonText}>{"\uB4A4\uB85C"}</Text>
          </Pressable>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>{"\uCDE8\uC57D \uAD6C\uAC04 \uC545\uBCF4"}</Text>
            <Text style={styles.subtitle}>
              {songTitle} - {reviewPageLabel}
            </Text>
          </View>
          <Pressable style={styles.importButton} onPress={() => setActiveSection("focus")}>
            <Text style={styles.importButtonText}>{"\uBAA9\uB85D"}</Text>
          </Pressable>
        </View>
        <View style={styles.score}>
          <ScoreWebView
            key={`weak-score-${scoreViewVersion}`}
            ref={scoreRef}
            musicXml={scoreDisplayXml}
            layoutMode={layoutMode}
            measureFrom={reviewMeasureFrom}
            measureTo={reviewMeasureTo}
            noteIndexOffset={reviewNoteIndexOffset}
            useLowestChordNoteOnly={useLowestChordNoteOnly}
            onPitch={() => {}}
            onFftPitchClasses={() => {}}
            onScoreReady={(payload) => {
              stopRenderTimeout();
              setScoreStatus(
              `\uC900\uBE44\uB428 - ${reviewPageLabel} - ${reviewRangeLabel}`
              );
              setTimeout(() => markWeakRangeOnScore(reviewMeasureFrom, reviewMeasureTo), 250);
              reapplyNoteFeedback();
            }}
            onScoreError={(message) => {
              stopRenderTimeout();
              setScoreStatus(message ? `\uB80C\uB354\uB9C1 \uB300\uCCB4 \uD544\uC694: ${message}` : "\uB80C\uB354\uB9C1 \uB300\uCCB4 \uD544\uC694");
            }}
            onNoteMapWarning={() => {
              setNoteColorAvailable(false);
              setAnalysisStatus("\uC74C\uD45C \uC0C9\uC0C1 \uD45C\uC2DC \uBD88\uAC00");
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
          <Text style={styles.label}>{"\uD655\uC778"}</Text>
            <Text style={styles.value}>{"\uBE68\uAC04 \uC74C\uD45C\uB294 \uC800\uC7A5\uB41C \uC2E4\uC218 \uC704\uCE58\uC785\uB2C8\uB2E4"}</Text>
          </View>
          <View style={styles.statusRow}>
            <Text style={styles.label}>{"\uC545\uBCF4"}</Text>
            <Text style={styles.value}>{scoreStatus}</Text>
          </View>
          <View style={styles.statusRow}>
            <Text style={styles.label}>{"\uCDE8\uC57D \uAD6C\uAC04"}</Text>
            <Text style={styles.value}>
              {focusMeasures.length
                ? focusMeasures.map((item) => `M${item.measure}(${item.mistakeCount})`).join(" / ")
                : "\uC544\uC9C1 \uCDE8\uC57D \uAD6C\uAC04\uC774 \uC5C6\uC2B5\uB2C8\uB2E4"}
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
          <Pressable style={styles.backButton} onPress={returnFromAchievement}>
            <Text style={styles.backButtonText}>{"\uD648"}</Text>
          </Pressable>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>{"\uC131\uCDE8\uB3C4 \uD655\uC778\uD558\uAE30"}</Text>
            <Text style={styles.subtitle}>{songTitle}</Text>
          </View>
        </View>
        <ScrollView style={styles.placeholderPanel} contentContainerStyle={styles.placeholderContent}>
          <View style={styles.achievementTabs}>
            <Pressable
              style={[
                styles.achievementTabButton,
                achievementView === "progress" && styles.activeAchievementTabButton,
              ]}
              onPress={() => setAchievementView("progress")}
            >
              <Text
                style={[
                  styles.achievementTabTitle,
                  achievementView === "progress" && styles.activeAchievementTabTitle,
                ]}
              >
                {"\uC5F0\uC2B5 \uC911\uC778 \uACE1"}
              </Text>
              <Text
                style={[
                  styles.achievementTabCount,
                  achievementView === "progress" && styles.activeAchievementTabCount,
                ]}
              >
                {inProgressAchievementSummaries.length}{"\uAC1C"}
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.achievementTabButton,
                achievementView === "mastered" && styles.activeAchievementTabButton,
              ]}
              onPress={() => setAchievementView("mastered")}
            >
              <Text
                style={[
                  styles.achievementTabTitle,
                  achievementView === "mastered" && styles.activeAchievementTabTitle,
                ]}
              >
                {"\uB9C8\uC2A4\uD130 \uACE1"}
              </Text>
              <Text
                style={[
                  styles.achievementTabCount,
                  achievementView === "mastered" && styles.activeAchievementTabCount,
                ]}
              >
                {masteredAchievementSummaries.length}{"\uAC1C"}
              </Text>
            </Pressable>
          </View>
          {achievementView === "progress" ? (
            <>
              <Text style={styles.placeholderTitle}>{"\uC5F0\uC2B5 \uC911\uC778 \uACE1"}</Text>
              {visibleInProgressAchievementSummaries.length ? (
                visibleInProgressAchievementSummaries.map((summary) => (
                  <View key={summary.songId} style={styles.achievementRow}>
                    <View style={styles.achievementTextBlock}>
                      <Text style={styles.achievementTitle}>{summary.title}</Text>
                      <Text style={styles.achievementMeta}>
                        {"\uC815\uD655\uB3C4 "}{formatAchievementAccuracy(summary)}{" / \uC5F0\uC2B5 "}{summary.sessionCount}{"\uD68C / \uD2C0\uB9B0 \uB9C8\uB514 "}{summary.latestWrongMeasureCount ?? "-"}{"\uAC1C"}
                      </Text>
                      <Text style={styles.achievementDate}>
                        {"\uB9C8\uC2A4\uD130 \uAE30\uC900: 90% \uC774\uC0C1 3\uD68C, 80% \uC774\uC0C1\uC740 \uC720\uC9C0 / \uCDE8\uC57D \uAD6C\uAC04: "}{formatAchievementWeakMeasures(summary)}
                      </Text>
                    </View>
                  </View>
                ))
              ) : (
                <Text style={styles.placeholderText}>{"\uC544\uC9C1 \uC5F0\uC2B5 \uC911\uC778 \uACE1\uC774 \uC5C6\uC2B5\uB2C8\uB2E4."}</Text>
              )}
              {inProgressAchievementSummaries.length > 3 ? (
                <Pressable
                  style={styles.primaryWideButton}
                  onPress={() => setShowAllInProgressSongs((current) => !current)}
                >
                  <Text style={styles.primaryWideButtonText}>
                    {showAllInProgressSongs ? "\uC811\uAE30" : "\uB354\uBCF4\uAE30"}
                  </Text>
                </Pressable>
              ) : null}
            </>
          ) : (
            <>
              <Text style={styles.placeholderTitle}>{"\uB9C8\uC2A4\uD130 \uACE1"}</Text>
              {visibleMasteredAchievementSummaries.length ? (
                visibleMasteredAchievementSummaries.map((summary) => (
                  <View key={summary.songId} style={styles.achievementRow}>
                    <View style={styles.achievementTextBlock}>
                      <Text style={styles.achievementTitle}>{summary.title}</Text>
                      <Text style={styles.achievementMeta}>
                        {"\uC815\uD655\uB3C4 "}{formatAchievementAccuracy(summary)}{" / \uC5F0\uC2B5 "}{summary.sessionCount}{"\uD68C / \uB9C8\uC2A4\uD130"}
                      </Text>
                      <Text style={styles.achievementDate}>
                        {"90% \uC774\uC0C1 3\uD68C, 80% \uC774\uC0C1\uC740 \uC720\uC9C0 / \uCDE8\uC57D \uAD6C\uAC04: "}{formatAchievementWeakMeasures(summary)}
                      </Text>
                    </View>
                  </View>
                ))
              ) : (
                <Text style={styles.placeholderText}>{"\uC544\uC9C1 \uB9C8\uC2A4\uD130\uD55C \uACE1\uC774 \uC5C6\uC2B5\uB2C8\uB2E4."}</Text>
              )}
              {masteredAchievementSummaries.length > 5 ? (
                <Pressable
                  style={styles.primaryWideButton}
                  onPress={() => setShowAllMasteredSongs((current) => !current)}
                >
                  <Text style={styles.primaryWideButtonText}>
                    {showAllMasteredSongs ? "\uC811\uAE30" : "\uB354\uBCF4\uAE30"}
                  </Text>
                </Pressable>
              ) : null}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={returnFromPlay}>
          <Text style={styles.backButtonText}>{"\uB4A4\uB85C"}</Text>
        </Pressable>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{"\uC5F0\uC2B5 \uD654\uBA74"}</Text>
          <Text style={styles.subtitle}>
            {songTitle} - {notes.length}{"\uAC1C \uC74C\uD45C"}
          </Text>
        </View>
      </View>
      <View style={styles.score}>
        <ScoreWebView
          key={`score-${scoreViewVersion}`}
          ref={scoreRef}
          musicXml={scoreDisplayXml}
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
              `\uC900\uBE44\uB428 - ${measureFrom}-${measureTo}/${measureCount}, ${notes.length}\uAC1C \uC74C\uD45C, ${
                payload?.svgCount ?? 0
              } svg, ${payload?.height ?? 0}px, ${payload?.renderMode ?? layoutMode}`
            );
            reapplyNoteFeedback();
            setTimeout(() => {
              scoreRef.current?.setNoteColor(currentIndexRef.current, "#1565c0");
              scoreRef.current?.scrollToNote(currentIndexRef.current);
            }, 250);
          }}
          onScoreError={(message) => {
            stopRenderTimeout();
            setScoreStatus(
              message ? `\uB80C\uB354\uB9C1 \uB300\uCCB4 \uD544\uC694: ${message}` : "\uB80C\uB354\uB9C1 \uB300\uCCB4 \uD544\uC694"
            );
          }}
          onNoteMapWarning={() => {
            setNoteColorAvailable(false);
            setAnalysisStatus("\uC74C\uD45C \uC0C9\uC0C1 \uD45C\uC2DC \uBD88\uAC00");
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
            setAnalysisStatus(`\uB9C8\uC774\uD06C \uC0AC\uC6A9 \uBD88\uAC00: ${message}`);
            startNativeMeterFallback();
            if (waitingToStart) {
              beginCountdown();
            }
          }}
        />
      </View>
      <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent}>
        <Pressable style={styles.samplePracticeButton} onPress={practiceSampleScore}>
          <Text style={styles.samplePracticeTitle}>{"\uC815\uD655\uB3C4 \uD655\uC778 \uACE1"}</Text>
          <Text style={styles.samplePracticeSubtitle}>{"\uC774 \uC5F0\uC2B5 \uD654\uBA74\uC5D0\uC11C \uD14C\uC2A4\uD2B8 \uC545\uBCF4\uB85C \uBC14\uB85C \uBC14\uAFC9\uB2C8\uB2E4"}</Text>
        </Pressable>
        <View style={styles.titleEditRow}>
          <TextInput
            style={styles.titleInput}
            value={editableScoreTitle}
            onChangeText={setEditableScoreTitle}
            placeholder="Score title"
            returnKeyType="done"
            onSubmitEditing={applyManualScoreTitle}
          />
          <Pressable style={styles.titleApplyButton} onPress={applyManualScoreTitle}>
            <Text style={styles.titleApplyButtonText}>{"\uC81C\uBAA9 \uC801\uC6A9"}</Text>
          </Pressable>
        </View>
        <View style={styles.pageControls}>
          <Pressable
            style={[styles.pageButton, scorePage <= 1 && styles.disabledButton]}
            disabled={scorePage <= 1}
            onPress={() => goToMeasurePage(scorePage - 1)}
          >
            <Text style={styles.pageButtonText}>{"\uC774\uC804"}</Text>
          </Pressable>
          <Text style={styles.pageText}>
            {scorePage}{"/"}{totalMeasurePages}{"\uD398\uC774\uC9C0 · "}
            {measureFrom}{"-"}{measureTo}{"\uB9C8\uB514"}
          </Text>
          <Pressable
            style={[styles.pageButton, scorePage >= totalMeasurePages && styles.disabledButton]}
            disabled={scorePage >= totalMeasurePages}
            onPress={() => goToMeasurePage(scorePage + 1)}
          >
            <Text style={styles.pageButtonText}>{"\uB2E4\uC74C"}</Text>
          </Pressable>
        </View>
        <View style={styles.analysisControls}>
          <Pressable
            style={[styles.analysisButton, (isListening || micStarting) && styles.disabledButton]}
            disabled={isListening || micStarting}
            onPress={() => startAnalysis("restart")}
          >
            <Text style={styles.analysisButtonText}>
              {micStarting || isListening || countdown ? startMicLabel : restartButtonLabel}
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
            <Text style={styles.resumeButtonText}>{"\uC774\uC5B4\uC11C"}</Text>
          </Pressable>
          <Pressable style={styles.stopButton} onPress={stopAnalysis}>
            <Text style={styles.stopButtonText}>{"\uC815\uC9C0"}</Text>
          </Pressable>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.label}>{"\uACB0\uACFC"}</Text>
          <Text style={styles.value}>{resultSummary}</Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.label}>{"\uCDE8\uC57D \uAD6C\uAC04"}</Text>
          <Text style={styles.value}>
            {focusMeasures.length
              ? focusMeasures.map((item) => `M${item.measure}(${item.mistakeCount})`).join(" / ")
              : "\uC544\uC9C1 \uCDE8\uC57D \uAD6C\uAC04\uC774 \uC5C6\uC2B5\uB2C8\uB2E4"}
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
  categoryBadge: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e6f0eb",
    borderWidth: 1,
    borderColor: "#9db7aa",
  },
  categoryBadgeText: {
    color: "#1f6f5b",
    fontSize: 18,
    lineHeight: 22,
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
  sectionHeaderBlock: {
    marginTop: 6,
    gap: 4,
  },
  sectionHeaderTitle: {
    color: "#1f2a25",
    fontSize: 17,
    fontWeight: "900",
  },
  sectionHeaderSubtitle: {
    color: "#66736b",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
  },
  builtinScoreButton: {
    minHeight: 88,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d8d2c4",
  },
  builtinScoreTextBlock: {
    flex: 1,
    gap: 2,
  },
  builtinLicense: {
    marginTop: 4,
    color: "#7b6f5b",
    fontSize: 11,
    fontWeight: "700",
  },
  builtinScoreAction: {
    color: "#1f6f5b",
    fontSize: 13,
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
  activeSongButton: {
    borderColor: "#1f6f5b",
    backgroundColor: "#eef7f2",
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
  focusMeasureChevron: {
    color: "#1f6f5b",
    fontSize: 24,
    fontWeight: "900",
  },
  customRangeBox: {
    borderRadius: 8,
    padding: 12,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d8d2c4",
    gap: 10,
  },
  customRangeTitle: {
    color: "#1f2a25",
    fontSize: 15,
    fontWeight: "900",
  },
  customRangeControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  rangeInput: {
    width: 76,
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#b9b19f",
    paddingHorizontal: 12,
    backgroundColor: "#fbfaf6",
    color: "#1f2a25",
    fontSize: 16,
    fontWeight: "800",
  },
  rangeSeparator: {
    color: "#66736b",
    fontSize: 18,
    fontWeight: "900",
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
  achievementTabs: {
    flexDirection: "row",
    gap: 10,
  },
  achievementTabButton: {
    flex: 1,
    minHeight: 76,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    justifyContent: "center",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d8d2c4",
  },
  activeAchievementTabButton: {
    backgroundColor: "#1f6f5b",
    borderColor: "#1f6f5b",
  },
  achievementTabTitle: {
    color: "#1f2a25",
    fontSize: 15,
    fontWeight: "900",
  },
  activeAchievementTabTitle: {
    color: "#ffffff",
  },
  achievementTabCount: {
    marginTop: 6,
    color: "#66736b",
    fontSize: 18,
    fontWeight: "900",
  },
  activeAchievementTabCount: {
    color: "#ffffff",
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
  titleEditRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  titleInput: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#b9b19f",
    paddingHorizontal: 12,
    backgroundColor: "#ffffff",
    color: "#1f2a25",
    fontSize: 15,
    fontWeight: "800",
  },
  titleApplyButton: {
    minHeight: 44,
    borderRadius: 8,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1f6f5b",
  },
  titleApplyButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900",
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
  diagnosticBox: {
    minHeight: 58,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    justifyContent: "center",
    backgroundColor: "#fff7d6",
    borderWidth: 1,
    borderColor: "#d9b94f",
  },
  diagnosticLabel: {
    color: "#6f5600",
    fontSize: 12,
    fontWeight: "900",
  },
  diagnosticValue: {
    marginTop: 4,
    color: "#1f2a25",
    fontSize: 15,
    fontWeight: "900",
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
