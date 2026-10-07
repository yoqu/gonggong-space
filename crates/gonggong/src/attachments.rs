//! Message attachments in the workspace (spec §8.7): `.gonggong/attachments/<messageId>/<name>`, kept out of git.
use crate::config::Config;
use crate::git;
use crate::protocol::Attachment;
use crate::t;
use crate::tls;
use agent_client_protocol::schema::v1::{ContentBlock, ImageContent, TextContent};
use base64::prelude::{BASE64_STANDARD, Engine as _};
use std::collections::HashSet;
use std::path::Path;
use tokio::io::AsyncWriteExt;

const DIR: &str = ".gonggong/attachments";
const EXCLUDE: &str = ".gonggong/";
/// Larger images are only written to disk; the agent reads them by path.
const IMAGE_INLINE_MAX: u64 = 5 * 1024 * 1024;
const IMAGE_TYPES: [&str; 4] = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/// Workspace-relative path. Names come sanitized from the server; only their last component is used regardless.
pub fn rel_path(a: &Attachment) -> String {
    let last = |s: &str| Path::new(s).file_name().map_or_else(|| "file".into(), |n| n.to_string_lossy().into_owned());
    format!("{DIR}/{}/{}", last(&a.message_id), last(&a.name))
}

/// Whether an attachment also goes to the agent as ACP image content.
pub fn inline_image(a: &Attachment, supported: bool) -> bool {
    supported && a.size <= IMAGE_INLINE_MAX && IMAGE_TYPES.contains(&a.mime.as_str())
}

/// Downloads the attachments missing from `cwd`; in a repo workspace `.gonggong/` goes into `.git/info/exclude`.
pub async fn fetch<'a>(api: &Config, cwd: &Path, list: impl IntoIterator<Item = &'a Attachment>) -> Result<(), String> {
    let mut seen = HashSet::new();
    let mut any = false;
    for a in list.into_iter().filter(|a| seen.insert(&a.id)) {
        any = true;
        let path = cwd.join(rel_path(a));
        if std::fs::metadata(&path).is_ok_and(|m| m.len() == a.size) {
            continue;
        }
        download(api, a, &path).await.map_err(|e| t!("附件下载失败：{name}：{e}", name = a.name, e = e))?;
    }
    if any && git::is_repo(cwd) {
        exclude(cwd).await.map_err(|e| t!("无法写入 .git/info/exclude：{e}", e = e))?;
    }
    Ok(())
}

async fn download(api: &Config, a: &Attachment, path: &Path) -> anyhow::Result<()> {
    let url = format!("{}/api/daemon/attachments/{}", api.server.trim_end_matches('/'), a.id);
    let mut res = tls::http()?.get(url).bearer_auth(&api.token).send().await?.error_for_status()?;
    tokio::fs::create_dir_all(path.parent().expect("attachment paths have a parent")).await?;
    // Written aside and renamed, so a cut-off download is never taken for the file.
    let mut part = path.as_os_str().to_owned();
    part.push(".part");
    let mut file = tokio::fs::File::create(&part).await?;
    while let Some(chunk) = res.chunk().await? {
        file.write_all(&chunk).await?;
    }
    file.flush().await?;
    tokio::fs::rename(&part, path).await?;
    Ok(())
}

async fn exclude(cwd: &Path) -> Result<(), String> {
    let file = cwd.join(git::git(cwd, &["rev-parse", "--git-path", "info/exclude"]).await?.trim());
    let current = std::fs::read_to_string(&file).unwrap_or_default();
    if current.lines().any(|l| l.trim() == EXCLUDE) {
        return Ok(());
    }
    let sep = if current.is_empty() || current.ends_with('\n') { "" } else { "\n" };
    std::fs::create_dir_all(file.parent().expect("exclude has a parent")).map_err(|e| e.to_string())?;
    std::fs::write(&file, format!("{current}{sep}{EXCLUDE}\n")).map_err(|e| e.to_string())
}

/// The prompt text, then the trigger's images when the agent accepts image content.
pub fn prompt_blocks(cwd: &Path, text: String, attachments: &[Attachment], image: bool) -> Vec<ContentBlock> {
    let images = attachments.iter().filter(|a| inline_image(a, image)).filter_map(|a| {
        let bytes = std::fs::read(cwd.join(rel_path(a))).inspect_err(|e| tracing::warn!("{}: {e}", a.name)).ok()?;
        Some(ContentBlock::Image(ImageContent::new(BASE64_STANDARD.encode(bytes), a.mime.clone())))
    });
    std::iter::once(ContentBlock::Text(TextContent::new(text))).chain(images).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn att(name: &str, mime: &str, size: u64) -> Attachment {
        Attachment { id: "a".into(), name: name.into(), size, mime: mime.into(), message_id: "m1".into() }
    }

    #[test]
    fn paths_keep_only_the_last_component() {
        assert_eq!(rel_path(&att("shot.png", "image/png", 1)), ".gonggong/attachments/m1/shot.png");
        assert_eq!(rel_path(&att("../../etc/passwd", "text/plain", 1)), ".gonggong/attachments/m1/passwd");
    }

    #[test]
    fn only_supported_small_raster_images_are_inlined() {
        assert!(inline_image(&att("a.png", "image/png", IMAGE_INLINE_MAX), true));
        assert!(!inline_image(&att("a.png", "image/png", 10), false));
        assert!(!inline_image(&att("a.png", "image/png", IMAGE_INLINE_MAX + 1), true));
        assert!(!inline_image(&att("a.svg", "image/svg+xml", 10), true));
        assert!(!inline_image(&att("a.log", "text/plain", 10), true));
    }
}
