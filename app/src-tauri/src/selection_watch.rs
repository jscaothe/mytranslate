//! Notices when the user selects text with the mouse, so the quick toolbar can appear next to it.
//!
//! Low-level mouse and keyboard hooks run on their own thread with a message loop; the hook procedures only
//! forward events through a channel, and a second thread decides. A selection is a left-button drag, or a
//! double/triple click, that started while the pointer was the text I-beam: that is how a chat window shows
//! text under the pointer, and it rules out dragging windows, scrollbars and splitters. Nothing is read from
//! the selection here; text is only copied when the user presses a toolbar button.

use std::sync::OnceLock;
use std::sync::mpsc::{Sender, channel};
use std::time::{Duration, Instant};

use tauri::AppHandle;
use windows::Win32::Foundation::{LPARAM, LRESULT, POINT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::GetDoubleClickTime;
use windows::Win32::UI::WindowsAndMessaging::{
    CURSORINFO, CallNextHookEx, GetCursorInfo, GetMessageW, GetSystemMetrics, HHOOK, IDC_IBEAM, KBDLLHOOKSTRUCT,
    LLKHF_INJECTED, LLMHF_INJECTED, LoadCursorW, MSG, MSLLHOOKSTRUCT, SM_CXDOUBLECLK, SetWindowsHookExW,
    WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYDOWN, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MBUTTONDOWN, WM_MOUSEWHEEL,
    WM_RBUTTONDOWN, WM_SYSKEYDOWN,
};

use crate::quickbar;

/// A drag shorter than this (physical px) is a click, not a selection.
const MIN_DRAG: i32 = 8;
/// Let the app finish updating its selection before the toolbar appears.
const SETTLE: Duration = Duration::from_millis(60);

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
    },
    /// Right/middle click, wheel or a key press: the user moved on.
    Other {
        x: i32,
        y: i32,
        mouse: bool,
    },
}

static EVENTS: OnceLock<Sender<Event>> = OnceLock::new();

/// Starts the hooks and the decision thread. Safe to call once at start-up.
pub fn start(app: &AppHandle) {
    let (tx, rx) = channel::<Event>();
    if EVENTS.set(tx).is_err() {
        return;
    }

    std::thread::Builder::new()
        .name("selection-hooks".into())
        .spawn(|| unsafe {
            let module = GetModuleHandleW(None).ok().map(|m| m.into());
            let mouse = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), module, 0);
            let keys = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), module, 0);
            if mouse.is_err() || keys.is_err() {
                log::warn!("selection hooks unavailable: {mouse:?} {keys:?}");
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
                    Event::LeftUp { x, y } => {
                        let Some((dx, dy, ibeam, _)) = down.take() else {
                            continue;
                        };
                        last_click = Some((x, y, Instant::now()));
                        let dragged = (x - dx).abs() >= MIN_DRAG || (y - dy).abs() >= MIN_DRAG;
                        if ibeam && (dragged || clicks >= 2) && !quickbar::contains(&app, x, y) {
                            std::thread::sleep(SETTLE);
                            quickbar::offer(&app, x, y);
                        }
                    }
                    Event::Other { x, y, mouse } => {
                        if !mouse || !quickbar::contains(&app, x, y) {
                            quickbar::hide(&app);
                        }
                    }
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

unsafe extern "system" fn mouse_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0
        && let Some(tx) = EVENTS.get()
    {
        let data = unsafe { &*(lparam.0 as *const MSLLHOOKSTRUCT) };
        // Our own simulated input is not the user selecting text.
        if data.flags & LLMHF_INJECTED == 0 {
            let POINT { x, y } = data.pt;
            let event = match wparam.0 as u32 {
                WM_LBUTTONDOWN => Some(Event::LeftDown {
                    x,
                    y,
                    ibeam: is_ibeam(),
                }),
                WM_LBUTTONUP => Some(Event::LeftUp { x, y }),
                WM_RBUTTONDOWN | WM_MBUTTONDOWN | WM_MOUSEWHEEL => Some(Event::Other { x, y, mouse: true }),
                _ => None,
            };
            if let Some(e) = event {
                let _ = tx.send(e);
            }
        }
    }
    unsafe { CallNextHookEx(None::<HHOOK>, code, wparam, lparam) }
}

unsafe extern "system" fn keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0
        && matches!(wparam.0 as u32, WM_KEYDOWN | WM_SYSKEYDOWN)
        && let Some(tx) = EVENTS.get()
    {
        let data = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
        if data.flags.0 & LLKHF_INJECTED.0 == 0 {
            let _ = tx.send(Event::Other {
                x: 0,
                y: 0,
                mouse: false,
            });
        }
    }
    unsafe { CallNextHookEx(None::<HHOOK>, code, wparam, lparam) }
}
