import { useEffect, useMemo, useRef, useState } from "react";
import {
  AudioModule,
  createAudioPlayer,
  getRecordingPermissionsAsync,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from "expo-audio";
import {
  Alert,
  KeyboardAvoidingView,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type DimensionValue,
} from "react-native";
import { ScoreWebView, ScoreWebViewHandle } from "./src/components/ScoreWebView";
import {
  clearPracticeMistakesForSongMeasureRange,
  FocusMeasure,
  FocusRange,
  getRecentFocusMistakesForSong,
  getRecentPracticeSessionIdsForSong,
  getLatestSessionForSong,
  getLatestMistakeNoteIndicesForSong,
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
import { BASIC_GUITAR_PITCH_TEST_XML } from "./src/sample/basicGuitarPitchTest";
import { SAMPLE_MUSIC_XML } from "./src/sample/sampleMusicXml";
import { PracticeMistakeDraft } from "./src/types/practice";
import { PracticeNote } from "./src/types/music";
import {
  loginWithEmail,
  logoutFirebase,
  signupWithEmail,
  subscribeToAuthState,
} from "./src/firebase/auth";
import { FirebaseConfigError, getFirebaseConfigErrorMessage } from "./src/firebase/firebaseApp";
type AppSection =
  | "home"
  | "library"
  | "play"
  | "focus"
  | "weakScore"
  | "achievement"
  | "tuner";
type AchievementView = "all" | "recentMonth" | "mastered" | "progress" | "review";
const PITCH_JUDGMENT = {
  toleranceCents: 70,
  nearMissCents: 120,
  minDirectClarity: 0.2,
  minAttackClarity: 0.14,
};
const TIMING_JUDGMENT = {
  minMissGraceMs: 0,
  maxMissGraceMs: 0,
  missGraceRatio: 0,
  pitchGraceBeforeNoteMs: 140,
};
const ATTACK_JUDGMENT = {
  fastNoteMs: 500,
  minWindowMs: 95,
  maxWindowMs: 210,
  minMatchRatio: 0.34,
  guitarAttackRequiredAfterMs: 220,
};
const FFT_JUDGMENT = {
  minPeakDb: -62,
};
const DEFAULT_PRACTICE_BPM = 80;
const FIREBASE_AUTH_ENABLED = true;
const LOCAL_AUTH_USER = {
  name: "연습자",
  email: "local@practice.app",
};
const ACCURACY_TEST_SONG_TITLE = "\uC815\uD655\uB3C4 \uD655\uC778 \uACE1";
const HARMONIC_CORRECTION_FACTORS = [1, 2, 3, 4];
const GUITAR_SOUNDING_OCTAVE_OFFSET = -12;
const USE_HIGHEST_CHORD_NOTE_FOR_JUDGMENT = true;
const TUNER_STRINGS = [
  { name: "1번줄 E", midi: 64 },
  { name: "2번줄 B", midi: 59 },
  { name: "3번줄 G", midi: 55 },
  { name: "4번줄 D", midi: 50 },
  { name: "5번줄 A", midi: 45 },
  { name: "6번줄 E", midi: 40 },
];
type NoteFeedback = {
  noteColor: string;
  label: string;
  labelColor: string;
};
export default function App() {
  const SAME_START_MS = 2;
  const scoreRef = useRef<ScoreWebViewHandle>(null);
  const renderTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const noteTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const noteEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteTransitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attackDecisionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nativeMeterTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pitchWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nativeRecorderRef = useRef<any>(null);
  const performanceRecorderRef = useRef<any>(null);
  const playbackPlayerRef = useRef<any>(null);
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
  const noteAttackSeenRef = useRef(false);
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
  const showPracticeHighlightsRef = useRef(false);
  const suppressScoreColorsRef = useRef(false);
  const practiceBpmRef = useRef(DEFAULT_PRACTICE_BPM);
  const sessionMistakesRef = useRef<PracticeMistakeDraft[]>([]);
  const sessionAttemptedEventKeysRef = useRef<Set<string>>(new Set());
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
  const [tunerActive, setTunerActive] = useState(false);
  const [tunerStatus, setTunerStatus] = useState("마이크 대기 중");
  const [tunerHz, setTunerHz] = useState<number | null>(null);
  const [tunerClarity, setTunerClarity] = useState<number | null>(null);
  const [selectedTunerStringIndex, setSelectedTunerStringIndex] = useState(0);
  const [practiceBpm, setPracticeBpm] = useState(DEFAULT_PRACTICE_BPM);
  const [practiceStats, setPracticeStats] = useState<{
    accuracy: number | null;
    correctNotes: number;
    totalNotes: number;
  }>({ accuracy: null, correctNotes: 0, totalNotes: 0 });
  const [focusMeasures, setFocusMeasures] = useState<FocusMeasure[]>([]);
  const [focusRanges, setFocusRanges] = useState<FocusRange[]>([]);
  const [weakPracticeSessions, setWeakPracticeSessions] = useState<WeakPracticeSession[]>([]);
  const [latestMistakeNoteIndices, setLatestMistakeNoteIndices] = useState<number[]>([]);
  const [focusSelectedSongId, setFocusSelectedSongId] = useState<string | null>(null);
  const [resultSummary, setResultSummary] = useState("\uC544\uC9C1 \uC800\uC7A5\uB41C \uACB0\uACFC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4");
  const [achievementSessions, setAchievementSessions] = useState<SongPracticeSessionSummary[]>([]);
  const [achievementSummaries, setAchievementSummaries] = useState<SongAchievementSummary[]>([]);
  const [showAllMasteredSongs, setShowAllMasteredSongs] = useState(false);
  const [showAllInProgressSongs, setShowAllInProgressSongs] = useState(false);
  const [showAllPracticedSongs, setShowAllPracticedSongs] = useState(false);
  const [showAllReviewSongs, setShowAllReviewSongs] = useState(false);
  const [showAllRecentMonthSongs, setShowAllRecentMonthSongs] = useState(false);
  const [achievementView, setAchievementView] = useState<AchievementView>("progress");
  const [selectedAchievementSongId, setSelectedAchievementSongId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<AppSection>("home");
  const [playReturnSection, setPlayReturnSection] = useState<"library" | "focus" | "home">("library");
  const [savedSongs, setSavedSongs] = useState<SavedSong[]>([]);
  const [pendingFocusMeasure, setPendingFocusMeasure] = useState<number | null>(null);
  const [weakScoreRange, setWeakScoreRange] = useState<{ from: number; to: number } | null>(null);
  const [focusPracticeMeasure, setFocusPracticeMeasure] = useState<number | null>(null);
  const [focusPracticeRange, setFocusPracticeRange] = useState<{ from: number; to: number } | null>(
    null
  );
  const [isRangeSelectionMode, setIsRangeSelectionMode] = useState(false);
  const [rangeSelectionStartMeasure, setRangeSelectionStartMeasure] = useState<number | null>(null);
  const [isRangeSelectionReady, setIsRangeSelectionReady] = useState(false);
  const [rangeSelectionStartIndex, setRangeSelectionStartIndex] = useState<number | null>(null);
  const [customNoteRange, setCustomNoteRange] = useState<{ fromIndex: number; toIndex: number } | null>(null);
  const [customRangeStart, setCustomRangeStart] = useState("1");
  const [customRangeEnd, setCustomRangeEnd] = useState("1");
  const [weakMistakeNoteIndices, setWeakMistakeNoteIndices] = useState<number[]>([]);
  const [scoreViewVersion, setScoreViewVersion] = useState(0);
  const [showPracticeHighlights, setShowPracticeHighlights] = useState(false);
  const [showPracticeSidePanel, setShowPracticeSidePanel] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ name: string; email: string } | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [loginName, setLoginName] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginMode, setLoginMode] = useState<"login" | "signup">("login");
  const [authError, setAuthError] = useState("");
  const songId = useMemo(() => createSongId(songTitle), [songTitle]);
  const accuracyTestSongId = useMemo(() => createSongId(ACCURACY_TEST_SONG_TITLE), []);
  const startMicLabel = countdown
    ? `${countdown}\uCD08 \uD6C4 \uC2DC\uC791`
    : micStarting
      ? "\uC900\uBE44 \uC911..."
      : isListening
        ? "\uB4E3\uB294 \uC911"
        : "\uB9C8\uC774\uD06C \uC2DC\uC791";
  const restartButtonLabel = customNoteRange || focusPracticeRange || focusPracticeMeasure !== null
    ? "\uC5F0\uC8FC \uC2DC\uC791\uD558\uAE30"
    : canResumeFromMistake
      ? "\uC5F0\uC8FC \uC2DC\uC791\uD558\uAE30"
      : "\uC5F0\uC8FC \uC2DC\uC791\uD558\uAE30";
  const isPracticeRunning = isListening || micStarting || waitingToStart || countdown !== null;
  const notes = useMemo(
    () => parseMusicXml(musicXml, useLowestChordNoteOnly),
    [musicXml, useLowestChordNoteOnly]
  );
  const currentNote = notes[currentIndex];
  const currentTargetNotes = currentNote ? getNotesAtSameStart(currentNote) : [];
  const currentTargetLabel = currentTargetNotes.length
    ? currentTargetNotes.map(formatNoteName).join(" / ")
    : "--";
  const selectedTunerString = TUNER_STRINGS[selectedTunerStringIndex] ?? TUNER_STRINGS[0];
  const tunerReading = tunerHz ? getTunerReading(tunerHz, selectedTunerString) : null;
  const targetPitchText = currentNote
    ? currentNote.isRest
      ? "\uC27C\uD45C"
      : currentTargetNotes
        .map((note) => `${formatNoteName(note)} ${midiToHz(getSoundingMidi(note)).toFixed(1)} Hz`)
        .join(" / ")
    : "--";
  const practiceAccuracyText =
    practiceStats.accuracy === null ? "--" : `${practiceStats.accuracy}%`;
  const practiceCorrectText = practiceStats.totalNotes
    ? `${practiceStats.correctNotes}/${practiceStats.totalNotes}`
    : "--";
  const realAchievementSummaries = useMemo(
    () => achievementSummaries.filter((summary) => summary.songId !== accuracyTestSongId),
    [achievementSummaries, accuracyTestSongId]
  );
  const masteredAchievementSummaries = useMemo(
    () => realAchievementSummaries.filter((summary) => summary.latestIsMastered),
    [realAchievementSummaries]
  );
  const practicedAchievementSummaries = useMemo(
    () =>
      realAchievementSummaries
        .filter((summary) => summary.sessionCount > 0)
        .sort((a, b) => (b.lastPracticedAt ?? "").localeCompare(a.lastPracticedAt ?? "")),
    [realAchievementSummaries]
  );
  const recentMonthAchievementSummaries = useMemo(
    () =>
      realAchievementSummaries
        .filter((summary) => summary.recentMonthSessionCount > 0)
        .sort(
          (a, b) =>
            (a.recentMonthAccuracy ?? 0) - (b.recentMonthAccuracy ?? 0) ||
            (b.lastPracticedAt ?? "").localeCompare(a.lastPracticedAt ?? "")
        ),
    [realAchievementSummaries]
  );
  const inProgressAchievementSummaries = useMemo(
    () =>
      realAchievementSummaries.filter(
        (summary) => summary.sessionCount > 0 && !summary.latestIsMastered
      ),
    [realAchievementSummaries]
  );
  const reviewAchievementSummaries = useMemo(
    () =>
      inProgressAchievementSummaries
        .filter((summary) => summary.latestAccuracy !== null && summary.latestAccuracy < 90)
        .sort(
          (a, b) =>
            (a.latestAccuracy ?? 0) - (b.latestAccuracy ?? 0) ||
            (b.lastPracticedAt ?? "").localeCompare(a.lastPracticedAt ?? "")
        ),
    [inProgressAchievementSummaries]
  );
  const visibleMasteredAchievementSummaries = showAllMasteredSongs
    ? masteredAchievementSummaries
    : masteredAchievementSummaries.slice(0, 5);
  const visibleInProgressAchievementSummaries = showAllInProgressSongs
    ? inProgressAchievementSummaries
    : inProgressAchievementSummaries.slice(0, 3);
  const visiblePracticedAchievementSummaries = showAllPracticedSongs
    ? practicedAchievementSummaries
    : practicedAchievementSummaries.slice(0, 5);
  const visibleRecentMonthAchievementSummaries = showAllRecentMonthSongs
    ? recentMonthAchievementSummaries
    : recentMonthAchievementSummaries.slice(0, 5);
  const visibleReviewAchievementSummaries = showAllReviewSongs
    ? reviewAchievementSummaries
    : reviewAchievementSummaries.slice(0, 3);
  const practicedSongCount = practicedAchievementSummaries.length;
  const totalPracticeSessionCount = realAchievementSummaries.reduce(
    (total, summary) => total + summary.sessionCount,
    0
  );
  const visibleSavedSongs = useMemo(
    () => savedSongs.filter((song) => song.id !== accuracyTestSongId),
    [savedSongs, accuracyTestSongId]
  );
  const focusSelectableSongs = useMemo(
    () =>
      savedSongs
        .filter((song) => song.id !== accuracyTestSongId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [savedSongs, accuracyTestSongId]
  );
  const scoreDisplayXml = useMemo(
    () => hideTempoMarksForScore(sanitizeMusicXmlDisplayText(musicXml, editableScoreTitle || songTitle)),
    [editableScoreTitle, musicXml, songTitle]
  );
  const measureCount = useMemo(() => countMeasures(musicXml), [musicXml]);
  const measuresPerPage = 6;
  const totalMeasurePages = Math.max(1, Math.ceil(measureCount / measuresPerPage));
  const customNoteRangeStartNote = customNoteRange
    ? notes.find((note) => note.index === customNoteRange.fromIndex)
    : undefined;
  const customNoteRangeEndNote = customNoteRange
    ? notes.find((note) => note.index === customNoteRange.toIndex)
    : undefined;
  const measureFrom = customNoteRangeStartNote
    ? customNoteRangeStartNote.measure
    : focusPracticeRange
    ? focusPracticeRange.from
    : 1;
  const measureTo = customNoteRangeEndNote
    ? customNoteRangeEndNote.measure
    : focusPracticeRange
    ? focusPracticeRange.to
    : measureCount;
  const noteIndexOffset = useMemo(
    () =>
      focusPracticeRange
        ? findFirstNoteIndexForMeasureRange(focusPracticeRange.from, focusPracticeRange.to)
        : findFirstNoteIndexForMeasureRange(measureFrom, measureTo),
    [customNoteRange, focusPracticeRange, measureFrom, measureTo, notes, measureCount]
  );
  useEffect(() => {
    if (!FIREBASE_AUTH_ENABLED) {
      setCurrentUser(LOCAL_AUTH_USER);
      setAuthError("");
      setAuthLoaded(true);
      return undefined;
    }

    try {
      const unsubscribe = subscribeToAuthState((user) => {
        setCurrentUser(
          user
            ? {
                name: user.displayName || user.email?.split("@")[0] || "사용자",
                email: user.email || "",
              }
            : null
        );
        setAuthLoaded(true);
      });
      return unsubscribe;
    } catch (error) {
      setAuthError(getFirebaseAuthErrorMessage(error));
      setAuthLoaded(true);
      return undefined;
    }
  }, []);
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
    setCustomNoteRange(null);
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
    showPracticeHighlightsRef.current = showPracticeHighlights;
  }, [showPracticeHighlights]);
  useEffect(() => {
    if (activeSection !== "play") return;
    if (suppressScoreColorsRef.current) return;
    scheduleScoreColorReapply();
  }, [showPracticeSidePanel]);
  useEffect(() => {
    if (activeSection !== "play" || !latestMistakeNoteIndices.length) return;
    const timer = setTimeout(() => {
      applyLatestMistakeHighlights();
    }, 350);
    return () => clearTimeout(timer);
  }, [activeSection, latestMistakeNoteIndices, scoreViewVersion]);
  useEffect(() => {
    if (activeSection === "play") {
      setShowPracticeHighlights(false);
    }
  }, [activeSection, songId, focusPracticeRange, focusPracticeMeasure, customNoteRange]);
  useEffect(() => {
    if (!currentNote) return;
    if (customNoteRange) return;
    if (focusPracticeRange) return;
    const pageForCurrentNote = Math.ceil(currentNote.measure / measuresPerPage);
    const boundedPage = Math.max(1, Math.min(totalMeasurePages, pageForCurrentNote));
    if (boundedPage !== scorePage) {
      setScorePage(boundedPage);
    }
  }, [currentNote, customNoteRange, focusPracticeRange, measuresPerPage, scorePage, totalMeasurePages]);
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
    if (noteEndTimerRef.current) {
      clearTimeout(noteEndTimerRef.current);
      noteEndTimerRef.current = null;
    }
    if (noteTransitionTimerRef.current) {
      clearTimeout(noteTransitionTimerRef.current);
      noteTransitionTimerRef.current = null;
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
  async function submitLogin() {
    if (!FIREBASE_AUTH_ENABLED) {
      const message = "현재 로그인 기능은 임시로 비활성화되어 있습니다.";
      setAuthError(message);
      Alert.alert("로그인 비활성화", message);
      return;
    }

    const name = loginName.trim();
    if (!name) {
      setAuthError("이름을 입력해주세요.");
      Alert.alert("로그인 오류", "이름을 입력해주세요.");
      return;
    }
    if (loginPassword.trim().length < 6) {
      setAuthError("비밀번호는 6자 이상 입력해주세요.");
      Alert.alert("로그인 오류", "비밀번호는 6자 이상 입력해주세요.");
      return;
    }
    const email = createFirebaseEmailFromName(name);
    try {
      setAuthError("");
      if (loginMode === "signup") {
        await signupWithEmail(email, loginPassword, name);
      } else {
        await loginWithEmail(email, loginPassword);
      }
      setLoginPassword("");
    } catch (error) {
      const message = getFirebaseAuthErrorMessage(error);
      setAuthError(message);
      Alert.alert("로그인 오류", message);
    }
  }
  async function logout() {
    await stopAnalysis({ saveSession: true });
    stopTuner();
    if (!FIREBASE_AUTH_ENABLED) {
      setCurrentUser(LOCAL_AUTH_USER);
      setActiveSection("home");
      setSelectedAchievementSongId(null);
      Alert.alert("로그인 비활성화", "현재는 로컬 연습 모드로 실행 중입니다.");
      return;
    }

    try {
      await logoutFirebase();
      setActiveSection("home");
      setSelectedAchievementSongId(null);
    } catch (error) {
      const message = getFirebaseAuthErrorMessage(error);
      setAuthError(message);
      Alert.alert("로그아웃 오류", message);
    }
  }
  function getFirebaseAuthErrorMessage(error: unknown) {
    if (error instanceof FirebaseConfigError) {
      return getFirebaseConfigErrorMessage(error);
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Firebase configuration is missing")) {
      return getFirebaseConfigErrorMessage(error);
    }
    if (message.includes("auth/configuration-not-found")) {
      return "Firebase Auth 설정이 아직 완료되지 않았습니다. Firebase Console에서 이메일/비밀번호 로그인을 켜고 환경변수를 확인해주세요.";
    }
    if (message.includes("auth/invalid-api-key") || message.includes("apiKey")) {
      return "Firebase API 키가 비어 있거나 올바르지 않습니다. .env의 EXPO_PUBLIC_FIREBASE_API_KEY 값을 확인해주세요.";
    }
    if (message.includes("auth/email-already-in-use")) return "이미 가입된 이름입니다.";
    if (message.includes("auth/invalid-credential") || message.includes("auth/wrong-password")) {
      return "이름 또는 비밀번호가 올바르지 않습니다.";
    }
    if (message.includes("auth/user-not-found")) return "가입되지 않은 이름입니다.";
    if (message.includes("auth/weak-password")) return "비밀번호가 너무 약합니다. 6자 이상으로 입력해주세요.";
    if (message.includes("auth/invalid-email")) return "이메일 형식이 올바르지 않습니다.";
    return message;
  }
  function createFirebaseEmailFromName(name: string) {
    const normalizedName = name.trim().toLowerCase();
    const slug =
      normalizedName
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9._-]/g, "")
        .replace(/^-+|-+$/g, "") || "user";
    return `${slug}-${hashNameForAuth(normalizedName)}@guitar-practice.local`;
  }
  function hashNameForAuth(value: string) {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
      hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
    }
    return hash.toString(36);
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
    refreshPracticeInsights(
      nextSongId,
      parseMusicXml(sanitizeMusicXmlDisplayText(song.xmlContent, repairedTitle), useLowestChordNoteOnly)
    );
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
  function confirmClearFocusRange(range: FocusRange) {
    const selectedSongId = focusSelectedSongId;
    if (!selectedSongId) return;

    Alert.alert(
      "\uAD6C\uAC04 \uCD08\uAE30\uD654",
      `${formatFocusRange(range)}의 저장된 실수 기록만 지울까요?`,
      [
        { text: "\uCDE8\uC18C", style: "cancel" },
        {
          text: "\uCD08\uAE30\uD654",
          style: "destructive",
          onPress: () => {
            clearPracticeMistakesForSongMeasureRange(
              selectedSongId,
              range.fromMeasure,
              range.toMeasure
            );
            setWeakMistakeNoteIndices([]);
            setPendingFocusMeasure(null);
            setFocusPracticeMeasure(null);
            setFocusPracticeRange(null);
            refreshPracticeInsights(selectedSongId, notes);
            refreshSavedSongs();
          },
        },
      ]
    );
  }
  async function loadMusicXml(xml: string, title: string, shouldSave = true) {
    const trimmedXml = xml.trim();
    const nextTitle =
      sanitizeScoreTitle(title) || extractTitleFromMusicXml(trimmedXml) || "Imported Score";
    const displayXml = sanitizeMusicXmlDisplayText(trimmedXml, nextTitle);
    const parsedNotes = parseMusicXml(displayXml, useLowestChordNoteOnly);
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
    practiceBpmRef.current = DEFAULT_PRACTICE_BPM;
    setPracticeBpm(DEFAULT_PRACTICE_BPM);
    setPracticeStats({ accuracy: null, correctNotes: 0, totalNotes: parsedNotes.length });
    setIsListening(false);
    setMicStarting(false);
    setWaitingToStart(false);
    setCanResumeFromMistake(false);
    setWeakScoreRange(null);
    setFocusSelectedSongId(null);
    setIsRangeSelectionMode(false);
    setRangeSelectionStartMeasure(null);
    setIsRangeSelectionReady(false);
    setRangeSelectionStartIndex(null);
    setCustomNoteRange(null);
    stopCountdown();
    stopNoteTimer();
    stopNativeMeterFallback();
    stopPitchWatchdog();
    sessionMistakesRef.current = [];
    noteFeedbackRef.current = new Map();
    sessionSavedRef.current = false;
    refreshPracticeInsights(createSongId(nextTitle), parsedNotes);
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
  async function openExampleScore() {
    await loadMusicXml(BASIC_GUITAR_PITCH_TEST_XML, "Basic Guitar Pitch Test", false);
    setPlayReturnSection("library");
    setActiveSection("play");
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
  async function startPerformanceRecording() {
    if (performanceRecorderRef.current) return;
    try {
      await requestNativeMicrophonePermission();
      const recorder = new AudioModule.AudioRecorder({
        ...RecordingPresets.LOW_QUALITY,
        isMeteringEnabled: false,
        numberOfChannels: 1,
      });
      await recorder.prepareToRecordAsync();
      recorder.record();
      performanceRecorderRef.current = recorder;
    } catch {
      performanceRecorderRef.current = null;
    }
  }
  async function stopPerformanceRecording() {
    const recorder = performanceRecorderRef.current;
    if (!recorder) return null;
    performanceRecorderRef.current = null;

    try {
      await recorder.stop();
      return recorder.uri ?? recorder.getStatus?.().url ?? null;
    } catch {
      return recorder.uri ?? null;
    }
  }
  async function discardPerformanceRecording() {
    await stopPerformanceRecording();
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
    const startIndex = mode === "resume" ? currentIndexRef.current : getPracticeStartIndex();
    practiceBpmRef.current = clampPracticeBpm(practiceBpm);
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
      suppressScoreColorsRef.current = true;
      showPracticeHighlightsRef.current = false;
      setShowPracticeHighlights(false);
      await discardPerformanceRecording();
      await startPerformanceRecording();
      sessionMistakesRef.current = [];
      sessionAttemptedEventKeysRef.current = new Set();
      noteFeedbackRef.current = new Map();
      sessionSavedRef.current = false;
      setResultSummary("\uCC98\uC74C\uBD80\uD130 \uC5F0\uC2B5 \uC911");
      setScoreViewVersion((version) => version + 1);
      scoreRef.current?.clearPracticeMarks();
      setTimeout(() => scoreRef.current?.clearPracticeMarks(), 80);
      setTimeout(() => scoreRef.current?.clearPracticeMarks(), 200);
    } else {
      suppressScoreColorsRef.current = false;
      setResultSummary("\uC774\uC5B4\uC11C \uC5F0\uC2B5 \uC911");
    }
    setTimeout(() => scoreRef.current?.startMic(), mode === "restart" ? 350 : 0);
    stopPitchWatchdog();
    pitchWatchdogRef.current = setTimeout(() => {
      if (!receivedPitchRef.current) {
        startNativeMeterFallback();
      }
    }, 5000);
  }
  function getPracticeStartIndex() {
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
  async function stopAnalysis(options?: { saveSession?: boolean }) {
    if (options?.saveSession && !sessionSavedRef.current && (isListeningRef.current || sessionMistakesRef.current.length > 0)) {
      await saveCurrentPracticeSession();
    } else {
      await discardPerformanceRecording();
    }
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
    suppressScoreColorsRef.current = false;
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
      if (targetNote.isRest) continue;
      scoreRef.current?.setNoteProgress(targetNote.index, 0);
    }
    const judgmentNotes = getJudgmentNotesAtSameStart(note);
    setAnalysisStatus(note.isRest ? "\uC27C\uD45C \uC9C0\uB098\uAC00\uB294 \uC911" : `${judgmentNotes.map(formatNoteName).join("/")} \uC5F0\uC8FC`);
    noteTimerRef.current = setInterval(() => {
      const activeNote = notes[currentIndexRef.current];
      if (!activeNote) return;
      const elapsed = Date.now() - noteStartedAtRef.current;
      const activeEventDurationMs = getEventDurationMs(activeNote);
      for (const targetNote of getNotesAtSameStart(activeNote)) {
        if (targetNote.isRest) continue;
        const progress = elapsed / activeEventDurationMs;
        scoreRef.current?.setNoteProgress(targetNote.index, progress);
      }
    }, 33);
    noteEndTimerRef.current = setTimeout(() => {
      noteEndTimerRef.current = null;
      const activeNote = notes[currentIndexRef.current];
      if (!activeNote) return;
      if (activeNote.isRest) {
        passCurrentNote();
        return;
      }
      matchedRef.current ? passCurrentNote() : failCurrentNote();
    }, eventDurationMs);
  }
  function getMissGraceMs(durationMs: number) {
    return Math.min(
      TIMING_JUDGMENT.maxMissGraceMs,
      Math.max(TIMING_JUDGMENT.minMissGraceMs, durationMs * TIMING_JUDGMENT.missGraceRatio)
    );
  }
  function clampPracticeBpm(value: number) {
    return Math.max(40, Math.min(180, Math.round(value)));
  }
  function adjustPracticeBpm(amount: number) {
    if (isPracticeRunning) return;
    setPracticeBpm((current) => {
      const nextBpm = clampPracticeBpm(current + amount);
      practiceBpmRef.current = nextBpm;
      return nextBpm;
    });
  }
  function getBeatUnitQuarterLength(beatType: number) {
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
  function getAttackWindowMs(durationMs: number) {
    return Math.min(
      ATTACK_JUDGMENT.maxWindowMs,
      Math.max(ATTACK_JUDGMENT.minWindowMs, durationMs * 0.65)
    );
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
    if (elapsedMs < ignoreMs || elapsedMs > windowMs || payload.clarity < PITCH_JUDGMENT.minAttackClarity) return;
    attackPitchSamplesRef.current.push({ hz: payload.hz, clarity: payload.clarity, elapsedMs });
  }
  function decideAttackPitch(noteIndex: number) {
    attackDecisionTimerRef.current = null;
    if (!isListeningRef.current || currentIndexRef.current !== noteIndex || matchedRef.current) return;
    const activeNote = notes[noteIndex];
    if (!activeNote) return;
    const candidateNotes = getJudgmentNotesAtSameStart(activeNote);
    const samples = attackPitchSamplesRef.current.filter(
      (sample) => sample.clarity >= PITCH_JUDGMENT.minAttackClarity
    );
    const sampleMatches = samples.map((sample) => ({
      sample,
      match: getClosestPitchMatch(sample.hz, candidateNotes),
    }));
    const totalWeight = sampleMatches.reduce((total, item) => total + item.sample.clarity, 0);
    const matchedWeight = sampleMatches.reduce(
      (total, item) => total + (item.match.result.matched ? item.sample.clarity : 0),
      0
    );
    const matchRatio = totalWeight > 0 ? matchedWeight / totalWeight : 0;
    const bestSample = sampleMatches
      .filter((item) => item.match.result.matched)
      .sort(
        (a, b) =>
          Math.abs(a.match.result.cents) - Math.abs(b.match.result.cents) ||
          b.sample.clarity - a.sample.clarity
      )[0];
    if (bestSample && matchRatio >= ATTACK_JUDGMENT.minMatchRatio) {
      matchedRef.current = true;
      setLastPlayedMidi(
        `${bestSample.match.result.playedMidi} (${Math.round(bestSample.match.result.cents)} cents)`
      );
      setAnalysisStatus(`${formatNoteName(bestSample.match.note)} 감지`);
      setDiagnosticStatus(
        `어택 OK / ${bestSample.sample.elapsedMs}ms / ${Math.round(bestSample.match.result.cents)} cents / ${Math.round(matchRatio * 100)}%`
      );
      setMatchedEventFeedback(activeNote, "OK");
    }
  }
  function getNextIndexAfterSameStart(note: NonNullable<typeof currentNote>) {
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
    if (noteTransitionTimerRef.current) {
      clearTimeout(noteTransitionTimerRef.current);
      noteTransitionTimerRef.current = null;
    }
    noteTransitionTimerRef.current = setTimeout(() => {
      noteTransitionTimerRef.current = null;
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
    return Math.min(...groupNotes.map((groupNote) => getNoteDurationForPractice(groupNote)));
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
    return `${note.measure}:${Math.round(note.startMs)}`;
  }
  function markPracticeEventAttempted(note: NonNullable<typeof currentNote>) {
    if (getNotesAtSameStart(note).every((groupNote) => groupNote.isRest)) return;
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
        if (groupNote.isRest) continue;
        setNoteFeedback(groupNote.index, {
          noteColor: "#e53935",
          label: getScoreDiagnosticLabel(diagnostic),
          labelColor: "#c62828",
        });
      }
      setDiagnosticStatus(diagnostic);
      const bestPitch = currentNoteBestPitchRef.current;
      recordMistake(
        groupNotes[0] ?? note,
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
          ? "\uC9D1\uC911 \uC5F0\uC2B5 \uC644\uB8CC"
          : matched
            ? "\uC644\uB8CC"
            : "\uC2E4\uC218 \uD3EC\uD568 \uC644\uB8CC"
      );
      void saveCurrentPracticeSession();
      return;
    }
    void continueToNextPracticeEvent(
      note,
      nextIndex,
      matched ? "\uC815\uD655" : "\uB193\uCE68 - \uACC4\uC18D \uC9C4\uD589"
    );
  }
  function passCurrentNote() {
    finishCurrentEvent(true);
  }
  function failCurrentNote() {
    finishCurrentEvent(false);
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
    if (payload.isAttack) {
      noteAttackSeenRef.current = true;
    }
    if (attackModeRef.current) {
      collectAttackPitch(activeNote, payload);
    }
    matchPitchForNote(activeNote, payload);
  }
  function handleTunerPitch(payload: { hz: number; clarity: number; rms?: number; isAttack?: boolean }) {
    if (payload.clarity < PITCH_JUDGMENT.minDirectClarity) return;
    setTunerHz(payload.hz);
    setTunerClarity(payload.clarity);
    const reading = getTunerReading(payload.hz, selectedTunerString);
    const absCents = Math.abs(reading.cents);
    if (absCents <= 8) {
      setTunerStatus("정확합니다");
    } else if (reading.cents < 0) {
      setTunerStatus("낮습니다. 줄을 조이세요");
    } else {
      setTunerStatus("높습니다. 줄을 푸세요");
    }
  }
  function getTunerReading(hz: number, stringInfo = selectedTunerString) {
    return {
      ...stringInfo,
      hz: midiToHz(stringInfo.midi),
      cents: comparePitch({
        playedHz: hz,
        targetMidi: stringInfo.midi,
        toleranceCents: 0,
      }).cents,
    };
  }
  async function startTuner() {
    setTunerStatus("마이크 시작 중...");
    setTunerActive(true);
    await requestNativeMicrophonePermission();
    scoreRef.current?.startMic();
  }
  function stopTuner() {
    setTunerActive(false);
    setTunerStatus("마이크 대기 중");
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
    const candidateNotes = getJudgmentNotesAtSameStart(activeNote);
    const strongestPeak = payload.peaks[0];
    if (!strongestPeak || strongestPeak.db < FFT_JUDGMENT.minPeakDb) {
      return;
    }
    const elapsedMs = Date.now() - noteStartedAtRef.current;
    if (!noteAttackSeenRef.current && elapsedMs > ATTACK_JUDGMENT.guitarAttackRequiredAfterMs) {
      setDiagnosticStatus(`지속음 제외 / ${elapsedMs}ms / 기타 어택 없음`);
      return;
    }
    const matchedCandidate = candidateNotes.find((note) => {
      const targetPitchClass = ((getSoundingMidi(note) % 12) + 12) % 12;
      return payload.pitchClasses.includes(targetPitchClass);
    });
    const fftMatch = getBestFftPitchMatch(payload.peaks, candidateNotes);
    if (matchedCandidate && fftMatch?.result.matched) {
      setLastPlayedMidi(
        fftMatch.peak ? `FFT ${fftMatch.peak.hz} Hz / ${fftMatch.peak.db} dB` : "FFT matched"
      );
      setAnalysisStatus(`${formatNoteName(fftMatch.note)} 감지`);
      setDiagnosticStatus(
        `FFT \uBCF4\uC870 \uAC10\uC9C0 / ${Date.now() - noteStartedAtRef.current}ms / ${fftMatch.peak.db} dB / ${Math.round(fftMatch.result.cents)} cents`
      );
      matchedRef.current = true;
      setMatchedEventFeedback(activeNote, "FFT OK");
    }
  }
  function matchPitchForNote(
    activeNote: NonNullable<typeof currentNote>,
    payload: { hz: number; clarity: number; rms?: number; isAttack?: boolean }
  ) {
    if (payload.clarity < PITCH_JUDGMENT.minDirectClarity) {
      return;
    }
    const candidateNotes = getJudgmentNotesAtSameStart(activeNote);
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
      if (!isLikelyGuitarAttackForCurrentNote(payload, elapsedMs)) {
        setAnalysisStatus("기타 어택 대기 중");
        setDiagnosticStatus(`지속음 제외 / ${elapsedMs}ms / 기타 어택 없음`);
        return;
      }
      setAnalysisStatus(`${formatNoteName(closestMatch.note)} 감지`);
      setDiagnosticStatus(
        `\uC74C OK / ${elapsedMs}ms / ${Math.round(result.cents)} cents`
      );
      matchedRef.current = true;
      setMatchedEventFeedback(activeNote, "OK");
    } else {
      setAnalysisStatus(`${candidateNotes.map(formatNoteName).join("/")} 대기 중`);
      setDiagnosticStatus(
        `\uC74C \uB2E4\uB984 / ${elapsedMs}ms / ${Math.round(result.cents)} cents`
      );
    }
  }
  function isLikelyGuitarAttackForCurrentNote(
    payload: { isAttack?: boolean },
    elapsedMs: number
  ) {
    if (payload.isAttack) return true;
    if (noteAttackSeenRef.current) return true;
    return elapsedMs <= ATTACK_JUDGMENT.guitarAttackRequiredAfterMs;
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
      if (Math.abs(bestPitch.cents) <= PITCH_JUDGMENT.nearMissCents) {
        return `\uC74C\uC815 \uD754\uB4E4\uB9BC / ${bestPitch.elapsedMs}ms / ${bestCents} cents`;
      }
    }
    if (!payload || payload.receivedAt < noteStartedAtRef.current - TIMING_JUDGMENT.pitchGraceBeforeNoteMs) {
      return `\uD53C\uCE58 \uAC10\uC9C0 \uC5C6\uC74C / ${elapsed}ms / \uD5C8\uC6A9 ${allowedMs}ms`;
    }
    const pitchElapsed = Math.max(0, payload.receivedAt - noteStartedAtRef.current);
    const candidateNotes = getJudgmentNotesAtSameStart(note);
    const closestMatch = getClosestPitchMatch(payload.hz, candidateNotes);
    const cents = Math.round(closestMatch.result.cents);
    if (pitchElapsed > allowedMs) {
      return `\uBC15\uC790 \uB2A6\uC74C / ${pitchElapsed}ms / \uD5C8\uC6A9 ${allowedMs}ms / ${cents} cents`;
    }
    if (Math.abs(cents) > PITCH_JUDGMENT.toleranceCents) {
      return `\uC74C \uAD6C\uBCC4 \uC2E4\uD328 / ${pitchElapsed}ms / ${cents} cents`;
    }
    return `\uBC15\uC790 \uCC3D \uC9C0\uB098\uAC10 / ${elapsed}ms / \uD5C8\uC6A9 ${allowedMs}ms`;
  }
  function getScoreDiagnosticLabel(diagnostic: string) {
    if (diagnostic.includes("\uD53C\uCE58 \uAC10\uC9C0 \uC5C6\uC74C")) return "\uAC10\uC9C0X";
    if (diagnostic.includes("\uBC15\uC790 \uB2A6\uC74C")) return "\uB2A6\uC74C";
    if (diagnostic.includes("\uC74C\uC815 \uD754\uB4E4\uB9BC")) return "\uC74C\uC815";
    if (diagnostic.includes("\uC74C \uAD6C\uBCC4 \uC2E4\uD328")) return "\uC74C\uB960";
    if (diagnostic.includes("\uBC15\uC790 \uCC3D")) return "\uBC15\uC790";
    return "\uC2E4\uD328";
  }
  function isPlayableNoteIndex(index: number) {
    return notes.some((note) => note.index === index && !note.isRest);
  }
  function setPracticeNoteColor(index: number, color: string) {
    if (!isPlayableNoteIndex(index)) return;
    scoreRef.current?.setNoteColor(index, color);
  }
  function setPracticeNoteLabel(index: number, text: string, color?: string) {
    if (!isPlayableNoteIndex(index)) return;
    scoreRef.current?.setNoteLabel(index, text, color);
  }
  function setNoteFeedback(index: number, feedback: NoteFeedback) {
    if (!isPlayableNoteIndex(index)) return;
    noteFeedbackRef.current.set(index, feedback);
    setPracticeNoteColor(index, feedback.noteColor);
    setPracticeNoteLabel(index, feedback.label, feedback.labelColor);
  }
  function setMatchedEventFeedback(note: NonNullable<typeof currentNote>, label: string) {
    for (const groupNote of getNotesAtSameStart(note)) {
      if (groupNote.isRest) continue;
      setNoteFeedback(groupNote.index, {
        noteColor: "#2e7d32",
        label,
        labelColor: "#2e7d32",
      });
    }
  }
  function togglePracticeHighlights() {
    if (showPracticeHighlights) {
      showPracticeHighlightsRef.current = false;
      setShowPracticeHighlights(false);
      scoreRef.current?.resetScore();
      reapplyNoteFeedback({ includePracticeHighlights: false });
      return;
    }
    showPracticeHighlightsRef.current = true;
    setShowPracticeHighlights(true);
    setTimeout(() => {
      applyWeakScoreHighlights(true);
      applyLatestMistakeHighlights(true);
    }, 0);
  }
  function togglePracticeSidePanel() {
    setShowPracticeSidePanel((current) => !current);
    scheduleScoreColorReapply();
  }
  function scheduleScoreColorReapply() {
    for (const delayMs of [0, 80, 180, 360, 700]) {
      setTimeout(() => {
        if (suppressScoreColorsRef.current) return;
        reapplyNoteFeedback();
      }, delayMs);
    }
  }
  function applyCurrentPracticeHighlight() {
    if (suppressScoreColorsRef.current) return;
    if (!isListeningRef.current) return;
    const activeNote = notes[currentIndexRef.current];
    if (!activeNote) return;
    for (const targetNote of getNotesAtSameStart(activeNote)) {
      if (targetNote.isRest) continue;
      scoreRef.current?.setNoteProgress(targetNote.index, 0);
    }
  }
  function applyWeakScoreHighlights(force = false) {
    if (suppressScoreColorsRef.current) return;
    if (!force && !showPracticeHighlightsRef.current) return;
    if (focusPracticeRange || focusPracticeMeasure !== null) return;

    const weakNoteIndices = new Set<number>();
    const mistakeNoteIndices = new Set<number>();
    for (const range of focusRanges) {
      for (const index of range.highlightNoteIndices ?? []) {
        weakNoteIndices.add(index);
      }
      for (const index of range.mistakeNoteIndices ?? []) {
        mistakeNoteIndices.add(index);
      }
    }

    for (const index of weakNoteIndices) {
      setPracticeNoteColor(index, "#f7c982");
    }
    for (const index of mistakeNoteIndices) {
      setPracticeNoteColor(index, "#c62828");
    }
  }
  function applyLatestMistakeHighlights(force = false) {
    if (suppressScoreColorsRef.current) return;
    if (!force && !showPracticeHighlightsRef.current) return;
    if (focusPracticeRange || focusPracticeMeasure !== null) return;
    for (const index of latestMistakeNoteIndices) {
      setPracticeNoteColor(index, "#c2410c");
      setPracticeNoteLabel(index, "");
    }
  }
  function reapplyNoteFeedback(options?: { includePracticeHighlights?: boolean }) {
    setTimeout(() => {
      if (suppressScoreColorsRef.current) return;
      if (options?.includePracticeHighlights !== false) {
        applyWeakScoreHighlights();
        applyLatestMistakeHighlights();
      }
      applyCurrentPracticeHighlight();
      for (const [index, feedback] of noteFeedbackRef.current.entries()) {
        setPracticeNoteColor(index, feedback.noteColor);
        setPracticeNoteLabel(index, feedback.label, feedback.labelColor);
      }
    }, 0);
  }
  function getClosestPitchMatch(
    hz: number,
    candidateNotes: Array<NonNullable<typeof currentNote>>
  ) {
    const comparisons = candidateNotes.filter((note) => !note.isRest).flatMap((note) =>
      HARMONIC_CORRECTION_FACTORS.flatMap((harmonicFactor) =>
        [getSoundingMidi(note)].map((targetMidi) => ({
          note,
          harmonicFactor,
          result: comparePitch({
            playedHz: hz / harmonicFactor,
            targetMidi,
            toleranceCents: PITCH_JUDGMENT.toleranceCents,
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
  function getBestFftPitchMatch(
    peaks: Array<{ hz: number; db: number }>,
    candidateNotes: Array<NonNullable<typeof currentNote>>
  ) {
    return peaks
      .filter((peak) => peak.db >= FFT_JUDGMENT.minPeakDb)
      .map((peak) => ({ ...getClosestPitchMatch(peak.hz, candidateNotes), peak }))
      .filter((item) => item.result.matched)
      .sort(
        (a, b) =>
          Math.abs(a.result.cents) - Math.abs(b.result.cents) ||
          b.peak.db - a.peak.db ||
          a.harmonicFactor - b.harmonicFactor
      )[0];
  }
  function getSoundingMidi(note: Pick<NonNullable<typeof currentNote>, "midi">) {
    return note.midi + GUITAR_SOUNDING_OCTAVE_OFFSET;
  }
  function getNotesAtSameStart(note: NonNullable<typeof currentNote>) {
    const sameStartNotes = notes.filter(
      (candidate) => !candidate.skipPractice && Math.abs(candidate.startMs - note.startMs) <= SAME_START_MS
    );
    if (note.isRest) {
      return sameStartNotes.filter((candidate) => candidate.isRest);
    }
    const playableNotes = sameStartNotes.filter((candidate) => !candidate.isRest);
    return playableNotes.length ? playableNotes : sameStartNotes;
  }
  function getJudgmentNotesAtSameStart(note: NonNullable<typeof currentNote>) {
    const playableNotes = getNotesAtSameStart(note).filter((candidate) => !candidate.isRest);
    if (!playableNotes.length) return getNotesAtSameStart(note);
    if (!USE_HIGHEST_CHORD_NOTE_FOR_JUDGMENT || playableNotes.length === 1) return playableNotes;
    return [
      playableNotes.reduce((highest, candidate) =>
        candidate.midi > highest.midi ? candidate : highest
      ),
    ];
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
  function getAchievementStatusLabel(summary: SongAchievementSummary) {
    if (summary.latestIsMastered) return "\uB9C8\uC2A4\uD130";
    if (summary.latestAccuracy === null) return "\uAE30\uB85D \uC5C6\uC74C";
    if (summary.latestAccuracy >= 90) return "\uB9C8\uC2A4\uD130 \uADFC\uC811";
    if (summary.latestAccuracy >= 80) return "\uC720\uC9C0 \uAD6C\uAC04";
    return "\uC9D1\uC911 \uD544\uC694";
  }
  function formatAchievementListMeta(summary: SongAchievementSummary) {
    return `\uCD5C\uADFC ${formatAchievementAccuracy(summary)} · 90% \uC774\uC0C1 ${Math.min(
      summary.highAccuracyStreak,
      3
    )}/3 · \uC5F0\uC2B5 ${summary.sessionCount}\uD68C`;
  }
  function formatRecentMonthAccuracy(summary: SongAchievementSummary) {
    return summary.recentMonthAccuracy === null ? "-" : `${summary.recentMonthAccuracy}%`;
  }
  function formatRecentMonthMeta(summary: SongAchievementSummary) {
    return `\uCD5C\uADFC \uD55C \uB2EC ${formatRecentMonthAccuracy(summary)} · \uC5F0\uC2B5 ${summary.recentMonthSessionCount}\uD68C`;
  }
  function getAccuracyBarWidth(summary: SongAchievementSummary): DimensionValue {
    return `${Math.max(0, Math.min(100, summary.latestAccuracy ?? 0))}%`;
  }
  function selectAchievementView(view: AchievementView) {
    setAchievementView(view);
    setSelectedAchievementSongId(null);
  }
  function openAchievementPractice(summary: SongAchievementSummary) {
    void openSavedSong(summary.songId);
  }
  function renderAchievementDetails(summary: SongAchievementSummary, practiceLabel: string) {
    const canPlayLatestPerformance = Boolean(summary.latestAudioUri);

    return (
      <>
        <View style={styles.accuracyTrack}>
          <View
            style={[
              styles.accuracyFill,
              summary.latestIsMastered && styles.masteredAccuracyFill,
              { width: getAccuracyBarWidth(summary) },
            ]}
          />
        </View>
        <View style={styles.achievementMetricRow}>
          <Text style={styles.achievementMetric}>
            {"\uC815\uD655\uB3C4 "}{formatAchievementAccuracy(summary)}
          </Text>
          <Text style={styles.achievementMetric}>
            {"90% \uC774\uC0C1 "}{Math.min(summary.highAccuracyStreak, 3)}{"/3"}
          </Text>
          <Text style={styles.achievementMetric}>
            {"\uC5F0\uC2B5 "}{summary.sessionCount}{"\uD68C"}
          </Text>
          <Text style={styles.achievementMetric}>
            {"\uD2C0\uB9B0 \uC74C "}{summary.latestWrongNoteCount ?? "-"}{"\uAC1C"}
          </Text>
          <Text style={styles.achievementMetric}>
            {"\uCD5C\uACE0 \uD2C0\uB9B0 \uB9C8\uB514 "}{summary.bestWrongMeasureCount ?? "-"}{"\uAC1C"}
          </Text>
          {summary.recentMonthSessionCount > 0 ? (
            <Text style={styles.achievementMetric}>
              {"\uCD5C\uADFC \uD55C \uB2EC "}{formatRecentMonthAccuracy(summary)}
            </Text>
          ) : null}
        </View>
        <Text style={styles.achievementDate}>
          {"80% \uC774\uC0C1\uC740 \uCE74\uC6B4\uD2B8 \uC720\uC9C0, 80% \uBBF8\uB9CC\uC740 \uCD08\uAE30\uD654 / \uCDE8\uC57D \uAD6C\uAC04: "}{formatAchievementWeakMeasures(summary)}
        </Text>
        <Pressable
          style={styles.achievementPracticeButton}
          onPress={() => openAchievementPractice(summary)}
        >
          <Text style={styles.achievementPracticeButtonText}>{practiceLabel}</Text>
        </Pressable>
        <Pressable
          style={[
            styles.performancePlayButton,
            !canPlayLatestPerformance && styles.disabledButton,
          ]}
          disabled={!canPlayLatestPerformance}
          onPress={() => playLatestPerformance(summary)}
        >
          <Text style={styles.performancePlayButtonText}>
            {"\uCD5C\uADFC \uC5F0\uC8FC \uB4E3\uAE30"}
          </Text>
        </Pressable>
      </>
    );
  }
  async function playLatestPerformance(summary: SongAchievementSummary) {
    if (!summary.latestAudioUri) {
      Alert.alert(
        "\uC5F0\uC8FC \uB179\uC74C \uC5C6\uC74C",
        "\uC774 \uACE1\uC740 \uC544\uC9C1 \uC800\uC7A5\uB41C \uCD5C\uADFC \uC5F0\uC8FC \uB179\uC74C\uC774 \uC5C6\uC2B5\uB2C8\uB2E4."
      );
      return;
    }

    try {
      playbackPlayerRef.current?.pause?.();
      playbackPlayerRef.current = createAudioPlayer({ uri: summary.latestAudioUri });
      playbackPlayerRef.current.play();
    } catch {
      Alert.alert(
        "\uC7AC\uC0DD \uC2E4\uD328",
        "\uCD5C\uADFC \uC5F0\uC8FC \uB179\uC74C\uC744 \uC7AC\uC0DD\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4."
      );
    }
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
  function getNoteBasedFocusInsights(nextSongId: string, noteSource: PracticeNote[]) {
    const playableNotes = noteSource.filter((note) => !note.isRest && !note.skipPractice);
    const sessionIds = getRecentPracticeSessionIdsForSong(nextSongId, 3);
    const sessionCount = Math.max(1, sessionIds.length);
    const recentMistakes = getRecentFocusMistakesForSong(nextSongId, sessionIds);
    const mistakeCountByNote = new Map<number, number>();

    for (const mistake of recentMistakes) {
      mistakeCountByNote.set(
        mistake.noteIndex,
        (mistakeCountByNote.get(mistake.noteIndex) ?? 0) + mistake.mistakeCount
      );
    }

    const notesByMeasure = new Map<number, PracticeNote[]>();
    for (const note of playableNotes) {
      const measureNotes = notesByMeasure.get(note.measure) ?? [];
      measureNotes.push(note);
      notesByMeasure.set(note.measure, measureNotes);
    }

    for (const measureNotes of notesByMeasure.values()) {
      measureNotes.sort((a, b) => a.startMs - b.startMs || a.index - b.index);
    }

    const ranges: FocusRange[] = [];
    const measures: FocusMeasure[] = [];
    const sortedMeasureNumbers = [...notesByMeasure.keys()].sort((a, b) => a - b);

    for (const measure of sortedMeasureNumbers) {
      const measureNotes = notesByMeasure.get(measure) ?? [];
      const mistakeCount = countMistakesForNotes(measureNotes, mistakeCountByNote);
      const denominator = measureNotes.length * sessionCount;
      const errorRate = denominator ? mistakeCount / denominator : 0;
      if (mistakeCount > 0 && errorRate >= 0.3) {
        const mistakeNoteIndices = getMistakeNoteIndicesForNotes(measureNotes, mistakeCountByNote);
        ranges.push({
          fromMeasure: measure,
          toMeasure: measure,
          mistakeCount,
          noteCount: measureNotes.length,
          errorRate,
          highlightNoteIndices: measureNotes.map((note) => note.index),
          mistakeNoteIndices,
        });
        measures.push({ measure, mistakeCount });
      }
    }

    for (let index = 0; index < sortedMeasureNumbers.length - 1; index += 1) {
      const fromMeasure = sortedMeasureNumbers[index];
      const toMeasure = sortedMeasureNumbers[index + 1];
      if (toMeasure !== fromMeasure + 1) continue;

      const currentNotes = notesByMeasure.get(fromMeasure) ?? [];
      const nextNotes = notesByMeasure.get(toMeasure) ?? [];
      const currentHalf = currentNotes.slice(Math.floor(currentNotes.length * 0.5));
      const nextHalf = nextNotes.slice(0, Math.ceil(nextNotes.length * 0.5));
      const virtualNotes = [...currentHalf, ...nextHalf];
      const mistakeCount = countMistakesForNotes(virtualNotes, mistakeCountByNote);
      const denominator = virtualNotes.length * sessionCount;
      const errorRate = denominator ? mistakeCount / denominator : 0;
      if (mistakeCount > 0 && errorRate >= 0.3) {
        const realMeasureNotes = [...currentNotes, ...nextNotes];
        const realMeasureMistakeCount = countMistakesForNotes(realMeasureNotes, mistakeCountByNote);
        const mistakeNoteIndices = getMistakeNoteIndicesForNotes(realMeasureNotes, mistakeCountByNote);
        ranges.push({
          fromMeasure,
          toMeasure,
          mistakeCount: realMeasureMistakeCount,
          noteCount: realMeasureNotes.length,
          errorRate,
          isVirtual: true,
          highlightNoteIndices: realMeasureNotes.map((note) => note.index),
          mistakeNoteIndices,
        });
      }
    }

    return {
      measures: measures
        .sort((a, b) => b.mistakeCount - a.mistakeCount || a.measure - b.measure)
        .slice(0, 3),
      ranges: ranges
        .sort(
          (a, b) =>
            (b.errorRate ?? 0) - (a.errorRate ?? 0) ||
            b.mistakeCount - a.mistakeCount ||
            a.fromMeasure - b.fromMeasure
        )
        .slice(0, 5),
    };
  }
  function countMistakesForNotes(notesToCount: PracticeNote[], mistakeCountByNote: Map<number, number>) {
    return notesToCount.reduce(
      (total, note) => total + (mistakeCountByNote.get(note.index) ?? 0),
      0
    );
  }
  function getMistakeNoteIndicesForNotes(
    notesToCount: PracticeNote[],
    mistakeCountByNote: Map<number, number>
  ) {
    return notesToCount
      .filter((note) => (mistakeCountByNote.get(note.index) ?? 0) > 0)
      .map((note) => note.index);
  }
  function formatFocusRange(range: FocusRange | { fromMeasure: number; toMeasure: number }) {
    return range.fromMeasure === range.toMeasure
      ? `${range.fromMeasure}\uB9C8\uB514`
      : `${range.fromMeasure}-${range.toMeasure}\uB9C8\uB514`;
  }
  function getPageForMeasure(measure: number) {
    return Math.max(1, Math.ceil(measure / measuresPerPage));
  }
  function formatFocusRangeScrollLabel(range: FocusRange | { fromMeasure: number; toMeasure: number }) {
    return range.fromMeasure === range.toMeasure
      ? `${range.fromMeasure}\uB9C8\uB514 \uADFC\uCC98`
      : `${range.fromMeasure}-${range.toMeasure}\uB9C8\uB514 \uAD6C\uAC04`;
  }
  function refreshPracticeInsights(nextSongId = songId, noteSource = notes) {
    try {
      const noteBasedFocus = getNoteBasedFocusInsights(nextSongId, noteSource);
      const latestSession = getLatestSessionForSong(nextSongId);
      setFocusMeasures(noteBasedFocus.measures);
      setFocusRanges(noteBasedFocus.ranges);
      setWeakPracticeSessions(getWeakPracticeSessionsForSong(nextSongId, 8));
      setLatestMistakeNoteIndices(getLatestMistakeNoteIndicesForSong(nextSongId));
      if (latestSession) {
        const latestCorrectNotes = Math.max(
          0,
          latestSession.total_notes - latestSession.wrong_note_count
        );
        const latestAccuracy = Math.max(
          0,
          Math.round((latestCorrectNotes / Math.max(1, latestSession.total_notes)) * 100)
        );
        setResultSummary(
          `${latestSession.is_mastered ? "\uC644\uB8CC" : "\uC9C4\uD589 \uC911"} - \uD2C0\uB9B0 \uB9C8\uB514 ${
            latestSession.wrong_measure_count
          }\uAC1C, \uD2C0\uB9B0 \uC74C ${latestSession.wrong_note_count}\uAC1C`
        );
        setPracticeStats({
          accuracy: latestAccuracy,
          correctNotes: latestCorrectNotes,
          totalNotes: latestSession.total_notes,
        });
      } else {
        setResultSummary("\uC544\uC9C1 \uC800\uC7A5\uB41C \uACB0\uACFC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4");
        setPracticeStats({ accuracy: null, correctNotes: 0, totalNotes: noteSource.length });
      }
      setAchievementSessions(getSessionsForSong(nextSongId, 8));
      setAchievementSummaries(getSongAchievementSummaries());
    } catch {
      setFocusMeasures([]);
      setFocusRanges([]);
      setWeakPracticeSessions([]);
      setLatestMistakeNoteIndices([]);
      setAchievementSessions([]);
      setAchievementSummaries([]);
      setPracticeStats({ accuracy: null, correctNotes: 0, totalNotes: noteSource.length });
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
  async function saveCurrentPracticeSession() {
    if (sessionSavedRef.current || notes.length === 0) return;
    sessionSavedRef.current = true;
    const mistakes = sessionMistakesRef.current;
    const wrongMeasures = new Set(mistakes.map((mistake) => mistake.measure));
    const wrongMeasureCount = wrongMeasures.size;
    const wrongNoteCount = mistakes.length;
    const attemptedEventCount = sessionAttemptedEventKeysRef.current.size;
    const totalNotes = Math.max(attemptedEventCount, wrongNoteCount);
    if (totalNotes === 0) {
      await discardPerformanceRecording();
      return;
    }
    const correctNotes = Math.max(0, totalNotes - wrongNoteCount);
    const accuracy = Math.max(0, Math.round((correctNotes / totalNotes) * 100));
    const isMastered = accuracy >= 90;
    const audioUri = await stopPerformanceRecording();
    savePracticeSession({
      songId,
      totalNotes,
      mistakes,
      wrongMeasureCount,
      wrongNoteCount,
      isMastered,
      audioUri,
    });
    setResultSummary(
      `${isMastered ? "\uC644\uB8CC" : "\uC9C4\uD589 \uC911"} - \uD2C0\uB9B0 \uB9C8\uB514 ${wrongMeasureCount}\uAC1C, \uD2C0\uB9B0 \uC74C ${wrongNoteCount}\uAC1C`
    );
    setPracticeStats({ accuracy, correctNotes, totalNotes });
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
  function openRangeSelectionOnScore() {
    setIsRangeSelectionMode(true);
    setRangeSelectionStartMeasure(null);
    setIsRangeSelectionReady(false);
    setRangeSelectionStartIndex(null);
    setCustomNoteRange(null);
    setPendingFocusMeasure(null);
    setWeakScoreRange({ from: 1, to: measureCount });
    setWeakMistakeNoteIndices([]);
    setScoreViewVersion((version) => version + 1);
    setActiveSection("weakScore");
  }
  function handleScoreNotePress(payload: { index: number }) {
    if (!isRangeSelectionMode) return;
    const pressedNote = notes.find((note) => note.index === payload.index);
    if (!pressedNote) return;
    const measure = pressedNote.measure;

    if (rangeSelectionStartMeasure === null) {
      scoreRef.current?.resetScore();
      setRangeSelectionStartMeasure(measure);
      setRangeSelectionStartIndex(payload.index);
      setIsRangeSelectionReady(false);
      setCustomRangeStart(String(measure));
      setCustomRangeEnd(String(measure));
      setAnalysisStatus(`${formatNoteName(pressedNote)} 시작 선택됨. 끝 음표를 악보에서 한 번 더 누르세요.`);
      markSelectedNoteRangePreview(payload.index, payload.index);
      setPracticeNoteColor(payload.index, "#ef8a24");
      setPracticeNoteLabel(payload.index, "시작", "#ef8a24");
      return;
    }

    const startIndex = rangeSelectionStartIndex ?? payload.index;
    const fromIndex = Math.min(startIndex, payload.index);
    const toIndex = Math.max(startIndex, payload.index);
    const fromMeasure = notes.find((note) => note.index === fromIndex)?.measure ?? measure;
    const toMeasure = notes.find((note) => note.index === toIndex)?.measure ?? measure;
    setCustomRangeStart(String(fromIndex));
    setCustomRangeEnd(String(toIndex));
    setCustomNoteRange({ fromIndex, toIndex });
    setRangeSelectionStartMeasure(null);
    setRangeSelectionStartIndex(null);
    setIsRangeSelectionReady(true);
    setAnalysisStatus(`${fromMeasure}마디 ${fromIndex}번 음표부터 ${toMeasure}마디 ${toIndex}번 음표까지 선택됨`);
    setTimeout(() => markSelectedNoteRangePreview(fromIndex, toIndex), 80);
  }
  function practiceWeakRange(range: FocusRange) {
    const firstIndex = findFirstNoteIndexForMeasureRange(range.fromMeasure, range.toMeasure);
    const firstNote = notes[firstIndex];
    if (!firstNote || firstNote.measure < range.fromMeasure || firstNote.measure > range.toMeasure) {
      Alert.alert("Section not found", "Could not find playable notes in this measure range.");
      return;
    }

    setCustomRangeStart(String(range.fromMeasure));
    setCustomRangeEnd(String(range.toMeasure));
    setFocusPracticeMeasure(null);
    setFocusPracticeRange({ from: range.fromMeasure, to: range.toMeasure });
    setCustomNoteRange(null);
    setScoreViewVersion((version) => version + 1);
    currentIndexRef.current = firstIndex;
    setCurrentIndex(firstIndex);
    setScorePage(Math.max(1, Math.ceil(range.fromMeasure / measuresPerPage)));
    setPlayReturnSection("focus");
    setActiveSection("play");
    setAnalysisStatus(`\uAD6C\uAC04 \uC5F0\uC2B5: ${range.fromMeasure}-${range.toMeasure}\uB9C8\uB514`);
  }
  function practiceWeakMeasure(measure: number) {
    const firstIndex = notes.findIndex((note) => note.measure === measure);
    if (firstIndex < 0) {
      Alert.alert("Measure not found", "Could not find this measure in the current score.");
      return;
    }
    setFocusPracticeRange(null);
    setFocusPracticeMeasure(measure);
    setCustomNoteRange(null);
    currentIndexRef.current = firstIndex;
    setCurrentIndex(firstIndex);
    setScorePage(Math.max(1, Math.ceil(measure / measuresPerPage)));
    setPlayReturnSection("focus");
    setActiveSection("play");
    setAnalysisStatus(`\uC9D1\uC911 \uC5F0\uC2B5: ${measure}\uB9C8\uB514`);
  }
  function practiceCustomRange(centerMeasure?: number) {
    if (!centerMeasure && customNoteRange) {
      const firstNote = notes.find((note) => note.index === customNoteRange.fromIndex);
      const lastNote = notes.find((note) => note.index === customNoteRange.toIndex);
      if (!firstNote || !lastNote) {
        Alert.alert("Section not found", "Could not find playable notes in this selected range.");
        return;
      }
      setFocusPracticeMeasure(null);
      setFocusPracticeRange(null);
      setIsRangeSelectionMode(false);
      setRangeSelectionStartMeasure(null);
      setRangeSelectionStartIndex(null);
      setIsRangeSelectionReady(false);
      setScoreViewVersion((version) => version + 1);
      currentIndexRef.current = customNoteRange.fromIndex;
      setCurrentIndex(customNoteRange.fromIndex);
      setScorePage(Math.max(1, Math.ceil(firstNote.measure / measuresPerPage)));
      setPlayReturnSection("focus");
      setActiveSection("play");
      setAnalysisStatus(
        `구간 연습: ${firstNote.measure}마디 ${customNoteRange.fromIndex}번 음표-${lastNote.measure}마디 ${customNoteRange.toIndex}번 음표`
      );
      return;
    }

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
    setIsRangeSelectionMode(false);
    setRangeSelectionStartMeasure(null);
    setRangeSelectionStartIndex(null);
    setIsRangeSelectionReady(false);
    setCustomNoteRange(null);
    setScoreViewVersion((version) => version + 1);
    currentIndexRef.current = firstIndex;
    setCurrentIndex(firstIndex);
    setScorePage(Math.max(1, Math.ceil(from / measuresPerPage)));
    setPlayReturnSection("focus");
    setActiveSection("play");
    setAnalysisStatus(`\uAD6C\uAC04 \uC5F0\uC2B5: ${from}-${to}\uB9C8\uB514`);
  }
  async function openCurrentSongFocusFromPlay() {
    await stopAnalysis({ saveSession: true });
    refreshPracticeInsights(songId, notes);
    refreshSavedSongs();
    setFocusSelectedSongId(songId);
    setActiveSection("focus");
  }
  async function openCurrentSongAchievementFromPlay() {
    await stopAnalysis({ saveSession: true });
    refreshPracticeInsights(songId, notes);
    refreshSavedSongs();
    setAchievementView("all");
    setSelectedAchievementSongId(songId);
    setActiveSection("achievement");
  }
  async function returnFromPlay() {
    await stopAnalysis({ saveSession: true });
    refreshPracticeInsights(songId, notes);
    refreshSavedSongs();
    practiceBpmRef.current = DEFAULT_PRACTICE_BPM;
    setPracticeBpm(DEFAULT_PRACTICE_BPM);
    setActiveSection(playReturnSection);
  }
  function returnFromLibrary() {
    setActiveSection("home");
  }
  function returnFromFocus() {
    if (focusSelectedSongId) {
      setFocusSelectedSongId(null);
      setFocusMeasures([]);
      setFocusRanges([]);
      setWeakPracticeSessions([]);
      setLatestMistakeNoteIndices([]);
      setWeakMistakeNoteIndices([]);
      setPendingFocusMeasure(null);
      setFocusPracticeMeasure(null);
      setFocusPracticeRange(null);
      return;
    }
    setActiveSection("home");
  }
  function returnFromWeakScore() {
    setIsRangeSelectionMode(false);
    setRangeSelectionStartMeasure(null);
    setRangeSelectionStartIndex(null);
    setIsRangeSelectionReady(false);
    setActiveSection("focus");
  }
  function returnFromAchievement() {
    setSelectedAchievementSongId(null);
    setActiveSection("home");
  }
  function returnFromTuner() {
    stopTuner();
    setActiveSection("home");
  }
  function markWeakMeasureOnScore(measure: number) {
    const indices = weakMistakeNoteIndices.length
      ? weakMistakeNoteIndices
      : notes.filter((candidate) => candidate.measure === measure).map((note) => note.index);
    for (const note of notes.filter((candidate) => indices.includes(candidate.index))) {
      setPracticeNoteColor(note.index, "#e53935");
    }
  }
  function markWeakRangeOnScore(from: number, to: number) {
    for (const note of notes) {
      if (note.measure < from || note.measure > to) continue;
      setPracticeNoteColor(note.index, "#f7c982");
    }

    for (const note of notes.filter((candidate) => weakMistakeNoteIndices.includes(candidate.index))) {
      setPracticeNoteColor(note.index, "#e53935");
    }
  }
  function markSelectedRangePreview(from: number, to: number) {
    for (const note of notes) {
      if (note.measure < from || note.measure > to) continue;
      setPracticeNoteColor(note.index, "#f7c982");
    }
  }
  function markSelectedNoteRangePreview(fromIndex: number, toIndex: number) {
    const from = Math.min(fromIndex, toIndex);
    const to = Math.max(fromIndex, toIndex);
    for (const note of notes) {
      if (note.index < from || note.index > to) continue;
      setPracticeNoteColor(note.index, "#f7c982");
    }
    setPracticeNoteColor(from, "#ef8a24");
    setPracticeNoteLabel(from, "시작", "#ef8a24");
    setPracticeNoteColor(to, "#ef8a24");
    setPracticeNoteLabel(to, "끝", "#ef8a24");
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
  if (!authLoaded) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.loginScreen}>
          <Text style={styles.loginTitle}>{"기타 연습"}</Text>
          <Text style={styles.loginSubtitle}>{"로그인 정보를 확인하는 중입니다"}</Text>
        </View>
      </SafeAreaView>
    );
  }
  if (!currentUser) {
    return (
      <SafeAreaView style={styles.root}>
        <KeyboardAvoidingView
          style={styles.loginKeyboardView}
          behavior={undefined}
        >
          <ScrollView
            style={styles.loginScroll}
            contentContainerStyle={styles.loginScrollContent}
            automaticallyAdjustKeyboardInsets={false}
            contentInsetAdjustmentBehavior="never"
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            scrollEnabled
          >
            <View style={styles.loginCard}>
              <Text style={styles.loginTitle}>{"기타 연습"}</Text>
              <Text style={styles.loginSubtitle}>
                {loginMode === "login"
                  ? "이름과 비밀번호로 로그인하고 연습 기록을 이어서 확인하세요"
                  : "이름과 비밀번호로 계정을 만들고 연습 기록을 관리하세요"}
              </Text>
              {authError ? <Text style={styles.loginError}>{authError}</Text> : null}
              <View style={styles.loginModeRow}>
                <Pressable
                  style={[styles.loginModeButton, loginMode === "login" && styles.activeLoginModeButton]}
                  onPress={() => setLoginMode("login")}
                >
                  <Text
                    style={[
                      styles.loginModeButtonText,
                      loginMode === "login" && styles.activeLoginModeButtonText,
                    ]}
                  >
                    {"로그인"}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.loginModeButton, loginMode === "signup" && styles.activeLoginModeButton]}
                  onPress={() => setLoginMode("signup")}
                >
                  <Text
                    style={[
                      styles.loginModeButtonText,
                      loginMode === "signup" && styles.activeLoginModeButtonText,
                    ]}
                  >
                    {"회원가입"}
                  </Text>
                </Pressable>
              </View>
              <TextInput
                style={styles.loginInput}
                value={loginName}
                onChangeText={setLoginName}
                placeholder="이름"
                placeholderTextColor="#8a938d"
                autoCorrect={false}
                returnKeyType="next"
              />
              <TextInput
                style={styles.loginInput}
                value={loginPassword}
                onChangeText={setLoginPassword}
                placeholder="비밀번호"
                placeholderTextColor="#8a938d"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                textContentType={loginMode === "login" ? "password" : "newPassword"}
                returnKeyType="done"
                onSubmitEditing={submitLogin}
              />
              <Pressable style={styles.loginSubmitButton} onPress={submitLogin}>
                <Text style={styles.loginSubmitButtonText}>
                  {loginMode === "login" ? "로그인하기" : "회원가입하기"}
                </Text>
              </Pressable>
              <Text style={styles.loginNote}>
                {"Firebase에는 이름을 바탕으로 만든 내부 계정으로 안전하게 로그인합니다."}
              </Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }
  if (activeSection === "home") {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.homeContent}>
          <View style={styles.homeHeader}>
            <View style={styles.homeHeaderRow}>
              <View style={styles.homeHeaderTextBlock}>
                <Text style={styles.homeTitle}>{"\uAE30\uD0C0 \uC5F0\uC2B5"}</Text>
                <Text style={styles.homeSubtitle}>
                  {currentUser.name}{"님, 오늘 연습을 시작해볼까요?"}
                </Text>
              </View>
              <Pressable style={styles.logoutButton} onPress={logout}>
                <Text style={styles.logoutButtonText}>{"로그아웃"}</Text>
              </Pressable>
            </View>
          </View>
          <View style={styles.categoryList}>
            <Pressable style={styles.categoryButton} onPress={() => setActiveSection("library")}>
              <View style={styles.categoryBadge}>
                <Text style={styles.categoryBadgeText}>1</Text>
              </View>
              <View style={styles.categoryTextBlock}>
                <Text style={styles.categoryTitle}>{"연주하기"}</Text>
                <Text style={styles.categorySubtitle}>{"저장된 악보를 선택하고 연습합니다"}</Text>
              </View>
            </Pressable>
            <Pressable style={styles.categoryButton} onPress={() => setActiveSection("focus")}>
              <View style={styles.categoryBadge}>
                <Text style={styles.categoryBadgeText}>2</Text>
              </View>
              <View style={styles.categoryTextBlock}>
                <Text style={styles.categoryTitle}>{"취약 부분 연습하기"}</Text>
                <Text style={styles.categorySubtitle}>{"자주 틀린 구간을 다시 연습합니다"}</Text>
              </View>
            </Pressable>
            <Pressable style={styles.categoryButton} onPress={() => setActiveSection("achievement")}>
              <View style={styles.categoryBadge}>
                <Text style={styles.categoryBadgeText}>3</Text>
              </View>
              <View style={styles.categoryTextBlock}>
                <Text style={styles.categoryTitle}>{"성취도 확인하기"}</Text>
                <Text style={styles.categorySubtitle}>{"현재 진행 중인 곡과 완료한 곡을 확인합니다"}</Text>
              </View>
            </Pressable>
            <Pressable style={styles.categoryButton} onPress={() => setActiveSection("tuner")}>
              <View style={styles.categoryBadge}>
                <Text style={styles.categoryBadgeText}>4</Text>
              </View>
              <View style={styles.categoryTextBlock}>
                <Text style={styles.categoryTitle}>{"튜닝하기"}</Text>
                <Text style={styles.categorySubtitle}>{"기타 6현 표준 튜닝에 맞춰 줄을 조율합니다"}</Text>
              </View>
            </Pressable>
          </View>
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
            <Text style={styles.subtitle}>
              {"\uB0B4 \uC545\uBCF4 "}{visibleSavedSongs.length}{"\uAC1C"}
            </Text>
          </View>
          <Pressable style={styles.importButton} onPress={importMusicXml}>
            <Text style={styles.importButtonText}>{"불러오기"}</Text>
          </Pressable>
        </View>
        <ScrollView style={styles.placeholderPanel} contentContainerStyle={styles.placeholderContent}>
          <View style={styles.guidanceBox}>
            <Text style={styles.guidanceTitle}>{"\uC5B4\uB5BB\uAC8C \uC2DC\uC791\uD560\uAE4C\uC694?"}</Text>
            <Text style={styles.guidanceText}>
              {"MusicXML/MXL\uC744 \uBD88\uB7EC\uC628 \uB4A4 \uC800\uC7A5\uB41C \uC545\uBCF4\uB97C \uB204\uB974\uBA74 \uC5F0\uC2B5\uC774 \uC2DC\uC791\uB429\uB2C8\uB2E4."}
            </Text>
          </View>
          <View style={styles.sectionHeaderBlock}>
            <Text style={styles.sectionHeaderTitle}>{"Example Score"}</Text>
          </View>
          <Pressable style={styles.samplePracticeButton} onPress={openExampleScore}>
            <Text style={styles.samplePracticeTitle}>{"Basic Guitar Pitch Test"}</Text>
            <Text style={styles.samplePracticeSubtitle}>{"4 measures for pitch and beat testing"}</Text>
          </Pressable>
          <View style={styles.sectionHeaderBlock}>
            <Text style={styles.sectionHeaderTitle}>{"\uC800\uC7A5\uB41C \uC545\uBCF4"}</Text>
          </View>
          {visibleSavedSongs.length ? (
            visibleSavedSongs.map((song) => (
              <View key={song.id} style={styles.songRow}>
                <Pressable style={styles.songButton} onPress={() => openSavedSong(song.id)}>
                  <View style={styles.focusSongSelectTextBlock}>
                    <Text style={styles.songTitle}>{song.title}</Text>
                    <Text style={styles.songMeta}>{new Date(song.updatedAt).toLocaleString()}</Text>
                  </View>
                  <Text style={styles.focusMeasureChevron}>{">"}</Text>
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
  if (activeSection === "tuner") {
    const cents = tunerReading ? Math.round(tunerReading.cents) : 0;
    const needleLeft: DimensionValue = `${Math.max(0, Math.min(100, 50 + cents))}%`;
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={returnFromTuner}>
            <Text style={styles.backButtonText}>{"홈"}</Text>
          </Pressable>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>{"튜닝하기"}</Text>
            <Text style={styles.subtitle}>{"표준 튜닝 E A D G B E"}</Text>
          </View>
        </View>
        <View style={styles.tunerHiddenScore}>
          <ScoreWebView
            ref={scoreRef}
            musicXml={SAMPLE_MUSIC_XML}
            layoutMode="flow"
            measureFrom={1}
            measureTo={1}
            noteIndexOffset={0}
            useLowestChordNoteOnly={false}
            onPitch={handleTunerPitch}
            onFftPitchClasses={() => {}}
            onScoreReady={() => {}}
            onScoreError={(message) => setTunerStatus(message)}
            onNoteMapWarning={() => {}}
            onScrollInfo={() => {}}
            onMicReady={() => setTunerStatus("줄을 하나씩 튕겨주세요")}
            onMicUnavailable={(message) => setTunerStatus(`마이크 사용 불가: ${message}`)}
          />
          {countdown || micStarting ? (
            <View style={styles.recordingCountdownBadge}>
              <Text style={styles.recordingCountdownText}>
                {countdown ? `${countdown}` : "준비"}
              </Text>
              <Text style={styles.recordingCountdownLabel}>
                {countdown ? "녹음 시작" : "마이크 확인"}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={styles.tunerPanel}>
          <View style={styles.tunerTabs}>
            {TUNER_STRINGS.map((stringInfo, index) => {
              const isSelected = index === selectedTunerStringIndex;
              return (
                <Pressable
                  key={stringInfo.name}
                  style={[styles.tunerTab, isSelected && styles.tunerTabActive]}
                  onPress={() => {
                    setSelectedTunerStringIndex(index);
                    setTunerHz(null);
                    setTunerClarity(null);
                    setTunerStatus(`${stringInfo.name} 기준으로 맞춰주세요`);
                  }}
                >
                  <Text style={[styles.tunerTabNumber, isSelected && styles.tunerTabNumberActive]}>
                    {index + 1}
                  </Text>
                  <Text style={[styles.tunerTabText, isSelected && styles.tunerTabTextActive]}>
                    {stringInfo.name.replace(`${index + 1}번줄 `, "")}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.tunerString}>{selectedTunerString.name}</Text>
          <Text style={styles.tunerTargetHz}>
            {"목표 "}{midiToHz(selectedTunerString.midi).toFixed(1)}{" Hz"}
          </Text>
          <Text style={styles.tunerHz}>
            {tunerHz ? `${tunerHz.toFixed(1)} Hz` : "소리를 기다리는 중"}
          </Text>
          <Text style={styles.tunerStatus}>{tunerStatus}</Text>
          <View style={styles.tunerMeter}>
            <View style={styles.tunerCenterLine} />
            <View style={[styles.tunerNeedle, { left: needleLeft }]} />
          </View>
          <View style={styles.tunerMeterLabels}>
            <Text style={styles.tunerMeterLabel}>{"낮음"}</Text>
            <Text style={styles.tunerMeterLabel}>{"정확"}</Text>
            <Text style={styles.tunerMeterLabel}>{"높음"}</Text>
          </View>
          <Text style={styles.tunerCents}>
            {tunerReading ? `${cents > 0 ? "+" : ""}${cents} cents` : "0 cents"}
          </Text>
          <Pressable
            style={[styles.tunerStartButton, tunerActive && styles.disabledButton]}
            disabled={tunerActive}
            onPress={startTuner}
          >
            <Text style={styles.tunerStartButtonText}>{tunerActive ? "듣는 중" : "튜닝 시작"}</Text>
          </Pressable>
          <Text style={styles.tunerStringItem}>
            {"탭에서 줄을 고른 뒤 해당 줄만 튕겨서 맞추세요."}
          </Text>
        </View>
      </SafeAreaView>
    );
  }
  if (activeSection === "focus") {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={returnFromFocus}>
            <Text style={styles.backButtonText}>{focusSelectedSongId ? "목록" : "홈"}</Text>
          </Pressable>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>{"\uCDE8\uC57D \uBD80\uBD84 \uC5F0\uC2B5\uD558\uAE30"}</Text>
            <Text style={styles.subtitle}>
              {focusSelectedSongId ? songTitle : "먼저 연습할 곡을 선택하세요"}
            </Text>
          </View>
        </View>
        <ScrollView style={styles.placeholderPanel} contentContainerStyle={styles.placeholderContent}>
          {!focusSelectedSongId ? (
            <>
              <View style={styles.focusIntroHeader}>
                <Text style={styles.placeholderTitle}>{"곡 선택"}</Text>
                <Text style={styles.sectionHeaderSubtitle}>
                  {"곡을 선택하면 그 곡의 반복 연습 필요 구간만 따로 보여줍니다."}
                </Text>
              </View>
              {focusSelectableSongs.length ? (
                focusSelectableSongs.map((song) => (
                  <View key={song.id} style={styles.songRow}>
                    <Pressable
                      style={styles.focusSongSelectButton}
                      onPress={() => selectFocusSong(song)}
                    >
                      <View style={styles.focusSongSelectTextBlock}>
                        <Text style={styles.songTitle}>{song.title}</Text>
                        <Text style={styles.songMeta}>{new Date(song.updatedAt).toLocaleString()}</Text>
                      </View>
                      <Text style={styles.focusMeasureChevron}>{">"}</Text>
                    </Pressable>
                    <Pressable style={styles.deleteSongButton} onPress={() => confirmDeleteSong(song)}>
                      <Text style={styles.deleteSongButtonText}>{"\uC0AD\uC81C"}</Text>
                    </Pressable>
                  </View>
                ))
              ) : (
                <Text style={styles.placeholderText}>
                  {"\uD655\uC778\uD560 \uC545\uBCF4\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4. \uBA3C\uC800 MusicXML \uD30C\uC77C\uC744 \uBD88\uB7EC\uC624\uC138\uC694."}
                </Text>
              )}
            </>
          ) : (
            <>
              <View style={styles.focusActionHeader}>
                <View style={styles.focusActionTextBlock}>
                  <Text style={styles.placeholderTitle}>{songTitle}</Text>
                  <Text style={styles.sectionHeaderSubtitle}>
                    {"최근 연습에서 한 마디의 30% 이상을 틀리거나, 마디 경계의 절반+절반 가상 구간에서 30% 이상 틀리면 표시됩니다."}
                  </Text>
                </View>
              </View>
              <Text style={styles.placeholderTitle}>{"\uBC18\uBCF5 \uC5F0\uC2B5 \uD544\uC694 \uAD6C\uAC04"}</Text>
              {focusRanges.length ? (
                focusRanges.map((item, index) => (
                  <View
                    key={`${item.isVirtual ? "virtual" : "measure"}-${item.fromMeasure}-${item.toMeasure}`}
                    style={styles.focusMeasureRow}
                  >
                    <View style={styles.focusMeasureTextBlock}>
                      <Text style={styles.focusMeasureTitle}>
                        {index + 1}{". "}{item.isVirtual ? "마디 전환 취약 구간" : index === 0 ? "\uAC00\uC7A5 \uB9CE\uC774 \uD2C0\uB9B0 \uAD6C\uAC04" : "\uBC18\uBCF5 \uC5F0\uC2B5 \uD544\uC694 \uAD6C\uAC04"}
                      </Text>
                      <Text style={styles.focusMeasureMeta}>
                        {formatFocusRangeScrollLabel(item)}{" / "}{item.mistakeCount}{"번 틀림"}{item.errorRate ? ` / 오류율 ${Math.round(item.errorRate * 100)}%` : ""}
                      </Text>
                    </View>
                    <View style={styles.focusRangeActions}>
                      <Pressable
                        style={styles.focusPracticeButton}
                        onPress={() => practiceWeakRange(item)}
                      >
                        <Text style={styles.focusPracticeButtonText}>{"\uC5F0\uC2B5\uD558\uAE30"}</Text>
                      </Pressable>
                      <Pressable
                        style={styles.focusResetButton}
                        onPress={() => confirmClearFocusRange(item)}
                      >
                        <Text style={styles.focusResetButtonText}>{"\uCD08\uAE30\uD654"}</Text>
                      </Pressable>
                    </View>
                  </View>
                ))
              ) : (
                <Text style={styles.placeholderText}>{"아직 오류율 30% 이상인 마디나 마디 전환 구간이 없습니다."}</Text>
              )}
              <View style={styles.customRangeBox}>
                <Text style={styles.customRangeTitle}>{"\uC5F0\uC2B5 \uD544\uC694 \uAD6C\uAC04 \uC124\uC815\uD558\uAE30"}</Text>
                <Text style={styles.sectionHeaderSubtitle}>
                  {"마디 번호를 입력하지 않고 악보에서 시작 음표와 끝 음표를 눌러 구간을 선택합니다."}
                </Text>
                <Pressable style={styles.focusMeasureButton} onPress={openRangeSelectionOnScore}>
                  <Text style={styles.focusMeasureButtonText}>{"악보 보고 구간 선택"}</Text>
                </Pressable>
              </View>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }
  if (activeSection === "weakScore") {
    const reviewMeasure = currentNote?.measure ?? pendingFocusMeasure ?? measureFrom;
    const reviewRange = isRangeSelectionMode
      ? { from: 1, to: measureCount }
      : weakScoreRange ?? { from: reviewMeasure, to: reviewMeasure };
    const reviewMeasureFrom = reviewRange.from;
    const reviewMeasureTo = reviewRange.to;
    const reviewNoteIndexOffset = findFirstNoteIndexForMeasureRange(reviewMeasureFrom, reviewMeasureTo);
    const reviewRangeLabel =
      reviewMeasureFrom === reviewMeasureTo
        ? `${reviewMeasureFrom}\uB9C8\uB514`
        : `${reviewMeasureFrom}-${reviewMeasureTo}\uB9C8\uB514`;
    const reviewScrollLabel = formatFocusRangeScrollLabel({
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
            <Text style={styles.title}>{isRangeSelectionMode ? "구간 선택" : "\uCDE8\uC57D \uAD6C\uAC04 \uC545\uBCF4"}</Text>
            <Text style={styles.subtitle}>
              {isRangeSelectionMode ? `${songTitle} - 악보에서 시작/끝 음표 선택` : `${songTitle} - ${reviewScrollLabel}`}
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
            onNotePress={handleScoreNotePress}
            onScoreReady={(payload) => {
              stopRenderTimeout();
              setScoreStatus(
              `\uC900\uBE44\uB428 - ${reviewScrollLabel} - ${reviewRangeLabel}`
              );
              if (!isRangeSelectionMode) {
                setTimeout(() => markWeakRangeOnScore(reviewMeasureFrom, reviewMeasureTo), 250);
              }
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
          {isRangeSelectionMode ? (
            <>
              <View style={styles.statusRow}>
                <Text style={styles.label}>{"선택"}</Text>
                <Text style={styles.value}>
                  {rangeSelectionStartMeasure === null
                    ? "시작할 음표를 누르세요. 누르면 음표 위에 '시작' 표시가 뜹니다."
                    : `${rangeSelectionStartMeasure}마디의 선택한 음표부터 시작합니다. 끝 음표를 누르세요.`}
                </Text>
              </View>
              <Pressable
                style={[styles.analysisButton, !isRangeSelectionReady && styles.disabledButton]}
                disabled={!isRangeSelectionReady}
                onPress={() => practiceCustomRange()}
              >
                <Text style={styles.analysisButtonText}>{"선택 구간 연습하기"}</Text>
              </Pressable>
            </>
          ) : (
            <View style={styles.statusRow}>
              <Text style={styles.label}>{"\uD655\uC778"}</Text>
              <Text style={styles.value}>{"\uBE68\uAC04 \uC74C\uD45C\uB294 \uC800\uC7A5\uB41C \uC2E4\uC218 \uC704\uCE58\uC785\uB2C8\uB2E4"}</Text>
            </View>
          )}
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
          <View style={styles.achievementSummaryGrid}>
            <Pressable
              style={[
                styles.achievementSummaryBox,
                achievementView === "all" && styles.activeAchievementSummaryBox,
              ]}
              onPress={() => selectAchievementView("all")}
            >
              <Text style={styles.achievementSummaryValue}>{totalPracticeSessionCount}</Text>
              <Text style={styles.achievementSummaryLabel}>{"\uCD1D \uC5F0\uC2B5 \uBCF4\uAE30"}</Text>
            </Pressable>
            <Pressable
              style={[
                styles.achievementSummaryBox,
                achievementView === "recentMonth" && styles.activeAchievementSummaryBox,
              ]}
              onPress={() => selectAchievementView("recentMonth")}
            >
              <Text style={styles.achievementSummaryValue}>{recentMonthAchievementSummaries.length}</Text>
              <Text style={styles.achievementSummaryLabel}>{"\uCD5C\uADFC \uD55C \uB2EC"}</Text>
            </Pressable>
            <Pressable
              style={[
                styles.achievementSummaryBox,
                achievementView === "review" && styles.activeAchievementSummaryBox,
              ]}
              onPress={() => selectAchievementView("review")}
            >
              <Text style={styles.achievementSummaryValue}>{reviewAchievementSummaries.length}</Text>
              <Text style={styles.achievementSummaryLabel}>{"\uC810\uAC80\uD560 \uACE1"}</Text>
            </Pressable>
          </View>
          <View style={styles.achievementTabs}>
            <Pressable
              style={[
                styles.achievementTabButton,
                achievementView === "progress" && styles.activeAchievementTabButton,
              ]} 
              onPress={() => selectAchievementView("progress")}
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
              onPress={() => selectAchievementView("mastered")}
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
          {achievementView === "all" ? (
            <>
              <Text style={styles.placeholderTitle}>{"\uC804\uCCB4 \uC5F0\uC2B5\uACE1"}</Text>
              {visiblePracticedAchievementSummaries.length ? (
                visiblePracticedAchievementSummaries.map((summary) => (
                  <Pressable
                    key={summary.songId}
                    style={styles.achievementRow}
                    onPress={() =>
                      setSelectedAchievementSongId((current) =>
                        current === summary.songId ? null : summary.songId
                      )
                    }
                  >
                    <View style={styles.achievementTextBlock}>
                      <View style={styles.achievementTitleRow}>
                        <Text style={styles.achievementTitle}>{summary.title}</Text>
                        <Text
                          style={
                            summary.latestIsMastered
                              ? styles.masteredStatusPill
                              : styles.achievementStatusPill
                          }
                        >
                          {getAchievementStatusLabel(summary)}
                        </Text>
                      </View>
                      <Text style={styles.achievementListMeta}>
                        {formatAchievementListMeta(summary)}
                      </Text>
                      {selectedAchievementSongId === summary.songId ? (
                        renderAchievementDetails(
                          summary,
                          summary.latestIsMastered
                            ? "\uB2E4\uC2DC \uC5F0\uC2B5\uD558\uAE30"
                            : "\uC774 \uACE1 \uC5F0\uC2B5\uD558\uAE30"
                        )
                      ) : null}
                    </View>
                  </Pressable>
                ))
              ) : (
                <Text style={styles.placeholderText}>{"\uC544\uC9C1 \uC5F0\uC2B5 \uAE30\uB85D\uC774 \uC788\uB294 \uACE1\uC774 \uC5C6\uC2B5\uB2C8\uB2E4."}</Text>
              )}
              {practicedAchievementSummaries.length > 5 ? (
                <Pressable
                  style={styles.primaryWideButton}
                  onPress={() => setShowAllPracticedSongs((current) => !current)}
                >
                  <Text style={styles.primaryWideButtonText}>
                    {showAllPracticedSongs ? "\uC811\uAE30" : "\uB354\uBCF4\uAE30"}
                  </Text>
                </Pressable>
              ) : null}
            </>
          ) : achievementView === "recentMonth" ? (
            <>
              <Text style={styles.placeholderTitle}>{"\uCD5C\uADFC \uD55C \uB2EC \uACE1\uBCC4 \uC815\uD655\uB3C4"}</Text>
              {visibleRecentMonthAchievementSummaries.length ? (
                visibleRecentMonthAchievementSummaries.map((summary) => (
                  <Pressable
                    key={summary.songId}
                    style={styles.achievementRow}
                    onPress={() =>
                      setSelectedAchievementSongId((current) =>
                        current === summary.songId ? null : summary.songId
                      )
                    }
                  >
                    <View style={styles.achievementTextBlock}>
                      <View style={styles.achievementTitleRow}>
                        <Text style={styles.achievementTitle}>{summary.title}</Text>
                        <Text
                          style={
                            summary.latestIsMastered
                              ? styles.masteredStatusPill
                              : styles.achievementStatusPill
                          }
                        >
                          {formatRecentMonthAccuracy(summary)}
                        </Text>
                      </View>
                      <Text style={styles.achievementListMeta}>
                        {formatRecentMonthMeta(summary)}
                      </Text>
                      {selectedAchievementSongId === summary.songId ? (
                        renderAchievementDetails(summary, "\uC774 \uACE1 \uC5F0\uC2B5\uD558\uAE30")
                      ) : null}
                    </View>
                  </Pressable>
                ))
              ) : (
                <Text style={styles.placeholderText}>{"\uCD5C\uADFC \uD55C \uB2EC \uC5F0\uC2B5 \uAE30\uB85D\uC774 \uC788\uB294 \uACE1\uC774 \uC5C6\uC2B5\uB2C8\uB2E4."}</Text>
              )}
              {recentMonthAchievementSummaries.length > 5 ? (
                <Pressable
                  style={styles.primaryWideButton}
                  onPress={() => setShowAllRecentMonthSongs((current) => !current)}
                >
                  <Text style={styles.primaryWideButtonText}>
                    {showAllRecentMonthSongs ? "\uC811\uAE30" : "\uB354\uBCF4\uAE30"}
                  </Text>
                </Pressable>
              ) : null}
            </>
          ) : achievementView === "review" ? (
            <>
              <Text style={styles.placeholderTitle}>{"\uC810\uAC80\uD560 \uACE1"}</Text>
              {visibleReviewAchievementSummaries.length ? (
                visibleReviewAchievementSummaries.map((summary) => (
                  <Pressable
                    key={summary.songId}
                    style={styles.achievementRow}
                    onPress={() =>
                      setSelectedAchievementSongId((current) =>
                        current === summary.songId ? null : summary.songId
                      )
                    }
                  >
                    <View style={styles.achievementTextBlock}>
                      <View style={styles.achievementTitleRow}>
                        <Text style={styles.achievementTitle}>{summary.title}</Text>
                        <Text style={styles.achievementStatusPill}>
                          {getAchievementStatusLabel(summary)}
                        </Text>
                      </View>
                      <Text style={styles.achievementListMeta}>
                        {formatAchievementListMeta(summary)}
                      </Text>
                      {selectedAchievementSongId === summary.songId ? (
                        renderAchievementDetails(summary, "\uC815\uD655\uB3C4 \uC62C\uB9AC\uAE30")
                      ) : null}
                    </View>
                  </Pressable>
                ))
              ) : (
                <Text style={styles.placeholderText}>{"\uC810\uAC80\uD560 \uC5F0\uC2B5 \uC911\uC778 \uACE1\uC774 \uC5C6\uC2B5\uB2C8\uB2E4."}</Text>
              )}
              {reviewAchievementSummaries.length > 3 ? (
                <Pressable
                  style={styles.primaryWideButton}
                  onPress={() => setShowAllReviewSongs((current) => !current)}
                >
                  <Text style={styles.primaryWideButtonText}>
                    {showAllReviewSongs ? "\uC811\uAE30" : "\uB354\uBCF4\uAE30"}
                  </Text>
                </Pressable>
              ) : null}
            </>
          ) : achievementView === "progress" ? (
            <>
              <Text style={styles.placeholderTitle}>{"\uC5F0\uC2B5 \uC911\uC778 \uACE1"}</Text>
              {visibleInProgressAchievementSummaries.length ? (
                visibleInProgressAchievementSummaries.map((summary) => (
                  <Pressable
                    key={summary.songId}
                    style={styles.achievementRow}
                    onPress={() =>
                      setSelectedAchievementSongId((current) =>
                        current === summary.songId ? null : summary.songId
                      )
                    }
                  >
                    <View style={styles.achievementTextBlock}>
                      <View style={styles.achievementTitleRow}>
                        <Text style={styles.achievementTitle}>{summary.title}</Text>
                        <Text style={styles.achievementStatusPill}>
                          {getAchievementStatusLabel(summary)}
                        </Text>
                      </View>
                      <Text style={styles.achievementListMeta}>
                        {formatAchievementListMeta(summary)}
                      </Text>
                      {selectedAchievementSongId === summary.songId ? (
                        renderAchievementDetails(summary, "\uC774 \uACE1 \uC5F0\uC2B5\uD558\uAE30")
                      ) : null}
                    </View>
                  </Pressable>
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
                visibleMasteredAchievementSummaries.map((summary, index) => (
                  <Pressable
                    key={summary.songId}
                    style={styles.achievementRow}
                    onPress={() =>
                      setSelectedAchievementSongId((current) =>
                        current === summary.songId ? null : summary.songId
                      )
                    }
                  >
                    <View style={styles.achievementRankBadge}>
                      <Text style={styles.achievementRankText}>{index + 1}</Text>
                    </View>
                    <View style={styles.achievementTextBlock}>
                      <View style={styles.achievementTitleRow}>
                        <Text style={styles.achievementTitle}>{summary.title}</Text>
                        <Text style={styles.masteredStatusPill}>{"\uB9C8\uC2A4\uD130"}</Text>
                      </View>
                      <Text style={styles.achievementListMeta}>
                        {formatAchievementListMeta(summary)}
                      </Text>
                      {selectedAchievementSongId === summary.songId ? (
                        renderAchievementDetails(summary, "\uB2E4\uC2DC \uC5F0\uC2B5\uD558\uAE30")
                      ) : null}
                    </View>
                  </Pressable>
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
        <View style={styles.practiceHeaderActions}>
          <Pressable style={styles.practiceHeaderActionButton} onPress={openCurrentSongFocusFromPlay}>
            <Text style={styles.practiceHeaderActionText}>{"취약 부분"}</Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.practiceMainRow}>
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
              if (suppressScoreColorsRef.current) {
                scoreRef.current?.clearPracticeMarks();
                return;
              }
              reapplyNoteFeedback();
              setTimeout(() => {
                applyLatestMistakeHighlights();
                scoreRef.current?.scrollToNote(currentIndexRef.current);
              }, 250);
              setTimeout(applyLatestMistakeHighlights, 700);
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
          {countdown || micStarting ? (
            <View pointerEvents="none" style={styles.practiceCountdownBadge}>
              <Text style={styles.practiceCountdownText}>
                {countdown ? `${countdown}` : "준비"}
              </Text>
              <Text style={styles.practiceCountdownLabel}>
                {countdown ? "곧 시작" : "마이크 확인"}
              </Text>
            </View>
          ) : null}
        </View>
        <Pressable
          style={styles.practiceSideToggle}
          onPress={togglePracticeSidePanel}
        >
          <Text style={styles.practiceSideToggleIcon}>{showPracticeSidePanel ? ">" : "<"}</Text>
          <Text style={styles.practiceSideToggleText}>
            {showPracticeSidePanel ? "닫기" : "패널"}
          </Text>
        </Pressable>
        {showPracticeSidePanel ? (
          <View style={styles.practiceSidePanel}>
            <View style={styles.sideBpmControl}>
              <Text style={styles.bpmLabel}>{"연습 BPM"}</Text>
              <Text style={styles.sideBpmValue}>{practiceBpm}</Text>
              <View style={styles.sideBpmButtons}>
                <Pressable
                  style={[styles.sideBpmButton, isPracticeRunning && styles.disabledButton]}
                  disabled={isPracticeRunning}
                  onPress={() => adjustPracticeBpm(-10)}
                >
                  <Text style={styles.bpmButtonText}>{"-10"}</Text>
                </Pressable>
                <Pressable
                  style={[styles.sideBpmButton, isPracticeRunning && styles.disabledButton]}
                  disabled={isPracticeRunning}
                  onPress={() => adjustPracticeBpm(-5)}
                >
                  <Text style={styles.bpmButtonText}>{"-5"}</Text>
                </Pressable>
                <Pressable
                  style={[styles.sideBpmButton, isPracticeRunning && styles.disabledButton]}
                  disabled={isPracticeRunning}
                  onPress={() => adjustPracticeBpm(5)}
                >
                  <Text style={styles.bpmButtonText}>{"+5"}</Text>
                </Pressable>
                <Pressable
                  style={[styles.sideBpmButton, isPracticeRunning && styles.disabledButton]}
                  disabled={isPracticeRunning}
                  onPress={() => adjustPracticeBpm(10)}
                >
                  <Text style={styles.bpmButtonText}>{"+10"}</Text>
                </Pressable>
              </View>
            </View>
            <View style={styles.sidePracticeInfo}>
              <Text style={styles.sidePracticeInfoTitle}>{"연습 정보"}</Text>
              <View style={styles.sidePracticeMetricRow}>
                <Text style={styles.sidePracticeMetricLabel}>{"정확도"}</Text>
                <Text style={styles.sidePracticeMetricValue}>{practiceAccuracyText}</Text>
              </View>
              <View style={styles.sidePracticeMetricRow}>
                <Text style={styles.sidePracticeMetricLabel}>{"맞은 음표"}</Text>
                <Text style={styles.sidePracticeMetricValue}>{practiceCorrectText}</Text>
              </View>
            </View>
            {!focusPracticeRange && focusPracticeMeasure === null ? (
              <Pressable
                style={[
                  styles.sidePracticeNotice,
                  showPracticeHighlights && styles.sidePracticeNoticeActive,
                ]}
                onPress={togglePracticeHighlights}
              >
                <>
                  <Text style={styles.weakPracticeNoticeTitle}>
                    {focusRanges.length ? "조심해서 연주할 구간" : "악보 표시"}
                  </Text>
                  <Text style={styles.weakPracticeNoticeText}>
                    {showPracticeHighlights ? "악보에 표시됨\n" : "누르면 악보에 표시됩니다\n"}
                    {focusRanges.length
                      ? focusRanges
                          .slice(0, 3)
                          .map((range) =>
                            `${formatFocusRangeScrollLabel(range)}${
                              range.isVirtual ? " 전환" : ""
                            }`
                          )
                          .join(" / ")
                      : latestMistakeNoteIndices.length
                        ? "최근 틀린 음표"
                        : "표시할 취약 구간 없음"}
                  </Text>
                  <View style={styles.weakLegendRow}>
                    <View style={[styles.weakLegendDot, styles.weakLegendSoft]} />
                    <Text style={styles.weakLegendText}>{"취약 부분"}</Text>
                    <View style={[styles.weakLegendDot, styles.weakLegendStrong]} />
                    <Text style={styles.weakLegendText}>{"틀린 음"}</Text>
                  </View>
                  <Text style={styles.sidePracticeNoticeAction}>
                    {showPracticeHighlights ? "표시 숨기기" : "악보에 표시하기"}
                  </Text>
                </>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
      <View style={styles.practiceActionBar}>
        <View style={styles.practiceActionBarContent}>
        <View style={styles.analysisControls}>
          <Pressable
            style={[styles.analysisButton, isPracticeRunning && styles.disabledButton]}
            disabled={isPracticeRunning}
            onPress={() => startAnalysis("restart")}
          >
            <Text style={styles.analysisButtonText}>
              {micStarting || isListening || countdown ? startMicLabel : restartButtonLabel}
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.resumeButton,
              (!canResumeFromMistake || isPracticeRunning) && styles.disabledButton,
            ]}
            disabled={!canResumeFromMistake || isPracticeRunning}
            onPress={() => startAnalysis("resume")}
          >
            <Text style={styles.resumeButtonText}>{"\uC911\uB2E8\uD55C \uBD80\uBD84\uBD80\uD130 \uC5F0\uC8FC\uD558\uAE30"}</Text>
          </Pressable>
          <Pressable style={styles.stopButton} onPress={() => stopAnalysis()}>
            <Text style={styles.stopButtonText}>{"\uC815\uC9C0"}</Text>
          </Pressable>
        </View>
        </View>
      </View>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#f4f1ea",
  },
  loginScreen: {
    flex: 1,
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  loginKeyboardView: {
    flex: 1,
  },
  loginScroll: {
    flex: 1,
  },
  loginScrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 48,
    paddingBottom: 360,
    alignItems: "center",
    justifyContent: "flex-start",
  },
  loginCard: {
    width: "100%",
    maxWidth: 520,
    borderRadius: 8,
    padding: 22,
    gap: 14,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d8d2c4",
  },
  loginTitle: {
    color: "#1f2a25",
    fontSize: 30,
    fontWeight: "900",
  },
  loginSubtitle: {
    color: "#66736b",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
  },
  loginModeRow: {
    flexDirection: "row",
    gap: 10,
  },
  loginModeButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f3f0e9",
    borderWidth: 1,
    borderColor: "#d8d2c4",
  },
  activeLoginModeButton: {
    backgroundColor: "#1f6f5b",
    borderColor: "#185846",
  },
  loginModeButtonText: {
    color: "#1f2a25",
    fontSize: 14,
    fontWeight: "900",
  },
  activeLoginModeButtonText: {
    color: "#ffffff",
  },
  loginInput: {
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#b9b19f",
    paddingHorizontal: 14,
    backgroundColor: "#fbfaf6",
    color: "#1f2a25",
    fontSize: 15,
    fontWeight: "800",
  },
  loginSubmitButton: {
    minHeight: 50,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1f6f5b",
  },
  loginSubmitButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
  },
  loginNote: {
    color: "#66736b",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
  },
  loginError: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    overflow: "hidden",
    backgroundColor: "#fff0ed",
    color: "#b3261e",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },
  homeContent: {
    flex: 1,
    paddingBottom: 10,
  },
  homeHeader: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 10,
  },
  homeHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  homeHeaderTextBlock: {
    flex: 1,
  },
  homeTitle: {
    fontSize: 28,
    fontWeight: "900",
    color: "#1f2a25",
  },
  homeSubtitle: {
    marginTop: 4,
    fontSize: 13,
    color: "#66736b",
    fontWeight: "700",
  },
  logoutButton: {
    minHeight: 38,
    borderRadius: 8,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#c9d2cc",
  },
  logoutButtonText: {
    color: "#1f2a25",
    fontSize: 12,
    fontWeight: "900",
  },
  categoryList: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 4,
    paddingBottom: 12,
    justifyContent: "flex-start",
    gap: 10,
  },
  categoryButton: {
    minHeight: 92,
    maxHeight: 108,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
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
    fontSize: 20,
    fontWeight: "900",
    color: "#1f2a25",
  },
  categorySubtitle: {
    marginTop: 3,
    fontSize: 13,
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
  headerSpacer: {
    width: 54,
  },
  practiceHeaderActions: {
    flexDirection: "row",
    gap: 8,
  },
  practiceHeaderActionButton: {
    minHeight: 36,
    borderRadius: 8,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#1f6f5b",
  },
  practiceHeaderActionText: {
    color: "#1f6f5b",
    fontSize: 12,
    fontWeight: "900",
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
  importPanel: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 12,
    gap: 14,
  },
  largeImportButton: {
    minHeight: 72,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1f6f5b",
    borderWidth: 1,
    borderColor: "#185846",
  },
  largeImportButtonText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "900",
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
  practiceMainRow: {
    flex: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 10,
  },
  score: {
    flex: 1,
    position: "relative",
    backgroundColor: "#ffffff",
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
  practiceSidePanel: {
    width: 180,
    gap: 10,
  },
  practiceSideToggle: {
    width: 42,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#9db7aa",
  },
  practiceSideToggleIcon: {
    color: "#1f6f5b",
    fontSize: 28,
    lineHeight: 30,
    fontWeight: "900",
  },
  practiceSideToggleText: {
    color: "#1f6f5b",
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "900",
  },
  sideBpmControl: {
    borderRadius: 8,
    padding: 12,
    gap: 10,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d8d2c4",
  },
  sideBpmValue: {
    color: "#1f2a25",
    fontSize: 38,
    lineHeight: 44,
    fontWeight: "900",
    textAlign: "center",
  },
  sideBpmButtons: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  sideBpmButton: {
    flexBasis: "47%",
    minHeight: 38,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e6f0eb",
    borderWidth: 1,
    borderColor: "#9db7aa",
  },
  sidePracticeInfo: {
    flex: 0.75,
    minHeight: 116,
    borderRadius: 8,
    padding: 11,
    gap: 8,
    justifyContent: "center",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d8d2c4",
  },
  sidePracticeInfoTitle: {
    color: "#66736b",
    fontSize: 12,
    fontWeight: "900",
  },
  sidePracticeMetricRow: {
    flex: 1,
    minHeight: 34,
    borderRadius: 7,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#f4f1ea",
  },
  sidePracticeMetricLabel: {
    color: "#66736b",
    fontSize: 11,
    fontWeight: "800",
  },
  sidePracticeMetricValue: {
    color: "#1f2a25",
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "900",
  },
  sidePracticeNotice: {
    flex: 1,
    minHeight: 138,
    borderRadius: 8,
    padding: 11,
    gap: 8,
    justifyContent: "space-between",
    backgroundColor: "#fff7ea",
    borderWidth: 1,
    borderColor: "#d98b24",
    shadowColor: "#7c4a10",
    shadowOpacity: 0.16,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  sidePracticeNoticeActive: {
    backgroundColor: "#fff2d7",
    borderColor: "#b86412",
  },
  sidePracticeNoticeAction: {
    minHeight: 32,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    overflow: "hidden",
    textAlign: "center",
    color: "#ffffff",
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "900",
    backgroundColor: "#9b5b12",
  },
  practiceCountdownBadge: {
    position: "absolute",
    top: 12,
    alignSelf: "center",
    minWidth: 112,
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "rgba(31, 111, 91, 0.94)",
    zIndex: 4,
    elevation: 4,
  },
  practiceCountdownText: {
    color: "#ffffff",
    fontSize: 42,
    lineHeight: 46,
    fontWeight: "900",
  },
  practiceCountdownLabel: {
    marginTop: 2,
    color: "#e7f2ec",
    fontSize: 12,
    fontWeight: "900",
  },
  recordingCountdownBadge: {
    position: "absolute",
    top: 8,
    alignSelf: "center",
    minWidth: 96,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "rgba(31, 111, 91, 0.92)",
  },
  recordingCountdownText: {
    color: "#ffffff",
    fontSize: 34,
    lineHeight: 38,
    fontWeight: "900",
  },
  recordingCountdownLabel: {
    marginTop: 2,
    color: "#e7f2ec",
    fontSize: 12,
    fontWeight: "900",
  },
  panel: {
    marginTop: 8,
    marginBottom: 44,
    backgroundColor: "#fbfaf7",
    borderTopWidth: 1,
    borderColor: "#d8d2c4",
  },
  panelContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 9,
  },
  practiceActionBar: {
    marginTop: 8,
    backgroundColor: "#fbfaf7",
    borderTopWidth: 1,
    borderColor: "#d8d2c4",
  },
  practiceActionBarContent: {
    paddingHorizontal: 12,
    paddingTop: 7,
    paddingBottom: 7,
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
  guidanceBox: {
    paddingHorizontal: 2,
    paddingVertical: 4,
    paddingLeft: 12,
    borderLeftWidth: 3,
    borderLeftColor: "#b8ad9b",
  },
  guidanceTitle: {
    color: "#1f2a25",
    fontSize: 15,
    fontWeight: "900",
  },
  guidanceText: {
    marginTop: 4,
    color: "#66736b",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
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
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
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
    gap: 12,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d8d2c4",
  },
  focusMeasureTextBlock: {
    flex: 1,
  },
  focusIntroHeader: {
    paddingVertical: 2,
    gap: 6,
  },
  focusSongSelectButton: {
    flex: 1,
    minHeight: 78,
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
  focusSongSelectTextBlock: {
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
  focusRangeActions: {
    flexDirection: "row",
    gap: 10,
  },
  focusPracticeButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1f6f5b",
  },
  focusPracticeButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900",
  },
  focusResetButton: {
    width: 96,
    minHeight: 42,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#b3261e",
  },
  focusResetButtonText: {
    color: "#b3261e",
    fontSize: 13,
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
  focusActionHeader: {
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
  focusActionTextBlock: {
    flex: 1,
  },
  achievementTabs: {
    flexDirection: "row",
    gap: 10,
  },
  achievementSummaryGrid: {
    flexDirection: "row",
    gap: 10,
  },
  achievementSummaryBox: {
    flex: 1,
    minHeight: 74,
    borderRadius: 8,
    padding: 12,
    justifyContent: "center",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d8d2c4",
  },
  activeAchievementSummaryBox: {
    backgroundColor: "#eef7f2",
    borderColor: "#1f6f5b",
  },
  achievementSummaryValue: {
    color: "#1f6f5b",
    fontSize: 22,
    fontWeight: "900",
  },
  achievementSummaryLabel: {
    marginTop: 4,
    color: "#66736b",
    fontSize: 12,
    fontWeight: "800",
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
    alignItems: "flex-start",
    gap: 12,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d8d2c4",
  },
  achievementRankBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#d8c79c",
  },
  achievementRankText: {
    color: "#4b3d21",
    fontSize: 15,
    fontWeight: "900",
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
    gap: 8,
  },
  achievementTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  achievementTitle: {
    flex: 1,
    color: "#1f2a25",
    fontSize: 17,
    fontWeight: "900",
  },
  achievementListMeta: {
    color: "#66736b",
    fontSize: 12,
    fontWeight: "800",
  },
  achievementStatusPill: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    overflow: "hidden",
    backgroundColor: "#fff4d6",
    color: "#765300",
    fontSize: 11,
    fontWeight: "900",
  },
  masteredStatusPill: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    overflow: "hidden",
    backgroundColor: "#e7f4ec",
    color: "#1f6f5b",
    fontSize: 11,
    fontWeight: "900",
  },
  accuracyTrack: {
    height: 8,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#e8e2d7",
  },
  accuracyFill: {
    height: "100%",
    borderRadius: 8,
    backgroundColor: "#2f5f8f",
  },
  masteredAccuracyFill: {
    backgroundColor: "#1f6f5b",
  },
  achievementMetricRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  achievementMetric: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    overflow: "hidden",
    backgroundColor: "#f3f0e9",
    color: "#1f2a25",
    fontSize: 12,
    fontWeight: "800",
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
  achievementPracticeButton: {
    minHeight: 40,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1f6f5b",
  },
  achievementPracticeButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900",
  },
  performancePlayButton: {
    minHeight: 40,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#1f6f5b",
  },
  performancePlayButtonText: {
    color: "#1f6f5b",
    fontSize: 13,
    fontWeight: "900",
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
  tunerHiddenScore: {
    width: 1,
    height: 1,
    opacity: 0,
    overflow: "hidden",
  },
  tunerPanel: {
    flex: 1,
    padding: 24,
    gap: 16,
    backgroundColor: "#fbfaf7",
  },
  tunerTabs: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tunerTab: {
    flexBasis: "31.5%",
    minHeight: 64,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d8d2c4",
  },
  tunerTabActive: {
    backgroundColor: "#1f6f5b",
    borderColor: "#185846",
  },
  tunerTabNumber: {
    color: "#66736b",
    fontSize: 16,
    fontWeight: "900",
  },
  tunerTabNumberActive: {
    color: "#ffffff",
  },
  tunerTabText: {
    marginTop: 2,
    color: "#66736b",
    fontSize: 12,
    fontWeight: "900",
  },
  tunerTabTextActive: {
    color: "#e7f2ec",
  },
  tunerString: {
    marginTop: 8,
    color: "#1f2a25",
    fontSize: 54,
    lineHeight: 62,
    fontWeight: "900",
    textAlign: "center",
  },
  tunerTargetHz: {
    color: "#1f6f5b",
    fontSize: 17,
    fontWeight: "900",
    textAlign: "center",
  },
  tunerHz: {
    color: "#66736b",
    fontSize: 22,
    fontWeight: "900",
    textAlign: "center",
  },
  tunerStatus: {
    minHeight: 30,
    color: "#1f6f5b",
    fontSize: 18,
    fontWeight: "900",
    textAlign: "center",
  },
  tunerMeter: {
    height: 54,
    borderRadius: 8,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d8d2c4",
    position: "relative",
    overflow: "hidden",
  },
  tunerCenterLine: {
    position: "absolute",
    left: "50%",
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: "#1f6f5b",
  },
  tunerNeedle: {
    position: "absolute",
    top: 5,
    bottom: 5,
    width: 5,
    marginLeft: -2,
    borderRadius: 4,
    backgroundColor: "#b3261e",
  },
  tunerMeterLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  tunerMeterLabel: {
    color: "#66736b",
    fontSize: 13,
    fontWeight: "800",
  },
  tunerCents: {
    color: "#1f2a25",
    fontSize: 20,
    fontWeight: "900",
    textAlign: "center",
  },
  tunerStartButton: {
    alignSelf: "center",
    minHeight: 54,
    minWidth: 190,
    borderRadius: 8,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1f6f5b",
  },
  tunerStartButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
  },
  tunerStringList: {
    marginTop: 6,
    borderRadius: 8,
    padding: 14,
    gap: 7,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d8d2c4",
  },
  tunerStringItem: {
    color: "#1f2a25",
    fontSize: 14,
    fontWeight: "800",
  },
  weakPracticeNotice: {
    borderRadius: 8,
    padding: 12,
    gap: 7,
    backgroundColor: "#fff7ea",
    borderWidth: 1,
    borderColor: "#f0bf78",
  },
  weakPracticeNoticeTitle: {
    color: "#5f3b00",
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "900",
  },
  weakPracticeNoticeText: {
    color: "#6f5600",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "800",
  },
  weakLegendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  weakLegendDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: "#93520b",
  },
  weakLegendSoft: {
    backgroundColor: "#f7c982",
  },
  weakLegendStrong: {
    backgroundColor: "#c62828",
  },
  weakLegendText: {
    marginRight: 8,
    color: "#5f3b00",
    fontSize: 12,
    fontWeight: "800",
  },
  disabledButton: {
    opacity: 0.45,
  },
  bpmControl: {
    minHeight: 58,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d8d2c4",
  },
  bpmTextBlock: {
    minWidth: 92,
  },
  bpmLabel: {
    color: "#66736b",
    fontSize: 12,
    fontWeight: "900",
  },
  bpmValue: {
    marginTop: 2,
    color: "#1f2a25",
    fontSize: 24,
    lineHeight: 28,
    fontWeight: "900",
  },
  bpmButtons: {
    flex: 1,
    flexDirection: "row",
    gap: 8,
  },
  bpmButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e6f0eb",
    borderWidth: 1,
    borderColor: "#9db7aa",
  },
  bpmButtonText: {
    color: "#1f6f5b",
    fontSize: 14,
    fontWeight: "900",
  },
  compactBpmControl: {
    width: 132,
    minHeight: 78,
    borderRadius: 8,
    padding: 8,
    gap: 7,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d8d2c4",
  },
  compactBpmHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
  },
  compactBpmValue: {
    color: "#1f2a25",
    fontSize: 22,
    lineHeight: 26,
    fontWeight: "900",
  },
  compactBpmButtons: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
  },
  compactBpmButton: {
    flexBasis: "47%",
    minHeight: 27,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e6f0eb",
    borderWidth: 1,
    borderColor: "#9db7aa",
  },
  analysisControls: {
    flexDirection: "row",
    gap: 8,
  },
  analysisButton: {
    flex: 1.5,
    minHeight: 52,
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
    minHeight: 52,
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
    minHeight: 52,
    minWidth: 88,
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
