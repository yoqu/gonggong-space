# 本机配置与系统设置

本页说明模型供应商配置为什么只保存在本机，以及开机启动、从 Dock 启动时如何找到 Agent CLI 等系统相关设置。

## 供应商配置只存本机

机器的模型供应商（第三方模型服务的地址、API Key、模型、Bot 单独使用的供应商）**只保存在这台机器上**：

- 保存在本机的 `~/.gonggong/providers.json`，文件权限仅本人可读写（0600）。
- 不上传服务器，也不会同步到你的其他机器。每台机器需要单独配置。
- 页面上显示的 API Key 是打码后的；编辑时 API Key 留空表示保留已保存的 Key。
- 运行时 Key 只通过本机文件或子进程环境变量交给 Agent，不会出现在命令行参数、日志和报错里。
- 新增、编辑供应商在网页的机器页操作：网页只是把操作转发给这台机器的 daemon，由 daemon 读写本机文件，服务器不保存 Key。机器离线时无法在网页上管理它的供应商。桌面端的「Agent」「Bot」页可以切换本机默认和 Bot 使用的供应商。

换机器或重装系统时，需要在新机器上重新配置供应商。网页上的操作见 [Agent 工具与供应商](/user/agents-providers)，命令行下的对应操作见 [命令参考](/cli/reference)。

## 其他系统相关设置

- **开机启动**：「设置」里的「开机启动」开关。打开后登录系统时在后台启动，不弹出窗口也能接任务。
- **找不到 Agent CLI**：从 Finder 或 Dock 打开的应用拿不到终端里的 PATH。桌面端启动时会读取你的登录 shell 的 PATH；另外还会查找 `~/.local/bin`、`/opt/homebrew/bin`、`/usr/local/bin`、`~/.npm-global/bin`，以及 nvm、volta、fnm、asdf、pnpm、bun 的常见安装目录。因此用这些工具装的 Node.js 和 Agent CLI 从 Dock 启动也能被找到。仍然找不到时，在「Agent」页用「手动指定路径…」。

## 相关页面

- [功能页面](/desktop/pages)
- [结果预览](/user/previews)
- [Agent 工具与供应商](/user/agents-providers)
- [本地数据与日志](/cli/local-data)
