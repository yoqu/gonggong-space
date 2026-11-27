//! codex-acp sends every workspace-write turn (`workspace-write`, `agent`) with `networkAccess: false` hardcoded,
//! over any Codex config, so CLI plugins that reach a service fail in the sandbox (agentclientprotocol/codex-acp#406,
//! fixes #361 #368 #574 #608 unreviewed). Until upstream fixes it, the installed adapter is patched to let those turns
//! reach the network; writes stay limited to the workspace. Drop this when the pinned version honors the config.
use anyhow::{Context, bail};
use std::path::Path;

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

/// Patches codex-acp's `dist/index.js` in `pkg` once; fails when the source no longer has the code it rewrites.
pub(super) fn apply(pkg: &Path) -> anyhow::Result<()> {
    let script = pkg.join("dist/index.js");
    let source = std::fs::read_to_string(&script).with_context(|| format!("reading {}", script.display()))?;
    match patch(&source) {
        Some(patched) => std::fs::write(&script, patched).with_context(|| format!("writing {}", script.display())),
        None if source.contains(PATCHED) => Ok(()),
        None => bail!("codex-acp at {} changed: its workspace network patch no longer applies", pkg.display()),
    }
}

fn patch(source: &str) -> Option<String> {
    (source.matches(ORIGINAL).count() == 1).then(|| source.replacen(ORIGINAL, PATCHED, 1))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pkg(source: &str) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("dist")).unwrap();
        std::fs::write(dir.path().join("dist/index.js"), source).unwrap();
        dir
    }

    fn read(dir: &tempfile::TempDir) -> String {
        std::fs::read_to_string(dir.path().join("dist/index.js")).unwrap()
    }

    #[test]
    fn workspace_write_turns_get_the_network_once() {
        let source = format!("a();\n{ORIGINAL}    writableRoots: []\n  }};\n}}\n");
        let dir = pkg(&source);
        apply(dir.path()).unwrap();
        let patched = read(&dir);
        assert!(patched.contains("networkAccess: true") && !patched.contains(ORIGINAL));
        apply(dir.path()).unwrap();
        assert_eq!(read(&dir), patched);
    }

    #[test]
    fn a_changed_adapter_fails_instead_of_running_offline() {
        let dir = pkg("function somethingElse() {}\n");
        assert!(apply(dir.path()).is_err());
    }
}
