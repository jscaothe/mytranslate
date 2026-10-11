mod ai;
mod capture;
mod chat_apps;
mod context;
mod credentials;
mod export;
mod history;
mod hotkeys;
pub mod lang;
mod placement;
mod popup;
pub mod prompt;
pub mod provider;
mod quickbar;
mod selection_watch;
mod settings;
mod team_glossary;
mod threads;
mod tray;
mod ui_selection;
mod updates;

use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::Value;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::ShortcutState;

use history::{History, NewMessage};
use hotkeys::{HotkeyAction, HotkeyState};
use lang::Lang;
use prompt::{Direction, Keigo, ThreadMessage, TranslateRequest};
use provider::Router;
use provider::claude_cli::{ClaudeCli, Timing, TranslateEvent};
use provider::stream_parser::Sections;
use settings::SettingsStore;
use team_glossary::TeamGlossaryCache;

/// Default model; SP1 showed Sonnet with low effort thinks far less often than Haiku.
const DEFAULT_MODEL: &str = "sonnet";
/// Passed by the Windows autostart entry: start in the tray without showing the main window.
const BACKGROUND_ARG: &str = "--background";
/// Earlier messages of the thread sent as context with each translation.
const CONTEXT_MESSAGES: usize = 6;
/// Messages a summary covers: the latest ones, enough for a long topic.
const SUMMARY_MESSAGES: usize = 40;
/// How often old messages are cleaned up while the app runs (it usually runs for days, in the tray).
const RETENTION_INTERVAL: std::time::Duration = std::time::Duration::from_secs(6 * 60 * 60);
const DAY_MS: i64 = 24 * 60 * 60 * 1000;

/// Deletes messages older than the "keep history for" setting (0 or missing keeps everything).
fn apply_retention(app: &AppHandle) {
    let months = app
        .state::<SettingsStore>()
        .get()
        .get("retentionMonths")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    if months <= 0 {
        return;
    }
    let before = history::now_ms() - months * 30 * DAY_MS;
    match app.state::<History>().delete_older_than(before) {
        Ok(0) => {}
        Ok(n) => {
            log::info!("deleted {n} messages older than {months} months");
            let _ = app.emit("history:changed", ());
        }
        Err(e) => log::warn!("could not delete old messages: {e}"),
    }
}

/// The thread's title and its last `limit` messages, Japanese side only, as prompt context.
fn thread_context(history: &History, thread_id: i64, limit: usize) -> Option<(String, Vec<ThreadMessage>)> {
    let thread = history.thread(thread_id).ok().flatten()?;
    let messages = history
        .recent_messages(thread.id, limit)
        .unwrap_or_default()
        .iter()
        .map(|m| ThreadMessage {
            from_client: !m.mine,
            text: m.japanese().to_string(),
        })
        .collect();
    Some((thread.title, messages))
}

/// Glossary terms that occur in `text`: personal ones, then the team's for Japanese not already covered.
fn glossary_for(app: &AppHandle, text: &str) -> Vec<(String, String)> {
    let lower = text.to_lowercase();
    let mut terms: Vec<(String, String)> = app
        .state::<History>()
        .glossary()
        .unwrap_or_default()
        .into_iter()
        .filter(|t| t.appears_in(text, &lower))
        .map(|t| (t.ja, t.vi))
        .collect();
    let path = app
        .state::<SettingsStore>()
        .get()
        .get("glossaryPath")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    for t in app.state::<TeamGlossaryCache>().get(&path).terms {
        let term = history::GlossaryTerm {
            id: 0,
            ja: t.ja,
            vi: t.vi,
            note: t.note,
        };
        if term.appears_in(text, &lower) && !terms.iter().any(|(ja, _)| *ja == term.ja) {
            terms.push((term.ja, term.vi));
        }
    }
    terms
}

fn conversation_note(app: &AppHandle, conversation_id: Option<i64>) -> String {
    conversation_id
        .and_then(|id| app.state::<History>().conversation(id).ok().flatten())
        .map(|c| c.note)
        .unwrap_or_default()
}

