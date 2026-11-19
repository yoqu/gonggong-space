//! What a shell line does to the shell itself, as far as judging its commands needs: variables set to literal values
//! (substituted into later commands, a `for` loop's once per value), where `cd` went, and the statements that only
//! change this state (`cd`, assignments, `export`, loop and group keywords).
use super::{Path, Segment, Trust, cd_within, env_assignment, trust, unquote, writable};
use std::collections::HashMap;

/// Keywords that only open or close a compound command.
const KEYWORDS: &[&str] = &["do", "then", "else", "elif", "if", "while", "until", "!", "{"];
/// Statements that change nothing a later command depends on.
const INERT: &[&str] =
    &["done", "fi", "}", "esac", "break", "continue", ":", "true", "false", "wait", "shift", "exit", "return"];
/// Variants of one command a line's loops may produce; past it the command is judged as written.
const MAX_VARIANTS: usize = 32;
/// The shell's own startup files, which a login shell runs anyway.
const RC_FILES: &[&str] = &[".zshrc", ".zprofile", ".zshenv", ".bashrc", ".bash_profile", ".profile"];

#[derive(Default)]
pub(super) struct Shell {
    /// Variables known to hold only these literal words.
    vars: HashMap<String, Vec<String>>,
    /// A `cd` happened: relative paths are no longer relative to the workspace root.
    moved: bool,
    /// Where a `cd` inside the roots went, when known.
    dir: Option<std::path::PathBuf>,
    /// A `cd` left the workspace and the temporary directories: relative paths name files elsewhere.
    pub away: bool,
    /// A `cd` went into a temporary directory: nothing there is the repository the owner trusts.
    pub scratch: bool,
}

impl Shell {
    /// `words` with the bound variables substituted, one list per combination of their values; `None` past
    /// `MAX_VARIANTS`.
    pub fn expand(&self, words: &[String]) -> Option<Vec<Vec<String>>> {
        let mut variants = vec![words.to_vec()];
        for (name, values) in &self.vars {
            if !words.iter().any(|w| refers(w, name)) {
                continue;
            }
            if variants.len() * values.len() > MAX_VARIANTS {
                return None;
            }
            variants = variants
                .iter()
                .flat_map(|v| values.iter().map(move |value| v.iter().map(|w| substitute(w, name, value)).collect()))
                .collect();
        }
        Some(variants)
    }

    pub fn dir(&self) -> Option<&Path> {
        self.dir.as_deref()
    }

