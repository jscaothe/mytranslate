//! The user's own language: Vietnamese (a Vietnamese team chatting with Japanese clients) or Japanese (a
//! Japanese person chatting with Vietnamese colleagues). It sets the language of the app's texts and which way
//! "read" and "write" translate.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Lang {
    #[default]
    Vi,
    Ja,
}

impl Lang {
    pub fn parse(code: &str) -> Option<Self> {
        match code {
            "vi" => Some(Self::Vi),
            "ja" => Some(Self::Ja),
            _ => None,
        }
    }

    pub fn code(self) -> &'static str {
        match self {
            Self::Vi => "vi",
            Self::Ja => "ja",
        }
    }

    /// The text for this language, from its Vietnamese and Japanese versions.
    pub fn pick<'a>(self, vi: &'a str, ja: &'a str) -> &'a str {
        match self {
            Self::Vi => vi,
            Self::Ja => ja,
        }
    }

    /// The other side's language: the one the user reads from and writes to.
    pub fn other(self) -> Self {
        match self {
            Self::Vi => Self::Ja,
            Self::Ja => Self::Vi,
        }
    }

    /// Japanese when Windows is set to Japanese, Vietnamese otherwise (the app's first users are Vietnamese).
    pub fn system() -> Self {
        #[cfg(windows)]
        {
            // The primary language is the low 10 bits of a LANGID; 0x11 is Japanese.
            let id = unsafe { windows::Win32::Globalization::GetUserDefaultUILanguage() };
            if id & 0x3ff == 0x11 {
                return Self::Ja;
            }
        }
        Self::Vi
    }
}

/// A language a text can be in. The user's own is Vietnamese or Japanese; English is translated into and out of
/// on request (the popup's language bar) and when a message is in English.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TextLang {
    Vi,
    Ja,
    En,
}

impl TextLang {
    pub const ALL: [TextLang; 3] = [TextLang::Vi, TextLang::Ja, TextLang::En];

    pub fn code(self) -> &'static str {
        match self {
            Self::Vi => "vi",
            Self::Ja => "ja",
            Self::En => "en",
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|l| l.code() == code)
    }

    /// Whether `text` is clearly not in this language: a translation the AI wrote in the wrong one (Haiku now and
    /// then copies the Japanese it was given, or writes English). Too little text to tell is never wrong.
    pub fn clearly_not_in(self, text: &str) -> bool {
        let japanese = text
            .chars()
            .filter(|c| matches!(c, '\u{3040}'..='\u{30ff}' | '\u{4e00}'..='\u{9fff}'))
            .count();
        let vietnamese = text
            .chars()
            .filter(|c| !c.is_ascii() && matches!(c, '\u{00C0}'..='\u{01B0}' | '\u{1EA0}'..='\u{1EF9}'))
            .count();
        let latin = text.chars().filter(char::is_ascii_alphabetic).count();
        if japanese + vietnamese + latin < 12 {
            return false;
        }
        match self {
            // Names and terms in kanji may stay; Vietnamese sentences always carry diacritics.
            Self::Vi => vietnamese == 0 || japanese > latin + vietnamese,
            // English terms (API, CSV) may stay; a Vietnamese sentence quoting a term in kanji is not Japanese.
            Self::Ja => japanese < latin + vietnamese,
            Self::En => japanese > latin || vietnamese >= 3,
        }
    }

    /// As the prompt names it.
    pub fn english_name(self) -> &'static str {
        match self {
            Self::Vi => "Vietnamese",
            Self::Ja => "Japanese",
            Self::En => "English",
        }
    }
}

impl From<Lang> for TextLang {
    fn from(lang: Lang) -> Self {
        match lang {
            Lang::Vi => Self::Vi,
            Lang::Ja => Self::Ja,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tells_a_translation_in_the_wrong_language() {
        let ja = "共有いただいたGoogleスプレッドシートについて、現在、閲覧権限がありません。";
        let vi = "Về file Google Sheets「補助簿」anh đã chia sẻ, hiện tôi chưa có quyền xem.";
        let en = "If we don't handle this, we would end up comparing the November data.";
        assert!(TextLang::Vi.clearly_not_in(ja) && TextLang::Vi.clearly_not_in(en));
        assert!(!TextLang::Vi.clearly_not_in(vi));
        assert!(TextLang::Ja.clearly_not_in(vi) && !TextLang::Ja.clearly_not_in(ja));
        assert!(TextLang::En.clearly_not_in(ja) && TextLang::En.clearly_not_in(vi) && !TextLang::En.clearly_not_in(en));
        // Too short to tell.
        assert!(!TextLang::Vi.clearly_not_in("OK, API v2"));
    }

    #[test]
    fn parses_known_codes_only() {
        assert_eq!(Lang::parse("ja"), Some(Lang::Ja));
        assert_eq!(Lang::parse("vi"), Some(Lang::Vi));
        assert_eq!(Lang::parse("en"), None);
        assert_eq!(Lang::Ja.pick("Thoát", "終了"), "終了");
        assert_eq!(Lang::Vi.code(), "vi");
    }
}
