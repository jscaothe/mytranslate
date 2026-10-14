//! Notices when the user selects text with the mouse or with Ctrl+A, so the quick toolbar can appear next to it.
//!
//! Low-level mouse and keyboard hooks run on their own thread with a message loop; the hook procedures only
//! forward events through a channel, and a second thread decides. A selection is a left-button drag, or a double/triple click,
//! with the text I-beam pointer at press or release (Teams shows it only while selecting); without it, UI
//! Automation is asked whether text got selected. That rules out dragging windows, scrollbars and splitters.
//! Ctrl+A shows the toolbar only when UI Automation finds text selected in a focused box the user types in, so
//! selecting all files in Explorer, an empty message box, or a whole chat page (Ctrl+A in Slack's conversation)
//! shows nothing.
//! Nothing is read from the selection here; text is only copied when the user presses a toolbar button.
//! The toolbar stays until the next click outside it or the next key: a user who selected all to delete or type
//! over it is not kept waiting. The keyboard hook only tells Ctrl+A apart from any other key; it never records
//! which keys are pressed.

use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{Sender, channel};
use std::time::{Duration, Instant};

use tauri::AppHandle;
use windows::Win32::Foundation::{LPARAM, LRESULT, POINT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, GetDoubleClickTime, VIRTUAL_KEY, VK_A, VK_CONTROL, VK_LCONTROL, VK_LMENU, VK_LSHIFT, VK_LWIN,
    VK_MENU, VK_RCONTROL, VK_RMENU, VK_RSHIFT, VK_RWIN, VK_SHIFT,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CURSORINFO, CallNextHookEx, GetCursorInfo, GetMessageW, GetSystemMetrics, HHOOK, IDC_IBEAM, KBDLLHOOKSTRUCT,
    LLKHF_INJECTED, LLMHF_INJECTED, LoadCursorW, MSG, MSLLHOOKSTRUCT, SM_CXDOUBLECLK, SetWindowsHookExW,
    WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYDOWN, WM_KEYUP, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MBUTTONDOWN, WM_RBUTTONDOWN,
    WM_SYSKEYDOWN, WM_SYSKEYUP,
};

use crate::quickbar;
use crate::ui_selection::SelectionProbe;

/// A drag shorter than this (physical px) is a click, not a selection.
const MIN_DRAG: i32 = 8;
/// Let the app finish updating its selection before the toolbar appears.
const SETTLE: Duration = Duration::from_millis(60);
/// After Ctrl+A: a little longer, as some apps redraw before UI Automation sees the new selection.
const KEY_SETTLE: Duration = Duration::from_millis(90);

#[derive(Debug, Clone, Copy)]
enum Event {
    LeftDown {
        x: i32,
        y: i32,
        ibeam: bool,
    },
    LeftUp {
        x: i32,
        y: i32,
        /// Some apps (Teams) show the I-beam only while text is being selected, not before.
        ibeam: bool,
    },
    /// Right or middle click: like a left click elsewhere, the user moved on.
    OtherClick {
        x: i32,
        y: i32,
    },
    /// Ctrl+A, the `seq`th key pressed: the toolbar may appear if no other key follows before it is shown.
    SelectAll {
        seq: u64,
    },
    /// Any other key: the user moved on.
    Key,
}

static EVENTS: OnceLock<Sender<Event>> = OnceLock::new();
/// Test hook: with `MYTRANSLATE_TEST_INJECTED_MOUSE=1`, simulated mouse input counts as the user's, so an
/// automated end-to-end test can select text in a real chat app. Off in normal use.
static ACCEPT_INJECTED_MOUSE: OnceLock<bool> = OnceLock::new();
/// The same for simulated keys, with `MYTRANSLATE_TEST_INJECTED_KEYS=1`. Off in normal use, where the keys this
/// app simulates itself (Ctrl+A, Ctrl+C, Ctrl+V while copying and pasting) must not count.
static ACCEPT_INJECTED_KEYS: OnceLock<bool> = OnceLock::new();
/// Counts the keys pressed (not which ones), so a toolbar about to appear after Ctrl+A can tell another key came.
static KEY_SEQ: AtomicU64 = AtomicU64::new(0);
/// Ctrl+A is held down: Windows repeats the key press, which is not a new Ctrl+A.
static SELECT_ALL_HELD: AtomicBool = AtomicBool::new(false);