/// Runs a request to the end and returns its sections (for tasks that are not streamed to a page).
async fn complete(app: &AppHandle, router: &Arc<Router>, request: TranslateRequest) -> Result<Sections, String> {
    let result: Arc<Mutex<Option<Result<Sections, String>>>> = Arc::default();
    let out = result.clone();
    let routes = ai::routes(app);
    router
        .translate(router.next_request_id(), request, &routes, move |event| match event {
            TranslateEvent::Done { sections, .. } => *out.lock().unwrap() = Some(Ok(sections)),
            TranslateEvent::Error { message, .. } => *out.lock().unwrap() = Some(Err(message)),
            _ => {}
        })
        .await;
    let r = result.lock().unwrap().take();
    r.unwrap_or_else(|| Err(language(app).pick("AI không trả lời", "AIから応答がありません").into()))
}

fn language(app: &AppHandle) -> Lang {
    app.state::<SettingsStore>().language()
}

/// Title of a thread the user did not name.
fn new_thread_title(lang: Lang) -> String {
    lang.pick("Thread mới", "新しいスレッド").to_string()
}

/// Translates with the thread's recent messages as context, then files the result in the history.
#[tauri::command]
async fn translate(
    app: AppHandle,
    router: State<'_, Arc<Router>>,
    request_id: u64,
    mut request: TranslateRequest,
    on_event: Channel<TranslateEvent>,
) -> Result<(), String> {
    if !matches!(
        request.direction,
        Direction::JaVi | Direction::ViJa | Direction::ReviewJa
    ) {
        return Err("only translate and review are streamed".into());
    }
    match request
        .thread_id
        .and_then(|id| thread_context(&app.state::<History>(), id, CONTEXT_MESSAGES))
    {
        Some((title, messages)) => {
            request.thread_messages = messages;
            request.thread_title = Some(title);
        }
        None => {
            request.thread_id = None;
            request.thread_messages.clear();
        }
    }
    request.ask_title =
        request.conversation_id.is_some() && request.thread_id.is_none() && request.new_thread_title.is_none();
    // Only the terms that occur in this text: a short prompt keeps the first character fast.
    request.glossary = glossary_for(&app, &request.text);
    request.conversation_note = conversation_note(&app, request.conversation_id);
    request.user_lang = language(&app);

    let router = router.inner().clone();
    let filed = request.clone();
    let routes = ai::routes_for(&app, request.ai.take().as_ref());
    router
        .translate(request_id, request, &routes, move |event| {
            let saved = match &event {
                TranslateEvent::Done { sections, timing, .. } => file_result(&app, &filed, sections, timing),
                _ => None,
            };
            let _ = on_event.send(event);
            if let Some(saved) = saved {
                let _ = on_event.send(saved);
                let _ = app.emit("history:changed", ());
            }
        })
        .await;
    Ok(())
}

/// Stores a finished translation in its thread (creating the thread if needed). Translations made outside a
/// chat window (the main window's Translate tab) have no conversation and are not stored.
fn file_result(app: &AppHandle, req: &TranslateRequest, s: &Sections, t: &Timing) -> Option<TranslateEvent> {
    let conversation = req.conversation_id?;
    let history = app.state::<History>();
    let (direction, result, back) = match req.direction {
        Direction::JaVi => ("ja_vi", &s.translation, &s.back_translation),
        Direction::ViJa => ("vi_ja", &s.translation, &s.back_translation),
        Direction::ReviewJa => ("review_ja", &s.suggestion, &s.suggestion_vi),
        Direction::Summarize | Direction::Reply => return None,
    };
    // The user's own message goes from their language into the other side's; a review is always theirs.
    let mine = !matches!(
        (req.direction, req.user_lang),
        (Direction::JaVi, Lang::Vi) | (Direction::ViJa, Lang::Ja)
    );
    if result.trim().is_empty() {
        return None;
    }
    let (thread_id, thread_title) = match req.thread_id {
        Some(id) => (id, history.thread(id).ok()??.title),
        None => {
            let title = [req.new_thread_title.as_deref(), Some(s.thread_title.as_str())]
                .into_iter()
                .flatten()
                .map(str::trim)
                .find(|t| !t.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| fallback_title(req, s));
            match history.create_thread(conversation, &title) {
                Ok(id) => (id, title),
                Err(e) => {
                    log::warn!("could not create a thread: {e}");
                    return None;
                }
            }
        }
    };
    let message = NewMessage {
        direction,
        mine,
        source: &req.text,
        result,
        back,
        model: &t.model,
        prompt_version: t.prompt_version,
        first_token_ms: t.first_token_ms,
        total_ms: t.total_ms,
    };
    match history.add_message(thread_id, &message) {
        Ok(message_id) => Some(TranslateEvent::Saved {
            message_id,
            thread_id,
            thread_title,
        }),
        Err(e) => {
            log::warn!("could not save the translation: {e}");
            None
        }
    }
}

