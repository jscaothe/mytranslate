//! The translation popup: a borderless, always-on-top window created hidden at start-up so it can appear
//! instantly when a hotkey fires. Its place and size are remembered for the rest of the app session.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};

use crate::capture;
use crate::context::{self, ChatApp, Context};
use crate::history::{self, History, ThreadInfo};
use crate::lang::Lang;
use crate::placement::{self, Anchor, Rect};
use crate::settings::SettingsStore;
use crate::threads::{self, Candidate, Confidence};

pub const LABEL: &str = "popup";
const DEFAULT_WIDTH: f64 = 440.0;
const MIN_WIDTH: f64 = 360.0;
const MAX_WIDTH: f64 = 760.0;
const MIN_HEIGHT: f64 = 120.0;
/// Tallest a popup grows by itself; longer results scroll inside. The screen can cap it further.
const AUTO_MAX_HEIGHT: f64 = 600.0;
/// Size of the hidden window before its first use.
const INITIAL_HEIGHT: f64 = 300.0;
/// Move/resize events that arrive this soon after the app itself moved the window are not the user's doing.
const PROGRAMMATIC_GRACE: Duration = Duration::from_millis(500);

/// Text the user selected with the mouse, in physical pixels: where the pointer was released, and the
/// middle of the first and last selected line. The popup is placed around it instead of around the pointer
/// (which is on the quick toolbar by then).
#[derive(Debug, Clone, Copy)]
pub struct Span {
    pub x: f64,
    pub top: f64,
    pub bottom: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// Read a message from the other side, in the user's language (Ctrl+Alt+J).
    Read,
    /// Write in the user's language and send it in the other side's (Ctrl+Alt+K), usually from the message box.
    Write,
    Auto,
    /// Check Japanese the user wrote, usually in the message box.
    Review,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Direction {
    JaVi,
    ViJa,
    ReviewJa,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Origin {
    /// Text selected in the conversation: the result is read or copied.
    Chat,
    /// Text from the message box: the result replaces it.
    Composer,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenPayload {
    pub id: u64,
    pub direction: Direction,
    pub text: String,
    pub origin: Origin,
    pub app: ChatApp,
    pub conversation: String,
    pub workspace: Option<String>,
    /// `no_selection` or `clipboard` when nothing could be read.
    pub error: Option<String>,
    /// History: the chat window's conversation, and the thread the message most likely belongs to.
    pub conversation_id: Option<i64>,
    pub thread_id: Option<i64>,
    pub confidence: Confidence,
    /// Recent threads of this conversation, for the thread picker.
    pub threads: Vec<ThreadInfo>,
    /// Copy the result to the clipboard as soon as it is ready (toolbar "translate and copy").
    pub auto_copy: bool,
    /// The keigo level remembered for this conversation; empty means the default from the settings.
    pub keigo: String,
}

/// Threads untouched for this long are not offered as candidates.
const THREAD_HORIZON_MS: i64 = 14 * 24 * 60 * 60 * 1000;
const MAX_CANDIDATES: usize = 8;
/// Messages per thread compared with the new text.
const CANDIDATE_MESSAGES: usize = 4;

/// Files the text under its chat window's conversation and guesses the thread, all locally.
fn detect_thread(
    history: &History,
    ctx: &Context,
    text: &str,
    lang: Lang,
) -> (Option<i64>, Option<i64>, Confidence, Vec<ThreadInfo>) {
    let app = match ctx.app {
        ChatApp::Slack => "slack",
        ChatApp::Teams => "teams",
        ChatApp::Other => "other",
    };
    let name = match ctx.conversation.trim() {
        "" => lang.pick("Khác", "その他"),
        n => n,
    };
    let conversation = match history.upsert_conversation(app, name, ctx.workspace.as_deref().unwrap_or("")) {
        Ok(id) => id,
        Err(e) => {
            log::warn!("history unavailable: {e}");
            return (None, None, Confidence::High, Vec::new());
        }
    };
    let now = history::now_ms();
    let mut threads = history
        .recent_threads(conversation, now - THREAD_HORIZON_MS, MAX_CANDIDATES)
        .unwrap_or_default();
    // A pinned thread takes every new message of its conversation, however old it is.
    if let Ok(Some(pinned)) = history.pinned_thread(conversation) {
        log::info!("thread pinned {}", pinned.id);
        let id = pinned.id;
        if !threads.iter().any(|t| t.id == id) {
            threads.insert(0, pinned);
        }
        return (Some(conversation), Some(id), Confidence::High, threads);
    }
    let candidates: Vec<Candidate> = threads
        .iter()
        .map(|t| {
            let mut text = t.title.clone();
            for m in history.recent_messages(t.id, CANDIDATE_MESSAGES).unwrap_or_default() {
                text.push('\n');
                text.push_str(&m.source);
                text.push('\n');
                text.push_str(&m.result);
            }
            Candidate {
                id: t.id,
                last_active: t.last_active,
                text,
            }
        })
        .collect();
    let d = threads::detect(text, &candidates, now);
    log::info!(
        "thread guess {:?} ({:?}) among {}",
        d.thread_id,
        d.confidence,
        threads.len()
    );
    (Some(conversation), d.thread_id, d.confidence, threads)
}

/// What the user chose by dragging, in logical pixels. `None` / `false` means the app decides
/// (follow the cursor, fit the content, width from the text length).
#[derive(Debug, Clone, Copy)]
struct Geometry {
    width: f64,
    user_width: bool,
    height: Option<f64>,
    position: Option<(f64, f64)>,
}

impl Default for Geometry {
    fn default() -> Self {
        Self {
            width: DEFAULT_WIDTH,
            user_width: false,
            height: None,
            position: None,
        }
    }
}

/// Where the current popup sits, so a height change can keep it on screen. Physical pixels.
#[derive(Debug, Clone, Copy)]
struct Placed {
    work: Rect,
    scale: f64,
    x: f64,
    width: f64,
    anchor: Anchor,
}

pub struct PopupState {
    inner: Mutex<Inner>,
}

struct Inner {
    geometry: Geometry,
    placed: Option<Placed>,
    target_hwnd: isize,
    programmatic_until: Instant,
    /// The user started dragging the title bar or an edge (told by the page). Only then do move and resize
    /// events change the remembered place and size: Windows also sends them on its own, for example while
    /// the popup grows with the translation, and those must not pin the popup somewhere.
    user_change: bool,
    next_id: u64,
}

impl Default for PopupState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(Inner {
                geometry: Geometry::default(),
                placed: None,
                target_hwnd: 0,
                programmatic_until: Instant::now(),
                user_change: false,
                next_id: 1,
            }),
        }
    }
}

