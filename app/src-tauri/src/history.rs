//! Translation history on this PC (SQLite): conversations, threads and translated messages.
//! It feeds thread detection and the context sent with each translation, and the Threads screen.

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::lang::Lang;
use crate::prompt::Keigo;
use crate::review::{AdviceItem, Issue};

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
    r#"
    -- Who wrote the message: the user (1) or the other side (0). Until now every user was Vietnamese, so a
    -- Japanese source was a client's message; a Japanese user reverses that.
    ALTER TABLE messages ADD COLUMN mine INTEGER NOT NULL DEFAULT 1;
    UPDATE messages SET mine = 0 WHERE direction = 'ja_vi';
"#,
    r#"
    -- Conversations get their place in the chat app: Slack workspace > channel, Teams organisation > team >
    -- channel. Until now a Teams conversation was named after its team and its workspace was the organisation,
    -- with the channel lost; such rows keep their name as a chat of the organisation and are marked `legacy`, so
    -- the first channel of that team the user translates in takes them over.
    CREATE TABLE conversations_new (
        id          INTEGER PRIMARY KEY,
        app         TEXT NOT NULL,
        org         TEXT NOT NULL DEFAULT '',
        workspace   TEXT NOT NULL DEFAULT '',
        name        TEXT NOT NULL,
        last_active INTEGER NOT NULL,
        keigo       TEXT NOT NULL DEFAULT '',
        note        TEXT NOT NULL DEFAULT '',
        legacy      INTEGER NOT NULL DEFAULT 0,
        UNIQUE (app, org, workspace, name)
    );
    INSERT INTO conversations_new (id, app, org, workspace, name, last_active, keigo, note, legacy)
        SELECT id, app,
               CASE WHEN app = 'teams' THEN workspace ELSE '' END,
               CASE WHEN app = 'teams' THEN '' ELSE workspace END,
               name, last_active, keigo, note, app = 'teams'
        FROM conversations;
    DROP TABLE conversations;
    ALTER TABLE conversations_new RENAME TO conversations;
"#,
    r#"
    -- The Threads and Contacts screens are gone: threads are filed automatically, and the people the user
    -- writes to are glossary entries of kind 'person', whose note is a prompt about them. A pinned thread could
    -- no longer be unpinned, so none stays pinned.
    ALTER TABLE glossary_terms ADD COLUMN kind TEXT NOT NULL DEFAULT 'term';
    UPDATE threads SET pinned = 0;
    -- A conversation's note becomes a person named after the conversation, with its keigo, so it still reaches the
    -- AI when translating there. A keigo level alone was only the last one picked with Tab, not about anyone.
    INSERT OR IGNORE INTO glossary_terms (ja, vi, note, created_at, kind)
        SELECT name, name,
               trim(note) || CASE keigo WHEN '' THEN '' ELSE char(10) || 'Keigo: ' || keigo END,
               last_active, 'person'
        FROM conversations WHERE trim(note) != '';
    -- Tokens of each translation as the AI counted them: input (of it, read from the prompt cache) and output.
    ALTER TABLE messages ADD COLUMN input_tokens INTEGER;
    ALTER TABLE messages ADD COLUMN cached_tokens INTEGER;
    ALTER TABLE messages ADD COLUMN output_tokens INTEGER;
"#,
    r#"
    -- Reviews: how each check came out and every problem it found, so the Writing tab can show the user the
    -- mistakes they make most. They go with their message (history retention, wipe).
    ALTER TABLE messages ADD COLUMN verdict TEXT NOT NULL DEFAULT '';
    CREATE TABLE review_issues (
        id          INTEGER PRIMARY KEY,
        message_id  INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        lang        TEXT NOT NULL,
        kind        TEXT NOT NULL,
        wrong       TEXT NOT NULL DEFAULT '',
        fix         TEXT NOT NULL DEFAULT '',
        explanation TEXT NOT NULL DEFAULT '',
        created_at  INTEGER NOT NULL
    );
    CREATE INDEX review_issues_by_lang ON review_issues (lang, created_at);
    -- The AI's last advice on the user's mistakes in a language, kept until they ask again.
    CREATE TABLE writing_advice (
        lang       TEXT PRIMARY KEY,
        items      TEXT NOT NULL,
        created_at INTEGER NOT NULL
    );
"#,
];

/// Every table holding user data, children first (for wiping).
const DATA_TABLES: [&str; 7] = [
    "thread_corrections",
    "review_issues",
    "writing_advice",
    "messages",
    "threads",
    "conversations",
    "glossary_terms",
];

/// Columns of `ThreadInfo`, in `thread_row` order.
const THREAD_COLUMNS: &str = "id, title, last_active";

