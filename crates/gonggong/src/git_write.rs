//! The owner's manual git writes (git.action), run while no turn holds the directory: they never open an editor, are
//! made as the bot's identity, and stop on conflicts, leaving them to resolve. Pushes are forced only on request, and
//! then with a lease.
use crate::git::{self, EMPTY_TREE, git, git_bytes, git_input, git_output};
use crate::git_ops::{self, NETWORK_TIMEOUT, Scratch, arg, private, repo_dir, tree_path};
use crate::protocol::{
    GitAction, GitActionCode, GitActionDetail, GitActionKind, GitConflictPick, GitConflictSide, GitIdentity,
    GitLocalCommits, GitOngoingKind, GitRebaseAction, GitRebaseStep, GitUpdated,
};
use crate::repo::{self, remote_output, remote_output_with};
use crate::t;
use std::collections::HashSet;
use std::path::Path;
use std::process::Output;

/// Messages git prepares (merges, reverts, picks and rebases continued) are taken as they are; git speaks English, so
/// what stopped it can be read from what it says.
const ENV: [(&str, &str); 3] = [("GIT_EDITOR", "true"), ("GIT_SEQUENCE_EDITOR", "true"), ("LC_ALL", "C")];
/// Conflicted files an error names before 「等」.
const NAMED_CONFLICTS: usize = 5;
const SMART_STASH: &str = "gonggong: smart checkout";
/// A patch of hunks to revert, at most (GIT_PATCH_MAX_BYTES).
const PATCH_MAX_BYTES: usize = 1024 * 1024;
/// Lines of a file's header in a patch that name no path.
const PLAIN_HEADERS: [&str; 6] = ["index ", "old mode ", "new mode ", "deleted file mode ", "new file mode ", "\\ "];

/// What an action came to: git's one-line summary, and what the outcome needs beyond it (gitOps4).
pub struct Done {
    pub output: String,
    pub detail: Option<GitActionDetail>,
}

impl From<String> for Done {
    fn from(output: String) -> Self {
        Done { output, detail: None }
    }
}

/// Why an action failed, and what that needs beyond the text (gitOps4); boxed, as every write passes failures on.
#[derive(Debug)]
pub struct Failed {
    pub error: String,
    pub detail: Option<Box<GitActionDetail>>,
}

impl From<String> for Failed {
    fn from(error: String) -> Self {
        Failed { error, detail: None }
    }
}

impl From<&str> for Failed {
    fn from(error: &str) -> Self {
        error.to_string().into()
    }
}

/// Runs one git.action in `dir`, the repo it is for.
pub async fn act(dir: &Path, req: &GitAction) -> Result<Done, Failed> {
    let (result, commands) = crate::git_console::capture(act_inner(dir, req)).await;
    match result {
        Ok(mut done) => {
            done.detail.get_or_insert_with(Default::default).commands = Some(commands);
            Ok(done)
        }
        Err(mut failed) => {
            failed.detail.get_or_insert_with(|| Box::new(GitActionDetail::default())).commands = Some(commands);
            Err(failed)
        }
    }
}

async fn act_inner(dir: &Path, req: &GitAction) -> Result<Done, Failed> {
    repo_dir(dir)?;
    let w = Writer::new(dir, req.identity.as_ref());
    let a = req.args.clone().unwrap_or_default();
    let on = |flag: Option<bool>| flag == Some(true);
    let (branch, remote, message) = (req.branch.as_deref(), req.remote.as_deref(), req.message.as_deref());
    let paths = req.paths.as_deref().unwrap_or_default();
    let output = match req.action {
        GitActionKind::Checkout => {
            let target = need(branch, "branch")?;
            return w.checkout(target, on(a.detach), a.mode.as_deref(), a.local_commits).await;
        }
        GitActionKind::Pull => return w.pull(branch, a.mode.as_deref(), a.from.as_deref()).await,
        GitActionKind::Commit => {
            expect_head(dir, a.expect.as_deref()).await?;
            w.commit(message.unwrap_or_default(), req.paths.as_deref(), on(a.amend)).await?
        }
        GitActionKind::Push => {
            let remote = need(remote, "remote")?;
            let branch = match branch {
                Some(b) => b.to_string(),
                None => git::branch(dir).await.ok_or_else(|| missing("branch"))?,
            };
            w.push(remote, &branch, a.target.as_deref(), a.commit.as_deref(), on(a.force), on(a.tags)).await?
        }
        GitActionKind::BranchCreate => {
            w.branch_create(need(branch, "branch")?, a.from.as_deref(), on(a.checkout), on(a.force)).await?
        }
        GitActionKind::BranchRename => {
            w.branch_rename(need(branch, "branch")?, need(a.name.as_deref(), "args.name")?).await?
        }
        GitActionKind::BranchDelete => w.branch_delete(need(branch, "branch")?, on(a.force)).await?,
        GitActionKind::Merge => {
            return w.merge(need(branch, "branch")?, a.mode.as_deref(), on(a.no_commit), message).await;
        }
        GitActionKind::Rebase => {
            let onto = need(a.onto.as_deref(), "args.onto")?;
            return match a.todo.as_deref() {
                Some(todo) => w.rebase_todo(onto, branch, todo).await,
                None => w.rebase(onto, branch).await,
            };
        }
        GitActionKind::CherryPick => w.pick(false, a.commits.as_deref().unwrap_or_default()).await?,
        GitActionKind::Revert => w.pick(true, a.commits.as_deref().unwrap_or_default()).await?,
        GitActionKind::Reset => {
            let commit = need(a.commit.as_deref(), "args.commit")?;
            expect_head(dir, a.expect.as_deref()).await?;
            w.reset(commit, a.mode.as_deref()).await?
        }
        GitActionKind::Discard => match a.patch.as_deref() {
            Some(patch) => w.revert_hunks(paths, patch).await?,
            None => w.discard(paths, on(a.keep_added)).await?,
        },
        GitActionKind::Stash => w.stash(message, on(a.untracked), req.paths.as_deref()).await?,
        GitActionKind::Unstash => {
            let stash = a.stash.ok_or_else(|| missing("args.stash"))?;
            expect_stash(dir, stash, a.expect.as_deref()).await?;
            w.unstash(stash, on(a.pop), on(a.index), branch).await?
        }
        GitActionKind::StashDrop => {
            match (a.stash, a.expect.as_deref()) {
                (Some(n), expect) => expect_stash(dir, n, expect).await?,
                // A guard naming one stash never clears them all.
                (None, Some(_)) => return Err(missing("args.stash").into()),
                (None, None) => {}
            }
            w.stash_drop(a.stash).await?
        }
        GitActionKind::TagCreate => {
            w.tag_create(need(a.name.as_deref(), "args.name")?, a.from.as_deref(), message).await?
        }
        GitActionKind::TagDelete => w.tag_delete(need(a.name.as_deref(), "args.name")?, remote).await?,
        GitActionKind::TagPush => w.tag_push(need(a.name.as_deref(), "args.name")?, need(remote, "remote")?).await?,
        GitActionKind::Continue => w.proceed(message).await?,
        GitActionKind::Abort => w.abort().await?,
        GitActionKind::Skip => w.skip().await?,
        GitActionKind::Resolve => {
            w.resolve(need(a.path.as_deref(), "args.path")?, paths, a.side, a.content.as_deref()).await?
        }
        GitActionKind::Add => w.add(paths).await?,
        GitActionKind::Ignore => ignore(dir, paths)?,
        GitActionKind::Apply => w.apply(need(a.commit.as_deref(), "args.commit")?, paths, on(a.reverse)).await?,
        GitActionKind::Restore => w.restore(need(a.commit.as_deref(), "args.commit")?, paths).await?,
    };
    Ok(output.into())
}

fn missing(what: &str) -> String {
    t!("缺少参数：{what}", what = what)
}

fn need<'a>(value: Option<&'a str>, what: &str) -> Result<&'a str, String> {
    value.filter(|v| !v.is_empty()).ok_or_else(|| missing(what))
}

fn unsupported(mode: &str) -> String {
    t!("不支持的模式：{mode}", mode = mode)
}

struct Writer<'a> {
    dir: &'a Path,
    identity: Option<&'a GitIdentity>,
    /// `-c user.name=… -c user.email=…`: everything that commits, tags or stashes does it as the bot.
    who: Vec<String>,
}

