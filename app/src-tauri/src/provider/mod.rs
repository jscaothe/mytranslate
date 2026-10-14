//! Talking to an AI: Claude through Claude Code and ChatGPT through Codex (the user's own Claude or ChatGPT plan),
//! or Claude, ChatGPT and Gemini through their HTTP APIs with the user's API key. The router runs a request on the
//! chosen model; if it fails before showing any text, on the other models of the same provider (quota, overloaded,
//! unknown model) and, when the user allows it, on the next provider (also for a bad key or no network).

pub mod claude_cli;
pub mod codex_cli;
pub mod http_api;
pub mod stream_parser;

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use tokio::sync::oneshot;

use claude_cli::{ClaudeCli, ErrorKind, TranslateEvent};
use codex_cli::CodexCli;
use http_api::{Api, HttpApis};

use crate::prompt::TranslateRequest;

/// Where one attempt goes.
#[derive(Debug, Clone)]
pub enum Route {
    /// `model` overrides the Claude model chosen in Settings for this request.
    Claude { model: Option<String> },
    /// ChatGPT through Codex, signed in with the user's ChatGPT account.
    Codex { model: String },
    Api {
        api: Api,
        model: String,
        key: Option<String>,
        /// Set on the provider's last planned route: when it fails too, try every other model the key can use.
        more_models: bool,
    },
}

impl Route {
    pub fn id(&self) -> &'static str {
        match self {
            Route::Claude { .. } => "claude",
            Route::Codex { .. } => "codex",
            Route::Api { api, .. } => api.id(),
        }
    }

    fn model(&self) -> Option<&str> {
        match self {
            Route::Claude { model } => model.as_deref(),
            Route::Codex { model } => Some(model),
            Route::Api { model, .. } => Some(model),
        }
    }
}

/// Whether another model of the same provider may succeed after this error. A missing or bad key, no network or a
/// missing login fail the same way for every model; after a timeout the user has waited long enough.
fn model_specific(kind: ErrorKind) -> bool {
    matches!(kind, ErrorKind::RateLimited | ErrorKind::Cli)
}

/// Models to try after `tried`, from the key's model list: the fast tiers first (translation speed matters most),
/// otherwise in the list's newest-first order.
fn untried_models(available: &[String], tried: &HashSet<String>) -> Vec<String> {
    const FAST: [&str; 5] = ["flash", "mini", "nano", "lite", "luna"];
    let mut models: Vec<String> = available.iter().filter(|m| !tried.contains(*m)).cloned().collect();
    // By whole words: "gemini" is not a "mini".
    models.sort_by_key(|m| !m.split(['-', '.']).any(|w| FAST.contains(&w)));
    models
}

pub struct Router {
    pub cli: Arc<ClaudeCli>,
    codex: CodexCli,
    http: HttpApis,
    cancels: Mutex<HashMap<u64, oneshot::Sender<()>>>,
    /// Cancelled before the HTTP attempt registered (see ClaudeCli::cancel for the same race).
    cancelled_early: Mutex<HashSet<u64>>,
    /// Text models each key can use, fetched the first time a model fails.
    model_lists: Mutex<HashMap<(Api, String), Vec<String>>>,
}

impl Router {
    /// `codex_workdir`: an empty folder Codex runs in, like Claude Code's.
    pub fn new(cli: Arc<ClaudeCli>, codex_workdir: std::path::PathBuf) -> Arc<Self> {
        Arc::new(Self {
            cli,
            codex: CodexCli::new(codex_workdir),
            http: HttpApis::new(),
            cancels: Mutex::new(HashMap::new()),
            cancelled_early: Mutex::new(HashSet::new()),
            model_lists: Mutex::new(HashMap::new()),
        })
    }

    pub fn next_request_id(&self) -> u64 {
        self.cli.next_request_id()
    }

    pub fn cancel(&self, request_id: u64) {
        self.cli.cancel(request_id);
        match self.cancels.lock().unwrap().remove(&request_id) {
            Some(tx) => {
                let _ = tx.send(());
            }
            None => {
                self.cancelled_early.lock().unwrap().insert(request_id);
            }
        }
    }

    /// Warms the connection of an HTTP route (called when a hotkey fires, before the text is even copied).
    pub fn prewarm(&self, route: &Route) {
        if let Route::Api {
            api, key: Some(key), ..
        } = route
        {
            self.http.prewarm(*api, key);
        }
    }

    pub async fn models(&self, api: Api, key: &str) -> Result<Vec<String>, (ErrorKind, String)> {
        let models = self.http.models(api, key).await?;
        self.model_lists
            .lock()
            .unwrap()
            .insert((api, key.to_string()), models.clone());
        Ok(models)
    }

    /// The key's model list, from memory or else from the vendor; empty when it cannot be read.
    async fn model_list(&self, api: Api, key: &str) -> Vec<String> {
        if let Some(models) = self.model_lists.lock().unwrap().get(&(api, key.to_string())) {
            return models.clone();
        }
        self.models(api, key).await.unwrap_or_else(|(kind, message)| {
            log::info!("{}: could not list models ({kind:?}: {message})", api.id());
            Vec::new()
        })
    }

