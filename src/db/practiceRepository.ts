import { db, getPublicSongId, getScopedSongId, getScopedSongIdPrefix } from "./sqlite";
import { PracticeMistakeDraft, SavedPracticeSession } from "../types/practice";

type SavePracticeSessionInput = {
  songId: string;
  totalNotes: number;
  mistakes: PracticeMistakeDraft[];
  wrongMeasureCount: number;
  wrongNoteCount: number;
  isMastered: boolean;
  audioUri?: string | null;
};

function createId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function getAccuracy(totalNotes: number, wrongNoteCount: number) {
  if (totalNotes <= 0) return null;
  return Math.max(0, Math.round(((totalNotes - wrongNoteCount) / totalNotes) * 100));
}

function getHighAccuracyStreakWithoutLowBreak(songId: string) {
  const recentSessions = db.getAllSync<{
    total_notes: number;
    wrong_note_count: number;
  }>(
    `
    SELECT total_notes, wrong_note_count
    FROM practice_sessions
    WHERE song_id = ?
    ORDER BY practiced_at DESC
    LIMIT 20
    `,
    [getScopedSongId(songId)]
  );

  let highAccuracyCount = 0;

  for (const session of recentSessions) {
    const accuracy = getAccuracy(session.total_notes, session.wrong_note_count);
    if (accuracy === null) continue;
    if (accuracy < 80) break;
    if (accuracy >= 90) highAccuracyCount += 1;
  }

  return highAccuracyCount;
}

function hasThreeHighAccuracySessionsWithoutLowBreak(songId: string) {
  return getHighAccuracyStreakWithoutLowBreak(songId) >= 3;
}

export function savePracticeSession(input: SavePracticeSessionInput): SavedPracticeSession {
  const id = createId("session");
  const practicedAt = new Date().toISOString();
  let isMastered = false;

  db.withTransactionSync(() => {
    db.runSync(
      `
      INSERT INTO practice_sessions (
        id,
        song_id,
        practiced_at,
        total_notes,
        wrong_measure_count,
        wrong_note_count,
        is_mastered,
        audio_uri,
        dirty
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
      `,
      [
        id,
        getScopedSongId(input.songId),
        practicedAt,
        input.totalNotes,
        input.wrongMeasureCount,
        input.wrongNoteCount,
        0,
        input.audioUri ?? null,
      ]
    );

    for (const mistake of input.mistakes) {
      db.runSync(
        `
        INSERT INTO practice_mistakes (
          id,
          session_id,
          song_id,
          measure,
          note_index,
          expected_midi,
          played_midi,
          wrong_count,
          reason,
          created_at,
          dirty
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 1)
        `,
        [
          createId("mistake"),
          id,
          getScopedSongId(mistake.songId),
          mistake.measure,
          mistake.noteIndex,
          mistake.expectedMidi,
          mistake.playedMidi,
          mistake.reason,
          practicedAt,
        ]
      );
    }

    isMastered = hasThreeHighAccuracySessionsWithoutLowBreak(input.songId);
    db.runSync("UPDATE practice_sessions SET is_mastered = ? WHERE id = ?", [
      isMastered ? 1 : 0,
      id,
    ]);
  });

  return {
    id,
    songId: input.songId,
    practicedAt,
    totalNotes: input.totalNotes,
    wrongMeasureCount: input.wrongMeasureCount,
    wrongNoteCount: input.wrongNoteCount,
    isMastered,
  };
}

export function clearPracticeHistoryForSong(songId: string) {
  db.withTransactionSync(() => {
    db.runSync("DELETE FROM practice_mistakes WHERE song_id = ?", [getScopedSongId(songId)]);
    db.runSync("DELETE FROM practice_sessions WHERE song_id = ?", [getScopedSongId(songId)]);
  });
}

export function clearPracticeMistakesForSongMeasureRange(
  songId: string,
  fromMeasure: number,
  toMeasure: number
) {
  db.withTransactionSync(() => {
    db.runSync(
      "DELETE FROM practice_mistakes WHERE song_id = ? AND measure BETWEEN ? AND ?",
      [getScopedSongId(songId), fromMeasure, toMeasure]
    );

    const sessions = db.getAllSync<{ id: string; total_notes: number }>(
      "SELECT id, total_notes FROM practice_sessions WHERE song_id = ?",
      [getScopedSongId(songId)]
    );

    for (const session of sessions) {
      const aggregate = db.getFirstSync<{
        wrong_note_count: number;
        wrong_measure_count: number;
      }>(
        `
        SELECT
          COUNT(id) AS wrong_note_count,
          COUNT(DISTINCT measure) AS wrong_measure_count
        FROM practice_mistakes
        WHERE session_id = ?
        `,
        [session.id]
      );
      const wrongNoteCount = aggregate?.wrong_note_count ?? 0;
      const wrongMeasureCount = aggregate?.wrong_measure_count ?? 0;
      const isMastered = getAccuracy(session.total_notes, wrongNoteCount) !== null
        && (getAccuracy(session.total_notes, wrongNoteCount) ?? 0) >= 90;

      db.runSync(
        `
        UPDATE practice_sessions
        SET wrong_note_count = ?, wrong_measure_count = ?, is_mastered = ?, dirty = 1
        WHERE id = ?
        `,
        [wrongNoteCount, wrongMeasureCount, isMastered ? 1 : 0, session.id]
      );
    }
  });
}