/// Starts the hooks and the decision thread. Safe to call once at start-up.
pub fn start(app: &AppHandle) {
    let (tx, rx) = channel::<Event>();
    if EVENTS.set(tx).is_err() {
        return;
    }
    let accept = std::env::var("MYTRANSLATE_TEST_INJECTED_MOUSE").is_ok_and(|v| v == "1");
    if accept {
        log::warn!("test mode: simulated mouse input can show the quick toolbar");
    }
    let _ = ACCEPT_INJECTED_MOUSE.set(accept);
    let accept_keys = std::env::var("MYTRANSLATE_TEST_INJECTED_KEYS").is_ok_and(|v| v == "1");
    if accept_keys {
        log::warn!("test mode: simulated keys can show the quick toolbar");
    }
    let _ = ACCEPT_INJECTED_KEYS.set(accept_keys);

    std::thread::Builder::new()
        .name("selection-hooks".into())
        .spawn(|| unsafe {
            let module = GetModuleHandleW(None).ok().map(|m| m.into());
            let mouse = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), module, 0);
            if let Err(e) = &mouse {
                log::warn!("selection hook unavailable: {e}");
            }
            let keyboard = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), module, 0);
            if let Err(e) = &keyboard {
                log::warn!("Ctrl+A hook unavailable: {e}");
            }
            if mouse.is_ok() && keyboard.is_ok() {
                log::debug!("selection hooks installed");
            }
            // Low-level hooks are called through this thread's message loop.
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {}
        })
        .expect("spawn selection hook thread");

    let app = app.clone();
    std::thread::Builder::new()
        .name("selection-watch".into())
        .spawn(move || {
            let double_click = Duration::from_millis(u64::from(unsafe { GetDoubleClickTime() }));
            let probe = SelectionProbe::new();
            let slop = unsafe { GetSystemMetrics(SM_CXDOUBLECLK) }.max(4);
            let mut down: Option<(i32, i32, bool, Instant)> = None;
            let mut last_click: Option<(i32, i32, Instant)> = None;
            let mut clicks = 0u32;
            for event in rx {
                match event {
                    Event::LeftDown { x, y, ibeam } => {
                        // Clicking the toolbar itself must not hide it; anything else does.
                        if !quickbar::contains(&app, x, y) {
                            quickbar::hide(&app);
                        }
                        let now = Instant::now();
                        clicks = match last_click {
                            Some((px, py, at))
                                if now - at <= double_click && (px - x).abs() <= slop && (py - y).abs() <= slop =>
                            {
                                clicks + 1
                            }
                            _ => 1,
                        };
                        down = Some((x, y, ibeam, now));
                    }
                    Event::LeftUp { x, y, ibeam: ibeam_up } => {
                        let Some((dx, dy, ibeam_down, _)) = down.take() else {
                            continue;
                        };
                        let ibeam = ibeam_down || ibeam_up;
                        last_click = Some((x, y, Instant::now()));
                        let dragged = (x - dx).abs() >= MIN_DRAG || (y - dy).abs() >= MIN_DRAG;
                        if dragged || clicks >= 2 {
                            log::debug!("selection gesture: ibeam {ibeam}, dragged {dragged}, clicks {clicks}");
                        }
                        if (dragged || clicks >= 2) && !quickbar::contains(&app, x, y) {
                            std::thread::sleep(SETTLE);
                            // Without the I-beam (Teams shows an arrow over messages), ask UI Automation whether
                            // text really got selected, so dragging a window or a scrollbar shows nothing.
                            let selected = ibeam
                                || (quickbar::allowed_in_foreground(&app)
                                    && probe.as_ref().is_some_and(|p| p.has_selection_at(x, y)));
                            if !ibeam {
                                log::debug!("selection without I-beam: text selected {selected}");
                            }
                            if selected {
                                quickbar::offer(&app, x, y, dy);
                            }
                        }
                    }
                    Event::OtherClick { x, y } => {
                        if !quickbar::contains(&app, x, y) {
                            quickbar::hide(&app);
                        }
                    }
                    Event::SelectAll { seq } => {
                        quickbar::hide(&app);
                        std::thread::sleep(KEY_SETTLE);
                        let no_key_since = || KEY_SEQ.load(Ordering::Relaxed) == seq;
                        if !no_key_since() || !quickbar::allowed_in_foreground(&app) {
                            continue;
                        }
                        let span = probe.as_ref().and_then(|p| p.focused_selection_span());
                        log::debug!("Ctrl+A: text selected {}", span.is_some());
                        // Asking UI Automation takes a moment; a key pressed meanwhile means the user moved on.
                        if let Some(span) = span
                            && no_key_since()
                        {
                            quickbar::offer_span(&app, span);
                        }
                    }
                    Event::Key => quickbar::hide(&app),
                }
            }
        })
        .expect("spawn selection watch thread");
}

