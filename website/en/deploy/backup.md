# Backup and restore

This page explains how to back up the database and attachments daily with the repository's `scripts/backup.sh`, and how to restore with `scripts/restore.sh`.

## What to back up

| Content | Location | Backed up by the script |
| --- | --- | --- |
| PostgreSQL database | `GONGGONG_DATABASE_URL` | Yes, `pg_dump` custom format |
| Attachments | `$GONGGONG_DATA_DIR/attachments/` | Yes, as a tar.gz |
| Data encryption key | `GONGGONG_DATA_KEY` | **No**, keep it safe separately |
| Base-branch mirrors | `$GONGGONG_DATA_DIR/mirrors/` | No, re-fetched from the repository if lost |
| Client installers | `$GONGGONG_DATA_DIR/downloads/` | No, can be uploaded again |

::: danger Keep the key and the backups apart
Attachments, diffs, and run processes are encrypted with `GONGGONG_DATA_KEY`. Without the key, that part of the backup can't be decrypted; but if the key is stored with the backups, anyone who gets the backups can decrypt everything. Keep the key separately in a secrets manager or on offline media.
:::

## Daily backups

Environment variables read by the script:

| Variable | Description |
| --- | --- |
| `GONGGONG_BACKUP_DIR` | Backup output directory (required) |
| `GONGGONG_DATABASE_URL` | Database connection string; if unset, built from `GONGGONG_DB` / `GONGGONG_PG_PORT`, same as the server |
| `GONGGONG_DATA_DIR` | Server data directory; defaults to `.gonggong-dev/data` |

You need to be able to run `pg_dump` (same major version as the server's PostgreSQL, or newer).

Run it once manually:

```bash
cd /srv/gonggong
sudo -u gonggong env \
  GONGGONG_BACKUP_DIR=/var/backups/gonggong \
  GONGGONG_DATA_DIR=/var/lib/gonggong \
  GONGGONG_DATABASE_URL='postgres://gonggong:<password>@127.0.0.1:5432/gonggong' \
  bash scripts/backup.sh
```

Each run produces a pair of files named by timestamp:

```text
gonggong-20260923-033000.dump
attachments-20260923-033000.tar.gz
```

**Only the latest 7** of each kind are kept; older ones are deleted automatically (the script hardcodes 7 and doesn't read the system parameter 「服务器备份（每日）保留」 (Server backups (daily) retention)). Files are first written as `.part` temp files and renamed when complete, so a failure midway never leaves a half-written backup that looks complete.

Run it every day at 3:30 a.m. with cron:

```cron
30 3 * * * GONGGONG_BACKUP_DIR=/var/backups/gonggong GONGGONG_DATA_DIR=/var/lib/gonggong GONGGONG_DATABASE_URL=postgres://gonggong:<password>@127.0.0.1:5432/gonggong /srv/gonggong/scripts/backup.sh >> /var/log/gonggong-backup.log 2>&1
```

::: tip
Ideally put the backup directory on a different disk and sync it off-site regularly. Also check the backup directory's permissions: message bodies, run cards, and similar data in the backups are plaintext.
:::

## Restore

`restore.sh` restores the backup with the given timestamp into the currently configured database and data directory, using the same environment variables as the backup.

1. Stop the server:
   ```bash
   sudo systemctl stop gonggong
   ```
2. Make sure the target database exists (on a new machine, first create an empty database as in [Deploy from source](/en/deploy/install#_3-create-the-database)).
3. List the available backups and restore:
   ```bash
   ls /var/backups/gonggong
   sudo -u gonggong env \
     GONGGONG_BACKUP_DIR=/var/backups/gonggong \
     GONGGONG_DATA_DIR=/var/lib/gonggong \
     GONGGONG_DATABASE_URL='postgres://gonggong:<password>@127.0.0.1:5432/gonggong' \
     bash scripts/restore.sh 20260923-033000
   ```
4. Make sure the server uses the `GONGGONG_DATA_KEY` **from the time of the backup**, then start it:
   ```bash
   sudo systemctl start gonggong
   ```

What the restore does:

- The database is restored with `pg_restore --clean --if-exists` in a single transaction; objects with the same names in the target database are replaced, and on error everything is rolled back.
- The attachments directory is deleted entirely first, then extracted from the backup.
- If there's no attachment backup for that timestamp (there were no attachments yet), only the database is restored.

::: warning
Restoring overwrites the current data; messages, runs, and attachments created after the backup point are lost. Daemon bindings for members' machines are stored in the database, so after restoring an older backup, machines bound after that point need to be bound again.
:::

## Related pages

- [Deploy from source](/en/deploy/install)
- [Upgrades and client releases](/en/deploy/upgrade)
- [Security model](/en/deploy/security)
