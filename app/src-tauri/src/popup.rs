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
use crate::history::{self, History};
use crate::lang::{Lang, TextLang};
use crate::placement::{self, Anchor, Rect};
use crate::prompt::Keigo;
use crate::settings::SettingsStore;
use crate::threads::{self, Candidate};

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

/// Where the selected text is, in physical pixels: x is where the pointer was released (a mouse selection) or the
/// left edge of the text (a selection UI Automation reports); top and bottom bound its first and last line.
/// The popup is placed around it instead of around the pointer, which is on the quick toolbar by then or, after a
/// keyboard selection, anywhere.
#[derive(Debug, Clone, Copy)]
pub struct Span {
    pub x: f64,
    pub top: f64,
    pub bottom: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// Translate either way: the text's language decides (Ctrl+Alt+T, the toolbar's Translate button).
    Auto,
    /// Check Japanese the user wrote, usually in the message box (Ctrl+Alt+C).
    Review,
    /// Show how to read selected Japanese, in furigana or hiragana, without translating (the toolbar's button).
    Reading,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Direction {
    JaVi,
    ViJa,
    /// A message in English: read in the user's language, or written in it for the other side.
    EnVi,
    EnJa,
    ReviewJa,
    ReviewVi,
}

impl Direction {
    /// The language of a text to translate; `None` for a review.
    fn source(self) -> Option<TextLang> {
        match self {
            Direction::JaVi => Some(TextLang::Ja),
            Direction::ViJa => Some(TextLang::Vi),
            Direction::EnVi | Direction::EnJa => Some(TextLang::En),
            Direction::ReviewJa | Direction::ReviewVi => None,
        }
    }
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
    /// Whether the text was selected in a box the user can type in: `None` when UI Automation could not tell.
    /// A reply written in the popup replaces such text, whichever way it was translated.
    pub in_message_box: Option<bool>,
    pub app: ChatApp,
    pub conversation: String,
    pub workspace: Option<String>,
    /// `no_selection` or `clipboard` when nothing could be read.
    pub error: Option<String>,
    /// History: the chat window's conversation, and the thread the message most likely belongs to (`None`: a new
    /// one). The app files the translation there and reads the thread's latest messages as context.
    pub conversation_id: Option<i64>,
    pub thread_id: Option<i64>,
    /// The keigo level the user last picked in this conversation: the popup starts from it.
    pub keigo: Option<Keigo>,
    /// The language the user last picked in this conversation's language bar for text in this language: the
    /// popup translates into it instead of the usual way.
    pub target: Option<TextLang>,
    /// Only show how to read the Japanese text; the popup translates it when asked.
    pub reading_only: bool,
}

/// Threads untouched for this long are not considered.
const THREAD_HORIZON_MS: i64 = 14 * 24 * 60 * 60 * 1000;
const MAX_CANDIDATES: usize = 8;
/// Messages per thread compared with the new text.
const CANDIDATE_MESSAGES: usize = 4;

/// Files the text under its chat window's conversation and picks its thread, all locally. A guess the detector is
/// unsure of still goes to its best thread: a wrong one only costs some context, while a new thread loses it all.
fn detect_thread(history: &History, ctx: &Context, text: &str, lang: Lang) -> (Option<i64>, Option<i64>) {
    let app = match ctx.app {
        ChatApp::Slack => "slack",
        ChatApp::Teams => "teams",
        ChatApp::Other => "other",
    };
    let name = match ctx.conversation.trim() {
        "" => lang.pick("Khác", "その他"),
        n => n,
    };
    let conversation = match history.upsert_conversation(
        app,
        ctx.org.as_deref().unwrap_or(""),
        ctx.workspace.as_deref().unwrap_or(""),
        name,
    ) {
        Ok(id) => id,
        Err(e) => {
            log::warn!("history unavailable: {e}");
            return (None, None);
        }
    };
    let now = history::now_ms();
    let threads = history
        .recent_threads(conversation, now - THREAD_HORIZON_MS, MAX_CANDIDATES)
        .unwrap_or_default();
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
    (Some(conversation), d.thread_id)
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
    run(app, action, None, None);
}

/// Reads the selection, places the popup and tells its page what to do. `target` is the chat window when the
/// quick toolbar already knows it (the user selected with the mouse).
pub fn run(app: &AppHandle, action: Action, target: Option<Context>, span: Option<Span>) {
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
        // Where the keyboard focus is decides two things: only a message box is safe to select-all (in the
        // conversation Ctrl+A would grab the whole page), and only a result for the message box replaces text.
        // Asked on its own thread while the user lets go of the hotkey. The same probe then finds where the text
        // is, so a hotkey popup sits next to text selected with the keyboard far from the pointer.
        let probe = FocusProbe::start(from_toolbar, span.is_none());
        let mut in_message_box = None;
        let (text, error) = match capture::copy_selection(|| {
            in_message_box = probe.editable();
            // A mouse selection is never extended.
            !from_toolbar && in_message_box == Some(true)
        }) {
            Ok(Some(t)) => (t, None),
            Ok(None) => (String::new(), Some("no_selection".to_string())),
            Err(e) => {
                log::warn!("capture failed: {e}");
                (String::new(), Some("clipboard".to_string()))
            }
        };
        log::info!("captured {} chars, error: {error:?}", text.chars().count());
        let span = span.or_else(|| probe.span());
        let lang = app.state::<SettingsStore>().language();
        let (direction, origin) = route(action, &text, lang, in_message_box);

        let history = app.state::<History>();
        let (conversation_id, thread_id) = if error.is_none() {
            detect_thread(&history, &ctx, &text, lang)
        } else {
            (None, None)
        };
        let conversation = conversation_id.and_then(|id| history.conversation(id).ok().flatten());
        let keigo = conversation.as_ref().and_then(|c| c.keigo);
        let target = conversation
            .zip(direction.source())
            .and_then(|(c, source)| c.targets.get(&source).copied());

        let reading_only = action == Action::Reading && has_japanese(&text);
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
            in_message_box,
            app: ctx.app,
            conversation: ctx.conversation,
            workspace: ctx.workspace,
            error,
            conversation_id,
            thread_id,
            keigo,
            target,
            reading_only,
        };
        if let Err(e) = show(&app, payload, span) {
            log::warn!("could not show the popup: {e}");
        }
    });
}

