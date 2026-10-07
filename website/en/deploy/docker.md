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
