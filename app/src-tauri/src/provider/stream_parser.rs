//! Splits Claude's streamed reply into the tagged sections the popup shows, while it is still arriving.
//! Expected shape: `<translation>…</translation><back_translation>…</back_translation><notes>…</notes>`.

use serde::Serialize;

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sections {
    pub translation: String,
    pub back_translation: String,
    pub notes: String,
    /// Review only: ok, suggest or error.
    pub verdict: String,
    /// Review only: one "kind: explanation" per line.
    pub issues: String,
    pub suggestion: String,
    pub suggestion_vi: String,
    /// suggest_replies only: one "Japanese || Vietnamese" per line.
    pub replies: String,
}

const TAGS: [&str; 8] = [
    "replies",
    "translation",
    "back_translation",
    "notes",
    "verdict",
    "issues",
    "suggestion",
    "suggestion_vi",
];

#[derive(Default)]
pub struct StreamParser {
    raw: String,
}

impl StreamParser {
    pub fn push(&mut self, delta: &str) -> Sections {
        self.raw.push_str(delta);
        parse(&self.raw)
    }

    pub fn raw(&self) -> &str {
        &self.raw
    }
}

/// Parses whatever has arrived so far. An unclosed tag yields its partial content, minus any half-received
/// closing tag at the end, so the UI never flashes `</transl`.
pub fn parse(raw: &str) -> Sections {
    let mut out = Sections::default();
    for tag in TAGS {
        let open = format!("<{tag}>");
        let close = format!("</{tag}>");
        let Some(start) = raw.find(&open).map(|i| i + open.len()) else {
            continue;
        };
        let body = &raw[start..];
        let text = match body.find(&close) {
            Some(end) => &body[..end],
            None => strip_partial_tag(body),
        };
        let text = text.trim().to_string();
        match tag {
            "translation" => out.translation = text,
            "back_translation" => out.back_translation = text,
            "notes" => out.notes = text,
            "verdict" => out.verdict = text,
            "issues" => out.issues = text,
            "suggestion" => out.suggestion = text,
            "suggestion_vi" => out.suggestion_vi = text,
            _ => out.replies = text,
        }
    }
    // Tolerate a reply that ignored the tags entirely: show it as the translation.
    if out == Sections::default() && !raw.trim_start().starts_with('<') {
        out.translation = raw.trim().to_string();
    }
    out
}

fn strip_partial_tag(body: &str) -> &str {
    match body.rfind('<') {
        Some(i) if !body[i..].contains('>') => &body[..i],
        _ => body,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_complete_reply() {
        let s = parse(
            "<translation>確認しました。</translation><back_translation>Đã xác nhận.</back_translation><notes>Lịch sự.</notes>",
        );
        assert_eq!(s.translation, "確認しました。");
        assert_eq!(s.back_translation, "Đã xác nhận.");
        assert_eq!(s.notes, "Lịch sự.");
    }

    #[test]
    fn streams_partial_sections_without_half_tags() {
        let mut p = StreamParser::default();
        assert_eq!(p.push("<transla").translation, "");
        assert_eq!(p.push("tion>確認").translation, "確認");
        assert_eq!(p.push("しました。</transl").translation, "確認しました。");
        let s = p.push("ation><back_translation>Đã");
        assert_eq!(s.translation, "確認しました。");
        assert_eq!(s.back_translation, "Đã");
    }

    #[test]
    fn parses_review_tags_without_mixing_similar_names() {
        let s = parse(
            "<verdict>suggest</verdict><issues>Kính ngữ: nên dùng ご確認</issues><suggestion>ご確認ください。</suggestion><suggestion_vi>Xin anh kiểm tra.</suggestion_vi>",
        );
        assert_eq!(s.verdict, "suggest");
        assert_eq!(s.issues, "Kính ngữ: nên dùng ご確認");
        assert_eq!(s.suggestion, "ご確認ください。");
        assert_eq!(s.suggestion_vi, "Xin anh kiểm tra.");
        assert_eq!(s.translation, "");
    }

    #[test]
    fn untagged_reply_becomes_translation() {
        assert_eq!(parse("Xin chào").translation, "Xin chào");
    }
}
