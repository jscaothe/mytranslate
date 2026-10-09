//! Translation history on this PC (SQLite): conversations, threads and translated messages.
//! It feeds thread detection and the context sent with each translation, and the Threads screen.

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

/// Bump with a new entry in `MIGRATIONS` whenever the schema changes.
const MIGRATIONS: &[&str] = &[
    r#"
    CREATE TABLE conversations (
        id          INTEGER PRIMARY KEY,
        app         TEXT NOT NULL,
        name        TEXT NOT NULL,
        workspace   TEXT NOT NULL DEFAULT '',
        last_active INTEGER NOT NULL,
        UNIQUE (app, name, workspace)
    );
    CREATE TABLE threads (
        id              INTEGER PRIMARY KEY,
        conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        title           TEXT NOT NULL,
        pinned          INTEGER NOT NULL DEFAULT 0,
        created_at      INTEGER NOT NULL,
        last_active     INTEGER NOT NULL
    );
    CREATE INDEX threads_by_conversation ON threads (conversation_id, last_active DESC);
    CREATE TABLE messages (
        id             INTEGER PRIMARY KEY,
        thread_id      INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        direction      TEXT NOT NULL,
        source         TEXT NOT NULL,
        result         TEXT NOT NULL,
        back           TEXT NOT NULL DEFAULT '',
        model          TEXT NOT NULL DEFAULT '',
        prompt_version INTEGER NOT NULL DEFAULT 0,
        first_token_ms INTEGER,
        total_ms       INTEGER,
        created_at     INTEGER NOT NULL
    );
    CREATE INDEX messages_by_thread ON messages (thread_id, created_at);
    CREATE TABLE thread_corrections (
        id              INTEGER PRIMARY KEY,
        conversation_id INTEGER NOT NULL,
        from_thread     INTEGER,
        to_thread       INTEGER NOT NULL,
        created_at      INTEGER NOT NULL
    );
"#,
    r#"
    CREATE TABLE glossary_terms (
        id         INTEGER PRIMARY KEY,
        ja         TEXT NOT NULL,
        vi         TEXT NOT NULL,
        note       TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        UNIQUE (ja, vi)
    );
"#,
];