impl Writer<'_> {
    fn new<'a>(dir: &'a Path, identity: Option<&'a GitIdentity>) -> Writer<'a> {
        let who = identity.map_or(vec![], |i| {
            vec!["-c".into(), format!("user.name={}", i.name), "-c".into(), format!("user.email={}", i.email)]
        });
        Writer { dir, identity, who }
    }

    /// `args` after the identity.
    fn with<'s>(&'s self, args: &[&'s str]) -> Vec<&'s str> {
        self.who.iter().map(String::as_str).chain(args.iter().copied()).collect()
    }

    /// No editor, English, and the bot as author and committer.
    fn env(&self) -> Vec<(&str, &str)> {
        let mut env = ENV.to_vec();
        if let Some(i) = self.identity {
            env.extend([
                ("GIT_AUTHOR_NAME", i.name.as_str()),
                ("GIT_AUTHOR_EMAIL", i.email.as_str()),
                ("GIT_COMMITTER_NAME", i.name.as_str()),
                ("GIT_COMMITTER_EMAIL", i.email.as_str()),
            ]);
        }
        env
    }

    /// git's stdout, or why it failed.
    async fn run(&self, args: &[&str]) -> Result<String, Failed> {
        self.run_input(args, None).await
    }

    async fn run_input(&self, args: &[&str], input: Option<&[u8]>) -> Result<String, Failed> {
        let out = git_output(self.dir, &self.with(args), &self.env(), input).await?;
        match out.status.success() {
            true => Ok(String::from_utf8_lossy(&out.stdout).into_owned()),
            false => Err(failed(&out)),
        }
    }

    /// [`Self::run`] for what may stop on conflicts: then they are the error, left in place to resolve.
    async fn merging(&self, args: &[&str]) -> Result<String, Failed> {
        self.merging_with(args, &[]).await
    }

    /// [`Self::merging`] with `env` on top of [`Self::env`].
    async fn merging_with(&self, args: &[&str], env: &[(&str, &str)]) -> Result<String, Failed> {
        let out = git_output(self.dir, &self.with(args), &[&self.env()[..], env].concat(), None).await?;
        match out.status.success() {
            true => Ok(String::from_utf8_lossy(&out.stdout).into_owned()),
            false => Err(stopped(self.dir).await.unwrap_or_else(|| failed(&out))),
        }
    }

    /// Switches to a local branch; `remote/x` creates `x` tracking it, or brings an existing `x` up to it (fast-forward)
    /// unless that has commits of its own: refused then, with how many each one has, unless `local_commits` rebases
    /// them onto it or drops them. `detach`: to a commit or tag. With changes in the way, `mode` keep lets git refuse
    /// (naming them), smart stashes them around the switch (one that clashes is left in conflict), force drops them.
    async fn checkout(
        &self,
        target: &str,
        detach: bool,
        mode: Option<&str>,
        local_commits: Option<GitLocalCommits>,
    ) -> Result<Done, Failed> {
        let dir = self.dir;
        let target = arg(target)?;
        let mode = mode.unwrap_or("keep");
        let mut switch = vec!["switch"];
        match mode {
            "keep" | "smart" => {}
            "force" => switch.push("--discard-changes"),
            m => return Err(unsupported(m).into()),
        }
        let remote = format!("refs/remotes/{target}");
        let mut rebase = false;
        if detach {
            switch.extend(["--detach", target]);
        } else if has_ref(dir, &format!("refs/heads/{target}")).await {
            switch.push(target);
        } else if has_ref(dir, &remote).await {
            let (_, local) = remote_of(dir, target).await?;
            let ours = format!("refs/heads/{local}");
            if !has_ref(dir, &ours).await {
                switch.extend(["-c", local, "--track", target]);
            } else if is_ancestor(dir, &remote, &ours).await {
                switch.push(local);
            } else if local_commits == Some(GitLocalCommits::Drop) || is_ancestor(dir, &ours, &remote).await {
                switch.extend(["-C", local, &remote]);
            } else if local_commits == Some(GitLocalCommits::Rebase) {
                switch.push(local);
                rebase = true;
            } else {
                return Err(diverged(dir, local, target).await?);
            }
        } else {
            return Err(t!("分支不存在：{branch}", branch = target).into());
        }
        let stash = mode == "smart" && !git::porcelain(dir).await?.is_empty();
        if stash {
            let spec = git::everything(dir).await;
            self.run(&[&["stash", "push", "-u", "-m", SMART_STASH, "--"][..], spec].concat()).await?;
        }
        if let Err(e) = self.run(&switch).await {
            if stash {
                // Nothing moved: the changes go back where they were.
                let _ = self.run(&["stash", "pop"]).await;
            }
            return Err(e);
        }
        // Changes that clash with the new branch stay in conflict, their stash kept: switched all the same, but no
        // rebase starts on top of them.
        if stash && let Err(e) = self.run(&["stash", "pop"]).await {
            match stopped(dir).await {
                Some(conflicts) if rebase => return Err(conflicts),
                Some(_) => {}
                None => return Err(e),
            }
        }
        if rebase {
            self.merging(&["rebase", "--autostash", &remote]).await?;
        }
        Ok(restored(dir, head_line(dir).await?, None).await)
    }

    /// The upstream into the current branch, or the remote branch `from` (fetched first), `mode` ff-only | merge |
    /// rebase, changes stashed around it; a `branch` other than the current one is fast-forwarded instead. Says what
    /// came in.
    async fn pull(&self, branch: Option<&str>, mode: Option<&str>, from: Option<&str>) -> Result<Done, Failed> {
        let dir = self.dir;
        if let Some(b) = branch
            && git::branch(dir).await.as_deref() != Some(b)
        {
            return self.update(arg(b)?).await;
        }
        let from = match from {
            Some(from) => {
                let (remote, name) = remote_of(dir, arg(from)?).await?;
                // A full ref: a short name could read as more of a refspec, or as a tag.
                Some((remote, format!("refs/heads/{name}")))
            }
            None => None,
        };
        let mode = mode.unwrap_or("ff-only");
        let mut args = match mode {
            "ff-only" => vec!["pull", "--ff-only", "--no-rebase"],
            "merge" => vec!["pull", "--no-rebase", "--no-edit"],
            "rebase" => vec!["pull", "--rebase"],
            m => return Err(unsupported(m).into()),
        };
        args.push("--autostash");
        match &from {
            Some((remote, branch)) => args.extend([*remote, branch.as_str()]),
            None if git(dir, &["rev-parse", "--abbrev-ref", "@{upstream}"]).await.is_err() => {
                return Err(t!("当前分支没有上游分支，无法拉取").into());
            }
            None => {}
        }
        let before = git::head(dir).await;
        let out = remote_output_with(dir, &self.with(&args), &self.env(), Some(NETWORK_TIMEOUT)).await;
        let out = out.map_err(|f| f.detail)?;
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            let failed = Failed { error: repo::classify(&stderr).detail, detail: in_the_way(&stderr).map(Box::new) };
            return Err(stopped(dir).await.unwrap_or(failed));
        }
        let output = match mode {
            "ff-only" => String::from_utf8_lossy(&out.stdout).lines().next().unwrap_or_default().trim().to_string(),
            _ => head_line(dir).await?,
        };
        let updated = updated(dir, before.as_deref(), git::head(dir).await.as_deref()).await?;
        Ok(restored(dir, output, Some(GitActionDetail { updated, ..GitActionDetail::default() })).await)
    }

    /// Fast-forwards local `branch`, not checked out, from its configured upstream; refused when they diverged.
    async fn update(&self, branch: &str) -> Result<Done, Failed> {
        let dir = self.dir;
        let local = format!("refs/heads/{branch}");
        if !has_ref(dir, &local).await {
            return Err(t!("分支不存在：{branch}", branch = branch).into());
        }
        let Some((remote, merge)) = upstream(dir, branch).await else {
            return Err(t!("分支 {branch} 没有上游分支，无法更新", branch = branch).into());
        };
        let tip = async || git(dir, &["rev-parse", &local]).await.map(|h| h.trim().to_string());
        let before = tip().await?;
        // A short `merge` would also match a tag of that name on the remote.
        let from = if merge.starts_with("refs/") { merge } else { format!("refs/heads/{merge}") };
        let refspec = format!("{from}:{local}");
        let out = remote_output(dir, &["fetch", arg(&remote)?, &refspec], Some(NETWORK_TIMEOUT)).await;
        let out = out.map_err(|f| f.detail)?;
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            // `! [rejected]  main -> feat  (non-fast-forward)`
            let rejected = stderr.lines().find(|l| l.contains("[rejected]")).map(|l| l.trim_start_matches([' ', '!']));
            return Err(rejected.map(|l| l.trim().to_string()).unwrap_or_else(|| repo::explain(&stderr)).into());
        }
        let updated = updated(dir, Some(&before), Some(&tip().await?)).await?;
        let output = match &updated {
            None => t!("{branch} 已是最新", branch = branch),
            Some(u) => format!("{branch} {}..{}", u.from, u.to),
        };
        Ok(Done { output, detail: Some(GitActionDetail { updated, ..GitActionDetail::default() }) })
    }

    /// Commits every change of the work tree, or only those of `paths` (work tree relative), but the daemon's private
    /// dir. With `paths`, whatever else was staged stays staged and out of the commit. `amend` rewrites HEAD instead,
    /// `paths` [] then only its message.
    async fn commit(&self, message: &str, paths: Option<&[String]>, amend: bool) -> Result<String, Failed> {
        let dir = self.dir;
        if message.trim().is_empty() {
            return Err(t!("缺少提交说明").into());
        }
        let mut args: Vec<&str> = self.with(&[]);
        let out = match paths {
            None => {
                let spec = git::everything(dir).await;
                git(dir, &[&["add", "-A", "--"][..], spec].concat()).await?;
                if !amend && git(dir, &["diff", "--cached", "--quiet"]).await.is_ok() {
                    return Err(t!("没有可提交的改动").into());
                }
                args.push("commit");
                if amend {
                    args.push("--amend");
                }
                args.extend(["-m", message]);
                self.run(&args).await?
            }
            Some(paths) => {
                let picked = picked(paths)?;
                let list = nul_list(&picked);
                // update-index takes literal paths, deleted (even already staged as deleted) or untracked ones alike.
                git_input(dir, &["update-index", "--add", "--remove", "-z", "--stdin"], &list).await?;
                let staged = git(dir, &["diff", "--cached", "--no-renames", "--name-only", "-z"]).await?;
                let staged: HashSet<&str> = staged.split('\0').collect();
                if !amend && !picked.iter().any(|p| staged.contains(p.as_str())) {
                    return Err(t!("没有可提交的改动").into());
                }
                // `--only` (implied by the pathspec) commits these paths alone, leaving the rest of the index as it was.
                args.push("--literal-pathspecs");
                args.extend(["commit", "--only", "--pathspec-from-file=-", "--pathspec-file-nul"]);
                if amend {
                    args.push("--amend");
                }
                args.extend(["-m", message]);
                self.run_input(&args, Some(&list)).await?
            }
        };
        Ok(out.lines().next().unwrap_or_default().trim().to_string())
    }

    /// Pushes local `branch` to the branch `target` of `remote` (default: the upstream's when it is on `remote`, else
    /// the same name), always as explicit refs: no name given can read as a refspec (`+a:b`, `:b`, `HEAD`). A branch
    /// tracking nothing then tracks that one. `commit`: only up to that commit of the branch. `force` leases that one
    /// ref; `tags`: all of them too. A rejection is returned as git reports it.
    async fn push(
        &self,
        remote: &str,
        branch: &str,
        target: Option<&str>,
        commit: Option<&str>,
        force: bool,
        tags: bool,
    ) -> Result<String, Failed> {
        let dir = self.dir;
        let (remote, branch) = (arg(remote)?, arg(branch)?);
        let local = format!("refs/heads/{branch}");
        if !has_ref(dir, &local).await {
            return Err(t!("分支不存在：{branch}", branch = branch).into());
        }
        let from = match commit {
            Some(c) => commit_on(dir, c, branch).await?,
            None => local,
        };
        let upstream = upstream(dir, branch).await;
        let dest = match target {
            Some(t) => new_name(dir, t).await?,
            None => upstream
                .as_ref()
                .filter(|(r, _)| r == remote)
                .and_then(|(_, merge)| merge.strip_prefix("refs/heads/"))
                .unwrap_or(branch),
        };
        let to = format!("refs/heads/{dest}");
        let (refspec, lease) = (format!("{from}:{to}"), format!("--force-with-lease={to}"));
        let mut args = vec!["push", "--porcelain"];
        // `-u` only tracks a branch pushed, never a commit: that one is tracked below.
        if upstream.is_none() && commit.is_none() {
            args.push("-u");
        }
        if force {
            args.push(&lease);
        }
        if tags {
            args.push("--tags");
        }
        args.extend([remote, &refspec]);
        let pushed = push_refs(dir, &args, remote).await?;
        // The push updated the target's remote-tracking ref, unless no fetch refspec maps it.
        let tracking = format!("refs/remotes/{remote}/{dest}");
        if upstream.is_none() && commit.is_some() && has_ref(dir, &tracking).await {
            self.run(&["branch", "-q", &format!("--set-upstream-to={tracking}"), branch]).await?;
        }
        let summary = pushed.iter().find(|(r, _)| *r == to).or(pushed.first()).map_or("", |(_, s)| s.as_str());
        Ok(format!("{remote}/{dest} {summary}"))
    }

    /// New `name` at `from` (HEAD), tracking nothing until it is pushed; switched to when `checkout`. `force` replaces a
    /// branch of that name, never the current one.
    async fn branch_create(
        &self,
        name: &str,
        from: Option<&str>,
        checkout: bool,
        force: bool,
    ) -> Result<String, Failed> {
        let dir = self.dir;
        let (name, from) = (new_name(dir, name).await?, arg(from.unwrap_or("HEAD"))?);
        if force && git::branch(dir).await.as_deref() == Some(name) {
            return Err(t!("不能覆盖当前分支 {branch}", branch = name).into());
        }
        if checkout {
            self.run(&["switch", "--no-track", if force { "-C" } else { "-c" }, name, from]).await?;
            return Ok(head_line(dir).await?);
        }
        let mut args = vec!["branch", "--no-track"];
        if force {
            args.push("-f");
        }
        self.run(&[&args[..], &[name, from]].concat()).await?;
        Ok(ref_line(dir, &format!("refs/heads/{name}"), name).await?)
    }

    async fn branch_rename(&self, branch: &str, name: &str) -> Result<String, Failed> {
        let (branch, name) = (arg(branch)?, new_name(self.dir, name).await?);
        self.run(&["branch", "-m", branch, name]).await?;
        Ok(format!("{branch} → {name}"))
    }

    /// A local branch (`force` even when unmerged), or a remote-tracking `origin/x`: x deleted on that remote.
    async fn branch_delete(&self, branch: &str, force: bool) -> Result<String, Failed> {
        let dir = self.dir;
        let branch = arg(branch)?;
        if has_ref(dir, &format!("refs/heads/{branch}")).await {
            let out = self.run(&["branch", if force { "-D" } else { "-d" }, branch]).await?;
            return Ok(out.lines().next().unwrap_or_default().trim().to_string());
        }
        if !has_ref(dir, &format!("refs/remotes/{branch}")).await {
            return Err(t!("分支不存在：{branch}", branch = branch).into());
        }
        let (remote, name) = remote_of(dir, branch).await?;
        let full = format!("refs/heads/{name}");
        let deleted = push_refs(dir, &["push", "--porcelain", remote, "--delete", &full], remote).await?;
        Ok(format!("{branch} {}", deleted.first().map_or("", |(_, s)| s.as_str())))
    }

    /// `branch` into the current one, `mode` default | no-ff | ff-only | squash; changes stashed around a merge that
    /// commits.
    async fn merge(
        &self,
        branch: &str,
        mode: Option<&str>,
        no_commit: bool,
        message: Option<&str>,
    ) -> Result<Done, Failed> {
        let branch = arg(branch)?;
        let mode = mode.unwrap_or("default");
        let mut args = vec!["merge", "--no-edit"];
        match mode {
            "default" => {}
            "no-ff" => args.push("--no-ff"),
            "ff-only" => args.push("--ff-only"),
            "squash" => args.push("--squash"),
            m => return Err(unsupported(m).into()),
        }
        let commits = mode != "squash" && !no_commit;
        if no_commit {
            args.push("--no-commit");
        }
        // git gives the stash back once the merge is committed: left uncommitted, the changes would wait out of sight.
        if commits {
            args.push("--autostash");
        }
        if let Some(m) = message.filter(|m| !m.trim().is_empty()) {
            args.extend(["-m", m]);
        }
        args.push(branch);
        self.merging(&args).await?;
        match commits {
            true => Ok(restored(self.dir, head_line(self.dir).await?, None).await),
            false => Ok(t!("已合并 {branch}，尚未提交", branch = branch).into()),
        }
    }

    /// The current branch, or `branch` (switched to first), onto `onto`, changes stashed around it.
    async fn rebase(&self, onto: &str, branch: Option<&str>) -> Result<Done, Failed> {
        let mut args = vec!["rebase", "--autostash", arg(onto)?];
        if let Some(b) = branch {
            args.push(arg(b)?);
        }
        self.merging(&args).await?;
        Ok(restored(self.dir, head_line(self.dir).await?, None).await)
    }

    /// Rewrites the current branch's `onto..HEAD` as `todo` lists it (each of those commits once, none a merge), changes
    /// stashed around it. git's own todo is replaced by the one planned here (the sequence editor copies it over), and
    /// a reword's or squash's message is committed by an `exec` amending the commit just made, its file kept in the
    /// rebase's state dir so that it outlives a stop on conflicts and goes with the rebase however it ends.
    async fn rebase_todo(&self, onto: &str, branch: Option<&str>, todo: &[GitRebaseStep]) -> Result<Done, Failed> {
        let dir = self.dir;
        if let Some(b) = branch
            && git::branch(dir).await.as_deref() != Some(b)
        {
            return Err(t!("交互式变基只能作用于当前分支").into());
        }
        let onto = commit_hash(dir, onto).await?;
        let listed = git(dir, &["rev-list", "--reverse", "--parents", &format!("{onto}..HEAD"), "--"]).await?;
        let mut commits = vec![];
        for line in listed.lines() {
            let hashes: Vec<&str> = line.split(' ').collect();
            if hashes.len() > 2 {
                return Err(t!("要变基的提交中有合并提交 {commit}", commit = &hashes[0][..7]).into());
            }
            commits.push(hashes[0]);
        }
        let (plan, messages) = rebase_plan(&commits, todo)?;
        let scratch = Scratch::new("gonggong-rebase")?;
        let write = |name: String, text: &str| std::fs::write(scratch.0.join(name), text).map_err(git_ops::io);
        write("gg-todo".into(), &plan)?;
        for (i, message) in messages.iter().enumerate() {
            write(format!("gg-msg-{i}"), message)?;
        }
        // Run by git as `<editor> "$@"`, the todo's path in $1.
        let from = scratch.0.to_string_lossy().replace('\'', "'\\''");
        let editor = format!("f() {{ cp '{from}'/gg-* \"${{1%/*}}\" && cp '{from}'/gg-todo \"$1\"; }}; f");
        let args = [
            "rebase",
            "-i",
            "--autostash",
            "--no-autosquash",
            "--no-rebase-merges",
            "--no-update-refs",
            // Every step makes a commit, so that an exec amends the one it follows.
            "--empty=keep",
            "--reapply-cherry-picks",
            &onto,
        ];
        self.merging_with(&args, &[("GIT_SEQUENCE_EDITOR", &editor)]).await?;
        Ok(restored(dir, head_line(dir).await?, None).await)
    }

    /// Cherry-picks `commits` (oldest first) onto HEAD, or reverts them, newest first so that no revert meets a later
    /// change to what it undoes. Merge commits take their first parent's side, and only on their own.
    async fn pick(&self, revert: bool, commits: &[String]) -> Result<String, Failed> {
        let dir = self.dir;
        if commits.is_empty() {
            return Err(missing("args.commits").into());
        }
        let mut list = commits.iter().map(|c| arg(c)).collect::<Result<Vec<_>, _>>()?;
        if revert {
            list.reverse();
        }
        let parents =
            git(dir, &[&["rev-list", "--no-walk=unsorted", "--parents"][..], &list, &["--"]].concat()).await?;
        let parents: Vec<usize> = parents.lines().map(|l| l.split_whitespace().count() - 1).collect();
        let mut args = if revert { vec!["revert", "--no-edit"] } else { vec!["cherry-pick"] };
        match parents.iter().filter(|n| **n > 1).count() {
            0 => {}
            n if n == parents.len() => args.extend(["-m", "1"]),
            _ => return Err(t!("合并提交需要单独优选或还原").into()),
        }
        args.extend(&list);
        self.merging(&args).await?;
        Ok(head_line(dir).await?)
    }

    /// The current branch to `commit`, `mode` soft | mixed | hard | keep.
    async fn reset(&self, commit: &str, mode: Option<&str>) -> Result<String, Failed> {
        let mode = match mode.unwrap_or("mixed") {
            m @ ("soft" | "mixed" | "hard" | "keep") => m,
            m => return Err(unsupported(m).into()),
        };
        self.run(&["reset", "-q", &format!("--{mode}"), arg(commit)?]).await?;
        Ok(head_line(self.dir).await?)
    }

    /// Reverts in the work tree only the hunks `patch` holds (a `git diff` of the one path against HEAD); refused when
    /// it touches anything else, or no longer applies.
    async fn revert_hunks(&self, paths: &[String], patch: &str) -> Result<String, Failed> {
        let picked = picked(paths)?;
        let [path] = &picked[..] else { return Err(t!("逐块回滚只能针对一个文件").into()) };
        if patch.len() > PATCH_MAX_BYTES {
            return Err(t!("补丁超过 {max} 字节", max = PATCH_MAX_BYTES).into());
        }
        let hunks = hunks_of(patch, path)?;
        let apply = ["apply", "-R", "--whitespace=nowarn"];
        let check = self.run_input(&[&apply[..], &["--check", "-"]].concat(), Some(patch.as_bytes())).await;
        if check.is_err() {
            return Err(t!("改动已变化，请刷新后重试").into());
        }
        self.run_input(&[&apply[..], &["-"]].concat(), Some(patch.as_bytes())).await?;
        Ok(t!("已回滚 {path} 中的 {n} 处改动", path = path, n = hunks))
    }

    /// `paths` back to HEAD, index and work tree; untracked ones deleted (a rename comes as both of its paths), and so
    /// are those the index adds unless `keep_added`: then they are only unstaged.
    async fn discard(&self, paths: &[String], keep_added: bool) -> Result<String, Failed> {
        let dir = self.dir;
        let picked = picked(paths)?;
        if picked.is_empty() {
            return Err(missing("paths").into());
        }
        let untracked = git_ops::untracked(dir).await?;
        let (gone, tracked): (Vec<String>, Vec<String>) = picked.into_iter().partition(|p| untracked.contains(p));
        if let Some(d) = gone.iter().find(|p| dir.join(p).is_dir()) {
            return Err(t!("不是文件：{path}", path = d).into());
        }
        let head = git::head(dir).await;
        let (kept, tracked): (Vec<String>, Vec<String>) = match keep_added {
            true => {
                let base = head.as_deref().unwrap_or(EMPTY_TREE);
                let args = ["diff", "--cached", "--no-renames", "--diff-filter=A", "--name-only", "-z", base, "--"];
                let added = git(dir, &args).await?;
                let added: HashSet<&str> = added.split('\0').collect();
                tracked.into_iter().partition(|p| added.contains(p.as_str()))
            }
            false => (vec![], tracked),
        };
        let from_file = ["--pathspec-from-file=-", "--pathspec-file-nul"];
        let unstage = ["--literal-pathspecs", "rm", "-q", "--cached", "-f"];
        if !kept.is_empty() {
            self.run_input(&[&unstage[..], &from_file].concat(), Some(&nul_list(&kept))).await?;
        }
        if !tracked.is_empty() {
            let list = nul_list(&tracked);
            match head {
                Some(_) => {
                    let restore = ["--literal-pathspecs", "restore", "--source=HEAD", "--staged", "--worktree"];
                    self.run_input(&[&restore[..], &from_file].concat(), Some(&list)).await?;
                }
                // Before the first commit, HEAD has none of them.
                None => {
                    self.run_input(&[&unstage[..], &from_file].concat(), Some(&list)).await?;
                    for p in &tracked {
                        git::remove(dir, &dir.join(p))?;
                    }
                }
            }
        }
        for p in &gone {
            git::remove(dir, &dir.join(p))?;
        }
        Ok(t!("已回滚 {n} 个文件", n = kept.len() + tracked.len() + gone.len()))
    }

    /// Stages `paths` (work tree relative, taken literally) as the work tree has them.
    async fn add(&self, paths: &[String]) -> Result<String, Failed> {
        let picked = picked(paths)?;
        if picked.is_empty() {
            return Err(missing("paths").into());
        }
        let args = ["--literal-pathspecs", "add", "--pathspec-from-file=-", "--pathspec-file-nul"];
        self.run_input(&args, Some(&nul_list(&picked))).await?;
        Ok(t!("已将 {n} 个文件加入版本控制", n = picked.len()))
    }

    /// Stashes the changes (`untracked` files too), or only those of `paths`.
    async fn stash(&self, message: Option<&str>, untracked: bool, paths: Option<&[String]>) -> Result<String, Failed> {
        let dir = self.dir;
        let mut args = vec!["stash", "push"];
        if untracked {
            args.push("-u");
        }
        if let Some(m) = message.filter(|m| !m.trim().is_empty()) {
            args.extend(["-m", m]);
        }
        let before = stash_top(dir).await;
        match paths {
            None => {
                args.push("--");
                args.extend(git::everything(dir).await);
                self.run(&args).await?
            }
            Some(paths) => {
                let picked = picked(paths)?;
                if picked.is_empty() {
                    return Err(t!("没有可贮藏的改动").into());
                }
                args.extend(["--pathspec-from-file=-", "--pathspec-file-nul"]);
                self.run_input(&[&["--literal-pathspecs"][..], &args].concat(), Some(&nul_list(&picked))).await?
            }
        };
        // git says "No local changes to save" and succeeds.
        if stash_top(dir).await == before {
            return Err(t!("没有可贮藏的改动").into());
        }
        Ok(git(dir, &["stash", "list", "-1", "--format=%gd: %gs"]).await?.trim().to_string())
    }

    /// Applies `stash@{n}`, dropped when `pop`, `index` reinstating the index; with `branch`: as that new branch, made
    /// where the stash was.
    async fn unstash(&self, n: u32, pop: bool, index: bool, branch: Option<&str>) -> Result<String, Failed> {
        let stash = format!("stash@{{{n}}}");
        if let Some(b) = branch {
            self.merging(&["stash", "branch", new_name(self.dir, b).await?, &stash]).await?;
            return Ok(head_line(self.dir).await?);
        }
        let mut args = vec!["stash", if pop { "pop" } else { "apply" }];
        if index {
            args.push("--index");
        }
        args.push(&stash);
        self.merging(&args).await?;
        Ok(if pop { t!("已弹出 {stash}", stash = stash) } else { t!("已应用 {stash}", stash = stash) })
    }

    /// `stash@{n}`, or every stash.
    async fn stash_drop(&self, n: Option<u32>) -> Result<String, Failed> {
        match n {
            Some(n) => {
                let out = self.run(&["stash", "drop", &format!("stash@{{{n}}}")]).await?;
                Ok(out.lines().next().unwrap_or_default().trim().to_string())
            }
            None => {
                self.run(&["stash", "clear"]).await?;
                Ok(t!("已清空贮藏").into())
            }
        }
    }

    /// `name` at `from` (HEAD), annotated with `message` when given.
    async fn tag_create(&self, name: &str, from: Option<&str>, message: Option<&str>) -> Result<String, Failed> {
        let dir = self.dir;
        let (name, from) = (new_name(dir, name).await?, arg(from.unwrap_or("HEAD"))?);
        let mut args = vec!["tag"];
        if let Some(m) = message.filter(|m| !m.trim().is_empty()) {
            args.extend(["-a", "-m", m]);
        }
        args.extend([name, from]);
        self.run(&args).await?;
        Ok(ref_line(dir, &format!("refs/tags/{name}"), name).await?)
    }

    /// `name`, deleted on `remote` first when given.
    async fn tag_delete(&self, name: &str, remote: Option<&str>) -> Result<String, Failed> {
        let name = arg(name)?;
        if let Some(remote) = remote {
            let remote = arg(remote)?;
            push_refs(self.dir, &["push", "--porcelain", remote, "--delete", &format!("refs/tags/{name}")], remote)
                .await?;
        }
        let out = self.run(&["tag", "-d", name]).await?;
        Ok(out.lines().next().unwrap_or_default().trim().to_string())
    }

    async fn tag_push(&self, name: &str, remote: &str) -> Result<String, Failed> {
        let (name, remote) = (arg(name)?, arg(remote)?);
        let pushed =
            push_refs(self.dir, &["push", "--porcelain", remote, &format!("refs/tags/{name}")], remote).await?;
        Ok(format!("{remote}/{name} {}", pushed.first().map_or("", |(_, s)| s.as_str())))
    }

    /// `commit`'s changes to `paths` (against its first parent) applied to the work tree, or undone when `reverse`;
    /// what clashes is left in conflict. `git apply --3way` works through the index, which must match the work tree
    /// for those paths: their unstaged changes are staged first, and the result is left staged too, uncommitted all
    /// the same (IDEA leaves it in a changelist).
    async fn apply(&self, commit: &str, paths: &[String], reverse: bool) -> Result<String, Failed> {
        let dir = self.dir;
        let picked = picked(paths)?;
        if picked.is_empty() {
            return Err(missing("paths").into());
        }
        let hash = commit_hash(dir, commit).await?;
        let short = git(dir, &["rev-parse", "--short", &hash]).await?.trim().to_string();
        let parents = git(dir, &["log", "-1", "--format=%P", &hash, "--"]).await?;
        let parent = parents.split_whitespace().next().unwrap_or(EMPTY_TREE);
        let diff = ["--literal-pathspecs", "diff-tree", "-p", "--binary", "--no-renames", parent, &hash, "--"];
        let names: Vec<&str> = picked.iter().map(String::as_str).collect();
        let patch = git_bytes(dir, &[&diff[..], &names].concat()).await?;
        if patch.is_empty() {
            return Err(t!("{commit} 没有改动所选文件", commit = short).into());
        }
        let unstaged = ["--literal-pathspecs", "diff", "--name-only", "-z", "--"];
        let unstaged = git(dir, &[&unstaged[..], &names].concat()).await?;
        if !unstaged.is_empty() {
            let add = ["--literal-pathspecs", "add", "--pathspec-from-file=-", "--pathspec-file-nul"];
            self.run_input(&add, Some(unstaged.as_bytes())).await?;
        }
        let mut apply = vec!["apply", "--3way", "--whitespace=nowarn"];
        if reverse {
            apply.push("-R");
        }
        if let Err(e) = self.run_input(&apply, Some(&patch)).await {
            return Err(stopped(dir).await.unwrap_or(e));
        }
        let n = picked.len();
        Ok(match reverse {
            true => t!("已撤销 {commit} 对 {n} 个文件的改动", commit = short, n = n),
            false => t!("已应用 {commit} 对 {n} 个文件的改动", commit = short, n = n),
        })
    }

    /// `paths` as `commit` has them, into the index and the work tree; those it doesn't have are deleted from the work
    /// tree, never through a link out of it.
    async fn restore(&self, commit: &str, paths: &[String]) -> Result<String, Failed> {
        let dir = self.dir;
        let picked = picked(paths)?;
        if picked.is_empty() {
            return Err(missing("paths").into());
        }
        let hash = commit_hash(dir, commit).await?;
        let names: Vec<&str> = picked.iter().map(String::as_str).collect();
        let ls = ["--literal-pathspecs", "ls-tree", "-z", "--name-only", &hash, "--"];
        let there = git(dir, &[&ls[..], &names].concat()).await?;
        let there: HashSet<&str> = there.split('\0').collect();
        let (kept, gone): (Vec<String>, Vec<String>) = picked.iter().cloned().partition(|p| there.contains(p.as_str()));
        for p in &gone {
            within(dir, p)?;
        }
        if !kept.is_empty() {
            let checkout = ["--literal-pathspecs", "checkout", &hash, "--pathspec-from-file=-", "--pathspec-file-nul"];
            self.run_input(&checkout, Some(&nul_list(&kept))).await?;
        }
        for p in &gone {
            git::remove(dir, &dir.join(p))?;
        }
        let short = git(dir, &["rev-parse", "--short", &hash]).await?.trim().to_string();
        Ok(t!("已从 {commit} 获取 {n} 个文件", commit = short, n = picked.len()))
    }

    /// Goes on with what stopped: a merge is committed (with `message` when given), the others continued.
    async fn proceed(&self, message: Option<&str>) -> Result<String, Failed> {
        let Some(ongoing) = git::ongoing(self.dir).await? else { return Err(t!("没有进行中的操作").into()) };
        match (ongoing.kind, message.filter(|m| !m.trim().is_empty())) {
            (GitOngoingKind::Merge, Some(m)) => self.merging(&["commit", "-m", m]).await?,
            (GitOngoingKind::Merge, None) => self.merging(&["commit", "--no-edit"]).await?,
            (kind, _) => self.merging(&[op(kind), "--continue"]).await?,
        };
        Ok(head_line(self.dir).await?)
    }

    /// Back to before what stopped; conflicts nothing is in progress for (a stash that did not apply cleanly) are
    /// reset away.
    async fn abort(&self) -> Result<String, Failed> {
        let dir = self.dir;
        match git::ongoing(dir).await? {
            // A squash merge, which `merge --abort` knows nothing of.
            Some(o) if o.kind == GitOngoingKind::Merge && !has_merge_head(dir).await => {
                self.run(&["reset", "--merge"]).await?
            }
            Some(ongoing) => self.run(&[op(ongoing.kind), "--abort"]).await?,
            None if !git_ops::unmerged(self.dir).await?.is_empty() => self.run(&["reset", "--merge"]).await?,
            None => return Err(t!("没有进行中的操作").into()),
        };
        Ok(head_line(self.dir).await?)
    }

    /// Leaves out the commit a rebase, cherry-pick or revert stopped at and goes on.
    async fn skip(&self) -> Result<String, Failed> {
        match git::ongoing(self.dir).await? {
            None => Err(t!("没有进行中的操作").into()),
            Some(o) if o.kind == GitOngoingKind::Merge => Err(t!("合并不能跳过").into()),
            Some(o) => {
                self.merging(&[op(o.kind), "--skip"]).await?;
                Ok(head_line(self.dir).await?)
            }
        }
    }

    /// Marks unmerged `path` resolved: written with `content`, or as `side` has it (removed when it deleted it); with
    /// `side`, `more` paths too. Nothing is resolved unless every one of them is in conflict.
    async fn resolve(
        &self,
        path: &str,
        more: &[String],
        side: Option<GitConflictPick>,
        content: Option<&str>,
    ) -> Result<String, Failed> {
        let dir = self.dir;
        let mut paths = vec![tree_path(path)?];
        for p in more {
            let p = tree_path(p)?;
            if !paths.contains(&p) {
                paths.push(p);
            }
        }
        if paths.len() > 1 && side.is_none() {
            return Err(missing("args.side").into());
        }
        let unmerged = git_ops::unmerged(dir).await?;
        let mut conflicts = vec![];
        for path in &paths {
            match unmerged.iter().find(|c| &c.path == path && !private(path)) {
                Some(c) => conflicts.push(c),
                None => return Err(t!("没有冲突：{path}", path = path).into()),
            }
        }
        let literal = "--literal-pathspecs";
        match (content, side) {
            (Some(content), _) => {
                let path = &paths[0];
                let file = dir.join(path);
                let write =
                    file.parent().map_or(Ok(()), std::fs::create_dir_all).and_then(|_| std::fs::write(&file, content));
                write.map_err(|e| t!("无法写入 {path}：{e}", path = path, e = e))?;
                self.run(&[literal, "add", "--", path]).await?;
            }
            (None, Some(side)) => {
                for conflict in conflicts {
                    let path = conflict.path.as_str();
                    let (flag, taken) = match side {
                        GitConflictPick::Ours => ("--ours", conflict.ours),
                        GitConflictPick::Theirs => ("--theirs", conflict.theirs),
                    };
                    if taken == GitConflictSide::Deleted {
                        self.run(&[literal, "rm", "-q", "--", path]).await?;
                    } else {
                        self.run(&[literal, "checkout", flag, "--", path]).await?;
                        self.run(&[literal, "add", "--", path]).await?;
                    }
                }
            }
            (None, None) => return Err(missing("args.side").into()),
        }
        Ok(match &paths[..] {
            [path] => t!("已解决 {path}", path = path),
            _ => t!("已解决 {n} 个文件", n = paths.len()),
        })
    }
}

