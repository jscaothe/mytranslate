//! Which AI translates: the provider chosen in Settings (Claude through Claude Code, or Claude, ChatGPT, Gemini
//! through an API key), its model and API key,
//! and the order of fallbacks. Plus the Settings commands to save keys, list models and test a provider.

use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::credentials;
use crate::prompt::{AiChoice, Direction, Keigo, TranslateRequest};
use crate::provider::Route;
use crate::provider::Router;
use crate::provider::claude_cli::TranslateEvent;
use crate::provider::http_api::Api;
use crate::settings::SettingsStore;

/// Provider ids: `claude` is Claude Code (the user's Claude account), `codex` is ChatGPT through Codex (the user's
/// ChatGPT account); `anthropic`, `openai` and `gemini` use an API key.
const ORDER: [&str; 5] = ["claude", "codex", "anthropic", "openai", "gemini"];

fn api(id: &str) -> Option<Api> {
    match id {
        "anthropic" => Some(Api::Anthropic),
        "openai" => Some(Api::OpenAi),
        "gemini" => Some(Api::Gemini),
        _ => None,
    }
}

fn credential_name(api: Api) -> String {
    format!("{}-api-key", api.id())
}

/// The settings field holding a provider's default model.
fn model_field(id: &str) -> &'static str {
    match id {
        "codex" => "codexModel",
        "anthropic" => "anthropicModel",
        "openai" => "openaiModel",
        "gemini" => "geminiModel",
        _ => "model",
    }
}

/// The default model of a provider: from Settings, else the recommended one.
fn default_model(settings: &Value, id: &str) -> String {
    let fallback = match (id, api(id)) {
        (_, Some(api)) => api.default_model(),
        ("codex", None) => crate::provider::codex_cli::DEFAULT_MODEL,
        _ => "sonnet",
    };
    settings
        .get(model_field(id))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

fn route_for(settings: &Value, id: &str, model: Option<&str>) -> Route {
    if id == "codex" {
        return Route::Codex {
            model: model.map(str::to_string).unwrap_or_else(|| default_model(settings, id)),
        };
    }
    match api(id) {
        None => Route::Claude {
            model: model.map(str::to_string),
        },
        Some(api) => {
            let model = model.map(str::to_string).unwrap_or_else(|| default_model(settings, id));
            Route::Api {
                api,
                model,
                key: credentials::get(&credential_name(api)),
                more_models: false,
            }
        }
    }
}

/// Other models of the same provider to try first when `model` cannot answer: Claude's other model; for ChatGPT
/// (through Codex or a key), Claude through a key and Gemini the default model in Settings, the favourites ticked
/// there, then the recommended model. The router then tries every other model a key can use.
fn backup_models(settings: &Value, id: &str, model: &str) -> Vec<String> {
    let recommended = match (id, api(id)) {
        (_, Some(api)) => api.default_model(),
        ("codex", None) => crate::provider::codex_cli::DEFAULT_MODEL,
        _ => return vec![if model == "haiku" { "sonnet" } else { "haiku" }.to_string()],
    };
    let mut models: Vec<String> = std::iter::once(default_model(settings, id))
        .chain(
            settings["aiQuickModels"][id]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|m| !m.is_empty())
                .map(str::to_string),
        )
        .chain([recommended.to_string()])
        .collect();
    let mut seen = std::collections::HashSet::from([model.to_string()]);
    models.retain(|m| seen.insert(m.clone()));
    models
}

/// The chosen provider and model first, then that provider's other models; with fallback on, then the other
/// providers that are set up (Claude Code always counts as set up, Codex once installed, the API providers once they
/// have a key).
pub fn routes(app: &AppHandle) -> Vec<Route> {
    routes_for(app, None)
}

/// Like `routes`, but starting with `choice` (the popup's AI switcher) when given.
pub fn routes_for(app: &AppHandle, choice: Option<&AiChoice>) -> Vec<Route> {
    routes_from(&app.state::<SettingsStore>().get(), choice)
}

