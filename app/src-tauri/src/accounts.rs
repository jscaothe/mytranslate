//! Setting up the user's own AI account from the guide, without a terminal: install the vendor's unmodified tool
//! (Claude Code, Codex), start its own sign-in, and notice when it is done. The sign-in always completes on the
//! vendor's page; MyTranslate never sees or stores the credentials, it only asks the tool whether it is signed in.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use tokio::io::AsyncReadExt;
use tokio::process::{Child, Command};

use crate::provider::claude_cli::{ClaudeCli, find_claude};
use crate::provider::codex_cli;

/// Windows: do not flash a console window for the child process.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// How long the guide waits for the user to finish signing in on the vendor's page.
const LOGIN_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const POLL: Duration = Duration::from_millis(1500);
/// Anthropic's installer for the native Claude Code (no Node needed).
const CLAUDE_INSTALLER: &str = "https://claude.ai/install.ps1";
const CODEX_RELEASE: &str = "https://api.github.com/repos/openai/codex/releases/latest";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Account {
    Claude,
    Codex,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountStatus {
    installed: bool,
    version: Option<String>,
    /// What the tool says; `None` when it is missing or could not tell. A test translation is the real proof.
    logged_in: Option<bool>,
}

/// Download progress of an install; `percent` is `None` while it cannot be measured.
#[derive(Debug, Clone, Serialize)]
pub struct InstallProgress {
    percent: Option<u8>,
}

/// The sign-in running now, so the guide can stop it.
#[derive(Default)]
pub struct LoginState(Mutex<Option<Child>>);

#[tauri::command]
pub async fn account_status(cli: State<'_, Arc<ClaudeCli>>, account: Account) -> Result<AccountStatus, String> {
    Ok(match account {
        Account::Claude => claude_status(&cli.exe()).await,
        Account::Codex => {
            let s = codex_cli::status().await;
            AccountStatus {
                installed: s.version.is_some(),
                version: s.version,
                logged_in: s.logged_in,
            }
        }
    })
}

async fn claude_status(exe: &Path) -> AccountStatus {
    let version = output(exe, &["--version"])
        .await
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());
    // Signed out, `auth status` may exit with an error and still print its JSON.
    let logged_in = match version {
        Some(_) => output(exe, &["auth", "status"])
            .await
            .ok()
            .and_then(|o| serde_json::from_slice::<serde_json::Value>(&o.stdout).ok())
            .and_then(|v| v["loggedIn"].as_bool()),
        None => None,
    };
    AccountStatus {
        installed: version.is_some(),
        version,
        logged_in,
    }
}

/// Installs the vendor's tool for this Windows user (no administrator rights needed).
#[tauri::command]
pub async fn account_install(
    cli: State<'_, Arc<ClaudeCli>>,
    account: Account,
    on_progress: Channel<InstallProgress>,
) -> Result<(), String> {
    match account {
        Account::Claude => {
            let _ = on_progress.send(InstallProgress { percent: None });
            install_claude().await?;
            cli.relocate();
            Ok(())
        }
        Account::Codex => {
            let local = std::env::var_os("LOCALAPPDATA")
                .map(PathBuf::from)
                .ok_or("LOCALAPPDATA is not set")?;
            install_codex(&codex_cli::installed_path(&local), |percent| {
                let _ = on_progress.send(InstallProgress { percent });
            })
            .await
        }
    }
}

/// Runs Anthropic's PowerShell installer, hidden. It puts `claude.exe` in `%USERPROFILE%\.local\bin`.
async fn install_claude() -> Result<(), String> {
    let mut cmd = Command::new("powershell.exe");
    cmd.args([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        &format!("irm {CLAUDE_INSTALLER} | iex"),
    ])
    .stdin(Stdio::null())
    .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let out = tokio::time::timeout(Duration::from_secs(10 * 60), cmd.output())
        .await
        .map_err(|_| "The Claude Code installer did not finish in 10 minutes".to_string())?
        .map_err(|e| format!("Could not run PowerShell: {e}"))?;
    let found = find_claude();
    if out.status.success() && found.is_file() {
        return Ok(());
    }
    let mut why = String::from_utf8_lossy(&out.stderr).trim().to_string();
    if why.is_empty() {
        why = String::from_utf8_lossy(&out.stdout).trim().to_string();
    }
    Err(format!(
        "The Claude Code installer failed: {}",
        why.chars().take(400).collect::<String>()
    ))
}

