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
    r#"
    ALTER TABLE threads ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE threads ADD COLUMN summary TEXT NOT NULL DEFAULT '';
    -- How many messages the summary covered; more messages since then make it stale.
    ALTER TABLE threads ADD COLUMN summary_messages INTEGER NOT NULL DEFAULT 0;
    -- Per conversation: the keigo level to write in ('' = the default from the settings), and a free-form
    -- note about the people in it that is sent with each translation.
    ALTER TABLE conversations ADD COLUMN keigo TEXT NOT NULL DEFAULT '';
    ALTER TABLE conversations ADD COLUMN note TEXT NOT NULL DEFAULT '';
"#,
    r#"
    -- The user marked the translation as poor ("Dịch chưa tốt"): material for prompt improvements.
    ALTER TABLE messages ADD COLUMN feedback INTEGER NOT NULL DEFAULT 0;
"#,
];

/// Every table holding user data, children first (for wiping).
const DATA_TABLES: [&str; 5] = [
    "thread_corrections",
    "messages",
    "threads",
    "conversations",
    "glossary_terms",
];

/// Columns of `ThreadInfo`, in `thread_row` order.
const THREAD_COLUMNS: &str = "id, conversation_id, title, pinned, last_active, archived, summary, summary_messages,
     (SELECT COUNT(*) FROM messages WHERE thread_id = threads.id)";