fn routes_from(settings: &Value, choice: Option<&AiChoice>) -> Vec<Route> {
    let primary = choice
        .map(|c| c.provider.as_str())
        .or_else(|| settings.get("aiProvider").and_then(Value::as_str))
        .filter(|p| ORDER.contains(p))
        .unwrap_or("claude");
    let model = choice
        .and_then(|c| c.model.as_deref())
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| default_model(settings, primary));
    let mut routes = vec![route_for(settings, primary, Some(&model))];
    for backup in backup_models(settings, primary, &model) {
        routes.push(route_for(settings, primary, Some(&backup)));
    }
    if let Some(Route::Api { more_models, .. }) = routes.last_mut() {
        *more_models = true;
    }
    if settings.get("aiFallback").and_then(Value::as_bool).unwrap_or(false) {
        for id in ORDER.iter().filter(|id| **id != primary) {
            let route = route_for(settings, id, None);
            let set_up = match &route {
                Route::Api { key, .. } => key.is_some(),
                Route::Codex { .. } => crate::provider::codex_cli::find_codex().is_some(),
                Route::Claude { .. } => true,
            };
            if set_up {
                routes.push(route);
            }
        }
    }
    routes
}

/// One entry of the quick AI switcher (popup and tray): a provider and one of its models.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuickChoice {
    pub provider: String,
    pub model: String,
    pub label: String,
    /// Usable now: Claude Code always, Codex once installed, the API providers once a key is saved.
    pub available: bool,
    /// The current default.
    pub current: bool,
}

/// Human name of a model: Claude's models by name, API models by id.
pub fn label(provider: &str, model: &str) -> String {
    match provider {
        "codex" => format!("ChatGPT · {model}"),
        "anthropic" => format!("Claude API · {model}"),
        "openai" => format!("ChatGPT API · {model}"),
        "gemini" => format!("Gemini · {model}"),
        _ => match model {
            "haiku" => "Claude Haiku".into(),
            _ => "Claude Sonnet".into(),
        },
    }
}

/// Every model offered in the quick switcher: Claude Code's two, and for each API provider the default model plus the
/// favourites ticked in Settings. Kept short on purpose: the full model lists live in Settings.
pub fn quick_choices_from(settings: &Value, keys: &KeyStatus) -> Vec<QuickChoice> {
    let current_provider = settings
        .get("aiProvider")
        .and_then(Value::as_str)
        .filter(|p| ORDER.contains(p))
        .unwrap_or("claude");
    let mut out = Vec::new();
    for id in ORDER {
        let default = default_model(settings, id);
        let mut models = match id {
            "claude" => vec!["sonnet".to_string(), "haiku".to_string()],
            "codex" => vec![default.clone()],
            _ => {
                let mut m = vec![default.clone()];
                if let Some(list) = settings["aiQuickModels"][id].as_array() {
                    m.extend(list.iter().filter_map(Value::as_str).map(str::to_string));
                }
                m
            }
        };
        models.dedup();
        let mut seen = std::collections::HashSet::new();
        models.retain(|m| seen.insert(m.clone()));
        let available = match id {
            "codex" => keys.codex,
            "anthropic" => keys.anthropic,
            "openai" => keys.openai,
            "gemini" => keys.gemini,
            _ => true,
        };
        for model in models {
            out.push(QuickChoice {
                label: label(id, &model),
                current: id == current_provider && model == default,
                provider: id.to_string(),
                model,
                available,
            });
        }
    }
    out
}

pub fn quick_choices(app: &AppHandle) -> Vec<QuickChoice> {
    quick_choices_from(&app.state::<SettingsStore>().get(), &ai_keys_status())
}

