//! Manual git from the group (git.refs / log / tree / read / compare / action) against a temp clone of a local bare
//! remote, driven through the Engine.
use gonggong::engine::{Engine, EngineConfig};
use gonggong::protocol::*;
use gonggong::service::{Handler, Outbox, OutboxRx};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

pub(super) fn sh(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .args(["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"])
        .args(args)
        .current_dir(dir)
        .env_remove("GIT_AUTHOR_NAME")
        .env_remove("GIT_AUTHOR_EMAIL")
        .env_remove("GIT_COMMITTER_NAME")
        .env_remove("GIT_COMMITTER_EMAIL")
        .env("LC_ALL", "C")
        .output()
        .unwrap();
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

pub(super) fn commit(dir: &Path, file: &str, content: &str, msg: &str) {
    let path = dir.join(file);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, content).unwrap();
    sh(dir, &["add", "-A"]);
    sh(dir, &["commit", "-q", "-m", msg]);
}

pub(super) const DOC: &str = "line one\nline two\nline three\nline four\nline five\n";

pub(super) struct Rig {
    pub(super) engine: Engine,
    pub(super) out: Outbox,
    pub(super) rx: OutboxRx,
    pub(super) _home: tempfile::TempDir,
    pub(super) _tmp: tempfile::TempDir,
    pub(super) remote: PathBuf,
    /// The bot's /cd workspace: a clone of `remote` on main.
    pub(super) work: PathBuf,
    /// Someone else's clone, pushing to `remote`.
    pub(super) other: PathBuf,
    /// The workspace.state sent after the last action.
    pub(super) state: Option<WorkspaceState>,
    /// The last action's answer beyond its text.
    pub(super) detail: Option<GitActionDetail>,
}

/// remote.git: main (README.md, src/a.txt, docs/old.md, logo.png) and feat (a.txt changed, b.txt added, old.md
/// renamed to new.md).
pub(super) fn rig() -> Rig {
    gonggong::i18n::set_locale(gonggong::i18n::Locale::Zh);
    let tmp = tempfile::tempdir().unwrap();
    let seed = tmp.path().join("seed");
    fs::create_dir(&seed).unwrap();
    sh(&seed, &["init", "-q", "-b", "main"]);
    fs::create_dir_all(seed.join("src")).unwrap();
    fs::create_dir_all(seed.join("docs")).unwrap();
    fs::write(seed.join("README.md"), "hello\n").unwrap();
    fs::write(seed.join("src/a.txt"), "a1\n").unwrap();
    fs::write(seed.join("docs/old.md"), DOC).unwrap();
    fs::write(seed.join("logo.png"), [0x89, b'P', b'N', b'G', 0, 1, 2]).unwrap();
    sh(&seed, &["add", "-A"]);
    sh(&seed, &["commit", "-q", "-m", "init"]);
    sh(&seed, &["switch", "-q", "-c", "feat"]);
    fs::write(seed.join("src/a.txt"), "a2\n").unwrap();
    fs::write(seed.join("src/b.txt"), "b\n").unwrap();
    sh(&seed, &["mv", "docs/old.md", "docs/new.md"]);
    sh(&seed, &["add", "-A"]);
    sh(&seed, &["commit", "-q", "-m", "feat work"]);
    sh(&seed, &["switch", "-q", "main"]);
    sh(tmp.path(), &["clone", "-q", "--bare", "seed", "remote.git"]);
    sh(tmp.path(), &["clone", "-q", "remote.git", "work"]);
    sh(tmp.path(), &["clone", "-q", "remote.git", "other"]);

    let home = tempfile::tempdir().unwrap();
    let agent = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tools/mock-agent/agent.js");
    let engine = Engine::new(EngineConfig {
        home: home.path().to_path_buf(),
        user_home: home.path().to_path_buf(),
        adapter_cmd: Some(format!("node {}", agent.display())),
        idle: Duration::from_secs(60),
        reap: Duration::from_secs(600),
        cancel_grace: Duration::from_secs(30),
        continuation: Default::default(),
        api: None,
    });
    let (out, rx) = Outbox::channel();
    let p = tmp.path().to_path_buf();
    Rig {
        engine,
        out,
        rx,
        _home: home,
        _tmp: tmp,
        remote: p.join("remote.git"),
        work: p.join("work"),
        other: p.join("other"),
        state: None,
        detail: None,
    }
}

impl Rig {
    pub(super) fn spec(&self) -> WorkspaceSpec {
        WorkspaceSpec {
            repo: None,
            cd_path: Some(self.work.to_string_lossy().into()),
            protect_base: false,
            extra_dirs: vec![],
        }
    }

    pub(super) fn send(&self, msg: ServerToDaemon) {
        self.engine.handle(msg, &self.out);
    }

    pub(super) async fn next(&mut self) -> DaemonToServer {
        loop {
            let msg = tokio::time::timeout(Duration::from_secs(20), self.rx.recv())
                .await
                .expect("engine went quiet")
                .unwrap();
            if !matches!(msg, DaemonToServer::SessionConfig { .. }) {
                return msg;
            }
        }
    }

