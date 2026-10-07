# Local data and logs

This page covers what data the daemon keeps on this machine, where the logs are, the available environment variables, and how to export a diagnostics bundle.

The `gg` command line and the desktop app share the same data directory, `~/.gonggong/` by default (`%USERPROFILE%\.gonggong\` on Windows). You can move it elsewhere with the `GONGGONG_HOME` environment variable.

## Directory layout

```text
~/.gonggong/
├── config.json          binding info: server address, machine credential (token), owner
├── settings.json        local preferences: auto-upgrade switch, mirror (kept after unbinding)
├── local.json           manually specified Agent CLI paths
├── providers.json       local model providers and API keys, machine default, per-Bot overrides
├── models.json          selectable models probed from each Agent, reported to the server for selection on the web
├── tools-latest.json    cache of latest-version lookups for Node.js / Claude Code / Codex
├── adapters/            ACP adapters (installed with npm on first run)
├── runtime/             Node.js managed by Gonggong Space
├── tools/               Claude Code / Codex managed by Gonggong Space
├── workspaces/          managed workspaces: workspaces/<group>/<Bot>/<repo>
├── backups/             local backups: overwritten local changes, half-finished work from interrupted runs
├── logs/                daemon logs: daemon.<date>.log
├── updates/             new versions downloaded by auto-upgrade (replaced only after verification)
├── bin/                 gg-cast downloaded from the server when using live view from the command line
├── run/                 temporary config generated at run time (including provider settings)
├── probe/               temporary directory used when probing selectable models
├── services.pids        records of managed service processes started by Bots
└── *.lock               lock files such as daemon.lock
```

Notes:

- `config.json` and `providers.json` contain credentials and are readable and writable only by you (0600). Don't send them to anyone.
- Apart from `config.json`, no file contains server credentials; however, `providers.json` contains third-party API keys.
- Directories are created on demand; features you haven't used don't create their directories.
- `daemon.lock` ensures only one daemon (`gg run` or the desktop app) runs per data directory.
- The `.gonggong/` subdirectory inside a workspace holds message attachments and managed service logs, and is part of the workspace.

## Local backups

If a Bot run is about to overwrite uncommitted local changes in the workspace, or a run is interrupted and leaves half-finished work behind, the daemon first saves them to `~/.gonggong/backups/`:

- They're stored only on this machine and **never uploaded to the server**.
- To view them: the 「本机备份 · 不上传」 (Local backups · not uploaded) section at the end of `gg workspaces` output, or the section of the same name at the bottom of the desktop app's 「工作区」 (Workspaces) page.
- `gg logout`, the desktop app's 「解除绑定…」 (Unbind…), and machine revocation **do not** delete the backup directory; delete it manually when you no longer need it.

## What unbinding deletes

| Action | `config.json` | Managed workspaces | Directories bound with `/cd` | Local backups | Other settings and providers |
| --- | --- | --- | --- | --- | --- |
| `gg logout` | Deleted | Kept | Kept | Kept | Kept |
| Desktop app 「解除绑定…」 (Unbind…) | Deleted | Deleted | Kept | Kept | Kept |
| Machine revoked / account deactivated | Deleted | Deleted | Kept | Kept | Kept |

Deletion on revocation is best-effort and not guaranteed to be complete.

## Logs

- Logs from the daemon (`gg run` or the desktop app) are written daily to `~/.gonggong/logs/daemon.<date>.log`, and the last 7 days are kept.
- To view them: `gg logs` (by default the last 200 lines at info and above), or 「最近日志」 (Recent logs) on the desktop app's 「日志与诊断」 (Logs & diagnostics) page.
- Logs are redacted by rule before being written: credential-like content such as tokens, passwords, API keys, and Authorization headers is replaced with `[REDACTED]`.
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

The bundle does not include `providers.json` or workspace contents.

## Environment variables

| Variable | Effect |
| --- | --- |
| `GONGGONG_HOME` | Data directory, `~/.gonggong` by default. Can be used to isolate multiple sets of data on one machine |
| `GONGGONG_LOG` | Log level for terminal output, using Rust `tracing` filter syntax, e.g. `info`, `debug`, `gonggong=debug`. When unset, the terminal shows only error level |
| `GONGGONG_NO_AUTO_UPGRADE` | When set to `1`, `gg run` doesn't auto-upgrade; same as turning off 「自动升级」 (Auto-upgrade) in settings |
| `GONGGONG_BROWSER` | Path to the browser executable used to generate preview card screenshots. When unset, Chrome / Edge / Chromium on this machine is found automatically |
| `GONGGONG_MACHINE_ID` | Overrides the hardware ID used to identify the machine. Use it only when running multiple isolated instances on one host (each with its own `GONGGONG_HOME`) |

Examples:

```bash
GONGGONG_LOG=debug gg run                 # print debug logs to the terminal
GONGGONG_HOME=/data/gonggong gg status    # use a different data directory
```

## Backup and migration

- **Back up**: `settings.json`, `local.json`, and `providers.json` (contains API keys; keep it safe). They're all local configuration, and the server has no copy.
- **No need to back up**: `adapters/`, `runtime/`, `tools/`, `models.json`, and the like can be re-downloaded or re-probed; managed workspaces can be re-cloned from their repositories.
- **Switching machines**: on the new machine, run `gg login` again (or bind in the desktop app), then configure providers again. On the same machine, running `gg login` again after `gg logout` restores the original machine record and Bot bindings.
- Don't copy `config.json` to another machine.

## Related pages

- [Command reference](/en/cli/reference)
- [Command-line installation](/en/cli/)
- [Pages · Logs and diagnostics](/en/desktop/pages#logs-and-diagnostics)
- [FAQ and troubleshooting](/en/guide/faq)