/// Makes `provider` + `model` the default (from the tray menu), and tells every window.
pub fn set_default(app: &AppHandle, provider: &str, model: &str) {
    if !ORDER.contains(&provider) {
        return;
    }
    let store = app.state::<SettingsStore>();
    let mut value = store.get();
    if !value.is_object() {
        value = serde_json::json!({});
    }
    value["aiProvider"] = Value::from(provider);
    value[model_field(provider)] = Value::from(model);
    if let Err(e) = store.set(value.clone()) {
        log::warn!("could not save the AI choice: {e}");
        return;
    }
    if provider == "claude"
        && let Some(cli) = app.try_state::<Arc<crate::provider::claude_cli::ClaudeCli>>()
    {
        let cli = cli.inner().clone();
        let model = model.to_string();
        tauri::async_runtime::spawn(async move { cli.set_model(&model).await });
    }
    crate::settings::broadcast(app, &value, "tray");
    crate::tray::sync_ai(app);
}

/// The quick switcher entries, for the popup.
#[tauri::command]
pub fn ai_choices(app: AppHandle) -> Vec<QuickChoice> {
    quick_choices(&app)
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
    /// Not a key: whether Codex is installed, so ChatGPT through the user's account can be offered.
    codex: bool,
    anthropic: bool,
    openai: bool,
    gemini: bool,
}

/// Which API keys are saved (never the keys themselves).
#[tauri::command]
pub fn ai_keys_status() -> KeyStatus {
    KeyStatus {
        codex: crate::provider::codex_cli::find_codex().is_some(),
        anthropic: credentials::get(&credential_name(Api::Anthropic)).is_some(),
        openai: credentials::get(&credential_name(Api::OpenAi)).is_some(),
        gemini: credentials::get(&credential_name(Api::Gemini)).is_some(),
    }
}

/// Saves an API key in the Windows Credential Manager; an empty key deletes it.
#[tauri::command]
pub fn ai_key_set(app: AppHandle, provider: String, key: String) -> Result<(), String> {
    let api = api(&provider).ok_or("unknown provider")?;
    let key = key.trim();
    let result = if key.is_empty() {
        credentials::delete(&credential_name(api))
    } else {
        credentials::set(&credential_name(api), key)
    };
    result.map_err(|e| e.to_string())?;
    // The switchers show which AIs are usable.
    crate::tray::sync_ai(&app);
    let _ = tauri::Emitter::emit(&app, "ai:keys-changed", ());
    Ok(())
}

