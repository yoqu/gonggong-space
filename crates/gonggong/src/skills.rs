//! Team skills (plan 团队Skill): one Claude plugin folder per (group, bot) under the daemon home, holding the run's
//! merged skills. Claude loads it through `_meta.claudeCode.options.plugins`; Codex finds each skill through a link
//! in `<cwd>/.agents/skills/`, kept out of git. Both list them as `gonggong-team:<name>`.
use crate::config::Config;
use crate::git;
use crate::protocol::{AgentKind, DaemonSkillRes, SkillEncoding, SkillRef};
use crate::t;
use crate::tls;
use base64::prelude::{BASE64_STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};

pub const PLUGIN: &str = "gonggong-team";
const STATE: &str = "state.json";

/// The skills in effect for a turn.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Installed {
    /// The plugin folder (`.claude-plugin/plugin.json` + `skills/<name>/`).
    pub dir: PathBuf,
    /// Installed skill names, sorted; a change needs a new adapter process for Claude to see it.
    pub names: Vec<String>,
    /// Left out: the repo already has a skill of that name.
    pub skipped: Vec<String>,
}

/// What the folder holds, so unchanged skills are not fetched again and only our own Codex links are removed.
#[derive(Debug, Default, Serialize, Deserialize)]
struct State {
    digests: BTreeMap<String, String>,
    links: Vec<PathBuf>,
}

pub fn set_dir(home: &Path, group_id: &str, bot_id: &str) -> PathBuf {
    home.join("skill-sets").join(format!("{group_id}-{bot_id}"))
}

/// Brings the (group, bot) plugin folder and, for Codex, the workspace links in line with `refs`.
pub async fn install(
    api: &Config,
    dir: &Path,
    kind: AgentKind,
    cwd: &Path,
    refs: &[SkillRef],
) -> Result<Installed, String> {
    let e = |e: std::io::Error| t!("无法安装团队 skill：{e}", e = e);
    let skills = dir.join("skills");
    tokio::fs::create_dir_all(&skills).await.map_err(e)?;
    let mut state: State =
        tokio::fs::read(dir.join(STATE)).await.ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    let roots = roots(cwd);
    let (mut kept, mut skipped) = (vec![], vec![]);
    for r in refs {
        let ours = |p: &PathBuf| state.links.contains(p);
        if roots.iter().any(|root| baseline(root, kind, &r.name).is_some_and(|p| !ours(&p))) {
            skipped.push(r.name.clone());
        } else {
            kept.push(r);
        }
    }

    for r in &kept {
        let target = skills.join(&r.name);
        if state.digests.get(&r.name) == Some(&r.digest) && target.is_dir() {
            continue;
        }
        let tmp = skills.join(format!(".{}.partial", r.name));
        fetch(api, r, &tmp).await?;
        let _ = tokio::fs::remove_dir_all(&target).await;
        tokio::fs::rename(&tmp, &target).await.map_err(e)?;
        state.digests.insert(r.name.clone(), r.digest.clone());
    }
    let names: Vec<String> = kept.iter().map(|r| r.name.clone()).collect();
    let mut entries = tokio::fs::read_dir(&skills).await.map_err(e)?;
    while let Some(entry) = entries.next_entry().await.map_err(e)? {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !names.contains(&name) {
            let _ = tokio::fs::remove_dir_all(entry.path()).await;
        }
    }
    state.digests.retain(|n, _| names.contains(n));
    let manifest = dir.join(".claude-plugin/plugin.json");
    if !manifest.exists() {
        tokio::fs::create_dir_all(manifest.parent().expect("has a parent")).await.map_err(e)?;
        let json = serde_json::json!({ "name": PLUGIN, "description": "Team skills managed by Gonggong" });
        tokio::fs::write(&manifest, json.to_string()).await.map_err(e)?;
    }

    let wanted: Vec<PathBuf> = if kind == AgentKind::Codex {
        names.iter().map(|n| cwd.join(".agents/skills").join(n)).collect()
    } else {
        vec![]
    };
    for old in state.links.iter().filter(|l| !wanted.contains(l)) {
        unlink(old).await;
    }
    for (name, at) in names.iter().zip(&wanted) {
        unlink(at).await;
        link(&skills.join(name), at).await.map_err(e)?;
        if let Some(root) = roots.last().filter(|r| git::is_repo(r)) {
            let rel = at.strip_prefix(root).unwrap_or(at).to_string_lossy().replace('\\', "/");
            git::exclude(cwd, &format!("/{rel}")).await.map_err(|e| t!("无法写入 .git/info/exclude：{e}", e = e))?;
        }
    }
    state.links = wanted;
    let json = serde_json::to_vec(&state).expect("state serializes");
    tokio::fs::write(dir.join(STATE), json).await.map_err(e)?;
    Ok(Installed { dir: dir.to_path_buf(), names, skipped })
}

