//! The team's shared glossary: a YAML file kept in the project repo or a synced folder (design 9.2).
//! The app only reads it, and re-reads it whenever the file changes, so a `git pull` is picked up at once.
//! Personal terms win over team terms with the same Japanese.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use serde::{Deserialize, Serialize};

use crate::history::TermKind;

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamGlossary {
    /// The file the terms came from; empty when no file is set.
    pub path: String,
    pub project: String,
    pub terms: Vec<TeamTerm>,
    /// Why the file could not be read; the Glossary screen words it in the user's language.
    pub error: Option<FileError>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileError {
    /// `not_found`, `bad_format` or `unreadable`.
    pub kind: &'static str,
    /// The system's or the YAML parser's message (English), shown after the explanation.
    pub detail: String,
}

impl FileError {
    fn new(kind: &'static str, detail: impl ToString) -> Self {
        Self {
            kind,
            detail: detail.to_string(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct TeamTerm {
    pub ja: String,
    pub vi: String,
    #[serde(default)]
    pub note: String,
    /// `kind: person` shares a person (a client's name, how to address them) with the team.
    #[serde(default)]
    pub kind: TermKind,
}

#[derive(Deserialize)]
struct File {
    #[serde(default)]
    project: String,
    #[serde(default)]
    terms: Vec<TeamTerm>,
}

pub fn parse(yaml: &str) -> Result<(String, Vec<TeamTerm>), String> {
    let file: File = serde_yaml_ng::from_str(yaml).map_err(|e| e.to_string())?;
    let terms = file
        .terms
        .into_iter()
        .map(|t| TeamTerm {
            ja: t.ja.trim().to_string(),
            vi: t.vi.trim().to_string(),
            note: t.note.trim().to_string(),
            kind: t.kind,
        })
        .filter(|t| !t.ja.is_empty() && !t.vi.is_empty())
        .collect();
    Ok((file.project.trim().to_string(), terms))
}

/// Caches the parsed file and re-reads it only when its path or modification time changes.
#[derive(Default)]
pub struct TeamGlossaryCache {
    inner: Mutex<Option<(PathBuf, Option<SystemTime>, TeamGlossary)>>,
}

impl TeamGlossaryCache {
    pub fn get(&self, path: &str) -> TeamGlossary {
        let path = path.trim();
        if path.is_empty() {
            return TeamGlossary::default();
        }
        let path = Path::new(path);
        let modified = std::fs::metadata(path).and_then(|m| m.modified()).ok();
        let mut inner = self.inner.lock().unwrap();
        if let Some((p, m, g)) = inner.as_ref()
            && p == path
            && *m == modified
            && modified.is_some()
        {
            return g.clone();
        }
        let glossary = load(path);
        *inner = Some((path.to_path_buf(), modified, glossary.clone()));
        glossary
    }
}

fn load(path: &Path) -> TeamGlossary {
    let mut out = TeamGlossary {
        path: path.display().to_string(),
        ..Default::default()
    };
    match std::fs::read_to_string(path) {
        Ok(text) => match parse(&text) {
            Ok((project, terms)) => {
                out.project = project;
                out.terms = terms;
            }
            Err(e) => out.error = Some(FileError::new("bad_format", e)),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => out.error = Some(FileError::new("not_found", "")),
        Err(e) => out.error = Some(FileError::new("unreadable", e)),
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_documented_format() {
        let (project, terms) = parse(
            "project: CustomerX Đặt phòng\nterms:\n  - ja: 予約確定画面\n    vi: màn hình xác nhận đặt phòng\n    note: Không dịch là \"booking confirm\"\n  - ja: 受入テスト\n    vi: UAT\n  - ja: ''\n    vi: bỏ qua\n  - ja: 田中\n    vi: Tanaka\n    kind: person\n    note: PM phía khách\n",
        )
        .unwrap();
        assert_eq!(project, "CustomerX Đặt phòng");
        assert_eq!(terms.len(), 3);
        assert_eq!(
            terms[1],
            TeamTerm {
                ja: "受入テスト".into(),
                vi: "UAT".into(),
                note: String::new(),
                kind: TermKind::Term,
            }
        );
        assert_eq!(terms[2].kind, TermKind::Person);
    }

    #[test]
    fn reports_bad_files_and_reloads_on_change() {
        let path = std::env::temp_dir().join(format!("mytranslate-team-{}.yaml", std::process::id()));
        let cache = TeamGlossaryCache::default();
        assert_eq!(cache.get(path.to_str().unwrap()).error.unwrap().kind, "not_found");

        std::fs::write(&path, "terms: [oops").unwrap();
        assert_eq!(cache.get(path.to_str().unwrap()).error.unwrap().kind, "bad_format");

        std::fs::write(&path, "terms:\n  - ja: 仕訳\n    vi: bút toán\n").unwrap();
        // Same mtime resolution on some file systems: make the change visible.
        let later = SystemTime::now() + std::time::Duration::from_secs(5);
        std::fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(later)
            .unwrap();
        let g = cache.get(path.to_str().unwrap());
        assert_eq!(g.error, None);
        assert_eq!(g.terms.len(), 1);
        let _ = std::fs::remove_file(path);
        assert!(cache.get("  ").terms.is_empty());
    }
}
