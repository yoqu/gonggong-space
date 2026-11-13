# Docker deployment

This page covers deploying the server side (PostgreSQL, server, Nginx + web app) with the Docker files that ship with the repository, and running always-online member machines (daemons) in containers on a server. You need Docker and Docker Compose v2.

## Deploy the server

Suited to trials and small teams on an internal network.

```bash
git clone https://github.com/yoqu/gonggong-space.git && cd gonggong-space
GONGGONG_ADMIN_PASSWORD=<初始密码> GONGGONG_PUBLIC_URL=https://<服务器 IP 或域名> docker compose up -d
```

(`<初始密码>` is the initial password; `<服务器 IP 或域名>` is the server's IP or domain.)

The first start builds the images (a few minutes). When it's done, open `GONGGONG_PUBLIC_URL` in a browser, sign in with `admin` and the initial password, change the password when prompted, and then [bind a machine](/en/user/bind-machine).

| Variable | Default | Description |
| --- | --- | --- |
| `GONGGONG_ADMIN_PASSWORD` | none | Initial password for the first admin `admin`; takes effect only when the database has no accounts |
| `GONGGONG_PUBLIC_URL` | `https://localhost` | The address browsers and members' machines use to reach the main site. Can be left empty for a trial on this machine only; on a LAN, use the server's IP, and include the port if it isn't 443 |
| `GONGGONG_HTTPS_PORT` / `GONGGONG_HTTP_PORT` | `443` / `80` | Published ports |
| `NPM_REGISTRY` (build argument) | `https://registry.npmmirror.com` | npm registry used when building images; outside China you can use `docker compose build --build-arg NPM_REGISTRY=https://registry.npmjs.org` |

In the compose file, the PostgreSQL user and password are both fixed to `gonggong`, and the database port isn't published.

### Certificate

On first start the server generates a self-signed certificate in the data volume (covering the host name from `GONGGONG_PUBLIC_URL`, `localhost`, and `127.0.0.1`, valid for 825 days), shared by Nginx and the server:

- The browser warns that the certificate isn't trusted; confirm to continue.
- The daemon on members' machines verifies certificates against the system CAs by default, so binding to this server requires the certificate fingerprint. First look up the fingerprint:
  ```bash
  docker compose exec server openssl x509 -in /data/tls/cert.pem -noout -fingerprint -sha256
  ```
  Then in the web 「绑定新机器」 (Bind new machine) → 「其他方式」 (Other ways) → 「使用命令行」 (Use the command line), copy the command, append `--fingerprint <指纹>` (the fingerprint), and run it. See [HTTPS and certificates](/en/deploy/https#check-the-certificate-fingerprint-and-bind).
- The one-sentence setup via 「发给你的 Agent」 (Send to your agent) on the web needs a trusted certificate. With a self-signed certificate, bind with the command line or the desktop app instead.
- If you change the host name in `GONGGONG_PUBLIC_URL`, delete the `tls/` directory in the data volume and restart to regenerate it. Because the certificate changes, machines bound by fingerprint must rebind with the new fingerprint.

For production, we recommend switching to a trusted certificate or configuring as in [Deploy from source](/en/deploy/install).

### Data and keys

| Volume | Contents |
| --- | --- |
| `pg` | PostgreSQL data |
| `data` | Server data directory: encrypted attachments, artifacts, avatars, force-synced files, mirrors, client installers, certificates, and the auto-generated `data.key` when `GONGGONG_DATA_KEY` isn't set |

Keeping `data.key` in the same volume as the data is only acceptable for trials. For real use, pass a value generated with `openssl rand -base64 32` to the server as `GONGGONG_DATA_KEY` and keep it separately. See [Backup and restore](/en/deploy/backup).

### Previews

Port mode is used, opening 20 preview ports `41000–41019`, served over HTTPS by the server with the same certificate. Your firewall must allow these ports. Live view (LiveKit) ports aren't published in the compose file.

### Upgrade

```bash
git pull && docker compose up -d --build
```

Database migrations run automatically when the server starts. We recommend [backing up](/en/deploy/backup) before upgrading.

## Run member machines (daemons) on a server

The image in `docker/daemon/` turns a server into an always-online member machine: the daemon only makes outbound connections to the Gonggong Space server, and previews travel over that connection too, so no inbound ports need to be opened.

The image includes: `gg`, Claude Code, Codex, Node.js 24, git (with `gh`), ripgrep, jq, build tools, python3 and `uv` (for MCP servers launched via npx / uvx), Chromium and CJK fonts (screenshots, web previews), and Xvfb (desktop app previews). `gg-cast` isn't baked into the image; it's downloaded from the server on first use. The daemon runs as the regular user `gg`, and all of its data lives in a single `/home/gg` volume.

WeChat DevTools, mini program live view, and 「用本机应用打开」 (open with a local app) are supported only on macOS / Windows and aren't available in the container.

### Start

1. Go to the directory and write `.env`. `GG_VERSION` is the `gg` version to package; give each container its own `GONGGONG_MACHINE_ID` and don't change it afterward:

   ```bash
   cd docker/daemon
   printf 'GG_VERSION=0.4.20\nGONGGONG_MACHINE_ID=%s\n' "$(openssl rand -hex 16)" > .env
   ```

2. On the web, click 「绑定新机器」 (Bind new machine) in the avatar menu, expand 「其他方式」 (Other ways) → 「在 Docker 中运行」 (Run in Docker), add the `GONGGONG_BIND_URL='<接入链接>'` line (`<接入链接>` is the connect link) to `.env`, then build, start, and keep it running:

   ```bash
   docker compose up -d --build
   docker compose logs -f daemon
   ```

   On first start the container binds automatically with this connect link. The binding is stored in the data volume, so later restarts don't need it. The connect code is valid for 30 minutes; because the container is unattended, an expired code doesn't fall back to web confirmation but fails outright, so generate a new one and start again. You can also bind manually first and then start: `docker compose run --rm daemon gg login '<接入链接>'`.

   ::: tip The server uses a self-signed certificate
   Append `&fp=<证书指纹>` (the certificate fingerprint) to the end of the connect link (see "Certificate" above for how to look it up), and the daemon will trust only that certificate.
   :::

3. Sign in to the Agent, using either option:
   - Configure an API-key [provider](/en/user/agents-providers) for this machine on the web, with no login inside the container;
   - Use an official account: on the machine page, under 「Agent 与供应商」 (Agents & providers) → 「官方登录」 (Official login), click 「登录…」 (Log in…), then follow the prompt to open that machine's terminal (or run `docker compose exec daemon bash` on the server) and run `claude` (then type `/login`) or `codex login --device-auth`.

4. Configure git credentials: under 「Git 访问」 (Git access) on the machine page, generate an SSH key and add the public key to your Git hosting platform, or add an HTTPS token per host, then check the repository URL with 「测试连接」 (Test access). Tokens are stored only in the container's data volume, never on the server. Host keys of new SSH hosts are trusted automatically on first connection.

5. Check the self-test results under 「诊断」 (Diagnostics) on the machine page (equivalent to `gg doctor`).

For how to use the machine page, see [My machines](/en/user/machines).

| Variable | Default | Description |
| --- | --- | --- |
| `GG_VERSION` | none (required) | The `gg` version to package; also the image tag |
| `GONGGONG_MACHINE_ID` | none (required) | Machine identity. As long as it stays the same, a rebuilt container is still the same machine and Bots don't need to be rebound |
| `GONGGONG_BIND_URL` | none | The connect link from 「在 Docker 中运行」 (Run in Docker), used to bind automatically on first start; ignored once bound |
| `GG_CPUS` / `GG_MEMORY` | `4` / `8g` | Container CPU and memory limits |
| `GG_DOWNLOAD_URL` (build argument) | GitHub Releases | Where to download `gg`; can be changed to your server's `https://<服务器>/downloads` (`<服务器>` = your server). Files are always verified against the `SHA256SUMS` published on GitHub |
| `NPM_REGISTRY` (build argument) | `https://registry.npmmirror.com` | npm registry for installing Claude Code and Codex |
| `CLAUDE_CODE_VERSION` / `CODEX_VERSION` (build arguments) | `latest` | Pin the Agent versions |

::: warning Older Docker versions
The default seccomp profile in Docker before 20.10.10 doesn't recognize newer system calls used by Debian 12, so apt, git, and others in the image fail. Upgrade Docker; if you can't for now, build the image locally (`docker build --platform linux/amd64`), transfer it with `docker save` / `docker load`, and add `security_opt: [seccomp:unconfined]` to the `daemon` service.
:::

To run several machines on one server, duplicate the `daemon` service in `compose.yml` and give each its own `hostname`, `GONGGONG_MACHINE_ID`, and volume.

### Upgrade

The `gg` in the container lives in the data volume (`/home/gg/.local/bin`) and behaves like any other Linux command-line daemon: when the server publishes a new version, it downloads it automatically and restarts when idle to finish the upgrade. You can also click 「立即升级」 (Upgrade now) on the web machine page. The new version is written to the data volume, so it survives container rebuilds; at startup, the `gg` from the image replaces the one in the volume only if the image's is newer.

Claude Code and Codex have auto-update disabled in the image and are upgraded with the image: change `GG_VERSION` in `.env` (and the Agent versions if needed), then run

```bash
docker compose build --pull && docker compose up -d
```

Login state, providers, and workspaces are in the volume and aren't affected. Containers built from `docker/daemon` files older than v0.4.14 can't be upgraded from the web (the machine page tells you to change `GG_VERSION` and rebuild); first switch to the latest `Dockerfile` and `entrypoint.sh` and rebuild once as above.

::: warning Don't mount docker.sock
A Bot can run arbitrary commands inside the container. Mounting `/var/run/docker.sock` is equivalent to handing the host's root to the Bot.
:::

## Related pages

- [Deployment overview](/en/deploy/)
- [HTTPS and certificates](/en/deploy/https)
- [My machines](/en/user/machines)
- [Upgrades and client releases](/en/deploy/upgrade)
