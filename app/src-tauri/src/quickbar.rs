//! The quick toolbar shown next to a mouse selection. It never takes the focus from the chat app: the
//! window is "no-activate", shown without activation, and a button press acts on the window that was in front.

use std::sync::Mutex;

use serde::Deserialize;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use windows::Win32::Graphics::Dwm::{DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND, DwmSetWindowAttribute};
use windows::Win32::UI::WindowsAndMessaging::{
    GWL_EXSTYLE, GetWindowLongPtrW, SW_HIDE, SW_SHOWNOACTIVATE, SetWindowLongPtrW, ShowWindow, WS_EX_APPWINDOW,
    WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
};

use crate::context::{self, Context};
use crate::placement::{self, Anchor, Rect};
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
    /// Where the selected text is, for placing the popup.
    span: Option<popup::Span>,
}

pub fn create(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("MyTranslate")
        .inner_size(DEFAULT_SIZE.0, DEFAULT_SIZE.1)
        .decorations(false)
        // No Tauri shadow: it keeps a hidden caption and sizing frame, and Windows will not let such a window
        // be shorter than about 70 px. Windows 11 still draws the rounded corners and border (round_corners).
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .visible(false)
        .build()?;
    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            // No-activate: clicking a button leaves the chat app in front, with its selection intact.
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            SetWindowLongPtrW(
                hwnd,
                GWL_EXSTYLE,
                (ex | (WS_EX_NOACTIVATE.0 | WS_EX_TOOLWINDOW.0) as isize) & !(WS_EX_APPWINDOW.0 as isize),
            );
        }
    }
    round_corners(&window);
    Ok(window)
}

/// Windows 11 rounds the corners of a borderless window only when asked, like its own menus and flyouts.
/// Earlier Windows versions ignore the request.
/// A tool window without the app-window flag: never a taskbar button or an Alt+Tab entry, however often it is
/// shown again (Tauri's skip_taskbar alone can come back after a hide and show).
pub fn keep_off_taskbar(window: &WebviewWindow) {
    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            SetWindowLongPtrW(
                hwnd,
                GWL_EXSTYLE,
                (ex | WS_EX_TOOLWINDOW.0 as isize) & !(WS_EX_APPWINDOW.0 as isize),
            );
        }
    }
}

pub fn round_corners(window: &WebviewWindow) {
    if let Ok(hwnd) = window.hwnd() {
        let pref = DWMWCP_ROUND;
        unsafe {
            let _ = DwmSetWindowAttribute(
                hwnd,
                DWMWA_WINDOW_CORNER_PREFERENCE,
                (&raw const pref).cast(),
                std::mem::size_of_val(&pref) as u32,
            );
        }
    }
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
    // Shown with ShowWindow (to avoid activation), so hidden the same way: Tauri does not know it is visible
    // and would ignore its own hide().
    if let Some(Ok(hwnd)) = app.get_webview_window(LABEL).map(|w| w.hwnd()) {
        unsafe {
            let _ = ShowWindow(hwnd, SW_HIDE);
        }
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

/// Whether the settings allow the toolbar in the app in front (cheap; checked before asking UI Automation).
pub fn allowed_in_foreground(app: &AppHandle) -> bool {
    let exe = context::foreground().exe;
    !exe.is_empty() && allowed(&app.state::<SettingsStore>(), &exe)
}

/// A selection that started at height `start_y` just ended at (x, y): show the toolbar there if the settings
/// allow it in this app.
pub fn offer(app: &AppHandle, x: i32, y: i32, start_y: i32) {
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
    let anchor = bar_anchor(work, scale, f64::from(y), f64::from(start_y), h);
    let frame = placement::frame(work, scale, f64::from(x) - 12.0 * scale, anchor, w, h);
    {
        let mut inner = state.inner.lock().unwrap();
        inner.visible = true;
        inner.frame = Some(frame);
        inner.target = Some(ctx);
        let (yf, sf) = (f64::from(y), f64::from(start_y));
        inner.span = Some(popup::Span {
            x: f64::from(x),
            top: yf.min(sf),
            bottom: yf.max(sf),
        });
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

/// Clear of the line under the pointer (about half a line height from its middle).
const LINE_CLEARANCE: f64 = 16.0;

/// On the side of the release point away from the selected text, so the bar never covers it: above for a
/// selection within one line (or dragged upwards), below for one dragged down over several lines. The other side
/// when the screen edge leaves no room. Physical pixels.
fn bar_anchor(work: Rect, scale: f64, cursor_y: f64, start_y: f64, h: f64) -> Anchor {
    let gap = LINE_CLEARANCE * scale;
    let fits_above = cursor_y - gap - h >= work.y + 4.0 * scale;
    let fits_below = cursor_y + gap + h <= work.y + work.h - 4.0 * scale;
    let dragged_down = cursor_y - start_y > gap;
    if fits_above && !(dragged_down && fits_below) {
        Anchor::Above { bottom: cursor_y - gap }
    } else {
        Anchor::Below { top: cursor_y + gap }
    }
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
    let (target, span) = {
        let state = app.state::<QuickbarState>();
        let mut inner = state.inner.lock().unwrap();
        (inner.target.take(), inner.span.take())
    };
    hide(&app);
    let Some(target) = target else { return };
    crate::ai::prewarm(&app);
    let (popup_action, auto_copy) = match action.as_str() {
        "review" => (popup::Action::Review, false),
        "copyTranslation" => (popup::Action::Auto, true),
        _ => (popup::Action::Auto, false),
    };
    popup::run(&app, popup_action, Some(target), auto_copy, span);
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
    fn bar_stays_clear_of_the_selected_text() {
        let work = Rect {
            x: 0.0,
            y: 0.0,
            w: 1920.0,
            h: 1080.0,
        };
        // One line: above.
        assert_eq!(
            bar_anchor(work, 1.25, 600.0, 602.0, 50.0),
            Anchor::Above { bottom: 580.0 }
        );
        // Dragged down over three lines: below, clear of the selection.
        assert_eq!(bar_anchor(work, 1.25, 600.0, 520.0, 50.0), Anchor::Below { top: 620.0 });
        // No room above / below.
        assert_eq!(bar_anchor(work, 1.25, 40.0, 40.0, 50.0), Anchor::Below { top: 60.0 });
        assert_eq!(
            bar_anchor(work, 1.25, 1060.0, 900.0, 50.0),
            Anchor::Above { bottom: 1040.0 }
        );
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
