//! Reads the user's selection from another app and pastes results back, through the clipboard and simulated
//! keystrokes, the same way a person would. The user's own clipboard content is saved first and put back after,
//! in every format that can be copied byte for byte (text, rich text, HTML, images as DIB, files...).

use std::thread::sleep;
use std::time::{Duration, Instant};

use windows::Win32::Foundation::{HANDLE, HGLOBAL, HWND};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, EnumClipboardFormats, GetClipboardData, GetClipboardSequenceNumber, OpenClipboard,
    RegisterClipboardFormatW, SetClipboardData,
};
use windows::Win32::System::Memory::{GMEM_MOVEABLE, GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock};
use windows::Win32::System::Ole::CF_UNICODETEXT;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBD_EVENT_FLAGS, KEYBDINPUT, KEYEVENTF_KEYUP, MAPVK_VK_TO_VSC,
    MapVirtualKeyW, SendInput, VIRTUAL_KEY, VK_A, VK_C, VK_CONTROL, VK_LMENU, VK_LSHIFT, VK_LWIN, VK_MENU, VK_RMENU,
    VK_RSHIFT, VK_RWIN, VK_SHIFT, VK_V,
};
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, SetForegroundWindow};
use windows::core::{PCWSTR, w};

/// How long a target app gets to put the selection on the clipboard after Ctrl+C.
const COPY_WAIT: Duration = Duration::from_millis(450);
/// In a message box an empty selection is common; this short probe decides quickly whether to select all.
/// Slack and Teams copy within 25-36 ms (measured), so 120 ms leaves a wide margin; a slower app only costs
/// us a select-all.
const SELECTION_PROBE_WAIT: Duration = Duration::from_millis(120);
/// How long a target app gets to read the clipboard after Ctrl+V before the user's content is restored.
const PASTE_SETTLE: Duration = Duration::from_millis(350);

/// Formats that hold GDI handles rather than memory; they cannot be copied as bytes. Windows re-creates
/// CF_BITMAP from CF_DIB on demand, so images survive anyway.
const HANDLE_FORMATS: [u32; 8] = [2, 3, 9, 14, 0x80, 0x82, 0x83, 0x8E];

#[derive(Debug)]
pub enum CaptureError {
    Clipboard(String),
}

impl std::fmt::Display for CaptureError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CaptureError::Clipboard(m) => write!(f, "clipboard: {m}"),
        }
    }
}

/// Copies what is selected in the foreground app. When `select_all_if_empty` says so (the focus is in a chat
/// message box), an empty selection is retried after Ctrl+A. It is asked once the hotkey's keys are released, so
/// the answer can be worked out meanwhile. Returns `None` when nothing could be copied.
pub fn copy_selection(select_all_if_empty: impl FnOnce() -> bool) -> Result<Option<String>, CaptureError> {
    wait_for_modifiers_released(Duration::from_millis(350));
    let select_all_if_empty = select_all_if_empty();
    let saved = Snapshot::take()?;

    let first_wait = if select_all_if_empty {
        SELECTION_PROBE_WAIT
    } else {
        COPY_WAIT
    };
    let mut text = copy_once(first_wait);
    if text.as_deref().is_none_or(|t| t.trim().is_empty()) && select_all_if_empty {
        send_chord(VK_CONTROL, VK_A);
        sleep(Duration::from_millis(30));
        text = copy_once(COPY_WAIT);
    }

    saved.restore()?;
    Ok(text.filter(|t| !t.trim().is_empty()))
}

/// Brings `hwnd` back to the front and pastes `text` over its current selection.
pub fn paste_into(hwnd: isize, text: &str) -> Result<(), CaptureError> {
    let target = HWND(hwnd as *mut _);
    unsafe {
        let _ = SetForegroundWindow(target);
    }
    sleep(Duration::from_millis(80));
    wait_for_modifiers_released(Duration::from_millis(350));

    let saved = Snapshot::take()?;
    set_text(text, true)?;
    send_chord(VK_CONTROL, VK_V);
    sleep(PASTE_SETTLE);
    saved.restore()
}

/// Makes sure the chat window is in front before keys are sent to it (a toolbar click may have moved focus).
pub fn bring_to_front(hwnd: isize) {
    let target = HWND(hwnd as *mut _);
    unsafe {
        if GetForegroundWindow() != target {
            let _ = SetForegroundWindow(target);
            sleep(Duration::from_millis(60));
        }
    }
}