    async fn refs(&mut self) -> (Vec<GitBranch>, Vec<GitRemote>) {
        self.refs_of(self.spec(), None).await.unwrap()
    }

    async fn refs_of(
        &mut self,
        workspace: WorkspaceSpec,
        repo: Option<&str>,
    ) -> Result<(Vec<GitBranch>, Vec<GitRemote>), String> {
        let repo = repo.map(String::from);
        let req = GitRefs { request_id: "q".into(), group_id: "g1".into(), bot_id: "b1".into(), workspace, repo };
        self.send(ServerToDaemon::GitRefs(req));
        match self.next().await {
            DaemonToServer::GitRefsResult { request_id, branches, remotes, error: None, .. } if request_id == "q" => {
                Ok((branches, remotes))
            }
            DaemonToServer::GitRefsResult { error: Some(e), .. } => Err(e),
            other => panic!("unexpected {other:?}"),
        }
    }

    async fn log(&mut self, r#ref: Option<&str>, skip: u32, limit: u32) -> (Vec<GitCommit>, bool) {
        let req = GitLog {
            request_id: "q".into(),
            group_id: "g1".into(),
            bot_id: "b1".into(),
            workspace: self.spec(),
            repo: None,
            r#ref: r#ref.map(String::from),
            skip,
            limit,
            filter: None,
        };
        self.send(ServerToDaemon::GitLog(req));
        match self.next().await {
            DaemonToServer::GitLogResult { commits, has_more, error: None, .. } => (commits, has_more),
            other => panic!("unexpected {other:?}"),
        }
    }

    async fn tree(&mut self, r#ref: Option<&str>, path: &str) -> Result<(Vec<TreeEntry>, bool), String> {
        let req = GitTree {
            request_id: "q".into(),
            group_id: "g1".into(),
            bot_id: "b1".into(),
            workspace: self.spec(),
            repo: None,
            r#ref: r#ref.map(String::from),
            path: path.into(),
        };
        self.send(ServerToDaemon::GitTree(req));
        match self.next().await {
            DaemonToServer::GitTreeResult { entries, truncated, error: None, .. } => Ok((entries, truncated)),
            DaemonToServer::GitTreeResult { error: Some(e), .. } => Err(e),
            other => panic!("unexpected {other:?}"),
        }
    }

    async fn read(&mut self, r#ref: Option<&str>, path: &str, max_bytes: u64) -> Result<DaemonToServer, String> {
        let req = GitRead {
            request_id: "q".into(),
            group_id: "g1".into(),
            bot_id: "b1".into(),
            workspace: self.spec(),
            repo: None,
            r#ref: r#ref.map(String::from),
            path: path.into(),
            max_bytes,
        };
        self.send(ServerToDaemon::GitRead(req));
        match self.next().await {
            DaemonToServer::GitReadResult { error: Some(e), .. } => Err(e),
            r @ DaemonToServer::GitReadResult { .. } => Ok(r),
            other => panic!("unexpected {other:?}"),
        }
    }