fn is_ibeam() -> bool {
    unsafe {
        let mut info = CURSORINFO {
            cbSize: std::mem::size_of::<CURSORINFO>() as u32,
            ..Default::default()
        };
        let Ok(ibeam) = LoadCursorW(None, IDC_IBEAM) else {
            return false;
        };
        GetCursorInfo(&mut info).is_ok() && info.hCursor == ibeam
    }
}

fn is_down(key: VIRTUAL_KEY) -> bool {
    unsafe { GetAsyncKeyState(i32::from(key.0)) < 0 }
}

fn is_modifier(vk: u32) -> bool {
    [
        VK_CONTROL,
        VK_LCONTROL,
        VK_RCONTROL,
        VK_SHIFT,
        VK_LSHIFT,
        VK_RSHIFT,
        VK_MENU,
        VK_LMENU,
        VK_RMENU,
        VK_LWIN,
        VK_RWIN,
    ]
    .iter()
    .any(|k| u32::from(k.0) == vk)
}

unsafe extern "system" fn keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0
        && let Some(tx) = EVENTS.get()
    {
        let data = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
        let vk = data.vkCode;
        // Our own simulated keys (copying, pasting) are not the user's.
        let from_user = data.flags.0 & LLKHF_INJECTED.0 == 0 || ACCEPT_INJECTED_KEYS.get() == Some(&true);
        match wparam.0 as u32 {
            WM_KEYUP | WM_SYSKEYUP if vk == u32::from(VK_A.0) => SELECT_ALL_HELD.store(false, Ordering::Relaxed),
            WM_KEYDOWN | WM_SYSKEYDOWN if from_user && !is_modifier(vk) => {
                let select_all = vk == u32::from(VK_A.0)
                    && is_down(VK_CONTROL)
                    && ![VK_MENU, VK_SHIFT, VK_LWIN, VK_RWIN].into_iter().any(is_down);
                // A held Ctrl+A repeats; only its first press counts, and the repeats are not "another key".
                if !(select_all && SELECT_ALL_HELD.swap(true, Ordering::Relaxed)) {
                    let seq = KEY_SEQ.fetch_add(1, Ordering::Relaxed) + 1;
                    let _ = tx.send(if select_all {
                        Event::SelectAll { seq }
                    } else {
                        Event::Key
                    });
                }
            }
            _ => {}
        }
    }
    unsafe { CallNextHookEx(None::<HHOOK>, code, wparam, lparam) }
}

unsafe extern "system" fn mouse_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0
        && let Some(tx) = EVENTS.get()
    {
        let data = unsafe { &*(lparam.0 as *const MSLLHOOKSTRUCT) };
        // Our own simulated input is not the user selecting text.
        if data.flags & LLMHF_INJECTED == 0 || ACCEPT_INJECTED_MOUSE.get() == Some(&true) {
            let POINT { x, y } = data.pt;
            let event = match wparam.0 as u32 {
                WM_LBUTTONDOWN => Some(Event::LeftDown {
                    x,
                    y,
                    ibeam: is_ibeam(),
                }),
                WM_LBUTTONUP => Some(Event::LeftUp {
                    x,
                    y,
                    ibeam: is_ibeam(),
                }),
                WM_RBUTTONDOWN | WM_MBUTTONDOWN => Some(Event::OtherClick { x, y }),
                _ => None,
            };
            if let Some(e) = event {
                let _ = tx.send(e);
            }
        }
    }
    unsafe { CallNextHookEx(None::<HHOOK>, code, wparam, lparam) }
}
