# Environment variables

This page lists every environment variable read by the server, the web dev server, and the ops scripts. The server doesn't read `.env` files; pass variables through systemd's `EnvironmentFile` or the process environment.

## server

### Basics

| Variable | Default | Description |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Server listen address |
| `PORT` | `8787` | Server listen port |
| `GONGGONG_DATABASE_URL` | none | PostgreSQL connection string, such as `postgres://gonggong:密码@127.0.0.1:5432/gonggong` (`密码` = password). When set, the next two are ignored |
| `GONGGONG_DB` | `gonggong` | Database name used when no connection string is set (connects to `postgres://gonggong@127.0.0.1:<端口>/<库名>`, i.e. port and database name) |
| `GONGGONG_PG_PORT` | `54329` | Port used when no connection string is set; matches the development `pnpm db:up` |
| `GONGGONG_DATA_DIR` | `.gonggong-dev/data` | Data directory for encrypted attachments (`attachments/`), base-branch mirrors (`mirrors/`), client installers (`downloads/`), the LiveKit binary, and so on. The default is relative to the server's working directory; use an absolute path in production |
| `GONGGONG_ADMIN_PASSWORD` | none | When the database has no accounts, creates the sysadmin `admin` with this password (must be changed at first login). No effect once accounts exist |
| `GONGGONG_LOG` | off | Set to `1` to log every request |

### Security

