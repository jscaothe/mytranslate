//! Which app and conversation the user is in, read from the foreground window when a hotkey fires.
//! Only the window title and process name are read; nothing is logged.

use serde::Serialize;
use windows::Win32::Foundation::{CloseHandle, HWND};
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId};
use windows::core::PWSTR;

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
    /// Conversation name taken from the title, e.g. "Team Acme" or "#dev-qa".
    pub conversation: String,
    /// Workspace or organisation, when the title has one.
    pub workspace: Option<String>,
}

pub fn foreground() -> Context {
    unsafe {
        let hwnd = GetForegroundWindow();
        let mut buf = [0u16; 512];
        let n = GetWindowTextW(hwnd, &mut buf);
        let title = String::from_utf16_lossy(&buf[..n.max(0) as usize]);
        let exe = process_name(hwnd).unwrap_or_default();
        let (app, conversation, workspace) = parse_title(&exe, &title);
        Context {
            hwnd: hwnd.0 as isize,
            exe,
            app,
            conversation,
            workspace,
        }
    }
}

fn process_name(hwnd: HWND) -> Option<String> {
    unsafe {
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
        let _ = CloseHandle(process);
        if !ok {
            return None;
        }
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        path.rsplit(['\\', '/']).next().map(str::to_string)
    }
}

/// Turns a window title into (app, conversation, workspace).
///
/// Slack: `<name> (DM|Channel|...) - <workspace> - Slack`.
/// Teams: `<section> | <conversation> | ... | <organisation> | <account> | Microsoft Teams`, where the section is
/// the left rail item (Chat, Activity, チャット...).
pub fn parse_title(exe: &str, title: &str) -> (ChatApp, String, Option<String>) {
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
        return (ChatApp::Slack, name.trim().to_string(), workspace);
    }
    if exe == "ms-teams.exe" || exe == "teams.exe" {
        let mut parts: Vec<&str> = title.split(" | ").map(str::trim).collect();
        if parts.last() == Some(&"Microsoft Teams") {
            parts.pop();
        }
        parts.retain(|p| !p.contains('@'));
        let conversation = parts.get(1).or(parts.first()).copied().unwrap_or("").to_string();
        let workspace = if parts.len() > 2 {
            parts.last().map(|s| s.to_string())
        } else {
            None
        };
        return (ChatApp::Teams, conversation, workspace);
    }
    (ChatApp::Other, title.trim().to_string(), None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slack_dm_title() {
        let (app, name, ws) = parse_title("Slack.exe", "Team Acme (DM) - Acme Tech - Slack");
        assert_eq!(app, ChatApp::Slack);
        assert_eq!(name, "Team Acme");
        assert_eq!(ws.as_deref(), Some("Acme Tech"));
    }

    #[test]
    fn slack_channel_with_dash_in_name() {
        let (_, name, ws) = parse_title("slack.exe", "dev-qa (Channel) - CustomerX - Slack");
        assert_eq!(name, "dev-qa");
        assert_eq!(ws.as_deref(), Some("CustomerX"));
    }

    #[test]
    fn teams_japanese_ui_title() {
        let title = "チャット | ACME_ALPHA情報共有 | スターターキット_全般 | ACMECLIENT | someone@example.com | Microsoft Teams";
        let (app, name, ws) = parse_title("ms-teams.exe", title);
        assert_eq!(app, ChatApp::Teams);
        assert_eq!(name, "ACME_ALPHA情報共有");
        assert_eq!(ws.as_deref(), Some("ACMECLIENT"));
    }

    #[test]
    fn other_app_keeps_title() {
        let (app, name, _) = parse_title("notepad.exe", "memo.txt - Notepad");
        assert_eq!(app, ChatApp::Other);
        assert_eq!(name, "memo.txt - Notepad");
    }
}
