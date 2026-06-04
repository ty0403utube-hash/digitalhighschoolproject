import * as SQLite from "expo-sqlite";

export const db = SQLite.openDatabaseSync("guitar_practice.db");

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
}
