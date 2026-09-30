# Deployment overview

This page covers the components that make up the Gonggong Space server side, the ports each one uses, the recommended minimal deployment topology, and the software the server needs.

## Components

| Component | Description |
| --- | --- |
| server | `apps/server`, Node.js (Fastify). Serves the `/api` endpoints, the WebSockets for browsers and daemons, attachment storage, the preview entry point, and client downloads. **It does not serve the web app's static files** |
| web | `apps/web`, a React single-page app. `vite build` produces plain static files in `apps/web/dist/`, hosted by Nginx or another web server |
| PostgreSQL | The only database. The schema is migrated automatically when the server starts |
| Data directory | `GONGGONG_DATA_DIR`: encrypted attachments, base-branch mirrors, client installers, the LiveKit binary, and so on |
| LiveKit (optional) | Media server used by the 「实时画面」 (live view) preview. By default the server starts a local `livekit-server` child process on first use; you can also connect an external LiveKit |
| daemon | Runs on **members' machines**, not on the server. See [`gg` CLI](/en/cli/) and [Desktop app](/en/desktop/) |

The server is designed as a **single instance**: real-time browser pushes, daemon connections, and preview tunnels all live in process memory. Do not run multiple server instances behind a load balancer.

## Ports

| Port | Listened on by | Accessed by | Notes |
| --- | --- | --- | --- |
| 443 (plus 80 redirect) | Nginx | Browsers, daemons | The only public entry point |
| 8787 | server | Nginx | Listens on `127.0.0.1` only by default; change with `HOST` / `PORT` |
| 5432 | PostgreSQL | server | Default port for a self-hosted database; the development `pnpm db:up` uses 54329 |
| 41000–41099 | server | Browsers | Only used by the preview "port mode"; each open preview takes one port. Not used in wildcard-domain mode. See [Reverse proxy and preview domains](/en/deploy/reverse-proxy) |
| 7881/TCP, 7882/UDP | livekit-server | Browsers, daemons | Only needed for live view; must be directly reachable by browsers and members' machines (not through Nginx) |

## Minimal deployment topology

A single server can run every server-side component:

```text
                   ┌──────────────────────── Server ─────────────────────────┐
 Browser ─┐        │                                                         │
          │  HTTPS │  Nginx :443                                             │
          ├──────→ │   ├─ /                → apps/web/dist (static files)    │
 Member   │  WSS   │   ├─ /api /ws /livekit /downloads → server 127.0.0.1:8787 │
 machine  │        │   └─ *.preview-domain → server (routed by Host)         │
 daemon ──┘        │                                                         │
                   │  server ──→ PostgreSQL                                  │
                   │     └────→ data directory GONGGONG_DATA_DIR             │
                   └─────────────────────────────────────────────────────────┘
```

- Nginx handles HTTPS, hosts the web app's static files, and reverse-proxies `/api`, `/ws`, `/livekit`, and `/downloads` to the server.
- Daemons on members' machines reach the server through the same domain: `/api/daemon/*`, `/ws/daemon` (main connection), `/ws/daemon/tunnel` (preview tunnel), and `/downloads/*` (auto-upgrade).
- Configure a separate wildcard preview domain only when people outside the team need to open web previews built by Bots.

See [Reverse proxy and preview domains](/en/deploy/reverse-proxy) for the configuration.

::: tip Trying it on a LAN
For a LAN-only trial you can skip Nginx: start with `pnpm dev:server` + `pnpm dev:web`. The web dev server proxies `/api`, `/ws`, and `/livekit` to the server, and together with a self-signed certificate lets members on the LAN connect. See [HTTPS and certificates](/en/deploy/https#generate-a-self-signed-certificate) and [Quick start](/en/guide/quick-start).
:::

## Software requirements

| Software | Requirement |
| --- | --- |
| Operating system | Linux or macOS |
| Node.js | 22 or later |
| pnpm | Enable with `corepack enable`; the version is pinned in the root `package.json` |
| PostgreSQL | 17 recommended |
| git | The server uses it to maintain base-branch mirrors of group repositories (for `@` file suggestions and file search) and must be able to access those repositories. See [Deploy from source](/en/deploy/install#repository-access-credentials) |
| Nginx | Or any other web server that can reverse-proxy WebSockets |
| openssl | Needed to generate a self-signed certificate |
| livekit-server | Optional. On Linux and Windows (x86_64 / arm64) the server automatically downloads and verifies the official release from GitHub; you can also install it yourself and point `GONGGONG_LIVEKIT_BIN` at it |

The server does not need Claude Code, Codex, or Rust. Those are only needed on members' machines (or the machine that builds the clients).

::: warning Disk encryption
Attachments, diffs, and run processes are stored encrypted in the database or on disk, but the base-branch mirrors (`mirrors/` in the data directory) are plaintext git repositories. Enable disk encryption on the server (such as LUKS) in production. See [Security model](/en/deploy/security#encryption-at-rest).
:::

## Next steps

1. [Deploy from source](/en/deploy/install)
2. [Environment variables](/en/deploy/env)
3. [HTTPS and certificates](/en/deploy/https)
4. [Reverse proxy and preview domains](/en/deploy/reverse-proxy)
5. [Backup and restore](/en/deploy/backup)