fn op(kind: GitOngoingKind) -> &'static str {
    match kind {
        GitOngoingKind::Merge => "merge",
        GitOngoingKind::Rebase => "rebase",
        GitOngoingKind::CherryPick => "cherry-pick",
        GitOngoingKind::Revert => "revert",
    }
}

/// Why a write failed: git's first error line (hints left out), else the last thing it printed.
fn explain(out: &Output) -> String {
    let lines = |b: &[u8]| -> Vec<String> {
        let text = String::from_utf8_lossy(b);
        text.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with("hint:")).map(String::from).collect()
    };
    let first = lines(&out.stderr).into_iter().next();
    first.or_else(|| lines(&out.stdout).pop()).unwrap_or_else(|| t!("git 执行失败").into())
}

/// Why a write failed ([`explain`]), with the files git names as in its way.
fn failed(out: &Output) -> Failed {
    Failed { error: explain(out), detail: in_the_way(&String::from_utf8_lossy(&out.stderr)).map(Box::new) }
}

/// The files git lists as in the way of a checkout, a merge or the like (`error: Your local changes to the following
/// files would be overwritten by checkout:`, untracked ones alike), one per tab-indented line: detail overwritten.
fn in_the_way(stderr: &str) -> Option<GitActionDetail> {
    let (mut paths, mut listing) = (vec![], false);
    for line in stderr.lines() {
        match line.strip_prefix('\t') {
            Some(path) if listing => paths.push(path.to_string()),
            _ => {
                listing = line.starts_with("error: ")
                    && line.ends_with(':')
                    && [" would be overwritten by ", " would be removed by "].iter().any(|w| line.contains(w));
            }
        }
    }
    let code = Some(GitActionCode::Overwritten);
    (!paths.is_empty()).then(|| GitActionDetail { code, paths, ..GitActionDetail::default() })
}

