---
workflow: product-launch-video
flow: automation
storyboard: no
message: "在群里 @ 一下，AI 同事就在队友的机器上接力把活干完"
destination: youtube
aspect: 1920x1080
language: zh
audience: "带 AI 编程工具的小型研发团队与独立开发者"
length: 60s
angle: meta-relay
---

## Intent

用户原话：「发挥你的想象力 帮我制作一个产品宣传视频。」——自主运行，创意由 Claude 决定。

选定概念「这支片子，是它们做的」：开场就是用户发出的这句需求，被 @ 到共工空间的一个群里；共字君拉来几位性格 Bot（片头点将式登场），在群里接力——慢想定卖点、留白画分镜、铁码在队友机器上用 Claude Code 开工、需要越权时举手、主人盖朱印批准、diff 可审、结果一键预览；最后镜头拉远，揭示我们正在看的这支片子，就是群里那张预览卡片。卖点在剧情里自然出现，而非功能清单。

被放弃的典型方向：逐页截图 + 功能列表的产品导览。

## Assets

- ../../website/public/screenshots/web/*.webp — 真实界面截图，作每个卖点的「实证」镜头
- ../../website/public/logo.svg — 品牌 Logo
- ../../apps/web/src/features/bots/personas.ts — 12 性格 IP 形象（导出为静态 SVG）
- ../../apps/web/src/ui/mascot.tsx — 共字君（导出为静态 SVG）

## Customizations

- 无旁白；叙事靠群聊气泡文字。配乐与音效由脚本程序化合成（HeyGen 未登录、本地引擎缺依赖）。
- 审批节拍用朱红印章「批准」盖下。

## Notes

- 视觉遵循 Pane 设计系统：浅色、macOS + 飞书 IM 气质，systemBlue 强调；玉青只用于 Logo。
- 术语：Bot / 机器 / 群；产品名「共工空间」。不出现名人出处。
- 避免：神话山水场景、黏土质感、文案压在复杂场景上。
