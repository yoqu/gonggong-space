export default {
  飞书: 'Feishu',
  连接中: 'Connecting',
  连接失败: 'Connection failed',
  未配置: 'Not configured',
  留空保持不变: 'Leave blank to keep',
  更换: 'Replace',
  '绑定#verb': 'Bind',
  飞书应用已保存: 'Feishu app saved',
  '确定移除飞书应用 {appId}？': 'Remove Feishu app {appId}?',
  '断开该应用的长连接，飞书里将无法再使用它':
    'Its long connection is closed and it can no longer be used in Feishu',
  飞书开发者后台中的应用不受影响: 'The app itself in the Feishu developer console is not affected',
  已移除飞书应用: 'Feishu app removed',
  主应用: 'Main app',
  凭证: 'Credentials',
  '在飞书开发者后台「凭证与基础信息」中获取；保存前会向飞书校验。':
    'Find them under Credentials & Basic Info in the Feishu developer console; they are checked with Feishu before saving.',
  移除主应用: 'Remove main app',
  飞书自动开户: 'Feishu auto sign-up',
  '开启后，本企业成员首次飞书登录可直接新建共工账号，不受「开放自助注册」限制。':
    'When on, members of your enterprise can create a Gonggong account on their first Feishu sign-in, regardless of open sign-up.',
  已开启飞书自动开户: 'Feishu auto sign-up turned on',
  已关闭飞书自动开户: 'Feishu auto sign-up turned off',
  '主应用负责飞书一键登录，并把成员发给 Bot 的消息同步到飞书；每个 Bot 的应用在 Bot 设置中绑定。':
    "The main app powers Feishu sign-in and mirrors members' messages to bots into Feishu; each bot's own app is bound in its settings.",
  飞书应用: 'Feishu app',
  '该 Bot 专属的飞书自建应用，用于在飞书群里被 @': "This bot's own Feishu app, used to @ it in Feishu chats",
  解除飞书应用: 'Unbind Feishu app',
  // 飞书登录
  飞书登录: 'Sign in with Feishu',
  或: 'or',
  飞书登录未启用: 'Feishu sign-in is not enabled',
  '飞书登录已过期，请重新登录': 'The Feishu sign-in has expired; please sign in again',
  已取消飞书授权: 'Feishu authorization was cancelled',
  '飞书登录失败，请稍后再试': 'Feishu sign-in failed; please try again later',
  '账号已停用，请联系系统管理员': 'This account is disabled; contact the system admin',
  该飞书身份已绑定其他账号: 'This Feishu identity is already linked to another account',
  已绑定飞书: 'Feishu linked',
  '首次使用飞书登录，请绑定已有共工账号或新建账号。':
    'First Feishu sign-in: link an existing Gonggong account or create a new one.',
  绑定并登录: 'Link and sign in',
  '绑定中…': 'Linking…',
  新建账号: 'Create account',
  返回登录: 'Back to sign-in',
  '绑定后可飞书一键登录，并在飞书群里 @Bot': 'Lets you sign in with Feishu and @ bots in Feishu chats',
  解绑: 'Unlink',
  绑定飞书: 'Link Feishu',
  解绑飞书: 'Unlink Feishu',
  '确定解绑飞书身份 {name}？': 'Unlink Feishu identity {name}?',
  将无法再用飞书登录: 'You can no longer sign in with Feishu',
  '在飞书群里 @Bot 将不再被识别为你':
    'Your @ mentions of bots in Feishu chats are no longer recognized as you',
  已解绑飞书: 'Feishu unlinked',
  对外地址: 'Public URL',
  '浏览器访问共工的地址，如 https://gonggong.example.com；飞书卡片中的链接和飞书登录回调都基于它。':
    'The address browsers use to reach Gonggong, e.g. https://gonggong.example.com; links in Feishu cards and the Feishu sign-in callback are built on it.',
  保存对外地址: 'Save public URL',
  对外地址已保存: 'Public URL saved',
  '重定向 URL': 'Redirect URL',
  '在飞书开发者后台「安全设置 · 重定向 URL」中添加此地址，飞书登录才能回到共工。':
    'Add this address under Security Settings · Redirect URLs in the Feishu developer console so Feishu sign-in can return to Gonggong.',
  // 群设置 · 飞书
  '系统管理员尚未配置飞书主应用，暂不能绑定飞书群。':
    "The system admin hasn't configured the Feishu main app yet, so Feishu chats can't be bound.",
  '绑定后，成员在飞书群里 @Bot 即可使用；Bot 的回复会发回飞书群。':
    "Once bound, members can @ bots in the Feishu chat; the bots' replies go back to the chat.",
  '成员自动同步：飞书群里已绑定飞书账号的团队成员会加入本群，退出飞书群即移出本群；在本群添加的成员也会被拉进飞书群。':
    'Members sync automatically: team members in the Feishu chat who linked Feishu join this group and leave it when they leave the chat; members added here are added to the Feishu chat too.',
  飞书群: 'Feishu chat',
  一个共工群只能绑定一个飞书群: 'A Gonggong group can be bound to one Feishu chat',
  '解绑#feishu': 'Unbind',
  '列出主应用和你都在、尚未绑定的飞书群': 'Chats both the main app and you are in that are not bound yet',
  '找不到群？请先把主应用拉进飞书群；已被其他群绑定的不显示':
    "Can't find a chat? Add the main app to it first; chats bound to another group are not listed",
  选择飞书群: 'Choose a Feishu chat',
  没有可绑定的飞书群: 'No Feishu chat to bind',
  已绑定飞书群: 'Feishu chat bound',
  未绑定飞书应用: 'No Feishu app',
  已在群中: 'In the chat',
  拉入飞书群: 'Add to chat',
  已拉入飞书群: 'Added to the Feishu chat',
  '已绑定飞书群 · {n} 个 Bot 未入群，请在下方点「拉入飞书群」':
    'Feishu chat bound · {n} {n:Bot is|Bots are} not in it; click "Add to chat" below',
  '未入群的 Bot 回复不会同步到飞书群，请点「拉入飞书群」。拉不进时，请检查主应用是否有群成员权限、飞书群是否允许添加机器人、该 Bot 的飞书应用是否已发布。':
    'Replies of Bots not in the chat do not reach Feishu; click "Add to chat". If that fails, check that the main app has chat member permissions, the chat allows adding bots, and the Bot\'s Feishu app is published.',
  '未在飞书群 · 回复不会同步到飞书': 'Not in the chat · replies do not reach Feishu',
  解绑飞书群: 'Unbind Feishu chat',
  '确定解绑飞书群 {name}？': 'Unbind Feishu chat {name}?',
  '飞书群里 @Bot 将不再触发运行': '@ mentions of bots in the Feishu chat no longer start runs',
  已同步的消息保留: 'Messages already mirrored are kept',
  已解绑飞书群: 'Feishu chat unbound',
  扫码创建或绑定: 'Create or bind by scanning',
  更新权限: 'Update permissions',
  或手动填写已有应用的凭证: "or enter an existing app's credentials",
  飞书后台配置说明: 'Feishu console setup',
  更新飞书应用权限: 'Update Feishu app permissions',
  扫码创建或绑定飞书应用: 'Create or bind a Feishu app by scanning',
  '用飞书扫码，可新建应用或选择已有应用，确认后自动完成配置':
    'Scan with Feishu, create a new app or pick an existing one, and confirm; setup finishes automatically',
  '用飞书扫码，确认后自动完成配置': 'Scan with Feishu and confirm there; setup finishes automatically',
  飞书扫码: 'Scan with Feishu',
  在飞书中打开: 'Open in Feishu',
  '{n} 秒后过期': 'Expires in {n}s',
  二维码已过期: 'The QR code has expired',
  飞书应用已绑定并连接: 'Feishu app bound and connected',
  '应用已保存。飞书管理员审核通过后会自动完成配置，也可稍后在应用设置中重试。':
    'The app is saved. Setup finishes automatically once a Feishu admin approves it; you can also retry later in the app settings.',
  '缺权限时点「更新权限」扫码补齐；飞书管理员审核通过后会自动完成，也可以现在重试。':
    'If permissions are missing, use “Update permissions” to add them. This finishes automatically once a Feishu admin approves the app; you can also retry now.',
  重试自动配置: 'Retry setup',
  '已与飞书群「{name}」同步，点击在飞书中打开':
    'Synced with the Feishu chat “{name}”; click to open it in Feishu',
  '在飞书中打开「{name}」': 'Open “{name}” in Feishu',
  '与飞书群名「{name}」不一致，改成一样便于两边对应':
    'Differs from the Feishu chat name “{name}”; matching it makes the two easy to pair',
  改为飞书群名: 'Use Feishu chat name',
  已改为飞书群名称: 'Renamed after the Feishu chat',
  同步飞书群成员: 'Sync Feishu chat members',
  网页消息同步到飞书群: 'Sync web messages to the Feishu chat',
  同步全部飞书消息: 'Sync all Feishu messages',
  '开启后，飞书群里的普通消息也会同步到本群（只进不出，不触发 Bot）；没有共工账号的人发言也会保存到本群，以飞书昵称显示。关闭后只同步 @Bot 的消息':
    'When on, ordinary messages in the Feishu chat also come into this group (one way, without running bots); messages from people without a Gonggong account are stored too, under their Feishu name. When off, only messages that @ a bot come in',
  已开启同步全部飞书消息: 'Syncing all Feishu messages turned on',
  已关闭同步全部飞书消息: 'Syncing all Feishu messages turned off',
  '关闭后，网页上发的消息、定时任务消息及其 Bot 回复和预览卡片不再发到飞书群；飞书群里的消息照常同步到本群':
    'When off, messages sent on the web and by schedules, their bot replies and preview cards no longer go to the Feishu chat; Feishu chat messages still sync to this group',
  已开启同步到飞书群: 'Syncing to the Feishu chat turned on',
  已关闭同步到飞书群: 'Syncing to the Feishu chat turned off',
  '把飞书群里已注册共工的本团队成员补进本群，用于补上后来才注册或入团队的人':
    'Adds team members in the Feishu chat who have Gonggong accounts, catching up on people who signed up or joined the team later',
  '新加入 {n} 人': '{n} joined',
  '新加入 {n} 人；{unlinked} 人未注册共工，{outside} 人不在本团队':
    '{n} joined; {unlinked} have no Gonggong account, {outside} are not in this team',
  '拉入：{names}': 'Adds: {names}',
  '未绑定飞书账号，不会拉入：{names}': 'Not added (no linked Feishu account): {names}',
  '没有飞书应用，不会拉入：{names}': 'Not added (no Feishu app): {names}',
  '你是群主，之后在本群添加的成员也会被拉进飞书群':
    'You own the chat; members added to this group later are pulled into it too',
  新建飞书群: 'New Feishu chat',
  '用本群名称新建飞书群并绑定，拉入已绑定飞书的成员和 Bot':
    'Create a Feishu chat named after this group and bind it, with linked members and Bots',
  创建飞书群: 'Create Feishu chat',
  '确定新建飞书群「{name}」并绑定到本群？': 'Create Feishu chat “{name}” and bind it to this group?',
  创建: 'Create',
  已创建并绑定飞书群: 'Feishu chat created and bound',
  从飞书群创建: 'Create from Feishu chat',
  '已创建并绑定飞书群，拉入 {n} 人；{unlinked} 人未绑定飞书账号，{outside} 人不在本团队':
    'Group created and bound; {n} joined, {unlinked} have no linked Feishu account, {outside} are not in this team',
  '已创建并绑定飞书群，拉入 {n} 人': 'Group created and bound; {n} joined',
  卡片里的飞书群你不在其中或已绑定其他群:
    "You are not in the card's Feishu chat, or it is bound to another group",
  '你是群管理员；飞书群里已绑定飞书账号的本团队成员和已在群里的 Bot 会一起加入。找不到群？请先把主应用拉进飞书群；已被其他群绑定的不显示':
    "You become the group admin; team members in the chat who linked Feishu and the Bots already in it join too. Can't find a chat? Add the main app to it first; chats bound to another group are not listed",
} satisfies Record<string, string>
