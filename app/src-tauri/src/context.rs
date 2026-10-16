//! Which app and conversation the user is in, read from the foreground window when a hotkey fires.
//! Only the window title and process name are read; nothing is logged.

use std::collections::HashSet;

use serde::Serialize;
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM};
use windows::Win32::Graphics::Dwm::{DWMWA_CLOAKED, DwmGetWindowAttribute};
use windows::Win32::Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW};
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GW_OWNER, GWL_EXSTYLE, GetClassNameW, GetForegroundWindow, GetWindow, GetWindowLongPtrW,
    GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible, WS_EX_APPWINDOW, WS_EX_TOOLWINDOW,
};
use windows::core::{BOOL, HSTRING, PWSTR, w};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChatApp {
    Slack,
    Teams,
    Other,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Context {
    /// Window handle, kept to paste back into the same window later.
    #[serde(skip)]
    pub hwnd: isize,
    pub exe: String,
    pub app: ChatApp,
    /// Conversation name taken from the title: a channel ("dev-qa", "General") or a chat ("Team Acme").
    pub conversation: String,
    /// What the conversation belongs to, when the title has it: a Slack workspace or a Teams team.
    pub workspace: Option<String>,
    /// The Teams organisation (tenant) the conversation is in, when the title has it.
    pub org: Option<String>,
}

/// Where a window title says the user is.
#[derive(Debug, PartialEq, Eq)]
pub struct Place {
    pub app: ChatApp,
    pub conversation: String,
    pub workspace: Option<String>,
    pub org: Option<String>,
}

pub fn foreground() -> Context {
    unsafe {
        let hwnd = GetForegroundWindow();
        let mut buf = [0u16; 512];
        let n = GetWindowTextW(hwnd, &mut buf);
        let title = String::from_utf16_lossy(&buf[..n.max(0) as usize]);
        let exe = process_name(hwnd).unwrap_or_default();
        let place = parse_title(&exe, &title);
        Context {
            hwnd: hwnd.0 as isize,
            exe,
            app: place.app,
            conversation: place.conversation,
            workspace: place.workspace,
            org: place.org,
        }
    }
}

fn process_name(hwnd: HWND) -> Option<String> {
    process_path(hwnd).and_then(|path| path.rsplit(['\\', '/']).next().map(str::to_string))
}

fn process_path(hwnd: HWND) -> Option<String> {
    unsafe {
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
        let _ = CloseHandle(process);
        ok.then(|| String::from_utf16_lossy(&buf[..len as usize]))
    }
}

/// The apps open on the desktop now, as the taskbar shows them: one window and the executable name per program,
/// in window order (most recently used first).
pub fn app_windows() -> Vec<(isize, String)> {
    unsafe extern "system" fn collect(hwnd: HWND, found: LPARAM) -> BOOL {
        let found = unsafe { &mut *(found.0 as *mut Vec<HWND>) };
        if unsafe { is_app_window(hwnd) } {
            found.push(hwnd);
        }
        true.into()
    }
    let mut found: Vec<HWND> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(collect), LPARAM(&raw mut found as isize));
    }
    let mut seen = HashSet::new();
    found
        .into_iter()
        .filter_map(|hwnd| process_name(hwnd).map(|exe| (hwnd.0 as isize, exe)))
        // Store apps all run in ApplicationFrameHost.exe, which would name none of them.
        .filter(|(_, exe)| !exe.eq_ignore_ascii_case("ApplicationFrameHost.exe"))
        .filter(|(_, exe)| seen.insert(exe.to_ascii_lowercase()))
        .collect()
}

/// A window with a taskbar button: shown, with a title, not owned by another window, not a tool window, not
/// cloaked (a suspended Store app, or one on another virtual desktop), and not the desktop itself.
unsafe fn is_app_window(hwnd: HWND) -> bool {
    unsafe {
        if !IsWindowVisible(hwnd).as_bool() || GetWindowTextLengthW(hwnd) == 0 {
            return false;
        }
        if GetWindow(hwnd, GW_OWNER).is_ok_and(|owner| !owner.is_invalid()) {
            return false;
        }
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        if ex & WS_EX_TOOLWINDOW.0 != 0 && ex & WS_EX_APPWINDOW.0 == 0 {
            return false;
        }
        let mut cloaked = 0u32;
        if DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, (&raw mut cloaked).cast(), 4).is_ok() && cloaked != 0 {
            return false;
        }
        let mut class = [0u16; 32];
        let n = GetClassNameW(hwnd, &mut class);
        String::from_utf16_lossy(&class[..n.max(0) as usize]) != "Progman"
    }
}

