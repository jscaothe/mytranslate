//! The user's own language: Vietnamese (a Vietnamese team chatting with Japanese clients) or Japanese (a
//! Japanese person chatting with Vietnamese colleagues). It sets the language of the app's texts and which way
//! "read" and "write" translate.

use serde::Deserialize;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_known_codes_only() {
        assert_eq!(Lang::parse("ja"), Some(Lang::Ja));
        assert_eq!(Lang::parse("vi"), Some(Lang::Vi));
        assert_eq!(Lang::parse("en"), None);
        assert_eq!(Lang::Ja.pick("Thoát", "終了"), "終了");
        assert_eq!(Lang::Vi.code(), "vi");
    }
}