async fn unmerged(dir: &Path) -> Vec<String> {
    git_ops::unmerged(dir).await.map(|c| c.into_iter().map(|c| c.path).collect()).unwrap_or_default()
}

/// What stopped a command that left unmerged paths: how many, the first few, and all of them as detail conflicts.
async fn stopped(dir: &Path) -> Option<Failed> {
    let paths = unmerged(dir).await;
    if paths.is_empty() {
        return None;
    }
    let mut files = paths.iter().take(NAMED_CONFLICTS).map(String::as_str).collect::<Vec<_>>().join(", ");
    if paths.len() > NAMED_CONFLICTS {
        files = t!("{files} 等", files = files);
    }
    let error = t!("有 {n} 个冲突待解决：{files}", n = paths.len(), files = files);
    let detail = GitActionDetail { code: Some(GitActionCode::Conflicts), paths, ..GitActionDetail::default() };
    Some(Failed { error, detail: Some(Box::new(detail)) })
}

/// `output` and `detail` of something that went through with the changes stashed around it, and the conflicts that
/// restoring them left.
async fn restored(dir: &Path, output: String, detail: Option<GitActionDetail>) -> Done {
    let paths = unmerged(dir).await;
    if paths.is_empty() {
        return Done { output, detail };
    }
    let output = t!("{output}；恢复本地改动时有冲突，改动仍保留在贮藏中", output = output);
    let detail = GitActionDetail { code: Some(GitActionCode::Conflicts), paths, ..detail.unwrap_or_default() };
    Done { output, detail: Some(detail) }
}

