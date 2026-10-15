mod accounts;
mod ai;
mod capture;
mod chat_apps;
mod context;
mod credentials;
mod dates;
mod history;
mod hotkeys;
mod identity;
pub mod lang;
mod placement;
mod popup;
pub mod prompt;
pub mod provider;
mod quickbar;
mod review;
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

use history::{History, NewMessage, TermKind};
use hotkeys::{HotkeyAction, HotkeyState};
use lang::Lang;
use prompt::{Direction, Keigo, Person, ThreadMessage, TranslateRequest};
use provider::Router;
use provider::claude_cli::{ClaudeCli, Timing, TranslateEvent};
use provider::stream_parser::Sections;
use settings::SettingsStore;
use team_glossary::TeamGlossaryCache;

/// Default model; SP1 showed Sonnet with low effort thinks far less often than Haiku.
const DEFAULT_MODEL: &str = "sonnet";
/// Passed by the Windows autostart entry: start in the tray without showing the main window.
const BACKGROUND_ARG: &str = "--background";
/// The thread context sent with each translation: its latest messages that fit in this many characters. A cap on
/// characters rather than messages keeps the prompt, and so the wait for the first word, the same however long the
/// messages are.
const CONTEXT_CHARS: usize = 1200;
/// A longer message in the context keeps only its start and end, so one pasted log cannot crowd out the rest.
const CONTEXT_MESSAGE_CHARS: usize = 400;
/// Messages read to fill the context.
const CONTEXT_MAX_MESSAGES: usize = 12;
/// How often old messages are cleaned up while the app runs (it usually runs for days, in the tray).
const RETENTION_INTERVAL: std::time::Duration = std::time::Duration::from_secs(6 * 60 * 60);
const DAY_MS: i64 = 24 * 60 * 60 * 1000;