/// The name the app in the window goes by, as Windows shows it in Task Manager ("Slack", "Microsoft Edge"):
/// the description in its program file, else the file name without ".exe".
pub fn app_name(hwnd: isize, exe: &str) -> String {
    process_path(HWND(hwnd as *mut _))
        .and_then(|path| file_description(&path))
        .unwrap_or_else(|| exe_stem(exe))
}

fn exe_stem(exe: &str) -> String {
    let lower = exe.to_ascii_lowercase();
    match lower.strip_suffix(".exe") {
        Some(stem) => exe[..stem.len()].to_string(),
        None => exe.to_string(),
    }
}

/// `FileDescription` from a program's version resource, in the first language the file has.
fn file_description(path: &str) -> Option<String> {
    unsafe {
        let file = HSTRING::from(path);
        let size = GetFileVersionInfoSizeW(&file, None);
        if size == 0 {
            return None;
        }
        let mut data = vec![0u8; size as usize];
        GetFileVersionInfoW(&file, None, size, data.as_mut_ptr().cast()).ok()?;
        let mut ptr = std::ptr::null_mut();
        let mut len = 0u32;
        if !VerQueryValueW(
            data.as_ptr().cast(),
            w!("\\VarFileInfo\\Translation"),
            &mut ptr,
            &mut len,
        )
        .as_bool()
            || len < 4
        {
            return None;
        }
        let pair = ptr as *const u16;
        let (lang, codepage) = (*pair, *pair.add(1));
        let key = HSTRING::from(format!("\\StringFileInfo\\{lang:04x}{codepage:04x}\\FileDescription"));
        if !VerQueryValueW(data.as_ptr().cast(), &key, &mut ptr, &mut len).as_bool() || len == 0 {
            return None;
        }
        let text = String::from_utf16_lossy(std::slice::from_raw_parts(ptr as *const u16, len as usize));
        let text = text.trim_end_matches('\0').trim();
        (!text.is_empty()).then(|| text.to_string())
    }
}