/// The refusal to bring local `branch` up to the remote `target` when each has commits of its own, with how many.
async fn diverged(dir: &Path, branch: &str, target: &str) -> Result<Failed, String> {
    let range = format!("refs/heads/{branch}...refs/remotes/{target}");
    let counts = git(dir, &["rev-list", "--left-right", "--count", &range]).await?;
    let mut n = counts.split_whitespace().map(|n| n.parse::<u32>().unwrap_or(0));
    let (ahead, behind) = (n.next().unwrap_or(0), n.next().unwrap_or(0));
    let error = t!(
        "{branch} 与 {remote} 已分叉：本地有 {ahead} 个提交不在远程分支上，远程分支有 {behind} 个新提交",
        branch = branch,
        remote = target,
        ahead = ahead,
        behind = behind
    );
    let (code, ahead, behind) = (Some(GitActionCode::Diverged), Some(ahead), Some(behind));
    let detail = GitActionDetail { code, ahead, behind, ..GitActionDetail::default() };
    Ok(Failed { error, detail: Some(Box::new(detail)) })
}

/// `ancestor` is `of` or one of its ancestors.
async fn is_ancestor(dir: &Path, ancestor: &str, of: &str) -> bool {
    git(dir, &["merge-base", "--is-ancestor", ancestor, of]).await.is_ok()
}

