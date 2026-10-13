//! ChatGPT through Codex, OpenAI's own command-line tool, signed in with the user's ChatGPT account: translations
//! count against their ChatGPT plan instead of an API key. MyTranslate never reads Codex's sign-in, it only runs the
//! unmodified `codex` program.
//!
//! One `codex exec` per request, read-only and without the user's Codex config, so nothing of theirs (model,
//! effort, MCP servers, rules) changes what a translation costs or how long it takes. The prompt goes in on stdin;
//! the answer comes back as JSON events. Effort: the least the model accepts, found once per model like the APIs.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::oneshot;

use super::claude_cli::{ErrorKind, Timing, TranslateEvent};
use super::stream_parser::StreamParser;
use crate::history::Tokens;
use crate::prompt::{self, TranslateRequest};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(90);
/// Windows: do not flash a console window for the child process.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// Lowest reasoning effort first; which one a model takes differs, so the first accepted is remembered.
const EFFORTS: [&str; 3] = ["none", "minimal", "low"];

/// Model used until the user picks one: the fastest the ChatGPT plans offer in Codex (2026-10). An assumption until
/// S1 is measured with a ChatGPT account (docs/tasks.md T3.3).
pub const DEFAULT_MODEL: &str = "gpt-5.6-luna";

pub struct CodexCli {
    workdir: PathBuf,
    /// Per model: index into `EFFORTS` known to be accepted.
    effort: Mutex<HashMap<String, usize>>,
}

/// One JSON event of `codex exec --json`, as far as a translation cares.
#[derive(Debug, PartialEq)]
enum Event {
    /// The answer so far (Codex sends the whole message, not a delta).
    Message(String),
    Thinking,
    Usage(Tokens),
    Failed(String),
    Nothing,
}

enum Failure {
    EffortRejected,
    Fatal(ErrorKind, String),
}

