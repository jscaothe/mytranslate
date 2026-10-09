mod capture;
mod context;
mod hotkeys;
mod placement;
mod popup;
mod prompt;
mod provider;
mod settings;
mod tray;

use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_global_shortcut::ShortcutState;

use hotkeys::{HotkeyAction, HotkeyState};
use prompt::TranslateRequest;
use provider::claude_cli::{ClaudeCli, TranslateEvent};
use settings::SettingsStore;

/// Default model; SP1 showed Sonnet with low effort thinks far less often than Haiku.
const DEFAULT_MODEL: &str = "sonnet";
/// Passed by the Windows autostart entry: start in the tray without showing the main window.
const BACKGROUND_ARG: &str = "--background";

#[tauri::command]
async fn translate(
    cli: State<'_, Arc<ClaudeCli>>,
    request_id: u64,
    request: TranslateRequest,
    on_event: Channel<TranslateEvent>,
) -> Result<(), String> {
    let cli = cli.inner().clone();
    cli.translate(request_id, request, |event| {
        let _ = on_event.send(event);
    })
    .await;
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
            app.manage(store);

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
            settings_get,
            settings_set,
            show_main_window,
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