/// Text models the saved key can use, for the model picker.
#[tauri::command]
pub async fn ai_models(
    router: State<'_, Arc<Router>>,
    store: State<'_, SettingsStore>,
    provider: String,
) -> Result<Vec<String>, String> {
    let api = api(&provider).ok_or("unknown provider")?;
    let key = credentials::get(&credential_name(api)).ok_or_else(|| {
        store
            .language()
            .pick("Chưa nhập API key", "APIキーが未入力です")
            .to_string()
    })?;
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
    let chosen = model.filter(|m| !m.trim().is_empty());
    let route = route_for(&app.state::<SettingsStore>().get(), &provider, chosen.as_deref());
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quick_choices_list_defaults_and_favourites_once() {
        let settings = serde_json::json!({
            "aiProvider": "gemini",
            "model": "haiku",
            "geminiModel": "gemini-a",
            "aiQuickModels": { "gemini": ["gemini-b", "gemini-a"], "openai": ["gpt-x"] }
        });
        let keys = KeyStatus {
            codex: false,
            anthropic: false,
            openai: false,
            gemini: true,
        };
        let c = quick_choices_from(&settings, &keys);
        let ids: Vec<(String, String, bool, bool)> = c
            .iter()
            .map(|q| (q.provider.clone(), q.model.clone(), q.available, q.current))
            .collect();
        assert_eq!(
            ids,
            [
                ("claude".into(), "sonnet".into(), true, false),
                ("claude".into(), "haiku".into(), true, false),
                ("codex".into(), "gpt-5.6-luna".into(), false, false),
                ("anthropic".into(), "claude-sonnet-5-5".into(), false, false),
                ("openai".into(), "gpt-5.6-luna".into(), false, false),
                ("openai".into(), "gpt-x".into(), false, false),
                ("gemini".into(), "gemini-a".into(), true, true),
                ("gemini".into(), "gemini-b".into(), true, false),
            ]
        );
        assert_eq!(c[1].label, "Claude Haiku");
        assert_eq!(c[7].label, "Gemini · gemini-b");
        assert_eq!(c[2].label, "ChatGPT · gpt-5.6-luna");
        assert_eq!(c[4].label, "ChatGPT API · gpt-5.6-luna");
    }

    fn plan(settings: &Value, choice: Option<&AiChoice>) -> Vec<(String, String)> {
        routes_from(settings, choice)
            .iter()
            .map(|r| match r {
                Route::Claude { model } => ("claude".into(), model.clone().unwrap_or_default()),
                Route::Codex { model } => ("codex".into(), model.clone()),
                Route::Api { api, model, .. } => (api.id().into(), model.clone()),
            })
            .collect()
    }

    fn pairs(list: &[(&str, &str)]) -> Vec<(String, String)> {
        list.iter().map(|(p, m)| (p.to_string(), m.to_string())).collect()
    }

    #[test]
    fn other_models_of_the_chosen_ai_come_next() {
        let settings = serde_json::json!({
            "aiProvider": "gemini",
            "geminiModel": "gemini-a",
            "aiQuickModels": { "gemini": ["gemini-b", "gemini-a", " ", "gemini-3.6-flash"], "openai": ["gpt-x"] }
        });
        assert_eq!(
            plan(&settings, None),
            pairs(&[
                ("gemini", "gemini-a"),
                ("gemini", "gemini-b"),
                ("gemini", "gemini-3.6-flash")
            ])
        );

        // The popup's switcher picks the first model; the default model is then one of the backups.
        let choice = AiChoice {
            provider: "gemini".into(),
            model: Some("gemini-b".into()),
        };
        assert_eq!(
            plan(&settings, Some(&choice)),
            pairs(&[
                ("gemini", "gemini-b"),
                ("gemini", "gemini-a"),
                ("gemini", "gemini-3.6-flash")
            ])
        );

        // Only the last planned route asks the router for the rest of the key's models.
        let flags: Vec<bool> = routes_from(&settings, None)
            .iter()
            .map(|r| matches!(r, Route::Api { more_models: true, .. }))
            .collect();
        assert_eq!(flags, [false, false, true]);

        let claude = serde_json::json!({ "aiProvider": "claude", "model": "haiku" });
        assert_eq!(plan(&claude, None), pairs(&[("claude", "haiku"), ("claude", "sonnet")]));
        assert_eq!(
            plan(&serde_json::json!({}), None),
            pairs(&[("claude", "sonnet"), ("claude", "haiku")])
        );
    }

    #[test]
    fn another_ai_only_when_fallback_is_on() {
        let off = serde_json::json!({ "aiProvider": "claude", "model": "sonnet", "aiFallback": false });
        assert!(plan(&off, None).iter().all(|(p, _)| p == "claude"));
        let on = serde_json::json!({ "aiProvider": "claude", "model": "sonnet", "aiFallback": true });
        let providers: Vec<String> = plan(&on, None).into_iter().map(|(p, _)| p).collect();
        // ChatGPT and Gemini follow only when their key is saved on this machine.
        assert_eq!(providers[..2], ["claude", "claude"]);
    }

    #[test]
    fn a_choice_overrides_provider_and_model() {
        let settings = serde_json::json!({ "aiProvider": "claude", "model": "sonnet" });
        assert!(
            matches!(route_for(&settings, "claude", Some("haiku")), Route::Claude { model: Some(m) } if m == "haiku")
        );
        assert!(
            matches!(route_for(&settings, "gemini", None), Route::Api { model, .. } if model == "gemini-3.6-flash")
        );
    }
}
