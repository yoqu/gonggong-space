# 快速上手

本页用一条最短路径把整套共工空间跑起来，并完成第一次 @Bot。每一步都只写最少操作，细节请点进对应的详细页。

整体流程：**管理员起服务 → 登录改密 → 把一句话发给你的 Agent（自动接入机器、建好 Bot 和私聊）→ 私聊试一句 → 建群 @Bot**。

::: tip 直接用演示环境
不想自己部署？默认的演示环境 [https://gg.uyoqu.com](https://gg.uyoqu.com/) 可以直接使用：打开网址注册账号，跳过第 1、2 步，从 [第 3 步](#bind) 开始。演示环境仅供体验，请勿存放敏感代码和数据。
:::

::: tip 普通成员
如果管理员已经把服务搭好，你只需要向他要「网址 + 账号 + 初始密码」，从 [第 2 步](#login) 开始。
:::

## 1. 管理员：启动服务

用仓库自带的 Docker 文件最快（需要 Docker 与 Docker Compose v2）：

```bash
git clone https://github.com/yoqu/gonggong-space.git && cd gonggong-space
GONGGONG_ADMIN_PASSWORD=初始密码 GONGGONG_PUBLIC_URL=https://<服务器 IP 或域名> docker compose up -d
```

首次启动会用 `GONGGONG_ADMIN_PASSWORD` 创建系统管理员账号 `admin`，数据库表自动创建。完成后浏览器打开 `GONGGONG_PUBLIC_URL`。证书、数据卷等细节见 [Docker 部署](/deploy/docker)；不用 Docker 时见 [从源码部署](/deploy/install)。

::: warning 想让成员用「发给你的 Agent」接入
这种方式由成员机器上的 Agent 从你的服务器下载 `gg` 并用 `https://` 连接，需要两样准备：

- 在「管理后台」→「客户端发布」上传 daemon 安装包，见 [客户端发布](/admin/releases)；
- 服务器使用受信任的证书，见 [HTTPS 与证书](/deploy/https)。用自签证书时，请让成员改用桌面端或命令行绑定（见 [绑定机器](/user/bind-machine)）。
:::

## 2. 登录并修改密码 {#login}

1. 浏览器打开网页地址，输入账号和密码，点击「登录」。
2. 首次登录会要求修改初始密码：填写「初始密码」「新密码」「确认新密码」，点击「修改密码」。

![登录页](/screenshots/web/login.webp)

管理员登录后，在「管理后台」→「账号与角色」点击「新建账号…」为每位成员建账号，把网址、账号和初始密码发给他们。系统参数里开启自助注册后，成员也可以自己注册。详见 [登录与账号](/user/login)、[账号与角色](/admin/users)。

## 3. 把一句话发给你的 Agent {#bind}

先在要跑 Bot 的机器（macOS 或 Linux）上准备好：

- git；
- 一个已经能正常对话的 Agent CLI，如 Claude Code 或 Codex（在终端里登录好）。

然后：

1. 打开「绑定新机器」：登录后欢迎页的「开始绑定」、左侧「开始使用」里的「绑定新机器」，或右上角头像菜单里的「绑定新机器」都可以。
2. 在「发给你的 Agent」下点击「复制」，得到一句话，形如：

   ```text
   帮我接入共工空间：读取 https://gg.example.com/api/install.md 并按步骤执行，接入码 K7QM-4X2P。
   ```

3. 在那台机器上打开 Claude Code 或 Codex，把这句话粘贴给它。它会自己下载安装 `gg`、绑定这台机器、装成开机自启的后台服务，并为你建好一个 Bot（如「王磊的 Claude Code」）和与它的私聊。过程中 Agent 要执行命令时，按它的提示允许即可。
4. 网页上的对话框会依次走过「复制给 Agent」「机器接入」「Bot 就绪」，通常 1–3 分钟。完成后自动打开与新 Bot 的私聊。

![发给你的 Agent](/screenshots/web/bind-agent.webp)

::: tip 接入码过期了也没关系
接入码 30 分钟内有效。过期或已用过时，Agent 会给你一个确认链接和 4 位核对码：在浏览器里打开链接（或就在「绑定新机器」对话框里），核对码与终端一致时点「允许接入」。
:::

**Windows 或不想交给 Agent？** 展开对话框里的「其他方式」：安装桌面端后点「在客户端中打开」；或展开「使用命令行」，复制 `gg login --server … --code …` 在终端执行，再运行 `gg run`（或 `gg service install` 装成后台服务）；也可以「在 Docker 中运行」。这几种方式绑定后不会自动建 Bot，需要再做一步 [新建 Bot](/user/create-bot)。详见 [绑定机器](/user/bind-machine)。

## 4. 在私聊里试一句

私聊里只有你和这个 Bot，不用 @，直接发消息：

```text
看看这台机器上装了哪些开发工具，用一句话告诉我
```

聊天里会出现运行卡片，点开可以看到它每一步的思考、工具调用和命令输出。

想调整这个 Bot 的名字、角色、系统提示词或审批方式，在「机器与 Bot」里点开它。刚开始建议把「触发范围」设为「仅本人」。详见 [我的机器与 Bot](/user/machines)、[Bot 设置与权限](/user/bot-settings)。

## 5. 建群

1. 点击会话列表顶部的 +（「发起会话」）。
2. 填写「名称」；点「添加 Bot…」选你的 Bot，再添加同事；要改代码就在「仓库」里搜索或粘贴 git 仓库地址（如 `git@github.com:xinghe/todo-app.git`）并确认基准分支。
3. 点击「创建群」。

![新建群](/screenshots/web/new-group.webp)

建群时会检查各 Bot 所在机器能否访问仓库；访问不了的 Bot 会在进群后暂停，由 Bot 主人配置 git 凭据后重新检查。只选了一个自己的 Bot、没加别人时，创建的是私聊。详见 [群与私聊](/user/groups)、[仓库与工作区](/user/repos-workspaces)。

## 6. @Bot 开工

在群输入框里输入 `@`，选择 Bot，写下需求后回车（以 Bot 名为「后端助手」为例）：

```text
@后端助手 看一下待办列表接口为什么偶尔 500，找到原因后修复并跑测试
```

群里会出现运行卡片，点开可以看到它每一步的思考、工具调用和命令输出，以及改了哪些代码；需要你把关的操作会弹出审批卡片。

![群消息全景](/screenshots/web/chat.webp)

详见 [在群里指挥 Bot](/user/chat)、[运行过程](/user/runs)、[审批与提问](/user/approvals)。

## 接下来

- 把改动提交、推送：[Git 管理](/user/git)
- 让 Bot 起的网页在群里打开：[结果预览](/user/previews)
- 每天定时跑一遍回归：[定时任务与话题](/user/schedules-threads)
- 把项目约定和 Token 交给 Bot：[知识库与密钥](/user/knowledge-secrets)
- 给团队装上常用 Skill：[Skill 市场与插件](/user/market-plugins)

::: tip 出问题了？
先在机器上运行 `gg doctor` 自检，再看 [常见问题与排查](/guide/faq)。
:::