pub fn create(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("MyTranslate")
        .inner_size(DEFAULT_WIDTH, INITIAL_HEIGHT)
        .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
        .decorations(false)
        .shadow(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(true)
        .visible(false)
        .build()?;
    crate::quickbar::round_corners(&window);
    crate::quickbar::keep_off_taskbar(&window);

    let handle = app.clone();
    window.on_window_event(move |event| {
        let state = handle.state::<PopupState>();
        let mut inner = state.inner.lock().unwrap();
        if !inner.user_change || Instant::now() < inner.programmatic_until {
            return;
        }
        let Some(window) = handle.get_webview_window(LABEL) else {
            return;
        };
        let scale = window.scale_factor().unwrap_or(1.0);
        match event {
            WindowEvent::Moved(pos) => {
                let p = pos.to_logical::<f64>(scale);
                inner.geometry.position = Some((p.x, p.y));
                if let Some(placed) = inner.placed.as_mut() {
                    placed.x = pos.x as f64;
                    placed.anchor = Anchor::Fixed { top: pos.y as f64 };
                }
            }
            WindowEvent::Resized(size) if size.width > 0 => {
                let s = size.to_logical::<f64>(scale);
                inner.geometry.width = s.width.clamp(MIN_WIDTH, MAX_WIDTH);
                inner.geometry.user_width = true;
                inner.geometry.height = Some(s.height.max(MIN_HEIGHT));
                if let Some(placed) = inner.placed.as_mut() {
                    placed.width = size.width as f64;
                }
            }
            _ => {}
        }
    });
    Ok(window)
}

/// Runs on a hotkey: reads the selection, places the popup and tells its page what to translate.
pub fn on_hotkey(app: &AppHandle, action: Action) {
    // Right now, while Alt is still held: keep the app in front from opening its menu bar on Alt release.
    capture::mask_menu_key();
    // ChatGPT or Gemini: connect now, while the text is being copied.
    crate::ai::prewarm(app);
    run(app, action, None, false, None);
}

/// Reads the selection, places the popup and tells its page what to do. `target` is the chat window when the
/// quick toolbar already knows it (the user selected with the mouse); `auto_copy` copies the result as soon as
/// it is ready.
pub fn run(app: &AppHandle, action: Action, target: Option<Context>, auto_copy: bool, span: Option<Span>) {
    let app = app.clone();
    // Copying blocks for up to ~1 s (waiting for keys to be released, for the clipboard); keep it off the UI thread.
    tauri::async_runtime::spawn_blocking(move || {
        let from_toolbar = target.is_some();
        let ctx = match target {
            Some(t) => {
                capture::bring_to_front(t.hwnd);
                t
            }
            None => context::foreground(),
        };
        log::info!("{action:?} in {} ({:?})", ctx.exe, ctx.app);
        if ctx.exe.eq_ignore_ascii_case(&own_exe_name()) {
            return;
        }
        if app.state::<SettingsStore>().is_blocked(&ctx.exe) {
            log::info!("{} is blocked in the settings", ctx.exe);
            return;
        }
        // Only a message box is safe to select-all; in the message list Ctrl+A would grab the whole page.
        // A mouse selection is never extended.
        let select_all = !from_toolbar && matches!(action, Action::Write | Action::Review);
        let (text, error) = match capture::copy_selection(select_all) {
            Ok(Some(t)) => (t, None),
            Ok(None) => (String::new(), Some("no_selection".to_string())),
            Err(e) => {
                log::warn!("capture failed: {e}");
                (String::new(), Some("clipboard".to_string()))
            }
        };
        log::info!("captured {} chars, error: {error:?}", text.chars().count());
        let lang = app.state::<SettingsStore>().language();
        let (direction, origin) = route(action, &text, lang);

        let history = app.state::<History>();
        let (conversation_id, thread_id, confidence, threads) = if error.is_none() {
            detect_thread(&history, &ctx, &text, lang)
        } else {
            (None, None, Confidence::High, Vec::new())
        };
        let keigo = conversation_id
            .and_then(|id| history.conversation(id).ok().flatten())
            .map(|c| c.keigo)
            .unwrap_or_default();

        let state = app.state::<PopupState>();
        let id = {
            let mut inner = state.inner.lock().unwrap();
            inner.target_hwnd = ctx.hwnd;
            inner.next_id += 1;
            inner.next_id
        };
        let payload = OpenPayload {
            id,
            direction,
            text,
            origin,
            app: ctx.app,
            conversation: ctx.conversation,
            workspace: ctx.workspace,
            error,
            conversation_id,
            thread_id,
            confidence,
            threads,
            auto_copy,
            keigo,
        };
        if let Err(e) = show(&app, payload, span) {
            log::warn!("could not show the popup: {e}");
        }
    });
}

fn show(app: &AppHandle, payload: OpenPayload, span: Option<Span>) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window(LABEL) else {
        return Ok(());
    };
    let state = app.state::<PopupState>();
    let geometry = state.inner.lock().unwrap().geometry;

    // A dragged popup reopens where it was left; otherwise next to the cursor.
    let point = match geometry.position {
        Some((lx, ly)) => {
            let scale = window.scale_factor()?;
            PhysicalPosition::new(lx * scale, ly * scale)
        }
        None => match span {
            Some(s) => PhysicalPosition::new(s.x, s.bottom),
            None => app.cursor_position()?,
        },
    };
    let monitor = app.monitor_from_point(point.x, point.y)?.or(window.current_monitor()?);
    let Some(monitor) = monitor else {
        return Ok(());
    };
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let work = Rect {
        x: area.position.x as f64,
        y: area.position.y as f64,
        w: area.size.width as f64,
        h: area.size.height as f64,
    };

    // Size from the text unless the user resized the popup; the page reports the real height right after.
    let width = if geometry.user_width {
        geometry.width
    } else {
        placement::auto_width(&payload.text, payload.direction == Direction::ViJa)
    };
    // A Japanese result shows a second block: the reading back, or the suggestion's meaning.
    let with_back = payload.direction != Direction::JaVi;
    let expected = geometry
        .height
        .unwrap_or_else(|| placement::expected_height(&payload.text, width, with_back).min(AUTO_MAX_HEIGHT));

    let (x, anchor) = match (geometry.position, span) {
        (Some(_), _) => (point.x, Anchor::Fixed { top: point.y }),
        (None, Some(s)) => (
            s.x - 24.0 * scale,
            placement::anchor_for_span(work, scale, s.top, s.bottom, expected * scale),
        ),
        (None, None) => (
            point.x - 24.0 * scale,
            placement::anchor_for_cursor(work, scale, point.y, expected * scale),
        ),
    };
    let placed = Placed {
        work,
        scale,
        x,
        width: width * scale,
        anchor,
    };
    let f = placement::frame(work, scale, placed.x, anchor, placed.width, expected * scale);
    {
        let mut inner = state.inner.lock().unwrap();
        inner.placed = Some(placed);
        inner.programmatic_until = Instant::now() + PROGRAMMATIC_GRACE;
        inner.user_change = false;
    }
    apply_frame(&window, f)?;
    window.emit_to(LABEL, "popup:open", &payload)?;
    window.show()?;
    window.set_focus()?;
    log::info!(
        "popup shown at ({}, {}) size {}x{} anchor {anchor:?}",
        f.x,
        f.y,
        f.w,
        f.h
    );
    Ok(())
}

