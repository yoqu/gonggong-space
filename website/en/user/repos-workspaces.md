# Repositories and workspaces

This page covers how a group binds git repositories (the main repository and additional repositories), which directories each Bot works in, how to change a workspace, sync modes, and how to clean up workspaces.

First, two terms:

- **Repository**: a git repository URL and branch bound to the group. A group has one **main repository** (with a base branch) and can add several **additional repositories**.
- **Workspace**: the directory where a Bot actually works on its machine. Each Bot in a group has its own workspace, so they don't interfere with each other.

All repository settings live under 「群设置 → 仓库与同步」 (Group settings → Repos & sync). Only group admins can change them; other members see them read-only.

## Bind a repository

Choose one at the bottom of the 「发起会话」 (New conversation) dialog when creating a group, or have a group admin click 「绑定仓库…」 (Bind repository…) later under 「群设置 → 仓库与同步 → 代码仓库」 (Group settings → Repos & sync → Repositories).

### Choose a repository

1. Click the 「仓库」 (Repository) row to open the repository picker.
2. Choose from 「最近」 (Recent) or a connected GitHub / GitLab account, or paste a URL directly into 「搜索仓库，或粘贴地址」 (Search repositories or paste a URL) and click 「使用地址 …」 (Use URL …). A repository marked 「本机已有」 (On this machine) already has a clone on your machine; 「N 个群在用」 (Used by N groups) means groups in your team have already bound it.
3. Confirm the branch under 「基准分支」 (Base branch), which defaults to `main`.

If you don't need a repository, choose 「不绑定仓库」 (No repository) and each Bot uses a directory on its machine; see [Groups without a bound repository](#groups-without-a-bound-repository).

Supported URL formats:

| Format | Example |
| --- | --- |
| SSH | `git@github.com:xinghe/todo-app.git` |
| HTTPS / HTTP | `https://github.com/xinghe/todo-app.git` |
| ssh:// | `ssh://git@git.example.com:2222/xinghe/todo-app.git` |

If the URL format is wrong, you'll see 「地址格式不正确，支持 git@ / https:// / http:// / ssh://」 ("Invalid URL, use git@ / https:// / http:// / ssh://").

### Access check

After you enter the URL, every Bot in the group checks whether it can access the repository **on its own machine**:

![Repository picker and access check](/screenshots/web/repo-picker.webp)

| Result | Meaning |
| --- | --- |
| 可访问 (Accessible) | Can clone; shows whether HTTPS or SSH is used |
| 无权限 · 进群后暂停 (No permission · Paused after joining) | This machine has no access, or the repository doesn't exist |
| 网络或证书 · 进群后暂停 (Network or certificate · Paused after joining) | Network unreachable or a certificate problem |
| 超时 · 进群后暂停 (Timed out · Paused after joining) | Connection timed out |
| 离线 · 上线后验证 (Offline · Checked once online) | The machine is offline; it checks again once it's back online |
| 分支不存在 (Branch does not exist) | The base branch doesn't exist; **binding is blocked** |

- Only "branch does not exist" blocks binding. Bots with other failures still join the group but start out paused; see [Bot paused](#bot-paused).
- If the group has no Bots yet, you'll see 「没有可检查的 Bot · 进群后由各 Bot 的机器验证」 (No Bots to check · Each Bot's machine checks after joining).

### Credentials

- Cloning uses **the git credentials on each Bot's machine**. A machine owner can configure SSH keys and HTTPS tokens for the machine on the web (the machine's 「Git 访问」 (Git access)), or keep using the SSH keys or credential manager already on the machine; see [My machines and Bots](/en/user/machines).
- Under avatar menu → 「设置…」 (Settings…) → 「Git 与仓库」 (Git & repos) → 「协议偏好」 (Protocol preference), choose 「按仓库地址」 (Match repo URL), 「优先 SSH」 (Prefer SSH), or 「优先 HTTPS」 (Prefer HTTPS). This decides which protocol your Bots try first when cloning or checking a repository.
- On the same page, 「已连接的账号」 (Connected accounts) → 「添加账号…」 (Add account…) lets you connect a GitHub / GitLab token. The token is used only to list repositories and branches in the picker. It's stored encrypted on the server and isn't used for cloning.

## Main and additional repositories

「代码仓库」 (Repositories) under 「群设置 → 仓库与同步」 lists all of the group's repositories: the main repository is marked 「主」 (Main) and shows its base branch; additional repositories show their own branches.