/// The start of the side in the user's language, when Claude gave no title.
fn fallback_title(req: &TranslateRequest, s: &Sections) -> String {
    let own = match (req.direction, req.user_lang) {
        (Direction::JaVi, Lang::Vi) | (Direction::ViJa, Lang::Ja) => s.translation.as_str(),
        (Direction::ViJa, Lang::Vi) | (Direction::JaVi, Lang::Ja) => req.text.as_str(),
        (Direction::ReviewJa, Lang::Vi) => s.suggestion_vi.as_str(),
        (Direction::ReviewJa, Lang::Ja) => s.suggestion.as_str(),
        (Direction::Summarize | Direction::Reply, _) => "",
    };
    // Japanese has no spaces between words: keep the first characters instead.
    let title = if req.user_lang == Lang::Ja {
        own.trim().lines().next().unwrap_or("").chars().take(20).collect()
    } else {
        own.split_whitespace().take(8).collect::<Vec<_>>().join(" ")
    };
    if title.is_empty() {
        new_thread_title(req.user_lang)
    } else {
        title
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HistorySnapshot {
    conversations: Vec<history::ConversationInfo>,
    threads: Vec<history::ThreadInfo>,
}

#[tauri::command]
fn history_snapshot(history: State<'_, History>) -> Result<HistorySnapshot, String> {
    Ok(HistorySnapshot {
        conversations: history.conversations().map_err(|e| e.to_string())?,
        threads: history.all_threads().map_err(|e| e.to_string())?,
    })
}

#[tauri::command]
fn history_messages(history: State<'_, History>, thread_id: i64) -> Result<Vec<history::MessageInfo>, String> {
    history.messages(thread_id).map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadRef {
    thread_id: i64,
    thread_title: String,
}

/// The user put a translated message in another thread, or in a new one with the title they typed.
#[tauri::command]
fn history_move(
    app: AppHandle,
    message_id: i64,
    conversation_id: i64,
    from_thread: Option<i64>,
    to_thread: Option<i64>,
    new_title: Option<String>,
) -> Result<ThreadRef, String> {
    let history = app.state::<History>();
    let (thread_id, thread_title) = match (to_thread, new_title) {
        (Some(id), _) => (
            id,
            history
                .thread(id)
                .map_err(|e| e.to_string())?
                .ok_or("thread not found")?
                .title,
        ),
        (None, title) => {
            let title = title
                .filter(|t| !t.trim().is_empty())
                .unwrap_or_else(|| new_thread_title(language(&app)));
            (
                history
                    .create_thread(conversation_id, &title)
                    .map_err(|e| e.to_string())?,
                title,
            )
        }
    };
    history.move_message(message_id, thread_id).map_err(|e| e.to_string())?;
    let _ = history.record_correction(conversation_id, from_thread, thread_id);
    let _ = app.emit("history:changed", ());
    Ok(ThreadRef {
        thread_id,
        thread_title,
    })
}

#[tauri::command]
fn history_search(history: State<'_, History>, query: String) -> Result<Vec<i64>, String> {
    history.search_threads(&query).map_err(|e| e.to_string())
}

/// "Dịch chưa tốt" in the popup, kept with the message to improve the prompt later.
#[tauri::command]
fn history_feedback(history: State<'_, History>, message_id: i64, bad: bool) -> Result<(), String> {
    history.set_feedback(message_id, bad).map_err(|e| e.to_string())
}

/// Asks where to save, then writes a copy of the whole history. `None` when cancelled.
#[tauri::command]
async fn data_backup(app: AppHandle) -> Result<Option<String>, String> {
    let name = format!("mytranslate-{}.db", &export::date(history::now_ms())[..10]);
    let mut dialog = app
        .dialog()
        .file()
        .set_title(language(&app).pick("Sao lưu dữ liệu MyTranslate", "MyTranslate のデータをバックアップ"))
        .set_file_name(name)
        .add_filter(backup_filter(language(&app)), &["db"]);
    if let Some(main) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&main);
    }
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_save_file())
        .await
        .map_err(|e| e.to_string())?;
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else {
        return Ok(None);
    };
    app.state::<History>().backup_to(&path).map_err(|e| e.to_string())?;
    Ok(Some(path.display().to_string()))
}