pub struct History {
    conn: Mutex<Connection>,
}

/// A thread: the messages of one topic in a conversation, filed automatically and used as translation context.
#[derive(Debug, Clone)]
pub struct ThreadInfo {
    pub id: i64,
    pub title: String,
    pub last_active: i64,
}

#[derive(Debug, Clone)]
pub struct MessageInfo {
    pub direction: String,
    pub source: String,
    pub result: String,
    /// Written by the user, not by the other side.
    pub mine: bool,
}

impl MessageInfo {
    /// The Japanese side of the exchange.
    pub fn japanese(&self) -> &str {
        match self.direction.as_str() {
            "ja_vi" => &self.source,
            _ => &self.result,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ConversationInfo {
    /// The channel or chat: a direct message is named after the person.
    pub name: String,
    /// The keigo level the user last picked here; `None` until they pick one.
    pub keigo: Option<Keigo>,
}

pub struct NewMessage<'a> {
    pub direction: &'a str,
    /// Written by the user (translated to send, or checked), not received.
    pub mine: bool,
    pub source: &'a str,
    pub result: &'a str,
    pub back: &'a str,
    pub model: &'a str,
    pub prompt_version: u32,
    pub first_token_ms: Option<u64>,
    pub total_ms: u64,
    pub tokens: Tokens,
}

/// What a translation cost, as the AI reported it; `None` when it did not say.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tokens {
    pub input: Option<u64>,
    /// The part of `input` read from the prompt cache.
    pub cached: Option<u64>,
    pub output: Option<u64>,
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
    pub fn restore_from(&self, path: &Path, lang: Lang) -> Result<(), String> {
        let not_backup = || {
            lang.pick(
                "File không phải bản sao lưu của MyTranslate",
                "MyTranslate のバックアップファイルではありません",
            )
            .to_string()
        };
        let source = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| format!("{}: {e}", lang.pick("Không mở được file", "ファイルを開けません")))?;
        let version: usize = source
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .map_err(|_| not_backup())?;
        let has_tables: i64 = source
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('conversations', 'threads', 'messages')",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if version == 0 || has_tables != 3 {
            return Err(not_backup());
        }
        if version > MIGRATIONS.len() {
            return Err(lang
                .pick(
                    "Bản sao lưu được tạo bằng phiên bản app mới hơn; hãy cập nhật app trước",
                    "このバックアップは新しいバージョンのアプリで作成されています。先にアプリを更新してください",
                )
                .into());
        }
        drop(source);
        let mut conn = self.conn.lock().unwrap();
        conn.restore(rusqlite::MAIN_DB, path, None::<fn(rusqlite::backup::Progress)>)
            .map_err(|e| format!("{}: {e}", lang.pick("Không khôi phục được", "復元できません")))?;
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

    /// The conversation at this place, created on first use. A Teams channel takes over the conversation an
    /// older version filed its team's messages under (see the migration), keeping its threads.
    pub fn upsert_conversation(&self, app: &str, org: &str, workspace: &str, name: &str) -> rusqlite::Result<i64> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let now = now_ms();
        let existing: Option<i64> = tx
            .query_row(
                "SELECT id FROM conversations WHERE app = ?1 AND org = ?2 AND workspace = ?3 AND name = ?4",
                params![app, org, workspace, name],
                |r| r.get(0),
            )
            .optional()?;
        let id = match existing {
            // Seen as itself, so a legacy row really is this chat.
            Some(id) => {
                tx.execute(
                    "UPDATE conversations SET last_active = ?2, legacy = 0 WHERE id = ?1",
                    params![id, now],
                )?;
                id
            }
            None => {
                let legacy: Option<i64> = if app == "teams" && !workspace.is_empty() {
                    tx.query_row(
                        "SELECT id FROM conversations
                         WHERE app = 'teams' AND org = ?1 AND workspace = '' AND name = ?2 AND legacy = 1",
                        params![org, workspace],
                        |r| r.get(0),
                    )
                    .optional()?
                } else {
                    None
                };
                match legacy {
                    Some(id) => {
                        tx.execute(
                            "UPDATE conversations SET workspace = ?2, name = ?3, last_active = ?4, legacy = 0 WHERE id = ?1",
                            params![id, workspace, name, now],
                        )?;
                        id
                    }
                    None => tx.query_row(
                        "INSERT INTO conversations (app, org, workspace, name, last_active) VALUES (?1, ?2, ?3, ?4, ?5)
                         RETURNING id",
                        params![app, org, workspace, name, now],
                        |r| r.get(0),
                    )?,
                }
            }
        };
        tx.commit()?;
        Ok(id)
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