| Variable | Default | Description |
| --- | --- | --- |
| `GONGGONG_DATA_KEY` | auto-generated in development | Encryption-at-rest key: base64 of 32 random bytes (`openssl rand -base64 32`). If unset, `.gonggong-dev/data.key` is generated in the working directory. **Must be set explicitly in production** |
| `GONGGONG_TLS_CERT` | none | Path to the certificate file (PEM). Must be set together with `GONGGONG_TLS_KEY`; when set, the server serves only HTTPS/WSS |
| `GONGGONG_TLS_KEY` | none | Path to the private key file (PEM) |
| `GONGGONG_SECURE_COOKIES` | off | Set to `1` to add `Secure` to the session cookie. Enabled automatically when the server has its own TLS; **must be set to `1` manually when Nginx terminates HTTPS** |
| `GONGGONG_REDACT_VALUES` | empty | Comma-separated known secret values, always replaced with 「[已脱敏]」 ("[redacted]") before being stored. See [Security model](/en/deploy/security#redaction) |
| `GIT_SSH_COMMAND` | `ssh -o BatchMode=yes` | The ssh command git uses when the server maintains base-branch mirrors; can specify a deploy key, such as `ssh -i /etc/gonggong/deploy_key -o IdentitiesOnly=yes` |

### Previews

| Variable | Default | Description |
| --- | --- | --- |
| `GONGGONG_PUBLIC_URL` | none | The address browsers use to reach the main site, such as `https://gg.example.com`. Used for the scheme of preview URLs and to send signed-out preview visitors to the main site to sign in. **Required behind a reverse proxy** |
| `GONGGONG_PREVIEW_DOMAIN` | none | When set, enables wildcard-domain mode with preview URLs like `<随机标识>.<预览域名>` (random ID + preview domain). Must be a separate registrable domain, different from the main site's |
| `GONGGONG_PREVIEW_PORTS` | `41000-41099` | Port range available to previews in port mode, formatted `start-end` |
| `GONGGONG_PREVIEW_HOST` | same as `HOST` | Listen address for preview ports in port mode; set to `0.0.0.0` to let members on the LAN reach preview ports directly |

For the difference between the two modes and how to configure them, see [Reverse proxy and preview domains](/en/deploy/reverse-proxy).

### Live view (LiveKit)

| Variable | Default | Description |
| --- | --- | --- |
| `LIVEKIT_URL` | none | External LiveKit URL. Must be set together with the next two; when set, the local livekit-server is no longer started automatically |
| `LIVEKIT_API_KEY` | none | External LiveKit API key |
| `LIVEKIT_API_SECRET` | none | External LiveKit API secret |
| `GONGGONG_LIVEKIT_BIN` | auto-detected | Path to the local livekit-server binary. If unset, the server looks for one previously downloaded into the data directory, then one on `PATH`, and finally downloads the official release from GitHub (Linux / Windows only) |
| `GONGGONG_LIVEKIT_TCP_PORT` | `7881` | TCP media port of the local livekit-server |
| `GONGGONG_LIVEKIT_UDP_PORT` | `7882` | UDP media port of the local livekit-server |
| `GONGGONG_LIVEKIT_NODE_IP` | none | The IP clients should use for the media ports. Set it to the public IP when the server is behind NAT and its local interface address isn't reachable by clients |

The local livekit-server's signaling listens only on loopback and is forwarded through the server's `/livekit` path; the two media ports must be open to browsers and members' machines.

### Other

| Variable | Default | Description |
| --- | --- | --- |
| `GONGGONG_HEARTBEAT_SEC` | system parameter 「机器心跳间隔」 (Machine heartbeat interval) | Daemon heartbeat interval in seconds; takes precedence over the system parameter and is read at startup |
| `GONGGONG_PUSH_SUBJECT` | `mailto:gonggong@example.com` | Contact for browser push notifications (Web Push); we recommend changing it to the admin's email |
| `GONGGONG_BOT_EMAIL_DOMAIN` | `bots.gonggong.local` | Domain of the default author email when Bots commit code; the email looks like `<Bot 标识前 8 位>@<域名>` (first 8 characters of the Bot ID @ domain). A Git email set on the Bot itself takes precedence |

::: tip GONGGONG_PUBLIC_URL vs. 「对外地址」 (Public URL)
`GONGGONG_PUBLIC_URL` is used only for previews. 「对外地址」 (Public URL, a system parameter) on the admin console's 「飞书」 (Feishu) page serves other purposes: links in Feishu cards and login callbacks, and the server address in the install script used by the 「发给你的 Agent」 (Send to your agent) setup. When it isn't set, Feishu login is unavailable and the install script uses the address of the request. Behind a reverse proxy, we recommend setting both to the main site address.
:::

## Web dev server

Read only when running the web dev server with `pnpm dev:web`. Production uses the build output and doesn't need these.

| Variable | Default | Description |
| --- | --- | --- |
| `WEB_HOST` | `127.0.0.1` | Listen address; set to `0.0.0.0` for LAN access |
| `WEB_PORT` | `5173` | Listen port |
| `GONGGONG_SERVER` | `http(s)://127.0.0.1:8787` | Target server for proxying `/api`, `/ws`, and `/livekit` |
| `GONGGONG_TLS_CERT` / `GONGGONG_TLS_KEY` | none | Share the same certificate as the server; when set, the web app is served over HTTPS |

## Ops scripts

| Variable | Used by | Description |
| --- | --- | --- |
| `GONGGONG_BACKUP_DIR` | `backup.sh`, `restore.sh` | Backup directory (required). See [Backup and restore](/en/deploy/backup) |
| `GONGGONG_DATABASE_URL`, `GONGGONG_DB`, `GONGGONG_PG_PORT`, `GONGGONG_DATA_DIR` | backup scripts, `release.sh --publish` | Same meaning as for the server |
| `GONGGONG_ADMIN_PASSWORD` | `release.sh --publish`, `release/publish.sh server` | Sign in as an admin to publish (required) |
| `GONGGONG_ADMIN_ACCOUNT` | `release.sh --publish`, `release/publish.sh server` | Admin account used for publishing; default `admin` |
| `GONGGONG_CACERT` | `release.sh --publish` | Certificate file to trust when the server uses a self-signed certificate |
| `GONGGONG_DOWNLOAD_BASE` | `release.sh` | Download URL prefix when installers are hosted on a CDN; default `/downloads` |

For environment variables read by the daemon (`gg` on members' machines), such as `GONGGONG_HOME` and `GONGGONG_NO_AUTO_UPGRADE`, see [Command reference](/en/cli/reference) and [Local data and logs](/en/cli/local-data). For variables of Docker member machines, see [Docker deployment](/en/deploy/docker).

## Related pages

- [Deploy from source](/en/deploy/install)
- [System parameters](/en/admin/params)
