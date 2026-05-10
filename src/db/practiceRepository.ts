import { db } from "./sqlite";
import { PracticeMistakeDraft, SavedPracticeSession } from "../types/practice";

type SavePracticeSessionInput = {
  songId: string;
  totalNotes: number;
  mistakes: PracticeMistakeDraft[];
  wrongMeasureCount: number;
  wrongNoteCount: number;
  isMastered: boolean;
};

function createId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function savePracticeSession(input: SavePracticeSessionInput): SavedPracticeSession {
  const id = createId("session");
  const practicedAt = new Date().toISOString();

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
        dirty
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
      `,
      [
        id,
        input.songId,
        practicedAt,
        input.totalNotes,
        input.wrongMeasureCount,
        input.wrongNoteCount,
        input.isMastered ? 1 : 0,
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
          mistake.songId,
          mistake.measure,
          mistake.noteIndex,
          mistake.expectedMidi,
          mistake.playedMidi,
          mistake.reason,
          practicedAt,
        ]
      );
    }
  });

  return {
    id,
    songId: input.songId,
    practicedAt,
    totalNotes: input.totalNotes,
    wrongMeasureCount: input.wrongMeasureCount,
    wrongNoteCount: input.wrongNoteCount,
    isMastered: input.isMastered,
  };
}

export function getRecentSessions(limit = 20) {
  return db.getAllSync(
    `
    SELECT *
    FROM practice_sessions
    ORDER BY practiced_at DESC
    LIMIT ?
    `,
    [limit]
  );
}

export type FocusMeasure = {
  measure: number;
  mistakeCount: number;
};

export function getFocusMeasuresForSong(songId: string, limit = 3): FocusMeasure[] {
  return db.getAllSync<FocusMeasure>(
    `
    SELECT
      measure,
      SUM(wrong_count) AS mistakeCount
    FROM practice_mistakes
    WHERE song_id = ?
    GROUP BY measure
    ORDER BY mistakeCount DESC, measure ASC
    LIMIT ?
    `,
    [songId, limit]
  );
}

export function getLatestSessionForSong(songId: string) {
  return db.getFirstSync<{
    wrong_measure_count: number;
    wrong_note_count: number;
    is_mastered: number;
    practiced_at: string;
  }>(
    `
    SELECT wrong_measure_count, wrong_note_count, is_mastered, practiced_at
    FROM practice_sessions
    WHERE song_id = ?
    ORDER BY practiced_at DESC
    LIMIT 1
    `,
    [songId]
  );
}

export type SongPracticeSessionSummary = {
  id: string;
  practicedAt: string;
  totalNotes: number;
  wrongMeasureCount: number;
  wrongNoteCount: number;
  isMastered: boolean;
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
    [songId, limit]
  ).map((session) => ({
    id: session.id,
    practicedAt: session.practiced_at,
    totalNotes: session.total_notes,
    wrongMeasureCount: session.wrong_measure_count,
    wrongNoteCount: session.wrong_note_count,
    isMastered: Boolean(session.is_mastered),
  }));
}