    pub fn conversation(&self, id: i64) -> rusqlite::Result<Option<ConversationInfo>> {
        let conn = self.conn.lock().unwrap();
        conn.query_row("SELECT name, keigo FROM conversations WHERE id = ?1", [id], |r| {
            Ok(ConversationInfo {
                name: r.get(0)?,
                keigo: Keigo::from_name(&r.get::<_, String>(1)?),
            })
        })
        .optional()
    }

    /// Remembers the keigo level picked in a conversation, for its next translations.
    pub fn set_conversation_keigo(&self, id: i64, keigo: Keigo) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE conversations SET keigo = ?2 WHERE id = ?1",
            params![id, keigo.name()],
        )?;
        Ok(())
    }

    /// The last `limit` messages of a thread, oldest first.
    pub fn recent_messages(&self, thread_id: i64, limit: usize) -> rusqlite::Result<Vec<MessageInfo>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT direction, source, result, mine FROM
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

    pub fn add_message(&self, thread_id: i64, m: &NewMessage) -> rusqlite::Result<i64> {
        let conn = self.conn.lock().unwrap();
        let now = now_ms();
        conn.execute(
            "INSERT INTO messages (thread_id, direction, source, result, back, model, prompt_version,
                                   first_token_ms, total_ms, created_at, mine, input_tokens, cached_tokens, output_tokens)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
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
                now,
                m.mine,
                m.tokens.input.map(|v| v as i64),
                m.tokens.cached.map(|v| v as i64),
                m.tokens.output.map(|v| v as i64)
            ],
        )?;
        let id = conn.last_insert_rowid();
        conn.execute(
            "UPDATE threads SET last_active = ?2 WHERE id = ?1",
            params![thread_id, now],
        )?;
        Ok(id)
    }

    /// Stores how a review came out and what it found.
    pub fn set_review(&self, message_id: i64, lang: Lang, verdict: &str, issues: &[Issue]) -> rusqlite::Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        tx.execute(
            "UPDATE messages SET verdict = ?2 WHERE id = ?1",
            params![message_id, verdict],
        )?;
        let now = now_ms();
        for i in issues {
            tx.execute(
                "INSERT INTO review_issues (message_id, lang, kind, wrong, fix, explanation, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![message_id, lang.code(), i.kind, i.wrong, i.fix, i.explanation, now],
            )?;
        }
        tx.commit()
    }

    /// The user's writing in each language since `since_ms`: how often a review found nothing to fix, the kinds of
    /// mistakes, the ones made again and again, and the latest.
    pub fn writing_stats(&self, since_ms: i64) -> rusqlite::Result<Vec<WritingStats>> {
        let conn = self.conn.lock().unwrap();
        [Lang::Ja, Lang::Vi]
            .into_iter()
            .map(|lang| {
                let direction = match lang {
                    Lang::Ja => "review_ja",
                    Lang::Vi => "review_vi",
                };
                // Checks from before reviews were recorded have no verdict: they would only lower the share.
                let (reviews, clean): (i64, i64) = conn.query_row(
                    "SELECT COUNT(*), COALESCE(SUM(verdict = 'ok'), 0) FROM messages
                     WHERE direction = ?1 AND created_at >= ?2 AND verdict != ''",
                    params![direction, since_ms],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )?;
                let lang = lang.code();
                let kinds = conn
                    .prepare(
                        "SELECT kind, COUNT(*) AS n FROM review_issues WHERE lang = ?1 AND created_at >= ?2
                         GROUP BY kind ORDER BY n DESC, kind",
                    )?
                    .query_map(params![lang, since_ms], |r| {
                        Ok(KindCount {
                            kind: r.get(0)?,
                            count: r.get(1)?,
                        })
                    })?
                    .collect::<rusqlite::Result<_>>()?;
                // The same words written wrong more than once; the latest fix shows how to write them.
                let repeated = conn
                    .prepare(
                        "SELECT kind, wrong, fix, n FROM (
                            SELECT kind, wrong, fix, COUNT(*) OVER (PARTITION BY lower(wrong)) AS n,
                                   ROW_NUMBER() OVER (PARTITION BY lower(wrong) ORDER BY created_at DESC, id DESC) AS latest
                            FROM review_issues WHERE lang = ?1 AND created_at >= ?2 AND wrong != '')
                         WHERE latest = 1 AND n > 1 ORDER BY n DESC, wrong LIMIT 10",
                    )?
                    .query_map(params![lang, since_ms], |r| {
                        Ok(Repeated {
                            kind: r.get(0)?,
                            wrong: r.get(1)?,
                            fix: r.get(2)?,
                            count: r.get(3)?,
                        })
                    })?
                    .collect::<rusqlite::Result<_>>()?;
                let recent = conn
                    .prepare(
                        "SELECT kind, wrong, fix, explanation, created_at FROM review_issues
                         WHERE lang = ?1 AND created_at >= ?2 ORDER BY created_at DESC, id DESC LIMIT 20",
                    )?
                    .query_map(params![lang, since_ms], |r| {
                        Ok(RecentIssue {
                            kind: r.get(0)?,
                            wrong: r.get(1)?,
                            fix: r.get(2)?,
                            explanation: r.get(3)?,
                            created_at: r.get(4)?,
                        })
                    })?
                    .collect::<rusqlite::Result<_>>()?;
                Ok(WritingStats {
                    lang: lang.to_string(),
                    reviews,
                    clean,
                    kinds,
                    repeated,
                    recent,
                })
            })
            .collect()
    }

    /// The latest mistakes in a language, newest first, for the AI to find the habits behind them.
    pub fn writing_issues(&self, lang: Lang, limit: usize) -> rusqlite::Result<Vec<Issue>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT kind, wrong, fix, explanation FROM review_issues WHERE lang = ?1
             ORDER BY created_at DESC, id DESC LIMIT ?2",
        )?;
        stmt.query_map(params![lang.code(), limit as i64], |r| {
            Ok(Issue {
                kind: r.get(0)?,
                wrong: r.get(1)?,
                fix: r.get(2)?,
                explanation: r.get(3)?,
            })
        })?
        .collect()
    }

    /// The stored advice for a language; stale once a review found something new after it was made.
    pub fn advice(&self, lang: Lang) -> rusqlite::Result<Option<Advice>> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT items, created_at,
                    EXISTS (SELECT 1 FROM review_issues i WHERE i.lang = a.lang AND i.created_at > a.created_at)
             FROM writing_advice a WHERE lang = ?1",
            [lang.code()],
            |r| {
                let items: String = r.get(0)?;
                Ok(Advice {
                    items: serde_json::from_str(&items).unwrap_or_default(),
                    created_at: r.get(1)?,
                    stale: r.get(2)?,
                })
            },
        )
        .optional()
    }

    pub fn set_advice(&self, lang: Lang, items: &[AdviceItem]) -> rusqlite::Result<Advice> {
        let conn = self.conn.lock().unwrap();
        let now = now_ms();
        conn.execute(
            "INSERT INTO writing_advice (lang, items, created_at) VALUES (?1, ?2, ?3)
             ON CONFLICT (lang) DO UPDATE SET items = excluded.items, created_at = excluded.created_at",
            params![lang.code(), serde_json::to_string(items).unwrap_or_default(), now],
        )?;
        Ok(Advice {
            items: items.to_vec(),
            created_at: now,
            stale: false,
        })
    }

    pub fn glossary(&self) -> rusqlite::Result<Vec<GlossaryTerm>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt =
            conn.prepare("SELECT id, ja, vi, note, kind FROM glossary_terms ORDER BY created_at DESC, id DESC")?;
        stmt.query_map([], |r| {
            Ok(GlossaryTerm {
                id: r.get(0)?,
                ja: r.get(1)?,
                vi: r.get(2)?,
                note: r.get(3)?,
                kind: TermKind::parse(&r.get::<_, String>(4)?),
            })
        })?
        .collect()
    }

    /// Adds a term or a person, or updates the note and kind of an identical pair.
    pub fn add_glossary_term(&self, ja: &str, vi: &str, note: &str, kind: TermKind) -> rusqlite::Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "INSERT INTO glossary_terms (ja, vi, note, created_at, kind) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT (ja, vi) DO UPDATE SET note = excluded.note, kind = excluded.kind
             RETURNING id",
            params![ja.trim(), vi.trim(), note.trim(), now_ms(), kind.as_str()],
            |r| r.get(0),
        )
    }

    /// Edits a term or person in place; its kind stays.
    pub fn update_glossary_term(&self, id: i64, ja: &str, vi: &str, note: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE glossary_terms SET ja = ?2, vi = ?3, note = ?4 WHERE id = ?1",
            params![id, ja.trim(), vi.trim(), note.trim()],
        )?;
        Ok(())
    }

    pub fn delete_glossary_term(&self, id: i64) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM glossary_terms WHERE id = ?1", [id])?;
        Ok(())
    }

    /// Organisation, workspace and name of a conversation.
    #[cfg(test)]
    fn place(&self, id: i64) -> (String, String, String) {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT org, workspace, name FROM conversations WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap()
    }

    #[cfg(test)]
    fn thread_count(&self) -> i64 {
        let conn = self.conn.lock().unwrap();
        conn.query_row("SELECT COUNT(*) FROM threads", [], |r| r.get(0))
            .unwrap()
    }
}