/// Puts `text` on the clipboard for the user to paste themselves (kept, not restored).
pub fn copy_text(text: &str) -> Result<(), CaptureError> {
    set_text(text, false)
}

fn copy_once(wait: Duration) -> Option<String> {
    let before = unsafe { GetClipboardSequenceNumber() };
    send_chord(VK_CONTROL, VK_C);
    let start = Instant::now();
    while start.elapsed() < wait {
        sleep(Duration::from_millis(5));
        if unsafe { GetClipboardSequenceNumber() } != before {
            // The owner may still be writing other formats; give it a moment.
            sleep(Duration::from_millis(20));
            let text = read_text();
            log::info!(
                "clipboard changed {} ms after Ctrl+C, text: {} chars",
                start.elapsed().as_millis(),
                text.as_deref().map_or(0, |t| t.chars().count())
            );
            return text;
        }
    }
    log::info!("clipboard did not change within {wait:?} after Ctrl+C");
    None
}

/// The hotkey's own Ctrl/Alt/Shift are usually still held when it fires. Give the user a moment to let go;
/// `send_chord` releases whatever is still held after that.
fn wait_for_modifiers_released(limit: Duration) {
    let start = Instant::now();
    while start.elapsed() < limit {
        if ![VK_CONTROL, VK_MENU, VK_SHIFT, VK_LWIN, VK_RWIN]
            .into_iter()
            .any(is_down)
        {
            return;
        }
        sleep(Duration::from_millis(10));
    }
}

/// Must run while the hotkey's keys are still down. Windows swallows the hotkey's letter, so the app in front
/// sees Alt pressed and released on its own and opens its menu bar (Notepad, Slack, Office...). A press of an
/// unassigned virtual key in between makes that Alt release harmless, the same trick AutoHotkey uses.
pub fn mask_menu_key() {
    send_keys(&[(VIRTUAL_KEY(0xE8), false), (VIRTUAL_KEY(0xE8), true)]);
}

/// Presses `modifier+key` and nothing else. Any Alt/Shift/Win the user is still holding is released first;
/// otherwise Ctrl+C would arrive as Ctrl+Alt+C, and Ctrl+A as Ctrl+Alt+A, which some apps use as a
/// screenshot shortcut. The Alt release is harmless because `mask_menu_key` already ran.
fn send_chord(modifier: VIRTUAL_KEY, key: VIRTUAL_KEY) {
    let mut keys: Vec<(VIRTUAL_KEY, bool)> = [
        VK_MENU, VK_LMENU, VK_RMENU, VK_SHIFT, VK_LSHIFT, VK_RSHIFT, VK_LWIN, VK_RWIN,
    ]
    .into_iter()
    .filter(|vk| is_down(*vk))
    .map(|vk| (vk, true))
    .collect();
    keys.extend([(modifier, false), (key, false), (key, true), (modifier, true)]);
    send_keys(&keys);
}

fn is_down(vk: VIRTUAL_KEY) -> bool {
    unsafe { GetAsyncKeyState(i32::from(vk.0)) as u16 & 0x8000 != 0 }
}

/// Sends key events like a physical keyboard. The scan code matters: WinUI apps (the new Notepad) and
/// Chromium/Electron apps (Slack, Teams) match shortcuts such as Ctrl+C on it and ignore events without one.
fn send_keys(keys: &[(VIRTUAL_KEY, bool)]) {
    let input = |vk: VIRTUAL_KEY, up: bool| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: unsafe { MapVirtualKeyW(u32::from(vk.0), MAPVK_VK_TO_VSC) } as u16,
                dwFlags: if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    let inputs: Vec<INPUT> = keys.iter().map(|&(vk, up)| input(vk, up)).collect();
    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent as usize != inputs.len() {
        log::warn!(
            "SendInput delivered {sent} of {} key events: {}",
            inputs.len(),
            windows::core::Error::from_thread()
        );
    }
}

struct ClipboardGuard;

impl ClipboardGuard {
    /// Another app may hold the clipboard for a moment; retry briefly.
    fn open() -> Result<Self, CaptureError> {
        for _ in 0..20 {
            if unsafe { OpenClipboard(None) }.is_ok() {
                return Ok(ClipboardGuard);
            }
            sleep(Duration::from_millis(10));
        }
        Err(CaptureError::Clipboard("could not open the clipboard".into()))
    }
}