/// What moved a branch from `before` to `after` (None when nothing did): their short hashes, the commits that came in
/// (not the ones a rebase only replayed on top) and the files that differ.
async fn updated(dir: &Path, before: Option<&str>, after: Option<&str>) -> Result<Option<GitUpdated>, String> {
    let (Some(before), Some(after)) = (before, after) else { return Ok(None) };
    if before == after {
        return Ok(None);
    }
    let range = format!("{before}...{after}");
    let count = ["rev-list", "--count", "--right-only", "--cherry-pick", &range];
    let names = ["diff", "--name-only", "-z", "-M", before, after, "--"];
    let (from, to) = (["rev-parse", "--short", before], ["rev-parse", "--short", after]);
    let (commits, files, from, to) = tokio::join!(git(dir, &count), git(dir, &names), git(dir, &from), git(dir, &to));
    Ok(Some(GitUpdated {
        from: from?.trim().to_string(),
        to: to?.trim().to_string(),
        commits: commits?.trim().parse().map_err(|e| format!("{e}"))?,
        files: files?.split('\0').filter(|f| !f.is_empty()).count() as u32,
    }))
}

/// How many hunks `patch` has when it holds nothing but hunks of `path` (a `git diff` of it): every file header names
/// that path as `git apply` reads it (its first directory left out) or /dev/null, hunks are passed over by their line
/// counts, and anything else (a rename, a copy, a binary patch) is refused.
fn hunks_of(patch: &str, path: &str) -> Result<usize, String> {
    let refused = || t!("补丁只能包含 {path} 的改动", path = path);
    let names = |name: &str| name.split_once('/').is_some_and(|(_, rest)| rest == path);
    let (mut old, mut new, mut hunks) = (0u32, 0u32, 0);
    for line in patch.lines() {
        if old > 0 || new > 0 {
            let (o, n) = match line.bytes().next() {
                None | Some(b' ') => (1, 1),
                Some(b'-') => (1, 0),
                Some(b'+') => (0, 1),
                Some(b'\\') => (0, 0),
                _ => return Err(refused()),
            };
            (old, new) = (old.checked_sub(o).ok_or_else(refused)?, new.checked_sub(n).ok_or_else(refused)?);
        } else if let Some(range) = line.strip_prefix("@@ -") {
            (old, new) = hunk_counts(range).ok_or_else(refused)?;
            hunks += 1;
        } else if let Some(pair) = line.strip_prefix("diff --git ") {
            // `<a>/<path> <b>/<path>`
            let pair = pair.strip_suffix(path).and_then(|p| p.strip_suffix('/')).and_then(|p| p.rsplit_once(' '));
            if !pair.is_some_and(|(a, b)| !b.contains('/') && names(a)) {
                return Err(refused());
            }
        } else if let Some(name) = line.strip_prefix("--- ").or_else(|| line.strip_prefix("+++ ")) {
            // git ends a name that has a space with a tab.
            let name = name.strip_suffix('\t').unwrap_or(name);
            if name != "/dev/null" && !names(name) {
                return Err(refused());
            }
        } else if !line.is_empty() && !PLAIN_HEADERS.iter().any(|h| line.starts_with(h)) {
            return Err(refused());
        }
    }
    match hunks > 0 && old == 0 && new == 0 {
        true => Ok(hunks),
        false => Err(refused()),
    }
}

