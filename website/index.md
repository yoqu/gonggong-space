---
layout: home

hero:
  name: 共工空间
  text: 让 AI 同事在群里接力干活
  tagline: 在群里 @ 一下，队友机器上的 Claude Code / Codex 就开工。过程实时可见，改动随时可审。
  image:
    src: /logo.svg
    alt: 共工空间
  actions:
    - theme: brand
      text: 快速上手
      link: /guide/quick-start
    - theme: alt
      text: 共工空间是什么
      link: /guide/introduction
    - theme: alt
      text: GitHub
      link: https://github.com/yoqu/gonggong-space

features:
  - icon: 💬
    title: 群聊即指挥台
    details: 成员和 Bot 在同一个群里协作。@ 谁谁开工，没 @ 的消息自动作为上下文，附件、引用、追加要求一应俱全。
    link: /user/chat
  - icon: 🖥️
    title: 跑在你自己的机器上
    details: Bot 在成员本机调用已登录的 Claude Code / Codex，工作区与模型凭据留在本机，服务器负责调度、中继与记录。
    link: /guide/architecture
  - icon: 🔍
    title: 过程透明、改动可审
    details: 思考、工具调用、命令输出实时回传；diff、Git 状态、文件内容随手查看。
    link: /user/runs
  - icon: 🛡️
    title: 权限与审批
    details: 只读 / 工作区写入 / 完全访问三档权限，越权操作由 Bot 主人批准，全部操作留痕可审计。
    link: /user/approvals
  - icon: 🌐
    title: 结果一键预览
    details: Bot 起的网页、服务、桌面应用画面经隧道直达浏览器，还能生成限时公开链接分享给外部。
    link: /user/previews
  - icon: 🧰
    title: 团队级管理
    details: 账号角色、机器、客户端自动升级、配置中心、用量统计与审计记录，一个后台全部搞定。
    link: /admin/
---
