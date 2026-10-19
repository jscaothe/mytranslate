//! How to read a Japanese text, worked out on this PC with a morphological analyser (Lindera with the IPADIC
//! dictionary, built into the app): furigana over each kanji word, and the whole text in hiragana. Instant and
//! offline, so the popup shows it without asking the AI; a rare name may get a wrong reading.

use std::borrow::Cow;
use std::sync::OnceLock;

use lindera::dictionary::load_dictionary;
use lindera::mode::Mode;
use lindera::segmenter::Segmenter;
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reading {
    /// The text in order, with the reading of each part written in kanji.
    pub parts: Vec<RubyPart>,
    /// The whole text in hiragana (katakana words stay as written), with a space between phrases.
    pub kana: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RubyPart {
    pub text: String,
    /// Hiragana shown over `text`; `None` for kana, Latin letters, digits and punctuation.
    pub ruby: Option<String>,
}

/// One word as the analyser found it.
struct Word {
    surface: String,
    /// In hiragana; `None` when the dictionary does not know the word.
    reading: Option<String>,
    /// Belongs to the phrase before it: a particle, an auxiliary, a suffix, punctuation.
    attached: bool,
    /// Joins the next word to it: a prefix such as ご or お.
    prefix: bool,
}

fn segmenter() -> Option<&'static Segmenter> {
    static SEGMENTER: OnceLock<Option<Segmenter>> = OnceLock::new();
    SEGMENTER
        .get_or_init(|| match load_dictionary("embedded://ipadic") {
            Ok(dictionary) => Some(Segmenter::new(Mode::Normal, dictionary, None)),
            Err(e) => {
                log::warn!("could not load the Japanese dictionary: {e}");
                None
            }
        })
        .as_ref()
}

pub fn read(text: &str) -> Reading {
    let words = words(text);
    Reading {
        parts: ruby_parts(&words),
        kana: kana_line(&words),
    }
}

/// The analyser drops line breaks and spaces: only the text between them goes to it, and they are kept as they are.
fn words(text: &str) -> Vec<Word> {
    let mut words = Vec::new();
    let mut rest = text;
    while !rest.is_empty() {
        let blank = rest.starts_with(char::is_whitespace);
        let end = rest.find(|c: char| c.is_whitespace() != blank).unwrap_or(rest.len());
        let (chunk, tail) = rest.split_at(end);
        if blank {
            words.push(plain(chunk));
        } else {
            words.extend(analyse(chunk));
        }
        rest = tail;
    }
    words
}

fn analyse(text: &str) -> Vec<Word> {
    let Some(segmenter) = segmenter() else {
        return vec![plain(text)];
    };
    let Ok(mut tokens) = segmenter.segment(Cow::Borrowed(text)) else {
        return vec![plain(text)];
    };
    tokens
        .iter_mut()
        .map(|token| {
            let surface = token.surface.as_ref().to_string();
            let details = token.details();
            let field = |i: usize| details.get(i).copied().filter(|f| *f != "*");
            let (pos, sub) = (field(0).unwrap_or(""), field(1).unwrap_or(""));
            Word {
                reading: field(7).map(to_hiragana),
                attached: matches!(pos, "助詞" | "助動詞" | "記号") || matches!(sub, "接尾" | "非自立"),
                prefix: pos == "接頭詞",
                surface,
            }
        })
        .collect()
}

fn plain(text: &str) -> Word {
    Word {
        surface: text.to_string(),
        reading: None,
        attached: false,
        prefix: false,
    }
}

fn ruby_parts(words: &[Word]) -> Vec<RubyPart> {
    let mut parts: Vec<RubyPart> = Vec::new();
    let mut push = |text: &str, ruby: Option<String>| {
        if text.is_empty() {
            return;
        }
        // Text without a reading joins the text before it, so the page gets few elements.
        match (parts.last_mut(), &ruby) {
            (Some(last), None) if last.ruby.is_none() => last.text.push_str(text),
            _ => parts.push(RubyPart {
                text: text.to_string(),
                ruby,
            }),
        }
    };
    for word in words {
        match &word.reading {
            Some(reading) if has_kanji(&word.surface) => {
                let (before, core, after, core_reading) = split_okurigana(&word.surface, reading);
                push(before, None);
                push(core, Some(core_reading.to_string()));
                push(after, None);
            }
            _ => push(&word.surface, None),
        }
    }
    parts
}