/// The old and new line counts of a hunk from its header past `@@ -`: `<line>[,<count>] +<line>[,<count>] @@…`.
fn hunk_counts(range: &str) -> Option<(u32, u32)> {
    let (old, new) = range.split_once(" @@")?.0.split_once(" +")?;
    let count = |r: &str| match r.split_once(',') {
        Some((_, n)) => n.parse().ok(),
        None => r.parse::<u32>().ok().map(|_| 1),
    };
    Some((count(old)?, count(new)?))
}

/// The todo git runs for `steps` over `commits` (`onto..HEAD`, oldest first, full hashes), each listed once by its
/// hash or a prefix of it, and the messages its execs commit (`gg-msg-<i>` in the rebase's state dir).
fn rebase_plan(commits: &[&str], steps: &[GitRebaseStep]) -> Result<(String, Vec<String>), String> {
    use GitRebaseAction as A;
    if steps.iter().find(|s| s.action != A::Drop).is_some_and(|s| matches!(s.action, A::Squash | A::Fixup)) {
        return Err(t!("第一个提交不能压缩或修正到前一个提交").into());
    }
    let (mut todo, mut messages, mut seen) = (String::new(), vec![], HashSet::new());
    for s in steps {
        let prefix = s.commit.to_ascii_lowercase();
        let mut matching = commits.iter().filter(|c| c.starts_with(&prefix));
        let (Some(hash), None) = (matching.next(), matching.next()) else {
            return Err(t!("提交 {commit} 不在要变基的提交中", commit = s.commit));
        };
        if !seen.insert(*hash) {
            return Err(t!("提交 {commit} 重复出现", commit = s.commit));
        }
        let command = match s.action {
            A::Pick | A::Reword => "pick",
            A::Squash => "squash",
            A::Fixup => "fixup",
            A::Drop => "drop",
        };
        todo.push_str(&format!("{command} {hash}\n"));
        match (s.action, s.message.as_deref().filter(|m| !m.trim().is_empty())) {
            (A::Reword, None) => return Err(t!("提交 {commit} 改写说明时缺少新的说明", commit = s.commit)),
            (A::Reword | A::Squash, Some(m)) => {
                // `-F` without an editor keeps the message as given, `#` lines too.
                let file = format!("\"$(git rev-parse --git-path rebase-merge)/gg-msg-{}\"", messages.len());
                todo.push_str(&format!("exec git commit -q --amend --no-verify --allow-empty -F {file}\n"));
                messages.push(m.to_string());
            }
            _ => {}
        }
    }
    if let Some(missing) = commits.iter().find(|c| !seen.contains(*c)) {
        return Err(t!("缺少提交 {commit}：每个要变基的提交都要列出", commit = &missing[..7]));
    }
    Ok((todo, messages))
}

/// Refuses `rel` when its directory resolves out of `dir` (through a link): deleting it would reach elsewhere.
fn within(dir: &Path, rel: &str) -> Result<(), String> {
    let file = dir.join(rel);
    let parent = file.parent().unwrap_or(dir);
    match (parent.canonicalize(), dir.canonicalize()) {
        (Ok(p), Ok(d)) if !p.starts_with(&d) => Err(t!("路径超出工作区：{path}", path = rel)),
        _ => Ok(()),
    }
}

/// `[label abc1234] subject` of `rev`.
async fn ref_line(dir: &Path, rev: &str, label: &str) -> Result<String, String> {
    let line = git(dir, &["log", "-1", "--format=%h %s", rev, "--"]).await?;
    let (short, subject) = line.trim().split_once(' ').unwrap_or((line.trim(), ""));
    Ok(format!("[{label} {short}] {subject}"))
}

