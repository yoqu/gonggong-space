use super::*;

#[tokio::test]
async fn an_agent_off_npm_is_neither_installed_nor_checked_for_updates() {
    assert_eq!(ToolKind::Antigravity.package(), None);
    let command = ToolKind::Antigravity.own_install().unwrap();
    assert!(command.starts_with("curl -fsSL https://antigravity.google/"));
    assert_eq!(ToolKind::Gemini.own_install(), None);
    assert_eq!(ToolKind::Node.own_install(), None);
    let home = tempfile::tempdir().unwrap();
    let err = install(home.path(), ToolKind::Antigravity, None, &|_| {}).await.unwrap_err();
    assert!(format!("{err:#}").contains(command), "{err:#}");
    assert!(latest(home.path(), ToolKind::Antigravity, true).await.is_err(), "no npm to ask");
}

#[test]
fn picks_node_archives_per_platform() {
    assert_eq!(platform_for("macos", "aarch64"), Some("darwin-arm64"));
    assert_eq!(platform_for("linux", "x86_64"), Some("linux-x64"));
    assert_eq!(platform_for("windows", "x86_64"), Some("win-x64"));
    assert_eq!(platform_for("freebsd", "x86_64"), None);
    assert_eq!(node_archive_name("24.2.0", "darwin-arm64"), "node-v24.2.0-darwin-arm64.tar.gz");
    assert_eq!(node_archive_name("24.2.0", "win-x64"), "node-v24.2.0-win-x64.zip");
}

