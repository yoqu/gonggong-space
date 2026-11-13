# Security model

This page summarizes the security design of Gonggong Space: who can sign in, how machines authenticate, how much a Bot can do, which data is encrypted or redacted, how previews are isolated, and which risks remain. Read it in full before deploying.

## Trust boundaries

- The **server** handles accounts, scheduling, and forwarding, and stores messages, run records, and attachments, but it **does not run Agents** and doesn't store members' model provider keys.
- The daemon on **members' machines** calls the locally signed-in Claude Code / Codex to do the actual work. A Bot's actions happen on the Bot owner's machine, and the owner is responsible for them and approves them.
- Sysadmins can manage accounts and global configuration, but **cannot** loosen command approval on a Bot owner's behalf, nor operate Agent tools and providers on other people's machines.

## Accounts and sessions

- Passwords are stored as argon2 hashes. An account is temporarily locked after 5 failed logins within 5 minutes.
- A successful login issues the session cookie `gonggong_session`: `HttpOnly`, `SameSite=Lax`, valid for 30 days; the database stores only its hash.
- The cookie's `Secure` flag: enabled automatically when the server has its own TLS configured; when Nginx terminates HTTPS you must set `GONGGONG_SECURE_COOKIES=1`.
- Changing a password invalidates all of that account's other sessions; an admin resetting a password invalidates all of that account's sessions.
- Deactivating an account immediately revokes all its sessions and machine tokens. See [Accounts and roles](/en/admin/users).
- Write requests and WebSockets initiated by the browser must come from this site (Origin matches Host); otherwise they get 「拒绝跨站请求」 ("Cross-site request refused").

## Machine authentication

- A member generates a **one-time connect code** on the web (valid for 30 minutes, invalidated once used) and runs `gg login` on the machine (or lets the desktop app or a local Agent run it) to exchange it for a long-lived machine token.
- If the connect code has expired or was already used, `gg` sends a 「接入申请」 (connection request) instead: the terminal shows a 4-digit check code and a confirmation link, and a signed-in member must verify on the web that the codes match and click allow before the machine is bound. A request is valid for 15 minutes, and one person can have at most 3 pending requests at a time; allow one only if you just started it yourself and the check code matches the terminal.
- The server stores only the token's hash; the token lives in `~/.gonggong/config.json` on the member's machine.
- Wrong connect codes and connection requests are both counted per source IP: after 10 within 10 minutes, binding is paused for 10 minutes.
- A machine token can only be used for the daemon's own endpoints and has **no permission to modify Bots**; the desktop app and `gg` have read-only access to Bot settings.
- After a machine is revoked or the account is deactivated, the token stops working immediately and the daemon cleans up the local managed workspaces.

## Transport

- The daemon must use `https://` to connect to a non-local server; `http://` is allowed only for local addresses such as `localhost` and `127.0.0.1`.
- The daemon verifies the server certificate: against the system CA store by default; for a self-signed certificate, pin the fingerprint with `--fingerprint` at bind time, and for an internal CA, specify it with `--ca-file`. A mismatched certificate is refused.
- The install script behind 「发给你的 Agent」 (Send to your agent) on the web downloads `gg` with `curl` and verifies its sha256, so it also requires the server certificate to be trusted.

See [HTTPS and certificates](/en/deploy/https).

## Bot permissions and approvals

| Mechanism | Description |
| --- | --- |
| Permission tier | Read-only / Workspace write / Full access, which decides how much a Bot can touch by default. The Full access tier only allows the 「指定名单」 (Specified list) trigger scope |
| Trigger scope | 「任何群成员」 (Any group member) / 「指定名单」 (Specified list) / 「仅本人」 (Owner only), which decides who can @ it to do work |
| Permission requests | Actions beyond the tier pop up an approval card, and **only the Bot owner** can approve or deny them; they're denied automatically on timeout (30 minutes by default, adjustable per group) |
| Command approval | 「审批方式」 (Approval): Ask me every time / Review for me / Allow everything. The setting is stored on the server, sent with every turn, and enforced locally by the daemon. **Only the Bot owner can change it**, not even a sysadmin; Bots an admin creates for someone else always start at "Ask me every time" |

See [Bot settings and permissions](/en/user/bot-settings) and [Approvals and questions](/en/user/approvals).

## Encryption at rest

Encrypted with `GONGGONG_DATA_KEY` (AES-256-GCM):

| Data | How |
| --- | --- |
| Attachment files (`attachments/` in the data directory) | Stored with streaming encryption and decrypted on download; tampered files make the download abort |
| Per-turn diffs | Encrypted, then stored in the database |
| Free text in run details (streamed output, thinking, tool details) | Encrypted, then stored in the database; type, status, tool titles, and steps stay in plaintext for search |
| Git account tokens bound by members | Encrypted, then stored in the database |
| Secrets (secret values at all four levels: platform / team / group / personal) | Encrypted, then stored in the database; injected only as environment variables at run time |
| The Feishu app's App Secret, members' Feishu login tokens | Encrypted, then stored in the database |
| Managed artifact files (`artifacts/` in the data directory), avatars (`avatars/`), force-synced files (`sync/`) | Stored encrypted |