fn apply_frame(window: &WebviewWindow, f: Rect) -> tauri::Result<()> {
    window.set_size(PhysicalSize::new(f.w.round() as u32, f.h.round() as u32))?;
    window.set_position(PhysicalPosition::new(f.x.round() as i32, f.y.round() as i32))
}

fn own_exe_name() -> String {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
        .unwrap_or_default()
}

/// Which way to translate, and where the result goes: what the user writes (a translation into the other
/// side's language, corrected Japanese) replaces the message box text; what they read is only shown.
pub fn route(action: Action, text: &str, lang: Lang) -> (Direction, Origin) {
    // The text's own language decides when it is clear; the user's language decides "read" and "write".
    let japanese = is_japanese_only(text);
    let vietnamese = !has_japanese(text);
    let (read, write) = match lang {
        Lang::Vi => (Direction::JaVi, Direction::ViJa),
        Lang::Ja => (Direction::ViJa, Direction::JaVi),
    };
    let direction = match (action, lang) {
        (Action::Read, _) => read,
        // Ctrl+Alt+K on text already in the other side's language: the user wants to read it, not replace it.
        (Action::Write, Lang::Vi) if japanese => read,
        (Action::Write, Lang::Ja) if vietnamese => read,
        (Action::Write, _) => write,
        (Action::Auto, _) if has_japanese(text) => Direction::JaVi,
        (Action::Auto, _) => Direction::ViJa,
        // Nothing Japanese to check: translate the Vietnamese instead of reviewing it.
        (Action::Review, _) if vietnamese => Direction::ViJa,
        (Action::Review, _) => Direction::ReviewJa,
    };
    let origin = if direction == read {
        Origin::Chat
    } else {
        Origin::Composer
    };
    (direction, origin)
}

