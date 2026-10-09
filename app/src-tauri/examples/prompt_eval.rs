//! SP5: runs a fixed set of sentences through the app's real prompt and Claude Code setup, and writes a
//! Markdown sheet for a BrSE to score (1-5) each result. Every case is one request on the user's Claude plan.
//!
//!   cargo run --example prompt_eval -- ../../spikes/sp5-prompt-quality/cases.json ../../spikes/sp5-prompt-quality/results.md

use std::sync::{Arc, Mutex};

use mytranslate_lib::prompt::{Direction, Keigo, PROMPT_VERSION, TranslateRequest};
use mytranslate_lib::provider::claude_cli::{ClaudeCli, TranslateEvent};
use serde::Deserialize;

#[derive(Deserialize)]
struct Cases {
    profile: String,
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct Case {
    id: String,
    direction: Direction,
    #[serde(default = "formal")]
    keigo: Keigo,
    text: String,
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
    let model = std::env::var("MODEL").unwrap_or_else(|_| "sonnet".into());

    let runtime = tokio::runtime::Runtime::new().unwrap();
    let rows = runtime.block_on(async {
        let workdir = std::env::temp_dir().join("mytranslate-prompt-eval");
        let cli = ClaudeCli::new(workdir, &model);
        cli.refill();
        let mut rows = Vec::new();
        for case in &cases.cases {
            let mut req = TranslateRequest::task(case.direction, &case.text, case.keigo);
            req.profile = cases.profile.clone();
            let done: Arc<Mutex<Option<TranslateEvent>>> = Arc::default();
            let out = done.clone();
            cli.translate(cli.next_request_id(), req, move |e| {
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
            Direction::JaVi => "JA→VI".to_string(),
            Direction::ViJa => format!("VI→JA ({:?})", case.keigo).to_lowercase(),
            Direction::ReviewJa => format!("Kiểm tra ({:?})", case.keigo).to_lowercase(),
            _ => "?".into(),
        };
        let (result, back, first) = match event {
            Some(TranslateEvent::Done {
                sections: s, timing, ..
            }) => match case.direction {
                Direction::ReviewJa => (
                    format!("[{}] {}", s.verdict, s.suggestion),
                    format!("{} {}", s.suggestion_vi, s.issues.replace('\n', "; ")),
                    timing.first_token_ms,
                ),
                _ => (s.translation, s.back_translation, timing.first_token_ms),
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
            first.map_or("-".into(), |v| v.to_string())
        ));
    }
    std::fs::write(output, md).expect("write results");
    eprintln!("wrote {output}");
}

fn cell(s: &str) -> String {
    s.trim().replace('|', "\\|").replace('\n', "<br>")
}