    async fn compare(&mut self, from: &str, to: Option<&str>) -> Vec<GitChange> {
        let req = GitCompare {
            request_id: "q".into(),
            group_id: "g1".into(),
            bot_id: "b1".into(),
            workspace: self.spec(),
            repo: None,
            from: from.into(),
            to: to.map(String::from),
        };
        self.send(ServerToDaemon::GitCompare(req));
        match self.next().await {
            DaemonToServer::GitCompareResult { mut changes, error: None, .. } => {
                changes.sort_by(|a, b| a.path.cmp(&b.path));
                changes
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    /// (patch, truncated)
    async fn diff(
        &mut self,
        from: &str,
        to: Option<&str>,
        path: Option<&str>,
        max_bytes: u64,
    ) -> Result<(String, bool), String> {
        let req = GitDiff {
            request_id: "q".into(),
            group_id: "g1".into(),
            bot_id: "b1".into(),
            workspace: self.spec(),
            repo: None,
            from: from.into(),
            to: to.map(String::from),
            path: path.map(String::from),
            max_bytes,
            ignore_whitespace: None,
            context: None,
            old_path: None,
            whitespace: None,
        };
        self.send(ServerToDaemon::GitDiff(req));
        match self.next().await {
            DaemonToServer::GitDiffResult { patch: Some(patch), truncated, error: None, .. } => Ok((patch, truncated)),
            DaemonToServer::GitDiffResult { patch: None, error: Some(e), .. } => Err(e),
            other => panic!("unexpected {other:?}"),
        }
    }

    /// The fresh status, then the refresh's own error.
    pub(super) async fn refresh(&mut self, fetch: bool) -> (GitStatus, Option<String>) {
        let req = GitRefresh {
            request_id: "q".into(),
            group_id: "g1".into(),
            bot_id: "b1".into(),
            workspace: self.spec(),
            fetch,
        };
        self.send(ServerToDaemon::GitRefresh(req));
        let git = loop {
            match self.next().await {
                DaemonToServer::WorkspaceState(s) if s.request_id.is_none() && s.bot_id == "b1" => {
                    break s.git.unwrap();
                }
                DaemonToServer::GitRefreshResult { .. } => panic!("the status goes out first"),
                _ => {}
            }
        };
        loop {
            if let DaemonToServer::GitRefreshResult { request_id, error } = self.next().await {
                assert_eq!(request_id, "q");
                return (git, error);
            }
        }
    }

    pub(super) fn action_req(&self, action: GitActionKind) -> GitAction {
        GitAction {
            request_id: "q".into(),
            group_id: "g1".into(),
            bot_id: "b1".into(),
            workspace: self.spec(),
            repo: None,
            action,
            branch: None,
            remote: None,
            message: None,
            paths: None,
            identity: None,
            args: None,
        }
    }

    /// (ok, busy, output, error)
    pub(super) async fn act(&mut self, req: GitAction) -> (bool, bool, Option<String>, Option<String>) {
        self.send(ServerToDaemon::GitAction(Box::new(req)));
        let result = match self.next().await {
            DaemonToServer::GitActionResult { ok, busy, output, error, detail, .. } => {
                self.detail = detail;
                (ok, busy, output, error)
            }
            other => panic!("unexpected {other:?}"),
        };
        // Whatever the outcome, the group's git bar is refreshed right after.
        match self.next().await {
            DaemonToServer::WorkspaceState(s) if s.request_id.is_none() && s.bot_id == "b1" => self.state = Some(s),
            other => panic!("unexpected {other:?}"),
        }
        result
    }

    async fn checkout(&mut self, branch: &str) -> (bool, Option<String>, Option<String>) {
        let req = GitAction { branch: Some(branch.into()), ..self.action_req(GitActionKind::Checkout) };
        let (ok, busy, output, error) = self.act(req).await;
        assert!(!busy);
        (ok, output, error)
    }

    pub(super) fn head(&self) -> String {
        sh(&self.work, &["rev-parse", "HEAD"])
    }

    pub(super) fn current(&self) -> String {
        sh(&self.work, &["branch", "--show-current"])
    }
}

fn change(path: &str, change: GitChangeKind, old: Option<&str>) -> GitChange {
    GitChange { path: path.into(), change, old_path: old.map(String::from) }
}

#[tokio::test]
async fn refs_list_branches_with_their_position_and_remotes_without_credentials() {
    let mut r = rig();
    commit(&r.work, "mine.txt", "x", "mine");
    commit(&r.other, "theirs.txt", "y", "theirs");
    sh(&r.other, &["push", "-q", "origin", "main"]);
    sh(&r.work, &["fetch", "-q"]);
    sh(&r.work, &["branch", "solo"]);
    sh(&r.work, &["remote", "add", "mirror", "https://bob:s3cret@example.com/team/app.git"]);

    let (branches, remotes) = r.refs().await;
    let names: Vec<_> = branches.iter().map(|b| (b.name.as_str(), b.kind)).collect();
    assert_eq!(
        names,
        [
            ("main", GitBranchKind::Local),
            ("solo", GitBranchKind::Local),
            ("origin/feat", GitBranchKind::Remote),
            ("origin/main", GitBranchKind::Remote),
        ]
    );
    let main = &branches[0];
    assert!(main.current);
    assert_eq!(
        (main.upstream.as_deref(), main.ahead, main.behind, main.subject.as_str()),
        (Some("origin/main"), Some(1), Some(1), "mine")
    );
    assert_eq!(main.commit, sh(&r.work, &["rev-parse", "--short", "HEAD"]));
    assert!(main.at.starts_with("20"), "{}", main.at);
    let solo = &branches[1];
    assert_eq!((solo.current, solo.upstream.as_deref(), solo.ahead, solo.behind), (false, None, None, None));
    assert_eq!(branches[3].subject, "theirs");
    assert_eq!(
        remotes,
        [
            GitRemote { name: "mirror".into(), url: "https://example.com/team/app.git".into() },
            GitRemote { name: "origin".into(), url: sh(&r.work, &["remote", "get-url", "origin"]) },
        ]
    );
}

#[tokio::test]
async fn log_pages_from_any_ref_with_decorations() {
    let mut r = rig();
    for i in 0..4 {
        commit(&r.work, "n.txt", &i.to_string(), &format!("c{i}"));
    }
    let (page, more) = r.log(None, 0, 2).await;
    assert!(more);
    assert_eq!(page.iter().map(|c| c.subject.as_str()).collect::<Vec<_>>(), ["c3", "c2"]);
    assert_eq!(page[0].hash, r.head());
    assert_eq!(page[0].short_hash, sh(&r.work, &["rev-parse", "--short", "HEAD"]));
    assert_eq!((page[0].author.as_str(), page[0].email.as_str()), ("t", "t@t"));
    assert_eq!(page[0].parents, [page[1].hash.clone()]);
    assert_eq!(page[0].refs, ["HEAD -> main"]);

    let (rest, more) = r.log(None, 4, 2).await;
    assert!(!more);
    assert_eq!(rest.iter().map(|c| c.subject.as_str()).collect::<Vec<_>>(), ["init"]);
    assert!(rest[0].refs.iter().any(|d| d == "origin/main"), "{:?}", rest[0].refs);
    assert!(rest[0].parents.is_empty());

    let (feat, more) = r.log(Some("origin/feat"), 0, 50).await;
    assert!(!more);
    assert_eq!(feat.iter().map(|c| c.subject.as_str()).collect::<Vec<_>>(), ["feat work", "init"]);
}

#[tokio::test]
async fn tree_and_read_show_another_branch_without_touching_the_work_tree() {
    let mut r = rig();
    let head = r.head();
    let (top, truncated) = r.tree(Some("origin/feat"), "").await.unwrap();
    assert!(!truncated);
    let names: Vec<_> = top.iter().map(|e| (e.name.as_str(), e.dir)).collect();
    assert_eq!(names, [("docs", true), ("src", true), ("logo.png", false), ("README.md", false)]);
    assert_eq!((top[3].size, top[3].mtime, top[3].uncommitted, top[3].ignored), (6, 0, false, false));
    let (src, _) = r.tree(Some("origin/feat"), "src").await.unwrap();
    assert_eq!(src.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(), ["a.txt", "b.txt"]);
    let (docs, _) = r.tree(None, "docs/").await.unwrap();
    assert_eq!(docs.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(), ["old.md"]);

    let Ok(DaemonToServer::GitReadResult { size, binary, mime, text, .. }) =
        r.read(Some("origin/feat"), "src/a.txt", 1024).await
    else {
        panic!()
    };
    assert_eq!((size, binary, mime.as_str(), text.as_deref()), (3, false, "text/plain; charset=utf-8", Some("a2\n")));
    let Ok(DaemonToServer::GitReadResult { binary, mime, text, size, .. }) = r.read(None, "logo.png", 1024).await
    else {
        panic!()
    };
    assert_eq!((binary, mime.as_str(), text, size), (true, "image/png", None, 7));
    let Ok(DaemonToServer::GitReadResult { binary, text, size, .. }) = r.read(None, "docs/old.md", 4).await else {
        panic!()
    };
    assert_eq!((binary, text, size), (false, None, DOC.len() as u64));

    assert!(r.read(None, "src", 1024).await.is_err());
    assert!(r.read(None, "../work/README.md", 1024).await.unwrap_err().contains("超出"));
    assert!(r.tree(None, "/etc").await.unwrap_err().contains("超出"));
    assert!(r.tree(Some("--output=/tmp/x"), "").await.is_err());

    assert_eq!(r.head(), head);
    assert_eq!(r.current(), "main");
    assert_eq!(fs::read_to_string(r.work.join("src/a.txt")).unwrap(), "a1\n");
    assert!(!r.work.join("src/b.txt").exists());
    assert_eq!(sh(&r.work, &["status", "--porcelain"]), "");
}

#[tokio::test]
async fn compare_lists_changes_between_refs_and_against_the_work_tree() {
    let mut r = rig();
    assert_eq!(
        r.compare("main", Some("origin/feat")).await,
        [
            change("docs/new.md", GitChangeKind::Renamed, Some("docs/old.md")),
            change("src/a.txt", GitChangeKind::Modified, None),
            change("src/b.txt", GitChangeKind::Added, None),
        ]
    );
    fs::write(r.work.join("src/a.txt"), "edited\n").unwrap();
    fs::write(r.work.join("new.txt"), "untracked\n").unwrap();
    fs::remove_file(r.work.join("README.md")).unwrap();
    let staged_before = sh(&r.work, &["diff", "--cached", "--name-only"]);
    assert_eq!(
        r.compare("HEAD", None).await,
        [
            change("README.md", GitChangeKind::Deleted, None),
            change("new.txt", GitChangeKind::Added, None),
            change("src/a.txt", GitChangeKind::Modified, None),
        ]
    );
    assert_eq!(sh(&r.work, &["diff", "--cached", "--name-only"]), staged_before, "the index is left alone");
}

#[tokio::test]
async fn diff_gives_the_patch_between_refs_and_against_the_work_tree() {
    let mut r = rig();
    let (patch, truncated) = r.diff("main", Some("origin/feat"), None, 1 << 20).await.unwrap();
    assert!(!truncated);
    assert!(patch.contains("diff --git a/src/a.txt b/src/a.txt\n"), "{patch}");
    assert!(patch.contains("-a1\n+a2\n"), "{patch}");
    assert!(patch.contains("+++ b/src/b.txt\n@@ -0,0 +1 @@\n+b\n"), "{patch}");
    assert!(patch.contains("rename from docs/old.md\nrename to docs/new.md\n"), "renames are detected: {patch}");

    let (one, _) = r.diff("main", Some("origin/feat"), Some("src/a.txt"), 1 << 20).await.unwrap();
    assert!(one.starts_with("diff --git a/src/a.txt b/src/a.txt\n") && !one.contains("b.txt"), "{one}");

    fs::write(r.work.join("src/a.txt"), "edited\n").unwrap();
    fs::write(r.work.join("new.txt"), "untracked\n").unwrap();
    fs::remove_file(r.work.join("README.md")).unwrap();
    sh(&r.work, &["add", "src/a.txt"]);
    let (staged, status) = (sh(&r.work, &["diff", "--cached", "--name-only"]), sh(&r.work, &["status", "--porcelain"]));
    let (patch, _) = r.diff("HEAD", None, None, 1 << 20).await.unwrap();
    assert!(patch.contains("diff --git a/README.md b/README.md\ndeleted file mode"), "{patch}");
    assert!(patch.contains("+++ b/new.txt\n@@ -0,0 +1 @@\n+untracked\n"), "untracked files count: {patch}");
    assert!(patch.contains("-a1\n+edited\n"), "{patch}");
    let (one, _) = r.diff("HEAD", None, Some("./new.txt"), 1 << 20).await.unwrap();
    assert!(one.starts_with("diff --git a/new.txt b/new.txt\n") && !one.contains("README"), "{one}");
    let (none, truncated) = r.diff("HEAD", None, Some("docs/old.md"), 1 << 20).await.unwrap();
    assert_eq!((none.as_str(), truncated), ("", false));
    assert_eq!(sh(&r.work, &["diff", "--cached", "--name-only"]), staged, "the index is left alone");
    assert_eq!(sh(&r.work, &["status", "--porcelain"]), status);

    fs::write(r.work.join("big.txt"), "some line\n".repeat(1000)).unwrap();
    let (cut, truncated) = r.diff("HEAD", None, Some("big.txt"), 100).await.unwrap();
    assert!(truncated);
    assert!(cut.len() <= 100 && cut.starts_with("diff --git a/big.txt"), "{cut}");
    let (whole, truncated) = r.diff("HEAD", None, Some("big.txt"), 1 << 20).await.unwrap();
    assert!(!truncated && whole.len() > 10_000);

    assert!(r.diff("HEAD", None, Some("../work/README.md"), 1024).await.unwrap_err().contains("超出"));
    assert!(r.diff("HEAD", None, Some("/etc/passwd"), 1024).await.unwrap_err().contains("超出"));
    assert!(r.diff("--output=/tmp/x", None, None, 1024).await.is_err());
    assert!(r.diff("HEAD", Some("--output=/tmp/x"), None, 1024).await.is_err());
}

#[tokio::test]
async fn refresh_fetches_and_sends_the_fresh_status() {
    let mut r = rig();
    commit(&r.other, "theirs.txt", "y", "theirs");
    sh(&r.other, &["push", "-q", "origin", "main"]);
    let (git, error) = r.refresh(false).await;
    assert_eq!((git.branch.as_deref(), git.ahead, git.behind, error), (Some("main"), Some(0), Some(0), None));

    sh(&r.other, &["push", "-q", "origin", "main:gone"]);
    sh(&r.work, &["fetch", "-q"]);
    sh(&r.remote, &["branch", "-D", "gone"]);
    let (git, error) = r.refresh(true).await;
    assert_eq!((git.ahead, git.behind, error), (Some(0), Some(1), None));
    assert_eq!(sh(&r.work, &["branch", "-r", "--list", "origin/gone"]), "", "fetch prunes");
    assert_eq!(r.head(), sh(&r.work, &["rev-parse", "origin/main~1"]), "the work tree is left alone");

    fs::write(r.work.join("dirty.txt"), "x").unwrap();
    sh(&r.work, &["remote", "set-url", "origin", "/nonexistent/remote.git"]);
    let (git, error) = r.refresh(true).await;
    assert!(error.is_some_and(|e| !e.is_empty()), "a failed fetch is reported");
    assert_eq!((git.behind, git.dirty_count), (Some(1), Some(1)), "the status is sent anyway");
}

#[tokio::test]
async fn commit_takes_only_the_given_paths() {
    let mut r = rig();
    fs::write(r.work.join("src/a.txt"), "picked\n").unwrap();
    fs::write(r.work.join("added.txt"), "new\n").unwrap();
    fs::write(r.work.join("w*.txt"), "literal\n").unwrap();
    fs::write(r.work.join("wx.txt"), "not picked\n").unwrap();
    fs::remove_file(r.work.join("docs/old.md")).unwrap();
    fs::create_dir_all(r.work.join("img")).unwrap();
    sh(&r.work, &["mv", "logo.png", "img/logo.png"]);
    fs::write(r.work.join("README.md"), "staged, not picked\n").unwrap();
    sh(&r.work, &["add", "README.md"]);
    fs::create_dir_all(r.work.join(".gonggong")).unwrap();
    fs::write(r.work.join(".gonggong/note"), "private").unwrap();
    let paths = ["src/a.txt", "added.txt", "w*.txt", "docs/old.md", "logo.png", "img/logo.png", ".gonggong/note"];
    let req = GitAction {
        message: Some("部分提交".into()),
        paths: Some(paths.map(String::from).to_vec()),
        // Production always supplies the Bot identity; do not depend on the CI host's global Git config.
        identity: Some(GitIdentity { name: "小王的 Claude".into(), email: "b1@bots.gonggong.local".into() }),
        ..r.action_req(GitActionKind::Commit)
    };
    let (ok, _, output, error) = r.act(req.clone()).await;
    assert!(ok, "{error:?}");
    assert!(output.unwrap().contains("部分提交"));
    assert_eq!(
        sh(&r.work, &["show", "--no-renames", "--name-status", "--format=", "HEAD"]),
        "A\tadded.txt\nD\tdocs/old.md\nA\timg/logo.png\nD\tlogo.png\nM\tsrc/a.txt\nA\tw*.txt"
    );
    assert_eq!(
        sh(&r.work, &["status", "--porcelain", "--untracked-files=all"]),
        "M  README.md\n?? .gonggong/note\n?? wx.txt",
        "the rest stays as it was, staged or not"
    );

    let head = r.head();
    let (ok, _, _, error) = r.act(req).await;
    assert_eq!((ok, error.as_deref()), (false, Some("没有可提交的改动")));
    let escape = GitAction {
        message: Some("m".into()),
        paths: Some(vec!["src/a.txt".into(), "../other/README.md".into()]),
        ..r.action_req(GitActionKind::Commit)
    };
    fs::write(r.work.join("src/a.txt"), "again\n").unwrap();
    let (ok, _, _, error) = r.act(escape).await;
    assert!(!ok && error.unwrap().contains("超出"));
    assert_eq!(r.head(), head);
    assert_eq!(sh(&r.work, &["diff", "--cached", "--name-only"]), "README.md", "nothing staged when refused");
}

#[tokio::test]
async fn checkout_switches_local_branches_and_tracks_remote_ones() {
    let mut r = rig();
    sh(&r.work, &["branch", "dev"]);
    let (ok, output, error) = r.checkout("dev").await;
    assert!(ok, "{error:?}");
    assert_eq!(r.current(), "dev");
    assert!(output.unwrap().contains("dev"));

    let (ok, _, error) = r.checkout("origin/feat").await;
    assert!(ok, "{error:?}");
    assert_eq!(r.current(), "feat");
    assert_eq!(sh(&r.work, &["rev-parse", "--abbrev-ref", "feat@{upstream}"]), "origin/feat");
    assert_eq!(fs::read_to_string(r.work.join("src/a.txt")).unwrap(), "a2\n");
    let state = r.state.take().unwrap();
    assert_eq!(state.state, WorkspaceStateKind::Ready);
    let git = state.git.unwrap();
    assert_eq!((git.branch.as_deref(), git.ahead, git.behind, git.dirty), (Some("feat"), Some(0), Some(0), false));

    // Local edits the switch would overwrite: git refuses and nothing moves.
    fs::write(r.work.join("src/a.txt"), "mine\n").unwrap();
    let (ok, _, error) = r.checkout("main").await;
    assert!(!ok);
    assert!(error.is_some_and(|e| !e.is_empty()));
    assert_eq!(r.current(), "feat");
    assert_eq!(fs::read_to_string(r.work.join("src/a.txt")).unwrap(), "mine\n");
    let git = r.state.take().unwrap().git.unwrap();
    assert_eq!((git.branch.as_deref(), git.dirty_count), (Some("feat"), Some(1)), "sent after a failure too");

    let (ok, _, error) = r.checkout("nope").await;
    assert!(!ok && error.is_some());
}

#[tokio::test]
async fn pull_fast_forwards_only() {
    let mut r = rig();
    commit(&r.other, "theirs.txt", "1", "theirs 1");
    sh(&r.other, &["push", "-q", "origin", "main"]);
    let (ok, busy, output, error) = r.act(r.action_req(GitActionKind::Pull)).await;
    assert!(ok && !busy, "{error:?}");
    assert!(output.is_some());
    assert_eq!(r.head(), sh(&r.other, &["rev-parse", "HEAD"]));

    // Diverged: refused, nothing merged.
    commit(&r.work, "mine.txt", "m", "mine");
    commit(&r.other, "theirs.txt", "2", "theirs 2");
    sh(&r.other, &["push", "-q", "origin", "main"]);
    let head = r.head();
    let (ok, _, _, error) = r.act(r.action_req(GitActionKind::Pull)).await;
    assert!(!ok && error.is_some());
    assert_eq!(r.head(), head);
    assert_eq!(sh(&r.work, &["rev-list", "--count", "HEAD"]), "3");

    sh(&r.work, &["switch", "-q", "-c", "lonely"]);
    let (ok, _, _, error) = r.act(r.action_req(GitActionKind::Pull)).await;
    assert!(!ok);
    assert!(error.unwrap().contains("上游"));
}

#[tokio::test]
async fn commit_takes_everything_as_the_given_identity() {
    let mut r = rig();
    fs::write(r.work.join("src/a.txt"), "changed\n").unwrap();
    fs::write(r.work.join("added.txt"), "new\n").unwrap();
    let req = GitAction {
        message: Some("修复退款金额".into()),
        identity: Some(GitIdentity { name: "小王的 Claude".into(), email: "b1@bots.gonggong.local".into() }),
        ..r.action_req(GitActionKind::Commit)
    };
    let (ok, _, output, error) = r.act(req.clone()).await;
    assert!(ok, "{error:?}");
    let output = output.unwrap();
    assert!(output.starts_with("[main ") && output.contains("修复退款金额"), "{output}");
    assert_eq!(sh(&r.work, &["status", "--porcelain"]), "");
    assert_eq!(
        sh(&r.work, &["log", "-1", "--format=%an|%ae|%cn|%ce|%s"]),
        "小王的 Claude|b1@bots.gonggong.local|小王的 Claude|b1@bots.gonggong.local|修复退款金额"
    );
    assert_eq!(sh(&r.work, &["show", "--name-only", "--format=", "HEAD"]), "added.txt\nsrc/a.txt");

    let head = r.head();
    let (ok, _, _, error) = r.act(req).await;
    assert!(!ok);
    assert_eq!(error.as_deref(), Some("没有可提交的改动"));
    assert_eq!(r.head(), head);
}

#[tokio::test]
async fn push_sets_the_upstream_and_never_forces() {
    let mut r = rig();
    sh(&r.work, &["switch", "-q", "-c", "topic"]);
    commit(&r.work, "t.txt", "t", "topic work");
    let push = |r: &Rig, branch: &str| GitAction {
        branch: Some(branch.into()),
        remote: Some("origin".into()),
        ..r.action_req(GitActionKind::Push)
    };
    let (ok, _, output, error) = r.act(push(&r, "topic")).await;
    assert!(ok, "{error:?}");
    assert!(output.unwrap().contains("topic"));
    assert_eq!(sh(&r.work, &["rev-parse", "--abbrev-ref", "topic@{upstream}"]), "origin/topic");
    assert_eq!(sh(&r.remote, &["rev-parse", "refs/heads/topic"]), r.head());

    // Someone else pushed main first: rejected, theirs stays.
    commit(&r.other, "theirs.txt", "y", "theirs");
    sh(&r.other, &["push", "-q", "origin", "main"]);
    sh(&r.work, &["switch", "-q", "main"]);
    commit(&r.work, "mine.txt", "x", "mine");
    let (ok, busy, _, error) = r.act(push(&r, "main")).await;
    assert!(!ok && !busy);
    assert!(error.as_deref().unwrap().contains("rejected"), "{error:?}");
    assert_eq!(sh(&r.remote, &["rev-parse", "refs/heads/main"]), sh(&r.other, &["rev-parse", "HEAD"]));
}

/// A repo of its own with branches main and dev, `dev` holding a commit main lacks.
pub(super) fn side_repo(dir: &Path) {
    fs::create_dir_all(dir).unwrap();
    sh(dir, &["init", "-q", "-b", "main"]);
    commit(dir, "lib.txt", "1", "lib init");
    sh(dir, &["switch", "-q", "-c", "dev"]);
    commit(dir, "lib.txt", "2", "lib dev");
    sh(dir, &["switch", "-q", "main"]);
}

fn local_names(branches: &[GitBranch]) -> Vec<&str> {
    branches.iter().filter(|b| b.kind == GitBranchKind::Local).map(|b| b.name.as_str()).collect()
}

#[tokio::test]
async fn refs_and_checkout_act_on_a_nested_repo_not_the_root() {
    let mut r = rig();
    let lib = r.work.join("libs/core");
    side_repo(&lib);

    let (branches, remotes) = r.refs_of(r.spec(), Some("libs/core")).await.unwrap();
    assert_eq!(local_names(&branches), ["dev", "main"]);
    assert!(remotes.is_empty());

    let req = GitAction {
        repo: Some("libs/core".into()),
        branch: Some("dev".into()),
        ..r.action_req(GitActionKind::Checkout)
    };
    let (ok, busy, _, error) = r.act(req).await;
    assert!(ok && !busy, "{error:?}");
    assert_eq!(sh(&lib, &["branch", "--show-current"]), "dev");
    assert_eq!(r.current(), "main");
    let git = r.state.take().unwrap().git.unwrap();
    assert_eq!(git.branch.as_deref(), Some("main"), "the root's status is reported");
}

#[tokio::test]
async fn refs_and_checkout_act_on_an_extra_repo_inside_the_extra_dirs() {
    let mut r = rig();
    let extra = r._tmp.path().join("extra");
    let sdk = extra.join("sdk");
    side_repo(&sdk);
    let spec = WorkspaceSpec { extra_dirs: vec![extra.to_string_lossy().into()], ..r.spec() };
    let path = sdk.to_string_lossy().to_string();

    let (branches, _) = r.refs_of(spec.clone(), Some(&path)).await.unwrap();
    assert_eq!(local_names(&branches), ["dev", "main"]);

    let req = GitAction {
        workspace: spec,
        repo: Some(path),
        branch: Some("dev".into()),
        ..r.action_req(GitActionKind::Checkout)
    };
    let (ok, _, _, error) = r.act(req).await;
    assert!(ok, "{error:?}");
    assert_eq!(sh(&sdk, &["branch", "--show-current"]), "dev");
    assert_eq!(r.current(), "main");
}

#[tokio::test]
async fn repos_outside_the_workspace_and_its_extra_dirs_are_refused() {
    let mut r = rig();
    sh(&r.other, &["branch", "dev"]);
    let other = r.other.to_string_lossy().to_string();
    for repo in ["../other", other.as_str(), "libs//core", "./libs"] {
        let error = r.refs_of(r.spec(), Some(repo)).await.unwrap_err();
        assert!(!error.is_empty(), "{repo}");
    }

    let req = GitAction { repo: Some(other), branch: Some("dev".into()), ..r.action_req(GitActionKind::Checkout) };
    let (ok, busy, _, error) = r.act(req).await;
    assert!(!ok && !busy);
    assert!(error.is_some());
    assert_eq!(sh(&r.other, &["branch", "--show-current"]), "main");

    let req = GitAction {
        repo: Some("../other".into()),
        branch: Some("dev".into()),
        ..r.action_req(GitActionKind::Checkout)
    };
    let (ok, _, _, error) = r.act(req).await;
    assert!(!ok);
    assert!(error.unwrap().contains("../other"));
    assert_eq!(sh(&r.other, &["branch", "--show-current"]), "main");
}

pub(super) fn slow_run(r: &Rig, run_id: &str, text: &str) -> RunStart {
    RunStart {
        run_id: run_id.into(),
        group_id: "g1".into(),
        group_name: "支付服务重构".into(),
        bot: RunBot {
            id: "b1".into(),
            name: "小王的 Claude".into(),
            agent_kind: AgentKind::Claude,
            system_prompt: String::new(),
            tier: Tier::Workspace,
            model: None,
            effort: None,
            approval: Approval::Ask,
            allowlist: vec![],
            always_allow: vec![],
            git: None,
            agent_settings: Default::default(),
        },
        workspace: r.spec(),
        resume_session_id: None,
        new_session_reason: None,
        mcp_servers: vec![],
        skills: vec![],
        plugins: vec![],
        hidden_tools: vec![],
        artifacts: vec![],
        artifact_exclude: vec![],
        command: None,
        sync: None,
        env: Default::default(),
        prompt: RunPrompt {
            text: text.into(),
            triggered_by: "王磊".into(),
            context: vec![],
            omitted: 0,
            fallback_context: vec![],
            attachments: vec![],
            quote: None,
        },
    }
}

#[tokio::test]
async fn actions_are_refused_while_a_turn_holds_the_directory() {
    let mut r = rig();
    r.send(ServerToDaemon::RunStart(Box::new(slow_run(&r, "r1", "mock:slow"))));
    loop {
        if let DaemonToServer::RunEvent { event: RunEvent::Text { .. }, .. } = r.next().await {
            break;
        }
    }
    fs::write(r.work.join("src/a.txt"), "changed\n").unwrap();
    let head = r.head();
    let req = GitAction { message: Some("m".into()), ..r.action_req(GitActionKind::Commit) };
    r.send(ServerToDaemon::GitAction(Box::new(req)));
    let result = loop {
        if let msg @ DaemonToServer::GitActionResult { .. } = r.next().await {
            break msg;
        }
    };
    let DaemonToServer::GitActionResult { ok, busy, output, error, .. } = result else { unreachable!() };
    assert_eq!((ok, busy, output, error.as_deref()), (false, true, None, Some("工作目录正被运行占用")));
    assert_eq!(r.head(), head);
    assert_eq!(sh(&r.work, &["status", "--porcelain"]), "M src/a.txt");
    let (git, error) = r.refresh(true).await;
    assert_eq!((git.dirty_count, error), (Some(1), None), "a refresh is never refused");
    r.send(ServerToDaemon::RunCancel { run_id: "r1".into() });
}

#[tokio::test]
async fn a_turn_arriving_during_an_action_waits_for_it_without_asking() {
    let mut r = rig();
    let hook = r.remote.join("hooks/pre-receive");
    fs::write(&hook, "#!/bin/sh\nsleep 2\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
    }
    commit(&r.work, "mine.txt", "x", "mine");
    let req =
        GitAction { branch: Some("main".into()), remote: Some("origin".into()), ..r.action_req(GitActionKind::Push) };
    r.send(ServerToDaemon::GitAction(Box::new(req)));
    r.send(ServerToDaemon::RunStart(Box::new(slow_run(&r, "r1", "mock:echo"))));
    let mut order = vec![];
    while order.len() < 2 {
        match r.next().await {
            DaemonToServer::GitActionResult { ok, error, .. } => {
                assert!(ok, "{error:?}");
                order.push("action");
            }
            DaemonToServer::RunDone(d) => {
                assert_eq!(d.outcome, RunOutcome::Completed);
                order.push("run");
            }
            DaemonToServer::QuestionAsk { .. } => panic!("a manual action never asks to run in parallel"),
            _ => {}
        }
    }
    assert_eq!(order, ["action", "run"]);
}
