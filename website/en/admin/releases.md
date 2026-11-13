# Client releases

This page explains how to upload new versions of the daemon, gg-cast, and the desktop app on the 「客户端发布」 (Client releases) page, how file names determine platform and version, and how member machines and desktop apps upgrade from here.

![Admin console · Client releases](/screenshots/web/admin-releases.webp)

## What gets published here

| Artifact | Example file name | Purpose |
| --- | --- | --- |
| daemon | `gonggong-0.4.20-linux-x86_64` | The `gg` command-line program on member machines. Online daemons upgrade automatically to the version here once they connect; the Linux build is also offered for download in 「绑定新机器」 (Bind new machine) |
| gg-cast | `gg-cast-0.4.20-windows-x86_64.exe` | Helper program for streaming 「实时画面」 (live views). The daemon downloads it on demand the first time it streams a live view |
| Desktop installer | `Gonggong_0.4.20_aarch64.dmg`, `Gonggong_0.4.20_x86_64.dmg`, `Gonggong_0.4.20_x64-setup.exe` | Offered for download in 「绑定新机器」 (Bind new machine) |
| Desktop update package | `Gonggong_0.4.20_aarch64.app.tar.gz`, `Gonggong_0.4.20_x86_64.app.tar.gz` | Used for macOS desktop auto-update (Windows updates directly from the installer) |
| Desktop update signature | The update package or Windows installer name plus `.sig` | Used by the desktop app to verify update packages |
| Release notes | `RELEASE_NOTES.md` | What's new in this version, shown in upgrade prompts |

The macOS desktop app comes in two packages, Apple silicon (`aarch64`) and Intel (`x86_64`), each signed and updated separately. Artifacts are produced by running `scripts/release.sh` on the build machine and placed in `dist/<version>/`; see [Upgrades and client releases](/en/deploy/upgrade).

## Upload

1. Run `bash scripts/release.sh` on the build machine.
2. Open the 「客户端发布」 page and drag the `gonggong-*`, `gg-cast-*`, `Gonggong_*` (installers, update packages, and `.sig` signatures), and `RELEASE_NOTES.md` files from `dist/<version>/` into the 「拖入发布产物」 (Drop release artifacts) area (you can drop several at once).
3. Each file shows its upload progress; when done, the corresponding platform in the table below changes to 「已发布」 (Released).

![Uploading release artifacts](/screenshots/web/admin-releases-upload.webp)

The server computes the sha256 while receiving, stores the file under `downloads/` in the data directory (`$GONGGONG_DATA_DIR/downloads`), and serves it at `/downloads/<file name>`.

### File name rules

The file name determines the artifact type, version, and platform:

```text
gonggong-<version>-<platform>[.exe]
gg-cast-<version>-<platform>[.exe]
Gonggong_<version>_aarch64.dmg | x86_64.dmg | x64-setup.exe[.sig]
Gonggong_<version>_aarch64.app.tar.gz[.sig] | x86_64.app.tar.gz[.sig]
```

- Version: three numbers, e.g. `0.4.20`.
- Platforms for daemon / gg-cast: `macos-aarch64`, `macos-x86_64`, `linux-x86_64`, `linux-aarch64`, `windows-x86_64`; only Windows has `.exe`.

Files that don't follow these rules (such as `SHA256SUMS` or `manifest.json`) are rejected in the browser with 「不是发布产物，文件名应形如 gonggong-0.2.0-macos-aarch64 或 Gonggong_0.2.0_aarch64.dmg」 ("Not a release artifact; the file name should look like gonggong-0.2.0-macos-aarch64 or Gonggong_0.2.0_aarch64.dmg"). **Don't rename files**; drag in the original artifacts from `release.sh`.

### Version rules

The server keeps only one release at a time:

| Version of the uploaded file | Result |
| --- | --- |
| Same as the current version | Merged by platform: adds or replaces that kind of file for that platform; everything else stays |
| Higher than the current version | Starts a new release, replacing the whole release record |
| Lower than the current version | Upload rejected |

So when you publish a new version, upload files for **all platforms**; any platform you skip shows as 「未发布」 (Not released) in the new release.

A single file can't exceed 300 MB. If a reverse proxy sits in front, raise its request body limit to at least 300 MB; see [Reverse proxy](/en/deploy/reverse-proxy).

## Release notes

Once a release exists, 「版本说明」 (Release notes) appears at the top of the page:

