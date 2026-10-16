//! SP5: runs a fixed set of sentences through the app's real prompt and Claude Code setup, and writes a
//! Markdown sheet for a BrSE to score (1-5) each result. Every case is one request on the user's Claude plan.
//!
//!   cargo run --example prompt_eval -- cases.json results.md
//!   PROVIDER=gemini GEMINI_API_KEY=... cargo run --example prompt_eval -- cases.json results-gemini.md

use std::sync::{Arc, Mutex};

use mytranslate_lib::lang::Lang;
use mytranslate_lib::prompt::{Direction, Keigo, PROMPT_VERSION, TranslateRequest};
use mytranslate_lib::provider::claude_cli::{ClaudeCli, TranslateEvent};
use mytranslate_lib::provider::http_api::Api;
use mytranslate_lib::provider::{Route, Router};
use serde::Deserialize;

#[derive(Deserialize)]
struct Cases {
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct Case {
    id: String,
    direction: Direction,
    #[serde(default = "formal")]
    keigo: Keigo,
    text: String,
    /// The user's language: `ja` for a Japanese user chatting with Vietnamese colleagues.
    #[serde(default)]
    user: Lang,
}

fn formal() -> Keigo {
    Keigo::Formal
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [input, output] = args.as_slice() else {
        eprintln!("usage: prompt_eval <cases.json> <results.md>");
        std::process::exit(2);
    };
    let cases: Cases = serde_json::from_str(&std::fs::read_to_string(input).expect("read cases")).expect("parse cases");
    // PROVIDER=claude (default, Claude Code), codex (Codex signed in with ChatGPT), anthropic, openai or gemini
    // (key in ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY).
    let provider = std::env::var("PROVIDER").unwrap_or_else(|_| "claude".into());
    let codex = provider == "codex";
    let api = match provider.as_str() {
        "anthropic" => Some(Api::Anthropic),
        "openai" => Some(Api::OpenAi),
        "gemini" => Some(Api::Gemini),
        _ => None,
    };
    let model = std::env::var("MODEL").unwrap_or_else(|_| match api {
        Some(api) => api.default_model().to_string(),
        None if codex => mytranslate_lib::provider::codex_cli::DEFAULT_MODEL.into(),
        None => "sonnet".into(),
    });
    let route = match api {
        None if codex => Route::Codex { model: model.clone() },
        None => Route::Claude { model: None },
        Some(api) => Route::Api {
            api,
            model: model.clone(),
            key: std::env::var(format!("{}_API_KEY", api.id().to_uppercase())).ok(),
            // Measures exactly this model.
            more_models: false,
        },
    };

    let runtime = tokio::runtime::Runtime::new().unwrap();
    let rows = runtime.block_on(async {
        let workdir = std::env::temp_dir().join("mytranslate-prompt-eval");
        let cli = ClaudeCli::new(workdir, &model);
        if api.is_none() && !codex {
            cli.refill();
        }
        let router = Router::new(cli, std::env::temp_dir().join("mytranslate-prompt-eval-codex"));
        let mut rows = Vec::new();
        for case in &cases.cases {
            let mut req = TranslateRequest::task(case.direction, &case.text, case.keigo);
            req.user_lang = case.user;
            let done: Arc<Mutex<Option<TranslateEvent>>> = Arc::default();
            let out = done.clone();
            router
                .translate(router.next_request_id(), req, std::slice::from_ref(&route), move |e| {
                    if matches!(e, TranslateEvent::Done { .. } | TranslateEvent::Error { .. }) {
                        *out.lock().unwrap() = Some(e);
                    }
                })
                .await;
            let event = done.lock().unwrap().take();
            eprintln!(
                "{}: {}",
                case.id,
                if matches!(event, Some(TranslateEvent::Done { .. })) {
                    "ok"
                } else {
                    "failed"
                }
            );
            rows.push((case, event));
        }
        rows
    });

    let mut md = format!(
        "# SP5 - Kết quả dịch để chấm điểm\n\nModel: `{model}` · PROMPT_VERSION {PROMPT_VERSION} · {} câu\n\n\
         Chấm mỗi câu từ 1 (sai nghĩa) đến 5 (gửi khách được ngay) vào cột Điểm; ghi lý do khi dưới 4.\n\n\
         | Mã | Hướng | Câu gốc | Kết quả | Đọc lại / nghĩa | Chữ đầu (ms) | Điểm | Ghi chú |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n",
        rows.len()
    );
    for (case, event) in rows {
        let direction = match case.direction {
            Direction::JaVi => format!("JA→VI ({:?})", case.keigo).to_lowercase(),
            Direction::ViJa => format!("VI→JA ({:?})", case.keigo).to_lowercase(),
            Direction::ReviewJa => format!("Kiểm tra JA ({:?})", case.keigo).to_lowercase(),
            Direction::ReviewVi => "kiểm tra vi".into(),
            Direction::WritingAdvice => "lời khuyên".into(),
        };
        let direction = match case.user {
            Lang::Vi => direction,
            Lang::Ja => format!("{direction}, người dùng Nhật"),
        };
        let (result, back, first) = match event {
            Some(TranslateEvent::Done {
                sections: s, timing, ..
            }) => match case.direction {
                Direction::ReviewJa | Direction::ReviewVi => (
                    format!("[{}] {}", s.verdict, s.suggestion),
                    format!("{} {}", s.suggestion_vi, s.issues.replace('\n', "; ")),
                    first(&timing),
                ),
                _ => (s.translation, s.back_translation, first(&timing)),
            },
            Some(TranslateEvent::Error { message, .. }) => (format!("LỖI: {message}"), String::new(), None),
            _ => ("LỖI: không có kết quả".into(), String::new(), None),
        };
        md.push_str(&format!(
            "| {} | {direction} | {} | {} | {} | {} |  |  |\n",
            case.id,
            cell(&case.text),
            cell(&result),
            cell(&back),
            first.map_or("-".into(), |(ms, thought)| if thought {
                format!("{ms} (thinking)")
            } else {
                ms.to_string()
            })
        ));
    }
    std::fs::write(output, md).expect("write results");
    eprintln!("wrote {output}");
}

/// Time to the first character, and whether the model thought before answering.
fn first(t: &mytranslate_lib::provider::claude_cli::Timing) -> Option<(u64, bool)> {
    t.first_token_ms.map(|ms| (ms, t.thought))
}

fn cell(s: &str) -> String {
    s.trim().replace('|', "\\|").replace('\n', "<br>")
}
