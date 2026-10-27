//! How many git processes the turn bookkeeping spawns. Its own process: a recording `git` goes first on PATH.
#![cfg(unix)]
use gonggong::git;
use gonggong::protocol::WorkspaceKind;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::Command;

fn run(git: &Path, dir: &Path, args: &[&str]) {
    let out = Command::new(git)
        .arg("-C")
        .arg(dir)
        .args(["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"])
        .args(args)
        .output()
        .unwrap();
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
}

/// Takes the recorded invocations, one line of arguments each.
fn calls(log: &Path) -> Vec<String> {
    let lines = std::fs::read_to_string(log).unwrap_or_default().lines().map(String::from).collect();
    std::fs::write(log, "").unwrap();
    lines
}

fn count(calls: &[String], needle: &str) -> usize {
    calls.iter().filter(|c| c.contains(needle)).count()
}

#[tokio::test]
async fn a_turn_scans_and_stages_the_work_tree_once_after_it_ends() {
    let real = Command::new("sh").args(["-c", "command -v git"]).output().unwrap();
    let real = String::from_utf8(real.stdout).unwrap().trim().to_string();
    let tmp = tempfile::tempdir().unwrap();
    let (bin, log, w) = (tmp.path().join("bin"), tmp.path().join("git.log"), tmp.path().join("w"));
    std::fs::create_dir_all(&bin).unwrap();
    let wrapper = bin.join("git");
    std::fs::write(
        &wrapper,
        format!("#!/bin/sh\nprintf '%s\\n' \"$*\" >> '{}'\nexec '{real}' \"$@\"\n", log.display()),
    )
    .unwrap();
    std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o755)).unwrap();
    // SAFETY: set before this single-test process starts any other thread that reads the environment.
    unsafe { std::env::set_var("PATH", format!("{}:{}", bin.display(), std::env::var("PATH").unwrap())) };

    let real = Path::new(&real);
    std::fs::create_dir_all(&w).unwrap();
    run(real, &w, &["init", "-q", "-b", "main"]);
    std::fs::write(w.join("README.md"), "hi\n").unwrap();
    run(real, &w, &["add", "-A"]);
    run(real, &w, &["commit", "-q", "-m", "init"]);
    std::fs::write(w.join("wip.txt"), "dirty before\n").unwrap();

    let tracked = git::track(&w, &[]).await;
    let pre = calls(&log);
    assert_eq!(count(&pre, " status --porcelain"), 1, "{pre:#?}");

    std::fs::write(w.join("README.md"), "hi\nturn\n").unwrap();
    std::fs::write(w.join("wip.txt"), "dirty before\nand during\n").unwrap();
    let (status, changed, patch) = git::turn_end(&w, &[], WorkspaceKind::Cd, &tracked).await;
    let post = calls(&log);
    eprintln!("git processes: {} before the turn, {} after it", pre.len(), post.len());
    assert_eq!((status.unwrap().dirty_count, changed.unwrap()), (Some(2), 2));
    let patch = patch.unwrap().patch.unwrap();
    assert!(patch.contains("+turn\n") && patch.contains("+and during\n"), "{patch}");
    assert_eq!(count(&post, " status --porcelain"), 1, "{post:#?}");
    assert_eq!(count(&post, " add -A"), 1, "{post:#?}");
    assert_eq!(count(&post, " symbolic-ref"), 1, "{post:#?}");

    // A turn that changed nothing compares no trees.
    let tracked = git::track(&w, &[]).await;
    calls(&log);
    let (_, changed, patch) = git::turn_end(&w, &[], WorkspaceKind::Cd, &tracked).await;
    let post = calls(&log);
    eprintln!("git processes after a turn without changes: {}", post.len());
    assert_eq!((changed.unwrap(), patch.unwrap().patch), (0, None));
    assert_eq!(count(&post, " diff --no-color"), 0, "{post:#?}");
    assert_eq!(count(&post, " status --porcelain"), 1, "{post:#?}");
}