/// `cwd` and its parents up to the workspace's repo root (the first with `.git`), where agents look for repo skills.
fn roots(cwd: &Path) -> Vec<PathBuf> {
    let mut out = vec![];
    for dir in cwd.ancestors() {
        out.push(dir.to_path_buf());
        if git::is_repo(dir) {
            return out;
        }
    }
    vec![cwd.to_path_buf()]
}

/// The repo's own skill of that name, if any (Claude: `.claude/skills/<name>`, Codex: `.agents/skills/<name>`).
fn baseline(root: &Path, kind: AgentKind, name: &str) -> Option<PathBuf> {
    let dir = if kind == AgentKind::Codex { ".agents/skills" } else { ".claude/skills" };
    let p = root.join(dir).join(name);
    p.symlink_metadata().is_ok().then_some(p)
}

async fn fetch(api: &Config, r: &SkillRef, dir: &Path) -> Result<(), String> {
    let e = |e: String| t!("无法下载团队 skill {name}：{e}", name = r.name, e = e);
    let url = format!("{}/api/daemon/skills/{}", api.server.trim_end_matches('/'), r.version_id);
    let res: DaemonSkillRes = async {
        tls::http()?.get(url).bearer_auth(&api.token).send().await?.error_for_status()?.json().await.map_err(Into::into)
    }
    .await
    .map_err(|err: anyhow::Error| e(format!("{err:#}")))?;
    let _ = tokio::fs::remove_dir_all(dir).await;
    for f in res.files {
        let rel = Path::new(&f.path);
        if !rel.components().all(|c| matches!(c, Component::Normal(_))) {
            return Err(e(t!("文件路径不合法：{path}", path = f.path)));
        }
        let bytes = match f.encoding {
            SkillEncoding::Utf8 => f.content.into_bytes(),
            SkillEncoding::Base64 => BASE64_STANDARD.decode(&f.content).map_err(|err| e(err.to_string()))?,
        };
        let path = dir.join(rel);
        tokio::fs::create_dir_all(path.parent().expect("has a parent")).await.map_err(|err| e(err.to_string()))?;
        tokio::fs::write(&path, bytes).await.map_err(|err| e(err.to_string()))?;
    }
    Ok(())
}

async fn unlink(p: &Path) {
    match p.symlink_metadata() {
        Ok(m) if m.is_dir() => drop(tokio::fs::remove_dir_all(p).await),
        Ok(_) => drop(tokio::fs::remove_file(p).await),
        Err(_) => {}
    }
}

/// A symlink where possible, so content updates apply without touching the workspace; Windows gets a copy.
async fn link(target: &Path, at: &Path) -> std::io::Result<()> {
    tokio::fs::create_dir_all(at.parent().expect("has a parent")).await?;
    #[cfg(unix)]
    return tokio::fs::symlink(target, at).await;
    #[cfg(windows)]
    return copy_dir(target.to_path_buf(), at.to_path_buf()).await;
}

#[cfg(windows)]
async fn copy_dir(from: PathBuf, to: PathBuf) -> std::io::Result<()> {
    tokio::task::spawn_blocking(move || {
        fn walk(from: &Path, to: &Path) -> std::io::Result<()> {
            std::fs::create_dir_all(to)?;
            for entry in std::fs::read_dir(from)? {
                let entry = entry?;
                let dest = to.join(entry.file_name());
                if entry.file_type()?.is_dir() {
                    walk(&entry.path(), &dest)?
                } else {
                    std::fs::copy(entry.path(), dest).map(drop)?
                }
            }
            Ok(())
        }
        walk(&from, &to)
    })
    .await?
}
