//! The quick toolbar shown next to a mouse selection. It never takes the focus from the chat app: the
//! window is "no-activate", shown without activation, and a button press acts on the window that was in front.

use std::sync::Mutex;

use serde::Deserialize;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GWL_EXSTYLE, GetWindowLongPtrW, SW_SHOWNOACTIVATE, SetWindowLongPtrW, ShowWindow, WS_EX_NOACTIVATE,
    WS_EX_TOOLWINDOW,
};

use crate::context::{self, Context};
use crate::placement::{self, Rect};
use crate::popup;
use crate::settings::SettingsStore;

pub const LABEL: &str = "quickbar";
/// Logical size before the page reports its own; about three labelled buttons.
const DEFAULT_SIZE: (f64, f64) = (300.0, 40.0);

#[derive(Default)]
pub struct QuickbarState {
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    visible: bool,
    /// Physical frame on screen while visible.
    frame: Option<Rect>,
    /// Logical size the page asked for.
    size: Option<(f64, f64)>,
    /// The chat window the selection is in.
    target: Option<Context>,
}

pub fn create(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("MyTranslate")
        .inner_size(DEFAULT_SIZE.0, DEFAULT_SIZE.1)
        .decorations(false)
        .shadow(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .visible(false)
        .build()?;
    // No-activate: clicking a button leaves the chat app in front, with its selection intact.
    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            SetWindowLongPtrW(
                hwnd,
                GWL_EXSTYLE,
                ex | (WS_EX_NOACTIVATE.0 | WS_EX_TOOLWINDOW.0) as isize,
            );
        }
    }
    Ok(window)
}

pub fn contains(app: &AppHandle, x: i32, y: i32) -> bool {
    let state = app.state::<QuickbarState>();
    let inner = state.inner.lock().unwrap();
    inner.visible
        && inner.frame.is_some_and(|f| {
            let (x, y) = (x as f64, y as f64);
            x >= f.x && x <= f.x + f.w && y >= f.y && y <= f.y + f.h
        })
}

pub fn hide(app: &AppHandle) {
    let state = app.state::<QuickbarState>();
    let mut inner = state.inner.lock().unwrap();
    if !inner.visible {
        return;
    }
    inner.visible = false;
    drop(inner);
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.hide();
    }
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct QuickActionSettings {
    #[serde(default)]
    enabled: bool,
    #[serde(default)]
    app_scope: String,
    #[serde(default)]
    apps: Vec<AppRef>,
}

#[derive(Deserialize)]
struct AppRef {
    exe: String,
}

/// Whether the settings allow the toolbar in the app with this executable name.
fn allowed(store: &SettingsStore, exe: &str) -> bool {
    let settings = store.get();
    let qa: QuickActionSettings = settings
        .get("quickActions")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    qa.enabled
        && !store.hotkeys_paused()
        && !store.is_blocked(exe)
        && (qa.app_scope == "all" || qa.apps.iter().any(|a| a.exe.eq_ignore_ascii_case(exe)))
}

/// A selection just ended at (x, y): show the toolbar there if the settings allow it in this app.
pub fn offer(app: &AppHandle, x: i32, y: i32) {
    let ctx = context::foreground();
    let own = std::env::current_exe()
        .ok()
        .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
        .unwrap_or_default();
    if ctx.exe.is_empty() || ctx.exe.eq_ignore_ascii_case(&own) || !allowed(&app.state::<SettingsStore>(), &ctx.exe) {
        return;
    }
    let Some(window) = app.get_webview_window(LABEL) else {
        return;
    };
    let Ok(Some(monitor)) = app.monitor_from_point(f64::from(x), f64::from(y)) else {
        return;
    };
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let work = Rect {
        x: area.position.x as f64,
        y: area.position.y as f64,
        w: area.size.width as f64,
        h: area.size.height as f64,
    };

    let state = app.state::<QuickbarState>();
    let (w, h) = state.inner.lock().unwrap().size.unwrap_or(DEFAULT_SIZE);
    let (w, h) = (w * scale, h * scale);
    // Under the pointer, or above it at the bottom of the screen; always fully on screen.
    let anchor = placement::anchor_for_cursor(work, scale, f64::from(y), h);
    let frame = placement::frame(work, scale, f64::from(x) - 12.0 * scale, anchor, w, h);
    {
        let mut inner = state.inner.lock().unwrap();
        inner.visible = true;
        inner.frame = Some(frame);
        inner.target = Some(ctx);
    }
    let _ = apply(&window, frame);
    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        }
    }
    // The page starts its idle timer.
    let _ = window.emit("quickbar:shown", ());
    log::info!(
        "quickbar shown in {exe}",
        exe = state
            .inner
            .lock()
            .unwrap()
            .target
            .as_ref()
            .map_or("", |t| t.exe.as_str())
    );
}

