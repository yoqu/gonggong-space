# Upgrades and client releases

This page explains how to upgrade the server, and how to build and publish the clients on members' machines (daemon and gg-cast) so they upgrade automatically.

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

- The server applies new database migrations automatically at startup; nothing to do by hand.
- The web app is static files, so it takes effect as soon as the build finishes; Nginx doesn't need a reload. Open pages load the new version after a refresh.
- During the restart, daemons and browsers disconnect and reconnect automatically.

::: tip Protocol version
The `protocol` returned by `/api/health` is the protocol version between the server and the daemon. When a new server raises the protocol version, older daemons are refused, and the [Machines](/en/admin/machines) page shows 「daemon 协议版本过旧」 ("daemon on an outdated protocol"). When upgrading the server, publish the matching new clients at the same time; daemons with auto-upgrade enabled upgrade immediately.
:::

## Build the clients

Clients are packaged on a build machine with `scripts/release.sh`; the version comes from `crates/gonggong/Cargo.toml`. By default the working tree must have no uncommitted changes (`git status` is clean); otherwise add `--allow-dirty`.

```bash
bash scripts/release.sh                                # all artifacts
bash scripts/release.sh --only macos-aarch64,desktop   # only some artifacts
bash scripts/release.sh --daemon-only                  # only gg for the five platforms, no desktop app
```

Values for `--only`, comma-separated:

| Value | Artifacts |
| --- | --- |
| `macos-aarch64`, `macos-x86_64`, `linux-x86_64`, `linux-aarch64`, `windows-x86_64` | The daemon (`gg`) and gg-cast for that platform |
| `desktop` | macOS desktop app, one installer each for Apple silicon and Intel |
| `desktop-windows` | Windows desktop installer (cross-compiled in Docker); built only when named explicitly in `--only` |

### Artifacts

Written to `dist/<版本>/` (`<版本>` = version):

| File | Description |
| --- | --- |
| `gonggong-<版本>-<平台>[.exe]` | Daemon (command-line `gg`), one per platform |
| `gg-cast-<版本>-<平台>[.exe]` | Live view streaming program, one per platform |
| `Gonggong_<版本>_aarch64.dmg` / `Gonggong_<版本>_x86_64.dmg` | macOS desktop installers (Apple silicon / Intel), with gg-cast bundled |
| `Gonggong_<版本>_<架构>.app.tar.gz` and `.sig` | macOS desktop auto-update bundle and its signature |
| `Gonggong_<版本>_x64-setup.exe` and `.sig` | Windows desktop installer (also its update package) and its signature |
| `SHA256SUMS` | sha256 of the daemon and gg-cast |
| `manifest.json` | Release manifest: version, release notes, and the download URL and sha256 of the daemon and gg-cast for each platform |

(`<平台>` = platform, `<架构>` = architecture.) Release notes are taken from `docs/release-notes/v<版本>.md` (or `--notes <文件>`), written into the manifest, and shown when clients prompt for an update.

### Build machine requirements

| Artifact | Requirements |
| --- | --- |
| macOS daemon | A macOS host with the `aarch64-apple-darwin` and `x86_64-apple-darwin` targets installed via rustup |
| Linux / Windows daemon | Docker installed locally; cross-compiled inside a container. The Linux build needs glibc ≥ 2.31 (Ubuntu 20.04+, Debian 11+, RHEL 9+) |
| macOS desktop app | A macOS host; run `pnpm install` first, with Rust and the Xcode command line tools installed; needs the auto-update signing private key (`TAURI_SIGNING_PRIVATE_KEY`, read from `~/.tauri/gonggong.key` by default) |
| Windows desktop app | Docker installed locally; also needs the auto-update signing private key |

::: tip macOS signing and notarization
If there's a Developer ID Application certificate in the keychain, the script signs the desktop app with it automatically (you can also specify one with `APPLE_SIGNING_IDENTITY`); otherwise it uses an ad hoc signature and warns you. In that case, permissions macOS has granted, such as Screen Recording and Accessibility, are lost after every upgrade. See [Permissions and system settings](/en/desktop/permissions). If the environment variables needed for Apple notarization are configured (`APPLE_API_KEY` / `APPLE_API_ISSUER` / `APPLE_API_KEY_PATH`, or an `APPLE_NOTARY_PROFILE` keychain profile), the `.dmg` is notarized as well.
:::

