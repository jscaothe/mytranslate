//! Translates through the user's own Claude Code login (`claude` CLI).
//!
//! SP1 (spikes/sp1-latency) showed where the time goes and how to avoid it:
//! - starting `claude.exe` takes ~3.5 s, so one process is always booted ahead of time (the "spare");
//! - a process is used for exactly one request and then killed, because a shared process keeps growing its
//!   conversation context and there is no supported way to clear it;
//! - Claude Code's own 38k-token system prompt, tools, plugins and MCP servers are switched off;
//! - `--effort low` with Sonnet avoids most of the model's "thinking" before it writes.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::{Mutex, oneshot};

use super::stream_parser::{Sections, StreamParser};
use crate::history::Tokens;
use crate::prompt::{self, TranslateRequest};

/// A spare older than this is replaced in the background, so a stale login or a stuck process never meets a user.
const SPARE_MAX_AGE: Duration = Duration::from_secs(20 * 60);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(90);
/// Claude Code's 4th retry of an unsent request comes about 5 s in; a blip is over by then, a blocked network is not.
const NETWORK_ATTEMPTS: u64 = 4;
/// Windows: do not flash a console window for the child process.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Timing {
    /// Request start to first translated character.
    pub first_token_ms: Option<u64>,
    pub total_ms: u64,
    /// Whether the model spent time thinking before writing.
    pub thought: bool,
    /// Whether a booted spare was ready; false means this request paid the process start-up time.
    pub warm: bool,
    pub model: String,
    pub prompt_version: u32,
    /// claude, openai or gemini.
    pub provider: String,
    /// Set when this provider answered because the chosen one failed. Another model of the same provider answers
    /// silently.
    pub fallback_from: Option<String>,
    pub tokens: Tokens,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RateLimit {
    pub status: String,
    pub utilization: Option<f64>,
    pub resets_at: Option<i64>,
    pub limit_type: Option<String>,
}

// `Done` is much larger than the other events, but each event lives only until it is sent: boxing it would only add
// an allocation.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TranslateEvent {
    Started {
        warm: bool,
    },
    Thinking,
    Delta {
        sections: Sections,
    },
    Done {
        sections: Sections,
        timing: Timing,
        rate_limit: Option<RateLimit>,
    },
    Error {
        kind: ErrorKind,
        message: String,
        /// Which provider failed (filled in by the router).
        provider: Option<String>,
    },
    /// After `Done`: where the translation was filed in the history.
    Saved {
        message_id: i64,
        thread_id: i64,
    },
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    NotInstalled,
    NotLoggedIn,
    RateLimited,
    Cancelled,
    Timeout,
    Cli,
    /// ChatGPT or Gemini chosen but no API key saved.
    MissingKey,
    /// The vendor rejected the API key.
    BadKey,
    /// Could not reach the vendor.
    Network,
    /// The vendor refuses MyTranslate's use of its tool (Claude Code, Codex) with the user's plan; the account
    /// itself is fine.
    Blocked,
}

struct Process {
    child: Child,
    stdin: ChildStdin,
    lines: Lines<BufReader<ChildStdout>>,
    stderr: Arc<Mutex<String>>,
    model: String,
    started: Instant,
}

pub struct ClaudeCli {
    /// Found again after MyTranslate installs Claude Code.
    exe: std::sync::RwLock<PathBuf>,
    workdir: PathBuf,
    model: std::sync::Mutex<String>,
    spare: Mutex<Option<Process>>,
    cancels: std::sync::Mutex<HashMap<u64, oneshot::Sender<()>>>,
    /// Requests cancelled before they reached `translate` (the page cancels as soon as it no longer needs a
    /// result, which can be before the translate call is being handled). They never start.
    cancelled_early: std::sync::Mutex<std::collections::HashSet<u64>>,
    next_id: AtomicU64,
}