fn apply(window: &WebviewWindow, f: Rect) -> tauri::Result<()> {
    window.set_size(PhysicalSize::new(f.w.round() as u32, f.h.round() as u32))?;
    window.set_position(PhysicalPosition::new(f.x.round() as i32, f.y.round() as i32))
}

/// The page measured the toolbar (logical px); resize it in place, keeping it on screen.
#[tauri::command]
pub fn quickbar_fit(app: AppHandle, width: f64, height: f64) {
    let state = app.state::<QuickbarState>();
    let mut inner = state.inner.lock().unwrap();
    inner.size = Some((width, height));
    let Some(window) = app.get_webview_window(LABEL) else {
        return;
    };
    let scale = window.scale_factor().unwrap_or(1.0);
    if let Some(old) = inner.frame {
        let f = Rect {
            w: width * scale,
            h: height * scale,
            ..old
        };
        inner.frame = Some(f);
        drop(inner);
        let _ = apply(&window, f);
    }
}

#[tauri::command]
pub fn quickbar_hide(app: AppHandle) {
    hide(&app);
}

/// A toolbar button: act on the selection in the window the toolbar was shown for.
#[tauri::command]
pub fn quickbar_action(app: AppHandle, action: String) {
    let target = app.state::<QuickbarState>().inner.lock().unwrap().target.take();
    hide(&app);
    let Some(target) = target else { return };
    let (popup_action, auto_copy) = match action.as_str() {
        "review" => (popup::Action::Review, false),
        "copyTranslation" => (popup::Action::Auto, true),
        _ => (popup::Action::Auto, false),
    };
    popup::run(&app, popup_action, Some(target), auto_copy);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store(value: serde_json::Value) -> SettingsStore {
        let path = std::env::temp_dir().join(format!("mytranslate-qb-{}-{}.json", std::process::id(), rand_suffix()));
        let s = SettingsStore::load(path.clone());
        s.set(value).unwrap();
        let _ = std::fs::remove_file(path);
        s
    }

    fn rand_suffix() -> u128 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    }

    #[test]
    fn selected_apps_only() {
        let s = store(serde_json::json!({
            "quickActions": { "enabled": true, "appScope": "selected", "apps": [{ "exe": "slack.exe", "name": "Slack" }] },
            "blockedApps": []
        }));
        assert!(allowed(&s, "Slack.exe"));
        assert!(!allowed(&s, "ms-teams.exe"));
    }

    #[test]
    fn all_apps_except_blocked_and_never_when_off_or_paused() {
        let s = store(serde_json::json!({
            "quickActions": { "enabled": true, "appScope": "all", "apps": [] },
            "blockedApps": ["KeePass.exe"]
        }));
        assert!(allowed(&s, "chrome.exe"));
        assert!(!allowed(&s, "keepass.exe"));
        let off = store(serde_json::json!({ "quickActions": { "enabled": false, "appScope": "all" } }));
        assert!(!allowed(&off, "chrome.exe"));
        let paused =
            store(serde_json::json!({ "quickActions": { "enabled": true, "appScope": "all" }, "hotkeysPaused": true }));
        assert!(!allowed(&paused, "chrome.exe"));
        assert!(!allowed(&store(serde_json::Value::Null), "slack.exe"));
    }
}