pub struct History {
    conn: Mutex<Connection>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadInfo {
    pub id: i64,
    pub conversation_id: i64,
    pub title: String,
    pub pinned: bool,
    pub last_active: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageInfo {
    pub id: i64,
    pub thread_id: i64,
    pub direction: String,
    pub source: String,
    pub result: String,
    pub back: String,
    pub created_at: i64,
}

impl MessageInfo {
    /// The Japanese side of the exchange and who wrote it, for the prompt's thread context.
    pub fn japanese(&self) -> (bool, &str) {
        match self.direction.as_str() {
            // A client message translated for the user.
            "ja_vi" => (true, &self.source),
            // The user's own message, sent in Japanese.
            _ => (false, &self.result),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationInfo {
    pub id: i64,
    pub app: String,
    pub name: String,
    pub workspace: String,
    pub last_active: i64,
}

pub struct NewMessage<'a> {
    pub direction: &'a str,
    pub source: &'a str,
    pub result: &'a str,
    pub back: &'a str,
    pub model: &'a str,
    pub prompt_version: u32,
    pub first_token_ms: Option<u64>,
    pub total_ms: u64,
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

impl History {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        Self::init(Connection::open(path)?)
    }

    #[cfg(test)]
    pub fn in_memory() -> Self {
        Self::init(Connection::open_in_memory().unwrap()).unwrap()
    }

    fn init(mut conn: Connection) -> rusqlite::Result<Self> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let version: usize = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
        for (i, sql) in MIGRATIONS.iter().enumerate().skip(version) {
            let tx = conn.transaction()?;
            tx.execute_batch(sql)?;
            tx.pragma_update(None, "user_version", i + 1)?;
            tx.commit()?;
        }
        Ok(Self { conn: Mutex::new(conn) })
    }

    pub fn upsert_conversation(&self, app: &str, name: &str, workspace: &str) -> rusqlite::Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "INSERT INTO conversations (app, name, workspace, last_active) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (app, name, workspace) DO UPDATE SET last_active = excluded.last_active
             RETURNING id",
            params![app, name, workspace, now_ms()],
            |r| r.get(0),
        )
    }

    /// Threads of a conversation active since `since_ms`, most recent first.
    pub fn recent_threads(
        &self,
        conversation_id: i64,
        since_ms: i64,
        limit: usize,
    ) -> rusqlite::Result<Vec<ThreadInfo>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, conversation_id, title, pinned, last_active FROM threads
             WHERE conversation_id = ?1 AND last_active >= ?2 ORDER BY last_active DESC LIMIT ?3",
        )?;
        stmt.query_map(params![conversation_id, since_ms, limit as i64], thread_row)?
            .collect()
    }

    pub fn thread(&self, id: i64) -> rusqlite::Result<Option<ThreadInfo>> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id, conversation_id, title, pinned, last_active FROM threads WHERE id = ?1",
            [id],
            thread_row,
        )
        .optional()
    }

    /// The last `limit` messages of a thread, oldest first.
    pub fn recent_messages(&self, thread_id: i64, limit: usize) -> rusqlite::Result<Vec<MessageInfo>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, thread_id, direction, source, result, back, created_at FROM
               (SELECT * FROM messages WHERE thread_id = ?1 ORDER BY created_at DESC, id DESC LIMIT ?2)
             ORDER BY created_at, id",
        )?;
        stmt.query_map(params![thread_id, limit as i64], message_row)?.collect()
    }

    pub fn create_thread(&self, conversation_id: i64, title: &str) -> rusqlite::Result<i64> {
        let conn = self.conn.lock().unwrap();
        let now = now_ms();
        conn.execute(
            "INSERT INTO threads (conversation_id, title, created_at, last_active) VALUES (?1, ?2, ?3, ?3)",
            params![conversation_id, title, now],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn rename_thread(&self, id: i64, title: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE threads SET title = ?2 WHERE id = ?1", params![id, title])?;
        Ok(())
    }

    pub fn add_message(&self, thread_id: i64, m: &NewMessage) -> rusqlite::Result<i64> {
        let conn = self.conn.lock().unwrap();
        let now = now_ms();
        conn.execute(
            "INSERT INTO messages (thread_id, direction, source, result, back, model, prompt_version,
                                   first_token_ms, total_ms, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                thread_id,
                m.direction,
                m.source,
                m.result,
                m.back,
                m.model,
                m.prompt_version,
                m.first_token_ms.map(|v| v as i64),
                m.total_ms as i64,
                now
            ],
        )?;
        let id = conn.last_insert_rowid();
        conn.execute(
            "UPDATE threads SET last_active = ?2 WHERE id = ?1",
            params![thread_id, now],
        )?;
        Ok(id)
    }

    /// The user moved a message to another thread (in the popup or the Threads screen).
    pub fn move_message(&self, message_id: i64, thread_id: i64) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE messages SET thread_id = ?2 WHERE id = ?1",
            params![message_id, thread_id],
        )?;
        conn.execute(
            "UPDATE threads SET last_active = ?2 WHERE id = ?1",
            params![thread_id, now_ms()],
        )?;
        // A thread left empty by the move was a wrong guess; drop it.
        conn.execute(
            "DELETE FROM threads WHERE NOT EXISTS (SELECT 1 FROM messages WHERE thread_id = threads.id)",
            [],
        )?;
        Ok(())
    }

    /// Records that the guess was wrong, to measure detection accuracy over time.
    pub fn record_correction(&self, conversation_id: i64, from: Option<i64>, to: i64) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO thread_corrections (conversation_id, from_thread, to_thread, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![conversation_id, from, to, now_ms()],
        )?;
        Ok(())
    }

    pub fn conversations(&self) -> rusqlite::Result<Vec<ConversationInfo>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, app, name, workspace, last_active FROM conversations
             WHERE EXISTS (SELECT 1 FROM threads WHERE conversation_id = conversations.id)
             ORDER BY last_active DESC",
        )?;
        stmt.query_map([], |r| {
            Ok(ConversationInfo {
                id: r.get(0)?,
                app: r.get(1)?,
                name: r.get(2)?,
                workspace: r.get(3)?,
                last_active: r.get(4)?,
            })
        })?
        .collect()
    }

    pub fn all_threads(&self) -> rusqlite::Result<Vec<ThreadInfo>> {
        self.recent_all(i64::MIN)
    }

    fn recent_all(&self, since_ms: i64) -> rusqlite::Result<Vec<ThreadInfo>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, conversation_id, title, pinned, last_active FROM threads
             WHERE last_active >= ?1 ORDER BY last_active DESC",
        )?;
        stmt.query_map([since_ms], thread_row)?.collect()
    }

    pub fn messages(&self, thread_id: i64) -> rusqlite::Result<Vec<MessageInfo>> {
        self.recent_messages(thread_id, usize::MAX >> 1)
    }

    pub fn glossary(&self) -> rusqlite::Result<Vec<GlossaryTerm>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, ja, vi, note FROM glossary_terms ORDER BY created_at DESC, id DESC")?;
        stmt.query_map([], |r| {
            Ok(GlossaryTerm {
                id: r.get(0)?,
                ja: r.get(1)?,
                vi: r.get(2)?,
                note: r.get(3)?,
            })
        })?
        .collect()
    }

    /// Adds a term, or updates the note of an identical pair.
    pub fn add_glossary_term(&self, ja: &str, vi: &str, note: &str) -> rusqlite::Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "INSERT INTO glossary_terms (ja, vi, note, created_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (ja, vi) DO UPDATE SET note = excluded.note
             RETURNING id",
            params![ja.trim(), vi.trim(), note.trim(), now_ms()],
            |r| r.get(0),
        )
    }

    pub fn delete_glossary_term(&self, id: i64) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM glossary_terms WHERE id = ?1", [id])?;
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlossaryTerm {
    pub id: i64,
    pub ja: String,
    pub vi: String,
    pub note: String,
}

