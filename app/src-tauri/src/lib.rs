mod capture;
mod context;
mod history;
mod hotkeys;
mod placement;
mod popup;
mod prompt;
mod provider;
mod settings;
mod threads;
mod tray;

use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_global_shortcut::ShortcutState;

use history::{History, NewMessage};
use hotkeys::{HotkeyAction, HotkeyState};
use prompt::{Direction, ThreadMessage, TranslateRequest};
use provider::claude_cli::{ClaudeCli, Timing, TranslateEvent};
use provider::stream_parser::Sections;
use settings::SettingsStore;

/// Default model; SP1 showed Sonnet with low effort thinks far less often than Haiku.
const DEFAULT_MODEL: &str = "sonnet";
/// Passed by the Windows autostart entry: start in the tray without showing the main window.
const BACKGROUND_ARG: &str = "--background";
/// Earlier messages of the thread sent as context with each translation.
const CONTEXT_MESSAGES: usize = 6;

/// Translates with the thread's recent messages as context, then files the result in the history.
#[tauri::command]
async fn translate(
    app: AppHandle,
    cli: State<'_, Arc<ClaudeCli>>,
    request_id: u64,
    mut request: TranslateRequest,
    on_event: Channel<TranslateEvent>,
) -> Result<(), String> {
    let history = app.state::<History>();
    match request.thread_id.and_then(|id| history.thread(id).ok().flatten()) {
        Some(thread) => {
            request.thread_messages = history
                .recent_messages(thread.id, CONTEXT_MESSAGES)
                .unwrap_or_default()
                .iter()
                .map(|m| {
                    let (from_client, text) = m.japanese();
                    ThreadMessage {
                        from_client,
                        text: text.to_string(),
                    }
                })
                .collect();
            request.thread_title = Some(thread.title);
        }
        None => {
            request.thread_id = None;
            request.thread_messages.clear();
        }
    }
    request.ask_title =
        request.conversation_id.is_some() && request.thread_id.is_none() && request.new_thread_title.is_none();
    // Only the terms that occur in this text: a short prompt keeps the first character fast.
    let lower = request.text.to_lowercase();
    request.glossary = history
        .glossary()
        .unwrap_or_default()
        .into_iter()
        .filter(|t| t.appears_in(&request.text, &lower))
        .map(|t| (t.ja, t.vi))
        .collect();

    let cli = cli.inner().clone();
    let filed = request.clone();
    cli.translate(request_id, request, move |event| {
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
    };
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

/// The start of the Vietnamese side, when Claude gave no title.
fn fallback_title(req: &TranslateRequest, s: &Sections) -> String {
    let vietnamese = match req.direction {
        Direction::JaVi => s.translation.as_str(),
        Direction::ViJa => req.text.as_str(),
        Direction::ReviewJa => s.suggestion_vi.as_str(),
    };
    let words: Vec<&str> = vietnamese.split_whitespace().take(8).collect();
    if words.is_empty() {
        "Thread mới".to_string()
    } else {
        words.join(" ")
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
                .unwrap_or_else(|| "Thread mới".into());
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
fn glossary_list(history: State<'_, History>) -> Result<Vec<history::GlossaryTerm>, String> {
    history.glossary().map_err(|e| e.to_string())
}

#[tauri::command]
fn glossary_add(history: State<'_, History>, ja: String, vi: String, note: String) -> Result<i64, String> {
    if ja.trim().is_empty() || vi.trim().is_empty() {
        return Err("cần cả tiếng Nhật và tiếng Việt".into());
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
fn cancel_translation(cli: State<'_, Arc<ClaudeCli>>, request_id: u64) {
    cli.cancel(request_id);
}

#[tauri::command]
fn next_request_id(cli: State<'_, Arc<ClaudeCli>>) -> u64 {
    cli.next_request_id()
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

#[tauri::command]
fn settings_get(store: State<'_, SettingsStore>) -> Value {
    store.get()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsSaved {
    /// Hotkeys that could not be registered (taken by another app, or malformed).
    failed_hotkeys: Vec<String>,
}

/// Saves the settings, applies what the Rust side owns (hotkeys, model, autostart) and tells every window.
#[tauri::command]
async fn settings_set(app: AppHandle, value: Value) -> Result<SettingsSaved, String> {
    let store = app.state::<SettingsStore>();
    let before = store.get();
    store.set(value.clone()).map_err(|e| e.to_string())?;

    let changed = |key: &str| before.get(key) != value.get(key);
    let mut failed_hotkeys = Vec::new();
    if changed("hotkeys") || changed("hotkeysPaused") {
        failed_hotkeys = hotkeys::apply(&app);
        tray::sync(&app);
    }
    if changed("model")
        && let Some(model) = store.model()
    {
        app.state::<Arc<ClaudeCli>>().inner().set_model(&model).await;
    }
    if changed("autostart") {
        apply_autostart(&app, &value);
    }
    let _ = app.emit("settings:changed", &value);
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
                        .build(),
                )?;
            }
            let store = SettingsStore::load(app.path().app_config_dir()?.join("settings.json"));
            let model = store.model().unwrap_or_else(|| DEFAULT_MODEL.to_string());
            // Pausing is for the current session only: a restart must never leave the hotkeys silently off.
            if store.hotkeys_paused()
                && let Err(e) = store.set_field("hotkeysPaused", Value::Bool(false))
            {
                log::warn!("could not resume hotkeys: {e}");
            }
            app.manage(store);
            app.manage(History::open(&app.path().app_local_data_dir()?.join("history.db"))?);

            // An empty working folder: no CLAUDE.md or project settings can leak into translations.
            let workdir = app.path().app_local_data_dir()?.join("claude-workdir");
            let cli = ClaudeCli::new(workdir, &model);
            cli.refill();
            cli.keep_fresh();
            app.manage(cli);

            popup::create(app.handle())?;
            tray::create(app.handle())?;
            hotkeys::apply(app.handle());

            if let Some(main) = app.get_webview_window("main") {
                // Closing the main window keeps the app running in the tray, where the hotkeys live.
                let window = main.clone();
                main.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                });
                if !std::env::args().any(|a| a == BACKGROUND_ARG) {
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
            popup::popup_hide,
            popup::popup_apply,
            popup::popup_copy,
            popup::popup_fit,
            popup::popup_reset_geometry,
            popup::popup_geometry,
        ])
        .run(tauri::generate_context!())
        .expect("error while running MyTranslate");
}
