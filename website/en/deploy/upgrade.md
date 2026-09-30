# Upgrades and client releases

This page explains how to upgrade the server, and how to build and publish the clients for members' machines (the daemon and gg-cast) so they upgrade automatically.

## Upgrade the server

1. [Back up](/en/deploy/backup) first:
   ```bash
   sudo -u gonggong env GONGGONG_BACKUP_DIR=… GONGGONG_DATA_DIR=… GONGGONG_DATABASE_URL=… bash scripts/backup.sh
   ```
2. Pull the new code and install dependencies:
   ```bash
   cd /srv/gonggong
   sudo -u gonggong git pull
   sudo -u gonggong pnpm install --frozen-lockfile
   ```
3. Rebuild the web app:
   ```bash
   sudo -u gonggong pnpm --filter @gonggong/web build
   ```
4. Restart the server:
   ```bash
   sudo systemctl restart gonggong
   curl -s http://127.0.0.1:8787/api/health
   ```

- The server applies new database migrations automatically at startup; no manual steps are needed.
- The web app is static files, so it takes effect as soon as the build finishes, without reloading Nginx. Open pages load the new version after a refresh.
- Daemons and browsers disconnect during the restart and reconnect automatically.

::: tip Protocol version
The `protocol` returned by `/api/health` is the protocol version between the server and the daemon. When a new server raises the protocol version, older daemons are refused, and the [Machines](/en/admin/machines) page shows 「daemon 协议版本过旧」 ("daemon protocol version too old"). When you upgrade the server, publish the matching new clients at the same time; daemons with auto-upgrade enabled upgrade right away.
:::

## Build the clients

Clients are packaged on a build machine with `scripts/release.sh`; the version number comes from `crates/gonggong/Cargo.toml`.

```bash
bash scripts/release.sh                                # all platforms + desktop app
bash scripts/release.sh --only macos-aarch64,desktop   # build only some artifacts
```

Values for `--only`: `macos-aarch64`, `macos-x86_64`, `linux-x86_64`, `linux-aarch64`, `windows-x86_64`, `desktop`, comma-separated.

### Artifacts

Output goes to `dist/<version>/`:

| File | Description |
| --- | --- |
| `gonggong-<version>-<platform>[.exe]` | The daemon (the `gg` CLI), one per platform |
| `gg-cast-<version>-<platform>[.exe]` | The live view streaming program, one per platform |
| `共工空间_<version>_<arch>.dmg` | macOS desktop app installer, with gg-cast built in |
| `SHA256SUMS` | sha256 of each file |
| `manifest.json` | Release manifest: the version plus each platform file's download URL and sha256 |

### Build machine requirements

| Artifact | Requirement |
| --- | --- |
| macOS builds | A macOS host with the `aarch64-apple-darwin` and `x86_64-apple-darwin` targets installed via rustup |
| Linux / Windows builds | Docker installed locally; cross-compiled inside a container. Linux builds require glibc ≥ 2.31 (Ubuntu 20.04+, Debian 11+, RHEL 9+) |
| Desktop `.dmg` | A macOS host; run `pnpm install` first, with Rust and the Xcode command line tools installed |

::: tip Desktop app signing
If there's a Developer ID Application certificate in the keychain, the script uses it to sign the desktop app automatically (you can also specify one with `APPLE_SIGNING_IDENTITY`). Otherwise it uses an ad hoc signature and prints a warning: with that, the Screen Recording, Accessibility, and other permissions granted by macOS are lost after every upgrade. See [Permissions and system settings](/en/desktop/permissions).
:::

## Publish the clients

### Upload in the admin console

The easiest route when the build machine and the server are separate: drag the `gonggong-*` and `gg-cast-*` files from `dist/<version>/` into 「管理后台 → 客户端发布」 (Admin console → Client releases). For file naming and version rules, see [Client releases](/en/admin/releases).

### Publish with the script

If you can run the script on the server (or on a machine that can access the server's data directory), you can build and publish in one step:

```bash
GONGGONG_DATA_DIR=/var/lib/gonggong \
GONGGONG_ADMIN_PASSWORD=<admin-password> \
bash scripts/release.sh --publish https://gg.example.com
```

The script:

1. Builds the artifacts as described above;
2. Copies `gonggong-*` and `gg-cast-*` into `$GONGGONG_DATA_DIR/downloads/` (when that variable is set);
3. Signs in as an admin and submits `manifest.json` to the server, creating a new release record.

Related variables:

| Variable | Description |
| --- | --- |
| `GONGGONG_ADMIN_PASSWORD` | Required; password of the admin used for publishing |
| `GONGGONG_ADMIN_ACCOUNT` | Admin account used for publishing; defaults to `admin` |
| `GONGGONG_CACERT` | When the server uses a self-signed certificate, pass the certificate file so curl trusts it |
| `GONGGONG_DOWNLOAD_BASE` | URL prefix when installers are hosted on a CDN, written into `manifest.json`; defaults to `/downloads` (served by the server) |

::: warning
Script publishing replaces the release record wholesale with `manifest.json`. If `--only` built just some platforms, the manifest contains only those, and the other platforms become 「未发布」 (Not released).
:::

When you use a CDN, the daemon verifies the CDN's HTTPS against the system certificate store, and always verifies each file's sha256.

### Distribute the desktop app

The `.dmg` isn't published through the server. Send the file directly to members who use the desktop app; reinstalling it upgrades them. See [Desktop app](/en/desktop/).

## How the daemon auto-upgrades

- Each time the daemon connects to the server, if the server has published a **higher version** with a file for its platform, it downloads it in the background and verifies the sha256.
- Once downloaded, it waits until no turns are running on the machine, then replaces its own executable and restarts.
- It never downgrades; a version that fails verification isn't retried for the rest of that run.
- When the server refuses it for an outdated protocol version, it downloads the upgrade immediately.
- Members can turn this off with `GONGGONG_NO_AUTO_UPGRADE=1` or in the desktop app under 「设置 → 自动升级」 (Settings → Auto-upgrade).
- gg-cast isn't downloaded along with the daemon; it's downloaded on demand the first time live view is streamed.

For details, see [Client releases](/en/admin/releases#how-auto-upgrade-works).

## Related pages

- [Client releases](/en/admin/releases)
- [Backup and restore](/en/deploy/backup)
- [CLI installation](/en/cli/)
- [Desktop app](/en/desktop/)