/// Columns of `ConversationInfo`, in `conversation_row` order.
const CONVERSATION_COLUMNS: &str = "id, app, name, workspace, last_active, keigo, note";

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
    /// Hidden from the Threads list and never guessed for new messages.
    pub archived: bool,
    /// Vietnamese summary made on request; empty when there is none.
    pub summary: String,
    /// New messages arrived after the summary was made.
    pub summary_stale: bool,
    pub message_count: i64,
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
    /// casual, polite or formal; empty means the default from the settings.
    pub keigo: String,
    /// Who the people in this conversation are, sent with each translation.
    pub note: String,
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
        // Unicode lowercase for search; SQLite's own lower() only knows ASCII.
        conn.create_scalar_function(
            "fold",
            1,
            rusqlite::functions::FunctionFlags::SQLITE_UTF8 | rusqlite::functions::FunctionFlags::SQLITE_DETERMINISTIC,
            |ctx| Ok(ctx.get::<String>(0)?.to_lowercase()),
        )?;
        migrate(&mut conn)?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    /// Writes a consistent copy of the whole history to `path` (works while the app is in use).
    pub fn backup_to(&self, path: &Path) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        let _ = std::fs::remove_file(path);
        conn.execute("VACUUM INTO ?1", [path.to_string_lossy()])?;
        Ok(())
    }

    /// Replaces the whole history with a backup made by `backup_to` (or an older version of the app).
    /// The file is checked first; on any problem the current history is left untouched.
    pub fn restore_from(&self, path: &Path) -> Result<(), String> {
        let source = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| format!("Không mở được file: {e}"))?;
        let version: usize = source
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .map_err(|_| "File không phải bản sao lưu của MyTranslate".to_string())?;
        let has_tables: i64 = source
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('conversations', 'threads', 'messages')",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if version == 0 || has_tables != 3 {
            return Err("File không phải bản sao lưu của MyTranslate".into());
        }
        if version > MIGRATIONS.len() {
            return Err("Bản sao lưu được tạo bằng phiên bản app mới hơn; hãy cập nhật app trước".into());
        }
        drop(source);
        let mut conn = self.conn.lock().unwrap();
        conn.restore(rusqlite::MAIN_DB, path, None::<fn(rusqlite::backup::Progress)>)
            .map_err(|e| format!("Không khôi phục được: {e}"))?;
        // A backup from an older app version gets the newer columns.
        migrate(&mut conn).map_err(|e| e.to_string())
    }

    /// Deletes every conversation, thread, message and personal glossary term.
    pub fn wipe(&self) -> rusqlite::Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        for table in DATA_TABLES {
            tx.execute(&format!("DELETE FROM {table}"), [])?;
        }
        tx.commit()?;
        conn.execute_batch("VACUUM")
    }

    /// Deletes messages older than `before_ms` and the threads they leave empty. Returns how many messages.
    pub fn delete_older_than(&self, before_ms: i64) -> rusqlite::Result<usize> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let n = tx.execute("DELETE FROM messages WHERE created_at < ?1", [before_ms])?;
        if n > 0 {
            tx.execute(
                "DELETE FROM threads WHERE NOT EXISTS (SELECT 1 FROM messages WHERE thread_id = threads.id)",
                [],
            )?;
        }
        tx.commit()?;
        Ok(n)
    }

    /// Threads whose title, summary or any message contains `query`, ignoring case (Vietnamese letters too).
    pub fn search_threads(&self, query: &str) -> rusqlite::Result<Vec<i64>> {
        let q = query.trim().to_lowercase();
        if q.is_empty() {
            return Ok(Vec::new());
        }
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id FROM threads WHERE instr(fold(title), ?1) OR instr(fold(summary), ?1)
             UNION
             SELECT DISTINCT thread_id FROM messages
             WHERE instr(fold(source), ?1) OR instr(fold(result), ?1) OR instr(fold(back), ?1)",
        )?;
        stmt.query_map([q], |r| r.get(0))?.collect()
    }

    pub fn set_feedback(&self, message_id: i64, bad: bool) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE messages SET feedback = ?2 WHERE id = ?1",
            params![message_id, if bad { -1 } else { 0 }],
        )?;
        Ok(())
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
        let mut stmt = conn.prepare(&format!(
            "SELECT {THREAD_COLUMNS} FROM threads
             WHERE conversation_id = ?1 AND last_active >= ?2 AND archived = 0 ORDER BY last_active DESC LIMIT ?3"
        ))?;
        stmt.query_map(params![conversation_id, since_ms, limit as i64], thread_row)?
            .collect()
    }

    pub fn thread(&self, id: i64) -> rusqlite::Result<Option<ThreadInfo>> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            &format!("SELECT {THREAD_COLUMNS} FROM threads WHERE id = ?1"),
            [id],
            thread_row,
        )
        .optional()
    }

    /// The thread the user pinned in this conversation: every new message goes there.
    pub fn pinned_thread(&self, conversation_id: i64) -> rusqlite::Result<Option<ThreadInfo>> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            &format!("SELECT {THREAD_COLUMNS} FROM threads WHERE conversation_id = ?1 AND pinned = 1 AND archived = 0"),
            [conversation_id],
            thread_row,
        )
        .optional()
    }

    /// Pins a thread (unpinning any other in its conversation: only one can collect the new messages).
    pub fn set_pinned(&self, id: i64, pinned: bool) -> rusqlite::Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        if pinned {
            tx.execute(
                "UPDATE threads SET pinned = 0
                 WHERE conversation_id = (SELECT conversation_id FROM threads WHERE id = ?1)",
                [id],
            )?;
            // A pinned thread is in use again.
            tx.execute("UPDATE threads SET pinned = 1, archived = 0 WHERE id = ?1", [id])?;
        } else {
            tx.execute("UPDATE threads SET pinned = 0 WHERE id = ?1", [id])?;
        }
        tx.commit()
    }

    /// Archiving also unpins: an archived thread must not keep collecting messages.
    pub fn set_archived(&self, id: i64, archived: bool) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE threads SET archived = ?2, pinned = CASE WHEN ?2 THEN 0 ELSE pinned END WHERE id = ?1",
            params![id, archived],
        )?;
        Ok(())
    }

    /// Moves every message of `from` into `into` and removes `from`. Both must be in the same conversation.
    pub fn merge_threads(&self, from: i64, into: i64) -> rusqlite::Result<()> {
        if from == into {
            return Ok(());
        }
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let conversation: i64 = tx.query_row(
            "SELECT a.conversation_id FROM threads a JOIN threads b ON a.conversation_id = b.conversation_id
             WHERE a.id = ?1 AND b.id = ?2",
            params![from, into],
            |r| r.get(0),
        )?;
        tx.execute(
            "UPDATE messages SET thread_id = ?2 WHERE thread_id = ?1",
            params![from, into],
        )?;
        tx.execute(
            "UPDATE threads SET
                last_active = MAX(last_active, (SELECT last_active FROM threads WHERE id = ?1)),
                pinned = MAX(pinned, (SELECT pinned FROM threads WHERE id = ?1))
             WHERE id = ?2",
            params![from, into],
        )?;
        tx.execute("DELETE FROM threads WHERE id = ?1", [from])?;
        tx.execute(
            "INSERT INTO thread_corrections (conversation_id, from_thread, to_thread, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![conversation, from, into, now_ms()],
        )?;
        tx.commit()
    }

    /// Deletes a thread and its messages for good.
    pub fn delete_thread(&self, id: i64) -> rusqlite::Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        tx.execute(
            "DELETE FROM thread_corrections WHERE from_thread = ?1 OR to_thread = ?1",
            [id],
        )?;
        // Messages go with it (ON DELETE CASCADE).
        tx.execute("DELETE FROM threads WHERE id = ?1", [id])?;
        tx.commit()
    }

    /// Deletes a conversation with its keigo and note, its threads and their messages. A new translation from
    /// the same chat starts it again from scratch.
    pub fn delete_conversation(&self, id: i64) -> rusqlite::Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM thread_corrections WHERE conversation_id = ?1", [id])?;
        // Threads and messages go with it (ON DELETE CASCADE).
        tx.execute("DELETE FROM conversations WHERE id = ?1", [id])?;
        tx.commit()
    }

    /// Stores a summary covering the thread's current messages.
    pub fn set_summary(&self, id: i64, summary: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE threads SET summary = ?2, summary_messages = (SELECT COUNT(*) FROM messages WHERE thread_id = ?1)
             WHERE id = ?1",
            params![id, summary.trim()],
        )?;
        Ok(())
    }

    pub fn conversation(&self, id: i64) -> rusqlite::Result<Option<ConversationInfo>> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            &format!("SELECT {CONVERSATION_COLUMNS} FROM conversations WHERE id = ?1"),
            [id],
            conversation_row,
        )
        .optional()
    }

    /// `keigo` is casual, polite, formal, or empty for the default.
    pub fn update_conversation(&self, id: i64, keigo: &str, note: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE conversations SET keigo = ?2, note = ?3 WHERE id = ?1",
            params![id, keigo, note.trim()],
        )?;
        Ok(())
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
        let mut stmt = conn.prepare(&format!(
            "SELECT {CONVERSATION_COLUMNS} FROM conversations
             WHERE EXISTS (SELECT 1 FROM threads WHERE conversation_id = conversations.id)
             ORDER BY last_active DESC"
        ))?;
        stmt.query_map([], conversation_row)?.collect()
    }

    pub fn all_threads(&self) -> rusqlite::Result<Vec<ThreadInfo>> {
        self.recent_all(i64::MIN)
    }

    fn recent_all(&self, since_ms: i64) -> rusqlite::Result<Vec<ThreadInfo>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&format!(
            "SELECT {THREAD_COLUMNS} FROM threads WHERE last_active >= ?1 ORDER BY last_active DESC"
        ))?;
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