impl ClaudeCli {
    pub fn new(workdir: PathBuf, model: &str) -> Arc<Self> {
        let _ = std::fs::create_dir_all(&workdir);
        Arc::new(Self {
            exe: std::sync::RwLock::new(find_claude()),
            workdir,
            model: std::sync::Mutex::new(model.to_string()),
            spare: Mutex::new(None),
            cancels: std::sync::Mutex::new(HashMap::new()),
            cancelled_early: std::sync::Mutex::new(std::collections::HashSet::new()),
            next_id: AtomicU64::new(1),
        })
    }

    pub fn exe(&self) -> PathBuf {
        self.exe.read().unwrap().clone()
    }

    /// Looks for `claude` again (it was just installed) and boots a spare with it.
    pub fn relocate(self: &Arc<Self>) {
        *self.exe.write().unwrap() = find_claude();
        self.refill();
    }

    fn current_model(&self) -> String {
        self.model.lock().unwrap().clone()
    }

    /// Changes the model; the booted spare uses the old one, so it is replaced.
    pub async fn set_model(self: &Arc<Self>, model: &str) {
        *self.model.lock().unwrap() = model.to_string();
        if let Some(mut old) = self.spare.lock().await.take() {
            let _ = old.child.start_kill();
        }
        self.refill();
    }

    /// Boots a spare in the background if there is none. Called at start-up and after every request.
    pub fn refill(self: &Arc<Self>) {
        let me = self.clone();
        tauri::async_runtime::spawn(async move {
            let mut spare = me.spare.lock().await;
            if spare.is_some() {
                return;
            }
            match me.spawn_process(&me.current_model()) {
                Ok(p) => *spare = Some(p),
                Err(e) => log::warn!("could not boot a spare claude process: {e}"),
            }
        });
    }