    /// `words` past leading `NAME=value` settings 帮我审批 allows (`trust::assignable`), e.g. `MAVEN_OPTS=-D… mvn`.
    pub fn past_assignments<'w>(&self, words: &'w [String], roots: &[&Path], help: bool) -> &'w [String] {
        let n = words
            .iter()
            .take_while(|w| {
                help && w.split_once('=').is_some_and(|(n, v)| identifier(n) && trust::assignable(n, v, roots, true))
            })
            .count();
        if n < words.len() { &words[n..] } else { words }
    }

    /// A relative path written to after a `cd` must not climb out of where it went.
    pub fn relative_ok(&self, path: &str) -> bool {
        let path = Path::new(unquote(path));
        !self.moved || path.is_absolute() || path.components().all(|c| c != std::path::Component::ParentDir)
    }

    /// Applies a statement that only changes the shell (`cd`, assignments, loop keywords) and says whether it is
    /// allowed; `None` for a command, judged by the caller. `follow` judges a file `source` runs.
    pub fn statement(
        &mut self,
        words: &[String],
        seg: &Segment,
        roots: &[&Path],
        trust: Trust,
        follow: &dyn Fn(&str) -> bool,
    ) -> Option<bool> {
        let mut w = words;
        while let Some(first) = w.first()
            && KEYWORDS.contains(&unquote(first))
        {
            w = &w[1..];
        }
        let writes_ok = seg.writes.is_empty()
            || (trust.help && !self.away && seg.writes.iter().all(|p| writable(p, roots) && self.relative_ok(p)));
        let Some(first) = w.first() else { return Some(writes_ok) };
        let ok = match unquote(first) {
            name if INERT.contains(&name) && w.len() <= 2 => true,
            "for" => {
                let var = unquote(w.get(1)?).to_string();
                match w.get(2).map(|x| unquote(x)) {
                    Some("in") => self.bind(&var, &w[3..]),
                    _ => {
                        self.vars.remove(&var);
                    }
                }
                seg.writes.is_empty()
            }
            "set" => w[1..].iter().all(|a| !super::expands(a)),
            "unset" => {
                w[1..].iter().for_each(|n| {
                    self.vars.remove(unquote(n));
                });
                true
            }
            "read" => {
                w[1..].iter().filter(|a| !a.starts_with('-')).for_each(|n| {
                    self.vars.remove(unquote(n));
                });
                w[1..].iter().all(|a| !super::expands(a))
            }
            "export" | "local" | "declare" | "typeset" | "readonly" => {
                let exported = unquote(first) == "export";
                w[1..].iter().filter(|a| !a.starts_with('-')).all(|a| self.assign(a, roots, exported, trust.help))
            }
            "cd" => self.cd(w, roots, trust),
            "source" | "." => {
                let file = unquote(w.get(1)?);
                let rc = file
                    .strip_prefix("~/")
                    .or_else(|| file.strip_prefix("$HOME/"))
                    .is_some_and(|f| RC_FILES.contains(&f));
                let ok = trust.help
                    && (rc || !self.away && trust::script_text(file, roots).is_some_and(|text| follow(&text)));
                self.vars.clear();
                ok
            }
            _ if w.iter().all(|a| assignment_word(a)) => w.iter().all(|a| self.assign(a, roots, false, trust.help)),
            _ => return None,
        };
        Some(ok && writes_ok)
    }

    fn cd(&mut self, w: &[String], roots: &[&Path], trust: Trust) -> bool {
        let dir = match &w[1..] {
            [] => None,
            [dir] => Some(unquote(dir)),
            _ => return false,
        };
        let base: Vec<&Path> = self.dir.as_deref().into_iter().chain(roots.iter().copied()).collect();
        let inside = !self.away && dir.is_some_and(|d| cd_within(&["cd".into(), d.to_string()], &base));
        let absolute_inside =
            dir.is_some_and(|d| Path::new(d).is_absolute() && cd_within(&["cd".into(), d.to_string()], roots));
        if inside || absolute_inside {
            let d = Path::new(dir.unwrap_or_default());
            let to = if d.is_absolute() { d.to_path_buf() } else { base[0].join(d) };
            let canon = |p: &Path| std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
            let temp = |t: &Path| to.starts_with(t) || canon(&to).starts_with(canon(t));
            self.scratch = roots.iter().skip(trust.own).any(|t| temp(t))
                && !(to.starts_with(roots[0]) || canon(&to).starts_with(canon(roots[0])));
            self.moved = true;
            self.away = false;
            self.dir = Some(to);
            return true;
        }
        let elsewhere = dir.is_none_or(|d| !super::expands(d) && !d.contains('`') && !trust::sensitive(d));
        if trust.help && elsewhere {
            self.moved = true;
            self.away = true;
            self.dir = None;
            return true;
        }
        false
    }

    /// `NAME=value` (or a bare `NAME` to export): allowed unless it may change what later commands run.
    fn assign(&mut self, word: &str, roots: &[&Path], exported: bool, help: bool) -> bool {
        let Some((name, value)) = word.split_once('=') else {
            return identifier(word) && help && trust::assignable(word, "", roots, exported);
        };
        if !identifier(name) {
            return false;
        }
        // Without 帮我审批 only what changes no program's behaviour: lowercase shell variables, output settings.
        let ok = (exported && env_assignment(word))
            || if help {
                trust::assignable(name, value, roots, exported)
            } else {
                !exported && super::assignment(word)
            };
        if ok {
            self.bind(name, &[value.to_string()]);
        }
        ok
    }

    /// Binds `name` to literal `values`, or forgets it when any could split, expand or read as an option.
    fn bind(&mut self, name: &str, values: &[String]) {
        let literal: Vec<String> = values.iter().map(|v| unquote(v).to_string()).collect();
        let plain = !literal.is_empty()
            && literal.iter().all(|v| {
                !v.is_empty() && !v.starts_with('-') && !v.contains(['$', '`', ' ', '\t', '\n', '\'', '"', '\\'])
            });
        if plain {
            self.vars.insert(name.to_string(), literal);
        } else {
            self.vars.remove(name);
        }
    }
}

fn identifier(name: &str) -> bool {
    let mut chars = name.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn assignment_word(w: &str) -> bool {
    w.split_once('=').is_some_and(|(name, _)| identifier(name))
}

/// Whether `word` expands `$name` or `${name}` (outside single quotes).
fn refers(word: &str, name: &str) -> bool {
    substitute(word, name, "\u{0}") != word
}

/// `word` with `$name` and `${name}` outside single quotes replaced by `value`.
fn substitute(word: &str, name: &str, value: &str) -> String {
    let (mut out, mut single, mut rest) = (String::new(), false, word);
    while let Some(c) = rest.chars().next() {
        if c == '\'' {
            single = !single;
        }
        if c == '$' && !single {
            let after = &rest[1..];
            let braced = format!("{{{name}}}");
            if let Some(tail) = after.strip_prefix(&braced) {
                out.push_str(value);
                rest = tail;
                continue;
            }
            if let Some(tail) = after.strip_prefix(name)
                && !tail.starts_with(|c: char| c.is_ascii_alphanumeric() || c == '_')
            {
                out.push_str(value);
                rest = tail;
                continue;
            }
        }
        out.push(c);
        rest = &rest[c.len_utf8()..];
    }
    out
}