/// The release file for this PC: the compressed Windows build, the smallest of OpenAI's downloads.
fn codex_asset_name() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "codex-aarch64-pc-windows-msvc.exe.zst"
    } else {
        "codex-x86_64-pc-windows-msvc.exe.zst"
    }
}

/// Downloads OpenAI's latest Codex build from GitHub, checks it against the SHA-256 GitHub publishes for it,
/// unpacks it and puts it at `target` in one step, so a half-written file is never run.
async fn install_codex(target: &Path, progress: impl Fn(Option<u8>)) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .user_agent("MyTranslate")
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    progress(None);
    let release: serde_json::Value = client
        .get(CODEX_RELEASE)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|e| format!("Could not look up the latest Codex: {e}"))?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let (url, size, digest) = pick_asset(&release, codex_asset_name())?;

    let res = client
        .get(&url)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|e| format!("Could not download Codex: {e}"))?;
    let total = res.content_length().unwrap_or(size).max(1);
    let mut hasher = Sha256::new();
    let mut packed = Vec::with_capacity(total as usize);
    let mut stream = res.bytes_stream();
    let mut last = None;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("The Codex download broke off: {e}"))?;
        hasher.update(&chunk);
        packed.extend_from_slice(&chunk);
        let percent = Some(((packed.len() as u64 * 100) / total).min(100) as u8);
        if percent != last {
            progress(percent);
            last = percent;
        }
    }
    let got = hex(&hasher.finalize());
    if got != digest {
        return Err(format!(
            "The Codex download is damaged (SHA-256 {got}, expected {digest})"
        ));
    }

    let dir = target.parent().ok_or("bad install path")?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let partial = target.with_extension("exe.partial");
    let unpacked = tokio::task::spawn_blocking(move || {
        let mut decoder = ruzstd::decoding::StreamingDecoder::new(packed.as_slice()).map_err(|e| e.to_string())?;
        let mut exe = Vec::new();
        std::io::Read::read_to_end(&mut decoder, &mut exe).map_err(|e| e.to_string())?;
        Ok::<_, String>(exe)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("Could not unpack Codex: {e}"))?;
    std::fs::write(&partial, unpacked).map_err(|e| e.to_string())?;
    std::fs::rename(&partial, target).map_err(|e| e.to_string())?;
    Ok(())
}

/// Download address, size and SHA-256 (lowercase hex) of `name` in a GitHub release.
fn pick_asset(release: &serde_json::Value, name: &str) -> Result<(String, u64, String), String> {
    let asset = release["assets"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|a| a["name"] == name)
        .ok_or_else(|| format!("The latest Codex release has no {name}"))?;
    let url = asset["browser_download_url"].as_str().ok_or("no download address")?;
    // Downloads only from GitHub's release storage.
    if !url.starts_with("https://github.com/openai/codex/releases/download/") {
        return Err(format!("Unexpected download address {url}"));
    }
    let digest = asset["digest"]
        .as_str()
        .and_then(|d| d.strip_prefix("sha256:"))
        .ok_or("The release does not publish a SHA-256 for Codex")?;
    Ok((
        url.to_string(),
        asset["size"].as_u64().unwrap_or(0),
        digest.to_lowercase(),
    ))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Starts the tool's own sign-in (it opens the vendor's page in the browser) and waits until the user has
