//! Chinese is the source language: `t!` looks the Chinese literal up in [`en::EN`] when the locale is English.

use std::collections::HashMap;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU8, Ordering};

mod en;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Locale {
    Zh,
    En,
}

static LOCALE: AtomicU8 = AtomicU8::new(0);

/// Chinese unless the tag names another language; unset, `C` and `POSIX` keep the default (mirrors `resolveLocale`).
pub fn resolve(tag: &str) -> Locale {
    let t = tag.split([',', ';']).next().unwrap_or("").trim().to_ascii_lowercase();
    if t.is_empty() || t == "*" || t.starts_with("zh") || t == "c" || t.starts_with("c.") || t == "posix" {
        Locale::Zh
    } else {
        Locale::En
    }
}

/// `GG_LANG`, then the POSIX locale variables; unit tests assert the Chinese source whatever the shell's locale.
pub fn locale() -> Locale {
    match LOCALE.load(Ordering::Relaxed) {
        1 => Locale::Zh,
        2 => Locale::En,
        _ if cfg!(test) => Locale::Zh,
        _ => {
            let tag = ["GG_LANG", "LC_ALL", "LC_MESSAGES", "LANG"]
                .iter()
                .filter_map(|k| std::env::var(k).ok())
                .find(|v| !v.is_empty())
                .unwrap_or_default();
            // An explicit set_locale racing this first read wins.
            let _ = LOCALE.compare_exchange(0, code(resolve(&tag)), Ordering::Relaxed, Ordering::Relaxed);
            locale()
        }
    }
}

fn code(l: Locale) -> u8 {
    if l == Locale::Zh { 1 } else { 2 }
}

pub fn set_locale(l: Locale) {
    LOCALE.store(code(l), Ordering::Relaxed);
}

/// The `GG_LANG` value handed to child processes and services.
pub fn tag() -> &'static str {
    match locale() {
        Locale::Zh => "zh",
        Locale::En => "en",
    }
}

pub fn tr(zh: &'static str) -> &'static str {
    if locale() == Locale::Zh {
        return zh;
    }
    static MAP: OnceLock<HashMap<&'static str, &'static str>> = OnceLock::new();
    MAP.get_or_init(|| en::EN.iter().copied().collect()).get(zh).copied().unwrap_or(zh)
}

/// For another crate's own dictionary (the desktop shell).
pub fn tr_in(dict: &'static [(&'static str, &'static str)], zh: &'static str) -> &'static str {
    if locale() == Locale::Zh {
        return zh;
    }
    dict.iter().find(|(k, _)| *k == zh).map_or(zh, |(_, v)| v)
}

/// Fills `{name}`; `{n:item|items}` picks the singular when `n` is 1.
pub fn fill(template: &str, params: &[(&str, String)]) -> String {
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(start) = rest.find('{') {
        out.push_str(&rest[..start]);
        let Some(len) = rest[start..].find('}') else { break };
        let inner = &rest[start + 1..start + len];
        let (name, forms) = inner.split_once(':').map_or((inner, None), |(n, f)| (n, Some(f)));
        match (params.iter().find(|(k, _)| *k == name), forms) {
            (Some((_, v)), None) => out.push_str(v),
            (Some((_, v)), Some(f)) => {
                let (one, other) = f.split_once('|').unwrap_or((f, ""));
                out.push_str(if v == "1" { one } else { other });
            }
            (None, _) => out.push_str(&rest[start..=start + len]),
        }
        rest = &rest[start + len + 1..];
    }
    out.push_str(rest);
    out
}

/// `t!("中文")` → `&'static str`; `t!("{n} 个", n = x)` → `String`.
#[macro_export]
macro_rules! t {
    ($zh:literal) => {
        $crate::i18n::tr($zh)
    };
    ($zh:literal, $($k:ident = $v:expr),+ $(,)?) => {
        $crate::i18n::fill($crate::i18n::tr($zh), &[$((stringify!($k), ($v).to_string())),+])
    };
}

/// A failure shown to people: `text` in this machine's language for old clients and logs, `i18n` (when the source is
/// a known template) so each viewer reads it in their own.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reason {
    pub text: String,
    pub i18n: Option<crate::protocol::I18nText>,
}

impl Reason {
    pub fn new(zh: &'static str, params: Vec<(&str, String)>) -> Self {
        let text = fill(tr(zh), &params);
        let params = params.into_iter().map(|(k, v)| (k.to_string(), v)).collect();
        Reason { text, i18n: Some(crate::protocol::I18nText { key: zh.into(), params }) }
    }
}

impl From<String> for Reason {
    fn from(text: String) -> Self {
        Reason { text, i18n: None }
    }
}

impl From<&str> for Reason {
    fn from(text: &str) -> Self {
        text.to_string().into()
    }
}

impl std::fmt::Display for Reason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.text)
    }
}

/// `reason!("中文 {x}", x = v)` → [`Reason`]: the `t!` text plus the template and params for the viewer's language.
#[macro_export]
macro_rules! reason {
    ($zh:literal $(, $k:ident = $v:expr)* $(,)?) => {
        $crate::i18n::Reason::new($zh, vec![$((stringify!($k), ($v).to_string())),*])
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_tags() {
        assert_eq!(resolve(""), Locale::Zh);
        assert_eq!(resolve("C.UTF-8"), Locale::Zh);
        assert_eq!(resolve("zh_CN.UTF-8"), Locale::Zh);
        assert_eq!(resolve("en_US.UTF-8"), Locale::En);
        assert_eq!(resolve("ja_JP"), Locale::En);
    }

    #[test]
    fn fills_params_and_plurals() {
        let p = [("n", "1".to_string()), ("name", "gg".to_string())];
        assert_eq!(fill("{n} {n:item|items} of {name} {x}", &p), "1 item of gg {x}");
        assert_eq!(fill("{n:item|items}", &[("n", "2".to_string())]), "items");
    }

    #[test]
    fn reasons_carry_the_template() {
        let r = crate::reason!("{path} 是符号链接，不能同步", path = "a/b");
        assert_eq!(r.text, "a/b 是符号链接，不能同步");
        let i18n = r.i18n.unwrap();
        assert_eq!(i18n.key, "{path} 是符号链接，不能同步");
        assert_eq!(i18n.params["path"], "a/b");
    }

    /// Every `t!` / `reason!` literal in the crate has an English entry.
    #[test]
    fn english_covers_every_literal() {
        let re = regex::Regex::new(r#"\b(?:t|reason)!\(\s*"((?:[^"\\]|\\.)*)""#).unwrap();
        let keys: std::collections::HashSet<_> = en::EN.iter().map(|(k, _)| *k).collect();
        let mut missing = vec![];
        let mut dirs = vec![std::path::PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/src"))];
        while let Some(dir) = dirs.pop() {
            for entry in std::fs::read_dir(dir).unwrap().flatten() {
                let path = entry.path();
                if path.is_dir() {
                    dirs.push(path);
                } else if path.extension().is_some_and(|e| e == "rs") && !path.ends_with("i18n.rs") {
                    let src = std::fs::read_to_string(&path).unwrap();
                    for c in re.captures_iter(&src) {
                        let key = c[1].replace("\\\"", "\"").replace("\\n", "\n").replace("\\\\", "\\");
                        if !keys.contains(key.as_str()) {
                            missing.push(format!("{}: {key}", path.display()));
                        }
                    }
                }
            }
        }
        assert!(missing.is_empty(), "missing English:\n{}", missing.join("\n"));
    }
}
