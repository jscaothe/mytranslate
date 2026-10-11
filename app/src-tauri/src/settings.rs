//! User settings, owned by the Rust side so every window sees the same values.
//!
//! The page defines the shape (it is the one that edits it); this module stores the JSON as given, reads the
//! few fields the Rust side acts on, and tells every window when something changed.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::lang::Lang;

/// Tells every window the settings changed. `from` is the window (or "tray") that changed them, so that window
/// can ignore its own change.
pub fn broadcast(app: &tauri::AppHandle, value: &Value, from: &str) {
    use tauri::Emitter;
    let _ = app.emit(
        "settings:changed",
        serde_json::json!({ "settings": value, "from": from }),
    );
}

pub struct SettingsStore {
    path: PathBuf,
    value: Mutex<Value>,
}

/// Global hotkeys as the page stores them, e.g. "Ctrl+Alt+T". One key translates either way (the text's
/// language decides), one checks Japanese, one opens the main window.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hotkeys {
    pub auto: String,
    pub review: String,
    pub main: String,
}

impl Default for Hotkeys {
    fn default() -> Self {
        Self {
            auto: "Ctrl+Alt+T".into(),
            review: "Ctrl+Alt+C".into(),
            main: "Ctrl+Alt+M".into(),
        }
    }
}

/// Up to 0.1.1 there were separate "read" and "write" hotkeys, and checking was Ctrl+Alt+L.
const REMOVED_HOTKEYS: [&str; 2] = ["jaVi", "viJa"];
const OLD_REVIEW_HOTKEY: &str = "Ctrl+Alt+L";

impl SettingsStore {
    pub fn load(path: PathBuf) -> Self {
        let value = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(Value::Null);
        let store = Self {
            path,
            value: Mutex::new(value),
        };
        store.migrate_hotkeys();
        store
    }

    /// Drops the removed read and write hotkeys from saved settings, and moves the old default check hotkey to
    /// the new one. A check hotkey the user chose is kept.
    fn migrate_hotkeys(&self) {
        let mut value = self.get();
        let Some(keys) = value.get_mut("hotkeys").and_then(Value::as_object_mut) else {
            return;
        };
        let mut changed = false;
        for removed in REMOVED_HOTKEYS {
            changed |= keys.remove(removed).is_some();
        }
        if keys.get("review").and_then(Value::as_str) == Some(OLD_REVIEW_HOTKEY) {
            keys.insert("review".into(), Value::from(Hotkeys::default().review));
            changed = true;
        }
        if changed && let Err(e) = self.set(value) {
            log::warn!("could not save the new hotkeys: {e}");
        }
    }

    pub fn get(&self) -> Value {
        self.value.lock().unwrap().clone()
    }