/// Longest wait, from the hotkey, for the chat app to say where the text is; past it the popup opens at the
/// pointer.
const SPAN_TIMEOUT: Duration = Duration::from_millis(250);

/// Asks UI Automation, on its own thread, whether the keyboard focus is in a message box and then where the text
/// in the focused control is, so a slow or hung app cannot hold the popup for long.
struct FocusProbe {
    started: Instant,
    editable: std::sync::mpsc::Receiver<Option<bool>>,
    span: std::sync::mpsc::Receiver<Option<Span>>,
}

impl FocusProbe {
    /// `from_toolbar`: the text was selected with the mouse and is never extended. `want_span`: the popup's place
    /// is not known yet (a hotkey, not the toolbar).
    fn start(from_toolbar: bool, want_span: bool) -> Self {
        let (editable_tx, editable) = std::sync::mpsc::channel();
        let (span_tx, span) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let started = Instant::now();
            let probe = crate::ui_selection::SelectionProbe::new();
            let is_editable = probe.as_ref().and_then(|p| p.focus_is_editable());
            log::info!("focus editable: {is_editable:?} ({} ms)", started.elapsed().as_millis());
            let _ = editable_tx.send(is_editable);
            if want_span {
                // About to be selected with select-all: the control itself is the place.
                let whole_control = !from_toolbar && is_editable == Some(true);
                let _ = span_tx.send(probe.and_then(|p| p.focused_text_span(whole_control)));
            }
        });
        Self {
            started: Instant::now(),
            editable,
            span,
        }
    }

    /// Waits for the answer: copying the text depends on it.
    fn editable(&self) -> Option<bool> {
        self.editable.recv().ok().flatten()
    }

    fn span(&self) -> Option<Span> {
        let left = SPAN_TIMEOUT.saturating_sub(self.started.elapsed());
        let span = self.span.recv_timeout(left).ok().flatten();
        log::info!("text span {span:?} after {} ms", self.started.elapsed().as_millis());
        span
    }
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
        // Reading or writing, a translation has the keigo choice: in its footer, or in the reply's.
        placement::auto_width(&payload.text, payload.direction.source().is_some())
    };
    // A result the user sends shows a second block: the reading back, or the suggestion's meaning.
    let with_back = !matches!(payload.direction, Direction::JaVi | Direction::EnVi);
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

