//! A thread as Markdown, to hand a topic over to a teammate (F17): both languages for every message.

use crate::history::{ConversationInfo, MessageInfo, ThreadInfo};
use crate::lang::Lang;

/// Headings in the user's language; each message shows its Japanese side, then its Vietnamese side.
pub fn thread_markdown(
    lang: Lang,
    conversation: Option<&ConversationInfo>,
    thread: &ThreadInfo,
    messages: &[MessageInfo],
) -> String {
    let t = |vi, ja| lang.pick(vi, ja);
    let mut out = format!("# {}\n\n", thread.title.trim());
    if let Some(c) = conversation {
        let app = match c.app.as_str() {
            "slack" => "Slack",
            "teams" => "Microsoft Teams",
            _ => t("Ứng dụng khác", "その他のアプリ"),
        };
        let place: Vec<&str> = [app, c.workspace.as_str(), c.name.as_str()]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect();
        out.push_str(&format!("- {}: {}\n", t("Cuộc hội thoại", "会話"), place.join(" / ")));
    }
    out.push_str(&format!("- {}: {}\n", t("Số tin", "メッセージ数"), messages.len()));
    if let (Some(first), Some(last)) = (messages.first(), messages.last()) {
        out.push_str(&format!(
            "- {}: {} - {}\n",
            t("Thời gian", "期間"),
            date(first.created_at),
            date(last.created_at)
        ));
    }
    if !thread.summary.is_empty() {
        out.push_str(&format!("\n## {}\n\n{}\n", t("Tóm tắt", "要約"), thread.summary));
    }
    out.push_str(&format!("\n## {}\n", t("Tin nhắn", "メッセージ")));
    for m in messages {
        let (first, second) = (m.japanese(), m.vietnamese());
        let who = match (m.mine, lang) {
            (true, _) => t("Tôi", "自分"),
            (false, Lang::Vi) => "Khách",
            (false, Lang::Ja) => "相手",
        };
        out.push_str(&format!("\n### {who} - {}\n\n", date(m.created_at)));
        out.push_str(&quote(first));
        if !second.trim().is_empty() {
            out.push_str("\n\n");
            out.push_str(&quote(second));
        }
        out.push('\n');
    }
    out
}

/// Each line as a block quote, so line breaks inside a message survive.
fn quote(text: &str) -> String {
    text.trim()
        .lines()
        .map(|l| {
            if l.is_empty() {
                ">".to_string()
            } else {
                format!("> {l}")
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// `YYYY-MM-DD HH:MM` in UTC+7 (the team works in Vietnam; the file must read the same on every PC).
pub fn date(ms: i64) -> String {
    let secs = ms.div_euclid(1000) + 7 * 3600;
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02} {:02}:{:02}", rem / 3600, rem % 3600 / 60)
}

/// Days since 1970-01-01 to a calendar date (Howard Hinnant's algorithm).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d)
}

/// A file name from the thread title: no characters Windows forbids.
pub fn file_name(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| {
            if "<>:\"/\\|?*".contains(c) || c.is_control() {
                ' '
            } else {
                c
            }
        })
        .collect();
    let cleaned = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let cleaned: String = cleaned.chars().take(80).collect();
    format!(
        "{}.md",
        if cleaned.is_empty() {
            "thread"
        } else {
            cleaned.trim_end_matches('.')
        }
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn thread() -> ThreadInfo {
        ThreadInfo {
            id: 1,
            conversation_id: 1,
            title: "Lỗi đăng nhập".into(),
            pinned: false,
            last_active: 0,
            archived: false,
            summary: "Khách báo lỗi.".into(),
            summary_stale: false,
            message_count: 2,
        }
    }

    fn message(direction: &str, source: &str, result: &str, created_at: i64) -> MessageInfo {
        MessageInfo {
            id: 1,
            thread_id: 1,
            direction: direction.into(),
            source: source.into(),
            result: result.into(),
            back: String::new(),
            created_at,
            mine: direction != "ja_vi",
        }
    }

    #[test]
    fn both_languages_for_each_message() {
        let conv = ConversationInfo {
            id: 1,
            app: "slack".into(),
            name: "dev-qa".into(),
            workspace: "CustomerX".into(),
            last_active: 0,
            keigo: String::new(),
            note: String::new(),
        };
        // 2026-10-10 02:30 UTC is 09:30 in Vietnam.
        let at = 1_791_599_400_000;
        let md = thread_markdown(
            Lang::Vi,
            Some(&conv),
            &thread(),
            &[
                message(
                    "ja_vi",
                    "ログインできません。\n確認お願いします。",
                    "Không đăng nhập được.",
                    at,
                ),
                message("vi_ja", "Em sẽ kiểm tra.", "確認いたします。", at + 60_000),
            ],
        );
        assert_eq!(
            md,
            "# Lỗi đăng nhập\n\n- Cuộc hội thoại: Slack / CustomerX / dev-qa\n- Số tin: 2\n\
             - Thời gian: 2026-10-10 09:30 - 2026-10-10 09:31\n\n## Tóm tắt\n\nKhách báo lỗi.\n\n## Tin nhắn\n\
             \n### Khách - 2026-10-10 09:30\n\n> ログインできません。\n> 確認お願いします。\n\n> Không đăng nhập được.\n\
             \n### Tôi - 2026-10-10 09:31\n\n> 確認いたします。\n\n> Em sẽ kiểm tra.\n"
        );
    }

    #[test]
    fn headings_in_japanese_for_a_japanese_user() {
        let at = 1_791_599_400_000;
        // For a Japanese user the Vietnamese messages are the other side's and the Japanese ones their own.
        let mut theirs = message("vi_ja", "Em đã sửa xong.", "修正が完了しました。", at);
        theirs.mine = false;
        let mut own = message("ja_vi", "確認します。", "Tôi sẽ kiểm tra.", at);
        own.mine = true;
        let md = thread_markdown(Lang::Ja, None, &thread(), &[theirs, own]);
        assert!(md.contains("- メッセージ数: 2\n"));
        assert!(md.contains("## 要約\n"));
        assert!(md.contains("### 相手 - 2026-10-10 09:30\n\n> 修正が完了しました。\n\n> Em đã sửa xong.\n"));
        assert!(md.contains("### 自分 - 2026-10-10 09:30\n\n> 確認します。\n\n> Tôi sẽ kiểm tra.\n"));
    }

    #[test]
    fn file_names_are_safe() {
        assert_eq!(file_name("Lỗi: màn hình A/B?"), "Lỗi màn hình A B.md");
        assert_eq!(file_name("  "), "thread.md");
    }
}