| Action | Button | Notes |
| --- | --- | --- |
| Add an additional repository | 「添加仓库…」 (Add repo…) | Available only after a main repository is bound. Each additional repository has its own branch |
| Change the main repository | 「更换…」 (Change…) on the main repository | Each Bot's automatic clone is rebuilt |
| Change an additional repository | 「更改…」 (Change…) on the additional repository | Change the URL or branch |
| Remove an additional repository | 「移除…」 (Remove…) | Bots stop using it from the next turn and start new sessions; existing clones stay on each machine and aren't deleted |
| Unbind the main repository | 「解绑…」 (Unbind…) | You must first remove the other repositories and switch back to partition mode |

- By default each Bot automatically clones every repository; additional repositories are cloned next to the main one. A Bot owner can switch an additional repository to an existing clone on the machine (the remote must match); see below.
- Additional repositories are committed and pushed on their own branches and don't take part in force sync. Git status, commits, pushes, and base-branch protection are handled per repository; see [Git](/en/user/git).

After the main repository is unbound: Bots using an automatic clone switch to their default workspace (Bots without one need their owner to choose again); Bots already using a local directory are unchanged; automatic clones stay on each machine and aren't deleted.

### Push rules

Once a repository is bound, 「推送规则」 (Push rules) has 「禁止直推基准分支」 (No direct pushes to the base branch). When it's on, Bots commit on feature branches, and pushing to the base branch requires approval from the Bot owner.

## Each Bot's workspace

Under 「群设置 → Bot」 (Group settings → Bot), each Bot shows the status of its main workspace:

| Status | Meaning |
| --- | --- |
| 自动克隆 · 就绪 (Automatic clone · Ready) | Cloned and ready to work |
| 克隆中… (Cloning…) | Clone in progress |
| 等待上线 (Waiting to come online) | The machine is offline; it clones once it's online |
| 待主人确认 (Waiting for the owner) | Waiting for the Bot owner to choose a workspace; see below |
| 已暂停 · 无权限 / 网络或证书 / 超时 (Paused · no permission / network or certificate / timed out) | The machine can't access the repository; see [Bot paused](#bot-paused) |
| A local directory path | A directory that already exists on the machine is used |