export function getRecentSessions(limit = 20) {
  return db.getAllSync(
    `
    SELECT *
    FROM practice_sessions
    WHERE song_id LIKE ?
    ORDER BY practiced_at DESC
    LIMIT ?
    `,
    [`${getScopedSongIdPrefix()}%`, limit]
  );
}

export type FocusMeasure = {
  measure: number;
  mistakeCount: number;
};

export type FocusRange = {
  fromMeasure: number;
  toMeasure: number;
  mistakeCount: number;
  noteCount: number;
  errorRate?: number;
  isVirtual?: boolean;
  highlightNoteIndices?: number[];
  mistakeNoteIndices?: number[];
};

export type WeakPracticeSession = {
  sessionId: string;
  practicedAt: string;
  wrongMeasureCount: number;
  wrongNoteCount: number;
  missedNoteCount: number;
  totalFailedNoteCount: number;
  weakMeasures: FocusMeasure[];
  primaryMeasure: number | null;
};

export function getFocusMeasuresForSong(songId: string, limit = 3): FocusMeasure[] {
  return db.getAllSync<FocusMeasure>(
    `
    WITH recent_sessions AS (
      SELECT id
      FROM practice_sessions
      WHERE song_id = ?
      ORDER BY practiced_at DESC
      LIMIT 3
    ),
    per_session_measure AS (
      SELECT
        pm.session_id,
        pm.measure,
        SUM(pm.wrong_count) AS sessionMistakeCount
      FROM practice_mistakes pm
      JOIN recent_sessions rs ON rs.id = pm.session_id
      GROUP BY pm.session_id, pm.measure
    )
    SELECT
      measure,
      SUM(sessionMistakeCount) AS mistakeCount
    FROM per_session_measure
    GROUP BY measure
    HAVING COUNT(DISTINCT session_id) >= 2
    ORDER BY mistakeCount DESC, measure ASC
    LIMIT ?
    `,
    [getScopedSongId(songId), limit]
  );
}

export function getFocusRangesForSong(songId: string, limit = 5): FocusRange[] {
  const measures = db.getAllSync<FocusMeasure>(
    `
    WITH recent_sessions AS (
      SELECT id
      FROM practice_sessions
      WHERE song_id = ?
      ORDER BY practiced_at DESC
      LIMIT 3
    ),
    per_session_measure AS (
      SELECT
        pm.session_id,
        pm.measure,
        SUM(pm.wrong_count) AS sessionMistakeCount
      FROM practice_mistakes pm
      JOIN recent_sessions rs ON rs.id = pm.session_id
      GROUP BY pm.session_id, pm.measure
    )
    SELECT
      measure,
      SUM(sessionMistakeCount) AS mistakeCount
    FROM per_session_measure
    GROUP BY measure
    HAVING COUNT(DISTINCT session_id) >= 2
    ORDER BY measure ASC
    `,
    [getScopedSongId(songId)]
  );

  const ranges: FocusRange[] = [];

  for (const measure of measures) {
    const previous = ranges[ranges.length - 1];

    if (previous && measure.measure <= previous.toMeasure + 1) {
      previous.toMeasure = measure.measure;
      previous.mistakeCount += measure.mistakeCount;
      previous.noteCount += 1;
    } else {
      ranges.push({
        fromMeasure: measure.measure,
        toMeasure: measure.measure,
        mistakeCount: measure.mistakeCount,
        noteCount: 1,
      });
    }
  }

  return ranges
    .sort((a, b) => b.mistakeCount - a.mistakeCount || a.fromMeasure - b.fromMeasure)
    .slice(0, limit);
}

export type RecentFocusMistake = {
  sessionId: string;
  measure: number;
  noteIndex: number;
  mistakeCount: number;
};

export function getRecentPracticeSessionIdsForSong(songId: string, limit = 3) {
  return db.getAllSync<{ id: string }>(
    `
    SELECT id
    FROM practice_sessions
    WHERE song_id = ?
    ORDER BY practiced_at DESC
    LIMIT ?
    `,
    [getScopedSongId(songId), limit]
  ).map((session) => session.id);
}