/// Kana written around the kanji (お願い, 送り) is read as written: the furigana covers only the kanji.
fn split_okurigana<'a>(surface: &'a str, reading: &'a str) -> (&'a str, &'a str, &'a str, &'a str) {
    let common_prefix = surface
        .chars()
        .zip(reading.chars())
        .take_while(|(s, r)| !is_kanji(*s) && same_kana(*s, *r))
        .map(|(s, r)| (s.len_utf8(), r.len_utf8()))
        .fold((0, 0), |(a, b), (s, r)| (a + s, b + r));
    let common_suffix = surface[common_prefix.0..]
        .chars()
        .rev()
        .zip(reading[common_prefix.1..].chars().rev())
        .take_while(|(s, r)| !is_kanji(*s) && same_kana(*s, *r))
        .map(|(s, r)| (s.len_utf8(), r.len_utf8()))
        .fold((0, 0), |(a, b), (s, r)| (a + s, b + r));
    let core = &surface[common_prefix.0..surface.len() - common_suffix.0];
    let core_reading = &reading[common_prefix.1..reading.len() - common_suffix.1];
    if core.is_empty() || core_reading.is_empty() {
        return ("", surface, "", reading);
    }
    (
        &surface[..common_prefix.0],
        core,
        &surface[surface.len() - common_suffix.0..],
        core_reading,
    )
}

fn kana_line(words: &[Word]) -> String {
    let mut out = String::new();
    let mut joins_next = true;
    for word in words {
        let blank = word.surface.trim().is_empty();
        let ends_line = out.ends_with(char::is_whitespace);
        if !(joins_next || word.attached || blank || ends_line) {
            out.push(' ');
        }
        match &word.reading {
            Some(reading) if has_kanji(&word.surface) => out.push_str(reading),
            _ => out.push_str(&word.surface),
        }
        joins_next = word.prefix || blank;
    }
    out
}

fn is_kanji(c: char) -> bool {
    matches!(c, '\u{4E00}'..='\u{9FFF}' | '\u{3400}'..='\u{4DBF}' | '\u{F900}'..='\u{FAFF}' | '々' | '〆' | 'ヶ')
}

fn has_kanji(text: &str) -> bool {
    text.chars().any(is_kanji)
}

fn to_hiragana(text: &str) -> String {
    text.chars()
        .map(|c| match c {
            'ァ'..='ヶ' => char::from_u32(c as u32 - 0x60).unwrap_or(c),
            _ => c,
        })
        .collect()
}

fn same_kana(a: char, b: char) -> bool {
    to_hiragana(&a.to_string()) == to_hiragana(&b.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ruby(text: &str) -> String {
        read(text)
            .parts
            .iter()
            .map(|p| match &p.ruby {
                Some(r) => format!("{}({r})", p.text),
                None => p.text.clone(),
            })
            .collect()
    }

    #[test]
    fn furigana_covers_only_the_kanji() {
        assert_eq!(
            ruby("明日の会議は午後3時からです。"),
            "明日(あした)の会議(かいぎ)は午後(ごご)3時(じ)からです。"
        );
        assert_eq!(ruby("よろしくお願いいたします"), "よろしくお願(ねが)いいたします");
        assert_eq!(ruby("資料を送りました"), "資料(しりょう)を送(おく)りました");
        // Katakana and Latin words are read as written.
        assert_eq!(ruby("APIのデータ"), "APIのデータ");
    }

    #[test]
    fn the_parts_spell_the_text_exactly() {
        let text = "・ログインの不具合を修正いたしました。\n\n  田中様、ご確認ください 🙏 (v2.1)";
        let parts: String = read(text).parts.iter().map(|p| p.text.as_str()).collect();
        assert_eq!(parts, text);
        assert_eq!(read(""), Reading { parts: vec![], kana: String::new() });
    }

    #[test]
    fn hiragana_line_spaces_phrases() {
        assert_eq!(
            read("明日の会議は午後3時からです。").kana,
            "あしたの かいぎは ごご 3じからです。"
        );
        assert_eq!(read("ご確認ください").kana, "ごかくにんください");
        // Lines stay lines.
        assert_eq!(
            read("了解です。\n対応します。").kana,
            "りょうかいです。\nたいおう します。"
        );
    }

    #[test]
    fn kana_conversion() {
        assert_eq!(to_hiragana("カイギー"), "かいぎー");
        assert_eq!(split_okurigana("お願い", "おねがい"), ("お", "願", "い", "ねが"));
        assert_eq!(split_okurigana("会議", "かいぎ"), ("", "会議", "", "かいぎ"));
    }
}