- An uploaded `RELEASE_NOTES.md` becomes this version's notes (up to 1 MB).
- You can also click 「编辑版本说明」 (Edit release notes) to edit them directly (Markdown supported), then click 「保存版本说明」 (Save release notes).
- Without release notes, the page shows 「未填写版本说明。桌面端和 daemon 升级时不会显示具体更新内容。」 ("No release notes yet. Desktop and daemon upgrades will not show the specific changes."). You're also reminded to add them when uploading artifacts.

## Platform table

The toolbar shows 「当前版本 x.y.z」 ("Current version x.y.z") or 「尚未发布」 (Not released yet). The table has one row per platform:

| Column | Description |
| --- | --- |
| 平台 / 标识 (Platform / ID) | e.g. 「macOS aarch64」 / `macos-aarch64` |
| daemon | 「已发布」 (Released) with the first 12 characters of the sha256; otherwise 「未发布」 (Not released). Highlighted as a warning when machines on that platform exist but nothing is released |
| gg-cast（实时画面） (gg-cast (live view)) | Same as above |
| 桌面端安装包 (Desktop installer) | Same as above |
| 桌面端自动更新 (Desktop auto update) | 「已发布」 (Released) when both the update package and signature are present; if only one is missing, shows 「缺少签名」 (Signature missing) or 「缺少更新包」 (Package missing) |
| 机器 (Machines) | Number of machines on that platform |

Each row's menu can remove each kind of file released for that platform (「移除 daemon…」 (Remove daemon…), 「移除 gg-cast…」 (Remove gg-cast…), 「移除 桌面端…」 (Remove desktop…), etc.):

| Removed | Effect |
| --- | --- |
| daemon | Machines on that platform stop auto-upgrading until it's uploaded again |
| gg-cast | Machines on that platform can't stream live views until it's uploaded again |
| Desktop installer | Members can't download that platform's installer from 「绑定新机器」 (Bind new machine) until it's uploaded again |
| Desktop update package / signature | Desktop apps on that platform check GitHub for updates instead, until it's uploaded again |

Uploads, removals, and release-note edits are all written to the [audit log](/en/admin/audit).

## How auto-upgrade works

### Command-line daemon

1. When a daemon on a member machine (`gg run`) connects to the server, it reports its OS, architecture, and version.
2. If the server's release is **newer** and has a daemon file for that platform, the server sends the download URL and sha256 to the daemon. The daemon never downgrades.
3. The daemon downloads in the background and verifies the sha256; a version that fails verification is rejected.
4. Once **no turns are running** on the machine, it replaces its own executable and restarts, coming back online with the new version.
5. If the daemon's protocol version is too old and the server refuses its connection, it downloads and upgrades immediately.

Owners of a Linux command-line daemon can also click 「立即升级」 (Upgrade now) on the machine page in the web app; see [Machines](/en/admin/machines#how-to-upgrade-machines).

::: warning Write permission required
The daemon replaces its own executable, so `gg` should live in a directory the member can write to (such as `~/.local/bin`), not somewhere like `/usr/local/bin` that requires sudo. See [CLI installation](/en/cli/).
:::

Members can turn off auto-upgrade: set the environment variable `GONGGONG_NO_AUTO_UPGRADE=1`, or turn off 「自动升级」 (Auto upgrade) in the desktop app's 「设置」 (Settings) (this is written to the machine's local settings and also applies to `gg` on the same machine). See [Command reference](/en/cli/reference).

### Desktop auto-update

The desktop app bundles the daemon and gg-cast, and updates as a whole app:

- The desktop app **first checks the server it's bound to** for updates: if this platform's update package (the installer on Windows) and signature are both released, it downloads from the server.
- If the server hasn't released a signed update package for this platform, it checks GitHub instead.
- If the app has been open across several versions, it upgrades straight to the latest in one step.

## Other ways to publish

- **Script publishing**: if you can run scripts on the server, `scripts/release.sh --publish <server address>` builds and publishes in one step; see [Upgrades and client releases](/en/deploy/upgrade).
- **Let a Bot publish**: in runs started by a sysadmin, a Bot can use the built-in MCP tool `client_release_publish` to publish artifacts built on its machine (which can be an entire release directory) to the current server; this requires one approval.

## Related pages

- [Upgrades and client releases](/en/deploy/upgrade)
- [Machines](/en/admin/machines)
- [Desktop app](/en/desktop/)