impl CodexCli {
    pub fn new(workdir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&workdir);
        Self {
            workdir,
            effort: Mutex::new(HashMap::new()),
        }
    }

    /// Runs one translation, reporting progress through `emit`. Always ends with `Done` or `Error`.
    pub async fn translate(
        &self,
        model: &str,
        req: &TranslateRequest,
        mut cancel: oneshot::Receiver<()>,
        emit: &(dyn Fn(TranslateEvent) + Send + Sync),
    ) {
        let Some(exe) = find_codex() else {
            emit(error(ErrorKind::NotInstalled, "Codex is not installed"));
            return;
        };
        let start = Instant::now();
        let mut index = self.effort.lock().unwrap().get(model).copied().unwrap_or(0);
        emit(TranslateEvent::Started { warm: false });
        loop {
            match self.attempt(&exe, model, EFFORTS[index], req, start, &mut cancel, emit).await {
                Ok(()) => {
                    self.effort.lock().unwrap().insert(model.to_string(), index);
                    return;
                }
                Err(Failure::EffortRejected) if index + 1 < EFFORTS.len() => {
                    log::info!("codex {model}: effort {} rejected, trying the next", EFFORTS[index]);
                    index += 1;
                }
                Err(Failure::EffortRejected) => {
                    emit(error(ErrorKind::Cli, "The model rejected every reasoning effort"));
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
        exe: &Path,
        model: &str,
        effort: &str,
        req: &TranslateRequest,
        start: Instant,
        cancel: &mut oneshot::Receiver<()>,
        emit: &(dyn Fn(TranslateEvent) + Send + Sync),
    ) -> Result<(), Failure> {
        let mut cmd = Command::new(exe);
        cmd.args(exec_args(model, effort, &self.workdir))
            .current_dir(&self.workdir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        let mut child = cmd.spawn().map_err(|e| {
            let kind = if e.kind() == std::io::ErrorKind::NotFound {
                ErrorKind::NotInstalled
            } else {
                ErrorKind::Cli
            };
            Failure::Fatal(kind, format!("Could not start Codex: {e}"))
        })?;

        let input = format!("{}\n\n{}", prompt::SYSTEM_PROMPT, prompt::user_message(req));
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(input.as_bytes()).await;
            // Closing stdin tells `codex exec -` the prompt is complete.
            drop(stdin);
        }
        let stdout = child.stdout.take().expect("piped stdout");
        let stderr = child.stderr.take().expect("piped stderr");
        let mut lines = BufReader::new(stdout).lines();

        let mut parser = StreamParser::default();
        let mut shown = 0usize;
        let mut first_token_ms = None;
        let mut thought = false;
        let mut tokens = Tokens::default();
        let deadline = tokio::time::sleep(REQUEST_TIMEOUT);
        tokio::pin!(deadline);
        loop {
            let line = tokio::select! {
                l = lines.next_line() => l,
                _ = &mut *cancel => return Err(Failure::Fatal(ErrorKind::Cancelled, "cancelled".into())),
                _ = &mut deadline => return Err(Failure::Fatal(ErrorKind::Timeout, "Codex did not answer in time".into())),
            };
            let Ok(Some(line)) = line else { break };
            let Ok(msg) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            match read_event(&msg) {
                Event::Message(text) => {
                    // Whole message so far: pass on only what is new.
                    if let Some(new) = text.get(shown..).filter(|n| !n.is_empty()) {
                        if first_token_ms.is_none() {
                            first_token_ms = Some(start.elapsed().as_millis() as u64);
                        }
                        shown = text.len();
                        emit(TranslateEvent::Delta {
                            sections: parser.push(new),
                        });
                    }
                }
                Event::Thinking => {
                    if !thought && first_token_ms.is_none() {
                        emit(TranslateEvent::Thinking);
                    }
                    thought = true;
                }
                Event::Usage(t) => tokens = t,
                Event::Failed(message) => {
                    if first_token_ms.is_none() && rejects_effort(&message) {
                        return Err(Failure::EffortRejected);
                    }
                    let (kind, message) = classify(&message);
                    return Err(Failure::Fatal(kind, message));
                }
                Event::Nothing => {}
            }
        }

        let status = child.wait().await.ok();
        if parser.raw().trim().is_empty() {
            let mut err = String::new();
            let _ = tokio::io::AsyncReadExt::read_to_string(&mut BufReader::new(stderr), &mut err).await;
            let err = err.trim();
            if first_token_ms.is_none() && rejects_effort(err) {
                return Err(Failure::EffortRejected);
            }
            let (kind, message) = classify(if err.is_empty() { "Codex returned no text" } else { err });
            log::warn!("codex exited with {status:?}: {message}");
            return Err(Failure::Fatal(kind, message));
        }
        emit(TranslateEvent::Done {
            sections: super::stream_parser::parse(parser.raw()),
            timing: Timing {
                first_token_ms,
                total_ms: start.elapsed().as_millis() as u64,
                thought,
                warm: false,
                model: model.to_string(),
                prompt_version: prompt::PROMPT_VERSION,
                provider: "codex".into(),
                fallback_from: None,
                tokens,
            },
            rate_limit: None,
        });
        Ok(())
    }
}

/// `codex exec` for one translation: JSON events, nothing saved, read-only, none of the user's config or rules,
/// the prompt on stdin.
fn exec_args(model: &str, effort: &str, workdir: &Path) -> Vec<String> {
    let mut args: Vec<String> = [
        "exec",
        "--json",
        "--ephemeral",
        "--skip-git-repo-check",
        "--ignore-user-config",
        "--ignore-rules",
        "--sandbox",
        "read-only",
        "--color",
        "never",
        "--model",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    args.push(model.to_string());
    args.push("-c".into());
    args.push(format!("model_reasoning_effort=\"{effort}\""));
    args.push("--cd".into());
    args.push(workdir.display().to_string());
    args.push("-".into());
    args
}

fn read_event(msg: &Value) -> Event {
    let item = &msg["item"];
    match msg["type"].as_str().unwrap_or_default() {
        "item.started" | "item.updated" | "item.completed" => match item["type"].as_str().unwrap_or_default() {
            "agent_message" => match item["text"].as_str() {
                Some(t) if !t.is_empty() => Event::Message(t.to_string()),
                _ => Event::Nothing,
            },
            "reasoning" => Event::Thinking,
            "error" => Event::Failed(item["message"].as_str().unwrap_or("Codex error").to_string()),
            _ => Event::Nothing,
        },
        "turn.completed" => {
            let u = &msg["usage"];
            Event::Usage(Tokens {
                input: u["input_tokens"].as_u64(),
                cached: u["cached_input_tokens"].as_u64(),
                output: u["output_tokens"].as_u64(),
            })
        }
        "turn.failed" => Event::Failed(
            msg["error"]["message"]
                .as_str()
                .unwrap_or("The request failed")
                .to_string(),
        ),
        "error" => Event::Failed(msg["message"].as_str().unwrap_or("Codex error").to_string()),
        _ => Event::Nothing,
    }
}

fn rejects_effort(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("reasoning") && (lower.contains("effort") || lower.contains("unsupported"))
}

/// Codex's error text to an error kind the popup explains.
fn classify(message: &str) -> (ErrorKind, String) {
    let lower = message.to_lowercase();
    let kind = if lower.contains("log in")
        || lower.contains("login")
        || lower.contains("sign in")
        || lower.contains("access token")
        || lower.contains("not logged")
        || lower.contains("401")
    {
        ErrorKind::NotLoggedIn
    } else if lower.contains("usage limit") || lower.contains("rate limit") || lower.contains("quota") || lower.contains("429")
    {
        ErrorKind::RateLimited
    } else if lower.contains("stream disconnected") || lower.contains("error sending request") || lower.contains("connect")
    {
        ErrorKind::Network
    } else {
        ErrorKind::Cli
    };
    (kind, message.chars().take(300).collect())
}

fn error(kind: ErrorKind, message: &str) -> TranslateEvent {
    TranslateEvent::Error {
        kind,
        message: message.to_string(),
        provider: None,
    }
}

/// Where `codex.exe` is: on PATH, the copy MyTranslate installs, or the one that comes with the Codex desktop app.
pub fn find_codex() -> Option<PathBuf> {
    let name = if cfg!(windows) { "codex.exe" } else { "codex" };
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from)?;
    let installed = installed_path(&local);
    if installed.is_file() {
        return Some(installed);
    }
    // The desktop app keeps its CLI in a folder per build; the newest one is the one it runs.
    std::fs::read_dir(local.join("OpenAI").join("Codex").join("bin"))
        .ok()?
        .filter_map(Result::ok)
        .map(|d| d.path().join(name))
        .filter(|p| p.is_file())
        .max_by_key(|p| p.metadata().and_then(|m| m.modified()).ok())
}

/// Where MyTranslate puts Codex when it installs it for the user.
pub fn installed_path(local_app_data: &Path) -> PathBuf {
    local_app_data.join("MyTranslate").join("tools").join("codex.exe")
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexStatus {
    pub path: Option<String>,
    pub version: Option<String>,
    /// From `codex login status`. Codex can still refuse an expired sign-in, so a test translation is the proof.
    pub logged_in: Option<bool>,
}

/// Is Codex installed, and does it say it is signed in with ChatGPT.
pub async fn status() -> CodexStatus {
    let Some(exe) = find_codex() else {
        return CodexStatus {
            path: None,
            version: None,
            logged_in: None,
        };
    };
    let version = run(&exe, &["--version"]).await.ok().map(|o| o.trim().to_string());
    let logged_in = match version {
        Some(_) => run(&exe, &["login", "status"])
            .await
            .map(|o| o.to_lowercase().contains("chatgpt"))
            .ok(),
        None => None,
    };
    CodexStatus {
        path: Some(exe.display().to_string()),
        version,
        logged_in,
    }
}

/// A short Codex command without a console window; stdout and stderr together (Codex prints status on either).
async fn run(exe: &Path, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new(exe);
    cmd.args(args).kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let out = tokio::time::timeout(Duration::from_secs(20), cmd.output())
        .await
        .map_err(|_| "timed out".to_string())?
        .map_err(|e| e.to_string())?;
    let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    if out.status.success() { Ok(text) } else { Err(text) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_the_events_a_translation_needs() {
        let message = json!({ "type": "item.completed", "item": { "id": "item_1", "type": "agent_message", "text": "<translation>Xin chào</translation>" } });
        assert_eq!(read_event(&message), Event::Message("<translation>Xin chào</translation>".into()));
        let reasoning = json!({ "type": "item.started", "item": { "id": "item_0", "type": "reasoning", "text": "" } });
        assert_eq!(read_event(&reasoning), Event::Thinking);
        let usage = json!({ "type": "turn.completed", "usage": { "input_tokens": 1500, "cached_input_tokens": 1000, "output_tokens": 80 } });
        assert_eq!(
            read_event(&usage),
            Event::Usage(Tokens {
                input: Some(1500),
                cached: Some(1000),
                output: Some(80)
            })
        );
        let failed = json!({ "type": "turn.failed", "error": { "message": "You've hit your usage limit." } });
        assert_eq!(read_event(&failed), Event::Failed("You've hit your usage limit.".into()));
        assert_eq!(read_event(&json!({ "type": "thread.started", "thread_id": "t" })), Event::Nothing);
    }

    #[test]
    fn errors_map_to_what_the_user_can_fix() {
        assert_eq!(
            classify("Your access token could not be refreshed. Please log out and sign in again.").0,
            ErrorKind::NotLoggedIn
        );
        assert_eq!(classify("You've hit your usage limit. Try again in 3 hours.").0, ErrorKind::RateLimited);
        assert_eq!(classify("stream disconnected before completion").0, ErrorKind::Network);
        assert!(rejects_effort("Unsupported value: 'none' is not supported with this model for reasoning.effort"));
        assert!(!rejects_effort("You've hit your usage limit."));
    }

    /// Runs the real Codex on this PC: it must translate, or say a reason the user can act on (not installed,
    /// signed out, out of quota). `cargo test -- --ignored live_codex --nocapture`
    #[test]
    #[ignore = "runs Codex"]
    fn live_codex_translates_or_says_why() {
        use crate::prompt::{Direction, Keigo};
        let codex = CodexCli::new(std::env::temp_dir().join("mytranslate-codex-test"));
        let (_tx, rx) = oneshot::channel();
        let events = std::sync::Mutex::new(Vec::new());
        let req = TranslateRequest::task(Direction::JaVi, "確認しました。ありがとうございます。", Keigo::Polite);
        tauri::async_runtime::block_on(codex.translate(DEFAULT_MODEL, &req, rx, &|e| events.lock().unwrap().push(e)));
        let events = events.into_inner().unwrap();
        let last = events.last().unwrap();
        eprintln!("{last:?}");
        assert!(
            matches!(
                last,
                TranslateEvent::Done { .. }
                    | TranslateEvent::Error {
                        kind: ErrorKind::NotInstalled | ErrorKind::NotLoggedIn | ErrorKind::RateLimited,
                        ..
                    }
            ),
            "{last:?}"
        );
    }

    #[test]
    fn runs_read_only_without_the_users_config_and_takes_the_prompt_on_stdin() {
        let args = exec_args("gpt-x", "minimal", Path::new("C:/work"));
        for flag in ["--json", "--ephemeral", "--ignore-user-config", "--ignore-rules", "read-only"] {
            assert!(args.iter().any(|a| a == flag), "{flag}");
        }
        assert!(args.windows(2).any(|w| w == ["--model", "gpt-x"]));
        assert!(args.iter().any(|a| a == "model_reasoning_effort=\"minimal\""));
        assert_eq!(args.last().map(String::as_str), Some("-"));
    }
}