**Not encrypted**: message bodies, run cards (steps and summaries), and approval and question records. They need full-text search and are redacted before being stored. Base-branch mirrors (`mirrors/` in the data directory) are plaintext git repositories, so **you must enable disk encryption on the server** (such as LUKS).

Key management:

- In production you must set `GONGGONG_DATA_KEY` explicitly (`openssl rand -base64 32`), and don't back it up together with the database or data directory.
- Losing the key = none of the data in the table above can be decrypted (messages and cards are unaffected).
- There's currently no automatic key rotation tool; rotating requires downtime, decrypting with the old key, and re-encrypting with the new one.

## Redaction

Run events, diffs, final replies, failure messages, approval request titles and commands, and attachment file names (not contents) are uniformly replaced with 「[已脱敏]」 ("[redacted]") before being stored. The rules are in `apps/server/src/modules/runs/redact.ts`:

- Known secret values listed in `GONGGONG_REDACT_VALUES` (comma-separated);
- Private key blocks (`-----BEGIN … PRIVATE KEY-----`);
- Common token formats: GitHub, GitLab, npm, OpenAI / Anthropic (`sk-…`), AWS access keys, Slack, Google API keys, Stripe, JWT;
- Values of request headers such as `Authorization`, `Bearer`, `X-Api-Key`, `X-Auth-Token`, `Private-Token`;
- Assignments like `password=…` and `TOKEN="…"`, and JSON fields like `"api_key": "…"` (keys containing password / passwd / secret / token / api_key, etc.);
- Hex strings of 40+ characters near secret-like keywords.

::: warning
Redaction is rule-based, so keys in unusual formats can slip through. We recommend adding your team's internal secret values to `GONGGONG_REDACT_VALUES`.
:::

## Model provider keys stay on the local machine

The model provider configuration a Bot uses (key, Base URL, default provider) is stored only locally on the member's machine. The 「供应商」 (Provider) page on the web just reads and writes it through the server, which forwards to the online daemon; the server doesn't persist it, and it isn't synced to other machines. Only the machine's owner can manage it. See [Agent tools and providers](/en/user/agents-providers).

Environment variables and request headers of MCP servers in the configuration center are stored on the server **in plaintext**. Store sensitive values as [secrets](/en/user/knowledge-secrets) and reference them in the MCP configuration with `${secret:名称}` (`名称` = the secret's name). See [Configuration center](/en/admin/config).

## Plugin code

Plugins can bring code that runs on the executing machine, such as local MCP servers. The system parameter 「插件代码」 (Plugin code) is off by default; when it's on, each plugin version still has to be authorized one by one by the machine's owner on their own machine before it runs. See [System parameters](/en/admin/params) and [Market and plugins](/en/user/market-plugins).

## Preview isolation

Bot preview pages are written by an Agent and should be treated as untrusted content:

- **Wildcard-domain mode** (recommended): previews live under a separate registrable domain, different from the main site's, so the browser doesn't send them the main site's cookies and they can't read or write those cookies.
- **Port mode**: previews share the main site's host name on a different port, so the browser does send the main site's cookies. The server strips cookies before forwarding and rejects cross-site write requests and WebSockets, but isolation isn't as thorough as wildcard-domain mode; we recommend it only on a LAN.
- Tunnels can only reach preview ports registered by the daemon and read-only workspace files, not other ports on the member's machine.
- Opening a preview requires signing in and being a member of the group; public links must have an expiry (the maximum is a system parameter), can be revoked at any time, and every access is recorded in the audit log.

For configuration, see [Reverse proxy and preview domains](/en/deploy/reverse-proxy).

## Audit

Admin actions (accounts, managing Bots on others' behalf, revoking machines, MCP, system parameters, group management, client releases), approvals, questions, `/stop`, `/cd`, `/new`, and the creation and access of public links are all written to the audit log and **kept forever**. See [Audit log](/en/admin/audit).

## Data retention

| Data | Retention |
| --- | --- |
| Full run details and diffs | 30 days after the run ends by default (system parameter 「完整运行过程保留」 (Keep full run details for)); deleted when expired, card summaries are kept |
| Previews | Closed automatically after 24 consecutive hours without visits by default |
| Public links | The expiry set at creation, 30 days at most by default |
| Sessions | 30 days |
| Audit log, messages | Forever |
| Server backups | `backup.sh` keeps the latest 7 plus the latest one for each of the last 7 days |

## Residual risks

- Anyone with both `GONGGONG_DATA_KEY` and the database can decrypt all encrypted data; plaintext is visible in the server process's memory.
- Messages, cards, and approval commands are redacted but stored in plaintext.
- Setting `GONGGONG_INSECURE_DEV=1` on a member's machine disables certificate verification; use it only for local development.
- Without disk encryption, base-branch code is written to disk in plaintext.
- Attachment integrity is checked only when the end of the file is read, so tampering shows up as an aborted download rather than an upfront rejection.
- When the server sits behind a reverse proxy, per-IP rate limits are shared by everyone. See [Reverse proxy · Client IP](/en/deploy/reverse-proxy#client-ip).

## Related pages

- [HTTPS and certificates](/en/deploy/https)
- [Reverse proxy and preview domains](/en/deploy/reverse-proxy)
- [Backup and restore](/en/deploy/backup)
- [Audit log](/en/admin/audit)
