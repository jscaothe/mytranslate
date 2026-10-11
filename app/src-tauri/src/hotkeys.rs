//! Global hotkeys, registered from the user's settings and re-registered whenever they change.

use std::str::FromStr;
use std::sync::Mutex;

use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::popup;
use crate::settings::{Hotkeys, SettingsStore};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HotkeyAction {
    Popup(popup::Action),
    ShowMain,
}

#[derive(Default)]
pub struct HotkeyState {
    active: Mutex<Vec<(Shortcut, HotkeyAction)>>,
}

impl HotkeyState {
    pub fn action_for(&self, shortcut: &Shortcut) -> Option<HotkeyAction> {
        self.active
            .lock()
            .unwrap()
            .iter()
            .find(|(s, _)| s == shortcut)
            .map(|(_, a)| *a)
    }
}

/// Parses the page's "Ctrl+Alt+J" format. The page writes the Windows key as "Win"; the plugin calls it "Super".
pub fn parse(combo: &str) -> Option<Shortcut> {
    let normalised = combo
        .split('+')
        .map(|part| {
            if part.eq_ignore_ascii_case("win") {
                "Super"
            } else {
                part
            }
        })
        .collect::<Vec<_>>()
        .join("+");
    Shortcut::from_str(&normalised).ok()
}

fn wanted(keys: &Hotkeys, paused: bool) -> Vec<(String, HotkeyAction)> {
    let mut out = vec![(keys.main.clone(), HotkeyAction::ShowMain)];
    // Pausing stops the translation hotkeys only; the main window must stay reachable.
    if !paused {
        out.extend([
            (keys.ja_vi.clone(), HotkeyAction::Popup(popup::Action::Read)),
            (keys.vi_ja.clone(), HotkeyAction::Popup(popup::Action::Write)),
            (keys.auto.clone(), HotkeyAction::Popup(popup::Action::Auto)),
            (keys.review.clone(), HotkeyAction::Popup(popup::Action::Review)),
        ]);
    }
    out
}

/// Registers exactly the hotkeys the settings ask for. Returns the combinations that could not be registered
/// (malformed, or already owned by another app).
pub fn apply(app: &AppHandle) -> Vec<String> {
    let store = app.state::<SettingsStore>();
    let state = app.state::<HotkeyState>();
    let shortcuts = app.global_shortcut();
    let _ = shortcuts.unregister_all();

    let mut active = Vec::new();
    let mut failed = Vec::new();
    for (combo, action) in wanted(&store.hotkeys(), store.hotkeys_paused()) {
        match parse(&combo) {
            Some(shortcut) => match shortcuts.register(shortcut) {
                Ok(()) => active.push((shortcut, action)),
                Err(e) => {
                    log::warn!("could not register {combo}: {e}");
                    failed.push(combo);
                }
            },
            None => {
                log::warn!("invalid hotkey {combo}");
                failed.push(combo);
            }
        }
    }
    log::info!(
        "hotkeys {}: {} active, {} failed",
        if store.hotkeys_paused() { "paused" } else { "on" },
        active.len(),
        failed.len()
    );
    *state.active.lock().unwrap() = active;
    failed
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri_plugin_global_shortcut::{Code, Modifiers};

    #[test]
    fn parses_page_format() {
        let s = parse("Ctrl+Alt+J").unwrap();
        assert_eq!(s, Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyJ));
        assert_eq!(
            parse("Ctrl+Win+T").unwrap(),
            Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SUPER), Code::KeyT)
        );
        assert!(parse("Ctrl+").is_none());
    }

    #[test]
    fn pausing_keeps_the_main_window_hotkey() {
        let keys = Hotkeys::default();
        let paused = wanted(&keys, true);
        assert_eq!(paused.len(), 1);
        assert_eq!(paused[0].1, HotkeyAction::ShowMain);
        assert_eq!(wanted(&keys, false).len(), 5);
    }
}