/// Asks for a backup file and replaces the whole history with it. `false` when cancelled.
#[tauri::command]
async fn data_restore(app: AppHandle) -> Result<bool, String> {
    let mut dialog = app
        .dialog()
        .file()
        .set_title(language(&app).pick("Khôi phục dữ liệu MyTranslate", "MyTranslate のデータを復元"))
        .add_filter(backup_filter(language(&app)), &["db"]);
    if let Some(main) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&main);
    }
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_file())
        .await
        .map_err(|e| e.to_string())?;
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else {
        return Ok(false);
    };
    app.state::<History>().restore_from(&path, language(&app))?;
    let _ = app.emit("history:changed", ());
    Ok(true)
}

fn backup_filter(lang: Lang) -> &'static str {
    lang.pick("Bản sao lưu MyTranslate", "MyTranslate バックアップ")
}

/// Deletes all history and personal glossary terms; the settings stay.
#[tauri::command]
fn data_wipe(app: AppHandle) -> Result<(), String> {
    app.state::<History>().wipe().map_err(|e| e.to_string())?;
    let _ = app.emit("history:changed", ());
    Ok(())
}

#[tauri::command]
fn history_set_pinned(app: AppHandle, thread_id: i64, pinned: bool) -> Result<(), String> {
    app.state::<History>()
        .set_pinned(thread_id, pinned)
        .map_err(|e| e.to_string())?;
    let _ = app.emit("history:changed", ());
    Ok(())
}

#[tauri::command]
fn history_set_archived(app: AppHandle, thread_id: i64, archived: bool) -> Result<(), String> {
    app.state::<History>()
        .set_archived(thread_id, archived)
        .map_err(|e| e.to_string())?;
    let _ = app.emit("history:changed", ());
    Ok(())
}

#[tauri::command]
fn history_delete_thread(app: AppHandle, thread_id: i64) -> Result<(), String> {
    app.state::<History>()
        .delete_thread(thread_id)
        .map_err(|e| e.to_string())?;
    let _ = app.emit("history:changed", ());
    Ok(())
}

#[tauri::command]
fn history_delete_conversation(app: AppHandle, conversation_id: i64) -> Result<(), String> {
    app.state::<History>()
        .delete_conversation(conversation_id)
        .map_err(|e| e.to_string())?;
    let _ = app.emit("history:changed", ());
    Ok(())
}

#[tauri::command]
fn history_merge(app: AppHandle, from: i64, into: i64) -> Result<(), String> {
    app.state::<History>()
        .merge_threads(from, into)
        .map_err(|e| e.to_string())?;
    let _ = app.emit("history:changed", ());
    Ok(())
}