    /// Runs `routes` in order until one succeeds or fails after showing text. Always ends with `Done` or `Error`.
    /// After an error no other model can fix (see `model_specific`), the provider's remaining routes are skipped.
    pub async fn translate(
        &self,
        request_id: u64,
        req: TranslateRequest,
        routes: &[Route],
        emit: impl Fn(TranslateEvent) + Send + Sync,
    ) {
        let mut routes = routes.to_vec();
        let mut failed_first: Option<&'static str> = None;
        let mut given_up: HashSet<&'static str> = HashSet::new();
        let mut last_error: Option<(ErrorKind, String, &'static str)> = None;
        let mut i = 0;
        while i < routes.len() {
            let route = routes[i].clone();
            i += 1;
            if given_up.contains(route.id()) {
                continue;
            }
            // Collected per attempt: did text reach the user, and how did it end?
            let state: Mutex<(bool, Option<(ErrorKind, String)>)> = Mutex::new((false, None));
            // Only another provider is worth telling the user about.
            let fallback_from = failed_first.filter(|id| *id != route.id());
            {
                let forward = |event: TranslateEvent| match event {
                    TranslateEvent::Error { kind, message, .. } => {
                        let mut s = state.lock().unwrap();
                        let shown = s.0;
                        if shown || kind == ErrorKind::Cancelled {
                            emit(TranslateEvent::Error {
                                kind,
                                message,
                                provider: Some(route.id().to_string()),
                            });
                        } else {
                            s.1 = Some((kind, message));
                        }
                    }
                    TranslateEvent::Done {
                        sections,
                        mut timing,
                        rate_limit,
                    } => {
                        timing.fallback_from = fallback_from.map(str::to_string);
                        emit(TranslateEvent::Done {
                            sections,
                            timing,
                            rate_limit,
                        });
                    }
                    TranslateEvent::Delta { sections } => {
                        state.lock().unwrap().0 = true;
                        emit(TranslateEvent::Delta { sections });
                    }
                    other => emit(other),
                };

                match &route {
                    Route::Claude { model } => {
                        self.cli
                            .translate(request_id, req.clone(), model.as_deref(), &forward)
                            .await
                    }
                    Route::Codex { model } => {
                        let Some(rx) = self.register_cancel(request_id) else {
                            emit(cancelled(&route));
                            return;
                        };
                        self.codex.translate(model, &req, rx, &forward).await;
                        self.cancels.lock().unwrap().remove(&request_id);
                    }
                    Route::Api { api, model, key, .. } => match key {
                        None => forward(TranslateEvent::Error {
                            kind: ErrorKind::MissingKey,
                            message: format!("No API key saved for {}", api.id()),
                            provider: None,
                        }),
                        Some(key) => {
                            let Some(rx) = self.register_cancel(request_id) else {
                                emit(cancelled(&route));
                                return;
                            };
                            self.http.translate(*api, model, key, &req, rx, &forward).await;
                            self.cancels.lock().unwrap().remove(&request_id);
                        }
                    },
                }
            }

            let (_, held) = state.into_inner().unwrap();
            match held {
                // Succeeded, or already reported.
                None => return,
                Some((kind, message)) => {
                    log::info!(
                        "{} {} failed ({kind:?}: {message}); trying the next route",
                        route.id(),
                        route.model().unwrap_or("(default model)")
                    );
                    failed_first.get_or_insert(route.id());
                    if !model_specific(kind) {
                        given_up.insert(route.id());
                    } else if let Route::Api {
                        api,
                        key: Some(key),
                        more_models: true,
                        ..
                    } = &route
                    {
                        // After the provider's planned routes, every other model the key can use.
                        let tried: HashSet<String> = routes
                            .iter()
                            .filter(|r| r.id() == api.id())
                            .filter_map(|r| r.model().map(str::to_string))
                            .collect();
                        let more = untried_models(&self.model_list(*api, key).await, &tried);
                        let at = (i..routes.len())
                            .find(|&j| routes[j].id() != api.id())
                            .unwrap_or(routes.len());
                        routes.splice(
                            at..at,
                            more.into_iter().map(|model| Route::Api {
                                api: *api,
                                model,
                                key: Some(key.clone()),
                                more_models: false,
                            }),
                        );
                    }
                    last_error = Some((kind, message, route.id()));
                }
            }
        }
        // Only the last failure reaches the page, labelled with its provider.
        if let Some((kind, message, provider)) = last_error {
            emit(TranslateEvent::Error {
                kind,
                message,
                provider: Some(provider.to_string()),
            });
        }
    }
}

impl Router {
    /// The receiver a cancel of `request_id` fires; `None` when it was already cancelled.
    fn register_cancel(&self, request_id: u64) -> Option<oneshot::Receiver<()>> {
        let (tx, rx) = oneshot::channel();
        let mut cancels = self.cancels.lock().unwrap();
        if self.cancelled_early.lock().unwrap().remove(&request_id) {
            return None;
        }
        cancels.insert(request_id, tx);
        Some(rx)
    }
}

fn cancelled(route: &Route) -> TranslateEvent {
    TranslateEvent::Error {
        kind: ErrorKind::Cancelled,
        message: "cancelled".into(),
        provider: Some(route.id().to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::prompt::{Direction, Keigo};

    fn run(routes: &[Route]) -> Vec<TranslateEvent> {
        let router = Router::new(
            ClaudeCli::new(std::env::temp_dir().join("mytranslate-router-test"), "sonnet"),
            std::env::temp_dir().join("mytranslate-router-test-codex"),
        );
        let events = Mutex::new(Vec::new());
        let req = TranslateRequest::task(Direction::JaVi, "確認しました", Keigo::Formal);
        tauri::async_runtime::block_on(router.translate(router.next_request_id(), req, routes, |e| {
            events.lock().unwrap().push(e)
        }));
        events.into_inner().unwrap()
    }

    fn no_key(api: Api) -> Route {
        Route::Api {
            api,
            model: api.default_model().into(),
            key: None,
            more_models: false,
        }
    }

    #[test]
    fn a_failed_provider_is_hidden_when_another_one_follows() {
        let events = run(&[no_key(Api::OpenAi), no_key(Api::Gemini)]);
        // Only the last failure reaches the page, labelled with that provider.
        assert!(matches!(
            events.as_slice(),
            [TranslateEvent::Error { kind: ErrorKind::MissingKey, provider: Some(p), .. }] if p == "gemini"
        ));
    }

    #[test]
    fn a_provider_failing_for_every_model_is_reported_once() {
        let other_model = Route::Api {
            api: Api::Gemini,
            model: "gemini-other".into(),
            key: None,
            more_models: true,
        };
        // No key fails the same for every model: the second Gemini route is skipped, and the error still arrives.
        let events = run(&[no_key(Api::Gemini), other_model]);
        assert!(matches!(
            events.as_slice(),
            [TranslateEvent::Error { kind: ErrorKind::MissingKey, provider: Some(p), .. }] if p == "gemini"
        ));
    }

    #[test]
    fn untried_models_put_fast_tiers_first() {
        let available: Vec<String> = [
            "gemini-4-pro",
            "gemini-3.6-flash",
            "gemini-3.6-flash-lite",
            "gpt-5-mini",
        ]
        .map(String::from)
        .into();
        let tried = HashSet::from(["gemini-3.6-flash".to_string()]);
        assert_eq!(
            untried_models(&available, &tried),
            ["gemini-3.6-flash-lite", "gpt-5-mini", "gemini-4-pro"]
        );
    }

    #[test]
    fn only_quota_overload_and_model_errors_try_another_model() {
        for kind in [ErrorKind::RateLimited, ErrorKind::Cli] {
            assert!(model_specific(kind), "{kind:?}");
        }
        for kind in [
            ErrorKind::Timeout,
            ErrorKind::MissingKey,
            ErrorKind::BadKey,
            ErrorKind::Network,
            ErrorKind::NotInstalled,
            ErrorKind::NotLoggedIn,
            ErrorKind::Cancelled,
        ] {
            assert!(!model_specific(kind), "{kind:?}");
        }
    }

    #[test]
    fn cancelling_before_the_request_starts_stops_it() {
        let router = Router::new(
            ClaudeCli::new(std::env::temp_dir().join("mytranslate-router-test"), "sonnet"),
            std::env::temp_dir().join("mytranslate-router-test-codex"),
        );
        let id = router.next_request_id();
        router.cancel(id);
        let events = Mutex::new(Vec::new());
        let route = Route::Api {
            api: Api::Gemini,
            model: "m".into(),
            key: Some("k".into()),
            more_models: false,
        };
        let req = TranslateRequest::task(Direction::JaVi, "確認しました", Keigo::Formal);
        tauri::async_runtime::block_on(router.translate(id, req, &[route], |e| events.lock().unwrap().push(e)));
        assert!(matches!(
            events.into_inner().unwrap().as_slice(),
            [TranslateEvent::Error {
                kind: ErrorKind::Cancelled,
                ..
            }]
        ));
    }

    /// With the Gemini key saved in Settings: an unknown model falls back, silently, to a model the key can use.
    /// `cargo test -- --ignored live_unknown_model`
    #[test]
    #[ignore = "network, needs a saved Gemini key"]
    fn live_unknown_model_falls_back_to_a_working_one() {
        let key = crate::credentials::get("gemini-api-key").expect("a saved Gemini key");
        let route = Route::Api {
            api: Api::Gemini,
            model: "gemini-0-does-not-exist".into(),
            key: Some(key),
            more_models: true,
        };
        let events = run(&[route]);
        let last = events.last().unwrap();
        eprintln!("{last:?}");
        assert!(
            matches!(
                last,
                TranslateEvent::Done { timing, .. }
                    if timing.provider == "gemini"
                        && timing.model != "gemini-0-does-not-exist"
                        && timing.fallback_from.is_none()
            ),
            "{last:?}"
        );
    }
}
