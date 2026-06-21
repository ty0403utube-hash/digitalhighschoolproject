import * as SQLite from "expo-sqlite";

export const db = SQLite.openDatabaseSync("guitar_practice.db");
let activeDbUserId = "local";

function encodeDbUserId(userId: string) {
  return Array.from(userId)
    .map((char) => char.charCodeAt(0).toString(16).padStart(4, "0"))
    .join("");
}

export function setActiveDbUserId(userId: string | null | undefined) {
  activeDbUserId = userId?.trim().toLowerCase() || "local";
}

export function getScopedSongIdPrefix() {
  return `user_${encodeDbUserId(activeDbUserId)}__`;
}

export function getScopedSongId(songId: string) {
  const prefix = getScopedSongIdPrefix();
  return songId.startsWith(prefix) ? songId : `${prefix}${songId}`;
}

export function getPublicSongId(songId: string) {
  const prefix = getScopedSongIdPrefix();
  return songId.startsWith(prefix) ? songId.slice(prefix.length) : songId;
}
export function clearActiveDbUserData() {
  const scopedSongPattern = `${getScopedSongIdPrefix()}%`;
  db.withTransactionSync(() => {
    db.runSync("DELETE FROM practice_mistakes WHERE song_id LIKE ?", [scopedSongPattern]);
    db.runSync("DELETE FROM practice_sessions WHERE song_id LIKE ?", [scopedSongPattern]);
    db.runSync("DELETE FROM songs WHERE id LIKE ?", [scopedSongPattern]);
  });
}

export function initDb() {
  db.execSync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS songs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      composer TEXT,
      storage_path TEXT,
      local_xml_path TEXT,
      xml_content TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      dirty INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS practice_sessions (
      id TEXT PRIMARY KEY,
      song_id TEXT NOT NULL,
      practiced_at TEXT NOT NULL,
      total_notes INTEGER NOT NULL,
      wrong_measure_count INTEGER NOT NULL,
      wrong_note_count INTEGER NOT NULL,
      is_mastered INTEGER NOT NULL,
      audio_uri TEXT,
      synced_at TEXT,
      dirty INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS practice_mistakes (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      song_id TEXT NOT NULL,
      measure INTEGER NOT NULL,
      note_index INTEGER NOT NULL,
      expected_midi INTEGER NOT NULL,
      played_midi INTEGER,
      wrong_count INTEGER NOT NULL DEFAULT 1,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      synced_at TEXT,
      dirty INTEGER NOT NULL DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_song_id
    ON practice_sessions(song_id);

    CREATE INDEX IF NOT EXISTS idx_sessions_dirty
    ON practice_sessions(dirty);

    CREATE INDEX IF NOT EXISTS idx_mistakes_session_id
    ON practice_mistakes(session_id);

    CREATE INDEX IF NOT EXISTS idx_mistakes_dirty
    ON practice_mistakes(dirty);

    CREATE INDEX IF NOT EXISTS idx_mistakes_song_measure
    ON practice_mistakes(song_id, measure);
  `);

  try {
    db.execSync("ALTER TABLE songs ADD COLUMN xml_content TEXT;");
  } catch {
    // Existing databases already have this column.
  }

  try {
    db.execSync("ALTER TABLE practice_sessions ADD COLUMN audio_uri TEXT;");
  } catch {
    // Existing databases already have this column.
  }
}