fn migrate(conn: &mut Connection) -> rusqlite::Result<()> {
    let version: usize = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if version >= MIGRATIONS.len() {
        return Ok(());
    }
    // A migration may rebuild a table others refer to; with foreign keys on, dropping the old one would delete
    // every row that refers to it. They are checked once all migrations ran.
    conn.pragma_update(None, "foreign_keys", "OFF")?;
    let result = (|| {
        for (i, sql) in MIGRATIONS.iter().enumerate().skip(version) {
            let tx = conn.transaction()?;
            tx.execute_batch(sql)?;
            tx.pragma_update(None, "user_version", i + 1)?;
            tx.commit()?;
        }
        let broken: i64 = conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r.get(0))?;
        if broken > 0 {
            log::warn!("history: {broken} rows refer to missing rows after migrating");
        }
        Ok(())
    })();
    conn.pragma_update(None, "foreign_keys", "ON")?;
    result
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlossaryTerm {
    pub id: i64,
    pub ja: String,
    pub vi: String,
    /// For a term, a note for the user; for a person, a prompt about them (role, how to address them, keigo).
    pub note: String,
    pub kind: TermKind,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingStats {
    /// The language written: `ja` or `vi`.
    pub lang: String,
    pub reviews: i64,
    /// Reviews that found nothing to fix.
    pub clean: i64,
    pub kinds: Vec<KindCount>,
    pub repeated: Vec<Repeated>,
    pub recent: Vec<RecentIssue>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KindCount {
    pub kind: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Repeated {
    pub kind: String,
    pub wrong: String,
    pub fix: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentIssue {
    pub kind: String,
    pub wrong: String,
    pub fix: String,
    pub explanation: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Advice {
    pub items: Vec<AdviceItem>,
    pub created_at: i64,
    pub stale: bool,
}

/// A word to translate the same way every time, or a person the user writes to or about.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TermKind {
    #[default]
    Term,
    Person,
}

impl TermKind {
    fn parse(s: &str) -> Self {
        if s == "person" { Self::Person } else { Self::Term }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Term => "term",
            Self::Person => "person",
        }
    }
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
        title: r.get(1)?,
        last_active: r.get(2)?,
    })
}

fn message_row(r: &rusqlite::Row) -> rusqlite::Result<MessageInfo> {
    Ok(MessageInfo {
        direction: r.get(0)?,
        source: r.get(1)?,
        result: r.get(2)?,
        mine: r.get(3)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg<'a>(direction: &'a str, source: &'a str, result: &'a str) -> NewMessage<'a> {
        NewMessage {
            direction,
            mine: direction != "ja_vi",
            source,
            result,
            back: "",
            model: "sonnet",
            prompt_version: 4,
            first_token_ms: Some(900),
            total_ms: 2500,
            tokens: Tokens::default(),
        }
    }

    #[test]
    fn conversation_is_reused_by_app_name_and_workspace() {
        let h = History::in_memory();
        let a = h.upsert_conversation("slack", "", "CustomerX", "dev-qa").unwrap();
        let b = h.upsert_conversation("slack", "", "CustomerX", "dev-qa").unwrap();
        let c = h.upsert_conversation("teams", "", "CustomerX", "dev-qa").unwrap();
        assert_eq!(a, b);
        assert_ne!(a, c);
    }

    #[test]
    fn a_conversation_keeps_the_keigo_level_picked_in_it() {
        let h = History::in_memory();
        let a = h.upsert_conversation("slack", "", "CustomerX", "dev-qa").unwrap();
        let b = h.upsert_conversation("slack", "", "CustomerX", "general").unwrap();
        assert_eq!(h.conversation(a).unwrap().unwrap().keigo, None);
        h.set_conversation_keigo(a, Keigo::Casual).unwrap();
        h.set_conversation_keigo(a, Keigo::Polite).unwrap();
        // Seen again: still the level picked last.
        assert_eq!(h.upsert_conversation("slack", "", "CustomerX", "dev-qa").unwrap(), a);
        assert_eq!(h.conversation(a).unwrap().unwrap().keigo, Some(Keigo::Polite));
        assert_eq!(h.conversation(b).unwrap().unwrap().keigo, None);
    }

    #[test]
    fn teams_conversations_are_told_apart_by_organisation_and_team() {
        let h = History::in_memory();
        let a = h
            .upsert_conversation("teams", "acme.example", "ALPHA", "General")
            .unwrap();
        let b = h
            .upsert_conversation("teams", "ACMECLIENT", "ALPHA", "General")
            .unwrap();
        let c = h
            .upsert_conversation("teams", "acme.example", "BOOK", "General")
            .unwrap();
        assert_eq!(
            a,
            h.upsert_conversation("teams", "acme.example", "ALPHA", "General")
                .unwrap()
        );
        assert_ne!(a, b);
        assert_ne!(a, c);
        assert_eq!(h.place(a), ("acme.example".into(), "ALPHA".into(), "General".into()));
    }

    /// The history of an older version: Teams conversations named after the team, the channel lost.
    fn history_before_places(path: &Path) {
        let conn = Connection::open(path).unwrap();
        let tx = conn.unchecked_transaction().unwrap();
        for sql in &MIGRATIONS[..5] {
            tx.execute_batch(sql).unwrap();
        }
        tx.pragma_update(None, "user_version", 5).unwrap();
        tx.execute_batch(
            "INSERT INTO conversations (id, app, name, workspace, last_active, keigo, note)
                VALUES (1, 'teams', 'ALPHA', 'acme.example', 1, 'formal', 'Anh Sato là PM'),
                       (2, 'slack', 'dev-qa', 'CustomerX', 1, 'polite', ''),
                       (3, 'teams', 'Tanaka', 'ACMECLIENT', 1, '', '');
             INSERT INTO threads (id, conversation_id, title, created_at, last_active)
                VALUES (1, 1, 'Phát hành', 1, 1), (2, 2, 'Lỗi đăng nhập', 1, 1), (3, 3, 'Họp', 1, 1);",
        )
        .unwrap();
        tx.commit().unwrap();
    }

    #[test]
    fn older_history_keeps_every_thread_and_a_team_channel_takes_over_its_team() {
        let path = std::env::temp_dir().join(format!("mytranslate-places-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        history_before_places(&path);
        let h = History::open(&path).unwrap();
        assert_eq!(h.thread_count(), 3);
        assert_eq!(h.place(2), ("".into(), "CustomerX".into(), "dev-qa".into()));

        // The team's note and keigo became a person named after it, in the glossary.
        let people = h.glossary().unwrap();
        assert_eq!(people.len(), 1);
        assert_eq!(
            (people[0].ja.as_str(), people[0].note.as_str(), people[0].kind),
            ("ALPHA", "Anh Sato là PM\nKeigo: formal", TermKind::Person)
        );

        // The team's first channel gets the old conversation, with its threads.
        let channel = h
            .upsert_conversation("teams", "acme.example", "ALPHA", "General")
            .unwrap();
        assert_eq!(channel, 1);
        assert_eq!(h.place(1), ("acme.example".into(), "ALPHA".into(), "General".into()));
        assert_eq!(h.conversation(1).unwrap().unwrap().name, "General");
        // Its other channels are new conversations.
        assert_ne!(
            h.upsert_conversation("teams", "acme.example", "ALPHA", "Random")
                .unwrap(),
            1
        );
        // An old chat seen again stays itself, and no team can take it over afterwards.
        assert_eq!(h.upsert_conversation("teams", "ACMECLIENT", "", "Tanaka").unwrap(), 3);
        assert_ne!(
            h.upsert_conversation("teams", "ACMECLIENT", "Tanaka", "General")
                .unwrap(),
            3
        );
        drop(h);
        for ext in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{ext}", path.display()));
        }
    }

    #[test]
    fn stores_messages_and_returns_the_latest_in_order() {
        let h = History::in_memory();
        let conv = h.upsert_conversation("slack", "", "", "dev-qa").unwrap();
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
        let conv = h.upsert_conversation("slack", "", "", "dm").unwrap();
        let t = h.create_thread(conv, "x").unwrap();
        h.add_message(t, &msg("ja_vi", "確認しました", "Đã xác nhận")).unwrap();
        h.add_message(t, &msg("vi_ja", "Cảm ơn", "ありがとうございます"))
            .unwrap();
        // A Japanese user: their own Japanese sent as Vietnamese.
        h.add_message(
            t,
            &NewMessage {
                mine: true,
                ..msg("ja_vi", "了解です", "Đã rõ")
            },
        )
        .unwrap();
        let m = h.recent_messages(t, 6).unwrap();
        assert_eq!((m[0].mine, m[0].japanese()), (false, "確認しました"));
        assert_eq!((m[1].mine, m[1].japanese()), (true, "ありがとうございます"));
        assert_eq!((m[2].mine, m[2].japanese()), (true, "了解です"));
    }

    #[test]
    fn existing_messages_get_their_author_from_the_direction() {
        let conn = Connection::open_in_memory().unwrap();
        // The schema before `mine`, with one message each way.
        for sql in &MIGRATIONS[..4] {
            conn.execute_batch(sql).unwrap();
        }
        conn.pragma_update(None, "user_version", 4).unwrap();
        conn.execute_batch(
            "INSERT INTO conversations (id, app, name, last_active) VALUES (1, 'slack', 'dm', 0);
             INSERT INTO threads (id, conversation_id, title, created_at, last_active) VALUES (1, 1, 't', 0, 0);
             INSERT INTO messages (thread_id, direction, source, result, created_at) VALUES
               (1, 'ja_vi', '確認しました', 'Đã xác nhận', 1),
               (1, 'vi_ja', 'Cảm ơn', 'ありがとうございます', 2);",
        )
        .unwrap();
        let h = History::init(conn).unwrap();
        let m = h.recent_messages(1, 6).unwrap();
        assert_eq!(m.iter().map(|m| m.mine).collect::<Vec<_>>(), [false, true]);
    }

    #[test]
    fn glossary_upserts_and_matches_either_language() {
        let h = History::in_memory();
        let id = h.add_glossary_term("仕訳", "bút toán", "", TermKind::Term).unwrap();
        assert_eq!(
            h.add_glossary_term(" 仕訳 ", "bút toán", "kế toán", TermKind::Term)
                .unwrap(),
            id
        );
        let terms = h.glossary().unwrap();
        assert_eq!(terms.len(), 1);
        assert_eq!((terms[0].note.as_str(), terms[0].kind), ("kế toán", TermKind::Term));
        let t = &terms[0];
        assert!(t.appears_in("仕訳の入力画面", "仕訳の入力画面"));
        let vi = "Kiểm tra lại Bút Toán giúp em";
        assert!(t.appears_in(vi, &vi.to_lowercase()));
        assert!(!t.appears_in("請求書", "請求書"));
        h.delete_glossary_term(id).unwrap();
        assert!(h.glossary().unwrap().is_empty());
    }

    #[test]
    fn people_are_glossary_entries_that_can_be_edited() {
        let h = History::in_memory();
        let id = h
            .add_glossary_term("田中", "Tanaka", "PM phía khách", TermKind::Person)
            .unwrap();
        h.update_glossary_term(id, "田中", "anh Tanaka", " PM phía khách, gọi là 田中様 ")
            .unwrap();
        let p = &h.glossary().unwrap()[0];
        assert_eq!(
            (p.vi.as_str(), p.note.as_str(), p.kind),
            ("anh Tanaka", "PM phía khách, gọi là 田中様", TermKind::Person)
        );
    }

    #[test]
    fn a_message_keeps_what_it_cost() {
        let h = History::in_memory();
        let conv = h.upsert_conversation("slack", "", "", "dm").unwrap();
        let t = h.create_thread(conv, "x").unwrap();
        let tokens = Tokens {
            input: Some(1450),
            cached: Some(1024),
            output: Some(80),
        };
        let id = h
            .add_message(
                t,
                &NewMessage {
                    tokens,
                    ..msg("ja_vi", "a", "b")
                },
            )
            .unwrap();
        let stored: (i64, i64, i64) = h
            .conn
            .lock()
            .unwrap()
            .query_row(
                "SELECT input_tokens, cached_tokens, output_tokens FROM messages WHERE id = ?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(stored, (1450, 1024, 80));
    }

    fn review(h: &History, t: i64, lang: Lang, verdict: &str, issues: &[(&str, &str, &str)]) {
        let direction = match lang {
            Lang::Ja => "review_ja",
            Lang::Vi => "review_vi",
        };
        let id = h.add_message(t, &msg(direction, "x", "y")).unwrap();
        let issues: Vec<Issue> = issues
            .iter()
            .map(|(kind, wrong, fix)| Issue {
                kind: kind.to_string(),
                wrong: wrong.to_string(),
                fix: fix.to_string(),
                explanation: String::new(),
            })
            .collect();
        h.set_review(id, lang, verdict, &issues).unwrap();
    }

    #[test]
    fn writing_stats_count_reviews_kinds_and_repeated_mistakes() {
        let h = History::in_memory();
        let conv = h.upsert_conversation("teams", "", "", "Tanaka").unwrap();
        let t = h.create_thread(conv, "x").unwrap();
        review(&h, t, Lang::Vi, "ok", &[]);
        review(
            &h,
            t,
            Lang::Vi,
            "suggest",
            &[("spelling", "ko", "không"), ("politeness", "bạn", "anh")],
        );
        review(&h, t, Lang::Vi, "suggest", &[("spelling", "Ko", "không")]);
        review(
            &h,
            t,
            Lang::Ja,
            "error",
            &[("politeness", "見てください", "ご確認ください")],
        );

        let stats = h.writing_stats(0).unwrap();
        let (ja, vi) = (&stats[0], &stats[1]);
        assert_eq!((ja.lang.as_str(), ja.reviews, ja.clean), ("ja", 1, 0));
        assert_eq!((vi.lang.as_str(), vi.reviews, vi.clean), ("vi", 3, 1));
        assert_eq!(
            vi.kinds.iter().map(|k| (k.kind.as_str(), k.count)).collect::<Vec<_>>(),
            [("spelling", 2), ("politeness", 1)]
        );
        // "ko" twice, whatever the case; the latest spelling is shown.
        assert_eq!(vi.repeated.len(), 1);
        assert_eq!((vi.repeated[0].wrong.as_str(), vi.repeated[0].count), ("Ko", 2));
        assert_eq!(vi.recent.len(), 3);
        assert_eq!(h.writing_issues(Lang::Ja, 10).unwrap()[0].fix, "ご確認ください");
        // A later period sees none of it.
        assert_eq!(h.writing_stats(now_ms() + 1000).unwrap()[1].reviews, 0);
    }

    #[test]
    fn advice_goes_stale_with_new_mistakes() {
        let h = History::in_memory();
        assert!(h.advice(Lang::Vi).unwrap().is_none());
        let item = AdviceItem {
            title: "Viết đủ".into(),
            advice: "Không viết tắt.".into(),
            example: "không".into(),
        };
        h.set_advice(Lang::Vi, std::slice::from_ref(&item)).unwrap();
        let a = h.advice(Lang::Vi).unwrap().unwrap();
        assert_eq!((a.items, a.stale), (vec![item], false));
        let conv = h.upsert_conversation("teams", "", "", "Tanaka").unwrap();
        let t = h.create_thread(conv, "x").unwrap();
        review(&h, t, Lang::Vi, "suggest", &[("spelling", "ko", "không")]);
        h.conn
            .lock()
            .unwrap()
            .execute("UPDATE review_issues SET created_at = created_at + 1000", [])
            .unwrap();
        assert!(h.advice(Lang::Vi).unwrap().unwrap().stale);
        assert!(!h.advice(Lang::Ja).unwrap().is_some_and(|a| a.stale));
    }

    #[test]
    fn retention_deletes_old_messages_and_empty_threads() {
        let h = History::in_memory();
        let conv = h.upsert_conversation("slack", "", "", "dm").unwrap();
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
        assert_eq!(h.recent_messages(mixed, 10).unwrap().len(), 1);
    }

    #[test]
    fn backup_restore_and_wipe() {
        let dir = std::env::temp_dir().join(format!("mytranslate-backup-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let backup = dir.join("backup.db");
        let h = History::in_memory();
        let conv = h.upsert_conversation("teams", "", "", "Tanaka").unwrap();
        let t = h.create_thread(conv, "Spec").unwrap();
        h.add_message(t, &msg("ja_vi", "a", "b")).unwrap();
        h.add_glossary_term("仕訳", "bút toán", "", TermKind::Term).unwrap();
        h.backup_to(&backup).unwrap();

        h.wipe().unwrap();
        assert_eq!(h.thread_count(), 0);
        assert!(h.glossary().unwrap().is_empty());

        h.restore_from(&backup, Lang::Vi).unwrap();
        assert_eq!(h.thread_count(), 1);
        assert_eq!(h.glossary().unwrap().len(), 1);

        let junk = dir.join("junk.db");
        std::fs::write(&junk, b"not a database at all, just text").unwrap();
        assert!(h.restore_from(&junk, Lang::Vi).is_err());
        let empty = dir.join("empty.db");
        Connection::open(&empty)
            .unwrap()
            .execute_batch("CREATE TABLE x (a)")
            .unwrap();
        assert_eq!(
            h.restore_from(&empty, Lang::Ja).unwrap_err(),
            "MyTranslate のバックアップファイルではありません"
        );
        assert_eq!(h.thread_count(), 1);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn reopening_keeps_data_and_schema() {
        let path = std::env::temp_dir().join(format!("mytranslate-history-{}.db", std::process::id()));
        {
            let h = History::open(&path).unwrap();
            let conv = h.upsert_conversation("slack", "", "", "general").unwrap();
            h.create_thread(conv, "Họp").unwrap();
        }
        let h = History::open(&path).unwrap();
        assert_eq!(h.thread_count(), 1);
        drop(h);
        for ext in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{ext}", path.display()));
        }
    }
}
