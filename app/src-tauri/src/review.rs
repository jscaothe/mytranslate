//! What a review found, in a form that can be counted: each problem has a fixed kind, the words as written and
//! what to write instead. Collected over time, they show the user the mistakes they make most (the Writing tab).

use serde::{Deserialize, Serialize};

/// The kinds of problem a review reports; the app shows them in the user's language.
pub const KINDS: [&str; 6] = ["grammar", "politeness", "natural", "spelling", "word_choice", "other"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub kind: String,
    pub wrong: String,
    pub fix: String,
    pub explanation: String,
}

/// One problem per line as `kind || wrong || fix || explanation`. Tolerates the older `Kind: explanation` form and
/// a bare explanation, so a reply that strays from the format still keeps what it found.
pub fn parse_issues(text: &str) -> Vec<Issue> {
    text.lines()
        .map(|l| l.trim().trim_start_matches(['-', '•', '*', '・']).trim())
        .filter(|l| !l.is_empty())
        .map(|l| {
            let parts: Vec<&str> = l.split("||").map(str::trim).collect();
            match parts.as_slice() {
                [kind, wrong, fix, explanation, ..] => issue(kind, wrong, fix, explanation),
                [kind, wrong, fix] => issue(kind, wrong, fix, ""),
                [kind, explanation] => issue(kind, "", "", explanation),
                _ => match l.split_once([':', '：']) {
                    Some((kind, rest)) if kind.chars().count() <= 12 && normalize(kind) != "other" => {
                        issue(kind, "", "", rest)
                    }
                    _ => issue("other", "", "", l),
                },
            }
        })
        .collect()
}

fn issue(kind: &str, wrong: &str, fix: &str, explanation: &str) -> Issue {
    // A "fix" that changes nothing is only a remark: keep its explanation, not a repeated mistake.
    let (wrong, fix) = match (wrong.trim(), fix.trim()) {
        (w, f) if w == f => ("", ""),
        pair => pair,
    };
    Issue {
        kind: normalize(kind).to_string(),
        wrong: wrong.to_string(),
        fix: fix.to_string(),
        explanation: explanation.trim().to_string(),
    }
}

/// The fixed kind for what the model wrote, including the labels older prompts asked for.
fn normalize(kind: &str) -> &'static str {
    let k = kind.trim().to_lowercase();
    if let Some(known) = KINDS.iter().find(|known| **known == k) {
        return known;
    }
    match k.as_str() {
        "ngữ pháp" | "文法" => "grammar",
        "kính ngữ" | "xưng hô" | "敬語" | "呼び方" | "keigo" => "politeness",
        "tự nhiên" | "自然さ" | "naturalness" => "natural",
        "chính tả" | "表記" | "dấu" => "spelling",
        "dùng từ" | "語彙" | "word choice" => "word_choice",
        _ => "other",
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdviceItem {
    pub title: String,
    pub advice: String,
    pub example: String,
}

/// One piece of advice per line as `title || advice || example`.
pub fn parse_advice(text: &str) -> Vec<AdviceItem> {
    text.lines()
        .map(|l| {
            l.trim()
                .trim_start_matches(|c: char| c == '-' || c == '•' || c.is_ascii_digit() || c == '.')
                .trim()
        })
        .filter(|l| !l.is_empty())
        .map(|l| {
            let mut parts = l.split("||").map(str::trim);
            AdviceItem {
                title: parts.next().unwrap_or_default().to_string(),
                advice: parts.next().unwrap_or_default().to_string(),
                example: parts.next().unwrap_or_default().to_string(),
            }
        })
        .filter(|a| !a.title.is_empty())
        .take(5)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn issues_in_the_new_and_the_old_format() {
        let found = parse_issues(
            "spelling || ko || không || Viết tắt trong tin công việc\n\
             - Kính ngữ: nên dùng ご確認\n\
             politeness || 見てください || ご確認いただけますでしょうか\n\
             Câu hơi dài",
        );
        assert_eq!(
            found[0],
            Issue {
                kind: "spelling".into(),
                wrong: "ko".into(),
                fix: "không".into(),
                explanation: "Viết tắt trong tin công việc".into(),
            }
        );
        assert_eq!(
            (found[1].kind.as_str(), found[1].explanation.as_str()),
            ("politeness", "nên dùng ご確認")
        );
        assert_eq!(
            (found[2].kind.as_str(), found[2].fix.as_str()),
            ("politeness", "ご確認いただけますでしょうか")
        );
        assert_eq!(
            (found[3].kind.as_str(), found[3].explanation.as_str()),
            ("other", "Câu hơi dài")
        );
        assert!(parse_issues("  \n").is_empty());
        let remark = &parse_issues("natural || file A || file A || Thêm dấu phẩy")[0];
        assert_eq!((remark.wrong.as_str(), remark.fix.as_str()), ("", ""));
    }

    #[test]
    fn advice_lines() {
        let a = parse_advice(
            "1. Dấu câu || Gõ đủ dấu tiếng Việt. || Em đã kiểm tra.\n\n- 敬語 || 依頼は「〜いただけますか」で。",
        );
        assert_eq!(a.len(), 2);
        assert_eq!(a[0].title, "Dấu câu");
        assert_eq!(a[1].example, "");
    }
}
