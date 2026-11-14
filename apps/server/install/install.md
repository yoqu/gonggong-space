# Connect this machine to Gonggong (共工空间)

You are an AI agent on the user's computer. The user asked you to connect this machine to the Gonggong workspace at
{{SERVER}} so that you can work there as their bot. Follow these steps exactly.

## Rules

- Install only into the user's home directory. Never use sudo and never change system settings.
- Download the script first, look at it, then run it. Do not pipe a download straight into a shell.
- Report only what the commands printed. If a step fails, stop and show the user the exact error output; do not
  guess, retry with other options or claim success.
- The 接入码 (one-time code, `XXXX-XXXX`) is in the user's message. It is valid for 30 minutes; if it has expired
  or was already used, that is fine: `gg login` then asks the user to allow this machine in the web page instead
  (see step 3).
- If the script says the machine is already bound to another server, stop and ask the user; never delete or edit
  `~/.gonggong` yourself.
- This works on macOS and Linux. On Windows, tell the user to use the desktop app from the 绑定新机器 page instead.

## Steps

1. Decide which agent you are: `claude` (Claude Code), `codex` (Codex), `gemini` (Gemini CLI), `codebuddy`
   (CodeBuddy), `pi`, `deepseek` (DeepSeek Harness) or `antigravity` (Antigravity CLI, `agy`). The bot created for the user runs on this agent.
2. Download the installer:

   ```sh
   curl -fsSL {{SERVER}}/api/install.sh -o /tmp/gonggong-install.sh
   ```

3. Run it with the code and your agent:

   ```sh
   sh /tmp/gonggong-install.sh --code <接入码> --agent <your agent>
   ```

   It downloads `gg`, checks its sha256, installs it to `~/.local/bin/gg`, binds this machine to the user's account
   (`gg login`), creates the bot and a direct chat with it, and starts `gg` as a background service that also starts
   at login (`gg service install`).

   If the output shows a confirmation link and a 4-character check code (核对码) and says it is waiting (you may only
   see this once the command returns or times out), tell the user right away, word for word: open that link in their browser, check that the page shows the same code, and click
   允许接入 (Allow). Keep the command running while you wait. If your command times out before the user allows it,
   run the same command again: it does not reinstall `gg` and keeps waiting on the same request.
4. Confirm: the script ends with `gg status`. The machine is connected only if its output contains both
   `bound: yes` and `service: running`. Otherwise report the output as it is. On Linux, also pass on the hint about
   `loginctl enable-linger` if the script printed it.
5. Tell the user, in their language, that the machine is connected and that the chat with their new bot is open in
   the Gonggong web page. If `~/.local/bin` is not on their PATH, mention they can run `~/.local/bin/gg`.
