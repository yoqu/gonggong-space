# Docker Deployment

The repository's `docker-compose.yml` starts every server-side component (PostgreSQL, server, Nginx + web app) with one command. It suits trials and small-team LAN deployments. You need Docker and Docker Compose v2.

## Start

```bash
git clone https://github.com/yoqu/gonggong-space.git && cd gonggong-space
GONGGONG_ADMIN_PASSWORD=<initial password> GONGGONG_PUBLIC_URL=https://<server IP or domain> docker compose up -d
```

The first start builds the images (a few minutes). Then open `GONGGONG_PUBLIC_URL` in a browser, sign in as `admin` with the initial password, change it when prompted, and [bind a machine](/en/user/bind-machine).

| Variable | Default | Description |
| --- | --- | --- |
| `GONGGONG_ADMIN_PASSWORD` | none | Initial password of the first admin `admin`; only used while the database has no accounts |
| `GONGGONG_PUBLIC_URL` | `https://localhost` | Address browsers and members' machines use to reach the site. Can be left out for a trial on this machine; on a LAN use the server IP, including the port if it isn't 443 |
| `GONGGONG_HTTPS_PORT` / `GONGGONG_HTTP_PORT` | `443` / `80` | Published ports |
| `NPM_REGISTRY` (build arg) | `https://registry.npmmirror.com` | npm registry used to build the images; outside China use `docker compose build --build-arg NPM_REGISTRY=https://registry.npmjs.org` |

## Certificate

On first start the server generates a self-signed certificate in the data volume (covering the host name of `GONGGONG_PUBLIC_URL`, `localhost` and `127.0.0.1`), shared by Nginx and the server:

- Browsers warn that the certificate is untrusted; confirm to continue.
- The daemon accepts the self-signed certificate as is, so members bind with the command copied from 「绑定新机器」 (Bind new machine) without extra steps. The connection is encrypted, but the daemon doesn't verify the certificate; see [Security model](/en/deploy/security).
- After changing the host name in `GONGGONG_PUBLIC_URL`, delete `tls/` in the data volume and restart to regenerate it. Bound machines don't need to rebind for the new certificate.

For production, use a trusted certificate or follow [Deploy from Source](/en/deploy/install); see [HTTPS & Certificates](/en/deploy/https).

## Data and keys

| Volume | Contents |
| --- | --- |
| `pg` | PostgreSQL data |
| `data` | Server data directory: encrypted attachments, mirrors, client packages, the certificate, and `data.key`, generated when `GONGGONG_DATA_KEY` is not set |

Keeping `data.key` in the same volume as the data is only fit for trials. For real use, pass a value from `openssl rand -base64 32` to the server as `GONGGONG_DATA_KEY` and keep it separately; see [Backup & Restore](/en/deploy/backup).

## Previews

Port mode is used, with 20 preview ports `41000–41019` served over HTTPS by the server using the same certificate. Open these ports in the firewall. Live view (LiveKit) ports are not published by the compose file.

## Upgrade

```bash
git pull && docker compose up -d --build
```

Database migrations run automatically when the server starts.

## Run a Member Machine (daemon) on a Server

The image in `docker/daemon/` turns a server into an always-online member machine. The daemon only connects out to the gonggong-space server, and previews travel over that connection, so no inbound port is needed.

The image ships `gg` and `gg-cast`, Claude Code, Codex, Node.js 24, git (with `gh`), ripgrep, jq, build tools, python3 and `uv` (for MCP servers started with npx / uvx), Chromium with CJK fonts (snapshots, web previews) and Xvfb (desktop app previews). The daemon runs as the unprivileged user `gg`; all its data lives in one volume at `/home/gg`.

WeChat DevTools, mini program live view and "open with a local app" are macOS / Windows only and unavailable in the container.

### Start

1. Enter the directory and write `.env`. Give each container its own `GONGGONG_MACHINE_ID` and never change it:

   ```bash
   cd docker/daemon
   printf 'GG_VERSION=0.4.9\nGONGGONG_MACHINE_ID=%s\n' "$(openssl rand -hex 16)" > .env
   docker compose build
   ```

2. On the web, choose 「绑定新机器」 (Bind new machine) in the avatar menu, expand 「在 Docker 中运行」 (Run in Docker), add its `GONGGONG_BIND_URL='<link>'` line to `.env`, then start it in the background (it binds on the first start; the link is valid for 10 minutes):

   ```bash
   docker compose up -d
   docker compose logs -f daemon
   ```

   Or bind by hand first: `docker compose run --rm daemon gg login '<link>'`.

3. Sign the Agents in, either way:
   - configure an API key [provider](/en/user/agents-providers) for this machine on the web, with no login inside the container;
   - or use the official account: on the machine page, under Agents & providers → official login, choose 「登录…」 (Log in) and run `claude` (then `/login`) or `codex login --device-auth` in the machine's terminal.

4. Set up git credentials: on the machine page under Git access, generate an SSH key and add the public key to your Git host, or add an HTTPS token per host, then check a repository URL with Test access. Tokens stay in the container's volume; the server keeps none.

5. See the self-checks under Diagnostics on the machine page (the same as `gg doctor`).

A new SSH host's key is trusted on first connection. The daemon in a container never upgrades itself; the machine page's upgrade guide gives the rebuild command.

| Variable | Default | Description |
| --- | --- | --- |
| `GG_VERSION` | none | The bundled `gg` version, also the image tag |
| `GONGGONG_MACHINE_ID` | none | Machine identity. As long as it stays the same, a rebuilt container is the same machine and its Bots stay bound |
| `GONGGONG_BIND_URL` | none | The link from Bind new machine → Run in Docker: binds on the first start; ignored once bound |
| `GG_CPUS` / `GG_MEMORY` | `4` / `8g` | CPU and memory limits of the container |
| `GG_DOWNLOAD_URL` (build arg) | GitHub Releases | Where `gg` is downloaded from, e.g. your server's `https://<server>/downloads`; files are always checked against the `SHA256SUMS` published on GitHub |
| `NPM_REGISTRY` (build arg) | `https://registry.npmmirror.com` | npm registry for Claude Code and Codex |
| `CLAUDE_CODE_VERSION` / `CODEX_VERSION` (build args) | `latest` | Pin the Agent versions |

::: warning Old Docker
The default seccomp profile of Docker before 20.10.10 does not know newer system calls used by Debian 12, so apt, git and others fail in the image. Upgrade Docker; until you can, build the image elsewhere (`docker build --platform linux/amd64`), move it with `docker save` / `docker load`, and add `security_opt: [seccomp:unconfined]` to the `daemon` service.
:::

To run several machines on one server, copy the `daemon` service in `compose.yml` with its own `hostname`, `GONGGONG_MACHINE_ID` and volume.

### Upgrade

Automatic upgrades of `gg` and Claude Code are off in the container; upgrading means a new image. Change `GG_VERSION` in `.env`, then run

```bash
docker compose build --pull && docker compose up -d
```

Logins, providers and workspaces stay in the volume.

::: warning Do not mount docker.sock
Bots can run any command in the container. Mounting `/var/run/docker.sock` hands them root on the host.
:::
