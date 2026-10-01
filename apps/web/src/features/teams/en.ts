export default {
  // Switcher
  切换团队: 'Switch team',
  '切换团队，当前：{name}': 'Switch team, current: {name}',
  其他团队有未读: 'Unread in other teams',
  团队设置: 'Team settings',
  新建团队: 'New team',
  加入团队: 'Join team',
  '你将成为团队所有者，可邀请成员加入。': "You'll own the team and can invite members.",
  团队名称: 'Team name',
  '粘贴团队管理员发给你的邀请链接。': 'Paste the invite link your team admin sent you.',
  邀请链接: 'Invite link',
  下一步: 'Next',

  // Roles
  所有者: 'Owner',
  管理员: 'Admin',
  '成员#role': 'Member',

  // Settings · overview
  邀请: 'Invites',
  头像: 'Avatar',
  '一个字或表情，留空用团队名首字': "One character or emoji; empty uses the team name's initial",
  我的角色: 'My role',
  退出团队: 'Leave team',
  归档团队: 'Archive team',
  '退出团队「{name}」？': 'Leave "{name}"?',
  '退出后无法再看到该团队的群和 Bot，需重新受邀才能加入。':
    "You'll no longer see the team's groups and Bots, and need a new invite to rejoin.",
  '你在该团队的 Bot 将被删除并移出所有群': 'Your Bots in this team are deleted and removed from all groups',
  你将退出该团队的所有群: "You'll leave all of the team's groups",
  已退出团队: 'Left the team',
  '归档团队「{name}」？': 'Archive "{name}"?',
  '归档后所有成员都无法再进入该团队。': 'Once archived, no member can enter the team.',
  '该团队的群转为只读，运行中的轮次将停止': "The team's groups become read-only and running turns stop",
  成员的团队列表中不再显示该团队: "The team no longer shows in members' team lists",
  团队已归档: 'Team archived',

  // Settings · members
  输入账号添加成员: 'Add a member by account',
  '管理#member': 'Manage',
  '设为{role}': 'Make {role}',
  转让所有权: 'Transfer ownership',
  移出团队: 'Remove from team',
  '移出成员时，其在本团队的 Bot 一并删除，并退出本团队所有群。':
    "Removing a member deletes their Bots in this team and takes them out of all the team's groups.",
  '将 {name} 移出团队？': 'Remove {name} from the team?',
  '移出后对方无法再看到该团队的群和 Bot。': "They'll no longer see the team's groups and Bots.",
  '其在本团队的 Bot 将被删除并移出所有群': 'Their Bots in this team are deleted and removed from all groups',
  其将退出本团队的所有群: "They'll leave all of the team's groups",
  已移出团队: 'Removed from the team',
  '将团队所有权转让给 {name}？': 'Transfer team ownership to {name}?',
  '转让后你将成为管理员。': "You'll become an admin.",
  '对方成为所有者，可归档团队、转让所有权':
    'They become the owner and can archive the team or transfer ownership',
  所有权已转让: 'Ownership transferred',

  // Settings · invites
  加入后角色: 'Role on joining',
  可用次数: 'Uses',
  '1 次': 'Once',
  '10 次': '10 times',
  不限: 'Unlimited',
  生成邀请链接: 'Create invite link',
  已复制邀请链接: 'Invite link copied',
  链接只在生成时显示一次: 'The link is shown only once, right after creating it',
  '{role} · 已用 {uses}': '{role} · used {uses}',
  已用完: 'Used up',
  '{until} 前有效': 'Valid until {until}',
  撤销: 'Revoke',

  // Join & welcome
  '加入「{team}」': 'Join "{team}"',
  '{inviter} 邀请你加入团队「{team}」。': '{inviter} invited you to the team "{team}".',
  '正在读取邀请…': 'Reading the invite…',
  邀请链接已失效: 'This invite link has expired',
  '请联系团队管理员重新邀请。': 'Ask a team admin for a new invite.',
  '加入中…': 'Joining…',
  已加入: 'Joined',
  登录后加入: 'Log in to join',
  注册并加入: 'Sign up and join',
  '你还没有加入任何团队。粘贴团队管理员发给你的邀请链接即可加入。':
    "You're not in any team yet. Paste the invite link your team admin sent you to join.",
  进入管理后台: 'Open the admin console',
  '对本团队所有群生效；与平台层同名时以团队层为准，群管理员可在群设置中再覆盖。':
    'Applies to every group of the team; replaces a same-named platform server, and group admins may override it in group settings.',
  '继承平台值 {value}': 'Inherits the platform value {value}',
  恢复继承: 'Inherit',
  '{name}：恢复继承': '{name}: inherit',
  团队参数已保存: 'Team parameters saved',
  '留空沿用平台默认值；群管理员可在群设置中再调整群级参数。保存后对新会话生效。':
    'Empty fields use the platform defaults; group admins can still adjust group-level params in group settings. Applies to new sessions after saving.',
  '{members} 位成员 · {bots} 个 Bot': '{members} {members:member|members} · {bots} {bots:Bot|Bots}',
  查看成员: 'View members',
  查看: 'View',
  进群并成为管理员: 'Join as group admin',
  '进群并成为「{name}」的群管理员？': 'Join "{name}" as its group admin?',
  '群由群管理员管理。你将以团队管理员身份加入该群并成为群管理员。':
    'Groups are managed by their group admins. You will join this group as team admin and become a group admin.',
  群内会显示一条加入记录: 'The group shows that you joined',
  操作写入团队审计: 'The action is recorded in the team audit',
  已进群并成为群管理员: 'Joined as group admin',
  '你正以团队管理员身份查看此群，不能发言或管理。':
    'You are viewing this group as team admin and cannot post or manage it.',
  只读查看: 'Read-only',
  团队里还没有群: 'The team has no groups yet',
  '「{name}」的成员': 'Members of "{name}"',
  审计: 'Audit',
}
