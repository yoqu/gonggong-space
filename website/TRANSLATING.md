# English translation guide (Gonggong Space docs)

The Chinese pages under `website/` are the source of truth. English pages mirror them under `website/en/` with the **same relative path**: `website/user/chat.md` → `website/en/user/chat.md`. Sidebar/nav for English already exist in `.vitepress/config.mts` — do not edit it.

## What to produce
- A faithful, natural English translation of every section, table, tip box, and code-block comment. Do not drop, summarize, or add content. Keep the same heading structure, the same screenshots (same `/screenshots/...` paths — the UI itself is Chinese-only), and the same VitePress containers (`::: tip` etc.; translate their titles).
- Write for developers and team leads: concise, direct, second person ("you"), American English, sentence-case headings.
- If the Chinese page has an error you can verify against code, keep the translation faithful and list the issue in your final report instead of silently changing meaning.

## Links
- Internal links get the `/en` prefix: `/user/create-bot` → `/en/user/create-bot`, `/desktop/` → `/en/desktop/`.
- Anchors: VitePress slugs come from headings, so Chinese anchors break. For anchors into **your own** pages, use the slug of the English heading you wrote (lowercase, spaces → `-`, punctuation dropped, e.g. "Interrupt and append during a run" → `#interrupt-and-append-during-a-run`). For anchors into pages translated by someone else, drop the anchor and link to the page only.
- External links unchanged.

## UI labels (important)
The product UI is Chinese-only, so readers must be able to match what they see. Write the exact Chinese label in 「」 followed by an English gloss in parentheses, e.g. click 「新建 Bot」 (New Bot). After the first occurrence on a page you may use the English gloss alone if unambiguous. The same applies to error/status messages quoted from the software: 「绑定码已过期」 ("bind code expired").

## Fixed terminology
| Chinese | English |
| --- | --- |
| 共工空间 | Gonggong Space (the desktop app's display name is 「共工空间」) |
| Bot | Bot (capitalized) |
| 机器 | machine |
| 群 / 私聊 | group / direct chat |
| 群管理员 / 系统管理员 / 普通成员 | group admin / sysadmin / member |
| Bot 主人 / 归属人 | Bot owner |
| 触发人 | requester (the person who triggered the run) |
| 工作区 / 托管工作区 | workspace / managed workspace |
| 分区模式 | partition mode |
| 运行 / 轮 | run / turn (「第 3 轮」 = turn 3) |
| 过程面板 | process panel |
| 工作台 | workbench |
| 审批 / 权限请求 | approval / permission request |
| 权限档位：只读 / 工作区写入 / 完全访问 | permission tier: Read-only / Workspace write / Full access |
| 触发范围 | trigger scope |
| 提问 | question (a Bot asking group members) |
| 打断并追加 | interrupt and append |
| 预览 / 公开链接 | preview / public link |
| 实时画面 | live view |
| 穿透与服务 | tunnels & services |
| 绑定码 / 接入链接 | bind code / connect link |
| 供应商 | provider |
| Agent 命令 | Agent command |
| 上下文占用 | context usage |
| 共字君 | Gong (the mascot, 共字君) |
| 管理后台 | admin console |
| 配置中心 / 系统参数 | configuration center / system parameters |
| 客户端发布 | client releases |
| 审计记录 | audit log |
| 共工空间托管 | managed by Gonggong Space |
| daemon / `gg` | daemon / `gg` |

## Code blocks
Keep commands, config, and output exactly as-is. Translate only comments (`# ...`, `// ...`). Chinese program output inside a code block stays Chinese; add an English note after the block if the meaning matters.

## Output
Create only your assigned files under `website/en/`. Do not modify Chinese pages, config, or anything else. Don't run the site build, don't commit. At the end, report: files written, the list of your pages' H2/H3 headings (heading map), and any issues spotted in the source.