export function getRecentFocusMistakesForSong(songId: string, sessionIds: string[]) {
  if (!sessionIds.length) return [];

  const placeholders = sessionIds.map(() => "?").join(", ");
  return db.getAllSync<RecentFocusMistake>(
    `
    SELECT
      session_id AS sessionId,
      measure,
      note_index AS noteIndex,
      SUM(wrong_count) AS mistakeCount
    FROM practice_mistakes
    WHERE song_id = ? AND session_id IN (${placeholders})
    GROUP BY session_id, measure, note_index
    ORDER BY measure ASC, note_index ASC
    `,
    [getScopedSongId(songId), ...sessionIds]
  );
}

export function getWeakPracticeSessionsForSong(songId: string, limit = 8): WeakPracticeSession[] {
  const sessions = db.getAllSync<{
    id: string;
    practiced_at: string;
    actual_wrong_measure_count: number;
    actual_wrong_pitch_count: number;
    actual_missed_note_count: number;
    actual_failed_note_count: number;
  }>(
    `
    SELECT
      ps.id,
      ps.practiced_at,
      SUM(CASE WHEN pm.reason = 'wrong_pitch' THEN 1 ELSE 0 END) AS actual_wrong_pitch_count,
      SUM(CASE WHEN pm.reason = 'timeout' THEN 1 ELSE 0 END) AS actual_missed_note_count,
      COUNT(pm.id) AS actual_failed_note_count,
      COUNT(DISTINCT pm.measure) AS actual_wrong_measure_count
    FROM practice_sessions ps
    JOIN practice_mistakes pm ON pm.session_id = ps.id
    WHERE ps.song_id = ?
    GROUP BY ps.id
    HAVING actual_failed_note_count > 0
    ORDER BY actual_failed_note_count DESC, actual_wrong_measure_count DESC, ps.practiced_at DESC
    LIMIT ?
    `,
    [getScopedSongId(songId), limit]
  );

  return sessions.map((session) => {
    const weakMeasures = db.getAllSync<FocusMeasure>(
      `
      SELECT
        measure,
        SUM(wrong_count) AS mistakeCount
      FROM practice_mistakes
      WHERE session_id = ?
      GROUP BY measure
      ORDER BY mistakeCount DESC, measure ASC
      LIMIT 3
      `,
      [session.id]
    );

    return {
      sessionId: session.id,
      practicedAt: session.practiced_at,
      wrongMeasureCount: session.actual_wrong_measure_count,
      wrongNoteCount: session.actual_wrong_pitch_count,
      missedNoteCount: session.actual_missed_note_count,
      totalFailedNoteCount: session.actual_failed_note_count,
      weakMeasures,
      primaryMeasure: weakMeasures[0]?.measure ?? null,
    };
  });
}

export function getLatestSessionForSong(songId: string) {
  const latest = db.getFirstSync<{
    total_notes: number;
    wrong_measure_count: number;
    wrong_note_count: number;
    is_mastered: number;
    practiced_at: string;
    audio_uri: string | null;
  }>(
    `
    SELECT total_notes, wrong_measure_count, wrong_note_count, is_mastered, practiced_at, audio_uri
    FROM practice_sessions
    WHERE song_id = ?
    ORDER BY practiced_at DESC
    LIMIT 1
    `,
    [getScopedSongId(songId)]
  );

  if (!latest) return null;

  return {
    ...latest,
    is_mastered: hasThreeHighAccuracySessionsWithoutLowBreak(songId) ? 1 : 0,
  };
}

export function getLatestMistakeNoteIndicesForSong(songId: string) {
  const latestSession = db.getFirstSync<{ id: string }>(
    `
    SELECT id
    FROM practice_sessions
    WHERE song_id = ?
    ORDER BY practiced_at DESC
    LIMIT 1
    `,
    [getScopedSongId(songId)]
  );

  if (!latestSession) return [];

  return db.getAllSync<{ note_index: number }>(
    `
    SELECT DISTINCT note_index
    FROM practice_mistakes
    WHERE session_id = ?
    ORDER BY note_index ASC
    `,
    [latestSession.id]
  ).map((row) => row.note_index);
}

export type SongPracticeSessionSummary = {
  id: string;
  practicedAt: string;
  totalNotes: number;
  wrongMeasureCount: number;
  wrongNoteCount: number;
  isMastered: boolean;
};

export type SongAchievementSummary = {
  songId: string;
  title: string;
  sessionCount: number;
  recentMonthSessionCount: number;
  recentMonthAccuracy: number | null;
  lastPracticedAt: string | null;
  latestWrongMeasureCount: number | null;
  latestWrongNoteCount: number | null;
  latestAccuracy: number | null;
  latestIsMastered: boolean;
  highAccuracyStreak: number;
  latestAudioUri: string | null;
  bestWrongMeasureCount: number | null;
  masteredCount: number;
  weakMeasures: FocusMeasure[];
};

