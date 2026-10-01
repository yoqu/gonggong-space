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
} satisfies Record<string, string>
