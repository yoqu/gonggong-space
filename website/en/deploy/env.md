# Environment variables

This page lists every environment variable read by the server, the web dev server, and the ops scripts. The server does not read `.env` files; pass variables through systemd's `EnvironmentFile` or the process environment.

## server

### Basics

| Variable | Default | Description |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Server listen address |
| `PORT` | `8787` | Server listen port |
| `GONGGONG_DATABASE_URL` | None | PostgreSQL connection string, such as `postgres://gonggong:password@127.0.0.1:5432/gonggong`. When set, the next two are ignored |
| `GONGGONG_DB` | `gonggong` | Database name used when no connection string is set (connects to `postgres://gonggong@127.0.0.1:<port>/<database>`) |
| `GONGGONG_PG_PORT` | `54329` | Port used when no connection string is set; matches the development `pnpm db:up` |
| `GONGGONG_DATA_DIR` | `.gonggong-dev/data` | Data directory for encrypted attachments (`attachments/`), base-branch mirrors (`mirrors/`), client installers (`downloads/`), the LiveKit binary, and so on. The default is relative to the server's working directory; use an absolute path in production |
| `GONGGONG_ADMIN_PASSWORD` | None | When the database has no accounts, used to create the sysadmin `admin` (password must be changed on first login). Has no effect once accounts exist |
| `GONGGONG_LOG` | Off | Set to `1` to log every request |

### Security

| Variable | Default | Description |
| --- | --- | --- |
| `GONGGONG_DATA_KEY` | Auto-generated in development | Encryption-at-rest key: base64 of 32 random bytes (`openssl rand -base64 32`). If unset, `.gonggong-dev/data.key` is generated in the working directory. **Must be set explicitly in production** |
| `GONGGONG_TLS_CERT` | None | Path to the certificate file (PEM). Must be set together with `GONGGONG_TLS_KEY`; once set, the server serves HTTPS/WSS only |
| `GONGGONG_TLS_KEY` | None | Path to the private key file (PEM) |
| `GONGGONG_SECURE_COOKIES` | Off | Set to `1` to add `Secure` to the session cookie. Enabled automatically when the server has its own TLS configured; **must be set to `1` manually when Nginx terminates HTTPS** |
| `GONGGONG_REDACT_VALUES` | Empty | Comma-separated known secret values, always replaced with 「[已脱敏]」 ("[redacted]") before being stored. See [Security model](/en/deploy/security#redaction) |
| `GIT_SSH_COMMAND` | `ssh -o BatchMode=yes` | The ssh command git uses when the server maintains base-branch mirrors. Can point at a deploy key, such as `ssh -i /etc/gonggong/deploy_key -o IdentitiesOnly=yes` |

### Previews

| Variable | Default | Description |
| --- | --- | --- |
| `GONGGONG_PUBLIC_URL` | None | The address browsers use to reach the main site, such as `https://gg.example.com`. Used to build the scheme of preview URLs and to send signed-out preview visitors to the main site to sign in. **Must be set when behind a reverse proxy** |
| `GONGGONG_PREVIEW_DOMAIN` | None | Enables wildcard-domain mode; preview URLs become `<random id>.<preview domain>`. Must be a separate registrable domain, different from the main site's |
| `GONGGONG_PREVIEW_PORTS` | `41000-41099` | Port range available to previews in port mode, formatted `start-end` |
| `GONGGONG_PREVIEW_HOST` | Same as `HOST` | Listen address for preview ports in port mode; set to `0.0.0.0` to let LAN members reach preview ports directly |

For the difference between the two modes and how to configure them, see [Reverse proxy and preview domains](/en/deploy/reverse-proxy).

### Live view (LiveKit)

| Variable | Default | Description |
| --- | --- | --- |
| `LIVEKIT_URL` | None | External LiveKit address. Must be set together with the next two; once set, the local livekit-server is no longer started automatically |
| `LIVEKIT_API_KEY` | None | API key of the external LiveKit |
| `LIVEKIT_API_SECRET` | None | API secret of the external LiveKit |
| `GONGGONG_LIVEKIT_BIN` | Auto-detected | Path to the local livekit-server binary. If unset, the server looks for a previously downloaded one in the data directory, then one on `PATH`, and finally downloads the official release from GitHub (Linux / Windows only) |
| `GONGGONG_LIVEKIT_TCP_PORT` | `7881` | TCP media port of the local livekit-server |
| `GONGGONG_LIVEKIT_UDP_PORT` | `7882` | UDP media port of the local livekit-server |
| `GONGGONG_LIVEKIT_NODE_IP` | None | The IP clients should use to reach the media ports. Set it to the public IP when the server is behind NAT and its local interface address isn't reachable by clients |

The local livekit-server's signaling listens only on the loopback address and is forwarded through the server's `/livekit` path; the two media ports must be open to browsers and members' machines.

### Other

| Variable | Default | Description |
| --- | --- | --- |
| `GONGGONG_HEARTBEAT_SEC` | System parameter 「机器心跳间隔」 (Machine heartbeat interval) | Daemon heartbeat interval (seconds). Takes precedence over the system parameter; read at startup |
| `GONGGONG_PUSH_SUBJECT` | `mailto:gonggong@example.com` | Contact for browser push notifications (Web Push); we recommend changing it to the admin's email |

## Web dev server

Only read when running the web dev server with `pnpm dev:web`. Production uses the build output and doesn't need these.

| Variable | Default | Description |
| --- | --- | --- |
| `WEB_HOST` | `127.0.0.1` | Listen address; set to `0.0.0.0` for LAN access |
| `WEB_PORT` | `5173` | Listen port |
| `GONGGONG_SERVER` | `http(s)://127.0.0.1:8787` | Target server for proxying `/api`, `/ws`, and `/livekit` |
| `GONGGONG_TLS_CERT` / `GONGGONG_TLS_KEY` | None | Share the same certificate as the server; when set, the web app is served over HTTPS |

## Ops scripts

| Variable | Used by | Description |
| --- | --- | --- |
| `GONGGONG_BACKUP_DIR` | `backup.sh`, `restore.sh` | Backup directory (required). See [Backup and restore](/en/deploy/backup) |
| `GONGGONG_DATABASE_URL`, `GONGGONG_DB`, `GONGGONG_PG_PORT`, `GONGGONG_DATA_DIR` | Backup scripts, `release.sh --publish` | Same meaning as for the server |
| `GONGGONG_ADMIN_PASSWORD` | `release.sh --publish` | Signs in as an admin to publish (required) |
| `GONGGONG_ADMIN_ACCOUNT` | `release.sh --publish` | Admin account used for publishing; defaults to `admin` |
| `GONGGONG_CACERT` | `release.sh --publish` | Certificate file to trust when the server uses a self-signed certificate |
| `GONGGONG_DOWNLOAD_BASE` | `release.sh` | Download URL prefix when installers are hosted on a CDN; defaults to `/downloads` |

For environment variables read by the daemon (`gg` on members' machines), such as `GONGGONG_HOME` and `GONGGONG_NO_AUTO_UPGRADE`, see [Command reference](/en/cli/reference) and [Local data and logs](/en/cli/local-data).

## Related pages

- [Deploy from source](/en/deploy/install)
- [System parameters](/en/admin/params)