Click 「工作区…」 (Workspaces…) to open 「某某 的工作区」 (X's workspace), which lists every directory this Bot uses in the group: the main repository (or main directory), each additional repository, and its own additional directories. Only the Bot owner can change them; changes take effect from the next turn and start a new session.

### Which directory is used on joining

| Situation | The Bot's workspace |
| --- | --- |
| Repository bound, Bot owner's machine online | First 「待主人确认」 (Waiting for the owner): the group shows 「等待 某某 确认工作区：自动克隆或使用本机已有目录」 ("waiting for X to choose a workspace: an automatic clone or an existing local one"), and the Bot starts working once the owner chooses |
| Repository bound, machine offline | Managed workspace, cloned automatically once the machine is online |
| No repository, Bot has a default workspace | The default workspace; the group shows 「使用默认工作区 …（主人可改绑）」 ("using the default workspace … (the owner can rebind it)") |
| No repository and no default workspace | A managed directory; the first @ runs right away |
| Someone else in a direct chat with a Bot shared with them | A separate managed workspace that doesn't touch the owner's directories |

If you @ the Bot while it's waiting, the group shows 「某某 等待 某某 确认工作区，本次未执行；确认后重新发起即可」 ("X is waiting for Y to choose a workspace, so this was not run; ask again once it is chosen"). The Bot owner clicks 「确认工作区」 (Choose workspace) on the notice bar in the group, or 「选择工作区…」 (Choose workspace…) on the Bot page.

### Managed workspace

A managed workspace is a directory Gonggong Space creates on the machine just for this group and this Bot, with a path like:

```text
~/gonggong/workspaces/<群名>/<Bot 名>/<仓库名>/
```

(`<群名>` is the group name, `<Bot 名>` the Bot name, and `<仓库名>` the repository name.)

- Names are fixed at creation; renaming the group or Bot later doesn't move the directory. Duplicate names get `-2` appended. Without a bound repository, the last level is `_empty`.
- Machines running in Docker use `/home/gg/gonggong/workspaces/`.
- Clones that older versions kept under `~/.gonggong/workspaces/` are moved over automatically the next time this Bot runs or is bound and no task is using them; uncommitted changes, branches, and stashes are kept. The first run after the move starts a new session.

### Change the workspace

The Bot owner has three entry points: 「更换工作区…」 (Change workspace…) in this Bot's workspace menu on the Bot bar in the group header, 「更改…」 (Change…) on the main repository in the 「工作区…」 (Workspaces…) dialog, and the button on the notice bar in the group. All of them open 「为 某某 选择工作区」 (Choose a workspace for X):

![Choose a workspace](/screenshots/web/workspace-picker.webp)

- 「使用本机已有的仓库目录」 (Use the existing repo folder on this machine), no cloning needed: listed when the machine already has a clone of this repository.
- 「自动克隆群仓库」 (Automatic clone of the group repo, recommended): automatically clones into a dedicated directory on the machine, so Bots don't interfere with each other.
- 「使用默认工作区」 (Use the default workspace): the default directory set in the Bot's settings.
- 「使用托管目录」 (Use a managed directory): shown when no repository is bound; a directory Gonggong Space creates on the machine just for this conversation, without touching your existing files.
- Or browse the machine's directories below, go into a specific project, and click 「选择此目录」 (Choose this folder).

If the chosen directory isn't the group repository, you'll see 「该目录不是群仓库」 (This folder is not the group repo), explaining that the group's base branch and automatic clone no longer apply to this Bot and that this affects only this Bot. It takes effect after you confirm 「仍然使用」 (Use anyway).

You can't change it while the machine is offline (「机器离线，上线后可更改」, "Machine offline; can be changed once online").

### Additional repositories and directories

In the 「某某 的工作区」 (X's workspace) dialog, the Bot owner can also:

- Additional repositories: click 「改用本机目录…」 (Use a local directory…) to pick this repository's clone on the machine; click 「改回自动克隆」 (Back to automatic clone) to revert. Each additional repository shows its branch, ahead / behind counts, and uncommitted status.
- 「添加目录…」 (Add directory…): let the Bot use other directories on the machine as well, up to 10. Click 「−」 to remove one.
- In a partition-mode group without a bound repository, an additional directory can be set with 「设为主工作区」 (Make main workspace).

### Directory picker

Picking a directory opens a browser of the machine's directories:

- The left side has 「位置」 (Location) shortcuts (Desktop, Documents, Downloads, etc.), 「隐藏文件夹」 (Hidden folders), and 「最近使用」 (Recents); you can check 「显示隐藏文件夹」 (Show hidden folders).
- You can search, sort by name or modified time, or click 「新建文件夹」 (New folder). On Windows machines you can switch drives.
- Git repositories show their current branch and remote.

These directories can't be chosen:

- Workspaces managed by Gonggong Space: 「这是共工按群托管的工作区，原群删除 Bot 或清理空间时会被删掉。请把仓库克隆到其他目录（如 ~/code）再选择。」 ("This is a workspace Gonggong Space manages for one group: it is deleted when that group's Bot is removed or storage is cleaned up. Clone the repository somewhere else (e.g. ~/code) and pick it there.")
- The root or home directory: 「目录范围过大，请选择具体的项目目录」 ("Directory is too broad; choose a specific project directory").
- System directories: 「不能使用系统目录」 ("System directories can't be used").

::: tip Two Bots in the same directory
When two Bots' workspaces point to the same real directory and both need to run at once, a question card appears in the group asking you to choose 「并行开始」 (Start in parallel) or 「排队等待」 (Queue). Running in parallel is fine when their changes don't overlap; if they edit the same file, they'll overwrite each other.
:::

## Bot paused

When a machine can't access the repository, a notice bar appears in the group, such as 「某某 已暂停：所在机器无法访问仓库（无权限或仓库不存在），在这台机器的「Git 访问」里配置后重新检查」 ("X is paused: its machine can't reach the repo (no permission or the repository doesn't exist). Set it up in that machine's Git access, then recheck"). @-mentioning it then doesn't run anything; the group shows 「…本次未执行；某某 配置后点「重新检查」」 ("…so this was not run; X can fix it and click Recheck"), and the owner also gets a 「Bot 无法访问仓库」 (Bot cannot reach the repo) notification.

1. The Bot owner clicks 「去配置」 (Set up) on the notice bar and configures an SSH key or HTTPS token in that machine's 「Git 访问」 (Git access).
2. The Bot owner or a group admin clicks 「重新检查」 (Recheck), and the machine clones again.

## Groups without a bound repository

In groups without a bound repository and in direct chats, a Bot uses the 「默认工作区」 (Default workspace) its owner set in the Bot's settings. If there's no default workspace, or it's unavailable, the Bot uses a managed directory instead, and the first @ runs right away. The directory doesn't have to be a git repository.

The Bot owner can switch to another directory at any time with 「更换工作区…」 (Change workspace…).

## Git bar

On the Bot bar in the group header, each Bot shows its workspace's branch, commits behind (↓N) / ahead (↑N), and uncommitted changes; when there are uncommitted changes, click the added/removed line counts to jump straight to code review.

![Git bar in the group header](/screenshots/web/gitbar.webp)

Each Bot's workspace menu has 「查看改动」 (View changes), 「浏览文件」 (Browse files), 「更换工作区…」 (Change workspace…, Bot owner only), and 「Git 面板」 (Git panel). For committing, pushing, switching branches, and more, see [Git](/en/user/git); for viewing changes and files, see [Diffs and files](/en/user/diff-files); for context usage, see [Context usage and compaction](/en/user/chat#context-usage-and-compaction).

## Bind a local directory with /cd

Besides 「更换工作区…」 (Change workspace…) in the UI, a Bot owner can also use `/cd` in the group:

```text
/cd @后端助手 /Users/wanglei/code/todo-app
/cd @后端助手 --reset
```

- Only the Bot owner can use it, and only in partition mode. The path must be an absolute path on the Bot's machine, and the Bot must be online.
- If the path is a clone of one of the additional repositories, it's used as that additional repository's local directory; otherwise it replaces the main workspace.
- `--reset` goes back to the managed workspace.
- The group shows 「已请求 某某 绑定到 …，等待本机校验…」 ("Asked X to bind to …, waiting for its machine to check…") followed by 「✓ 某某 已绑定到 …（本机目录）」 ("✓ X is bound to … (local directory)").

For the full syntax, see [Command reference](/en/user/commands#cd). On the machine, you can also switch back to managed with `gg workspaces --reset-cd <群>/<Bot>` (group/Bot).

## Sync mode

「群设置 → 仓库与同步 → 同步模式」 (Group settings → Repos & sync → Sync mode):

| Mode | Description |
| --- | --- |
| 分区模式 (Partition mode, default) | Each Bot works independently in its own workspace with no syncing. When you need to merge, have the Bots commit a branch, push, or open a PR following your team's git workflow |
| 强制同步 (Force sync) | Participating Bots' workspaces stay identical: after each turn, changes are distributed to the other Bots automatically (`.git` isn't synced) |

- Only group admins can switch, and force sync is available only after a repository is bound.
- When you click 「切换为强制同步」 (Switch to force sync), you pick a 「基准 Bot」 (Base Bot): its current workspace files (including uncommitted changes) become the first version, and the other Bots' workspaces are aligned to it. The dialog lists how each Bot will be handled; for example, Bots using a local directory or with uncommitted changes are 「不参与」 (Not participating). Alignment overwrites workspaces; overwritten files are backed up on the machine first.
- In a force-sync group, the group settings sidebar gains a 「同步状态」 (Sync status) row showing the current version and how many Bots are in sync. Additional repositories and additional directories aren't synced.
- 「切回分区模式」 (Switch back to partition mode) stops syncing; each Bot keeps its current files and continues on its own. The server archive is kept for 30 days.

## Workspace cleanup

When a Bot is removed from a group, a group is disbanded, or a Bot is deleted, its workspace is **not deleted automatically**. The Bot owner decides.

On the web: in 「机器与 Bot」 (Machines & Bots), open this machine's 「工作区」 (Workspace) page to see workspace usage and clean up; see [My machines and Bots](/en/user/machines).

On the Bot's machine:

```bash
gg workspaces
```

Each row shows 「群 × Bot」 (group × Bot), the type (托管 / 托管 · 无仓库 / 本机目录: managed / managed · no repo / local directory), the path, and the status:

| Status | Meaning |
| --- | --- |
| 运行中 (Running) | In use right now |
| 空闲 (Idle) | In use, but nothing is running |
| 已移出 · 大小 (Removed · size) | The Bot was removed or deleted, or the group was disbanded |
| 未使用 · 大小 (Unused · size) | The group and Bot still exist, but the Bot has switched to another directory |

To delete a managed workspace you no longer need:

```bash
gg workspaces --delete <群>/<Bot>
```

- `<群>` (group) and `<Bot>` can be IDs or names; only managed workspaces marked "removed" or "unused" can be deleted.
- Local directories are never deleted.
- You can also do this on the 「工作区」 (Workspaces) page of the Gonggong Space desktop app; see [Desktop app pages](/en/desktop/pages).

::: tip
When a machine's binding is revoked, the daemon cleans up all managed workspaces on that machine; local directories and backups are kept.
:::

For the command's full options, see [CLI reference](/en/cli/reference).

## Related pages

- [Groups and direct chats](/en/user/groups)
- [Git](/en/user/git)
- [My machines and Bots](/en/user/machines)
- [Diffs and files](/en/user/diff-files)
- [Command reference](/en/user/commands)