impl Drop for ClipboardGuard {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseClipboard();
        }
    }
}

fn read_text() -> Option<String> {
    let _guard = ClipboardGuard::open().ok()?;
    unsafe {
        let handle = GetClipboardData(u32::from(CF_UNICODETEXT.0)).ok()?;
        let mem = HGLOBAL(handle.0);
        let ptr = GlobalLock(mem) as *const u16;
        if ptr.is_null() {
            return None;
        }
        let len = GlobalSize(mem) / 2;
        let slice = std::slice::from_raw_parts(ptr, len);
        let end = slice.iter().position(|&c| c == 0).unwrap_or(len);
        let text = String::from_utf16_lossy(&slice[..end]);
        let _ = GlobalUnlock(mem);
        Some(text)
    }
}

/// Sets clipboard text. `transient` marks it so clipboard history and cloud clipboard skip it.
fn set_text(text: &str, transient: bool) -> Result<(), CaptureError> {
    let mut wide: Vec<u16> = text.encode_utf16().collect();
    wide.push(0);
    let bytes = unsafe { std::slice::from_raw_parts(wide.as_ptr() as *const u8, wide.len() * 2) };
    let _guard = ClipboardGuard::open()?;
    unsafe {
        EmptyClipboard().map_err(|e| CaptureError::Clipboard(e.to_string()))?;
        put(u32::from(CF_UNICODETEXT.0), bytes)?;
        if transient {
            for name in [
                w!("ExcludeClipboardContentFromMonitorProcessing"),
                w!("CanIncludeInClipboardHistory"),
            ] {
                let format = registered(name);
                if format != 0 {
                    put(format, &0u32.to_le_bytes())?;
                }
            }
        }
    }
    Ok(())
}

fn registered(name: PCWSTR) -> u32 {
    unsafe { RegisterClipboardFormatW(name) }
}

/// Copies `bytes` into a new global memory block and hands it to the clipboard (which then owns it).
unsafe fn put(format: u32, bytes: &[u8]) -> Result<(), CaptureError> {
    let mem = unsafe { GlobalAlloc(GMEM_MOVEABLE, bytes.len().max(1)) }
        .map_err(|e| CaptureError::Clipboard(e.to_string()))?;
    unsafe {
        let ptr = GlobalLock(mem) as *mut u8;
        if ptr.is_null() {
            return Err(CaptureError::Clipboard("GlobalLock failed".into()));
        }
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len());
        let _ = GlobalUnlock(mem);
        SetClipboardData(format, Some(HANDLE(mem.0))).map_err(|e| CaptureError::Clipboard(e.to_string()))?;
    }
    Ok(())
}

/// Every memory-backed clipboard format, copied out so it can be put back exactly.
struct Snapshot(Vec<(u32, Vec<u8>)>);

impl Snapshot {
    fn take() -> Result<Self, CaptureError> {
        let _guard = ClipboardGuard::open()?;
        let mut items = Vec::new();
        let mut format = 0;
        loop {
            format = unsafe { EnumClipboardFormats(format) };
            if format == 0 {
                break;
            }
            if HANDLE_FORMATS.contains(&format) || (0x300..=0x3FF).contains(&format) {
                continue;
            }
            unsafe {
                let Ok(handle) = GetClipboardData(format) else { continue };
                let mem = HGLOBAL(handle.0);
                let size = GlobalSize(mem);
                let ptr = GlobalLock(mem) as *const u8;
                if ptr.is_null() || size == 0 {
                    continue;
                }
                items.push((format, std::slice::from_raw_parts(ptr, size).to_vec()));
                let _ = GlobalUnlock(mem);
            }
        }
        Ok(Snapshot(items))
    }

    fn restore(self) -> Result<(), CaptureError> {
        let _guard = ClipboardGuard::open()?;
        unsafe {
            EmptyClipboard().map_err(|e| CaptureError::Clipboard(e.to_string()))?;
            for (format, bytes) in &self.0 {
                // A single odd format must not cost the user the rest of their clipboard.
                let _ = put(*format, bytes);
            }
        }
        Ok(())
    }
}
