//! Which AI translates: the provider chosen in Settings (Claude Code, ChatGPT or Gemini), its model and API key,
//! and the order of fallbacks. Plus the Settings commands to save keys, list models and test a provider.

use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::credentials;
use crate::prompt::{Direction, Keigo, TranslateRequest};
use crate::provider::Route;
use crate::provider::Router;
use crate::provider::claude_cli::TranslateEvent;
use crate::provider::http_api::Api;
use crate::settings::SettingsStore;

const ORDER: [&str; 3] = ["claude", "openai", "gemini"];

fn api(id: &str) -> Option<Api> {
    match id {
        "openai" => Some(Api::OpenAi),
        "gemini" => Some(Api::Gemini),
        _ => None,
    }
}

fn credential_name(api: Api) -> String {
    format!("{}-api-key", api.id())
}

fn route_for(settings: &Value, id: &str) -> Route {
    match api(id) {
        None => Route::Claude,
        Some(api) => {
            let field = if api == Api::OpenAi {
                "openaiModel"
            } else {
                "geminiModel"
            };
            let model = settings
                .get(field)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|m| !m.is_empty())
                .unwrap_or(api.default_model())
                .to_string();
            Route::Api {
                api,
                model,
                key: credentials::get(&credential_name(api)),
            }
        }
    }
}

/// The chosen provider first; with fallback on, then the others that are set up (Claude always is; ChatGPT and
/// Gemini once they have a key).
pub fn routes(app: &AppHandle) -> Vec<Route> {
    let settings = app.state::<SettingsStore>().get();
    let primary = settings
        .get("aiProvider")
        .and_then(Value::as_str)
        .filter(|p| ORDER.contains(p))
        .unwrap_or("claude");
    let mut routes = vec![route_for(&settings, primary)];
    if settings.get("aiFallback").and_then(Value::as_bool).unwrap_or(false) {
        for id in ORDER.iter().filter(|id| **id != primary) {
            let route = route_for(&settings, id);
            if !matches!(route, Route::Api { key: None, .. }) {
                routes.push(route);
            }
        }
    }
    routes
}

/// When a hotkey fires: open the HTTPS connection while the selected text is still being copied.
pub fn prewarm(app: &AppHandle) {
    if let Some(router) = app.try_state::<Arc<Router>>()
        && let Some(first) = routes(app).first()
    {
        router.prewarm(first);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyStatus {
    openai: bool,
    gemini: bool,
}

/// Which API keys are saved (never the keys themselves).
#[tauri::command]
pub fn ai_keys_status() -> KeyStatus {
    KeyStatus {
        openai: credentials::get(&credential_name(Api::OpenAi)).is_some(),
        gemini: credentials::get(&credential_name(Api::Gemini)).is_some(),
    }
}

/// Saves an API key in the Windows Credential Manager; an empty key deletes it.
#[tauri::command]
pub fn ai_key_set(provider: String, key: String) -> Result<(), String> {
    let api = api(&provider).ok_or("unknown provider")?;
    let key = key.trim();
    let result = if key.is_empty() {
        credentials::delete(&credential_name(api))
    } else {
        credentials::set(&credential_name(api), key)
    };
    result.map_err(|e| e.to_string())
}

/// Text models the saved key can use, for the model picker.
#[tauri::command]
pub async fn ai_models(router: State<'_, Arc<Router>>, provider: String) -> Result<Vec<String>, String> {
    let api = api(&provider).ok_or("unknown provider")?;
    let key = credentials::get(&credential_name(api)).ok_or("Chưa nhập API key")?;
    router.models(api, &key).await.map_err(|(_, m)| m)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    ok: bool,
    model: String,
    first_token_ms: Option<u64>,
    total_ms: u64,
    translation: String,
    error: Option<String>,
    error_kind: Option<String>,
}

/// Translates one short sentence with exactly this provider and model (no fallback): checks the key and model,
/// and shows how fast it is.
#[tauri::command]
pub async fn ai_test(
    app: AppHandle,
    router: State<'_, Arc<Router>>,
    provider: String,
    model: Option<String>,
) -> Result<TestResult, String> {
    let mut route = route_for(&app.state::<SettingsStore>().get(), &provider);
    if let (Route::Api { model: m, .. }, Some(chosen)) = (&mut route, model.filter(|m| !m.trim().is_empty())) {
        *m = chosen;
    }
    let request = TranslateRequest::task(Direction::JaVi, "確認しました。ありがとうございます。", Keigo::Polite);
    let start = Instant::now();
    let outcome: Mutex<Option<TestResult>> = Mutex::new(None);
    router
        .translate(
            router.next_request_id(),
            request,
            std::slice::from_ref(&route),
            |event| match event {
                TranslateEvent::Done { sections, timing, .. } => {
                    *outcome.lock().unwrap() = Some(TestResult {
                        ok: true,
                        model: timing.model,
                        first_token_ms: timing.first_token_ms,
                        total_ms: timing.total_ms,
                        translation: sections.translation,
                        error: None,
                        error_kind: None,
                    })
                }
                TranslateEvent::Error { kind, message, .. } => {
                    *outcome.lock().unwrap() = Some(TestResult {
                        ok: false,
                        model: String::new(),
                        first_token_ms: None,
                        total_ms: start.elapsed().as_millis() as u64,
                        translation: String::new(),
                        error: Some(message),
                        error_kind: serde_json::to_value(kind)
                            .ok()
                            .and_then(|v| v.as_str().map(str::to_string)),
                    })
                }
                _ => {}
            },
        )
        .await;
    outcome.into_inner().unwrap().ok_or_else(|| "no answer".into())
}