/// Reads the app, conversation, workspace and organisation from a window title.
///
/// Slack: `<name> (DM|Channel|...) - <workspace> - Slack`.
/// Teams: `<section> | <team> | <channel> | <organisation> | <account> | Microsoft Teams` for a channel and
/// `<section> | <chat> | <organisation> | <account> | Microsoft Teams` for a chat, where the section is the left
/// rail item (Chat, Teams and channels, チャット...).
pub fn parse_title(exe: &str, title: &str) -> Place {
    let exe = exe.to_lowercase();
    if exe == "slack.exe" {
        let core = title.strip_suffix(" - Slack").unwrap_or(title);
        let mut parts = core.rsplitn(2, " - ");
        let (workspace, name) = match (parts.next(), parts.next()) {
            (Some(ws), Some(name)) => (Some(ws.trim().to_string()), name),
            (Some(only), None) => (None, only),
            _ => (None, core),
        };
        // Drop a trailing kind marker such as "(DM)" or "(Channel)".
        let name = match name.rfind(" (") {
            Some(i) if name.ends_with(')') => &name[..i],
            _ => name,
        };
        return Place {
            app: ChatApp::Slack,
            conversation: name.trim().to_string(),
            workspace,
            org: None,
        };
    }
    if exe == "ms-teams.exe" || exe == "teams.exe" {
        let mut parts: Vec<&str> = title.split(" | ").map(str::trim).collect();
        if parts.last() == Some(&"Microsoft Teams") {
            parts.pop();
        }
        parts.retain(|p| !p.contains('@'));
        let own = |s: &str| Some(s.to_string());
        let (conversation, workspace, org) = match parts.as_slice() {
            [_, team, channel, .., org] => (channel.to_string(), own(team), own(org)),
            [_, chat, org] => (chat.to_string(), None, own(org)),
            [_, chat] | [chat] => (chat.to_string(), None, None),
            _ => (String::new(), None, None),
        };
        return Place {
            app: ChatApp::Teams,
            conversation,
            workspace,
            org,
        };
    }
    Place {
        app: ChatApp::Other,
        conversation: title.trim().to_string(),
        workspace: None,
        org: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Lists what is open on this PC. `cargo test -- --ignored live_app_windows --nocapture`
    #[test]
    #[ignore = "needs a desktop"]
    fn live_app_windows_are_the_taskbar_apps() {
        let apps = app_windows();
        for (hwnd, exe) in &apps {
            eprintln!("{exe}: {}", app_name(*hwnd, exe));
        }
        assert!(!apps.is_empty());
        let mut exes: Vec<_> = apps.iter().map(|(_, e)| e.to_ascii_lowercase()).collect();
        exes.dedup();
        assert_eq!(exes.len(), apps.len());
    }

    #[test]
    fn reads_the_name_windows_shows_for_a_program() {
        let windir = std::env::var("WINDIR").unwrap_or_else(|_| r"C:\Windows".into());
        // "Notepad", or "メモ帳" on a Japanese Windows: the name in the language the file lists first.
        let name = file_description(&format!(r"{windir}\notepad.exe")).unwrap();
        assert!(
            ["Notepad", "メモ帳", "Notepad (Windows)"].contains(&name.as_str()),
            "{name}"
        );
        assert_eq!(file_description(r"C:\no\such.exe"), None);
    }

    #[test]
    fn slack_dm_title() {
        let p = parse_title("Slack.exe", "Team Acme (DM) - Acme Tech - Slack");
        assert_eq!(p.app, ChatApp::Slack);
        assert_eq!(p.conversation, "Team Acme");
        assert_eq!(p.workspace.as_deref(), Some("Acme Tech"));
        assert_eq!(p.org, None);
    }

    #[test]
    fn slack_channel_with_dash_in_name() {
        let p = parse_title("slack.exe", "dev-qa (Channel) - CustomerX - Slack");
        assert_eq!(p.conversation, "dev-qa");
        assert_eq!(p.workspace.as_deref(), Some("CustomerX"));
    }

    #[test]
    fn teams_channel_title() {
        let title =
            "チームとチャネル | ALPHA_PROJECT_BOOK | General | acme.example | someone@acme.example | Microsoft Teams";
        let p = parse_title("ms-teams.exe", title);
        assert_eq!(
            p,
            Place {
                app: ChatApp::Teams,
                conversation: "General".into(),
                workspace: Some("ALPHA_PROJECT_BOOK".into()),
                org: Some("acme.example".into()),
            }
        );
    }

    #[test]
    fn teams_channel_opened_from_chat() {
        let title = "チャット | ACME_ALPHA情報共有 | スターターキット_全般 | ACMECLIENT | someone@example.com | Microsoft Teams";
        let p = parse_title("ms-teams.exe", title);
        assert_eq!(p.conversation, "スターターキット_全般");
        assert_eq!(p.workspace.as_deref(), Some("ACME_ALPHA情報共有"));
        assert_eq!(p.org.as_deref(), Some("ACMECLIENT"));
    }

    #[test]
    fn teams_chat_title() {
        let p = parse_title(
            "ms-teams.exe",
            "Chat | Tanaka Taro | ACMECLIENT | someone@example.com | Microsoft Teams",
        );
        assert_eq!(p.conversation, "Tanaka Taro");
        assert_eq!(p.workspace, None);
        assert_eq!(p.org.as_deref(), Some("ACMECLIENT"));
    }

    #[test]
    fn other_app_keeps_title() {
        let p = parse_title("notepad.exe", "memo.txt - Notepad");
        assert_eq!(p.app, ChatApp::Other);
        assert_eq!(p.conversation, "memo.txt - Notepad");
    }
}
