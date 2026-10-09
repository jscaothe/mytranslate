//! User settings, owned by the Rust side so every window sees the same values.
//!
//! The page defines the shape (it is the one that edits it); this module stores the JSON as given, reads the
//! few fields the Rust side acts on, and tells every window when something changed.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::Deserialize;
use serde_json::Value;

pub struct SettingsStore {
    path: PathBuf,
    value: Mutex<Value>,
}

/// Global hotkeys as the page stores them, e.g. "Ctrl+Alt+J".
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hotkeys {
    pub auto: String,
    pub ja_vi: String,
    pub vi_ja: String,
    pub review: String,
    pub main: String,
}

impl Default for Hotkeys {
    fn default() -> Self {
        Self {
            auto: "Ctrl+Alt+T".into(),
            ja_vi: "Ctrl+Alt+J".into(),
            vi_ja: "Ctrl+Alt+K".into(),
            review: "Ctrl+Alt+L".into(),
            main: "Ctrl+Alt+M".into(),
        }
    }
}

impl SettingsStore {
    pub fn load(path: PathBuf) -> Self {
        let value = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(Value::Null);
        Self {
            path,
            value: Mutex::new(value),
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

    pub fn hotkeys_paused(&self) -> bool {
        self.field("hotkeysPaused").unwrap_or(false)
    }

    pub fn model(&self) -> Option<String> {
        self.field("model")
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
        assert!(!s.hotkeys_paused());
        assert_eq!(s.model(), None);
    }

    #[test]
    fn round_trips_through_disk() {
        let path = temp_path("roundtrip");
        let s = SettingsStore::load(path.clone());
        s.set(serde_json::json!({
            "model": "haiku",
            "hotkeysPaused": true,
            "hotkeys": { "auto": "Ctrl+Shift+T", "jaVi": "Ctrl+Alt+J", "viJa": "Ctrl+Alt+K", "review": "Ctrl+Alt+L", "main": "Ctrl+Alt+M" }
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
