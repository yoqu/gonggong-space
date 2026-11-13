# Deployment overview

This page covers the components of the Gonggong Space server side, the ports each one uses, the recommended minimal deployment topology, and the software the server needs.

## Components

| Component | Description |
| --- | --- |
| server | `apps/server`, Node.js (Fastify). Provides the `/api` endpoints, WebSockets for browsers and daemons, attachment storage, the preview entry point, and client downloads. **It does not serve the web app's static files** |
| web | `apps/web`, a React single-page app. `vite build` produces plain static files in `apps/web/dist/`, hosted by Nginx or another web server |
| PostgreSQL | The only database. The schema is migrated automatically when the server starts |
| Data directory | `GONGGONG_DATA_DIR`: encrypted attachments, managed artifacts, avatars, force-synced files, base-branch mirrors, client installers, the LiveKit binary, and so on |
| LiveKit (optional) | Media server for 「实时画面」 (live view) previews. By default the server starts a local `livekit-server` child process the first time it's needed; you can also point it at an external LiveKit |
| daemon | Runs on **members' machines**, not on the server. See [Command line `gg`](/en/cli/) and [Desktop app](/en/desktop/) |

The server is designed as a **single instance**: browser real-time pushes, daemon connections, and preview tunnels all live in process memory. Don't run multiple server instances behind a load balancer.

## Ports

| Port | Listener | Accessed by | Notes |
| --- | --- | --- | --- |
| 443 (plus redirect from 80) | Nginx | Browsers, daemons | The only public entry point |
| 8787 | server | Nginx | Listens on `127.0.0.1` only by default; change with `HOST` / `PORT` |
| 5432 | PostgreSQL | server | Default port for a self-managed database; the development `pnpm db:up` uses 54329 |
| 41000–41099 | server | Browsers | Used only by the preview "port mode"; each open preview takes one port. Wildcard-domain mode doesn't use them. See [Reverse proxy and preview domains](/en/deploy/reverse-proxy) |
| 7881/TCP, 7882/UDP | livekit-server | Browsers, daemons | Needed only for live view; must be directly reachable by browsers and members' machines (not through Nginx) |

## Minimal deployment topology

A single server can run every server-side component:

```text
                   ┌──────────────────────── 服务器 ────────────────────────┐
 浏览器 ─┐          │                                                        │
         │  HTTPS   │  Nginx :443                                            │
         ├────────→ │   ├─ /                → apps/web/dist（静态文件）       │
 成员机器 │  WSS     │   ├─ /api /ws /livekit /downloads → server 127.0.0.1:8787 │
 daemon ─┘          │   └─ *.预览域名       → server（按 Host 分流到预览）   │
                    │                                                        │
                    │  server ──→ PostgreSQL                                 │
                    │     └────→ 数据目录 GONGGONG_DATA_DIR                   │
                    └────────────────────────────────────────────────────────┘
```

(Diagram labels: 服务器 = server, 浏览器 = browser, 成员机器 = member machine, 静态文件 = static files, 预览域名 = preview domain, 按 Host 分流到预览 = routed to previews by Host, 数据目录 = data directory.)

- Nginx handles HTTPS, hosts the web app's static files, and reverse-proxies `/api`, `/ws`, `/livekit`, and `/downloads` to the server.
- The daemon on members' machines connects to the server through the same domain: `/api/daemon/*`, `/ws/daemon` (main connection), `/ws/daemon/tunnel` (preview tunnel), and `/downloads/*` (installation and auto-upgrade).
- When members' machines and the server are not the same machine, the daemon can connect only over `https://` and verifies the certificate. See [HTTPS and certificates](/en/deploy/https).
- Configure a separate wildcard preview domain only when people outside the team need to open web previews built by Bots.

For the actual configuration, see [Reverse proxy and preview domains](/en/deploy/reverse-proxy).

::: tip Trying it out on a LAN
For a LAN-only trial you can skip Nginx: start with `pnpm dev:server` + `pnpm dev:web`, and the web dev server proxies `/api`, `/ws`, and `/livekit` to the server. The daemon only allows `http://` for a server on the same machine; for other members' machines to connect, you must set up a self-signed certificate and bind with its fingerprint. See [HTTPS and certificates](/en/deploy/https#option-2-lan-self-signed-certificate). You can also use the [Docker deployment](/en/deploy/docker).
:::

## Software requirements

| Software | Requirement |
| --- | --- |
| Operating system | Linux or macOS |
| Node.js | 24 or later |
| pnpm | Enable it with `corepack enable`; the version is pinned by the root `package.json` |
| PostgreSQL | 17 recommended |
| git | The server uses it to maintain base-branch mirrors of group repositories (`@` file suggestions and file search), so it needs access to the group repositories. See [Deploy from source](/en/deploy/install#repository-access-credentials) |
| Nginx | Or any other web server that can reverse-proxy WebSockets |
| openssl | Needed to generate a self-signed certificate |
| livekit-server | Optional. On Linux and Windows (x86_64 / arm64) the server automatically downloads and verifies the official release from GitHub; you can also install it yourself and point to it with `GONGGONG_LIVEKIT_BIN` |

The server doesn't need Claude Code, Codex, or Rust. Those are needed only on members' machines (or on the machine that builds the clients).

::: warning Disk encryption
Attachments, diffs, and run details are stored encrypted in the database or on disk, but the base-branch mirrors (`mirrors/` under the data directory) are plaintext git repositories. In production, enable disk encryption on the server (such as LUKS). See [Security model](/en/deploy/security#encryption-at-rest).
:::

## Next steps

1. [Deploy from source](/en/deploy/install)
2. [Environment variables](/en/deploy/env)
3. [HTTPS and certificates](/en/deploy/https)
4. [Reverse proxy and preview domains](/en/deploy/reverse-proxy)
5. [Backup and restore](/en/deploy/backup)