/// Which way to translate, and where the result goes. The text's language decides the way. A result in the other
/// side's language for text from the message box replaces it (the user is writing); anything else is only shown
/// (the user is reading). `in_message_box` is `None` when UI Automation could not tell: then the language alone
/// decides, as text in the user's own language is usually what they are writing.
pub fn route(action: Action, text: &str, lang: Lang, in_message_box: Option<bool>) -> (Direction, Origin) {
    let english = |to: Lang| match to {
        Lang::Vi => Direction::EnVi,
        Lang::Ja => Direction::EnJa,
    };
    let direction = match action {
        // Reading Japanese is reading it, wherever it was selected.
        Action::Reading if has_japanese(text) => return (Direction::JaVi, Origin::Chat),
        Action::Auto | Action::Reading if is_mostly_japanese(text) => Direction::JaVi,
        // English the user is writing goes to the other side; English they read comes into their language.
        // Without any Japanese the reading button translates, like the translate button.
        Action::Auto | Action::Reading if is_english(text) && in_message_box != Some(false) => english(lang.other()),
        Action::Auto | Action::Reading if is_english(text) => english(lang),
        Action::Auto | Action::Reading => Direction::ViJa,
        // A review checks the text in its own language, whichever the user's is.
        Action::Review if is_mostly_japanese(text) => Direction::ReviewJa,
        Action::Review => Direction::ReviewVi,
    };
    let write = match lang {
        Lang::Vi => Direction::ViJa,
        Lang::Ja => Direction::JaVi,
    };
    let writing = direction == write
        || direction == english(lang.other())
        || matches!(direction, Direction::ReviewJa | Direction::ReviewVi);
    let origin = if writing && in_message_box != Some(false) {
        Origin::Composer
    } else {
        Origin::Chat
    };
    (direction, origin)
}

/// More Japanese than Latin: Japanese characters against Latin words. A Vietnamese message naming a Japanese
/// term (仕訳) stays Vietnamese; Japanese with a few English words (API, UAT, file names) stays Japanese.
pub fn is_mostly_japanese(text: &str) -> bool {
    let japanese = text.chars().filter(|c| is_japanese_char(*c)).count();
    let latin_words = text
        .split(|c: char| !(c.is_ascii_alphabetic() || is_vietnamese_letter(c)))
        .filter(|w| !w.is_empty())
        .count();
    japanese > 0 && japanese >= latin_words
}

/// Common English words that are not also Vietnamese written without diacritics ("do", "an", "to", "me") nor
/// English that Vietnamese chats mix in ("check", "fix", "ok").
const ENGLISH_WORDS: &[&str] = &[
    "the",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "will",
    "would",
    "should",
    "could",
    "have",
    "has",
    "had",
    "this",
    "that",
    "these",
    "those",
    "with",
    "from",
    "for",
    "and",
    "of",
    "it",
    "its",
    "you",
    "your",
    "we",
    "our",
    "they",
    "their",
    "he",
    "she",
    "i",
    "my",
    "please",
    "thanks",
    "thank",
    "what",
    "when",
    "where",
    "which",
    "who",
    "why",
    "how",
    "not",
    "if",
    "at",
    "by",
    "about",
    "just",
    "also",
    "there",
    "here",
    "all",
    "any",
    "some",
    "let",
    "know",
    "need",
    "want",
    "today",
    "tomorrow",
    "yesterday",
    "sorry",
    "morning",
    "good",
    "great",
    "does",
    "did",
    "but",
    "or",
    "into",
    "after",
    "before",
    "yet",
    "still",
    "already",
    "us",
    "them",
];

/// Latin text without Vietnamese diacritics in which at least a third of the words are common English words. A
/// Vietnamese message always has diacritics; without them it rarely uses these words.
pub fn is_english(text: &str) -> bool {
    if text.chars().any(|c| is_japanese_char(c) || is_vietnamese_letter(c)) {
        return false;
    }
    let words: Vec<String> = text
        .split(|c: char| !(c.is_ascii_alphabetic() || c == '\''))
        .filter(|w| w.chars().any(|c| c.is_ascii_alphabetic()))
        .map(|w| w.trim_matches('\'').to_ascii_lowercase())
        .collect();
    let common = words.iter().filter(|w| ENGLISH_WORDS.contains(&w.as_str())).count();
    common > 0 && common * 3 >= words.len()
}

/// Latin letters with Vietnamese diacritics (Latin-1 Supplement, Latin Extended-A/B and Extended Additional).
fn is_vietnamese_letter(c: char) -> bool {
    !c.is_ascii() && matches!(c, '\u{00C0}'..='\u{01B0}' | '\u{1EA0}'..='\u{1EF9}')
}

/// Any kana or kanji at all: something to read.
pub fn has_japanese(text: &str) -> bool {
    text.chars().any(is_japanese_char)
}

fn is_japanese_char(c: char) -> bool {
    matches!(c, '\u{3040}'..='\u{30ff}' | '\u{4e00}'..='\u{9fff}')
}

#[tauri::command]
pub fn popup_hide(app: AppHandle) {
    log::info!("popup hidden");
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.hide();
    }
}

