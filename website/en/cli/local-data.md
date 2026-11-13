# Local data and logs

This page covers what data the daemon keeps on this machine, where managed workspaces live, logs and diagnostics bundles, the available environment variables, and what automatic cleanup removes.

The `gg` command line and the desktop app share the same data directory, `~/.gonggong/` by default (`%USERPROFILE%\.gonggong\` on Windows). You can move it elsewhere with the `GONGGONG_HOME` environment variable. Managed workspaces live separately, in the visible `~/gonggong/workspaces/` directory.

## Managed workspaces

The managed workspaces Bots use for group work are located at:

```text
~/gonggong/workspaces/<group name>/<Bot name>/<repo name>
```

- Directory names come from the group and Bot names at the time of creation; renaming later doesn't move the directory. Duplicate names get a suffix automatically. If the group has no repository, the last level is `_empty`.
- If the group has additional repositories, they're cloned next to the main repository.
- Workspaces from older versions under `~/.gonggong/workspaces/<group ID>/<Bot ID>/…` are moved to the new location automatically on the next run or binding, with uncommitted changes preserved.
- When `GONGGONG_HOME` is set (the data directory isn't the default `~/.gonggong`), managed workspaces go under `<GONGGONG_HOME>/named/`, so multiple instances don't share them.
- Local directories bound with `/cd` aren't here, and Gonggong Space never deletes them.

You can view workspace usage, slim down, and clean up in 「机器与 Bot」 (Machines & Bots) → machine → the 「工作区」 (Workspaces) tab on the web; see [My machines](/en/user/machines). On the command line, use [`gg workspaces`](/en/cli/reference#gg-workspaces).

## Directory layout

```text
~/.gonggong/
├── config.json          binding info: server address, machine credential (token), owner, certificate trust mode
├── settings.json        local preferences: auto-upgrade switch, mirror (kept after unbinding)
├── local.json           manually specified Agent CLI paths
├── providers.json       local model providers and API keys, machine default, per-Bot overrides, local Agent settings
├── git-credentials      HTTPS tokens added under "Git access" on the web
├── models.json          selectable models probed from each Agent, reported to the server for selection on the web
├── tools-latest.json    cache of latest-version lookups for Node.js and each Agent CLI
├── workspaces.json      records of managed workspace locations
├── pending-link.json    connection request waiting for confirmation on the web (deleted once confirmed)
├── adapters/            ACP adapters (installed with npm on first run)
├── agent-pkgs/          packages of plugin Agents
├── runtime/             Node.js managed by Gonggong Space
├── tools/               Agent CLIs managed by Gonggong Space
├── skill-sets/          Skills delivered to each "group × Bot"
├── plugin-sets/         versions of each plugin
├── plugin-links/        plugins enabled for each "group × Bot"
├── artifacts/           local state of managed artifacts
├── sync/                local state of multi-machine workspace sync
├── backups/             local backups: overwritten local changes, half-finished work from interrupted runs
├── logs/                daemon logs: daemon.<date>.log; service.log for the background service (macOS)
├── updates/             new versions downloaded by auto-upgrade (replaced only after verification)
├── bin/                 gg-cast downloaded from the server when using live view from the command line
├── run/                 temporary config generated at run time (including provider settings)
├── probe/               temporary directory used when probing selectable models
├── services.pids        records of managed service processes started by Bots
└── *.lock               lock files such as daemon.lock
```

Notes:

- `config.json`, `providers.json`, `git-credentials`, and `pending-link.json` contain credentials and are readable and writable only by you (0600). Don't send them to anyone.
- Directories are created on demand; features you haven't used don't create their directories.
- `daemon.lock` ensures only one daemon (`gg run`, the background service, or the desktop app) runs per data directory.
- The `.gonggong/` subdirectory inside a workspace holds message attachments and managed service logs, and is part of the workspace.
- SSH keys added under 「Git 访问」 (Git access) on the web are stored in the system's `~/.ssh/`, not in the data directory.

## Automatic cleanup

While the daemon is running, it cleans up once a day, removing only content that can be regenerated:

- State left by groups or Bots no longer on this machine (Skills, plugin enablement records, sync state, etc.) that is more than a day old;
- Plugin versions not used by any run for 30 days;
- Managed Node.js and gg-cast versions that have been superseded and aren't used by any process.

**Workspaces and local backups are never deleted automatically**; clean them up manually on the machine's 「工作区」 (Workspaces) tab on the web or with `gg workspaces --delete`. If the list of groups and Bots can't be fetched from the server, that day's cleanup is skipped.

## Local backups

If a Bot run is about to overwrite uncommitted local changes in the workspace, or a run is interrupted and leaves half-finished work behind, the daemon first saves them to `~/.gonggong/backups/`:

- They're stored only on this machine and **never uploaded to the server**.
- To view them: the 「本机备份 · 不上传」 (Local backups · never uploaded) section at the end of `gg workspaces` output, or the section of the same name at the bottom of the desktop app's 「工作区」 (Workspaces) page.
- `gg logout`, the desktop app's 「解除绑定…」 (Unbind…), and machine revocation **do not** delete the backup directory; delete it manually when you no longer need it.

## What unbinding deletes

| Action | `config.json` | Managed workspaces | Directories bound with `/cd` | Local backups | Other settings and providers |
| --- | --- | --- | --- | --- | --- |
| `gg logout` | Deleted | Kept | Kept | Kept | Kept |
| Desktop app 「解除绑定…」 (Unbind…) | Deleted | Deleted | Kept | Kept | Kept |
| Machine revoked / account deactivated | Deleted | Deleted | Kept | Kept | Kept |

Deletion on revocation is best-effort and not guaranteed to be complete. `gg logout` doesn't uninstall the background service; run `gg service uninstall` when you no longer need it.

## Logs

- Logs from the daemon (`gg run`, the background service, or the desktop app) are written daily to `~/.gonggong/logs/daemon.<date>.log`, and the last 7 files are kept.
- On macOS, when running via `gg service`, the process's stdout and stderr also go to `~/.gonggong/logs/service.log`; on Linux, use `journalctl --user -u gonggong`.
- To view them: `gg logs` (by default the last 200 lines at info and above), 「最近日志」 (Recent logs) on the desktop app's 「日志与诊断」 (Logs & diagnostics) page, or the logs in the machine details on the web.
- Logs are redacted by rule before being written: credential-like content such as tokens, passwords, API keys, and Authorization headers is replaced with `[REDACTED]`, and secret values injected into the Agent during a run are masked too.
- `gg run` also prints logs to the terminal (stderr), with the level controlled by `GONGGONG_LOG`; one-off commands such as `gg doctor` print only to the terminal and don't write log files.

## Diagnostics bundle

When you need your admin to troubleshoot a problem, export a diagnostics bundle:

- Command line: `gg logs --export` (saves to the desktop by default, with the file name `gonggong-diag-<date-time>.zip`), or `gg logs --export path.zip`.
- Desktop app: 「日志与诊断」 (Logs & diagnostics) → 「导出诊断包…」 (Export diagnostics bundle…), then choose where to save.

The bundle is a zip containing:

| File | Contents |
| --- | --- |
| `logs/daemon.<date>.log` | The tail of each log file, redacted |
| `diag.json` | Results of each `gg doctor` check at export time |
| `versions.json` | daemon version, protocol version, OS and architecture, detected Agents |
| `config.json` | Binding info with credentials such as the token removed |
| `local.json` | Local settings with credential-like fields removed |

The bundle does not include `providers.json`, `git-credentials`, or workspace contents.

## Environment variables

| Variable | Effect |
| --- | --- |
| `GONGGONG_HOME` | Data directory, `~/.gonggong` by default. Can be used to isolate multiple sets of data on one machine |
| `GG_LANG` | Command output language, `zh` / `en`, same as `--lang`. When unset, `LC_ALL`, `LC_MESSAGES`, and `LANG` are checked in order; the default is Chinese |
| `GONGGONG_LOG` | Log level for terminal output, using Rust `tracing` filter syntax, e.g. `info`, `debug`, `gonggong=debug`. When unset, the terminal shows only error level |
| `GONGGONG_NO_AUTO_UPGRADE` | When set to `1`, disables auto-upgrade; same as turning off 「自动升级」 (Auto upgrade) in settings |
| `GONGGONG_UPDATE` | When set to `off`, doesn't check GitHub for new versions (versions published by the server still upgrade as usual) |
| `GONGGONG_UPDATE_REPO` | GitHub repository checked for new versions, `yoqu/gonggong-space` by default |
| `GONGGONG_BROWSER` | Path to the browser executable used for web page screenshots and HTML rendering. When unset, Chrome / Edge / Chromium on this machine is found automatically |
| `GONGGONG_MACHINE_ID` | Overrides the hardware ID used to identify the machine. Use it when running multiple isolated instances on one host (each with its own `GONGGONG_HOME`) or in a container; keep it unchanged for the same machine, since the server uses it to recognize the machine after a rebuild |
| `GONGGONG_CONTAINER` | Set to `1` to indicate running in a container; the web then shows container-specific upgrade instructions. The official daemon image sets it |

Examples:

```bash
GONGGONG_LOG=debug gg run                 # print debug logs to the terminal
GONGGONG_HOME=/data/gonggong gg status    # use a different data directory
gg --lang en doctor                       # English output
```

::: warning GONGGONG_INSECURE_DEV
`GONGGONG_INSECURE_DEV=1` turns off server certificate verification, so the connection can be impersonated by a man in the middle. Use it only for local development, never in production. For self-signed certificates, use `gg login --fingerprint` or `--ca-file`; see [gg login](/en/cli/reference#gg-login).
:::

## Backup and migration

- **Back up**: `settings.json`, `local.json`, `providers.json` (contains API keys; keep it safe), and `git-credentials` (contains tokens). They're all local configuration, and the server has no copy.
- **No need to back up**: `adapters/`, `runtime/`, `tools/`, `models.json`, and the like can be re-downloaded or re-probed; managed workspaces can be re-cloned from their repositories (push unpushed changes first or back them up separately).
- **Switching machines**: on the new machine, run `gg login` again (or bind in the desktop app), then configure providers and Git access again. On the same machine, running `gg login` again after `gg logout` restores the original machine record and Bot bindings.
- Don't copy `config.json` to another machine.

## Related pages

- [Command reference](/en/cli/reference)
- [Command-line installation](/en/cli/)
- [My machines](/en/user/machines)
- [Pages · Logs and diagnostics](/en/desktop/pages)
- [FAQ and troubleshooting](/en/guide/faq)
