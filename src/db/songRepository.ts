import { db } from "./sqlite";

export type SavedSong = {
  id: string;
  title: string;
  xmlContent: string;
  updatedAt: string;
};

export function saveSong(input: { id: string; title: string; xmlContent: string }) {
  const now = new Date().toISOString();
  const existing = db.getFirstSync<{ id: string; created_at: string }>(
    "SELECT id, created_at FROM songs WHERE id = ?",
    [input.id]
  );

  db.runSync(
    `
    INSERT OR REPLACE INTO songs (
      id,
      title,
      xml_content,
      created_at,
      updated_at,
      dirty
    ) VALUES (?, ?, ?, ?, ?, 1)
    `,
    [input.id, input.title, input.xmlContent, existing?.created_at ?? now, now]
  );
}

export function getSavedSongs(): SavedSong[] {
  return db.getAllSync<{
    id: string;
    title: string;
    xml_content: string;
    updated_at: string;
  }>(
    `
    SELECT id, title, xml_content, updated_at
    FROM songs
    WHERE xml_content IS NOT NULL AND xml_content != ''
    ORDER BY updated_at DESC
    `
  ).map((song) => ({
    id: song.id,
    title: song.title,
    xmlContent: song.xml_content,
    updatedAt: song.updated_at,
  }));
}

export function getSavedSong(id: string): SavedSong | null {
  const song = db.getFirstSync<{
    id: string;
    title: string;
    xml_content: string;
    updated_at: string;
  }>(
    `
    SELECT id, title, xml_content, updated_at
    FROM songs
    WHERE id = ?
    LIMIT 1
    `,
    [id]
  );

  if (!song) return null;

  return {
    id: song.id,
    title: song.title,
    xmlContent: song.xml_content,
    updatedAt: song.updated_at,
  };
}

export function deleteSavedSong(id: string) {
  db.runSync("DELETE FROM songs WHERE id = ?", [id]);
}