export function getSessionsForSong(songId: string, limit = 10): SongPracticeSessionSummary[] {
  return db.getAllSync<{
    id: string;
    practiced_at: string;
    total_notes: number;
    wrong_measure_count: number;
    wrong_note_count: number;
    is_mastered: number;
  }>(
    `
    SELECT id, practiced_at, total_notes, wrong_measure_count, wrong_note_count, is_mastered
    FROM practice_sessions
    WHERE song_id = ?
    ORDER BY practiced_at DESC
    LIMIT ?
    `,
    [getScopedSongId(songId), limit]
  ).map((session) => ({
    id: session.id,
    practicedAt: session.practiced_at,
    totalNotes: session.total_notes,
    wrongMeasureCount: session.wrong_measure_count,
    wrongNoteCount: session.wrong_note_count,
    isMastered: Boolean(session.is_mastered),
  }));
}

export function getMistakeNoteIndicesForSongMeasure(songId: string, measure: number) {
  return db.getAllSync<{ note_index: number }>(
    `
    SELECT DISTINCT note_index
    FROM practice_mistakes
    WHERE song_id = ? AND measure = ?
    ORDER BY note_index ASC
    `,
    [getScopedSongId(songId), measure]
  ).map((row) => row.note_index);
}

export function getMistakeNoteIndicesForSongMeasureRange(songId: string, fromMeasure: number, toMeasure: number) {
  return db.getAllSync<{ note_index: number }>(
    `
    SELECT DISTINCT note_index
    FROM practice_mistakes
    WHERE song_id = ? AND measure BETWEEN ? AND ?
    ORDER BY note_index ASC
    `,
    [getScopedSongId(songId), fromMeasure, toMeasure]
  ).map((row) => row.note_index);
}

export function getSongAchievementSummaries(): SongAchievementSummary[] {
  const recentMonthCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const songs = db.getAllSync<{ id: string; title: string }>(
    `
    SELECT id, title
    FROM songs
    WHERE id LIKE ? AND xml_content IS NOT NULL AND xml_content != ''
    ORDER BY updated_at DESC
    `,
    [`${getScopedSongIdPrefix()}%`]
  );

  return songs.map((song) => {
    const aggregate = db.getFirstSync<{
      session_count: number;
      last_practiced_at: string | null;
      best_wrong_measure_count: number | null;
      mastered_count: number;
    }>(
      `
      SELECT
        COUNT(*) AS session_count,
        MAX(practiced_at) AS last_practiced_at,
        MIN(wrong_measure_count) AS best_wrong_measure_count,
        SUM(is_mastered) AS mastered_count
      FROM practice_sessions
      WHERE song_id = ?
      `,
      [song.id]
    );
    const latest = getLatestSessionForSong(song.id);
    const recentMonth = db.getFirstSync<{
      session_count: number;
      total_notes: number | null;
      wrong_note_count: number | null;
    }>(
      `
      SELECT
        COUNT(*) AS session_count,
        SUM(total_notes) AS total_notes,
        SUM(wrong_note_count) AS wrong_note_count
      FROM practice_sessions
      WHERE song_id = ? AND practiced_at >= ?
      `,
      [song.id, recentMonthCutoff]
    );
    const recentMonthTotalNotes = recentMonth?.total_notes ?? 0;
    const recentMonthWrongNoteCount = recentMonth?.wrong_note_count ?? 0;

    return {
      songId: getPublicSongId(song.id),
      title: song.title,
      sessionCount: aggregate?.session_count ?? 0,
      recentMonthSessionCount: recentMonth?.session_count ?? 0,
      recentMonthAccuracy: recentMonthTotalNotes
        ? getAccuracy(recentMonthTotalNotes, recentMonthWrongNoteCount)
        : null,
      lastPracticedAt: aggregate?.last_practiced_at ?? null,
      latestWrongMeasureCount: latest?.wrong_measure_count ?? null,
      latestWrongNoteCount: latest?.wrong_note_count ?? null,
      latestAccuracy: latest ? getAccuracy(latest.total_notes, latest.wrong_note_count) : null,
      latestIsMastered: hasThreeHighAccuracySessionsWithoutLowBreak(song.id),
      highAccuracyStreak: getHighAccuracyStreakWithoutLowBreak(song.id),
      latestAudioUri: latest?.audio_uri ?? null,
      bestWrongMeasureCount: aggregate?.best_wrong_measure_count ?? null,
      masteredCount: aggregate?.mastered_count ?? 0,
      weakMeasures: getFocusMeasuresForSong(song.id, 3),
    };
  });
}