impl GlossaryTerm {
    /// Whether the term occurs in `text`: the Japanese side as written, the Vietnamese side ignoring case.
    pub fn appears_in(&self, text: &str, lower_text: &str) -> bool {
        (!self.ja.is_empty() && text.contains(&self.ja))
            || (!self.vi.is_empty() && lower_text.contains(&self.vi.to_lowercase()))
    }
}

fn thread_row(r: &rusqlite::Row) -> rusqlite::Result<ThreadInfo> {
    Ok(ThreadInfo {
        id: r.get(0)?,
        conversation_id: r.get(1)?,
        title: r.get(2)?,
        pinned: r.get::<_, i64>(3)? != 0,
        last_active: r.get(4)?,
    })
}

fn message_row(r: &rusqlite::Row) -> rusqlite::Result<MessageInfo> {
    Ok(MessageInfo {
        id: r.get(0)?,
        thread_id: r.get(1)?,
        direction: r.get(2)?,
        source: r.get(3)?,
        result: r.get(4)?,
        back: r.get(5)?,
        created_at: r.get(6)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg<'a>(direction: &'a str, source: &'a str, result: &'a str) -> NewMessage<'a> {
        NewMessage {
            direction,
            source,
            result,
            back: "",
            model: "sonnet",
            prompt_version: 4,
            first_token_ms: Some(900),
            total_ms: 2500,
        }
    }

    #[test]
    fn conversation_is_reused_by_app_name_and_workspace() {
        let h = History::in_memory();
        let a = h.upsert_conversation("slack", "dev-qa", "CustomerX").unwrap();
        let b = h.upsert_conversation("slack", "dev-qa", "CustomerX").unwrap();
        let c = h.upsert_conversation("teams", "dev-qa", "CustomerX").unwrap();
        assert_eq!(a, b);
        assert_ne!(a, c);
    }

    #[test]
    fn stores_messages_and_returns_the_latest_in_order() {
        let h = History::in_memory();
        let conv = h.upsert_conversation("slack", "dev-qa", "").unwrap();
        let t = h.create_thread(conv, "Lỗi đăng nhập").unwrap();
        for i in 0..8 {
            h.add_message(t, &msg("ja_vi", &format!("原文{i}"), &format!("bản dịch {i}")))
                .unwrap();
        }
        let last = h.recent_messages(t, 3).unwrap();
        assert_eq!(
            last.iter().map(|m| m.source.as_str()).collect::<Vec<_>>(),
            ["原文5", "原文6", "原文7"]
        );
        assert_eq!(h.recent_threads(conv, 0, 8).unwrap().len(), 1);
    }

    #[test]
    fn japanese_side_depends_on_direction() {
        let h = History::in_memory();
        let conv = h.upsert_conversation("slack", "dm", "").unwrap();
        let t = h.create_thread(conv, "x").unwrap();
        h.add_message(t, &msg("ja_vi", "確認しました", "Đã xác nhận")).unwrap();
        h.add_message(t, &msg("vi_ja", "Cảm ơn", "ありがとうございます"))
            .unwrap();
        let m = h.recent_messages(t, 6).unwrap();
        assert_eq!(m[0].japanese(), (true, "確認しました"));
        assert_eq!(m[1].japanese(), (false, "ありがとうございます"));
    }

    #[test]
    fn moving_the_only_message_removes_the_empty_thread() {
        let h = History::in_memory();
        let conv = h.upsert_conversation("teams", "Tanaka", "").unwrap();
        let wrong = h.create_thread(conv, "Đoán sai").unwrap();
        let right = h.create_thread(conv, "Đúng").unwrap();
        let m = h.add_message(wrong, &msg("ja_vi", "a", "b")).unwrap();
        h.move_message(m, right).unwrap();
        assert!(h.thread(wrong).unwrap().is_none());
        assert_eq!(h.messages(right).unwrap().len(), 1);
    }

    #[test]
    fn glossary_upserts_and_matches_either_language() {
        let h = History::in_memory();
        let id = h.add_glossary_term("仕訳", "bút toán", "").unwrap();
        assert_eq!(h.add_glossary_term(" 仕訳 ", "bút toán", "kế toán").unwrap(), id);
        let terms = h.glossary().unwrap();
        assert_eq!(terms.len(), 1);
        assert_eq!(terms[0].note, "kế toán");
        let t = &terms[0];
        assert!(t.appears_in("仕訳の入力画面", "仕訳の入力画面"));
        let vi = "Kiểm tra lại Bút Toán giúp em";
        assert!(t.appears_in(vi, &vi.to_lowercase()));
        assert!(!t.appears_in("請求書", "請求書"));
        h.delete_glossary_term(id).unwrap();
        assert!(h.glossary().unwrap().is_empty());
    }

    #[test]
    fn reopening_keeps_data_and_schema() {
        let path = std::env::temp_dir().join(format!("mytranslate-history-{}.db", std::process::id()));
        {
            let h = History::open(&path).unwrap();
            let conv = h.upsert_conversation("slack", "general", "").unwrap();
            h.create_thread(conv, "Họp").unwrap();
        }
        let h = History::open(&path).unwrap();
        assert_eq!(h.all_threads().unwrap().len(), 1);
        drop(h);
        for ext in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{ext}", path.display()));
        }
    }
}