/// Asks where to save, then writes the thread as Markdown. Returns the file, or `None` when cancelled.
#[tauri::command]
async fn history_export(app: AppHandle, thread_id: i64) -> Result<Option<String>, String> {
    let history = app.state::<History>();
    let thread = history
        .thread(thread_id)
        .map_err(|e| e.to_string())?
        .ok_or("thread not found")?;
    let conversation = history
        .conversation(thread.conversation_id)
        .map_err(|e| e.to_string())?;
    let messages = history.messages(thread_id).map_err(|e| e.to_string())?;
    let lang = language(&app);
    let markdown = export::thread_markdown(lang, conversation.as_ref(), &thread, &messages);

    let mut dialog = app
        .dialog()
        .file()
        .set_title(lang.pick("Xuất thread ra Markdown", "スレッドを Markdown で書き出す"))
        .set_file_name(export::file_name(&thread.title))
        .add_filter("Markdown", &["md"]);
    if let Some(main) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&main);
    }
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_save_file())
        .await
        .map_err(|e| e.to_string())?;
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else {
        return Ok(None);
    };
    std::fs::write(&path, markdown).map_err(|e| e.to_string())?;
    Ok(Some(path.display().to_string()))
}

/// Summarizes a thread in the user's language and stores the summary.
#[tauri::command]
async fn thread_summarize(
    app: AppHandle,
    router: State<'_, Arc<Router>>,
    thread_id: i64,
) -> Result<history::ThreadInfo, String> {
    let history = app.state::<History>();
    let (title, messages) = thread_context(&history, thread_id, SUMMARY_MESSAGES).ok_or("thread not found")?;
    let lang = language(&app);
    if messages.is_empty() {
        return Err(lang
            .pick("Thread chưa có tin nào", "このスレッドにはまだメッセージがありません")
            .into());
    }
    let mut request = TranslateRequest::task(Direction::Summarize, "", Keigo::Polite);
    request.thread_title = Some(title);
    request.thread_messages = messages;
    request.user_lang = lang;
    let sections = complete(&app, router.inner(), request).await?;
    if sections.summary.trim().is_empty() {
        return Err(lang
            .pick("AI không trả về tóm tắt", "AIから要約が返りませんでした")
            .into());
    }
    history
        .set_summary(thread_id, &sections.summary)
        .map_err(|e| e.to_string())?;
    let _ = app.emit("history:changed", ());
    history
        .thread(thread_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "thread not found".into())
}

/// A reply in the other side's language, with its meaning in the user's.
#[derive(Debug, PartialEq, Serialize)]
struct Reply {
    text: String,
    meaning: String,
}

/// Three short replies the user could send to the other side's message, with their meaning.
#[tauri::command]
async fn suggest_replies(
    app: AppHandle,
    router: State<'_, Arc<Router>>,
    text: String,
    keigo: Keigo,
    conversation_id: Option<i64>,
    thread_id: Option<i64>,
) -> Result<Vec<Reply>, String> {
    let mut request = TranslateRequest::task(Direction::Reply, &text, keigo);
    if let Some((title, messages)) =
        thread_id.and_then(|id| thread_context(&app.state::<History>(), id, CONTEXT_MESSAGES))
    {
        request.thread_title = Some(title);
        request.thread_messages = messages;
    }
    request.glossary = glossary_for(&app, &text);
    request.conversation_note = conversation_note(&app, conversation_id);
    request.user_lang = language(&app);
    let sections = complete(&app, router.inner(), request).await?;
    let replies = parse_replies(&sections.replies);
    if replies.is_empty() {
        return Err(no_replies_error(&app));
    }
    Ok(replies)
}

fn no_replies_error(app: &AppHandle) -> String {
    language(app)
        .pick("AI không trả về gợi ý", "AIから返信案が返りませんでした")
        .into()
}

/// "reply || meaning" per line; a line without the separator is a reply without its meaning.
fn parse_replies(text: &str) -> Vec<Reply> {
    text.lines()
        .map(|l| {
            l.trim()
                .trim_start_matches(|c: char| c == '-' || c == '・' || c.is_ascii_digit() || c == '.')
                .trim()
        })
        .filter(|l| !l.is_empty())
        .map(|l| match l.split_once("||") {
            Some((text, meaning)) => Reply {
                text: text.trim().to_string(),
                meaning: meaning.trim().to_string(),
            },
            None => Reply {
                text: l.to_string(),
                meaning: String::new(),
            },
        })
        .filter(|r| !r.text.is_empty())
        .take(3)
        .collect()
}

