//! Picks the thread a new message belongs to, on this PC and without calling Claude, so it costs no time.
//!
//! Signals: words shared with a thread's title and recent messages (character trigrams, which work for
//! Japanese without word splitting), identifiers such as ticket numbers, and how recently the thread was used.

use std::collections::HashSet;

use serde::Serialize;

/// A thread used within this window is very likely the same conversation topic.
const RECENT_MS: i64 = 30 * 60 * 1000;
/// Enough shared wording to trust the match without asking.
const CONFIDENT_SCORE: f64 = 0.35;
/// The winner must beat the runner-up by this much to be trusted.
const CONFIDENT_MARGIN: f64 = 0.10;
/// Below this, a thread is not considered related at all.
const MIN_SCORE: f64 = 0.12;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Confidence {
    High,
    Low,
}

pub struct Candidate {
    pub id: i64,
    pub last_active: i64,
    /// Title plus the text of its recent messages.
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detection {
    /// `None` means a new thread.
    pub thread_id: Option<i64>,
    pub confidence: Confidence,
}

pub fn detect(text: &str, candidates: &[Candidate], now_ms: i64) -> Detection {
    if candidates.is_empty() {
        return Detection {
            thread_id: None,
            confidence: Confidence::High,
        };
    }
    let mine = trigrams(text);
    let ids = identifiers(text);
    let mut scored: Vec<(f64, &Candidate)> = candidates.iter().map(|c| (score(&mine, &ids, c, now_ms), c)).collect();
    scored.sort_by(|a, b| b.0.total_cmp(&a.0));

    let (best, top) = scored[0];
    let second = scored.get(1).map_or(0.0, |s| s.0);
    if best >= CONFIDENT_SCORE && best - second >= CONFIDENT_MARGIN {
        return Detection {
            thread_id: Some(top.id),
            confidence: Confidence::High,
        };
    }
    if best >= MIN_SCORE {
        return Detection {
            thread_id: Some(top.id),
            confidence: Confidence::Low,
        };
    }
    // Nothing related: keep talking in the thread used minutes ago, otherwise start a new one.
    match candidates.iter().max_by_key(|c| c.last_active) {
        Some(c) if now_ms - c.last_active <= RECENT_MS => Detection {
            thread_id: Some(c.id),
            confidence: Confidence::Low,
        },
        _ => Detection {
            thread_id: None,
            confidence: Confidence::Low,
        },
    }
}

fn score(mine: &HashSet<String>, ids: &HashSet<String>, c: &Candidate, now_ms: i64) -> f64 {
    let theirs = trigrams(&c.text);
    let overlap = if mine.is_empty() {
        0.0
    } else {
        mine.intersection(&theirs).count() as f64 / mine.len() as f64
    };
    let shared_id = !ids.is_disjoint(&identifiers(&c.text));
    let age = now_ms - c.last_active;
    let recency = if age <= RECENT_MS {
        0.15
    } else if age <= 4 * RECENT_MS {
        0.05
    } else {
        0.0
    };
    overlap + if shared_id { 0.5 } else { 0.0 } + recency
}

/// Character trigrams of the letters and digits only, lower-cased. Kana, kanji and Latin all work.
fn trigrams(text: &str) -> HashSet<String> {
    let chars: Vec<char> = text
        .chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect();
    chars.windows(3).map(|w| w.iter().collect()).collect()
}

/// Ticket-like identifiers (ABC-123, #456, 123456) that pin a message to a topic on their own.
fn identifiers(text: &str) -> HashSet<String> {
    text.split(|c: char| !(c.is_ascii_alphanumeric() || c == '-' || c == '#'))
        .map(|t| t.trim_matches('-'))
        .filter(|t| {
            let digits = t.chars().filter(char::is_ascii_digit).count();
            digits >= 3 && t.len() >= 4
        })
        .map(|t| t.trim_start_matches('#').to_lowercase())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOUR: i64 = 60 * 60 * 1000;
    const NOW: i64 = 100 * HOUR;

    fn cand(id: i64, hours_ago: i64, text: &str) -> Candidate {
        Candidate {
            id,
            last_active: NOW - hours_ago * HOUR,
            text: text.into(),
        }
    }

    #[test]
    fn no_threads_means_a_new_one() {
        assert_eq!(detect("こんにちは", &[], NOW).thread_id, None);
    }

    #[test]
    fn shared_wording_picks_the_topic() {
        let threads = [
            cand(1, 5, "ログイン画面のエラー 先ほどの修正は反映済みでしょうか"),
            cand(2, 3, "11月のリリース日程について 候補日をいただけますか"),
        ];
        let d = detect("ログイン画面のエラーはまだ出ています", &threads, NOW);
        assert_eq!(d.thread_id, Some(1));
        assert_eq!(d.confidence, Confidence::High);
    }

    #[test]
    fn ticket_numbers_match_even_without_shared_words() {
        let threads = [
            cand(1, 20, "Bug PROJ-1234 khi thanh toán"),
            cand(2, 20, "Lịch họp tuần"),
        ];
        let d = detect("PROJ-1234の件、確認お願いします", &threads, NOW);
        assert_eq!(d.thread_id, Some(1));
    }

    #[test]
    fn unrelated_text_continues_a_thread_used_minutes_ago() {
        let mut recent = cand(7, 0, "仕様書の確認");
        recent.last_active = NOW - 10 * 60 * 1000;
        let d = detect("了解です", &[recent, cand(8, 30, "請求書")], NOW);
        assert_eq!(d.thread_id, Some(7));
        assert_eq!(d.confidence, Confidence::Low);
    }

    #[test]
    fn unrelated_text_after_a_long_pause_starts_a_new_thread() {
        let d = detect("新しい案件の相談です", &[cand(1, 30, "請求書の送付について")], NOW);
        assert_eq!(d.thread_id, None);
        assert_eq!(d.confidence, Confidence::Low);
    }

    #[test]
    fn identifiers_ignore_short_numbers() {
        assert!(identifiers("15時から").is_empty());
        assert_eq!(identifiers("see #4521"), HashSet::from(["4521".to_string()]));
    }
}
