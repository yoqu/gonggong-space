# 备份与恢复

本页说明用仓库自带的 `scripts/backup.sh` 每天备份数据库和附件，以及用 `scripts/restore.sh` 恢复。

## 备份什么

| 内容 | 位置 | 是否由脚本备份 |
| --- | --- | --- |
| PostgreSQL 数据库 | `GONGGONG_DATABASE_URL` | 是，`pg_dump` 自定义格式 |
| 附件 | `$GONGGONG_DATA_DIR/attachments/` | 是，打成 tar.gz |
| 数据加密密钥 | `GONGGONG_DATA_KEY` | **否**，需单独妥善保管 |
| 基准分支镜像 | `$GONGGONG_DATA_DIR/mirrors/` | 否，丢失后会从仓库重新拉取 |
| 客户端安装包 | `$GONGGONG_DATA_DIR/downloads/` | 否，可重新上传 |

::: danger 密钥与备份分开保存
附件、diff 和运行过程是用 `GONGGONG_DATA_KEY` 加密的。没有密钥，备份里的这部分数据无法解密；而密钥和备份放在一起，拿到备份的人就能解密全部。请把密钥单独保存在密钥管理或离线介质中。
:::

## 每日备份

脚本读取的环境变量：

| 变量 | 说明 |
| --- | --- |
| `GONGGONG_BACKUP_DIR` | 备份输出目录（必填） |
| `GONGGONG_DATABASE_URL` | 数据库连接串；未设置时按 `GONGGONG_DB` / `GONGGONG_PG_PORT` 拼接，与 server 相同 |
| `GONGGONG_DATA_DIR` | server 数据目录，默认 `.gonggong-dev/data` |

需要能运行 `pg_dump`（与服务器 PostgreSQL 主版本一致或更新）。

手动执行一次：

```bash
cd /srv/gonggong
sudo -u gonggong env \
  GONGGONG_BACKUP_DIR=/var/backups/gonggong \
  GONGGONG_DATA_DIR=/var/lib/gonggong \
  GONGGONG_DATABASE_URL='postgres://gonggong:<密码>@127.0.0.1:5432/gonggong' \
  bash scripts/backup.sh
```

每次生成一对文件，以时间戳命名：

```text
gonggong-20260923-033000.dump
attachments-20260923-033000.tar.gz
```

两种文件各**只保留最新 7 份**，更早的自动删除（脚本固定为 7，不读取系统参数「服务器备份（每日）保留」）。写入时先写 `.part` 临时文件，完成后再改名，中途失败不会留下看似完整的半截备份。

用 cron 每天凌晨 3:30 执行：

```cron
30 3 * * * GONGGONG_BACKUP_DIR=/var/backups/gonggong GONGGONG_DATA_DIR=/var/lib/gonggong GONGGONG_DATABASE_URL=postgres://gonggong:<密码>@127.0.0.1:5432/gonggong /srv/gonggong/scripts/backup.sh >> /var/log/gonggong-backup.log 2>&1
```

::: tip
备份目录最好在另一块磁盘，并定期同步到异地。同时请确认备份目录的访问权限，备份中的消息正文、运行卡片等是明文。
:::

## 恢复

`restore.sh` 把指定时间戳的备份恢复到当前配置的数据库和数据目录，环境变量与备份相同。

1. 停止 server：
   ```bash
   sudo systemctl stop gonggong
   ```
2. 确认目标数据库已存在（新机器上先按 [从源码部署](/deploy/install#_3-创建数据库) 建好空库）。
3. 查看可用备份并恢复：
   ```bash
   ls /var/backups/gonggong
   sudo -u gonggong env \
     GONGGONG_BACKUP_DIR=/var/backups/gonggong \
     GONGGONG_DATA_DIR=/var/lib/gonggong \
     GONGGONG_DATABASE_URL='postgres://gonggong:<密码>@127.0.0.1:5432/gonggong' \
     bash scripts/restore.sh 20260923-033000
   ```
4. 确认 server 使用的是**备份时的** `GONGGONG_DATA_KEY`，然后启动：
   ```bash
   sudo systemctl start gonggong
   ```

恢复过程：

- 数据库用 `pg_restore --clean --if-exists` 在单个事务中执行，目标库中的同名对象会被替换；出错时整体回滚。
- 附件目录会先整个删除，再从备份解压。
- 该时间戳没有附件备份（当时还没有附件）时只恢复数据库。

::: warning
恢复会覆盖当前数据，备份时间点之后的消息、运行和附件都会丢失。成员机器上 daemon 的绑定保存在数据库里，恢复到较早的备份后，之后才绑定的机器需要重新绑定。
:::

## 相关页面

- [从源码部署](/deploy/install)
- [升级与发布客户端](/deploy/upgrade)
- [安全模型](/deploy/security)
