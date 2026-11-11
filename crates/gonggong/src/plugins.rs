//! Plugins (plan 插件体系): each version is unpacked once into `plugin-sets/<name>-<digest>/` under the daemon home and
//! shared by every run. Claude loads each folder as a plugin named `name` (skills `<name>:<skill>`); Codex and Gemini
//! find each entry skill through a link `<cwd>/.agents/skills/<name>-<skill>`, kept out of git and removed with the
//! plugin.
use crate::config::Config;
use crate::git;
use crate::protocol::{AgentKind, PluginRef};
use crate::skills;
use crate::t;
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};

/// The plugins in effect for a turn.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Installed {
    /// One plugin folder per plugin, in run order; a change needs a new adapter process.
    pub dirs: Vec<PathBuf>,
}

/// The Codex / Gemini links made for a (group, bot), so only ours are removed.
#[derive(Debug, Default, Serialize, Deserialize)]
struct State {
    links: Vec<Link>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct Link {
    path: PathBuf,
    /// The repo whose exclude file lists it.
    repo: Option<PathBuf>,
}

impl Link {
    fn pattern(&self, repo: &Path) -> String {
        let rel = self.path.strip_prefix(repo).unwrap_or(&self.path);
        format!("/{}", rel.to_string_lossy().replace('\\', "/"))
    }
}

/// Brings the plugin folders and, for Codex and Gemini, the workspace links of (group, bot) in line with `refs`.
pub async fn install(
    api: &Config,
    home: &Path,
    (group_id, bot_id): (&str, &str),
    kind: AgentKind,
    cwd: &Path,
    refs: &[PluginRef],
) -> Result<Installed, String> {
    let e = |e: std::io::Error| t!("无法安装插件：{e}", e = e);
    let sets = home.join("plugin-sets");
    let mut dirs = vec![];
    for r in refs {
        if !plain(&r.name) || !plain(&r.digest) {
            return Err(t!("插件名或版本不合法：{name}", name = r.name));
        }
        let dir = sets.join(format!("{}-{}", r.name, r.digest));
        if !dir.is_dir() {
            fetch(api, r, &sets, &dir).await?;
        }
        confine(&dir).await.map_err(e)?;
        // Last use, for the janitor: a version no turn takes for a month is removed.
        let _ = tokio::fs::write(sets.join(format!(".{}-{}.used", r.name, r.digest)), b"").await;
        dirs.push(dir);
    }

    let state_file = home.join("plugin-links").join(format!("{group_id}-{bot_id}.json"));
    let mut state: State =
        tokio::fs::read(&state_file).await.ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    let repo = skills::repo_root(cwd);
    let mut wanted: Vec<(Link, PathBuf)> = vec![];
    if kind.links_skills() {
        for (r, dir) in refs.iter().zip(&dirs) {
            for skill in entry_skills(dir).await.map_err(e)? {
                let path = cwd.join(".agents/skills").join(format!("{}-{skill}", r.name));
                // The repo's own skill of that name stays.
                if path.symlink_metadata().is_ok() && !state.links.iter().any(|l| l.path == path) {
                    continue;
                }
                wanted.push((Link { path, repo: repo.clone() }, dir.join("skills").join(skill)));
            }
        }
    }
    let excluded = |e: String| t!("无法写入 .git/info/exclude：{e}", e = e);
    for old in state.links.iter().filter(|l| !wanted.iter().any(|(w, _)| w.path == l.path)) {
        skills::unlink(&old.path).await;
        if let Some(repo) = old.repo.as_deref().filter(|r| r.is_dir()) {
            git::unexclude(repo, &old.pattern(repo)).await.map_err(excluded)?;
        }
    }
    for (l, target) in &wanted {
        skills::unlink(&l.path).await;
        skills::link(target, &l.path).await.map_err(e)?;
        if let Some(repo) = &l.repo {
            git::exclude(cwd, &l.pattern(repo)).await.map_err(excluded)?;
        }
    }
    state.links = wanted.into_iter().map(|(l, _)| l).collect();
    tokio::fs::create_dir_all(state_file.parent().expect("has a parent")).await.map_err(e)?;
    tokio::fs::write(&state_file, serde_json::to_vec(&state).expect("state serializes")).await.map_err(e)?;
    Ok(Installed { dirs })
}

/// A single path component, safe to put in a folder or link name.
fn plain(s: &str) -> bool {
    let mut parts = Path::new(s).components();
    matches!(parts.next(), Some(Component::Normal(_))) && parts.next().is_none() && !s.contains(['/', '\\'])
}

/// Unpacks a version into a private folder, then moves it in place; a run that got there first wins.
async fn fetch(api: &Config, r: &PluginRef, sets: &Path, dir: &Path) -> Result<(), String> {
    let e = |e: String| t!("无法下载插件 {name}：{e}", name = r.name, e = e);
    let tmp = sets.join(format!(".{}-{}.{}.partial", r.name, r.digest, uuid::Uuid::new_v4()));
    let unpacked = async {
        skills::download(api, &format!("plugins/{}", r.version_id), &tmp).await?;
        let manifest = tmp.join(".claude-plugin/plugin.json");
        tokio::fs::create_dir_all(manifest.parent().expect("has a parent")).await.map_err(|e| e.to_string())?;
        let json = serde_json::json!({ "name": r.name, "description": "Plugin managed by Gonggong" });
        tokio::fs::write(&manifest, json.to_string()).await.map_err(|e| e.to_string())?;
        tokio::fs::rename(&tmp, dir).await.or_else(|err| if dir.is_dir() { Ok(()) } else { Err(err.to_string()) })
    }
    .await;
    let _ = tokio::fs::remove_dir_all(&tmp).await;
    unpacked.map_err(e)
}

/// Removes from a plugin folder whatever the server's path allowlist refuses (plan 插件扩展点 §3.1), so Claude, which
/// loads the folder as a local plugin, finds no hooks, MCP servers, commands or agents; folders unpacked before the
/// server refused them are cleaned too.
async fn confine(dir: &Path) -> std::io::Result<()> {
    let mut entries = tokio::fs::read_dir(dir).await?;
    while let Some(entry) = entries.next_entry().await? {
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_dir = entry.file_type().await?.is_dir();
        let keep = if is_dir {
            matches!(name.as_str(), "skills" | "previews" | "assets" | "contrib" | ".claude-plugin")
        } else {
            name == "gonggong-plugin.json" || name == "LICENSE" || name.ends_with(".md")
        };
        if !keep {
            remove(&entry.path(), is_dir).await?;
        }
    }
    let Ok(mut meta) = tokio::fs::read_dir(dir.join(".claude-plugin")).await else { return Ok(()) };
    while let Some(entry) = meta.next_entry().await? {
        if entry.file_name() != "plugin.json" {
            remove(&entry.path(), entry.file_type().await?.is_dir()).await?;
        }
    }
    Ok(())
}

async fn remove(path: &Path, is_dir: bool) -> std::io::Result<()> {
    if is_dir { tokio::fs::remove_dir_all(path).await } else { tokio::fs::remove_file(path).await }
}

/// `skills/<entry>/SKILL.md` of a plugin folder, sorted by entry name.
async fn entry_skills(dir: &Path) -> std::io::Result<Vec<String>> {
    let mut out = vec![];
    let Ok(mut entries) = tokio::fs::read_dir(dir.join("skills")).await else { return Ok(out) };
    while let Some(entry) = entries.next_entry().await? {
        if entry.path().join("SKILL.md").is_file() {
            out.push(entry.file_name().to_string_lossy().into_owned());
        }
    }
    out.sort();
    Ok(out)
}
