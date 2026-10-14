//! Which MyTranslate this is: the stable app, or the staging build that installs beside it ("MyTranslate Staging",
//! see `tauri.staging.conf.json`). Tauri keeps the two apart by identifier (data folders, single instance); the
//! product name keeps them apart where Windows stores things by name: saved API keys, the install folder, the tray.

use std::sync::OnceLock;

const STABLE: &str = "MyTranslate";

static NAME: OnceLock<String> = OnceLock::new();

/// Set once at start-up from the product name the app was built with.
pub fn init(product_name: Option<&str>) {
    let _ = NAME.set(product_name.unwrap_or(STABLE).to_string());
}

/// "MyTranslate", or "MyTranslate Staging" for a staging build.
pub fn name() -> &'static str {
    NAME.get().map_or(STABLE, String::as_str)
}
