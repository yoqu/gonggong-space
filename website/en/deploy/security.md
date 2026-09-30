# Security model

This page summarizes the security design of Gonggong Space: who can sign in, how machines authenticate, how much a Bot can do, what data is encrypted or redacted, how previews are isolated, and which risks remain. Read it in full before deploying.

## Trust boundaries

- The **server** handles accounts, scheduling, and forwarding, and stores messages, run records, and attachments, but it **does not run Agents** and does not store members' model provider keys.
- The daemon on **members' machines** calls the locally signed-in Claude Code / Codex to do the actual work. A Bot's actions happen on the Bot owner's machine, and the owner is responsible for approving them.
- Sysadmins can manage accounts and global configuration, but **cannot** loosen command approval on a Bot owner's behalf, nor operate Agent tools and providers on other people's machines.

## Accounts and sessions

- Passwords are stored as argon2 hashes. An account is temporarily locked after 5 failed logins within 5 minutes.
- A successful login issues the session cookie `gonggong_session`: `HttpOnly`, `SameSite=Lax`, valid for 30 days; the database stores only its hash.
- The cookie's `Secure` flag is enabled automatically when the server has its own TLS configured; when Nginx terminates HTTPS you must set `GONGGONG_SECURE_COOKIES=1`.
- Changing a password invalidates all of that account's other sessions; an admin resetting a password invalidates all of that account's sessions.
- Deactivating an account immediately revokes all its sessions and machine tokens. See [Accounts and roles](/en/admin/users#deactivate-and-reactivate).
- Write requests and WebSockets initiated by the browser must come from this site (Origin matches Host); otherwise they get 「拒绝跨站请求」 ("cross-site request rejected").

## Machine authentication

- A member generates a **one-time bind code** on the web (valid for 10 minutes, invalidated once used) and runs `gg login` on the machine to exchange it for a long-lived machine token.
- The server stores only the token's hash; the token lives in `~/.gonggong/config.json` on the member's machine.
- Wrong bind codes are rate-limited by source IP: after 10 wrong attempts within 10 minutes, binding is paused for 10 minutes.
- A machine token can only be used for the daemon's own endpoints and has **no permission to modify Bots**; the desktop app and `gg` have read-only access to Bot settings.
- After a machine is revoked or the account is deactivated, the token stops working immediately and the daemon cleans up the local managed workspaces.

## Transport and certificate pinning

- The daemon only connects to non-local servers over `https://`; `http://` is limited to loopback addresses.
- The daemon pins the SHA-256 fingerprint of the server's leaf certificate instead of relying on the CA chain, and refuses to connect on a mismatch. Binding for the first time without a fingerprint is "trust on first use": always check against the fingerprint published by the admin, or bind with `--fingerprint` / a connect link.
- After a certificate change (including auto-renewal), members must rebind.

See [HTTPS and certificates](/en/deploy/https) for details.

## Bot permissions and approval

| Mechanism | Description |
| --- | --- |
| Permission tier | Read-only / Workspace write / Full access; determines how much a Bot can touch by default. The Full access tier only allows the 「指定名单」 (Specified list) trigger scope |
| Trigger scope | Any group member / Specified list / Only me; determines who can @ it to do work |
| Permission request | Operations beyond the tier pop up an approval card that **only the Bot owner** can approve or deny; if it times out (30 minutes by default, adjustable per group) it's denied automatically |
| Command approval | Ask every time / Auto for allowlist / Auto for all. The setting is stored on the server, sent with each turn, and enforced locally by the daemon. **Only the Bot owner can change it**, not even a sysadmin; Bots that an admin creates for someone else always start at 「每次询问」 (Ask every time) |

See [Bot settings and permissions](/en/user/bot-settings) and [Approvals and questions](/en/user/approvals) for details.

## Encryption at rest

Encrypted with `GONGGONG_DATA_KEY` (AES-256-GCM):

| Data | How |
| --- | --- |
| Attachment files (`attachments/` in the data directory) | Stored with streaming encryption, decrypted on download; if a file has been tampered with, the download aborts |
| Per-turn diffs | Encrypted before being stored in the database |
| Free text in run processes (streaming output, thinking, tool details) | Encrypted before being stored in the database; type, status, tool titles, and steps stay plaintext so they can be searched |
| Git account tokens bound by members | Encrypted before being stored in the database |

**Not encrypted**: message bodies, run cards (steps and summaries), and approval and question records—they need full-text search and are redacted before being stored. The base-branch mirrors (`mirrors/` in the data directory) are plaintext git repositories, so you **must enable disk encryption on the server** (such as LUKS).

Key management:

- In production you must set `GONGGONG_DATA_KEY` explicitly (`openssl rand -base64 32`) and not back it up together with the database or data directory.
- Losing the key = attachments, diffs, and run processes can no longer be decrypted (messages and cards are unaffected).
- There's currently no automatic key rotation tool; rotating requires downtime, decrypting with the old key, and re-encrypting with the new one.

## Redaction

Run events, diffs, final replies, failure messages, approval request titles and commands, and attachment file names (not contents) are all replaced with 「[已脱敏]」 ("[redacted]") before being stored. The rules are in `apps/server/src/modules/runs/redact.ts`:

- Known secret values listed in `GONGGONG_REDACT_VALUES` (comma-separated);
- Private key blocks (`-----BEGIN … PRIVATE KEY-----`);
- Common token formats: GitHub, GitLab, npm, OpenAI / Anthropic (`sk-…`), AWS access keys, Slack, Google API keys, Stripe, JWT;
- Values of headers such as `Authorization`, `Bearer`, `X-Api-Key`, `X-Auth-Token`, and `Private-Token`;
- Assignments like `password=…` and `TOKEN="…"`, and JSON fields like `"api_key": "…"` (key names containing password / passwd / secret / token / api_key, and so on);
- Hex strings of 40+ characters near secret-related keywords.

::: warning
Redaction is rule-based, so keys in unusual formats may slip through. Add team-internal secret values to `GONGGONG_REDACT_VALUES`.
:::

## Model provider keys stay on the local machine

The model provider configuration a Bot uses (key, base URL, default provider) is stored only locally on the member's machine. The 「供应商」 (Providers) page on the web just reads and writes it through the server, which forwards to the online daemon; the server doesn't persist it, and it isn't synced to other machines. Only the machine's owner can manage it. See [Agent tools and providers](/en/user/agents-providers).

By contrast, environment variables and request headers for global-level MCP in the configuration center are stored on the server in **plaintext**. See [Configuration center](/en/admin/config).

## Preview isolation

A Bot's preview pages are written by an Agent and should be treated as untrusted content:

- **Wildcard-domain mode** (recommended): previews live under a separate registrable domain, different from the main site's. The browser doesn't send the main site's cookies to them, and they can't read or write the main site's cookies.
- **Port mode**: previews share the main site's hostname on a different port, so the browser includes the main site's cookies. The server strips cookies before forwarding and rejects cross-site write requests and WebSockets, but the isolation isn't as thorough as wildcard-domain mode; recommended only on a LAN.
- The tunnel can only reach preview ports registered by the daemon and read-only workspace files, not other ports on the member's machine.
- Viewing a preview requires signing in and being a member of that group. Public links must have an expiry (the maximum is set in system parameters), can be revoked at any time, and every visit is recorded in the audit log.

For configuration, see [Reverse proxy and preview domains](/en/deploy/reverse-proxy).

## Audit

Admin actions (accounts, managing Bots for others, revoking machines, MCP, system parameters, group management, client releases), approvals, questions, `/stop`, `/cd`, `/new`, and the creation and visits of public links are all written to the audit log and **kept forever**. See [Audit log](/en/admin/audit).

## Data retention

| Data | Retention |
| --- | --- |
| Full run processes and diffs | 30 days after the run ends by default (system parameter 「完整运行过程保留」 (Full run process retention)); deleted on expiry, card summaries kept |
| Previews | Closed automatically after 24 consecutive hours without visits by default |
| Public links | The expiry set at creation; 30 days maximum by default |
| Sessions | 30 days |
| Audit log, messages | Forever |
| Server backups | `backup.sh` keeps the latest 7 |

## Residual risks

- Anyone with both `GONGGONG_DATA_KEY` and the database can decrypt all encrypted data; plaintext is visible in the server process's memory.
- Messages, cards, and approval commands are redacted but stored in plaintext.
- If a first-use binding (without a fingerprint) happens to meet a man in the middle, the wrong certificate gets pinned—always verify the fingerprint.
- Without disk encryption, base-branch code is written to disk in plaintext.
- Attachment integrity is only checked when reading reaches the end, so tampering shows up as an aborted download rather than an upfront rejection.
- When the server is behind a reverse proxy, IP-based rate limits are shared by everyone. See [Reverse proxy · Client IP](/en/deploy/reverse-proxy#client-ip).

## Related pages

- [HTTPS and certificates](/en/deploy/https)
- [Reverse proxy and preview domains](/en/deploy/reverse-proxy)
- [Backup and restore](/en/deploy/backup)
- [Audit log](/en/admin/audit)