/// Keigo level ('' = default) and note for a conversation; without a note the stored one is kept.
#[tauri::command]
fn conversation_update(
    app: AppHandle,
    conversation_id: i64,
    keigo: String,
    note: Option<String>,
) -> Result<(), String> {
    if !matches!(keigo.as_str(), "" | "casual" | "polite" | "formal") {
        return Err(format!("unknown keigo {keigo}"));
    }
    let history = app.state::<History>();
    let note = match note {
        Some(n) => n,
        None => history
            .conversation(conversation_id)
            .map_err(|e| e.to_string())?
            .map(|c| c.note)
            .unwrap_or_default(),
    };
    history
        .update_conversation(conversation_id, &keigo, &note)
        .map_err(|e| e.to_string())?;
    let _ = app.emit("history:changed", ());
    Ok(())
}

/// The team glossary file named in the settings, read-only.
#[tauri::command]
fn glossary_team(store: State<'_, SettingsStore>, cache: State<'_, TeamGlossaryCache>) -> team_glossary::TeamGlossary {
    let path = store
        .get()
        .get("glossaryPath")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    cache.get(&path)
}

#[tauri::command]
fn glossary_list(history: State<'_, History>) -> Result<Vec<history::GlossaryTerm>, String> {
    history.glossary().map_err(|e| e.to_string())
}

#[tauri::command]
fn glossary_add(
    history: State<'_, History>,
    store: State<'_, SettingsStore>,
    ja: String,
    vi: String,
    note: String,
) -> Result<i64, String> {
    if ja.trim().is_empty() || vi.trim().is_empty() {
        return Err(store
            .language()
            .pick("Cần cả tiếng Nhật và tiếng Việt", "日本語とベトナム語の両方が必要です")
            .into());
    }
    history.add_glossary_term(&ja, &vi, &note).map_err(|e| e.to_string())
}

#[tauri::command]
fn glossary_delete(history: State<'_, History>, id: i64) -> Result<(), String> {
    history.delete_glossary_term(id).map_err(|e| e.to_string())
}

#[tauri::command]
fn history_rename_thread(app: AppHandle, thread_id: i64, title: String) -> Result<(), String> {
    app.state::<History>()
        .rename_thread(thread_id, title.trim())
        .map_err(|e| e.to_string())?;
    let _ = app.emit("history:changed", ());
    Ok(())
}

#[tauri::command]
fn cancel_translation(router: State<'_, Arc<Router>>, request_id: u64) {
    router.cancel(request_id);
}

#[tauri::command]
fn next_request_id(router: State<'_, Arc<Router>>) -> u64 {
    router.next_request_id()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeStatus {
    path: String,
    version: Option<String>,
    error: Option<String>,
}

/// `claude --version`: is the CLI installed and runnable?
#[tauri::command]
async fn claude_status(cli: State<'_, Arc<ClaudeCli>>) -> Result<ClaudeStatus, String> {
    let path = cli.exe().to_path_buf();
    let mut cmd = tokio::process::Command::new(&path);
    cmd.arg("--version").kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);
    let out = tokio::time::timeout(std::time::Duration::from_secs(20), cmd.output()).await;
    let (version, error) = match out {
        Ok(Ok(o)) if o.status.success() => (Some(String::from_utf8_lossy(&o.stdout).trim().to_string()), None),
        Ok(Ok(o)) => (None, Some(String::from_utf8_lossy(&o.stderr).trim().to_string())),
        Ok(Err(e)) => (None, Some(e.to_string())),
        Err(_) => (None, Some("claude --version did not finish in 20 s".to_string())),
    };
    Ok(ClaudeStatus {
        path: path.display().to_string(),
        version,
        error,
    })
}

