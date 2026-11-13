---
workflow: product-launch-video
flow: automation
storyboard: no
message: "一句话接入，AI 同事在群里接力干活"
destination: website
aspect: 1920x1080
language: zh
audience: "带 AI 编程工具的小型研发团队与独立开发者"
length: 60s
angle: one-sentence
version: v0.4.20
---

## Intent

v0.4.20 版重做。上一版「这支片子，是它们做的」（群里 @ Bot 接力做宣传片、盖章审批、揭示片子就是预览卡片）已收录在 git 历史里。

新概念「一句话」：开场问「给团队加一位 AI 同事，要几步？」，装环境、配密钥、写接入文档……一条条被划掉，收成一颗「一句话」胶囊。之后每一幕都只靠一句话推进，挑 v0.4.x 里最打动人的四个点讲成一条线：

| 时间 | 幕 | 卖点 | 画面 |
| --- | --- | --- | --- |
| 0–5s | 钩子 | — | 大字提问，杂活清单被划掉，「一句话」胶囊飞进对话框 |
| 4.6–13.8s | 一句话接入 | 发给你的 Agent（v0.4.19） | 「绑定新机器」对话框复制那句话 → 终端里的 Claude Code 自己 Fetch install.md、下载并运行 install.sh、`gg login --create-bot`、`gg service install` → 三步指示器走完、绑定成功 → 自动打开与「阿周的 Claude Code」的私聊 |
| 13.4–22s | 哪家 Agent 都行 | Claude Code / Codex / Gemini CLI / CodeBuddy / pi / DeepSeek Harness | 六张性格 Bot 卡片（每张一个 Agent、一台机器），收拢进「官网改版」群头像 |
| 21.4–36s | 群里接力 | @ 接力、话题（thread_create）、画布、Git | 打字 @慢想 → 慢想开两个话题分给留白、铁码 → 右侧画布三屏原型逐屏出现 → 铁码运行卡片 → Git 面板 diff |
| 35.6–46.4s | 帮我审批 | 审批方式三选一、手机端 | 分段控件滑到「帮我审批」，测试/lint/commit 直接放行，`git push origin main` 发到手机，权限请求卡片点「批准」 |
| 46–53.4s | 公开分享 | 托管原型、分享 | 画布「分享」→「开启分享」→ 已复制，客户手机打开同一张首页 |
| 52.8–60s | 片尾 | — | Logo、口号、开源 · 自托管 · 6 种 Agent · 网页/桌面/手机、GitHub 地址、13 个性格形象 |

被放弃的方向：功能清单式蒙太奇；沿用上一版「片子是它们做的」反转（v0.4.x 的新点是接入与多 Agent，换成「一句话」主线更贴）。

## Assets

- assets/cast/*.svg — 共字君与 12 性格形象（apps/web/src/features/bots/personas.ts、ui/mascot.tsx 导出）
- assets/logo.svg — 品牌 Logo
- assets/vendor/gsap.min.js — gsap 3.14.2 本地副本（渲染环境连不上 CDN）
- 界面全部用 HTML 按真实界面重建，文案取自 apps/web/src（BindMachineDialog、BindCodePanel、ApprovalFields、ApprovalBlock、画布分享）、apps/server/src/modules/machines/onboard.ts（agentPrompt、Bot 命名）、apps/server/install/install.md / install.sh 与 crates/gonggong/src/main.rs（终端输出）。服务器地址用 gg.example.com 占位。
- assets/shots/ 是上一版用的截图，本版未引用。

## Customizations

- 旁白：微软 Edge 在线神经语音 zh-CN-YunxiNeural（`scripts/vo.mjs`，msedge-tts，无需密钥），裁静音并统一响度到 -16 LUFS。屏幕字幕与旁白同文（「@」在朗读稿里写作「艾特」）。
- 配乐与音效：`node scripts/score.mjs` 程序化合成（120 BPM，D 大调），节点在 cues.json，旁白处自动压低音乐。
- 改时间线后同步 cues.json（vo 与 sfx 时间）再跑 score.mjs。

## Notes

- 视觉遵循 Pane 设计系统：浅色、macOS + 飞书 IM 气质，systemBlue 强调；玉青只用于 Logo。
- 术语：Bot / 机器 / 群；产品名「共工空间」。不出现名人出处，不写内部域名。
- 渲染：`npx hyperframes@0.8.102 render -o renders/promo.mp4`，再用 ffmpeg 压到 15MB 内（`-c:v libx264 -crf 26 -preset slow -c:a aac -b:a 128k -movflags +faststart`）复制到 website/public/videos/promo.mp4；封面取片尾帧导出 promo.jpg。
