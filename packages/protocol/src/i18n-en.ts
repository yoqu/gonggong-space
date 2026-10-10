/** English for protocol-level texts shared by server and clients: group event messages, notifications, labels. */
export const protocolEn = {
  // Group events
  '{user} 创建了私聊 · 仅你和你的 Bot': '{user} started a direct chat · only you and your Bots',
  '{user} 创建了群 · 成为群管理员': '{user} created the group · now group admin',
  '{user} 创建了群 · 成为群管理员 · 邀请 {invited}':
    '{user} created the group · now group admin · invited {invited}',
  '群绑定仓库 {url} · 基准分支 {branch} · 分区模式':
    'Group bound to repo {url} · base branch {branch} · partition mode',
  '群更换仓库 {url} · 基准分支 {branch} · 各 Bot 重建托管工作区':
    'Group switched to repo {url} · base branch {branch} · Bots are rebuilding managed workspaces',
  '未绑定仓库 · 各 Bot 使用主人绑定的目录，仅分区模式':
    "No repo bound · each Bot uses its owner's directory, partition mode only",
  '{user} 邀请 {member} 加入群': '{user} invited {member} to the group',
  '{user} 将 {member} 移出群': '{user} removed {member} from the group',
  '{member} 随飞书群加入群': '{member} joined along with the Feishu chat',
  '{member} 已退出飞书群，移出群': '{member} left the Feishu chat and was removed from the group',
  '未能将 {member} 拉入飞书群：{reason}': 'Could not add {member} to the Feishu chat: {reason}',
  '{owner} 作为 {bot} 的主人一并加入群': "{owner} joined the group as {bot}'s owner",
  '{bot} 被移出 · 工作区保留': '{bot} was removed · workspace kept',
  '{bot} 被移出 · {user} 的账号已停用': "{bot} was removed · {user}'s account was disabled",
  '{user} 将同步模式切换为强制同步，基准 Bot：{bot}':
    '{user} switched the group to force sync, base Bot: {bot}',
  '{user} 将同步模式切回分区模式，各 Bot 保留当前文件':
    '{user} switched the group back to partition mode, each Bot keeps its current files',
  '切换为强制同步失败，仍为分区模式：{reason}':
    'Switching to force sync failed, still in partition mode: {reason}',
  '基准 Bot 未能在 10 分钟内完成首版，已退回分区模式':
    'The base Bot did not submit the first version within 10 minutes, back to partition mode',
  '基准 Bot 已离开群': 'the base Bot left the group',
  '基准 Bot 所在机器离线超过 10 分钟': "the base Bot's machine has been offline for over 10 minutes",
  '{user} 修改了名称': '{user} changed the name',
  '{user} 修改了群名称与公告': '{user} changed the group name and notice',
  '{user} 开启了「仅群管理员可拉人」': '{user} turned on “Only admins can invite”',
  '{user} 关闭了「仅群管理员可拉人」': '{user} turned off “Only admins can invite”',
  '{user} 移除了群公告': '{user} removed the group notice',
  '{user} 将 {member} 设为群管理员': '{user} made {member} a group admin',
  '{user} 取消了 {member} 的群管理员': '{user} revoked group admin from {member}',
  '{user} 退出了群': '{user} left the group',
  '{user} 退出了团队': '{user} left the team',
  '{user} 被移出团队': '{user} was removed from the team',
  '{member} 接任群管理员': '{member} took over as group admin',
  '{user} 以团队管理员身份加入并成为群管理员': '{user} joined as team admin and is now group admin',
  '{user} 以团队管理员身份成为群管理员': '{user} is now group admin as team admin',
  '{user} 将 {bot} 在本群的档位设为「{tier}」': '{user} set the tier of {bot} in this group to "{tier}"',
  '{user} 将 {bot} 在本群的档位恢复为跟随全局（{tier}）':
    '{user} reset the tier of {bot} in this group to follow the global setting ({tier})',
  '{user} 将 {bot} 在本群的模型设为 {model}': '{user} set the model of {bot} in this group to {model}',
  '{user} 将 {bot} 在本群的模型设为 {model} · {effort}':
    '{user} set the model of {bot} in this group to {model} · {effort}',
  '{user} 将 {bot} 在本群的模型恢复为跟随 Bot 默认':
    "{user} reset the model of {bot} in this group to follow the Bot's default",
  '{user} /stop · 停止 {bots} 的 {n} 个轮次{chain}':
    '{user} /stop · stopped {n} {n:turn|turns} of {bots}{chain}',
  '{user} /stop · 未 @ Bot，停止本群全部 {n} 个轮次{chain}':
    '{user} /stop · no Bot mentioned, stopped all {n} {n:turn|turns} in this group{chain}',
  '（含接力链，整条链终止）': ' (including relays; the whole chain was ended)',
  没有运行中的轮次: 'No turns are running',
  '/new 需要同时 @ 一个 Bot，如 /new @{bot}': '/new needs a Bot mention, e.g. /new @{bot}',
  '{bot} 下一轮将开新会话': '{bot} will start a new session next turn',
  '/cd 仅分区模式可用；强制同步群里非托管工作区的 Bot 为「不参与」':
    '/cd is only available in partition mode; in force-sync groups, Bots without a managed workspace sit out',
  '/cd 需要 @ 一个 Bot，如 /cd @{bot} /本机/绝对路径，或 /cd @{bot} --reset 回到托管':
    '/cd needs one Bot mention, e.g. /cd @{bot} /absolute/local/path, or /cd @{bot} --reset to go back to managed',
  '只有 Bot 主人可以使用 /cd': "Only the Bot's owner can use /cd",
  '/cd 需要本机绝对路径，如 /Users/me/code/repo':
    '/cd needs an absolute local path, e.g. /Users/me/code/repo',
  '{bot} 离线，无法执行 /cd': '{bot} is offline and cannot run /cd',
  '{bot} 绑定工作区失败：{error}': '{bot} failed to bind the workspace: {error}',
  '✓ {bot} 已使用托管工作区': '✓ {bot} now uses the managed workspace',
  '✓ {bot} 已绑定到 {path}（本机目录）': '✓ {bot} is bound to {path} (local directory)',
  '已请求 {bot} 使用托管工作区，等待本机确认…':
    'Asked {bot} to use the managed workspace, waiting for its machine to confirm…',
  '已请求 {bot} 绑定到 {path}，等待本机校验…':
    'Asked {bot} to bind to {path}, waiting for its machine to check…',
  '{bot} 加入': '{bot} joined',
  '{bot} · 使用托管工作区，等待本机克隆…':
    '{bot} · using a managed workspace, waiting for its machine to clone…',
  '{bot} · daemon 离线，上线后克隆托管工作区':
    '{bot} · daemon offline, the managed workspace will be cloned once it is back',
  '{bot} · 等待 {owner} 绑定工作区': '{bot} · waiting for {owner} to bind a workspace',
  '{bot} · daemon 离线，上线后使用默认工作区':
    '{bot} · daemon offline, the default workspace will be used once it is back',
  '{bot} 默认工作区不可用：{error}，等待 {owner} 绑定工作区':
    '{bot} default workspace unavailable: {error}; waiting for {owner} to bind a workspace',
  '{bot} · 使用默认工作区 {path}（主人可改绑）':
    '{bot} · using the default workspace {path} (the owner can rebind it)',
  '{bot} · daemon 已 clone 到托管工作区': '{bot} · daemon cloned into the managed workspace',
  '{bot} 工作区创建失败：{error}': '{bot} failed to create the workspace: {error}',
  '{bot} 还没有工作区，本次未执行；{owner} 绑定工作区后重新发起即可':
    '{bot} has no workspace yet, so this was not run; ask again after {owner} binds one',
  '{bot} 所在机器无法访问仓库（{reason}），本次未执行；{owner} 配置后点「重新检查」':
    '{bot}\'s machine cannot reach the repo ({reason}), so this was not run; {owner} can fix it and click "Recheck"',
  '丢弃本轮改动失败：{error}': 'Failed to discard the changes of this turn: {error}',
  未知错误: 'Unknown error',
  'Bot 离线': 'Bot offline',

  // Run steps
  'Bot 离线，等待上线': 'Bot offline, waiting for it to come online',
  工作区准备中: 'Preparing the workspace',
  等待切换为强制同步: 'Waiting for the switch to force sync',
  等待同步对齐: 'Waiting for the workspace to align with force sync',
  等待处理本地改动: 'Waiting for its local changes to be settled',
  等待处理同步冲突: 'Waiting for its sync conflict to be settled',
  '本群上一轮未结束，排第 {n}': 'Previous turn in this group still running, #{n} in line',
  '该 Bot 忙，排第 {n}': 'This Bot is busy, #{n} in line',
  'daemon 重启，本轮已中断': 'The daemon restarted, this turn was interrupted',
  '{user} 的账号已停用，本轮中断': "{user}'s account was disabled, this turn was interrupted",
  '触发消息已撤回，已作废': 'The triggering message was recalled, voided',
  '消息已编辑，已重新运行': 'Message edited, run again',
  '等待回答：{n} 个问题': 'Awaiting answers: {n} {n:question|questions}',
  '等待审批：{title}': 'Awaiting approval: {title}',
  '整条链已被 {user} /stop 终止': 'The whole relay was ended by {user} with /stop',
  '{user} 执行了 /stop': '{user} ran /stop',
  '{step} · 分区模式：已改的 {n} 个文件留在工作区，未提交':
    '{step} · partition mode: {n} changed {n:file stays|files stay} in the workspace, uncommitted',
  '{step} · 强制同步：已改的 {n} 个文件待处理，未提交':
    '{step} · force sync: {n} changed {n:file awaits|files await} a decision, not submitted',
  'Bot 离线超过 {n} 分钟，已作废并通知 {user}':
    'Bot offline for over {n} {n:minute|minutes}, voided and {user} was notified',
  'agent 异常：{error}': 'Agent error: {error}',
  'Bot 未绑定或未确认，不能被触发': "The Bot isn't bound or confirmed and can't be triggered",
  '该 Bot 仅允许主人触发，未启动运行': 'Only its owner can trigger this Bot, no run started',
  '该 Bot 仅允许指定名单触发，未启动运行': 'Only its allowlist can trigger this Bot, no run started',

  // Group list previews
  你撤回了一条消息: 'You recalled a message',
  '{user} 撤回了一条消息': '{user} recalled a message',

  // Tier labels
  只读: 'Read-only',
  工作区写入: 'Workspace write',
  完全访问: 'Full access',

  // Repo access reasons
  无权限或仓库不存在: 'no permission or the repo does not exist',
  分支不存在: 'branch does not exist',
  网络或证书问题: 'network or certificate problem',
  连接超时: 'connection timed out',

  // Notifications
  审批请求: 'Approval request',
  待审批: 'Pending approval',
  '{bot} 请求执行 {title}': '{bot} asks to run {title}',
  提问: 'Question',
  待回答: 'Awaiting answer',
  '{bot} 向你提了 {n} 个问题': '{bot} asked you {n} {n:question|questions}',
  'Bot 离线作废': 'Expired: Bot offline',
  '你 @{bot} 的请求等待 {n} 分钟未上线，已作废':
    'Your request to @{bot} expired after {n} {n:minute|minutes} waiting for it to come online',
  接力链结束: 'Relay finished',
  '{n} 跳完成': '{n} {n:hop|hops} completed',
  '{n} 跳 · 已被 /stop 中断': '{n} {n:hop|hops} · stopped by /stop',
  'Bot 无法访问仓库': 'Bot cannot reach the repo',
  '{bot} 所在机器无法访问 {repo}（{reason}），配置后在群里点「重新检查」':
    '{bot}\'s machine cannot reach {repo} ({reason}); fix it, then click "Recheck" in the group',
  '待确认 Bot': 'Bot to confirm',
  '{by} 为你创建了 {bot}，请确认绑定': '{by} created {bot} for you, please confirm the binding',

  // Agent config
  默认模型: 'Default model',
  关闭: 'Off',
  极低: 'Minimal',
  低: 'Low',
  中: 'Medium',
  高: 'High',
  超高: 'Extra high',
  最高: 'Max',

  // Messages
  该消息已撤回: 'This message was recalled',

  // Validation
  '请填写 Token': 'Enter a token',
  填写群名称: 'Enter a group name',
  'sha256 需为 64 位十六进制': 'sha256 must be 64 hex characters',
  '版本号需为 x.y.z': 'Version must be x.y.z',

  // System parameters
  会话恢复失败时补送群消息数: 'Group messages replayed when a session cannot resume',
  每轮随消息附带的群聊上下文: 'Group chat context sent with each turn',
  完整运行过程保留: 'Keep full run details for',
  预览无人访问后自动关闭: 'Close previews after no visits for',
  预览公开链接最长有效期: 'Longest validity of a public preview link',
  单个附件大小上限: 'Max size of one attachment',
  每条消息附件数: 'Attachments per message',
  提问卡片每张题数上限: 'Max questions per question card',
  机器心跳间隔: 'Machine heartbeat interval',
  '机器离线判定（连续未收到心跳）': 'Machine offline after (missed heartbeats in a row)',
  '服务器备份（每日）保留': 'Keep daily server backups for',
  删群后存档保留: 'Keep archives of deleted groups for',
  '权限审批等待 · 群默认': 'Approval wait · group default',
  '接力链长上限 · 群默认': 'Max relay length · group default',
  'Bot 离线时请求等待上线 · 群默认': 'Wait for an offline Bot · group default',
  'Bot 并发上限 · 新建默认': 'Bot concurrency limit · default for new Bots',
  秒: 'sec',
  条: 'messages',
  天: 'days',
  小时: 'hours',
  个: '',
  题: 'questions',
  次: 'times',
  分钟: 'min',
  跳: 'hops',
  // Scheduled tasks
  '仅一次 · {at}': 'Once · {at}',
  '每天 {time}': 'Every day at {time}',
  '每个工作日 {time}': 'Every weekday at {time}',
  '每{day} {time}': 'Every {day} at {time}',
  '每月 {d} 日 {time}': 'Monthly on day {d} at {time}',
  '每 {n} 分钟': 'Every {n} min',
  '每小时第 {m} 分': 'Every hour at minute {m}',
  '每 {n} 小时': 'Every {n} hours',
  'cron {expr}': 'cron {expr}',
  周日: 'Sunday',
  周一: 'Monday',
  周二: 'Tuesday',
  周三: 'Wednesday',
  周四: 'Thursday',
  周五: 'Friday',
  周六: 'Saturday',
  'cron 表达式无效': 'Invalid cron expression',
  '执行间隔不能小于 {n} 分钟': 'Runs must be at least {n} min apart',
  执行时间已过: 'That time has passed',
  '{who} 创建了定时任务「{name}」': '{who} created the scheduled task "{name}"',
  '定时任务「{name}」上次尚未结束，本次跳过':
    'Scheduled task "{name}": the last run is still going, skipped this time',
  '定时任务「{name}」的候选 Bot 都不可用（{bots}），本次跳过':
    'Scheduled task "{name}": no candidate Bot is available ({bots}), skipped this time',
  '定时任务「{name}」已停用：{reason}': 'Scheduled task "{name}" was turned off: {reason}',
  仅一次的任务已执行: 'it was a one-off and has run',
  '连续 {n} 次失败': 'it failed {n} times in a row',
  '候选 Bot 都已不在群内': 'none of its Bots is in the group any more',
  主人已不在群内: 'its owner left the group',
  '错过执行时间超过 24 小时': 'it missed its time by over 24 hours',
  定时任务已停用: 'Scheduled task turned off',
  本地有改动: 'Local changes',
  '{bot} 的工作区有 {n} 个文件被本地修改，强制同步已暂停，请提交或丢弃':
    "{n} {n:file|files} in {bot}'s workspace changed locally; force sync is paused until they are submitted or discarded",
  同步冲突: 'Sync conflict',
  '@{bot} 的改动与 v{version} 冲突：{n} 个文件':
    "@{bot}'s changes conflict with v{version}: {n} {n:file|files}",
  // Force sync failure reasons: the daemon's `reason!` templates (crates/gonggong) and the server's own
  '{path} 不是冲突文件': '{path} is not a conflicting file',
  '{path} 不能交给 Bot 合并': '{path} cannot be merged by the Bot',
  '{path} 与 {other} 只有大小写不同，在 macOS 与 Windows 上会冲突':
    '{path} and {other} differ only in case and clash on macOS and Windows',
  '{path} 在 Windows 上是非法文件名': "{path} isn't a valid file name on Windows",
  '{path} 是符号链接，不能同步': "{path} is a symbolic link and can't be synced",
  '{path} 有 {size} MB，超过单文件上限 {max} MB，请加入 .gitignore':
    '{path} is {size} MB, over the {max} MB per-file limit; add it to .gitignore',
  '{path} 的文件名不是 UTF-8 编码': "The name of {path} isn't UTF-8",
  '{path} 路径超过 260 个字符': '{path} is longer than 260 characters',
  '上传同步内容失败：{e}': "Couldn't upload sync content: {e}",
  '下载同步内容失败：{e}': "Couldn't download sync content: {e}",
  '同步提交被拒绝：与权威版本冲突': 'Sync submit rejected: it conflicts with the authoritative version',
  '同步提交被拒绝：基准版本无效': 'Sync submit rejected: its base version is invalid',
  '同步提交被拒绝：文件内容未上传完整': 'Sync submit rejected: not all file contents were uploaded',
  '同步提交被拒绝：该副本未参与强制同步':
    'Sync submit rejected: this replica does not take part in force sync',
  '同步提交被拒绝：超过单版体积上限': 'Sync submit rejected: over the per-version size limit',
  强制同步还没有版本: 'Force sync has no version yet',
  找不到待处理的同步冲突: 'No held sync conflict found',
  '找不到待处理的同步冲突，无法合并': 'No held sync conflict found; cannot merge',
  '无法读取 {path}：{e}': "Couldn't read {path}: {e}",
  无法连接服务器同步接口: "Can't reach the server's sync API",
  '本机同步状态丢失，正在重新对齐': 'This machine lost its sync state; realigning',
  '本版改动共 {size} MB，超过单版上限 {max} MB（最大的是 {path}），请把大文件加入 .gitignore':
    "This version's changes total {size} MB, over the {max} MB per-version limit (largest: {path}); add large files to .gitignore",
  '本版改动共 {n} 个文件，超过单版上限 {max} 个（最多的是 {path}），请把生成的文件加入 .gitignore':
    'This version changes {n} files, over the {max}-file per-version limit (most in {path}); add generated files to .gitignore',
  '本轮异常结束，改动未提交，待 Bot 主人处理':
    'The turn ended abnormally; its changes were not submitted and wait for the Bot owner',
  '疑似密钥文件 {path}，未被 git 跟踪，请加入 .gitignore 或移出工作区':
    "{path} looks like a secret file and isn't tracked by git; add it to .gitignore or move it out of the workspace",
  等待服务器确认同步提交超时: 'Timed out waiting for the server to confirm the sync submit',
  '副本内容与 v{version} 不一致': 'The replica does not match v{version}',
  'daemon 版本过旧，请升级': 'The daemon is too old to sync, please upgrade',
} satisfies Record<string, string>
export type ProtocolKey = keyof typeof protocolEn
