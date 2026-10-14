//! Claude (Anthropic Messages API), ChatGPT (OpenAI Responses API) and Gemini (Google AI generateContent) over
//! HTTPS with streaming, each with the user's own API key.
//!
//! Same prompt and same tagged output as the Claude CLI provider, so the popup, parser and history do not care
//! which one answered. Speed first: one shared HTTP client keeps connections open (and is warmed when a hotkey
//! fires), and each request asks for the least "thinking" the model accepts. Which level that is differs by
//! model, so it is found once per model (a 400 naming the setting moves to the next level) and remembered.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::Serialize;
use serde_json::{Value, json};
use tokio::sync::oneshot;

use super::claude_cli::{ErrorKind, Timing, TranslateEvent};
use super::stream_parser::StreamParser;
use crate::history::Tokens;
use crate::prompt::{self, TranslateRequest};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(90);
/// Room for a long translation plus its reading back; the answer is never longer than a few chat messages.
const MAX_OUTPUT_TOKENS: u32 = 4000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Api {
    Anthropic,
    OpenAi,
    Gemini,
}

impl Api {
    pub fn id(self) -> &'static str {
        match self {
            Api::Anthropic => "anthropic",
            Api::OpenAi => "openai",
            Api::Gemini => "gemini",
        }
    }

    /// Model used until the user picks one; the fastest general model each vendor documents (2026-10).
    pub fn default_model(self) -> &'static str {
        match self {
            // Sonnet, as through Claude Code: the translation quality SP5 was measured with.
            Api::Anthropic => "claude-sonnet-5-5",
            Api::OpenAi => "gpt-5.6-luna",
            Api::Gemini => "gemini-3.6-flash",
        }
    }

    fn base(self) -> &'static str {
        match self {
            Api::Anthropic => "https://api.anthropic.com/v1",
            Api::OpenAi => "https://api.openai.com/v1",
            Api::Gemini => "https://generativelanguage.googleapis.com/v1beta",
        }
    }

    /// The least-thinking settings to try, most preferred first; `Value::Null` sends none.
    fn thinking_options(self) -> Vec<Value> {
        match self {
            // Fields merged into the request. Haiku turns thinking off; Sonnet 5.5 only through `between_tools`;
            // Opus 5.5 cannot, so the lowest effort is the least it thinks.
            Api::Anthropic => vec![
                json!({ "thinking": { "type": "disabled" }, "output_config": { "effort": "low" } }),
                json!({ "thinking": { "type": "between_tools" }, "output_config": { "effort": "low" } }),
                json!({ "output_config": { "effort": "low" } }),
                Value::Null,
            ],
            Api::OpenAi => vec![
                json!({ "effort": "none" }),
                json!({ "effort": "minimal" }),
                json!({ "effort": "low" }),
                Value::Null,
            ],
            Api::Gemini => vec![
                json!({ "thinkingLevel": "minimal" }),
                json!({ "thinkingBudget": 0 }),
                json!({ "thinkingLevel": "low" }),
                Value::Null,
            ],
        }
    }
}

pub struct HttpApis {
    client: reqwest::Client,
    /// Per (api, model): index into `thinking_options` known to be accepted.
    thinking: Mutex<HashMap<(Api, String), usize>>,
}

/// A failed attempt: retry with the next thinking option, or give up with this error.
enum Failure {
    ThinkingRejected,
    Fatal(ErrorKind, String),
}

impl Default for HttpApis {
    fn default() -> Self {
        Self::new()
    }
}