#[test]
fn picks_the_newest_lts_from_22() {
    let index = r#"[{"version":"v25.1.0","lts":false},{"version":"v22.20.0","lts":"Jod"},
        {"version":"v24.10.0","lts":"Krypton"},{"version":"v24.9.0","lts":"Krypton"},{"version":"v20.1.0","lts":"Iron"}]"#;
    assert_eq!(latest_lts(index).unwrap(), "24.10.0");
    assert!(latest_lts(r#"[{"version":"v20.1.0","lts":"Iron"},{"version":"v25.0.0","lts":false}]"#).is_err());
    assert!(latest_lts("<html>").is_err());
}

#[test]
fn finds_the_archive_checksum() {
    let sums =
        "aaa  node-v24.2.0-darwin-arm64.tar.xz\nbbb  node-v24.2.0-darwin-arm64.tar.gz\nccc *node-v24.2.0-win-x64.zip\n";
    assert_eq!(checksum(sums, "node-v24.2.0-darwin-arm64.tar.gz"), Some("bbb"));
    assert_eq!(checksum(sums, "node-v24.2.0-win-x64.zip"), Some("ccc"));
    assert_eq!(checksum(sums, "node-v24.2.0-linux-x64.tar.gz"), None);
}

#[test]
fn accepts_only_latest_or_exact_versions() {
    assert_eq!(requested("latest").unwrap(), None);
    assert_eq!(requested("2.1.285").unwrap().as_deref(), Some("2.1.285"));
    assert_eq!(requested("v24.2.0").unwrap().as_deref(), Some("24.2.0"));
    assert_eq!(requested("0.160.0-alpha.3").unwrap().as_deref(), Some("0.160.0-alpha.3"));
    for bad in ["", "2", "2.1", "^2.1.0", "2.1.0 --registry=x", "--foo", "1.0.0;rm", "next", "1.0.0-", "../1.0.0"] {
        assert!(requested(bad).is_err(), "{bad}");
    }
}

#[test]
fn one_operation_at_a_time() {
    let home = tempfile::tempdir().unwrap();
    let held = busy(home.path()).unwrap();
    assert!(busy(home.path()).is_err());
    drop(held);
    // A child forked by a parallel test briefly shares the lock's file description until its exec closes it.
    let freed = (0..50).any(|_| {
        busy(home.path()).is_ok() || {
            std::thread::sleep(std::time::Duration::from_millis(20));
            false
        }
    });
    assert!(freed);
}

#[test]
fn switches_the_current_runtime_atomically() {
    let home = tempfile::tempdir().unwrap();
    for v in ["node-v22.1.0", "node-v24.2.0"] {
        std::fs::create_dir_all(runtime_dir(home.path()).join(v)).unwrap();
    }
    assert_eq!(current_runtime(home.path()), None);
    switch_current(home.path(), "node-v22.1.0").unwrap();
    assert!(current_runtime(home.path()).unwrap().ends_with("node-v22.1.0"));
    switch_current(home.path(), "node-v24.2.0").unwrap();
    assert!(current_runtime(home.path()).unwrap().ends_with("node-v24.2.0"));
}

#[test]
fn upgrades_a_self_installed_cli_the_way_it_was_installed() {
    let how = |kind, path: &str| self_upgrade(kind, Path::new(path));
    let brew = how(ToolKind::Codex, "/opt/homebrew/Caskroom/codex/0.40.0/codex-aarch64-apple-darwin").unwrap();
    assert_eq!(brew, SelfUpgrade::Brew { brew: "/opt/homebrew/bin/brew".into(), name: "codex" });
    assert_eq!(brew.command(), "brew upgrade codex");
    let brew = how(ToolKind::Claude, "/usr/local/Caskroom/claude-code/2.1.0/claude").unwrap();
    assert_eq!(brew, SelfUpgrade::Brew { brew: "/usr/local/bin/brew".into(), name: "claude-code" });
    assert_eq!(brew.command(), "brew upgrade claude-code");
    let linuxbrew = how(ToolKind::Codex, "/home/linuxbrew/.linuxbrew/Cellar/codex/0.40.0/bin/codex").unwrap();
    assert_eq!(linuxbrew, SelfUpgrade::Brew { brew: "/home/linuxbrew/.linuxbrew/bin/brew".into(), name: "codex" });

    let claude = how(ToolKind::Claude, "/Users/wl/.local/share/claude/versions/2.1.0").unwrap();
    assert_eq!(claude, SelfUpgrade::ClaudeUpdate);
    assert_eq!(claude.command(), "claude update");

    let npm = how(ToolKind::Codex, "/Users/wl/.nvm/versions/node/v22.1.0/lib/node_modules/@openai/codex/bin/codex.js");
    let prefix = PathBuf::from("/Users/wl/.nvm/versions/node/v22.1.0");
    assert_eq!(npm, Some(SelfUpgrade::Npm { prefix: prefix.clone(), package: "@openai/codex" }));
    assert_eq!(npm.unwrap().command(), "npm i -g @openai/codex@latest");
    let gemini = how(
        ToolKind::Gemini,
        "/Users/wl/.nvm/versions/node/v22.1.0/lib/node_modules/@google/gemini-cli/bundle/gemini.js",
    );
    assert_eq!(gemini, Some(SelfUpgrade::Npm { prefix, package: "@google/gemini-cli" }));
    assert_eq!(gemini.unwrap().command(), "npm i -g @google/gemini-cli@latest");
    let brew = how(ToolKind::Gemini, "/opt/homebrew/Cellar/gemini-cli/0.67.0/libexec/bin/gemini").unwrap();
    assert_eq!(brew.command(), "brew upgrade gemini-cli");

    // A standalone binary is not npm's to replace; Node is never upgraded for the user.
    assert_eq!(how(ToolKind::Codex, "/usr/local/bin/codex"), None);
    assert_eq!(how(ToolKind::Node, "/opt/homebrew/Cellar/node/24.2.0/bin/node"), None);
}

#[cfg(unix)]
#[tokio::test]
async fn a_permission_error_says_why_and_points_to_the_managed_install() {
    let mut cmd = crate::proc::async_command("sh");
    cmd.args(["-c", "echo 'npm error code EACCES' >&2; echo 'npm error A complete log'; exit 1"]);
    let lines = std::sync::Mutex::new(Vec::new());
    let err = run_self(cmd, "npm", ToolKind::Codex, &|l| lines.lock().unwrap().push(l.to_string())).await.unwrap_err();
    let msg = format!("{err:#}");
    assert!(msg.contains("没有写入权限"), "{msg}");
    assert!(msg.contains("托管安装"), "{msg}");
    assert_eq!(lines.lock().unwrap().len(), 2);

    let mut cmd = crate::proc::async_command("sh");
    cmd.args(["-c", "echo boom; exit 3"]);
    let msg = format!("{:#}", run_self(cmd, "npm", ToolKind::Codex, &|_| {}).await.unwrap_err());
    assert!(msg.contains("boom") && !msg.contains("没有写入权限"), "{msg}");
}

#[test]
fn a_custom_mirror_needs_both_urls() {
    let home = tempfile::tempdir().unwrap();
    assert!(set_mirror(home.path(), Some("http://r.local".into()), None).is_err());
    assert!(set_mirror(home.path(), Some("official".into()), Some("http://n.local".into())).is_err());
    assert!(set_mirror(home.path(), Some("ftp://r.local".into()), Some("http://n.local".into())).is_err());
    set_mirror(home.path(), Some("http://r.local".into()), Some("http://n.local".into())).unwrap();
    assert_eq!(Settings::load(home.path()).unwrap().mirror.registry(), "http://r.local");
    set_mirror(home.path(), Some("official".into()), None).unwrap();
    assert_eq!(Settings::load(home.path()).unwrap().mirror, Mirror::Official);
}
