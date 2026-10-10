//! In-app updates: the app checks a `latest.json` published with each release, tells the user, and on request
//! downloads the signed installer, runs it and restarts. Only installers signed with the team's updater key are
//! accepted (the public key is in `tauri.conf.json`).
//!
//! Where `latest.json` lives is decided when the app is built: `MYTRANSLATE_UPDATE_URL` at build time, or at
//! run time (for testing a release before publishing it). A build without one never checks.

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Manager, Url};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::settings::SettingsStore;
use crate::tray;

/// First check a little after start-up, so it never competes with the first translation.
const FIRST_CHECK: Duration = Duration::from_secs(30);
const CHECK_EVERY: Duration = Duration::from_secs(6 * 60 * 60);

#[derive(Default)]
pub struct UpdateState {
    /// The update found by the last check, ready to install.
    pending: tokio::sync::Mutex<Option<Update>>,
    status: Mutex<UpdateStatus>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub current: String,
    /// Whether this build knows where to look for updates.
    pub configured: bool,
    pub available: Option<Available>,
    /// Milliseconds since the epoch of the last finished check.
    pub checked_at: Option<i64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Available {
    pub version: String,
    pub notes: String,
    pub date: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum InstallEvent {
    Progress {
        downloaded: u64,
        total: Option<u64>,
    },
    /// Downloaded and verified; the installer runs and the app restarts.
    Installing,
}

/// Where `latest.json` is: the run-time variable wins over the one baked in at build time.
fn endpoint() -> Option<Url> {
    let raw = std::env::var("MYTRANSLATE_UPDATE_URL")
        .ok()
        .or_else(|| option_env!("MYTRANSLATE_UPDATE_URL").map(str::to_string))?;
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    match Url::parse(raw) {
        Ok(url) => Some(url),
        Err(e) => {
            log::warn!("bad update URL {raw:?}: {e}");
            None
        }
    }
}

pub fn status(app: &AppHandle) -> UpdateStatus {
    let mut s = app.state::<UpdateState>().status.lock().unwrap().clone();
    s.current = app.package_info().version.to_string();
    s.configured = endpoint().is_some();
    s
}

/// Asks the release server whether a newer version exists.
pub async fn check(app: &AppHandle) -> UpdateStatus {
    let state = app.state::<UpdateState>();
    let result = match endpoint() {
        None => Ok(None),
        Some(url) => match app.updater_builder().endpoints(vec![url]) {
            Ok(builder) => match builder.timeout(Duration::from_secs(30)).build() {
                Ok(updater) => updater.check().await.map_err(|e| e.to_string()),
                Err(e) => Err(e.to_string()),
            },
            Err(e) => Err(e.to_string()),
        },
    };
    {
        let mut s = state.status.lock().unwrap();
        s.checked_at = Some(crate::history::now_ms());
        match &result {
            Ok(found) => {
                s.error = None;
                s.available = found.as_ref().map(|u| Available {
                    version: u.version.clone(),
                    notes: u.body.clone().unwrap_or_default(),
                    date: u.date.map(|d| d.to_string()),
                });
            }
            Err(e) => {
                log::warn!("update check failed: {e}");
                s.error = Some(e.clone());
            }
        }
    }
    if let Ok(found) = result {
        if let Some(u) = &found {
            log::info!("update {} available", u.version);
        }
        *state.pending.lock().await = found;
    }
    let s = status(app);
    tray::set_update(app, s.available.as_ref().map(|a| a.version.as_str()));
    let _ = app.emit("update:status", &s);
    s
}

/// Checks after start-up and then every few hours, unless the user turned it off.
pub fn watch(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK).await;
        loop {
            let enabled = app
                .state::<SettingsStore>()
                .get()
                .get("autoUpdateCheck")
                .and_then(Value::as_bool)
                .unwrap_or(true);
            if enabled && endpoint().is_some() {
                let found = check(&app).await.available.is_some();
                // Test hook for the end-to-end update test: install without a click.
                if found && std::env::var("MYTRANSLATE_TEST_AUTO_INSTALL").is_ok_and(|v| v == "1") {
                    let quiet = Channel::new(|_| Ok(()));
                    if let Err(e) = update_install(app.clone(), quiet).await {
                        log::warn!("test auto-install failed: {e}");
                    }
                }
            }
            tokio::time::sleep(CHECK_EVERY).await;
        }
    });
}

#[tauri::command]
pub fn update_status(app: AppHandle) -> UpdateStatus {
    status(&app)
}

#[tauri::command]
pub async fn update_check(app: AppHandle) -> UpdateStatus {
    check(&app).await
}

/// Downloads, verifies and installs the pending update, then restarts the app.
#[tauri::command]
pub async fn update_install(app: AppHandle, on_event: Channel<InstallEvent>) -> Result<(), String> {
    let state = app.state::<UpdateState>();
    let update = match state.pending.lock().await.take() {
        Some(u) => u,
        None => {
            // The server may have changed since the page showed the update: look again.
            check(&app).await;
            state.pending.lock().await.take().ok_or("Không có bản cập nhật")?
        }
    };
    log::info!("installing update {}", update.version);
    let mut downloaded = 0u64;
    let progress = on_event.clone();
    let result = update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = progress.send(InstallEvent::Progress { downloaded, total });
            },
            move || {
                let _ = on_event.send(InstallEvent::Installing);
            },
        )
        .await;
    if let Err(e) = result {
        log::warn!("update failed: {e}");
        return Err(e.to_string());
    }
    // On Windows the installer has been started and normally ends this process itself; restart otherwise.
    app.restart();
}
