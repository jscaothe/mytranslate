//! The chat apps MyTranslate is made for, so the getting-started screen can offer to open them.
//! An app counts as installed when its link protocol is registered (both Teams clients register `msteams:`).

use serde::Serialize;

use crate::lang::Lang;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatApp {
    Teams,
    Slack,
}

impl ChatApp {
    const ALL: [ChatApp; 2] = [ChatApp::Teams, ChatApp::Slack];

    fn protocol(self) -> &'static str {
        match self {
            ChatApp::Teams => "msteams",
            ChatApp::Slack => "slack",
        }
    }

    fn uri(self) -> &'static str {
        match self {
            ChatApp::Teams => "msteams:",
            ChatApp::Slack => "slack://open",
        }
    }
}

pub fn installed() -> Vec<ChatApp> {
    ChatApp::ALL
        .into_iter()
        .filter(|a| protocol_registered(a.protocol()))
        .collect()
}

pub fn open(app: ChatApp, lang: Lang) -> Result<(), String> {
    if !protocol_registered(app.protocol()) {
        return Err(lang
            .pick(
                "Chưa cài ứng dụng này trên máy",
                "このアプリはインストールされていません",
            )
            .into());
    }
    shell_open(app.uri(), lang)
}

/// Web pages the app sends the user to while setting up an AI. A fixed list, so the page cannot open any URL.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HelpPage {
    ClaudeCode,
    AnthropicKeys,
    OpenaiKeys,
    GeminiKeys,
}

impl HelpPage {
    fn url(self) -> &'static str {
        match self {
            HelpPage::ClaudeCode => "https://code.claude.com/docs/en/setup",
            HelpPage::AnthropicKeys => "https://platform.claude.com/settings/keys",
            HelpPage::OpenaiKeys => "https://platform.openai.com/api-keys",
            HelpPage::GeminiKeys => "https://aistudio.google.com/apikey",
        }
    }
}

/// Opens the page in the default browser.
pub fn open_help(page: HelpPage, lang: Lang) -> Result<(), String> {
    shell_open(page.url(), lang)
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
fn protocol_registered(protocol: &str) -> bool {
    use windows::Win32::System::Registry::{HKEY, HKEY_CLASSES_ROOT, KEY_READ, RegCloseKey, RegOpenKeyExW};
    use windows::core::PCWSTR;

    let name = wide(protocol);
    let mut key = HKEY::default();
    // SAFETY: `name` is a NUL-terminated UTF-16 string that outlives the call; the key is closed below.
    unsafe {
        if RegOpenKeyExW(HKEY_CLASSES_ROOT, PCWSTR(name.as_ptr()), None, KEY_READ, &mut key).is_err() {
            return false;
        }
        let _ = RegCloseKey(key);
    }
    true
}

#[cfg(not(windows))]
fn protocol_registered(_protocol: &str) -> bool {
    false
}

#[cfg(windows)]
fn shell_open(uri: &str, lang: Lang) -> Result<(), String> {
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    use windows::core::{PCWSTR, w};

    let target = wide(uri);
    // SAFETY: every string is NUL-terminated and lives until the call returns.
    let result = unsafe {
        ShellExecuteW(
            None,
            w!("open"),
            PCWSTR(target.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    // ShellExecute reports success with a value above 32.
    if result.0 as isize > 32 {
        Ok(())
    } else {
        Err(format!(
            "{} ({})",
            lang.pick("Không mở được", "開けません"),
            result.0 as isize
        ))
    }
}

#[cfg(not(windows))]
fn shell_open(_uri: &str, _lang: Lang) -> Result<(), String> {
    Err("Windows only".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_match_the_page() {
        assert_eq!(serde_json::to_value(ChatApp::Teams).unwrap(), "teams");
        let slack: ChatApp = serde_json::from_value("slack".into()).unwrap();
        assert_eq!(slack, ChatApp::Slack);
    }

    #[test]
    fn help_pages_are_the_known_https_pages() {
        let page: HelpPage = serde_json::from_value("gemini_keys".into()).unwrap();
        assert_eq!(page, HelpPage::GeminiKeys);
        assert!(serde_json::from_value::<HelpPage>("https://example.com".into()).is_err());
        for p in [
            HelpPage::ClaudeCode,
            HelpPage::AnthropicKeys,
            HelpPage::OpenaiKeys,
            HelpPage::GeminiKeys,
        ] {
            assert!(p.url().starts_with("https://"));
        }
    }
}
