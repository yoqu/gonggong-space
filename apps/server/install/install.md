# Connect this machine to Gonggong (共工空间)

You are an AI agent on the user's computer. The user asked you to connect this machine to the Gonggong workspace at
{{SERVER}} so that an AI bot on this machine works for them there. Connecting means three things are ready: `gg`
(the Gonggong client) runs on this machine, an Agent CLI that `gg` can drive is installed and signed in, and the user
has had a first chat with the bot on the web. Walk the user through all of it; most users are doing this for the
first time, so explain each step in one short sentence in their language.

## Rules

- Install only into the user's home directory. Never use sudo and never change system settings.
- Download the script first, look at it, then run it. Do not pipe a download straight into a shell.
- Report only what the commands printed. If a step fails, stop and show the user the exact error output; do not
  guess, retry with other options or claim success.
- The 接入码 (one-time code, `XXXX-XXXX`) is in the user's message. It is valid for 30 minutes; if it has expired
  or was already used, that is fine: `gg login` then asks the user to allow this machine in the web page instead
  (see step 2).
- If the script says the machine is already bound to another server, stop and ask the user; never delete or edit
  `~/.gonggong` yourself.
- This works on macOS and Linux. On Windows, tell the user to use the desktop app from the 绑定新机器 page instead.
- If you cannot run shell commands yourself, give the user each command to paste into their Terminal and read back
  what it printed.

## Steps

1. **Pick the Agent CLI the bot runs on.** `gg` drives these command-line agents: `claude` (Claude Code), `codex`
   (Codex), `gemini` (Gemini CLI), `codebuddy` (CodeBuddy Code), `pi`, `deepseek` (DeepSeek Harness, `dsh`),
   `antigravity` (Antigravity CLI, `agy`), `opencode` (OpenCode), `qwen` (Qwen Code), `kimi` (Kimi Code), `goose`
   (Goose) or `copilot` (GitHub Copilot CLI).

   If you are one of them, use yourself. Otherwise pick the CLI of the product the user already uses, so they keep
   their account and subscription:

   | The user is talking to you in | `--agent` |
   | --- | --- |
   | WorkBuddy, CodeBuddy IDE or the CodeBuddy plugin | `codebuddy` |
   | Claude desktop app or claude.ai | `claude` |
   | ChatGPT or the Codex app | `codex` |
   | Gemini or Google AI Studio | `gemini` |
   | Antigravity (the IDE) | `antigravity` |
   | Qwen / 通义, Lingma or Qoder | `qwen` |
   | Kimi | `kimi` |
   | DeepSeek | `deepseek` |
   | GitHub Copilot in VS Code or JetBrains | `copilot` |

   For anything else (Cursor, Trae, Windsurf, …) ask the user which of the agents above they have an account for; if
   they have none, suggest `codebuddy` (WeChat sign-in, works from mainland China) and let them choose. Tell the user
   which one you picked and why, in one sentence.

2. **Install `gg` and bind this machine.** Download the installer:

   ```sh
   curl -fsSL {{SERVER}}/api/install.sh -o /tmp/gonggong-install.sh
   ```

   Run it with the code and the agent from step 1:

   ```sh
   sh /tmp/gonggong-install.sh --code <接入码> --agent <agent>
   ```

   It downloads `gg`, checks its sha256, installs it to `~/.local/bin/gg`, binds this machine to the user's account
   (`gg login`), creates the bot and a direct chat with it, and starts `gg` as a background service that also starts
   at login (`gg service install`).

   If the output shows a confirmation link and a 4-character check code (核对码) and says it is waiting (you may only
   see this once the command returns or times out), tell the user right away, word for word: open that link in their
   browser, check that the page shows the same code, and click 允许接入 (Allow). Keep the command running while you
   wait. If your command times out before the user allows it, run the same command again: it does not reinstall
   `gg` and keeps waiting on the same request.

   The script ends with `gg status`. The machine is connected only if its output contains both `bound: yes` and
   `service: running`. Otherwise report the output as it is and stop. On Linux, also pass on the hint about
   `loginctl enable-linger` if the script printed it.

3. **Make sure the Agent CLI is installed.** Run:

   ```sh
   ~/.local/bin/gg agents
   ```

   It lists Node.js and every Agent CLI with its version and path. If the row of your agent shows a path and a
   version, go on to step 4. If it says 未安装 / not installed (or the path does not exist), install it:

   ```sh
   ~/.local/bin/gg agents install <agent>
   ```

   This installs it (and Node.js when needed) under `~/.gonggong` from a mirror reachable in mainland China; no sudo.
   For `antigravity` and `goose` it prints the official install command instead: show it to the user and run it only
   after they agree. Run `~/.local/bin/gg agents` again to confirm; `gg` notices the new CLI within a minute.

4. **Sign the Agent CLI in.** The bot uses the CLI's own account on this machine, and signing in is interactive, so
   the user does it. Unless you are this CLI and know it is already signed in, ask the user to open a Terminal on
   this machine, run the command below, finish signing in, then quit the CLI:

   | Agent | Run | Then |
   | --- | --- | --- |
   | `claude` | `claude` then `/login` | sign in in the browser |
   | `codex` | `codex login --device-auth` | open the link and enter the code |
   | `gemini` | `gemini` then `/auth` | choose Gemini API Key and paste the key |
   | `codebuddy` | `codebuddy` then `/login` | sign in with WeChat, Google/GitHub or a company account |
   | `pi` | `pi` then `/login` | pick a provider or enter an API key |
   | `deepseek` | `dsh web` | enter the DeepSeek API key under 模型 (or set `DEEPSEEK_API_KEY`) |
   | `antigravity` | `agy` | sign in with Google (no browser: `agy acp --login`) |
   | `opencode` | `opencode auth login` | pick a provider and sign in or paste an API key |
   | `qwen` | `qwen` then `/auth` | choose Qwen OAuth or enter an API key |
   | `kimi` | `kimi` then `/login` | sign in in the browser |
   | `goose` | `goose configure` | Configure Providers, pick a provider and enter its API key |
   | `copilot` | `copilot login` | open the link and enter the code |

   The web can help too: on this machine's page (step 5), the Agent 与供应商 tab shows whether each CLI is signed in,
   can open the login in a terminal on this machine, and for most agents lets the user add a model provider (an API
   key) instead of the CLI's own account.

5. **Check it on the web.** Tell the user to open {{SERVER}}/machines (我的电脑): this machine should show 在线
   (online). Clicking it shows the machine's details; the Agent 与供应商 tab lists the Agent CLIs `gg` found. The new
   bot, named after the user and the agent (for example 王磊的 CodeBuddy), is in the left 消息 (Messages) list as a
   direct chat; if the 绑定新机器 dialog was open during step 2, the web already opened it.

6. **Start the first conversation.** Tell the user to open that direct chat and send a first message, for example
   「你好，介绍一下你能帮我做什么」. A reply means everything works. If the reply is an error about signing in, an API
   key or a missing CLI, go back to step 4 or 3. After that, they can add the bot to any group and @ it there to
   hand it work.

7. **Wrap up** in the user's language with a short checklist: machine connected (bound and running), which Agent CLI
   the bot uses and whether it is signed in, where to see it on the web, and how to start chatting. If
   `~/.local/bin` is not on their PATH, mention they can run `~/.local/bin/gg`.
