export default {
  'Webhook 调用地址 · {name}': 'Webhook URL · {name}',
  我已保存: 'Saved',
  '此链接包含密钥令牌，仅显示这一次；关闭后无法再次查看，如遗忘或泄露请重置令牌。':
    'This URL contains the secret token and is shown only once. If lost or leaked, rotate the token.',
  复制地址: 'Copy URL',
  已复制调用地址: 'Webhook URL copied',
  '复制失败，请手动选中复制': 'Could not copy automatically; please select and copy',
  调用示例: 'Example request',
  '编辑 Webhook': 'Edit Webhook',
  '新建 Webhook': 'New Webhook',
  '如：Jenkins 部署': 'e.g. Jenkins Deploy',
  '触发 Bot 的附加指令（可选）': 'Extra instruction for the Bot (optional)',
  '留空则使用默认排查指令：读取附件日志、定位提交并给出原因或修复':
    'Leave blank to use the default troubleshooting instruction (read log attachment, locate commit, explain or fix)',
  '允许 @ 的候选 Bot（留空则仅发消息不触发 Bot）· 优先选在线且空闲的':
    'Allowed candidate Bots (leave empty to post without triggering) · picks online & idle first',
  '所选候选 Bot 当前全部离线，触发时将跳过 @':
    'All selected candidate Bots are offline; @ mentions will be skipped',
  '本 Webhook': 'This webhook',
  '已删除 Webhook「{name}」': 'Deleted webhook "{name}"',
  排查中: 'Investigating',
  离线作废: 'Expired',
  尚未调用: 'Never called',
  '最近调用 {at}（{status}）': 'Last called {at} ({status})',
  '最近调用 {at}': 'Last called {at}',
  '仅发消息，不 @ Bot': 'Post only, no Bot @',
  待生成令牌: 'Token pending',
  '由 {name} 创建': 'Created by {name}',
  重置令牌: 'Rotate token',
  生成令牌: 'Generate token',
  '还没有 Webhook': 'No webhooks yet',
  '给 Jenkins 或其他外部系统配置入站链接，构建失败时自动发消息到群并 @ 候选 Bot 排查。':
    'Configure an inbound URL for Jenkins or other external systems to post build failures and @ candidate Bots.',
  '重置「{name}」的令牌？': 'Rotate token for "{name}"?',
  '旧的调用地址将立即失效，需要同步更新 Jenkins 等外部系统的配置。':
    'The old URL stops working immediately; update Jenkins or any external caller with the new one.',
  确认重置: 'Rotate',
} as const
