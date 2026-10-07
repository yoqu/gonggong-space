# Deploy from source

This page walks you through deploying the Gonggong Space server from source on a Linux server: prepare the environment, create the database, build the web app, configure and start the server with systemd, and create the first admin.

The examples assume the code lives in `/srv/gonggong`, the data directory is `/var/lib/gonggong`, the config file is `/etc/gonggong/server.env`, and everything runs as the system user `gonggong`.

## 1. Prepare the environment

| Software | Version |
| --- | --- |
| Node.js | 24 or later |
| pnpm | Provided by corepack; the version is pinned by `packageManager` in the root `package.json` |
| PostgreSQL | 17 recommended |
| git | Any recent version |
| Nginx | For HTTPS and static files. See [Reverse proxy](/en/deploy/reverse-proxy) |

```bash
sudo corepack enable      # enable pnpm
node --version            # make sure it's ≥ 24
```

## 2. Get the code and install dependencies

```bash
sudo useradd --system --home /srv/gonggong --shell /usr/sbin/nologin gonggong
sudo git clone https://github.com/yoqu/gonggong-space.git /srv/gonggong
sudo chown -R gonggong: /srv/gonggong
cd /srv/gonggong
sudo -u gonggong pnpm install --frozen-lockfile
```

The server runs its TypeScript source directly with `tsx` and has no separate compile step, so you need the full set of dependencies (including devDependencies).

## 3. Create the database

The server only needs an empty database; the schema is created and upgraded automatically at startup.

```bash
sudo -u postgres createuser --pwprompt gonggong
sudo -u postgres createdb --owner gonggong gonggong
```

The connection string looks like `postgres://gonggong:<password>@127.0.0.1:5432/gonggong`; you'll put it in `GONGGONG_DATABASE_URL` shortly.

::: tip
The development command `pnpm db:up` starts a passwordless local PostgreSQL inside the repository directory (port 54329). It's only suitable for development and trials; use a properly installed PostgreSQL in production.
:::

## 4. Build the web app

```bash
cd /srv/gonggong
sudo -u gonggong pnpm --filter @gonggong/web build
```

The output in `apps/web/dist/` is plain static files, hosted directly by Nginx (the server does not serve web files). The build needs no environment variables, and the same output works for any domain.

## 5. Write the config file

Generate the data encryption key and create the directories:

```bash
sudo mkdir -p /etc/gonggong /var/lib/gonggong
sudo chown gonggong: /var/lib/gonggong
openssl rand -base64 32      # put the output in GONGGONG_DATA_KEY below
```

`/etc/gonggong/server.env` (mode `600`, owned by root or gonggong):

```ini
GONGGONG_DATABASE_URL=postgres://gonggong:<password>@127.0.0.1:5432/gonggong
GONGGONG_DATA_DIR=/var/lib/gonggong
GONGGONG_DATA_KEY=<base64 generated in the previous step>
GONGGONG_ADMIN_PASSWORD=<initial password for the first admin>
# Required when Nginx terminates HTTPS:
GONGGONG_SECURE_COOKIES=1
GONGGONG_PUBLIC_URL=https://gg.example.com
# When previews need to be shared externally (see "Reverse proxy and preview domains"):
# GONGGONG_PREVIEW_DOMAIN=example-preview.com
```

::: danger Always set GONGGONG_DATA_KEY explicitly
If it's not set, the server generates `.gonggong-dev/data.key` in its working directory and uses that as the key, which is only suitable for development. If the key is lost, attachments, diffs, and run processes can no longer be decrypted. Keep it in a secrets manager or on offline media, and **do not** store it alongside database backups.
:::

`GONGGONG_DATA_DIR` and `GONGGONG_DATABASE_URL` both have development defaults (`.gonggong-dev/…` relative to the working directory, and local port 54329). Set all of them explicitly in production. For the full list, see [Environment variables](/en/deploy/env).

### Repository access credentials

Once a group is linked to a Git repository, the server maintains a base-branch mirror under `mirrors/` in the data directory, used for file suggestions when typing `@` and for file search. The server runs `git` as its service user with interactive password prompts disabled, so you need to configure read-only credentials in advance, such as a deploy key:

```ini
GIT_SSH_COMMAND=ssh -i /etc/gonggong/deploy_key -o IdentitiesOnly=yes
```

A git credential helper works too. Without credentials, Bots still work normally (members' machines clone with their own credentials); only `@` file suggestions and file search won't include that repository's files.

## 6. Start with systemd

`/etc/systemd/system/gonggong.service`:

```ini
[Unit]
Description=Gonggong server
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=gonggong
WorkingDirectory=/srv/gonggong/apps/server
EnvironmentFile=/etc/gonggong/server.env
ExecStart=/srv/gonggong/apps/server/node_modules/.bin/tsx src/main.ts
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

`ExecStart` is equivalent to running `pnpm start` in `apps/server`. Start it and check:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now gonggong
curl -s http://127.0.0.1:8787/api/health     # returns {"ok":true,"protocol":…}
journalctl -u gonggong -f                    # follow the logs
```

By default the server listens only on `127.0.0.1:8787` and is exposed through Nginx. See [Reverse proxy and preview domains](/en/deploy/reverse-proxy). Set `GONGGONG_LOG=1` if you need per-request logs.

### Database migrations

On every start, the server automatically applies any pending migrations in `apps/server/drizzle/`. **No manual migration is needed.** After upgrading the code, just restart. See [Upgrades and client releases](/en/deploy/upgrade).

## First admin

When the database has no accounts yet, the server creates a sysadmin at startup using `GONGGONG_ADMIN_PASSWORD`:

- Account: `admin`
- Password: the value of `GONGGONG_ADMIN_PASSWORD`
- The password must be changed on first login

After that, the variable has no effect (it won't create the account again or reset the password once accounts exist), so you can remove it from the config file.

1. Open the main site in a browser, sign in with `admin` and the initial password, and change the password when prompted.
2. Go to 「管理后台 → 账号与角色」 (Admin console → Accounts & roles) and create accounts for members. See [Accounts and roles](/en/admin/users).
3. Upload the daemon installers in [Client releases](/en/admin/releases); members can then [bind a machine](/en/user/bind-machine).

## Next steps

- [HTTPS and certificates](/en/deploy/https)
- [Reverse proxy and preview domains](/en/deploy/reverse-proxy)
- [Backup and restore](/en/deploy/backup)
- [Security model](/en/deploy/security)
