# Diffs and files

This page covers how to see what code a Bot changed (the diff panel), the Git bar in the group header, and browsing workspace files and message attachments in the file viewer. For commits, branches, and other Git operations, see [Git management](/en/user/git).

All of these open as tabs in the **workbench** on the right. For the workbench layout and shortcuts, see [Previews](/en/user/previews#preview-workbench).

## Git bar

In a group with a bound repository or a workspace, the area below the group header shows one row for each Bot:

![Git bar in the group header](/screenshots/web/gitbar.webp)

| Item | Description |
| --- | --- |
| Branch | The current branch; a detached HEAD shows 「提交哈希（游离）」 ("commit hash (detached)"); with sub-repositories, 「N 个子仓库」 ("N sub-repos") or 「N 个子仓库有改动」 ("N sub-repos changed") is appended. Click to open the [Git panel](/en/user/git) |
| ↓N / ↑N | Commits behind / ahead of upstream |
| +N −M | Lines added and deleted in uncommitted changes (shows 「未提交」 (Uncommitted) when only binary files changed); click to review the changes in the Git panel |
| 合并中 (Merging) / N 个冲突 (N conflicts) | Shown when a merge, rebase, or similar operation is in progress or there are conflicts; click to resolve |
| 待审批 N (N to review) | Git operations requested by members are waiting for the Bot owner's approval |
| Workspace menu | See below |

While the workspace isn't ready yet, it shows 「待绑定」 (Pending binding), 「待主人确认」 (Waiting for the owner), 「待创建」 (Pending), 「clone 中…」 (Cloning…), or 「工作区创建失败」 (Workspace setup failed); see [Repositories and workspaces](/en/user/repos-workspaces).

Click the workspace button at the end of a row to open the workspace menu:

- At the top is where it runs: machine, directory (copyable), repository, base branch, and additional directories; when not on the base branch, it notes 「当前在 某分支」 ("now on some-branch").
- 「查看改动」 (View changes): opens the diff panel; see below.
- 「浏览文件」 (Browse files): opens the file viewer; see below.
- 「更换工作区…」 (Change workspace…): visible only to the Bot owner; see [Repositories and workspaces](/en/user/repos-workspaces).
- 「Git 面板」 (Git panel): opens this Bot's Git panel.

When there are many Bots, only the first few are listed; click 「更多工作区」 (More workspaces) to show the rest.

## Diff panel

### How to open it

- 「改动 N 个文件」 ("N files changed") on a run card, or the file chips or 「+N」 below a reply: opens this turn's changes.
- Clicking a file-edit step in the run details: goes straight to that file's changes.
- 「查看改动」 (View changes) in the workspace menu: opens the tab 「改动 · Bot 名」 ("Changes · Bot name").

![Diff panel](/screenshots/web/diff-pane.webp)

### Change scope

Switch with 「改动范围」 (Change scope) at the top of the panel:

| Scope | Contents |
| --- | --- |
| 本轮 (This turn) | Files changed by this run (only when opened from a run) |
| 未提交 (Uncommitted) | All uncommitted changes in the workspace |
| 对比主分支 (Against main) | All changes on the current branch relative to the base branch |

When opened from the workspace menu, it defaults to 「未提交」 (Uncommitted) if the workspace has uncommitted changes, and 「对比主分支」 (Against main) otherwise. While a run is in progress, the changes refresh automatically.

With no changes, it shows 「本轮没有文件改动」 ("No file changes this turn"), 「没有未提交的改动」 ("No uncommitted changes"), 「某分支 相对 基准分支 没有改动」 ("branch has no changes against base"), or 「当前就在主分支，没有可对比的改动」 ("Already on the main branch; nothing to compare").

### File list

- Each file shows its name, directory, lines added and deleted, and a bar showing the add/delete ratio (hover to see 「新增 N 行，删除 M 行」, "N lines added, M lines deleted").
- The button above the list switches between 「以列表显示」 (Show as list) and 「以目录树显示」 (Show as tree); your choice is remembered.
- When the workspace has sub-repositories or additional directories, files are grouped by repository, showing 「根仓库」 (Root repo), the repository path, or 「附加目录」 (Extra directories) with their file counts; repositories truncated because of too many changes are marked 「已截断」 (Truncated).
- 「在文件浏览器中定位」 (Show in file browser) next to each file jumps to a file tab showing the whole file.
- When the panel is narrow, the file list collapses into a 「N 个文件」 ("N files") dropdown.

### Viewing the diff

On the right is a diff view with syntax highlighting; the toolbar offers:

| Control | Effect |
| --- | --- |
| 差异视图 (Diff view) | 「统一」 (Unified, top-and-bottom) or 「并排」 (Side by side, left-and-right; available when the panel is wide enough) |
| 空白处理 (Whitespace) | 「不忽略」 (Do not ignore), 「去掉首尾空白」 (Trim whitespace), 「忽略空白」 (Ignore whitespace), 「忽略空白和空行」 (Ignore whitespace and empty lines) |
| 高亮方式 (Highlighting) | 「按词高亮」 (Highlight words), 「按字符高亮」 (Highlight characters), 「只高亮行」 (Highlight lines), 「不高亮」 (Do not highlight) |
| 显示完整文件 (Show full file) | Don't collapse unchanged content |
| 上一处改动 / 下一处改动 (Previous change / Next change) | Shortcuts ⇧F7 / F7; at either end, press once more to go to the previous / next file |
| 上一个文件 / 下一个文件 (Previous file / Next file) | Shortcuts ⌥⇧← / ⌥⇧→ |

When the panel is narrow, whitespace, highlighting, and similar controls move into the 「差异选项」 (Diff options) menu.

- Long stretches of unchanged content collapse into 「展开 N 行未改动的内容」 ("Show N unchanged lines"); you can also 「全部展开」 (Expand all).
- Click a line number or press F4 to 「跳到源文件」 (Jump to source), opening that line in the file viewer.
- Binary files show 「二进制文件，无法显示差异」 ("Binary file; the diff can't be shown"); very large diffs show 「差异过大，已截断」 ("Diff too large; truncated").

In the 「未提交」 (Uncommitted) scope, each change has 「回滚此处改动」 (Roll back this change), which reverts just that change; after rolling back, you can click 「撤销」 (Undo) in the notice. When someone other than the Bot owner rolls back, a request is submitted first and runs only after the Bot owner approves; see [Git management](/en/user/git#who-can-do-what).

## File viewer

Click 「浏览文件」 (Browse files) in the workspace menu to open the tab 「文件 · Bot 名」 ("Files · Bot name") and browse the files in this Bot's workspace, read-only.

![File viewer](/screenshots/web/file-viewer.webp)

### File tree

- Directories come first, then files; contents load when you expand a directory.
- Files with uncommitted changes are marked 「M」.
- Check 「显示忽略的」 (Show ignored) to show files ignored by git.
- 「搜索文件」 (Search files) finds files by name; 「刷新」 (Refresh) re-reads the tree.
- The breadcrumb at the top starts at 「工作区」 (Workspace); click it to jump back up quickly.
- If a directory has more than 1,000 entries, only the first 1,000 are shown.
- The selected file is highlighted and scrolled into view automatically.

On wide screens, click 「收起目录」 (Hide folders) in the toolbar to hide the file tree and see the file content in full; click 「展开目录」 (Show folders) to bring it back. On narrow screens, the open file tree covers the file content.

### Viewing files

| File type | How it's shown |
| --- | --- |
| Code and text | Line numbers + syntax highlighting, with optional 「自动换行」 (Wrap lines); in logs such as `.log` and `.txt`, lines containing ERROR / FAIL / WARN are colored; `.csv` and `.tsv` are shown as text |
| HTML | Shows the source |
| Markdown | Switch between 「预览」 (Preview) and 「源码」 (Source); long documents have an 「大纲」 (Outline) |
| Images | Switch between 「适应」 (Fit) and 「原始大小（1:1）」 (Actual size (1:1)), with dimensions shown; can be viewed full screen |
| PDF | Shown in the page; if it loads slowly, you can 「在浏览器中打开」 (Open in browser) |
| Word, Excel, PowerPoint | `.docx`, `.xlsx`, and `.pptx` are previewed in the page, and spreadsheets let you switch worksheets; up to 30 MB |
| Video | Played with the built-in player; see below |
| Audio | Played with a voice-message-style player |
| Binary or unsupported types | A prompt to download it |

The toolbar also has:

- 「复制路径」 (Copy path): copies the file's path within the workspace; 「复制全文」 (Copy all text).
- 「下载」 (Download) and 「在新标签页打开」 (Open in new tab).
- 「在聊天中引用」 (Cite in chat): fills `@file path` into the input box, so you can have a Bot work on this file.
- Previous / next file: switches between files in the same directory; you can also press ← / →.

In code files:

- Click a line number to copy a reference with the line number (e.g. `src/app.ts:12`); Shift-click another line to select a range.
- Lines with uncommitted changes are marked as added, modified, or deleted next to the line number; click the marker to 「显示差异」 (Show diff) or 「回滚」 (Rollback) that change.
- 「注解（Git Blame）」 (Annotate (Git Blame)): shows the commit, author, and time that last changed each line next to it; click a commit to see its details, or use 「注解上一修订」 (Annotate previous revision) to trace further back.

::: warning Size limits
Text files larger than 2 MB aren't previewed and can only be downloaded; text files show at most the first 5,000 lines.
:::

### Video player

The file viewer and video attachments in chat use the same player:

![Video player](/screenshots/web/video-player.webp)

- A big play button, a draggable progress bar (showing the buffered portion, with the time on hover), and skip back / forward 10 seconds.
- Volume and mute (remembered across players), 「倍速」 (Speed) 0.5–2×, picture in picture, and full screen.
- While playing, the controls and cursor hide automatically after the mouse stays still for a moment; on touch screens, tap once first to bring up the controls.
- Only one video plays at a time on a page.

When the player has focus, these shortcuts work:

| Key | Effect |
| --- | --- |
| Space / K | Play / pause |
| ← / → | Back / forward 5 seconds |
| J / L | Back / forward 10 seconds |
| Home / End | Jump to start / end |
| ↑ / ↓ | Adjust volume |
| M | Mute |
| F | Full screen |
| 0–9 | Jump to 0%–90% |
| Shift + < / > | Slow down / speed up playback |

## Attachment viewer

Click 「在工作台查看」 (Open in workbench) on an attachment in a message to open a tab named after the file in the workbench. It works the same way as the file viewer, and additionally shows:

| Item | Description |
| --- | --- |
| 来源 (Source) | Who sent it, and in which message |
| 大小 (Size) | File size |
| 位置 (Location) | The path in the Bot's workspace (`.gonggong/attachments/…`) |
| 发送给 Bot (Sent to Bot) | Images: sent directly if the Agent supports images, and also saved to disk to be read by path. Videos and audio: not sent directly; the Agent reads them by path |
| 工作树 (Working tree) | Other files: added to `.git/info/exclude`, so they don't go into git |

For uploading attachments and their limits, see [Directing Bots in a group](/en/user/chat).

## Related pages

- [Git management](/en/user/git)
- [Runs](/en/user/runs)
- [Repositories and workspaces](/en/user/repos-workspaces)
- [Previews](/en/user/previews)
