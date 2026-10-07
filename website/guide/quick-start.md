# 快速上手

本页用一条最短路径把整套共工空间跑起来，并完成第一次 @Bot。每一步都只写最少操作，细节请点进对应的详细页。

整体流程：**管理员起服务 → 登录改密 → 绑定机器 → 建 Bot → 建群 → @Bot**。

::: tip 直接用演示环境
不想自己部署？默认的演示环境 [http://gg.uyoqu.com](http://gg.uyoqu.com/) 可以直接使用：打开网址注册账号，跳过第 1 步，从 [第 3 步](#bind) 绑定机器开始，绑定命令形如 `gg login --server http://gg.uyoqu.com --code K7QM-4X2P`。演示环境仅供体验，请勿存放敏感代码和数据。
:::

::: tip 普通成员
如果管理员已经把服务搭好，你只需要向他要「网址 + 账号 + 初始密码」，从 [第 2 步](#login) 开始。
:::

## 1. 管理员：启动服务

在一台机器上准备好 Node.js 22+、pnpm、PostgreSQL，然后在项目根目录执行：

```bash
pnpm install
pnpm db:up                                        # 启动项目内 PostgreSQL（端口 54329）
GONGGONG_ADMIN_PASSWORD=初始密码 pnpm dev:server   # 服务器，默认 127.0.0.1:8787
pnpm dev:web                                      # 网页，默认 http://127.0.0.1:5173
```

首次启动会用 `GONGGONG_ADMIN_PASSWORD` 创建系统管理员账号 `admin`，数据库表自动创建。

::: tip 其他机器要接入时
其他成员的机器可以直接用服务器地址（`http://` 或 `https://`）绑定。跨网络使用建议配置 HTTPS 加密传输，见 [HTTPS 与证书](/deploy/https)。完整部署步骤见 [从源码部署](/deploy/install)。
:::

## 2. 登录并修改密码 {#login}

1. 浏览器打开网页地址，输入账号和密码，点击「登录」。
2. 首次登录会要求修改初始密码：填写「初始密码」「新密码」「确认新密码」，点击「修改密码」。

![登录页](/screenshots/web/login.webp)

管理员登录后，在左侧「管理后台」→「账号与角色」点击「新建账号…」为每位成员建账号，把网址、账号和初始密码发给他们。详见 [登录与账号](/user/login)、[账号与角色](/admin/users)。

## 3. 绑定你的机器 {#bind}

先在要跑 Bot 的机器上准备好：

- git；
- Claude Code 和/或 Codex CLI，并在终端里**登录好**（能正常对话即可）；
- 共工空间的 daemon：命令行 `gg`（见 [安装](/cli/)）或 macOS 桌面端（见 [桌面端](/desktop/)）。

然后绑定：

1. 在网页右上角头像菜单点击「绑定新机器」（或左侧栏「我的机器」旁的 +）。
2. 对话框会生成一次性的接入链接：
   - 用桌面端：点击「复制接入链接」，粘贴到桌面端；
   - 用命令行：展开「使用命令行」，点击「复制命令」，在机器终端里执行，形如：

   ```bash
   gg login --server https://gg.example.com --code K7QM-4X2P
   ```

3. 终端显示「绑定成功」后，启动 daemon（桌面端用户跳过这一步，保持 App 运行即可）：

   ```bash
   gg run
   ```

   这个终端要一直开着，关掉后你的 Bot 会变成「离线」。

![绑定新机器](/screenshots/web/bind-machine.webp)

对话框里看到本机的 Claude Code / Codex 版本，说明机器已就绪。详见 [绑定机器](/user/bind-machine)。

## 4. 新建 Bot

1. 在左侧栏「我的 Bot」旁点击 +（「新建 Bot…」）。
2. 选择「执行机器」（刚绑定的机器）和「Agent」（Claude Code 或 Codex），填写「名称」，如 `后端助手`；可选一个「角色」形象，在「系统提示词」里写明职责，如「后端接口开发，只改 server/ 目录」。
3. 点击「创建并绑定」。看到「已就绪，可以在群里 @ 它了」即可。

![新建 Bot](/screenshots/web/new-bot.webp)

刚开始建议在 Bot 设置里把「触发范围」设为「仅本人」。详见 [创建 Bot](/user/create-bot)、[Bot 设置与权限](/user/bot-settings)。

## 5. 新建群

1. 点击顶部工具栏的 +（「新建群」）。只想自己用可以在左侧栏「私聊」旁点 + 新建私聊。
2. 填写「名称」；要改代码就在「仓库」里粘贴 git 仓库地址（如 `git@github.com:xinghe/todo-app.git`）并确认「基准分支」；添加你的 Bot 和同事。
3. 点击「创建」。

![新建群](/screenshots/web/new-group.webp)

建群时会检查各 Bot 所在机器能否访问仓库；访问不了的 Bot 会在进群后暂停，由 Bot 主人配置 git 凭据后重新检查。详见 [群与私聊](/user/groups)、[仓库与工作区](/user/repos-workspaces)。

## 6. @Bot 开工

在群输入框里输入 `@`，选择 Bot，写下需求后回车：

```text
@后端助手 看一下待办列表接口为什么偶尔 500，找到原因后修复并跑测试
```

群里会出现运行卡片，点开可以看到它每一步的思考、工具调用和命令输出，以及改了哪些代码；需要你批准的操作会弹出审批卡片。

![群消息全景](/screenshots/web/chat.webp)

详见 [在群里指挥 Bot](/user/chat)、[运行过程](/user/runs)、[审批与提问](/user/approvals)。

::: tip 出问题了？
先在机器上运行 `gg doctor` 自检，再看 [常见问题与排查](/guide/faq)。
:::