/// Deletes messages older than the "keep history for" setting: 3 months when missing, 0 keeps everything.
fn apply_retention(app: &AppHandle) {
    let months = app
        .state::<SettingsStore>()
        .get()
        .get("retentionMonths")
        .and_then(Value::as_i64)
        .unwrap_or(3);
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

/// The thread's latest messages as prompt context, Japanese side only, oldest first. A checked Vietnamese message
/// has no Japanese side.
fn thread_context(history: &History, thread_id: i64) -> Vec<ThreadMessage> {
    let messages = history
        .recent_messages(thread_id, CONTEXT_MAX_MESSAGES)
        .unwrap_or_default()
        .iter()
        .filter(|m| m.direction != "review_vi")
        .map(|m| ThreadMessage {
            from_client: !m.mine,
            text: m.japanese().to_string(),
        })
        .collect();
    within_budget(messages)
}

/// The latest messages that fit in `CONTEXT_CHARS`, each cut to `CONTEXT_MESSAGE_CHARS`. The newest one always stays.
fn within_budget(messages: Vec<ThreadMessage>) -> Vec<ThreadMessage> {
    let mut kept = Vec::new();
    let mut used = 0;
    for mut m in messages.into_iter().rev() {
        m.text = shorten(m.text.trim(), CONTEXT_MESSAGE_CHARS);
        let n = m.text.chars().count();
        if !kept.is_empty() && used + n > CONTEXT_CHARS {
            break;
        }
        used += n;
        kept.push(m);
    }
    kept.reverse();
    kept
}

/// The start and the end of a text longer than `max` characters, joined by an ellipsis.
fn shorten(text: &str, max: usize) -> String {
    let n = text.chars().count();
    if n <= max {
        return text.to_string();
    }
    let head = max * 2 / 3;
    let tail = max - head - 1;
    let start: String = text.chars().take(head).collect();
    let end: String = text.chars().skip(n - tail).collect();
    format!("{start}…{end}")
}

/// What the glossary gives a request: the terms that occur in `text`, and the people named in the text, the thread
/// context or the chat's name (a direct message is named after the person). Personal entries come first; the team's
/// are added for Japanese not already covered.
fn glossary_for(
    app: &AppHandle,
    text: &str,
    context: &[ThreadMessage],
    place: &str,
) -> (Vec<(String, String)>, Vec<Person>) {
    let path = app
        .state::<SettingsStore>()
        .get()
        .get("glossaryPath")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let team = app
        .state::<TeamGlossaryCache>()
        .get(&path)
        .terms
        .into_iter()
        .map(|t| history::GlossaryTerm {
            id: 0,
            ja: t.ja,
            vi: t.vi,
            note: t.note,
            kind: t.kind,
        });
    let personal = app.state::<History>().glossary().unwrap_or_default();
    match_glossary(personal.into_iter().chain(team), text, context, place)
}

fn match_glossary(
    entries: impl Iterator<Item = history::GlossaryTerm>,
    text: &str,
    context: &[ThreadMessage],
    place: &str,
) -> (Vec<(String, String)>, Vec<Person>) {
    let lower = text.to_lowercase();
    let mut around = format!("{text}\n{place}");
    for m in context {
        around.push('\n');
        around.push_str(&m.text);
    }
    let around_lower = around.to_lowercase();
    let mut terms: Vec<(String, String)> = Vec::new();
    let mut people: Vec<Person> = Vec::new();
    for e in entries {
        match e.kind {
            TermKind::Term => {
                if e.appears_in(text, &lower) && !terms.iter().any(|(ja, _)| *ja == e.ja) {
                    terms.push((e.ja, e.vi));
                }
            }
            TermKind::Person => {
                if e.appears_in(&around, &around_lower) && !people.iter().any(|p| p.ja == e.ja) {
                    people.push(Person {
                        ja: e.ja,
                        vi: e.vi,
                        note: e.note,
                    });
                }
            }
        }
    }
    (terms, people)
}

/// The chat's name, which is the person's in a direct message.
fn conversation_name(history: &History, conversation_id: Option<i64>) -> String {
    conversation_id
        .and_then(|id| history.conversation(id).ok().flatten())
        .map(|c| c.name)
        .unwrap_or_default()
}

/// Fills in what the app adds to a request from the history and the glossary: the thread context, the terms and
/// the people. A thread that no longer exists starts a new one.
fn add_context(app: &AppHandle, request: &mut TranslateRequest) {
    let history = app.state::<History>();
    if request
        .thread_id
        .is_some_and(|id| !matches!(history.thread(id), Ok(Some(_))))
    {
        request.thread_id = None;
    }
    request.thread_messages = request
        .thread_id
        .map(|id| thread_context(&history, id))
        .unwrap_or_default();
    let place = conversation_name(&history, request.conversation_id);
    // Only what occurs in this text: a short prompt keeps the first character fast.
    (request.glossary, request.people) = glossary_for(app, &request.text, &request.thread_messages, &place);
    request.user_lang = language(app);
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

/// Title of a thread whose first message gave none.
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
        Direction::JaVi | Direction::ViJa | Direction::ReviewJa | Direction::ReviewVi
    ) {
        return Err("only translate and review are streamed".into());
    }
    add_context(&app, &mut request);

    let router = router.inner().clone();
    let filed = request.clone();
    let routes = ai::routes_for(&app, request.ai.take().as_ref());
    router
        .translate(request_id, request, &routes, move |event| {
            let saved = match &event {
                TranslateEvent::Done { sections, timing, .. } => {
                    log::info!(
                        "{} {}: {:?} tokens, first token {:?} ms",
                        timing.provider,
                        timing.model,
                        timing.tokens,
                        timing.first_token_ms
                    );
                    file_result(&app, &filed, sections, timing)
                }
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
        Direction::ReviewVi => ("review_vi", &s.suggestion, &s.suggestion_vi),
        Direction::WritingAdvice => return None,
    };
    // The user's own message goes from their language into the other side's; a review is always theirs.
    let mine = !matches!(
        (req.direction, req.user_lang),
        (Direction::JaVi, Lang::Vi) | (Direction::ViJa, Lang::Ja)
    );
    if result.trim().is_empty() {
        return None;
    }
    let thread_id = match req.thread_id {
        Some(id) => id,
        None => match history.create_thread(conversation, &fallback_title(req, s)) {
            Ok(id) => id,
            Err(e) => {
                log::warn!("could not create a thread: {e}");
                return None;
            }
        },
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
        tokens: t.tokens,
    };
    match history.add_message(thread_id, &message) {
        Ok(message_id) => {
            let written = match req.direction {
                Direction::ReviewJa => Some(Lang::Ja),
                Direction::ReviewVi => Some(Lang::Vi),
                _ => None,
            };
            if let Some(lang) = written {
                let verdict = s.verdict.trim().to_lowercase();
                if let Err(e) = history.set_review(message_id, lang, &verdict, &review::parse_issues(&s.issues)) {
                    log::warn!("could not save the review: {e}");
                }
            }
            Some(TranslateEvent::Saved { message_id, thread_id })
        }
        Err(e) => {
            log::warn!("could not save the translation: {e}");
            None
        }
    }
}

/// A thread's title: the start of its first message, in the user's language.
fn fallback_title(req: &TranslateRequest, s: &Sections) -> String {
    let own = match (req.direction, req.user_lang) {
        (Direction::JaVi, Lang::Vi) | (Direction::ViJa, Lang::Ja) => s.translation.as_str(),
        (Direction::ViJa, Lang::Vi) | (Direction::JaVi, Lang::Ja) => req.text.as_str(),
        (Direction::ReviewJa, Lang::Vi) => s.suggestion_vi.as_str(),
        (Direction::ReviewJa, Lang::Ja) | (Direction::ReviewVi, Lang::Vi) => s.suggestion.as_str(),
        (Direction::ReviewVi, Lang::Ja) => s.suggestion_vi.as_str(),
        (Direction::WritingAdvice, _) => "",
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

/// A keigo level picked in the popup, kept for the conversation's next translations.
#[tauri::command]
fn conversation_keigo_set(history: State<'_, History>, conversation_id: i64, keigo: Keigo) -> Result<(), String> {
    history
        .set_conversation_keigo(conversation_id, keigo)
        .map_err(|e| e.to_string())
}

/// Asks where to save, then writes a copy of the whole history. `None` when cancelled.
#[tauri::command]
async fn data_backup(app: AppHandle) -> Result<Option<String>, String> {
    let name = format!("mytranslate-{}.db", &dates::date(history::now_ms())[..10]);
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

/// Deletes all history and the personal glossary (terms and people); the settings stay.
#[tauri::command]
fn data_wipe(app: AppHandle) -> Result<(), String> {
    app.state::<History>().wipe().map_err(|e| e.to_string())?;
    let _ = app.emit("history:changed", ());
    Ok(())
}

/// Mistakes the advice is based on: the latest, enough to show habits, few enough to answer quickly.
const ADVICE_ISSUES: usize = 80;

#[derive(Serialize)]
struct WritingOverview {
    /// Japanese, then Vietnamese, whether or not the user wrote any.
    languages: Vec<history::WritingStats>,
}

/// The user's writing in each language over the last `days` (all of the history when `None`).
#[tauri::command]
fn writing_stats(history: State<'_, History>, days: Option<i64>) -> Result<WritingOverview, String> {
    let since = days.map_or(i64::MIN, |d| history::now_ms() - d * DAY_MS);
    let languages = history.writing_stats(since).map_err(|e| e.to_string())?;
    Ok(WritingOverview { languages })
}

#[tauri::command]
fn writing_advice_get(history: State<'_, History>, lang: Lang) -> Result<Option<history::Advice>, String> {
    history.advice(lang).map_err(|e| e.to_string())
}

/// Asks the AI what the user's recent mistakes in `lang` have in common, and keeps its advice.
#[tauri::command]
async fn writing_advice_make(
    app: AppHandle,
    router: State<'_, Arc<Router>>,
    lang: Lang,
) -> Result<history::Advice, String> {
    let history = app.state::<History>();
    let issues = history.writing_issues(lang, ADVICE_ISSUES).map_err(|e| e.to_string())?;
    let user = language(&app);
    if issues.is_empty() {
        return Err(user
            .pick("Chưa có lỗi nào để phân tích", "分析できる誤りがまだありません")
            .into());
    }
    let list: Vec<String> = issues
        .iter()
        .map(|i| format!("{} || {} || {}", i.kind, i.wrong, i.fix))
        .collect();
    let mut request = TranslateRequest::task(Direction::WritingAdvice, &list.join("\n"), Keigo::Polite);
    request.user_lang = user;
    request.review_lang = lang;
    let sections = complete(&app, router.inner(), request).await?;
    let items = review::parse_advice(&sections.advice);
    if items.is_empty() {
        return Err(user
            .pick("AI không trả về lời khuyên", "AIから助言が返りませんでした")
            .into());
    }
    history.set_advice(lang, &items).map_err(|e| e.to_string())
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
    kind: TermKind,
) -> Result<i64, String> {
    both_languages(&store, &ja, &vi)?;
    history
        .add_glossary_term(&ja, &vi, &note, kind)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn glossary_update(
    history: State<'_, History>,
    store: State<'_, SettingsStore>,
    id: i64,
    ja: String,
    vi: String,
    note: String,
) -> Result<(), String> {
    both_languages(&store, &ja, &vi)?;
    history
        .update_glossary_term(id, &ja, &vi, &note)
        .map_err(|e| e.to_string())
}

fn both_languages(store: &SettingsStore, ja: &str, vi: &str) -> Result<(), String> {
    if ja.trim().is_empty() || vi.trim().is_empty() {
        return Err(store
            .language()
            .pick("Cần cả tiếng Nhật và tiếng Việt", "日本語とベトナム語の両方が必要です")
            .into());
    }
    Ok(())
}

#[tauri::command]
fn glossary_delete(history: State<'_, History>, id: i64) -> Result<(), String> {
    history.delete_glossary_term(id).map_err(|e| e.to_string())
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
    /// From `claude auth status`; `None` when Claude Code is missing or could not tell.
    logged_in: Option<bool>,
}

/// `claude --version`: is the CLI installed and runnable? Then `claude auth status`: is it signed in? Only the
/// yes/no is kept; the account details it prints stay with Claude Code.
#[tauri::command]
async fn claude_status(cli: State<'_, Arc<ClaudeCli>>) -> Result<ClaudeStatus, String> {
    let path = cli.exe();
    let (version, error) = match run_quietly(&path, &["--version"]).await {
        Ok(out) => (Some(out), None),
        Err(e) => (None, Some(e)),
    };
    // Signed out, `auth status` may exit with an error and still print its JSON: read stdout either way.
    let logged_in = match version {
        Some(_) => output_quietly(&path, &["auth", "status"])
            .await
            .ok()
            .and_then(|o| serde_json::from_slice::<serde_json::Value>(&o.stdout).ok())
            .and_then(|v| v["loggedIn"].as_bool()),
        None => None,
    };
    Ok(ClaudeStatus {
        path: path.display().to_string(),
        version,
        error,
        logged_in,
    })
}

/// Is Codex installed, and is it signed in with a ChatGPT account.
#[tauri::command]
async fn codex_status() -> provider::codex_cli::CodexStatus {
    provider::codex_cli::status().await
}

/// Runs a short CLI command without a console window; its trimmed stdout, or why it failed.
async fn run_quietly(exe: &std::path::Path, args: &[&str]) -> Result<String, String> {
    let o = output_quietly(exe, args).await?;
    if o.status.success() {
        Ok(String::from_utf8_lossy(&o.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&o.stderr).trim().to_string())
    }
}

/// Runs a short CLI command without a console window, giving up after 20 s.
async fn output_quietly(exe: &std::path::Path, args: &[&str]) -> Result<std::process::Output, String> {
    let mut cmd = tokio::process::Command::new(exe);
    cmd.args(args).kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);
    match tokio::time::timeout(std::time::Duration::from_secs(20), cmd.output()).await {
        Ok(result) => result.map_err(|e| e.to_string()),
        Err(_) => Err(format!("{} {} did not finish in 20 s", exe.display(), args.join(" "))),
    }
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

/// Opens a setup page (installing Claude Code, creating an API key) in the browser.
#[tauri::command]
fn open_help_page(store: State<'_, SettingsStore>, page: chat_apps::HelpPage) -> Result<(), String> {
    chat_apps::open_help(page, store.language())
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
    // The guide is done: the app goes to the tray, where it waits for the hotkeys. After the broadcast, so that
    // the flag the notice saves reaches every window last.
    if changed("onboarded") && store.flag("onboarded") {
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.hide();
        }
        tray::notice_setup_done(&app);
    }
    Ok(SettingsSaved { failed_hotkeys })
}

/// Makes the Windows autostart entry match the setting, which is on unless the user turned it off. Turning it on
/// always rewrites the entry, so it starts this copy of the app even when another copy wrote it before.
fn apply_autostart(app: &AppHandle, settings: &Value) {
    let enabled = settings.get("autostart").and_then(Value::as_bool).unwrap_or(true);
    let autolaunch = app.autolaunch();
    let result = if enabled {
        autolaunch.enable()
    } else if autolaunch.is_enabled().unwrap_or(false) {
        autolaunch.disable()
    } else {
        return;
    };
    if let Err(e) = result {
        log::warn!("could not change autostart: {e}");
    }
}

/// Whether this is the copy the installer put in place (a per-user install). Only that one registers itself at
/// start-up: a build run from a project folder must not take over the entry Windows starts at sign-in.
fn is_installed() -> bool {
    let (Ok(exe), Some(local)) = (std::env::current_exe(), std::env::var_os("LOCALAPPDATA")) else {
        return false;
    };
    let installed = std::path::Path::new(&local).join(identity::name());
    exe.parent()
        .is_some_and(|dir| dir.to_string_lossy().eq_ignore_ascii_case(&installed.to_string_lossy()))
}

#[tauri::command]
fn show_main_window(app: AppHandle) {
    tray::show_main(&app);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    identity::init(context.config().product_name.as_deref());
    tauri::Builder::default()
        // Must be first: a second launch (Start menu, autostart) just brings the running app forward.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if !args.iter().any(|a| a == BACKGROUND_ARG) || !app.state::<SettingsStore>().flag("onboarded") {
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
        .manage(accounts::LoginState::default())
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
            let store = SettingsStore::load(app.path().app_config_dir()?.join("settings.json"));
            // Until the guide is done (an AI connected), the app shows it on every start, even from autostart:
            // a new user would not know that it needs setting up.
            let onboarded = store.flag("onboarded");
            let model = store.model().unwrap_or_else(|| DEFAULT_MODEL.to_string());
            // Pausing is for the current session only: a restart must never leave the hotkeys silently off.
            if store.hotkeys_paused()
                && let Err(e) = store.set_field("hotkeysPaused", Value::Bool(false))
            {
                log::warn!("could not resume hotkeys: {e}");
            }
            // From the first start, so that after the next sign-in the app is there (in the tray, or with the guide).
            if is_installed() {
                apply_autostart(app.handle(), &store.get());
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
            let codex_workdir = app.path().app_local_data_dir()?.join("codex-workdir");
            app.manage(Router::new(cli.clone(), codex_workdir));
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
                // Started by Windows at sign-in: straight to the tray, once set up.
                if !onboarded || !std::env::args().any(|a| a == BACKGROUND_ARG) {
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
            codex_status,
            accounts::account_status,
            accounts::account_install,
            accounts::account_login,
            accounts::account_login_cancel,
            open_claude_login,
            chat_apps_installed,
            open_chat_app,
            open_help_page,
            settings_get,
            settings_set,
            show_main_window,
            glossary_list,
            glossary_add,
            glossary_update,
            glossary_delete,
            glossary_team,
            conversation_keigo_set,
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
            writing_stats,
            writing_advice_get,
            writing_advice_make,
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
        .run(context)
        .expect("error while running MyTranslate");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(text: &str) -> ThreadMessage {
        ThreadMessage {
            from_client: true,
            text: text.into(),
        }
    }

    #[test]
    fn context_keeps_the_latest_messages_that_fit() {
        let long = "あ".repeat(1000);
        let kept = within_budget(vec![
            msg("古い"),
            msg(&"い".repeat(500)),
            msg(&"う".repeat(500)),
            msg(&long),
            msg("最新"),
        ]);
        // Long messages keep their start and end only; the older ones no longer fit.
        assert_eq!(kept.len(), 3);
        assert!(kept[0].text.starts_with('う'));
        assert_eq!(kept[0].text.chars().count(), 400);
        assert!(kept[1].text.starts_with('あ') && kept[1].text.contains('…'));
        assert_eq!(kept[2].text, "最新");
        // The newest message stays even when it is long on its own.
        assert_eq!(within_budget(vec![msg(&long)]).len(), 1);
        assert!(within_budget(Vec::new()).is_empty());
    }

    fn entry(ja: &str, vi: &str, kind: TermKind) -> history::GlossaryTerm {
        history::GlossaryTerm {
            id: 0,
            ja: ja.into(),
            vi: vi.into(),
            note: format!("note {vi}"),
            kind,
        }
    }

    #[test]
    fn people_come_from_the_text_the_thread_or_the_chat_name() {
        let entries = vec![
            entry("仕訳", "bút toán", TermKind::Term),
            entry("田中", "Tanaka", TermKind::Person),
            entry("鈴木", "Suzuki", TermKind::Person),
            entry("佐藤", "Sato", TermKind::Person),
            entry("山田", "Yamada", TermKind::Person),
            // The team's copy of a personal entry is not sent twice.
            entry("田中", "Tanaka-san", TermKind::Person),
        ];
        let (terms, people) = match_glossary(
            entries.into_iter(),
            "仕訳の件、鈴木さんに確認します",
            &[msg("佐藤です。よろしくお願いします。")],
            "Tanaka Taro",
        );
        assert_eq!(terms, [("仕訳".to_string(), "bút toán".to_string())]);
        let names: Vec<&str> = people.iter().map(|p| p.vi.as_str()).collect();
        assert_eq!(names, ["Tanaka", "Suzuki", "Sato"]);
        // A term is only sent for the text itself, not for the thread around it.
        let (terms, _) = match_glossary(
            vec![entry("仕訳", "bút toán", TermKind::Term)].into_iter(),
            "OK",
            &[msg("仕訳")],
            "",
        );
        assert!(terms.is_empty());
    }
}
