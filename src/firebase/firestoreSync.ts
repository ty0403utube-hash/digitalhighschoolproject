import { doc, getFirestore, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../db/sqlite";
import { getFirebaseApp } from "./firebaseApp";

type DirtySessionRow = {
  id: string;
  song_id: string;
  practiced_at: string;
  total_notes: number;
  wrong_measure_count: number;
  wrong_note_count: number;
  is_mastered: number;
};

type DirtyMistakeRow = {
  id: string;
  session_id: string;
  song_id: string;
  measure: number;
  note_index: number;
  expected_midi: number;
  played_midi: number | null;
  wrong_count: number;
  reason: string;
  created_at: string;
};

export async function syncDirtyPracticeData(uid: string) {
  const firestore = getFirestore(getFirebaseApp());
  const syncedAt = new Date().toISOString();

  const sessions = db.getAllSync<DirtySessionRow>(
    "SELECT * FROM practice_sessions WHERE dirty = 1"
  );

  for (const session of sessions) {
    await setDoc(
      doc(firestore, "users", uid, "practiceSessions", session.id),
      {
        songId: session.song_id,
        practicedAt: session.practiced_at,
        totalNotes: session.total_notes,
        wrongMeasureCount: session.wrong_measure_count,
        wrongNoteCount: session.wrong_note_count,
        isMastered: Boolean(session.is_mastered),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    const mistakes = db.getAllSync<DirtyMistakeRow>(
      "SELECT * FROM practice_mistakes WHERE session_id = ? AND dirty = 1",
      [session.id]
    );

    for (const mistake of mistakes) {
      await setDoc(
        doc(
          firestore,
          "users",
          uid,
          "practiceSessions",
          session.id,
          "mistakes",
          mistake.id
        ),
        {
          songId: mistake.song_id,
          measure: mistake.measure,
          noteIndex: mistake.note_index,
          expectedMidi: mistake.expected_midi,
          playedMidi: mistake.played_midi,
          wrongCount: mistake.wrong_count,
          reason: mistake.reason,
          createdAt: mistake.created_at,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      db.runSync(
        "UPDATE practice_mistakes SET dirty = 0, synced_at = ? WHERE id = ?",
        [syncedAt, mistake.id]
      );
    }

    await setDoc(
      doc(firestore, "users", uid, "songStats", session.song_id),
      {
        latestWrongMeasureCount: session.wrong_measure_count,
        latestWrongNoteCount: session.wrong_note_count,
        lastPracticedAt: session.practiced_at,
        isMastered: Boolean(session.is_mastered),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    db.runSync("UPDATE practice_sessions SET dirty = 0, synced_at = ? WHERE id = ?", [
      syncedAt,
      session.id,
    ]);
  }
}