fn migrate(conn: &mut Connection) -> rusqlite::Result<()> {
    let version: usize = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(version) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", i + 1)?;
        tx.commit()?;
    }
    Ok(())
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
    let summary_messages: i64 = r.get(7)?;
    let message_count: i64 = r.get(8)?;
    let summary: String = r.get(6)?;
    Ok(ThreadInfo {
        id: r.get(0)?,
        conversation_id: r.get(1)?,
        title: r.get(2)?,
        pinned: r.get::<_, i64>(3)? != 0,
        last_active: r.get(4)?,
        archived: r.get::<_, i64>(5)? != 0,
        summary_stale: !summary.is_empty() && message_count > summary_messages,
        summary,
        message_count,
    })
}

fn conversation_row(r: &rusqlite::Row) -> rusqlite::Result<ConversationInfo> {
    Ok(ConversationInfo {
        id: r.get(0)?,
        app: r.get(1)?,
        name: r.get(2)?,
        workspace: r.get(3)?,
        last_active: r.get(4)?,
        keigo: r.get(5)?,
        note: r.get(6)?,
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
    fn pinning_is_exclusive_per_conversation_and_archiving_hides() {
        let h = History::in_memory();
        let conv = h.upsert_conversation("slack", "dev-qa", "").unwrap();
        let other = h.upsert_conversation("slack", "general", "").unwrap();
        let a = h.create_thread(conv, "A").unwrap();
        let b = h.create_thread(conv, "B").unwrap();
        let c = h.create_thread(other, "C").unwrap();
        h.set_pinned(a, true).unwrap();
        h.set_pinned(c, true).unwrap();
        h.set_pinned(b, true).unwrap();
        assert_eq!(h.pinned_thread(conv).unwrap().unwrap().id, b);
        assert_eq!(h.pinned_thread(other).unwrap().unwrap().id, c);
        assert!(!h.thread(a).unwrap().unwrap().pinned);

        h.set_archived(b, true).unwrap();
        assert!(h.pinned_thread(conv).unwrap().is_none());
        let recent: Vec<i64> = h.recent_threads(conv, 0, 8).unwrap().iter().map(|t| t.id).collect();
        assert_eq!(recent, [a]);
        h.set_pinned(b, true).unwrap();
        assert!(!h.thread(b).unwrap().unwrap().archived);
    }

    #[test]
    fn merging_moves_messages_and_removes_the_source() {
        let h = History::in_memory();
        let conv = h.upsert_conversation("teams", "Tanaka", "").unwrap();
        let from = h.create_thread(conv, "Trùng").unwrap();
        let into = h.create_thread(conv, "Chính").unwrap();
        h.add_message(from, &msg("ja_vi", "a", "b")).unwrap();
        h.add_message(into, &msg("ja_vi", "c", "d")).unwrap();
        h.add_message(from, &msg("vi_ja", "e", "f")).unwrap();
        h.set_pinned(from, true).unwrap();
        h.merge_threads(from, into).unwrap();
        assert!(h.thread(from).unwrap().is_none());
        let t = h.thread(into).unwrap().unwrap();
        assert_eq!(t.message_count, 3);
        assert!(t.pinned);
        let other = h.upsert_conversation("teams", "Suzuki", "").unwrap();
        let elsewhere = h.create_thread(other, "Khác").unwrap();
        assert!(h.merge_threads(into, elsewhere).is_err());
    }

    #[test]
    fn deleting_a_thread_removes_its_messages_only() {
        let h = History::in_memory();
        let conv = h.upsert_conversation("slack", "dev-qa", "").unwrap();
        let gone = h.create_thread(conv, "Xóa").unwrap();
        let kept = h.create_thread(conv, "Giữ").unwrap();
        h.add_message(gone, &msg("ja_vi", "a", "b")).unwrap();
        h.add_message(kept, &msg("ja_vi", "c", "d")).unwrap();
        h.record_correction(conv, Some(gone), kept).unwrap();
        h.delete_thread(gone).unwrap();
        assert!(h.thread(gone).unwrap().is_none());
        assert_eq!(h.thread(kept).unwrap().unwrap().message_count, 1);
        assert!(h.conversation(conv).unwrap().is_some());
        let left: i64 = h
            .conn
            .lock()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM messages", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 1);
    }

    #[test]
    fn deleting_a_conversation_removes_everything_in_it() {
        let h = History::in_memory();
        let gone = h.upsert_conversation("teams", "Spam", "").unwrap();
        let kept = h.upsert_conversation("teams", "Tanaka", "").unwrap();
        let t = h.create_thread(gone, "x").unwrap();
        h.add_message(t, &msg("ja_vi", "a", "b")).unwrap();
        let k = h.create_thread(kept, "y").unwrap();
        h.add_message(k, &msg("ja_vi", "c", "d")).unwrap();
        h.delete_conversation(gone).unwrap();
        assert!(h.conversation(gone).unwrap().is_none());
        assert!(h.thread(t).unwrap().is_none());
        assert_eq!(h.conversations().unwrap().len(), 1);
        assert_eq!(h.all_threads().unwrap().len(), 1);
    }

    #[test]
    fn summary_becomes_stale_with_new_messages() {
        let h = History::in_memory();
        let conv = h.upsert_conversation("slack", "dm", "").unwrap();
        let t = h.create_thread(conv, "x").unwrap();
        h.add_message(t, &msg("ja_vi", "a", "b")).unwrap();
        h.set_summary(t, " Khách hỏi lịch release. ").unwrap();
        let info = h.thread(t).unwrap().unwrap();
        assert_eq!(info.summary, "Khách hỏi lịch release.");
        assert!(!info.summary_stale);
        h.add_message(t, &msg("ja_vi", "c", "d")).unwrap();
        assert!(h.thread(t).unwrap().unwrap().summary_stale);
    }

    #[test]
    fn conversation_keeps_keigo_and_note() {
        let h = History::in_memory();
        let conv = h.upsert_conversation("teams", "Tanaka Taro", "").unwrap();
        h.update_conversation(conv, "formal", " PM phía khách ").unwrap();
        let c = h.conversation(conv).unwrap().unwrap();
        assert_eq!((c.keigo.as_str(), c.note.as_str()), ("formal", "PM phía khách"));
    }

    #[test]
    fn search_finds_titles_and_message_text_ignoring_case() {
        let h = History::in_memory();
        let conv = h.upsert_conversation("slack", "dev-qa", "").unwrap();
        let a = h.create_thread(conv, "Lỗi đăng nhập").unwrap();
        let b = h.create_thread(conv, "Lịch release").unwrap();
        h.add_message(b, &msg("ja_vi", "決済APIのタイムアウト", "Timeout 100% của API"))
            .unwrap();
        assert_eq!(h.search_threads("ĐĂNG nhập").unwrap(), [a]);
        assert_eq!(h.search_threads("タイムアウト").unwrap(), [b]);
        assert_eq!(h.search_threads("timeout").unwrap(), [b]);
        assert_eq!(h.search_threads("100%").unwrap(), [b]);
        assert!(h.search_threads("1_0%").unwrap().is_empty());
        assert!(h.search_threads("  ").unwrap().is_empty());
    }

    #[test]
    fn retention_deletes_old_messages_and_empty_threads() {
        let h = History::in_memory();
        let conv = h.upsert_conversation("slack", "dm", "").unwrap();
        let old = h.create_thread(conv, "Cũ").unwrap();
        let mixed = h.create_thread(conv, "Lẫn").unwrap();
        h.add_message(old, &msg("ja_vi", "a", "b")).unwrap();
        h.add_message(mixed, &msg("ja_vi", "c", "d")).unwrap();
        let cutoff = now_ms() + 1;
        h.add_message(mixed, &msg("ja_vi", "e", "f")).unwrap();
        {
            let conn = h.conn.lock().unwrap();
            conn.execute(
                "UPDATE messages SET created_at = created_at + 1000 WHERE source = 'e'",
                [],
            )
            .unwrap();
        }
        assert_eq!(h.delete_older_than(cutoff).unwrap(), 2);
        assert!(h.thread(old).unwrap().is_none());
        assert_eq!(h.messages(mixed).unwrap().len(), 1);
    }

    #[test]
    fn backup_restore_and_wipe() {
        let dir = std::env::temp_dir().join(format!("mytranslate-backup-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let backup = dir.join("backup.db");
        let h = History::in_memory();
        let conv = h.upsert_conversation("teams", "Tanaka", "").unwrap();
        let t = h.create_thread(conv, "Spec").unwrap();
        let m = h.add_message(t, &msg("ja_vi", "a", "b")).unwrap();
        h.set_feedback(m, true).unwrap();
        h.add_glossary_term("仕訳", "bút toán", "").unwrap();
        h.backup_to(&backup).unwrap();

        h.wipe().unwrap();
        assert!(h.all_threads().unwrap().is_empty());
        assert!(h.glossary().unwrap().is_empty());

        h.restore_from(&backup).unwrap();
        assert_eq!(h.all_threads().unwrap().len(), 1);
        assert_eq!(h.glossary().unwrap().len(), 1);

        let junk = dir.join("junk.db");
        std::fs::write(&junk, b"not a database at all, just text").unwrap();
        assert!(h.restore_from(&junk).is_err());
        let empty = dir.join("empty.db");
        Connection::open(&empty)
            .unwrap()
            .execute_batch("CREATE TABLE x (a)")
            .unwrap();
        assert!(h.restore_from(&empty).is_err());
        assert_eq!(h.all_threads().unwrap().len(), 1);
        let _ = std::fs::remove_dir_all(dir);
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