/// Teams and Slack, when installed, for the getting-started screen's "Mở Teams" / "Mở Slack".
#[tauri::command]
fn chat_apps_installed() -> Vec<chat_apps::ChatApp> {
    chat_apps::installed()
}

#[tauri::command]
fn open_chat_app(store: State<'_, SettingsStore>, app: chat_apps::ChatApp) -> Result<(), String> {
    chat_apps::open(app, store.language())
}

/// Opens a console running `claude`, where the user signs in with their Claude account.
#[tauri::command]
fn open_claude_login(cli: State<'_, Arc<ClaudeCli>>) -> Result<(), String> {
    std::process::Command::new("cmd")
        .args(["/C", "start", "Claude Code"])
        .arg(cli.exe())
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Copies text for the user without hiding anything (the popup's "translate and copy").
#[tauri::command]
fn clipboard_write(text: String) -> Result<(), String> {
    capture::copy_text(&text).map_err(|e| e.to_string())
}

#[tauri::command]
fn settings_get(store: State<'_, SettingsStore>) -> Value {
    store.get_for_page()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsSaved {
    /// Hotkeys that could not be registered (taken by another app, or malformed).
    failed_hotkeys: Vec<String>,
}

/// Saves the settings, applies what the Rust side owns (hotkeys, model, autostart) and tells every window.
#[tauri::command]
async fn settings_set(app: AppHandle, window: tauri::WebviewWindow, value: Value) -> Result<SettingsSaved, String> {
    let store = app.state::<SettingsStore>();
    let before = store.get();
    store.set(value.clone()).map_err(|e| e.to_string())?;

    let changed = |key: &str| before.get(key) != value.get(key);
    let mut failed_hotkeys = Vec::new();
    if changed("hotkeys") || changed("hotkeysPaused") {
        failed_hotkeys = hotkeys::apply(&app);
        tray::sync(&app);
    }
    if changed("language") {
        tray::relabel(&app);
    }
    if changed("aiProvider")
        || changed("model")
        || changed("openaiModel")
        || changed("geminiModel")
        || changed("aiQuickModels")
    {
        tray::sync_ai(&app);
    }
    if changed("model")
        && let Some(model) = store.model()
    {
        app.state::<Arc<ClaudeCli>>().inner().set_model(&model).await;
    }
    if changed("autostart") {
        apply_autostart(&app, &value);
    }
    if changed("retentionMonths") {
        apply_retention(&app);
    }
    // The window that made the change already shows it; echoing it back would overwrite what the user typed
    // since (a stale value arriving after the next keystroke breaks fast typing and Vietnamese input methods).
    settings::broadcast(&app, &value, window.label());
    Ok(SettingsSaved { failed_hotkeys })
}

fn apply_autostart(app: &AppHandle, settings: &Value) {
    let Some(enabled) = settings.get("autostart").and_then(Value::as_bool) else {
        return;
    };
    let autolaunch = app.autolaunch();
    let result = if enabled {
        autolaunch.enable()
    } else {
        autolaunch.disable()
    };
    if let Err(e) = result {
        log::warn!("could not change autostart: {e}");
    }
}

#[tauri::command]
fn show_main_window(app: AppHandle) {
    tray::show_main(&app);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be first: a second launch (Start menu, autostart) just brings the running app forward.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if !args.iter().any(|a| a == BACKGROUND_ARG) {
                tray::show_main(app);
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![BACKGROUND_ARG]),
        ))
        .manage(popup::PopupState::default())
        .manage(HotkeyState::default())
        .manage(quickbar::QuickbarState::default())
        .manage(TeamGlossaryCache::default())
        .manage(updates::UpdateState::default())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    match app.state::<HotkeyState>().action_for(shortcut) {
                        Some(HotkeyAction::Popup(action)) => popup::on_hotkey(app, action),
                        Some(HotkeyAction::ShowMain) => tray::show_main(app),
                        None => {}
                    }
                })
                .build(),
        )
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .level_for("mytranslate_lib", log::LevelFilter::Debug)
                        .build(),
                )?;
            }
            let settings_path = app.path().app_config_dir()?.join("settings.json");
            // No settings yet: the installer just started the app for the first time on this PC.
            let first_start = !settings_path.exists();
            let store = SettingsStore::load(settings_path);
            let model = store.model().unwrap_or_else(|| DEFAULT_MODEL.to_string());
            // Pausing is for the current session only: a restart must never leave the hotkeys silently off.
            if store.hotkeys_paused()
                && let Err(e) = store.set_field("hotkeysPaused", Value::Bool(false))
            {
                log::warn!("could not resume hotkeys: {e}");
            }
            app.manage(store);
            app.manage(History::open(&app.path().app_local_data_dir()?.join("history.db"))?);
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                loop {
                    apply_retention(&handle);
                    std::thread::sleep(RETENTION_INTERVAL);
                }
            });

            // An empty working folder: no CLAUDE.md or project settings can leak into translations.
            let workdir = app.path().app_local_data_dir()?.join("claude-workdir");
            let cli = ClaudeCli::new(workdir, &model);
            cli.refill();
            cli.keep_fresh();
            app.manage(Router::new(cli.clone()));
            app.manage(cli);

            popup::create(app.handle())?;
            quickbar::create(app.handle())?;
            selection_watch::start(app.handle());
            tray::create(app.handle())?;
            hotkeys::apply(app.handle());
            updates::watch(app.handle());

            if let Some(main) = app.get_webview_window("main") {
                // Closing the main window keeps the app running in the tray, where the hotkeys live.
                let window = main.clone();
                main.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window.hide();
                        tray::notice_still_running(window.app_handle());
                    }
                });
                // The first start stays in the tray and says so, rather than opening a window over the installer.
                if first_start {
                    tray::notice_first_start(app.handle());
                } else if !std::env::args().any(|a| a == BACKGROUND_ARG) {
                    main.show()?;
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            translate,
            cancel_translation,
            next_request_id,
            claude_status,
            open_claude_login,
            chat_apps_installed,
            open_chat_app,
            settings_get,
            settings_set,
            show_main_window,
            history_snapshot,
            history_messages,
            history_move,
            history_rename_thread,
            glossary_list,
            glossary_add,
            glossary_delete,
            glossary_team,
            history_set_pinned,
            history_search,
            history_feedback,
            data_backup,
            data_restore,
            data_wipe,
            ai::ai_keys_status,
            ai::ai_key_set,
            ai::ai_models,
            ai::ai_test,
            ai::ai_choices,
            updates::update_status,
            updates::update_check,
            updates::update_install,
            history_set_archived,
            history_merge,
            history_delete_thread,
            history_delete_conversation,
            history_export,
            thread_summarize,
            suggest_replies,
            conversation_update,
            popup::popup_hide,
            popup::popup_apply,
            popup::popup_copy,
            popup::popup_fit,
            popup::popup_reset_geometry,
            popup::popup_geometry,
            popup::popup_user_change,
            quickbar::quickbar_fit,
            quickbar::quickbar_hide,
            quickbar::quickbar_action,
            clipboard_write,
        ])
        .run(tauri::generate_context!())
        .expect("error while running MyTranslate");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replies_tolerate_numbering_and_missing_meaning() {
        let r = parse_replies(
            "1. 承知しました。 || Em đã hiểu.\n\n- 確認いたします。||Em sẽ kiểm tra.\nご連絡ありがとうございます。\n4つ目 || thừa",
        );
        assert_eq!(r.len(), 3);
        assert_eq!(
            (r[0].text.as_str(), r[0].meaning.as_str()),
            ("承知しました。", "Em đã hiểu.")
        );
        assert_eq!(
            (r[1].text.as_str(), r[1].meaning.as_str()),
            ("確認いたします。", "Em sẽ kiểm tra.")
        );
        assert_eq!(
            (r[2].text.as_str(), r[2].meaning.as_str()),
            ("ご連絡ありがとうございます。", "")
        );
    }
}