/// Japanese with at most a few Latin words (API, UAT, file names...). Vietnamese always brings Latin letters,
/// usually with diacritics, so a handful of plain Latin words alone do not make a text Vietnamese.
pub fn is_japanese_only(text: &str) -> bool {
    let has_vietnamese_marks = text.chars().any(is_vietnamese_letter);
    let latin_words = text
        .split(|c: char| !(c.is_ascii_alphabetic() || is_vietnamese_letter(c)))
        .filter(|w| !w.is_empty())
        .count();
    has_japanese(text) && !has_vietnamese_marks && latin_words <= 3
}

/// Latin letters with Vietnamese diacritics (Latin-1 Supplement, Latin Extended-A/B and Extended Additional).
fn is_vietnamese_letter(c: char) -> bool {
    !c.is_ascii() && matches!(c, '\u{00C0}'..='\u{01B0}' | '\u{1EA0}'..='\u{1EF9}')
}

pub fn has_japanese(text: &str) -> bool {
    text.chars()
        .any(|c| matches!(c, '\u{3040}'..='\u{30ff}' | '\u{4e00}'..='\u{9fff}'))
}

#[tauri::command]
pub fn popup_hide(app: AppHandle) {
    log::info!("popup hidden");
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.hide();
    }
}

/// Replaces the selection in the window the text came from.
#[tauri::command]
pub async fn popup_apply(app: AppHandle, text: String) -> Result<(), String> {
    popup_hide(app.clone());
    let hwnd = app.state::<PopupState>().inner.lock().unwrap().target_hwnd;
    tauri::async_runtime::spawn_blocking(move || capture::paste_into(hwnd, &text))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Puts the result on the clipboard and returns focus to the chat app.
#[tauri::command]
pub fn popup_copy(app: AppHandle, text: String) -> Result<(), String> {
    capture::copy_text(&text).map_err(|e| e.to_string())?;
    popup_hide(app);
    Ok(())
}

/// The page reports its natural height (logical px). The window follows it, unless the user set a height,
/// keeping its anchored edge in place and staying fully on screen.
#[tauri::command]
pub fn popup_fit(app: AppHandle, height: f64) -> Result<(), String> {
    let Some(window) = app.get_webview_window(LABEL) else {
        return Ok(());
    };
    let state = app.state::<PopupState>();
    let mut inner = state.inner.lock().unwrap();
    let Some(placed) = inner.placed else {
        return Ok(());
    };
    if inner.geometry.height.is_some() {
        return Ok(());
    }
    inner.programmatic_until = Instant::now() + PROGRAMMATIC_GRACE;
    drop(inner);
    let h = height.clamp(MIN_HEIGHT, AUTO_MAX_HEIGHT) * placed.scale;
    let f = placement::frame(placed.work, placed.scale, placed.x, placed.anchor, placed.width, h);
    apply_frame(&window, f).map_err(|e| e.to_string())
}

/// Forgets the user's place and size; the next popup opens at the cursor with the default size.
#[tauri::command]
pub fn popup_reset_geometry(app: AppHandle) -> Result<(), String> {
    let state = app.state::<PopupState>();
    let mut inner = state.inner.lock().unwrap();
    inner.geometry = Geometry::default();
    Ok(())
}

/// The page: the user pressed on the title bar or an edge and a move or resize may follow.
#[tauri::command]
pub fn popup_user_change(app: AppHandle) {
    app.state::<PopupState>().inner.lock().unwrap().user_change = true;
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeometryInfo {
    customized: bool,
    user_height: bool,
}

#[tauri::command]
pub fn popup_geometry(app: AppHandle) -> GeometryInfo {
    let g = app.state::<PopupState>().inner.lock().unwrap().geometry;
    GeometryInfo {
        customized: g.position.is_some() || g.height.is_some() || g.user_width,
        user_height: g.height.is_some(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn japanese_only_detection() {
        assert!(is_japanese_only("仕訳の入力画面でエラーが出ています。"));
        assert!(is_japanese_only("UATのAPIはデプロイ済みです。"));
        assert!(!is_japanese_only("Em đã deploy rồi, nhờ anh kiểm tra màn hình 仕訳"));
        assert!(!is_japanese_only("Please check the deploy result today"));
    }

    #[test]
    fn routes_follow_the_users_language() {
        let ja = "確認お願いします。";
        let vi = "Em đã sửa xong rồi ạ.";
        // A Vietnamese user reads Japanese and writes Vietnamese.
        assert_eq!(route(Action::Read, ja, Lang::Vi), (Direction::JaVi, Origin::Chat));
        assert_eq!(route(Action::Write, vi, Lang::Vi), (Direction::ViJa, Origin::Composer));
        assert_eq!(route(Action::Write, ja, Lang::Vi), (Direction::JaVi, Origin::Chat));
        assert_eq!(route(Action::Auto, vi, Lang::Vi), (Direction::ViJa, Origin::Composer));
        // A Japanese user reads Vietnamese and writes Japanese.
        assert_eq!(route(Action::Read, vi, Lang::Ja), (Direction::ViJa, Origin::Chat));
        assert_eq!(route(Action::Write, ja, Lang::Ja), (Direction::JaVi, Origin::Composer));
        assert_eq!(route(Action::Write, vi, Lang::Ja), (Direction::ViJa, Origin::Chat));
        assert_eq!(route(Action::Auto, ja, Lang::Ja), (Direction::JaVi, Origin::Composer));
        assert_eq!(route(Action::Auto, vi, Lang::Ja), (Direction::ViJa, Origin::Chat));
        // Checking Japanese works the same for both; Vietnamese text is translated instead.
        assert_eq!(
            route(Action::Review, ja, Lang::Ja),
            (Direction::ReviewJa, Origin::Composer)
        );
        assert_eq!(route(Action::Review, vi, Lang::Vi), (Direction::ViJa, Origin::Composer));
    }

    #[test]
    fn detects_japanese() {
        assert!(has_japanese("確認しました"));
        assert!(has_japanese("カタカナ"));
        assert!(!has_japanese("Đã xác nhận, cảm ơn"));
    }
}