## Publish the clients

### Upload in the admin console

The easiest option when the build machine and the server are separate: drag the files from `dist/<版本>/` into 「管理后台 → 客户端发布」 (Admin console → Client releases). The daemon and gg-cast are used for installation and auto-upgrade; the desktop `.dmg` and `setup.exe` appear in the downloads of 「绑定新机器」 (Bind new machine); once both the desktop update bundles and their signatures are uploaded, the desktop app prefers to update from this server. For file naming and version rules, see [Client releases](/en/admin/releases).

### Publish with a script

If you can access the server as an admin, a script can upload the whole directory at once:

```bash
GONGGONG_ADMIN_PASSWORD=<管理员密码> \
bash scripts/release/publish.sh server <版本> https://gg.example.com
```

(`<管理员密码>` = the admin password.) It uploads the daemon, gg-cast, and desktop files in `dist/<版本>/` to the server one by one through the admin upload API, and finally uploads the release notes. It can be run repeatedly; files already uploaded are replaced.

On the server (or a machine with access to the server's data directory), you can also build and publish the daemon directly:

```bash
GONGGONG_DATA_DIR=/var/lib/gonggong \
GONGGONG_ADMIN_PASSWORD=<管理员密码> \
bash scripts/release.sh --publish https://gg.example.com
```

It copies `gonggong-*` and `gg-cast-*` into `$GONGGONG_DATA_DIR/downloads/` (when that variable is set), then submits `manifest.json` to the server as an admin. Desktop files aren't included and must be uploaded separately.

Related variables:

| Variable | Description |
| --- | --- |
| `GONGGONG_ADMIN_PASSWORD` | Required; the password of the admin used for publishing |
| `GONGGONG_ADMIN_ACCOUNT` | Admin account used for publishing; default `admin` |
| `GONGGONG_CACERT` | When the server uses a self-signed certificate, pass the certificate file so curl trusts it |
| `GONGGONG_DOWNLOAD_BASE` | URL prefix when installers are hosted on a CDN, written into `manifest.json`; default `/downloads` (served by the server) |

::: warning
`release.sh --publish` replaces the release records wholesale with `manifest.json`. If `--only` built just some platforms, the manifest contains only those, and the other platforms become 「未发布」 (Not released).
:::

When using a CDN, the daemon verifies the CDN's HTTPS against the system certificate store and always verifies the file's sha256.

## How clients auto-upgrade

**Daemon (command-line `gg`)**

- When the daemon connects to the server and the server has published a **higher version** with a file for its platform, it downloads it in the background, verifies the sha256, and once no turns are running on the machine, replaces itself and restarts.
- When the server hasn't published a file for its platform, it checks GitHub Releases every 6 hours.
- It never downgrades; a version that fails verification isn't retried for the rest of that run. When the server refuses it for an outdated protocol version, it downloads the upgrade immediately.
- For Linux command-line daemons (including [Docker member machines](/en/deploy/docker)), you can click 「立即升级」 (Upgrade now) on the web machine page; it downloads and restarts when idle.
- Members can turn it off with `GONGGONG_NO_AUTO_UPGRADE=1` or the desktop app's 「设置 → 自动升级」 (Settings → Auto upgrade).
- gg-cast isn't downloaded along with the daemon; it's downloaded from the server on demand the first time a live view is streamed.

**Desktop app**

It first checks the bound server for updates: if the server has published an update bundle and signature for its platform, it downloads from the server; otherwise it checks GitHub. The Apple silicon and Intel builds update independently; an app left open across several versions jumps straight to the latest.

See [Client releases](/en/admin/releases).

## Related pages

- [Client releases](/en/admin/releases)
- [Backup and restore](/en/deploy/backup)
- [Command-line installation](/en/cli/)
- [Desktop app](/en/desktop/)
