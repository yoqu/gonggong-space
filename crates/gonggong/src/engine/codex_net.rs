//! codex-acp sends every workspace-write turn (`workspace-write`, `agent`) with `networkAccess: false` hardcoded,
//! over any Codex config, so CLI plugins that reach a service fail in the sandbox (agentclientprotocol/codex-acp#406,
//! fixes #361 #368 #574 #608 unreviewed). Until upstream fixes it, Codex runs a patched copy of the adapter's entry
//! that lets those turns reach the network; writes stay limited to the workspace. The npm original stays untouched,
//! so a daemon without this patch (a rollback) runs it offline again. Drop this when the pinned version honors the
//! config.
use crate::protocol::AgentKind;
use anyhow::{Context, bail};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const ORIGINAL: &str = "function addAdditionalDirectoriesToSandboxPolicy(sandboxPolicy, additionalDirectories) {
  if (additionalDirectories.length === 0 || sandboxPolicy.type !== \"workspaceWrite\") {
    return sandboxPolicy;
  }
  return {
    ...sandboxPolicy,
";

const PATCHED: &str = "function addAdditionalDirectoriesToSandboxPolicy(sandboxPolicy, additionalDirectories) {
  if (sandboxPolicy.type !== \"workspaceWrite\") {
    return sandboxPolicy;
  }
  return {
    ...sandboxPolicy,
    networkAccess: true /* gonggong: codex-acp#406 */,
";

/// Beside the original, so its relative imports and `import.meta.url` lookups resolve the same.
const ENTRY: &str = "index.gonggong-net.js";

/// The adapter entry `script` an agent of `kind` runs: Codex's is the patched copy, rebuilt from the original when
/// missing or stale (the next npm install wipes it with the package). Other agents' entries are left as they are.
pub(super) async fn entry(kind: AgentKind, script: PathBuf) -> anyhow::Result<PathBuf> {
    if kind != AgentKind::Codex {
        return Ok(script);
    }
    tokio::task::spawn_blocking(move || patched_entry(&script)).await?
}

fn patched_entry(script: &Path) -> anyhow::Result<PathBuf> {
    let source = std::fs::read_to_string(script).with_context(|| format!("reading {}", script.display()))?;
    if source.matches(ORIGINAL).count() != 1 {
        bail!("codex-acp at {} changed: its workspace network patch no longer applies", script.display());
    }
    let patched = source.replacen(ORIGINAL, PATCHED, 1);
    let entry = script.with_file_name(ENTRY);
    if std::fs::read_to_string(&entry).is_ok_and(|e| e == patched) {
        return Ok(entry);
    }
    // A write cut short must not leave a half entry that a later start would run.
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let n = NEXT.fetch_add(1, Ordering::Relaxed);
    let tmp = script.with_file_name(format!("{ENTRY}.{}-{n}.tmp", std::process::id()));
    std::fs::write(&tmp, patched).with_context(|| format!("writing {}", tmp.display()))?;
    std::fs::rename(&tmp, &entry).inspect_err(|_| _ = std::fs::remove_file(&tmp))?;
    Ok(entry)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn script(source: &str) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("index.js");
        std::fs::write(&script, source).unwrap();
        (dir, script)
    }

    #[test]
    fn the_patch_was_written_for_the_pinned_codex_adapter() {
        let (kind, _, version) = super::super::ADAPTERS.iter().find(|(k, ..)| *k == AgentKind::Codex).unwrap();
        assert_eq!((*kind, *version), (AgentKind::Codex, "2.12.0"));
    }

    #[tokio::test]
    async fn codex_runs_a_patched_copy_and_leaves_the_original_alone() {
        let source = format!("a();\n{ORIGINAL}    writableRoots: []\n  }};\n}}\n");
        let (_dir, original) = script(&source);
        let entry = entry(AgentKind::Codex, original.clone()).await.unwrap();
        assert_eq!(entry, original.with_file_name(ENTRY));
        let patched = std::fs::read_to_string(&entry).unwrap();
        assert!(patched.contains("networkAccess: true") && !patched.contains(ORIGINAL));
        assert_eq!(std::fs::read_to_string(&original).unwrap(), source);
        std::fs::write(&entry, "half").unwrap();
        entry_again(&original, &patched).await;
        let files = std::fs::read_dir(original.parent().unwrap()).unwrap().count();
        assert_eq!(files, 2, "no temporary file is left behind");
    }

    async fn entry_again(original: &Path, patched: &str) {
        let entry = entry(AgentKind::Codex, original.to_path_buf()).await.unwrap();
        assert_eq!(std::fs::read_to_string(entry).unwrap(), patched);
    }

    #[tokio::test]
    async fn only_codex_needs_the_patch() {
        let (_dir, original) = script("function somethingElse() {}\n");
        assert_eq!(entry(AgentKind::Claude, original.clone()).await.unwrap(), original);
        assert!(entry(AgentKind::Codex, original).await.is_err());
    }
}
