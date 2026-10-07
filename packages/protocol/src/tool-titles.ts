/** Titles of the gonggong MCP tools, apart from their schemas so a client can label calls without bundling zod. */
export const GONGGONG_TOOL_TITLES = {
  list_messages: '读取聊天记录',
  search_messages: '检索聊天记录',
  get_group_info: '群信息与成员',
  get_run: '查看运行记录',
  list_questions: '提问卡片历史',
  fetch_attachments: '下载历史附件',
  list_feishu_messages: '读取飞书群消息',
  preview_expose: '发布预览',
  preview_gui: '发布桌面应用预览',
  preview_close: '关闭预览',
  hand_off: '交给其他 Bot',
  schedule_create: '创建定时任务',
  schedule_list: '定时任务列表',
  schedule_update: '修改定时任务',
  schedule_delete: '删除定时任务',
} as const