    /// Replaces spares that sat idle too long. Runs for the life of the app.
    pub fn keep_fresh(self: &Arc<Self>) {
        let me = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(60)).await;
                let mut spare = me.spare.lock().await;
                if spare.as_ref().is_some_and(|p| p.started.elapsed() > SPARE_MAX_AGE) {
                    if let Some(mut old) = spare.take() {
                        let _ = old.child.start_kill();
                    }
                    drop(spare);
                    me.refill();
                }
            }
        });
    }

    pub fn cancel(&self, request_id: u64) {
        match self.cancels.lock().unwrap().remove(&request_id) {
            Some(tx) => {
                let _ = tx.send(());
            }
            None => {
                self.cancelled_early.lock().unwrap().insert(request_id);
            }
        }
    }

    #[cfg(test)]
    fn spare_is_empty(&self) -> bool {
        self.spare.try_lock().map(|s| s.is_none()).unwrap_or(false)
    }

    pub fn next_request_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }

    /// Runs one translation, reporting progress through `emit`. Always ends with `Done` or `Error`.
    /// `model` overrides the configured model for this request (a spare booted with another model is not used).
    pub async fn translate(
        self: &Arc<Self>,
        request_id: u64,
        req: TranslateRequest,
        model: Option<&str>,
        emit: impl Fn(TranslateEvent),
    ) {
        let start = Instant::now();
        // Registered first, so a cancel from here on stops the request; one that came earlier is honoured too.
        let (cancel_tx, mut cancel_rx) = oneshot::channel();
        {
            let mut cancels = self.cancels.lock().unwrap();
            if self.cancelled_early.lock().unwrap().remove(&request_id) {
                drop(cancels);
                emit(TranslateEvent::Error {
                    provider: None,
                    kind: ErrorKind::Cancelled,
                    message: "cancelled".into(),
                });
                return;
            }
            cancels.insert(request_id, cancel_tx);
        }
        let model = model.map(str::to_string).unwrap_or_else(|| self.current_model());

        let taken = self.spare.lock().await.take().filter(|p| p.model == model);
        let warm = taken.is_some();
        let process = match taken {
            Some(p) => Ok(p),
            None => self.spawn_process(&model),
        };
        // Boot the next spare right away, while this request runs.
        self.refill();

        let mut process = match process {
            Ok(p) => p,
            Err(e) => {
                let kind = if e.kind() == std::io::ErrorKind::NotFound {
                    ErrorKind::NotInstalled
                } else {
                    ErrorKind::Cli
                };
                self.cancels.lock().unwrap().remove(&request_id);
                emit(TranslateEvent::Error {
                    provider: None,
                    kind,
                    message: e.to_string(),
                });
                return;
            }
        };
        // Cancelled while waiting for a process: nothing was sent, so keep the process for the next request.
        if cancel_rx.try_recv().is_ok() {
            let mut spare = self.spare.lock().await;
            if spare.is_none() {
                *spare = Some(process);
            } else {
                let _ = process.child.start_kill();
            }
            drop(spare);
            emit(TranslateEvent::Error {
                provider: None,
                kind: ErrorKind::Cancelled,
                message: "cancelled".into(),
            });
            return;
        }
        emit(TranslateEvent::Started { warm });

        let message = serde_json::json!({
            "type": "user",
            "message": { "role": "user", "content": prompt::user_message(&req) },
        });
        let outcome = async {
            process.stdin.write_all(format!("{message}\n").as_bytes()).await?;
            process.stdin.flush().await?;
            Ok::<_, std::io::Error>(())
        }
        .await;
        if let Err(e) = outcome {
            self.cancels.lock().unwrap().remove(&request_id);
            emit(TranslateEvent::Error {
                provider: None,
                kind: ErrorKind::Cli,
                message: format!("could not send the request: {e}"),
            });
            let _ = process.child.start_kill();
            return;
        }

        let mut parser = StreamParser::default();
        let mut first_token_ms = None;
        let mut thought = false;
        let mut rate_limit = None;
        let mut tokens = Tokens::default();
        let deadline = tokio::time::sleep(REQUEST_TIMEOUT);
        tokio::pin!(deadline);

        let result = loop {
            let line = tokio::select! {
                line = process.lines.next_line() => line,
                _ = &mut cancel_rx => break Err((ErrorKind::Cancelled, "cancelled".to_string())),
                _ = &mut deadline => break Err((ErrorKind::Timeout, "Claude did not answer in time".to_string())),
            };
            let line = match line {
                Ok(Some(l)) => l,
                Ok(None) | Err(_) => {
                    let stderr = process.stderr.lock().await.clone();
                    break Err(classify_failure(&stderr));
                }
            };
            let Ok(msg) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            match msg["type"].as_str() {
                Some("stream_event") => {
                    let event = &msg["event"];
                    if event["type"] == "content_block_start"
                        && event["content_block"]["type"] == "thinking"
                        && !thought
                    {
                        thought = true;
                        emit(TranslateEvent::Thinking);
                    }
                    if event["type"] == "content_block_delta"
                        && event["delta"]["type"] == "text_delta"
                        && let Some(text) = event["delta"]["text"].as_str()
                    {
                        first_token_ms.get_or_insert(start.elapsed().as_millis() as u64);
                        emit(TranslateEvent::Delta {
                            sections: parser.push(text),
                        });
                    }
                }
                Some("rate_limit_event") => rate_limit = Some(parse_rate_limit(&msg["rate_limit_info"])),
                Some("system") => {
                    if let Some(message) = unreachable(&msg) {
                        break Err((ErrorKind::Network, message));
                    }
                }
                Some("result") => {
                    if msg["is_error"].as_bool().unwrap_or(false) || msg["subtype"] != "success" {
                        let text = msg["result"].as_str().unwrap_or("Claude returned an error").to_string();
                        break Err(classify_failure(&text));
                    }
                    tokens = usage(&msg["usage"]);
                    // The final text is authoritative in case a delta was missed.
                    let full = msg["result"].as_str().unwrap_or(parser.raw()).to_string();
                    break Ok(super::stream_parser::parse(&full));
                }
                _ => {}
            }
        };

        self.cancels.lock().unwrap().remove(&request_id);
        let _ = process.child.start_kill();

        match result {
            Ok(sections) => emit(TranslateEvent::Done {
                sections,
                timing: Timing {
                    first_token_ms,
                    total_ms: start.elapsed().as_millis() as u64,
                    thought,
                    warm,
                    model,
                    prompt_version: prompt::PROMPT_VERSION,
                    provider: "claude".into(),
                    fallback_from: None,
                    tokens,
                },
                rate_limit,
            }),
            Err((kind, message)) => emit(TranslateEvent::Error {
                provider: None,
                kind,
                message,
            }),
        }
    }

    fn spawn_process(&self, model: &str) -> std::io::Result<Process> {
        let mut cmd = Command::new(self.exe());
        cmd.args([
            "-p",
            "--safe-mode",
            "--tools",
            "",
            "--no-session-persistence",
            "--effort",
            "low",
            "--model",
            model,
            "--system-prompt",
            prompt::SYSTEM_PROMPT,
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
        ])
        .current_dir(&self.workdir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
        // Variables set by a parent Claude Code session (when developing inside one) must not leak in.
        for (key, _) in std::env::vars() {
            if key.starts_with("CLAUDE") {
                cmd.env_remove(key);
            }
        }
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let mut child = cmd.spawn()?;
        let stdin = child.stdin.take().expect("stdin is piped");
        let stdout = child.stdout.take().expect("stdout is piped");
        let mut stderr_pipe = child.stderr.take().expect("stderr is piped");
        let stderr = Arc::new(Mutex::new(String::new()));
        let sink = stderr.clone();
        tauri::async_runtime::spawn(async move {
            let mut buf = vec![0u8; 4096];
            while let Ok(n) = stderr_pipe.read(&mut buf).await {
                if n == 0 {
                    break;
                }
                let mut s = sink.lock().await;
                if s.len() < 8192 {
                    s.push_str(&String::from_utf8_lossy(&buf[..n]));
                }
            }
        });
        Ok(Process {
            child,
            stdin,
            lines: BufReader::new(stdout).lines(),
            stderr,
            model: model.to_string(),
            started: Instant::now(),
        })
    }
}