impl HttpApis {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .pool_idle_timeout(Duration::from_secs(300))
            .tcp_keepalive(Duration::from_secs(30))
            .build()
            .expect("HTTP client");
        Self {
            client,
            thinking: Mutex::new(HashMap::new()),
        }
    }

    /// Opens (or keeps) the TLS connection, so the translation that follows does not pay for it. Free: it only
    /// lists models, and errors are ignored.
    pub fn prewarm(&self, api: Api, key: &str) {
        let req = self.models_request(api, key);
        tauri::async_runtime::spawn(async move {
            let _ = req.send().await;
        });
    }

    fn models_request(&self, api: Api, key: &str) -> reqwest::RequestBuilder {
        let url = match api {
            Api::Anthropic => format!("{}/models?limit=100", api.base()),
            Api::OpenAi => format!("{}/models", api.base()),
            Api::Gemini => format!("{}/models?pageSize=200", api.base()),
        };
        match api {
            Api::Anthropic => anthropic_headers(self.client.get(url), key),
            Api::OpenAi => self.client.get(url).bearer_auth(key),
            Api::Gemini => self.client.get(url).header("x-goog-api-key", key),
        }
    }

    /// Model ids this key can use for text generation, newest-looking first.
    pub async fn models(&self, api: Api, key: &str) -> Result<Vec<String>, (ErrorKind, String)> {
        let res = self.models_request(api, key).send().await.map_err(network)?;
        let status = res.status();
        let body: Value = res.json().await.map_err(network)?;
        if !status.is_success() {
            return Err(classify(api, status.as_u16(), &body.to_string()));
        }
        let mut ids: Vec<String> = match api {
            Api::Anthropic => body["data"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|m| m["id"].as_str())
                .filter(|id| id.starts_with("claude-"))
                .map(str::to_string)
                .collect(),
            Api::OpenAi => body["data"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|m| m["id"].as_str())
                .filter(|id| {
                    id.starts_with("gpt-")
                        && !id.contains("audio")
                        && !id.contains("realtime")
                        && !id.contains("image")
                        && !id.contains("transcribe")
                        && !id.contains("tts")
                })
                .map(str::to_string)
                .collect(),
            Api::Gemini => body["models"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|m| {
                    m["supportedGenerationMethods"]
                        .as_array()
                        .is_some_and(|a| a.iter().any(|x| x == "generateContent"))
                })
                .filter_map(|m| m["name"].as_str())
                .map(|n| n.trim_start_matches("models/").to_string())
                .filter(|id| {
                    id.starts_with("gemini-")
                        && !id.contains("image")
                        && !id.contains("tts")
                        && !id.contains("embedding")
                        && !id.contains("transcribe")
                        && !id.contains("computer-use")
                        && !id.contains("robotics")
                        && !id.contains("customtools")
                        && !id.contains("banana")
                })
                .collect(),
        };
        ids.sort_by(|a, b| b.cmp(a));
        ids.dedup();
        Ok(ids)
    }

    /// Runs one translation, reporting progress through `emit`. Always ends with `Done` or `Error`.
    pub async fn translate(
        &self,
        api: Api,
        model: &str,
        key: &str,
        req: &TranslateRequest,
        mut cancel: oneshot::Receiver<()>,
        emit: &(dyn Fn(TranslateEvent) + Send + Sync),
    ) {
        let start = Instant::now();
        let options = api.thinking_options();
        let known = self.thinking.lock().unwrap().get(&(api, model.to_string())).copied();
        let mut index = known.unwrap_or(0);
        emit(TranslateEvent::Started { warm: true });
        loop {
            let outcome = self
                .attempt(api, model, key, req, &options[index], start, &mut cancel, emit)
                .await;
            match outcome {
                Ok(()) => {
                    self.thinking.lock().unwrap().insert((api, model.to_string()), index);
                    return;
                }
                Err(Failure::ThinkingRejected) if index + 1 < options.len() => {
                    log::info!(
                        "{} {model}: thinking option {index} rejected, trying the next",
                        api.id()
                    );
                    index += 1;
                }
                Err(Failure::ThinkingRejected) => {
                    emit(error(ErrorKind::Cli, "The model rejected every thinking setting"));
                    return;
                }
                Err(Failure::Fatal(kind, message)) => {
                    emit(error(kind, &message));
                    return;
                }
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn attempt(
        &self,
        api: Api,
        model: &str,
        key: &str,
        req: &TranslateRequest,
        thinking: &Value,
        start: Instant,
        cancel: &mut oneshot::Receiver<()>,
        emit: &(dyn Fn(TranslateEvent) + Send + Sync),
    ) -> Result<(), Failure> {
        let user = prompt::user_message(req);
        let request = match api {
            Api::Anthropic => {
                let mut body = json!({
                    "model": model,
                    "max_tokens": MAX_OUTPUT_TOKENS,
                    // The same system prompt every time: cached, so later translations read it at a tenth of the
                    // price and start sooner.
                    "system": [{ "type": "text", "text": prompt::SYSTEM_PROMPT, "cache_control": { "type": "ephemeral" } }],
                    "messages": [{ "role": "user", "content": user }],
                    "stream": true,
                });
                if let Some(fields) = thinking.as_object() {
                    for (k, v) in fields {
                        body[k] = v.clone();
                    }
                }
                anthropic_headers(self.client.post(format!("{}/messages", api.base())), key).json(&body)
            }
            Api::OpenAi => {
                let mut body = json!({
                    "model": model,
                    "instructions": prompt::SYSTEM_PROMPT,
                    "input": [{ "role": "user", "content": user }],
                    "stream": true,
                    // Nothing is kept on the vendor side beyond what the API itself requires.
                    "store": false,
                    "max_output_tokens": MAX_OUTPUT_TOKENS,
                });
                if !thinking.is_null() {
                    body["reasoning"] = thinking.clone();
                }
                self.client
                    .post(format!("{}/responses", api.base()))
                    .bearer_auth(key)
                    .json(&body)
            }
            Api::Gemini => {
                let mut config = json!({ "maxOutputTokens": MAX_OUTPUT_TOKENS });
                if !thinking.is_null() {
                    config["thinkingConfig"] = thinking.clone();
                }
                let body = json!({
                    "systemInstruction": { "parts": [{ "text": prompt::SYSTEM_PROMPT }] },
                    "contents": [{ "role": "user", "parts": [{ "text": user }] }],
                    "generationConfig": config,
                });
                self.client
                    .post(format!("{}/models/{model}:streamGenerateContent?alt=sse", api.base()))
                    .header("x-goog-api-key", key)
                    .json(&body)
            }
        };

        let send = tokio::select! {
            r = request.timeout(REQUEST_TIMEOUT).send() => r,
            _ = &mut *cancel => return Err(Failure::Fatal(ErrorKind::Cancelled, "cancelled".into())),
        };
        let res = send.map_err(|e| {
            let (k, m) = network(e);
            Failure::Fatal(k, m)
        })?;
        let status = res.status();
        if !status.is_success() {
            let body = res.text().await.unwrap_or_default();
            let mentions_thinking = ["reasoning", "effort", "thinking"]
                .iter()
                .any(|w| body.to_lowercase().contains(w));
            if status.as_u16() == 400 && mentions_thinking && !thinking.is_null() {
                return Err(Failure::ThinkingRejected);
            }
            let (kind, message) = classify(api, status.as_u16(), &body);
            return Err(Failure::Fatal(kind, message));
        }

        let mut parser = StreamParser::default();
        let mut first_token_ms = None;
        let mut thought = false;
        let mut tokens = Tokens::default();
        let mut buffer = String::new();
        let mut stream = res.bytes_stream();
        loop {
            let chunk = tokio::select! {
                c = stream.next() => c,
                _ = &mut *cancel => return Err(Failure::Fatal(ErrorKind::Cancelled, "cancelled".into())),
            };
            let Some(chunk) = chunk else { break };
            let chunk = chunk.map_err(|e| {
                let (k, m) = network(e);
                Failure::Fatal(k, m)
            })?;
            buffer.push_str(&String::from_utf8_lossy(&chunk));
            // Server-sent events end with a blank line; a JSON payload never contains one.
            while let Some(end) = buffer.find("\n\n").or_else(|| buffer.find("\r\n\r\n")) {
                let event: String = buffer.drain(..end).collect();
                let skip = if buffer.starts_with("\r\n\r\n") { 4 } else { 2 };
                buffer.drain(..skip.min(buffer.len()));
                for data in event.lines().filter_map(|l| l.strip_prefix("data:")) {
                    let Ok(msg) = serde_json::from_str::<Value>(data.trim()) else {
                        continue;
                    };
                    if let Some(t) = read_usage(api, &msg) {
                        // Claude splits them: input at the start, output at the end.
                        tokens = Tokens {
                            input: t.input.or(tokens.input),
                            cached: t.cached.or(tokens.cached),
                            output: t.output.or(tokens.output),
                        };
                    }
                    match read_event(api, &msg) {
                        Piece::Text(t) => {
                            if first_token_ms.is_none() {
                                first_token_ms = Some(start.elapsed().as_millis() as u64);
                            }
                            emit(TranslateEvent::Delta {
                                sections: parser.push(&t),
                            });
                        }
                        Piece::Thinking => {
                            if !thought && first_token_ms.is_none() {
                                emit(TranslateEvent::Thinking);
                            }
                            thought = true;
                        }
                        Piece::Failed(message) => {
                            let (kind, message) = classify(api, 500, &message);
                            return Err(Failure::Fatal(kind, message));
                        }
                        Piece::Nothing => {}
                    }
                }
            }
        }
        let sections = super::stream_parser::parse(parser.raw());
        if parser.raw().trim().is_empty() {
            return Err(Failure::Fatal(ErrorKind::Cli, "The model returned no text".into()));
        }
        emit(TranslateEvent::Done {
            sections,
            timing: Timing {
                first_token_ms,
                total_ms: start.elapsed().as_millis() as u64,
                thought,
                warm: true,
                model: model.to_string(),
                prompt_version: prompt::PROMPT_VERSION,
                provider: api.id().to_string(),
                fallback_from: None,
                tokens,
            },
            rate_limit: None,
        });
        Ok(())
    }
}

/// Token counts, when this event carries them: Claude sends the input when the message starts and the output when
/// it ends, OpenAI everything once at the end, Gemini a running total in every chunk (the last one wins).
fn read_usage(api: Api, msg: &Value) -> Option<Tokens> {
    match api {
        Api::Anthropic => match msg["type"].as_str()? {
            "message_start" => {
                let u = &msg["message"]["usage"];
                let cached = u["cache_read_input_tokens"].as_u64().unwrap_or(0);
                // Claude counts the cached and the newly cached part apart from `input_tokens`.
                let input =
                    u["input_tokens"].as_u64()? + cached + u["cache_creation_input_tokens"].as_u64().unwrap_or(0);
                Some(Tokens {
                    input: Some(input),
                    cached: Some(cached),
                    output: None,
                })
            }
            "message_delta" => Some(Tokens {
                input: None,
                cached: None,
                output: msg["usage"]["output_tokens"].as_u64(),
            }),
            _ => None,
        },
        Api::OpenAi => {
            let u = msg.get("response")?.get("usage")?;
            Some(Tokens {
                input: u["input_tokens"].as_u64(),
                cached: u["input_tokens_details"]["cached_tokens"].as_u64(),
                output: u["output_tokens"].as_u64(),
            })
        }
        Api::Gemini => {
            let u = msg.get("usageMetadata")?;
            let output =
                u["candidatesTokenCount"].as_u64().unwrap_or(0) + u["thoughtsTokenCount"].as_u64().unwrap_or(0);
            Some(Tokens {
                input: u["promptTokenCount"].as_u64(),
                cached: Some(u["cachedContentTokenCount"].as_u64().unwrap_or(0)),
                output: Some(output),
            })
        }
    }
}

enum Piece {
    Text(String),
    Thinking,
    Failed(String),
    Nothing,
}

/// One server-sent event of any of the APIs.
fn read_event(api: Api, msg: &Value) -> Piece {
    match api {
        Api::Anthropic => match msg["type"].as_str().unwrap_or_default() {
            "content_block_delta" => match msg["delta"]["type"].as_str().unwrap_or_default() {
                "text_delta" => Piece::Text(msg["delta"]["text"].as_str().unwrap_or_default().to_string()),
                "thinking_delta" | "signature_delta" => Piece::Thinking,
                _ => Piece::Nothing,
            },
            "content_block_start" if msg["content_block"]["type"] == "thinking" => Piece::Thinking,
            // A safety classifier declined the message: say so rather than show half an answer.
            "message_delta" if msg["delta"]["stop_reason"] == "refusal" => {
                Piece::Failed("Claude declined to translate this message".into())
            }
            "error" => Piece::Failed(msg["error"]["message"].as_str().unwrap_or("error").to_string()),
            _ => Piece::Nothing,
        },
        Api::OpenAi => match msg["type"].as_str().unwrap_or_default() {
            "response.output_text.delta" => Piece::Text(msg["delta"].as_str().unwrap_or_default().to_string()),
            t if t.starts_with("response.reasoning") => Piece::Thinking,
            "error" => Piece::Failed(
                msg["message"]
                    .as_str()
                    .or(msg["error"]["message"].as_str())
                    .unwrap_or("error")
                    .to_string(),
            ),
            "response.failed" => Piece::Failed(
                msg["response"]["error"]["message"]
                    .as_str()
                    .unwrap_or("The request failed")
                    .to_string(),
            ),
            _ => Piece::Nothing,
        },
        Api::Gemini => {
            if let Some(m) = msg["error"]["message"].as_str() {
                return Piece::Failed(m.to_string());
            }
            let parts = msg["candidates"][0]["content"]["parts"].as_array();
            let mut text = String::new();
            let mut thinking = false;
            for p in parts.into_iter().flatten() {
                if p["thought"].as_bool() == Some(true) {
                    thinking = true;
                } else if let Some(t) = p["text"].as_str() {
                    text.push_str(t);
                }
            }
            if !text.is_empty() {
                Piece::Text(text)
            } else if thinking {
                Piece::Thinking
            } else {
                Piece::Nothing
            }
        }
    }
}

/// Claude's API key and version headers.
fn anthropic_headers(req: reqwest::RequestBuilder, key: &str) -> reqwest::RequestBuilder {
    req.header("x-api-key", key).header("anthropic-version", "2023-06-01")
}

fn error(kind: ErrorKind, message: &str) -> TranslateEvent {
    TranslateEvent::Error {
        kind,
        message: message.to_string(),
        provider: None,
    }
}

fn network(e: reqwest::Error) -> (ErrorKind, String) {
    if e.is_timeout() {
        (ErrorKind::Timeout, "The AI service did not answer in time".into())
    } else {
        (ErrorKind::Network, format!("Network error: {e}"))
    }
}

/// HTTP status and error text to an error kind the popup explains.
fn classify(api: Api, status: u16, body: &str) -> (ErrorKind, String) {
    let lower = body.to_lowercase();
    let message = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v["error"]["message"].as_str().map(str::to_string))
        .unwrap_or_else(|| body.chars().take(300).collect());
    let kind = match status {
        401 | 403 => ErrorKind::BadKey,
        400 if lower.contains("api key") || lower.contains("api_key_invalid") => ErrorKind::BadKey,
        429 => ErrorKind::RateLimited,
        404 => ErrorKind::Cli,
        // Claude: no prepaid credit left on the account.
        _ if lower.contains("quota") || lower.contains("credit balance") => ErrorKind::RateLimited,
        _ => ErrorKind::Cli,
    };
    let message = if kind == ErrorKind::Cli && status == 404 {
        format!("{} does not know this model: {message}", api.id())
    } else {
        message
    };
    (kind, message)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_openai_text_and_reasoning_events() {
        let delta = json!({ "type": "response.output_text.delta", "delta": "<translation>確認" });
        assert!(matches!(read_event(Api::OpenAi, &delta), Piece::Text(t) if t == "<translation>確認"));
        let reasoning = json!({ "type": "response.reasoning_summary_text.delta", "delta": "…" });
        assert!(matches!(read_event(Api::OpenAi, &reasoning), Piece::Thinking));
        let failed = json!({ "type": "response.failed", "response": { "error": { "message": "boom" } } });
        assert!(matches!(read_event(Api::OpenAi, &failed), Piece::Failed(m) if m == "boom"));
        assert!(matches!(
            read_event(Api::OpenAi, &json!({ "type": "response.created" })),
            Piece::Nothing
        ));
    }

    #[test]
    fn reads_gemini_parts_and_skips_thoughts() {
        let chunk = json!({ "candidates": [{ "content": { "parts": [
            { "text": "plan", "thought": true },
            { "text": "<translation>Xin " },
            { "text": "chào" }
        ] } }] });
        assert!(matches!(read_event(Api::Gemini, &chunk), Piece::Text(t) if t == "<translation>Xin chào"));
        let only_thought = json!({ "candidates": [{ "content": { "parts": [{ "text": "…", "thought": true }] } }] });
        assert!(matches!(read_event(Api::Gemini, &only_thought), Piece::Thinking));
    }

    #[test]
    fn reads_claude_text_thinking_refusals_and_split_usage() {
        let delta = json!({ "type": "content_block_delta", "index": 0, "delta": { "type": "text_delta", "text": "<translation>確認" } });
        assert!(matches!(read_event(Api::Anthropic, &delta), Piece::Text(t) if t == "<translation>確認"));
        let thinking = json!({ "type": "content_block_delta", "delta": { "type": "thinking_delta", "thinking": "" } });
        assert!(matches!(read_event(Api::Anthropic, &thinking), Piece::Thinking));
        let refusal =
            json!({ "type": "message_delta", "delta": { "stop_reason": "refusal" }, "usage": { "output_tokens": 3 } });
        assert!(matches!(read_event(Api::Anthropic, &refusal), Piece::Failed(_)));
        let overloaded = json!({ "type": "error", "error": { "type": "overloaded_error", "message": "Overloaded" } });
        assert!(matches!(read_event(Api::Anthropic, &overloaded), Piece::Failed(m) if m == "Overloaded"));

        let start = json!({ "type": "message_start", "message": { "usage": {
            "input_tokens": 40, "cache_read_input_tokens": 1000, "cache_creation_input_tokens": 0, "output_tokens": 1
        } } });
        let t = read_usage(Api::Anthropic, &start).unwrap();
        assert_eq!((t.input, t.cached, t.output), (Some(1040), Some(1000), None));
        let end = json!({ "type": "message_delta", "delta": { "stop_reason": "end_turn" }, "usage": { "output_tokens": 120 } });
        assert_eq!(read_usage(Api::Anthropic, &end).unwrap().output, Some(120));
        assert!(classify(Api::Anthropic, 400, r#"{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low"}}"#).0 == ErrorKind::RateLimited);
    }

    #[test]
    fn errors_map_to_what_the_user_can_fix() {
        assert_eq!(classify(Api::OpenAi, 401, "{}").0, ErrorKind::BadKey);
        assert_eq!(
            classify(
                Api::Gemini,
                400,
                r#"{"error":{"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}"#
            ),
            (
                ErrorKind::BadKey,
                "API key not valid. Please pass a valid API key.".to_string()
            )
        );
        assert_eq!(
            classify(
                Api::OpenAi,
                429,
                r#"{"error":{"message":"You exceeded your current quota"}}"#
            )
            .0,
            ErrorKind::RateLimited
        );
        assert_eq!(classify(Api::Gemini, 500, "internal").0, ErrorKind::Cli);
    }
}

#[cfg(test)]
mod live {
    use super::*;
    use crate::prompt::{Direction, Keigo};

    /// Talks to the real APIs with a made-up key: both must answer "bad key". `cargo test -- --ignored live`
    #[test]
    #[ignore = "network"]
    fn live_bad_keys_are_recognised() {
        let apis = HttpApis::new();
        for api in [Api::Anthropic, Api::OpenAi, Api::Gemini] {
            let (_tx, rx) = oneshot::channel();
            let events = std::sync::Mutex::new(Vec::new());
            let req = TranslateRequest::task(Direction::JaVi, "確認しました", Keigo::Formal);
            tauri::async_runtime::block_on(apis.translate(
                api,
                api.default_model(),
                "invalid-key-for-test",
                &req,
                rx,
                &|e| events.lock().unwrap().push(e),
            ));
            let events = events.into_inner().unwrap();
            let last = events.last().unwrap();
            eprintln!("{}: {:?}", api.id(), last);
            assert!(
                matches!(
                    last,
                    TranslateEvent::Error {
                        kind: ErrorKind::BadKey,
                        ..
                    }
                ),
                "{api:?}: {last:?}"
            );
            let models = tauri::async_runtime::block_on(apis.models(api, "invalid-key-for-test"));
            assert!(
                matches!(models, Err((ErrorKind::BadKey, _))),
                "{api:?} models: {models:?}"
            );
        }
    }
}