/// finished there, then brings MyTranslate back to the front. Errors when it ends without a sign-in.
#[tauri::command]
pub async fn account_login(
    app: AppHandle,
    cli: State<'_, Arc<ClaudeCli>>,
    login: State<'_, LoginState>,
    account: Account,
) -> Result<(), String> {
    let exe = match account {
        Account::Claude => cli.exe(),
        Account::Codex => codex_cli::find_codex().ok_or("Codex is not installed")?,
    };
    let args: &[&str] = match account {
        Account::Claude => &["auth", "login"],
        Account::Codex => &["login"],
    };
    let mut cmd = Command::new(&exe);
    cmd.args(args)
        // Claude Code reads a pasted code from stdin when its own callback cannot be used; keep it open.
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let mut child = cmd.spawn().map_err(|e| format!("Could not start the sign-in: {e}"))?;
    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    // Keep the pipes drained so the tool never blocks on a full buffer; the text goes to the log only.
    let drain = tokio::spawn(async move {
        let mut text = String::new();
        if let Some(out) = stdout.as_mut() {
            let _ = out.read_to_string(&mut text).await;
        }
        if let Some(err) = stderr.as_mut() {
            let _ = err.read_to_string(&mut text).await;
        }
        text
    });
    *login.0.lock().unwrap() = Some(child);

    let started = std::time::Instant::now();
    let outcome = loop {
        tokio::time::sleep(POLL).await;
        let exited = {
            let mut guard = login.0.lock().unwrap();
            match guard.as_mut() {
                // Stopped by `account_login_cancel`.
                None => break Err("cancelled".to_string()),
                Some(child) => child.try_wait().ok().flatten(),
            }
        };
        let signed_in = match account {
            Account::Claude => claude_status(&exe).await.logged_in == Some(true),
            // Codex says "logged in" for an expired sign-in too; its login ending well is the signal.
            Account::Codex => exited.is_some_and(|s| s.success()),
        };
        if signed_in {
            break Ok(());
        }
        if let Some(status) = exited {
            break Err(format!("The sign-in ended without signing in ({status})"));
        }
        if started.elapsed() > LOGIN_TIMEOUT {
            break Err("The sign-in was not finished in 10 minutes".to_string());
        }
    };
    if let Some(mut child) = login.0.lock().unwrap().take() {
        let _ = child.start_kill();
    }
    if let Ok(text) = tokio::time::timeout(Duration::from_secs(2), drain).await {
        log::info!("{account:?} sign-in: {}", text.unwrap_or_default().trim());
    }
    if outcome.is_ok()
        && let Some(main) = app.get_webview_window("main")
    {
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
    outcome
}

/// Stops a sign-in in progress (the user went back or picked another way).
#[tauri::command]
pub fn account_login_cancel(login: State<'_, LoginState>) {
    if let Some(mut child) = login.0.lock().unwrap().take() {
        let _ = child.start_kill();
    }
}

async fn output(exe: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    let mut cmd = Command::new(exe);
    cmd.args(args).stdin(Stdio::null()).kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    tokio::time::timeout(Duration::from_secs(20), cmd.output())
        .await
        .map_err(|_| "timed out".to_string())?
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn picks_the_compressed_windows_build_with_its_checksum() {
        let release = json!({ "assets": [
            { "name": "codex-x86_64-pc-windows-msvc.exe", "size": 3, "digest": "sha256:aa",
              "browser_download_url": "https://github.com/openai/codex/releases/download/v1/codex-x86_64-pc-windows-msvc.exe" },
            { "name": "codex-x86_64-pc-windows-msvc.exe.zst", "size": 2, "digest": "sha256:ABCD",
              "browser_download_url": "https://github.com/openai/codex/releases/download/v1/codex-x86_64-pc-windows-msvc.exe.zst" }
        ] });
        let (url, size, digest) = pick_asset(&release, "codex-x86_64-pc-windows-msvc.exe.zst").unwrap();
        assert!(url.ends_with(".exe.zst"));
        assert_eq!((size, digest.as_str()), (2, "abcd"));
        assert!(pick_asset(&release, "codex-aarch64-pc-windows-msvc.exe.zst").is_err());
    }

    #[test]
    fn refuses_downloads_from_elsewhere_or_without_a_checksum() {
        let elsewhere = json!({ "assets": [{ "name": "x.zst", "digest": "sha256:aa",
            "browser_download_url": "https://example.com/x.zst" }] });
        assert!(pick_asset(&elsewhere, "x.zst").is_err());
        let unsigned = json!({ "assets": [{ "name": "x.zst",
            "browser_download_url": "https://github.com/openai/codex/releases/download/v1/x.zst" }] });
        assert!(pick_asset(&unsigned, "x.zst").is_err());
    }

    /// Downloads the real Codex into a temporary folder and runs it. `cargo test -- --ignored live_install --nocapture`
    #[test]
    #[ignore = "downloads about 80 MB"]
    fn live_installs_codex_from_github() {
        let dir = std::env::temp_dir().join("mytranslate-codex-install-test");
        let _ = std::fs::remove_dir_all(&dir);
        let target = dir.join("codex.exe");
        let seen = Mutex::new(Vec::new());
        tauri::async_runtime::block_on(install_codex(&target, |p| seen.lock().unwrap().push(p))).unwrap();
        let seen = seen.into_inner().unwrap();
        assert_eq!(seen.last(), Some(&Some(100)));
        let out = std::process::Command::new(&target).arg("--version").output().unwrap();
        let version = String::from_utf8_lossy(&out.stdout);
        eprintln!("installed: {version}");
        assert!(version.starts_with("codex-cli"), "{version}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn hex_matches_sha256_of_a_known_text() {
        assert_eq!(
            hex(&Sha256::digest(b"abc")),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