fn parse_rate_limit(v: &Value) -> RateLimit {
    RateLimit {
        status: v["status"].as_str().unwrap_or("unknown").to_string(),
        utilization: v["utilization"].as_f64(),
        resets_at: v["resetsAt"].as_i64(),
        limit_type: v["rateLimitType"].as_str().map(str::to_string),
    }
}

/// Whether the vendor's answer says this use of its tool is not allowed (as opposed to a signed-out account). The
/// exact wording is not documented; these are the phrases such refusals have used.
pub fn refused_by_vendor(lower: &str) -> bool {
    [
        "third-party",
        "third party",
        "not permitted",
        "only authorized for use",
        "not allowed to use",
        "unauthorized client",
    ]
    .iter()
    .any(|p| lower.contains(p))
}

/// Claude Code retries a request it could not send for minutes, silently. When the server stays out of reach (no
/// HTTP answer at all, or a proxy asking for credentials) for a few attempts, the network is the problem: say so
/// now instead of after the request timeout. Server errors (overloaded, 5xx) are left to Claude Code's retries.
fn unreachable(msg: &Value) -> Option<String> {
    if msg["subtype"] != "api_retry" || msg["attempt"].as_u64().unwrap_or(0) < NETWORK_ATTEMPTS {
        return None;
    }
    let status = msg["error_status"].as_u64();
    if status.is_some_and(|s| s != 407) {
        return None;
    }
    let error = msg["error"].as_str().unwrap_or("unknown");
    Some(match status {
        Some(s) => format!("Could not reach Claude: proxy answered {s} ({error})"),
        None => format!("Could not reach Claude ({error})"),
    })
}

fn classify_failure(text: &str) -> (ErrorKind, String) {
    let lower = text.to_lowercase();
    let kind = if refused_by_vendor(&lower) {
        ErrorKind::Blocked
    } else if lower.contains("login")
        || lower.contains("log in")
        || lower.contains("authenticat")
        || lower.contains("oauth")
    {
        ErrorKind::NotLoggedIn
    } else if lower.contains("rate limit") || lower.contains("usage limit") || lower.contains("limit reached") {
        ErrorKind::RateLimited
    } else {
        ErrorKind::Cli
    };
    let message = if text.trim().is_empty() {
        "the claude process exited unexpectedly".to_string()
    } else {
        text.trim().to_string()
    };
    (kind, message)
}