    /// Replaces the settings and writes them to disk (write then rename, so a crash never leaves half a file).
    pub fn set(&self, value: Value) -> std::io::Result<()> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(&value)?)?;
        std::fs::rename(&tmp, &self.path)?;
        *self.value.lock().unwrap() = value;
        Ok(())
    }

    pub fn hotkeys(&self) -> Hotkeys {
        self.field("hotkeys").unwrap_or_default()
    }

    /// The user's own language. Until it is chosen: Vietnamese for anyone who already used the app (every user
    /// before the language setting was Vietnamese, often with a Japanese keyboard that puts Japanese first in
    /// the Windows language list), the language of Windows for a new user (who can change it on the first screen).
    pub fn language(&self) -> Lang {
        self.field::<String>("language")
            .and_then(|c| Lang::parse(&c))
            .unwrap_or_else(|| {
                if self.flag("onboarded") {
                    Lang::Vi
                } else {
                    Lang::system()
                }
            })
    }

    /// The settings for the page, with the language filled in when it was never chosen, so every window and
    /// the Rust side agree on it from the first start.
    pub fn get_for_page(&self) -> Value {
        let mut value = self.get();
        if !value.is_object() {
            value = Value::Object(Default::default());
        }
        if value
            .get("language")
            .and_then(Value::as_str)
            .and_then(Lang::parse)
            .is_none()
        {
            value["language"] = Value::String(self.language().code().into());
        }
        if self.field::<Hotkeys>("hotkeys").is_none() {
            value["hotkeys"] = serde_json::to_value(self.hotkeys()).unwrap_or(Value::Null);
        }
        value
    }

    pub fn hotkeys_paused(&self) -> bool {
        self.field("hotkeysPaused").unwrap_or(false)
    }

    /// Apps the user excluded: no hotkey or toolbar acts in them (password managers...). Case-insensitive.
    pub fn is_blocked(&self, exe: &str) -> bool {
        self.field::<Vec<String>>("blockedApps")
            .unwrap_or_default()
            .iter()
            .any(|b| b.trim().eq_ignore_ascii_case(exe))
    }

    pub fn model(&self) -> Option<String> {
        self.field("model")
    }

    /// A true/false setting; missing counts as false.
    pub fn flag(&self, key: &str) -> bool {
        self.field(key).unwrap_or(false)
    }

    fn field<T: for<'de> Deserialize<'de>>(&self, key: &str) -> Option<T> {
        let v = self.value.lock().unwrap();
        serde_json::from_value(v.get(key)?.clone()).ok()
    }

    /// Sets one top-level field, keeping the rest (used by the tray menu).
    pub fn set_field(&self, key: &str, field: Value) -> std::io::Result<Value> {
        let mut value = self.get();
        if !value.is_object() {
            value = Value::Object(Default::default());
        }
        value[key] = field;
        self.set(value.clone())?;
        Ok(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("mytranslate-test-{name}-{}.json", std::process::id()))
    }

    #[test]
    fn missing_file_gives_defaults() {
        let s = SettingsStore::load(temp_path("missing"));
        assert_eq!(s.hotkeys(), Hotkeys::default());
        assert_eq!(s.get_for_page()["hotkeys"]["review"], "Ctrl+Alt+C");
        assert!(!s.hotkeys_paused());
        assert_eq!(s.model(), None);
        assert_eq!(s.language(), Lang::system());
        assert_eq!(s.get_for_page()["language"], Lang::system().code());
    }

    #[test]
    fn chosen_language_wins_over_windows() {
        let path = temp_path("language");
        let s = SettingsStore::load(path.clone());
        s.set(serde_json::json!({ "language": "ja", "model": "sonnet" }))
            .unwrap();
        assert_eq!(s.language(), Lang::Ja);
        assert_eq!(s.get_for_page()["model"], "sonnet");
        s.set(serde_json::json!({ "language": "xx" })).unwrap();
        assert_eq!(s.language(), Lang::system());
        // Someone who used the app before there was a language setting is Vietnamese.
        s.set(serde_json::json!({ "onboarded": true })).unwrap();
        assert_eq!(s.language(), Lang::Vi);
        assert_eq!(s.get_for_page()["language"], "vi");
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn old_hotkeys_are_dropped_and_the_old_check_key_moves() {
        let path = temp_path("migrate");
        let old = serde_json::json!({ "auto": "Ctrl+Alt+T", "jaVi": "Ctrl+Alt+J", "viJa": "Ctrl+Alt+K", "review": "Ctrl+Alt+L", "main": "Ctrl+Alt+M" });
        std::fs::write(&path, serde_json::json!({ "hotkeys": old }).to_string()).unwrap();
        let s = SettingsStore::load(path.clone());
        assert_eq!(s.hotkeys(), Hotkeys::default());
        // Saved, so the page and the next start see them too.
        let saved = SettingsStore::load(path.clone()).get()["hotkeys"].clone();
        assert_eq!(
            saved,
            serde_json::json!({ "auto": "Ctrl+Alt+T", "review": "Ctrl+Alt+C", "main": "Ctrl+Alt+M" })
        );

        // Keys the user chose stay.
        let custom = serde_json::json!({ "auto": "Ctrl+Shift+T", "review": "Ctrl+Shift+L", "main": "Ctrl+Alt+M" });
        std::fs::write(&path, serde_json::json!({ "hotkeys": custom }).to_string()).unwrap();
        assert_eq!(SettingsStore::load(path.clone()).get()["hotkeys"], custom);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn round_trips_through_disk() {
        let path = temp_path("roundtrip");
        let s = SettingsStore::load(path.clone());
        s.set(serde_json::json!({
            "model": "haiku",
            "hotkeysPaused": true,
            "hotkeys": { "auto": "Ctrl+Shift+T", "review": "Ctrl+Alt+C", "main": "Ctrl+Alt+M" }
        }))
        .unwrap();
        let again = SettingsStore::load(path.clone());
        assert_eq!(again.model().as_deref(), Some("haiku"));
        assert!(again.hotkeys_paused());
        assert_eq!(again.hotkeys().auto, "Ctrl+Shift+T");
        again.set_field("hotkeysPaused", Value::Bool(false)).unwrap();
        assert!(!SettingsStore::load(path.clone()).hotkeys_paused());
        let _ = std::fs::remove_file(path);
    }
}