/// Replaces the selection in the window the text came from. With `keep`, the text also stays on the clipboard,
/// for when it is not known whether the selection can be typed over.
#[tauri::command]
pub async fn popup_apply(app: AppHandle, text: String, keep: Option<bool>) -> Result<(), String> {
    popup_hide(app.clone());
    let hwnd = app.state::<PopupState>().inner.lock().unwrap().target_hwnd;
    let keep = keep.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || capture::paste_into(hwnd, &text, keep))
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
    fn mostly_japanese_detection() {
        assert!(is_mostly_japanese("仕訳の入力画面でエラーが出ています。"));
        assert!(is_mostly_japanese(
            "UATのAPIはデプロイ済みです。Nguyễnさんに確認します。"
        ));
        assert!(!is_mostly_japanese(
            "Em đã deploy rồi, nhờ anh kiểm tra màn hình 仕訳 giúp em nhé"
        ));
        assert!(!is_mostly_japanese("Please check the deploy result today"));
    }

    #[test]
    fn the_reading_button_reads_japanese_anywhere_and_translates_anything_else() {
        let mixed = "Em sẽ sửa màn hình 仕訳 nhé";
        assert_eq!(
            route(Action::Reading, mixed, Lang::Vi, Some(true)),
            (Direction::JaVi, Origin::Chat)
        );
        assert_eq!(
            route(Action::Reading, "Em đã sửa xong rồi ạ.", Lang::Vi, Some(true)),
            (Direction::ViJa, Origin::Composer)
        );
    }

    #[test]
    fn english_detection() {
        assert!(is_english("Please check the deploy result today"));
        assert!(is_english("Thanks!"));
        assert!(is_english("Can you review my PR when you have time?"));
        // Vietnamese, with or without diacritics, and mixed-in English stays Vietnamese.
        assert!(!is_english("Em đã deploy rồi, nhờ anh check giúp em"));
        assert!(!is_english("em deploy xong roi, anh check giup em nhe"));
        assert!(!is_english("OK"));
        assert!(!is_english("確認お願いします。"));
    }

    #[test]
    fn english_is_read_in_the_users_language_or_written_to_the_other_side() {
        let en = "Please check the PR.";
        assert_eq!(
            route(Action::Auto, en, Lang::Vi, Some(false)),
            (Direction::EnVi, Origin::Chat)
        );
        assert_eq!(
            route(Action::Auto, en, Lang::Vi, Some(true)),
            (Direction::EnJa, Origin::Composer)
        );
        assert_eq!(
            route(Action::Auto, en, Lang::Ja, Some(false)),
            (Direction::EnJa, Origin::Chat)
        );
        assert_eq!(
            route(Action::Auto, en, Lang::Ja, None),
            (Direction::EnVi, Origin::Composer)
        );
    }

    #[test]
    fn one_key_translates_either_way_and_replaces_only_what_the_user_writes() {
        let ja = "確認お願いします。";
        let vi = "Em đã sửa xong rồi ạ.";
        let (message_box, chat, unknown) = (Some(true), Some(false), None);
        // A Vietnamese user reads Japanese and writes Vietnamese.
        assert_eq!(route(Action::Auto, ja, Lang::Vi, chat), (Direction::JaVi, Origin::Chat));
        assert_eq!(
            route(Action::Auto, vi, Lang::Vi, message_box),
            (Direction::ViJa, Origin::Composer)
        );
        assert_eq!(
            route(Action::Auto, vi, Lang::Vi, unknown),
            (Direction::ViJa, Origin::Composer)
        );
        // A Vietnamese colleague's message is only shown in Japanese; Japanese in the box is read, not replaced.
        assert_eq!(route(Action::Auto, vi, Lang::Vi, chat), (Direction::ViJa, Origin::Chat));
        assert_eq!(
            route(Action::Auto, ja, Lang::Vi, message_box),
            (Direction::JaVi, Origin::Chat)
        );
        // A Japanese user reads Vietnamese and writes Japanese.
        assert_eq!(route(Action::Auto, vi, Lang::Ja, chat), (Direction::ViJa, Origin::Chat));
        assert_eq!(
            route(Action::Auto, ja, Lang::Ja, message_box),
            (Direction::JaVi, Origin::Composer)
        );
        // A review checks the text in its own language, for both users.
        assert_eq!(
            route(Action::Review, ja, Lang::Ja, message_box),
            (Direction::ReviewJa, Origin::Composer)
        );
        assert_eq!(
            route(Action::Review, ja, Lang::Vi, chat),
            (Direction::ReviewJa, Origin::Chat)
        );
        assert_eq!(
            route(Action::Review, vi, Lang::Vi, message_box),
            (Direction::ReviewVi, Origin::Composer)
        );
        assert_eq!(
            route(Action::Review, vi, Lang::Ja, chat),
            (Direction::ReviewVi, Origin::Chat)
        );
    }
}