/// Finds `claude.exe` on PATH, falling back to the default per-user install location.
pub fn find_claude() -> PathBuf {
    let name = if cfg!(windows) { "claude.exe" } else { "claude" };
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return candidate;
            }
        }
    }
    if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        let candidate = PathBuf::from(home).join(".local").join("bin").join(name);
        if candidate.is_file() {
            return candidate;
        }
    }
    PathBuf::from(name)
}

/// The token counts of a `result` message. Anthropic counts the cached part of the prompt apart from `input_tokens`.
fn usage(u: &Value) -> Tokens {
    if !u.is_object() {
        return Tokens::default();
    }
    let n = |key: &str| u[key].as_u64().unwrap_or(0);
    let cached = n("cache_read_input_tokens");
    Tokens {
        input: Some(n("input_tokens") + n("cache_creation_input_tokens") + cached),
        cached: Some(cached),
        output: u["output_tokens"].as_u64(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usage_counts_the_cached_prompt_as_input() {
        let u: Value = serde_json::from_str(
            r#"{"input_tokens":12,"cache_creation_input_tokens":0,"cache_read_input_tokens":1400,"output_tokens":75}"#,
        )
        .unwrap();
        assert_eq!(
            usage(&u),
            Tokens {
                input: Some(1412),
                cached: Some(1400),
                output: Some(75)
            }
        );
        assert_eq!(usage(&Value::Null), Tokens::default());
    }

    #[test]
    fn a_request_cancelled_before_it_starts_never_runs() {
        let cli = ClaudeCli::new(std::env::temp_dir().join("mytranslate-cancel-test"), "sonnet");
        let id = cli.next_request_id();
        cli.cancel(id);
        let events = std::sync::Mutex::new(Vec::new());
        tauri::async_runtime::block_on(cli.translate(
            id,
            TranslateRequest::task(prompt::Direction::JaVi, "確認しました", prompt::Keigo::Formal),
            None,
            |e| events.lock().unwrap().push(e),
        ));
        let events = events.into_inner().unwrap();
        assert!(matches!(
            events.as_slice(),
            [TranslateEvent::Error {
                provider: None,
                kind: ErrorKind::Cancelled,
                ..
            }]
        ));
        // Nothing was started, and the cancellation is used up.
        assert!(cli.spare_is_empty());
        assert!(cli.cancelled_early.lock().unwrap().is_empty());
    }

    #[test]
    fn classifies_login_errors() {
        assert_eq!(
            classify_failure("Invalid API key · Please run /login").0,
            ErrorKind::NotLoggedIn
        );
        assert_eq!(
            classify_failure("Claude AI usage limit reached").0,
            ErrorKind::RateLimited
        );
        assert_eq!(classify_failure("").0, ErrorKind::Cli);
        assert_eq!(
            classify_failure(
                "This credential is only authorized for use with Claude Code and cannot be used for other API requests."
            )
            .0,
            ErrorKind::Blocked
        );
    }

    #[test]
    fn gives_up_early_only_when_the_server_is_out_of_reach() {
        // As Claude Code 2.1 reports retries in stream-json.
        let retry = |attempt: u64, status: Value| {
            serde_json::json!({ "type": "system", "subtype": "api_retry", "attempt": attempt, "max_retries": 10,
                                "error_status": status, "error": "unknown" })
        };
        assert_eq!(unreachable(&retry(3, Value::Null)), None);
        assert_eq!(
            unreachable(&retry(4, Value::Null)).as_deref(),
            Some("Could not reach Claude (unknown)")
        );
        assert!(unreachable(&retry(4, 407.into())).is_some());
        assert_eq!(unreachable(&retry(6, 529.into())), None);
        assert_eq!(
            unreachable(&serde_json::json!({ "type": "system", "subtype": "status", "attempt": 9 })),
            None
        );
    }
}