/// [`ref_line`] of HEAD, labelled with the current branch.
async fn head_line(dir: &Path) -> Result<String, String> {
    let branch = git::branch(dir).await.unwrap_or_else(|| "HEAD".into());
    ref_line(dir, "HEAD", &branch).await
}

async fn has_ref(dir: &Path, full: &str) -> bool {
    git(dir, &["show-ref", "--verify", "--quiet", full]).await.is_ok()
}

/// `(remote, branch)` of the remote-tracking `remote/branch`.
async fn remote_of<'a>(dir: &Path, tracking: &'a str) -> Result<(&'a str, &'a str), String> {
    let remotes = git(dir, &["remote"]).await?;
    let split = remotes.lines().find_map(|r| Some((r.len(), tracking.strip_prefix(r)?.strip_prefix('/')?)));
    split.map(|(n, branch)| (&tracking[..n], branch)).ok_or_else(|| t!("分支不存在：{branch}", branch = tracking))
}

/// `name` when it can name a new branch or tag (and is no `@{-1}` that git would expand).
async fn new_name<'a>(dir: &Path, name: &'a str) -> Result<&'a str, String> {
    let name = arg(name)?;
    match git(dir, &["check-ref-format", "--branch", name]).await {
        Ok(out) if out.trim() == name => Ok(name),
        _ => Err(t!("无效的名称：{name}", name = name)),
    }
}

/// `paths` as tree paths, without the root and the daemon's private dir.
fn picked(paths: &[String]) -> Result<Vec<String>, String> {
    let mut picked = vec![];
    for p in paths {
        let p = tree_path(p)?;
        if !p.is_empty() && !private(&p) {
            picked.push(p);
        }
    }
    Ok(picked)
}

fn nul_list(paths: &[String]) -> Vec<u8> {
    paths.iter().flat_map(|p| [p.as_bytes(), b"\0"].concat()).collect()
}

async fn stash_top(dir: &Path) -> Option<String> {
    git(dir, &["rev-parse", "-q", "--verify", "refs/stash"]).await.ok()
}

/// Refuses when `stash@{n}` is not the stash `expect` names (a full or abbreviated hash) any more: the list moved since
/// it was shown.
async fn expect_stash(dir: &Path, n: u32, expect: Option<&str>) -> Result<(), String> {
    let Some(expect) = expect else { return Ok(()) };
    let found = git(dir, &["rev-parse", "-q", "--verify", &format!("stash@{{{n}}}")]).await;
    match !expect.is_empty() && found.is_ok_and(|hash| hash.trim().starts_with(expect)) {
        true => Ok(()),
        false => Err(t!("贮藏列表已变化，请刷新后重试").into()),
    }
}

/// The full hash of `commit`.
async fn commit_hash(dir: &Path, commit: &str) -> Result<String, String> {
    let rev = format!("{}^{{commit}}", arg(commit)?);
    let hash = git(dir, &["rev-parse", "-q", "--verify", &rev]).await;
    Ok(hash.map_err(|_| t!("提交不存在：{commit}", commit = commit))?.trim().to_string())
}

async fn has_merge_head(dir: &Path) -> bool {
    git(dir, &["rev-parse", "-q", "--verify", "MERGE_HEAD"]).await.is_ok()
}

/// The full hash of `commit` when it is on local `branch`: no refspec syntax (`+`, `:`) can hide in it.
async fn commit_on(dir: &Path, commit: &str, branch: &str) -> Result<String, String> {
    let hash = commit_hash(dir, commit).await?;
    match is_ancestor(dir, &hash, &format!("refs/heads/{branch}")).await {
        true => Ok(hash),
        false => Err(t!("该提交不在分支 {branch} 上", branch = branch)),
    }
}

/// Refuses when HEAD is no longer the commit `expect` names (a full or abbreviated hash): it moved since it was shown.
async fn expect_head(dir: &Path, expect: Option<&str>) -> Result<(), String> {
    let Some(expect) = expect else { return Ok(()) };
    let now = match git::head(dir).await {
        Some(head) if !expect.is_empty() && head.starts_with(expect) => return Ok(()),
        Some(head) => git(dir, &["rev-parse", "--short", &head]).await?.trim().to_string(),
        // An unborn branch has no commit to name.
        None => git::branch(dir).await.unwrap_or_default(),
    };
    Err(t!("HEAD 已变化（现在是 {short}），请刷新后重试", short = now))
}

/// `(remote, merge ref)` local `branch` tracks, as configured.
async fn upstream(dir: &Path, branch: &str) -> Option<(String, String)> {
    let config = async |key: &str| {
        let value = git(dir, &["config", "--get", &format!("branch.{branch}.{key}")]).await.ok();
        value.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
    };
    Some((config("remote").await?, config("merge").await?))
}

/// Appends `paths` (work tree relative) to the repo's root .gitignore as lines matching each alone; lines already
/// there are left as they are.
fn ignore(dir: &Path, paths: &[String]) -> Result<String, String> {
    let picked = picked(paths)?;
    if picked.is_empty() {
        return Err(missing("paths"));
    }
    let lines = picked.iter().map(|p| ignore_line(p)).collect::<Result<Vec<_>, _>>()?;
    let file = dir.join(".gitignore");
    // A link would have the lines written wherever it points.
    if std::fs::symlink_metadata(&file).is_ok_and(|m| !m.is_file()) {
        return Err(t!("不是文件：{path}", path = ".gitignore"));
    }
    let write_error = |e: std::io::Error| t!("无法写入 {path}：{e}", path = ".gitignore", e = e);
    let mut text = match std::fs::read(&file) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => vec![],
        Err(e) => return Err(write_error(e)),
    };
    let current = String::from_utf8_lossy(&text).into_owned();
    let mut seen: HashSet<&str> = current.lines().map(|l| l.trim_end_matches('\r')).collect();
    for line in &lines {
        if seen.insert(line) {
            if !text.is_empty() && !text.ends_with(b"\n") {
                text.push(b'\n');
            }
            text.extend_from_slice(line.as_bytes());
            text.push(b'\n');
        }
    }
    std::fs::write(&file, text).map_err(write_error)?;
    let distinct: HashSet<&String> = picked.iter().collect();
    Ok(t!("已将 {n} 个路径加入 .gitignore", n = distinct.len()))
}

/// A .gitignore line matching the tree path `path` alone: anchored with `/`, glob characters and leading or trailing
/// spaces (git trims the latter) escaped. A line break can't be escaped.
fn ignore_line(path: &str) -> Result<String, String> {
    if path.contains(['\n', '\r']) {
        return Err(t!("无法加入 .gitignore：{path}", path = path.escape_debug()));
    }
    let (start, end) = (path.len() - path.trim_start_matches(' ').len(), path.trim_end_matches(' ').len());
    let mut line = String::from("/");
    for (i, c) in path.char_indices() {
        if "*?[]\\!#".contains(c) || (c == ' ' && (i < start || i >= end)) {
            line.push('\\');
        }
        line.push(c);
    }
    Ok(line)
}

/// `git push --porcelain …` to `remote`: (pushed ref, git's summary) per ref; any rejected ref fails it.
async fn push_refs(dir: &Path, args: &[&str], remote: &str) -> Result<Vec<(String, String)>, String> {
    let out = remote_output(dir, args, Some(NETWORK_TIMEOUT)).await.map_err(|f| f.detail)?;
    // `<flag>\t<from>:<to>\t<summary>` per ref, flag `!` when rejected.
    let stdout = String::from_utf8_lossy(&out.stdout);
    let refs: Vec<(char, String, String)> = stdout
        .lines()
        .filter_map(|l| {
            let mut f = l.splitn(3, '\t');
            let flag = f.next()?.chars().next()?;
            let to = f.next()?.rsplit(':').next()?.to_string();
            Some((flag, to, f.next()?.to_string()))
        })
        .collect();
    if let Some((_, to, why)) = refs.iter().find(|(flag, ..)| *flag == '!') {
        let name = to.strip_prefix("refs/heads/").or_else(|| to.strip_prefix("refs/tags/")).unwrap_or(to);
        return Err(format!("{remote}/{name} {why}"));
    }
    if !out.status.success() {
        return Err(repo::explain(&String::from_utf8_lossy(&out.stderr)));
    }
    Ok(refs.into_iter().map(|(_, to, summary)| (to, summary)).collect())
}
