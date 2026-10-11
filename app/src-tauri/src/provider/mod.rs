//! Talking to an AI: Claude through the Claude Code CLI (the user's Claude plan), ChatGPT and Gemini through
//! their HTTP APIs with the user's API key. The router runs a request on the chosen provider and, when the user
//! allows it, on the next one if the first fails before showing any text (quota, key, network).

pub mod claude_cli;
pub mod http_api;
pub mod stream_parser;

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use tokio::sync::oneshot;

use claude_cli::{ClaudeCli, ErrorKind, TranslateEvent};
use http_api::{Api, HttpApis};

use crate::prompt::TranslateRequest;

/// Where one attempt goes.
#[derive(Debug, Clone)]
pub enum Route {
    /// `model` overrides the Claude model chosen in Settings for this request.
    Claude { model: Option<String> },
    Api {
        api: Api,
        model: String,
        key: Option<String>,
    },
}

impl Route {
    pub fn id(&self) -> &'static str {
        match self {
            Route::Claude { .. } => "claude",
            Route::Api { api, .. } => api.id(),
        }
    }
}

pub struct Router {
    pub cli: Arc<ClaudeCli>,
    http: HttpApis,
    cancels: Mutex<HashMap<u64, oneshot::Sender<()>>>,
    /// Cancelled before the HTTP attempt registered (see ClaudeCli::cancel for the same race).
    cancelled_early: Mutex<HashSet<u64>>,
}

impl Router {
    pub fn new(cli: Arc<ClaudeCli>) -> Arc<Self> {
        Arc::new(Self {
            cli,
            http: HttpApis::new(),
            cancels: Mutex::new(HashMap::new()),
            cancelled_early: Mutex::new(HashSet::new()),
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
        self.http.models(api, key).await
    }

    /// Runs `routes` in order until one succeeds or fails after showing text. Always ends with `Done` or `Error`.
    pub async fn translate(
        &self,
        request_id: u64,
        req: TranslateRequest,
        routes: &[Route],
        emit: impl Fn(TranslateEvent) + Send + Sync,
    ) {
        let mut failed_first: Option<&'static str> = None;
        for (i, route) in routes.iter().enumerate() {
            let last = i + 1 == routes.len();
            // Collected per attempt: did text reach the user, and how did it end?
            let state: Mutex<(bool, Option<(ErrorKind, String)>)> = Mutex::new((false, None));
            let fallback_from = failed_first;
            {
                let forward = |event: TranslateEvent| match event {
                    TranslateEvent::Error { kind, message, .. } => {
                        let mut s = state.lock().unwrap();
                        let shown = s.0;
                        if last || shown || kind == ErrorKind::Cancelled {
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

                match route {
                    Route::Claude { model } => {
                        self.cli
                            .translate(request_id, req.clone(), model.as_deref(), &forward)
                            .await
                    }
                    Route::Api { api, model, key } => match key {
                        None => forward(TranslateEvent::Error {
                            kind: ErrorKind::MissingKey,
                            message: format!("No API key saved for {}", api.id()),
                            provider: None,
                        }),
                        Some(key) => {
                            let (tx, rx) = oneshot::channel();
                            {
                                let mut cancels = self.cancels.lock().unwrap();
                                if self.cancelled_early.lock().unwrap().remove(&request_id) {
                                    drop(cancels);
                                    emit(TranslateEvent::Error {
                                        kind: ErrorKind::Cancelled,
                                        message: "cancelled".into(),
                                        provider: Some(route.id().to_string()),
                                    });
                                    return;
                                }
                                cancels.insert(request_id, tx);
                            }
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
                    log::info!("{} failed ({kind:?}: {message}); trying the next provider", route.id());
                    failed_first.get_or_insert(route.id());
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::prompt::{Direction, Keigo};

    fn run(routes: &[Route]) -> Vec<TranslateEvent> {
        let router = Router::new(ClaudeCli::new(
            std::env::temp_dir().join("mytranslate-router-test"),
            "sonnet",
        ));
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
    fn cancelling_before_the_request_starts_stops_it() {
        let router = Router::new(ClaudeCli::new(
            std::env::temp_dir().join("mytranslate-router-test"),
            "sonnet",
        ));
        let id = router.next_request_id();
        router.cancel(id);
        let events = Mutex::new(Vec::new());
        let route = Route::Api {
            api: Api::Gemini,
            model: "m".into(),
            key: Some("k".into()),
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
}
