# Quick start

This page takes the shortest path to getting all of Gonggong Space running and making your first @Bot. Each step lists only the minimum actions; follow the links for details.

Overall flow: **admin starts the server → log in and change your password → send one message to your Agent (it connects the machine and sets up a Bot and a direct chat) → try a message in the direct chat → create a group and @ the Bot**.

::: tip Use the demo environment
Don't want to deploy it yourself? The default demo environment [https://gg.uyoqu.com](https://gg.uyoqu.com/) is ready to use: open it, register an account, skip steps 1 and 2, and start from [step 3](#bind). The demo is for trying things out only; don't put sensitive code or data on it.
:::

::: tip Members
If your admin has already set up the server, just ask them for the "URL + account + initial password" and start from [step 2](#login).
:::

## 1. Admin: start the server

The Docker files in the repository are the fastest way (requires Docker and Docker Compose v2):

```bash
git clone https://github.com/yoqu/gonggong-space.git && cd gonggong-space
GONGGONG_ADMIN_PASSWORD=初始密码 GONGGONG_PUBLIC_URL=https://<服务器 IP 或域名> docker compose up -d
```

(`初始密码` is a placeholder for the initial password; `<服务器 IP 或域名>` is your server's IP or domain.)

On first start, the server creates the sysadmin account `admin` using `GONGGONG_ADMIN_PASSWORD`, and database tables are created automatically. When it's up, open `GONGGONG_PUBLIC_URL` in a browser. For certificates, data volumes, and other details, see [Docker deployment](/en/deploy/docker); without Docker, see [Deploy from source](/en/deploy/install).

::: warning If members will connect with "Send to your agent"
With this method, the Agent on the member's machine downloads `gg` from your server and connects over `https://`, so you need two things in place:

- Upload the daemon packages under 「管理后台」 (Admin console) →「客户端发布」 (Client releases); see [Client releases](/en/admin/releases).
- The server must use a trusted certificate; see [HTTPS and certificates](/en/deploy/https). With a self-signed certificate, have members bind with the desktop app or the CLI instead (see [Bind a machine](/en/user/bind-machine)).
:::

## 2. Log in and change your password {#login}

1. Open the web URL in a browser, enter your account and password, and click 「登录」 (Log in).
2. On first login you must change the initial password: fill in 「初始密码」 (Initial password), 「新密码」 (New password), and 「确认新密码」 (Confirm new password), then click 「修改密码」 (Change password).

![Login page](/screenshots/web/login.webp)

After the admin logs in, go to 「管理后台」 (Admin console) →「账号与角色」 (Accounts & roles) and click 「新建账号…」 (New account…) to create an account for each member, then send them the URL, account, and initial password. If self sign-up is turned on in system parameters, members can also register on their own. See [Login and account](/en/user/login) and [Accounts and roles](/en/admin/users).

## 3. Send one message to your Agent {#bind}

First, prepare the machine that will run your Bots (macOS or Linux):

- git;
- an Agent CLI that can already chat normally, such as Claude Code or Codex (logged in from a terminal).

Then:

1. Open 「绑定新机器」 (Bind new machine): any of 「开始绑定」 (Start binding) on the welcome page after login, 「绑定新机器」 under 「开始使用」 (Get started) on the left, or 「绑定新机器」 in the avatar menu at the top right will do.
2. Under 「发给你的 Agent」 (Send to your agent), click 「复制」 (Copy) to get a message like this:

   ```text
   帮我接入共工空间：读取 https://gg.example.com/api/install.md 并按步骤执行，接入码 K7QM-4X2P。
   ```

   (It says: "Connect me to Gonggong Space: read https://gg.example.com/api/install.md and follow the steps; connect code K7QM-4X2P.")

3. On that machine, open Claude Code or Codex and paste the message to it. It downloads and installs `gg`, binds the machine, installs it as a background service that starts at login, and sets up a Bot for you (such as 「王磊的 Claude Code」, "Wang Lei's Claude Code") and your direct chat with it. When the Agent wants to run commands along the way, allow them as it asks.
4. The dialog on the web page steps through 「复制给 Agent」 (Copy to your agent), 「机器接入」 (Machine connects), and 「Bot 就绪」 (Bot ready), usually in 1–3 minutes. When it's done, the direct chat with the new Bot opens automatically.

![Send to your agent](/screenshots/web/bind-agent.webp)

::: tip An expired connect code is fine
The connect code is valid for 30 minutes. If it has expired or was already used, the Agent gives you a confirmation link and a 4-character check code: open the link in a browser (or just look in the 「绑定新机器」 dialog), and if the check code matches the one in the terminal, click 「允许接入」 (Allow).
:::

**On Windows, or don't want to hand it to an Agent?** Expand 「其他方式」 (Other ways) in the dialog: install the desktop app and click 「在客户端中打开」 (Open in client); or expand 「使用命令行」 (Use the command line), copy `gg login --server … --code …`, run it in a terminal, then run `gg run` (or `gg service install` to install it as a background service); or choose 「在 Docker 中运行」 (Run in Docker). These methods don't create a Bot automatically after binding, so you need one more step: [Create a Bot](/en/user/create-bot). See [Bind a machine](/en/user/bind-machine).

## 4. Try a message in the direct chat

A direct chat has only you and this Bot, so no @ is needed; just send a message:

```text
看看这台机器上装了哪些开发工具，用一句话告诉我
```

("Check which development tools are installed on this machine and tell me in one sentence.")

A run card appears in the chat; open it to see each step's thinking, tool calls, and command output.

To change this Bot's name, character, system prompt, or approval mode, open it in 「机器与 Bot」 (Machines & Bots). To start with, we recommend setting 「触发范围」 (Who can trigger) to 「仅本人」 (Owner only). See [My machines and Bots](/en/user/machines) and [Bot settings and permissions](/en/user/bot-settings).

## 5. Create a group

1. Click the + at the top of the conversation list (「发起会话」 (New conversation)).
2. Fill in 「名称」 (Name); click 「添加 Bot…」 (Add Bot…) to pick your Bot, then add teammates. If the Bots will change code, search for or paste a git repository URL under 「仓库」 (Repositories) (such as `git@github.com:xinghe/todo-app.git`) and confirm the base branch.
3. Click 「创建群」 (Create group).

![New group](/screenshots/web/new-group.webp)

When you create the group, it checks whether each Bot's machine can reach the repository. A Bot that can't is paused after joining until its owner configures git credentials and rechecks. If you pick only one of your own Bots and add no one else, you get a direct chat instead. See [Groups and direct chats](/en/user/groups) and [Repositories and workspaces](/en/user/repos-workspaces).

## 6. @ the Bot to get to work

In the group's input box, type `@`, pick the Bot, write your request, and press Enter (using a Bot named 「后端助手」, "backend assistant", as the example):

```text
@后端助手 看一下待办列表接口为什么偶尔 500，找到原因后修复并跑测试
```

("Find out why the todo list API sometimes returns 500, fix it, and run the tests.")

A run card appears in the group; open it to see each step's thinking, tool calls, command output, and which code changed. Actions that need your check pop up an approval card.

![Group chat overview](/screenshots/web/chat.webp)

See [Directing Bots in a group](/en/user/chat), [Runs](/en/user/runs), and [Approvals and questions](/en/user/approvals).

## What's next

- Commit and push the changes: [Git management](/en/user/git)
- Open the web page a Bot started right in the group: [Previews](/en/user/previews)
- Run the regression suite on a schedule every day: [Scheduled tasks and threads](/en/user/schedules-threads)
- Give the Bot your project conventions and tokens: [Knowledge base and secrets](/en/user/knowledge-secrets)
- Install common Skills for your team: [Skill market and plugins](/en/user/market-plugins)

::: tip Something wrong?
First run `gg doctor` on the machine for a self-check, then see [FAQ and troubleshooting](/en/guide/faq).
:::
