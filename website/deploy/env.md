# 环境变量

本页列出 server、网页开发服务器和运维脚本读取的全部环境变量。server 不读取 `.env` 文件，请通过 systemd 的 `EnvironmentFile` 或进程环境传入。

## server

### 基础

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | server 监听地址 |
| `PORT` | `8787` | server 监听端口 |
| `GONGGONG_DATABASE_URL` | 无 | PostgreSQL 连接串，如 `postgres://gonggong:密码@127.0.0.1:5432/gonggong`。设置后忽略下面两项 |
| `GONGGONG_DB` | `gonggong` | 未设置连接串时使用的库名（连 `postgres://gonggong@127.0.0.1:<端口>/<库名>`） |
| `GONGGONG_PG_PORT` | `54329` | 未设置连接串时使用的端口，对应开发用的 `pnpm db:up` |
| `GONGGONG_DATA_DIR` | `.gonggong-dev/data` | 数据目录，存加密附件（`attachments/`）、基准分支镜像（`mirrors/`）、客户端安装包（`downloads/`）、LiveKit 程序等。默认值相对 server 工作目录，生产环境请设为绝对路径 |
| `GONGGONG_ADMIN_PASSWORD` | 无 | 数据库里没有任何账号时，用它创建系统管理员 `admin`（首次登录须改密）。已有账号后不起作用 |
| `GONGGONG_LOG` | 未开启 | 设为 `1` 输出逐条请求日志 |

### 安全

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `GONGGONG_DATA_KEY` | 开发时自动生成 | 静态加密密钥：32 字节随机数的 base64（`openssl rand -base64 32`）。未设置时在工作目录生成 `.gonggong-dev/data.key`，**生产环境必须显式设置** |
| `GONGGONG_TLS_CERT` | 无 | 证书文件（PEM）路径。与 `GONGGONG_TLS_KEY` 必须同时设置；设置后 server 只提供 HTTPS/WSS |
| `GONGGONG_TLS_KEY` | 无 | 私钥文件（PEM）路径 |
| `GONGGONG_SECURE_COOKIES` | 未开启 | 设为 `1` 时会话 Cookie 带 `Secure`。server 自己配置了 TLS 时自动开启；**由 Nginx 终止 HTTPS 时必须手动设为 `1`** |
| `GONGGONG_REDACT_VALUES` | 空 | 逗号分隔的已知密钥值，入库前一律替换为「[已脱敏]」，见 [安全模型](/deploy/security#脱敏) |
| `GIT_SSH_COMMAND` | `ssh -o BatchMode=yes` | server 维护基准分支镜像时 git 使用的 ssh 命令，可指定部署密钥，如 `ssh -i /etc/gonggong/deploy_key -o IdentitiesOnly=yes` |

### 预览

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `GONGGONG_PUBLIC_URL` | 无 | 浏览器访问主站的地址，如 `https://gg.example.com`。用于拼接预览地址的协议、给未登录的预览访问者跳转到主站登录。**放在反向代理后面时必须设置** |
| `GONGGONG_PREVIEW_DOMAIN` | 无 | 设置后启用泛域名模式，预览地址为 `<随机标识>.<预览域名>`。必须是与主站不同的独立可注册域名 |
| `GONGGONG_PREVIEW_PORTS` | `41000-41099` | 端口模式下预览可用的端口范围，格式 `起-止` |
| `GONGGONG_PREVIEW_HOST` | 同 `HOST` | 端口模式下预览端口的监听地址；局域网里让成员直接访问预览端口时设为 `0.0.0.0` |

两种模式的区别与配置见 [反向代理与预览域名](/deploy/reverse-proxy)。

### 实时画面（LiveKit）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `LIVEKIT_URL` | 无 | 外部 LiveKit 地址。与下面两项必须同时设置；设置后不再自动启动本机 livekit-server |
| `LIVEKIT_API_KEY` | 无 | 外部 LiveKit 的 API Key |
| `LIVEKIT_API_SECRET` | 无 | 外部 LiveKit 的 API Secret |
| `GONGGONG_LIVEKIT_BIN` | 自动查找 | 本机 livekit-server 程序路径。未设置时依次找数据目录里下载过的、`PATH` 上的，最后从 GitHub 下载官方发布包（仅 Linux / Windows） |
| `GONGGONG_LIVEKIT_TCP_PORT` | `7881` | 本机 livekit-server 的 TCP 媒体端口 |
| `GONGGONG_LIVEKIT_UDP_PORT` | `7882` | 本机 livekit-server 的 UDP 媒体端口 |
| `GONGGONG_LIVEKIT_NODE_IP` | 无 | 告诉客户端连接媒体端口用的 IP。服务器在 NAT 后、本机网卡地址不是客户端能访问的地址时设置为公网 IP |

本机 livekit-server 的信令只监听回环地址，由 server 的 `/livekit` 路径转发；两个媒体端口需要对浏览器和成员机器开放。

### 其他

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `GONGGONG_HEARTBEAT_SEC` | 系统参数「机器心跳间隔」 | daemon 心跳间隔（秒），优先于系统参数，启动时读取 |
| `GONGGONG_PUSH_SUBJECT` | `mailto:gonggong@example.com` | 浏览器推送通知（Web Push）的联系方式，建议改成管理员邮箱 |

## 网页开发服务器

只在用 `pnpm dev:web` 运行网页开发服务器时读取；生产环境用构建产物，不需要这些变量。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `WEB_HOST` | `127.0.0.1` | 监听地址，局域网访问设为 `0.0.0.0` |
| `WEB_PORT` | `5173` | 监听端口 |
| `GONGGONG_SERVER` | `http(s)://127.0.0.1:8787` | 代理 `/api`、`/ws`、`/livekit` 的目标 server |
| `GONGGONG_TLS_CERT` / `GONGGONG_TLS_KEY` | 无 | 与 server 共用同一份证书，设置后以 HTTPS 提供网页 |

## 运维脚本

| 变量 | 用于 | 说明 |
| --- | --- | --- |
| `GONGGONG_BACKUP_DIR` | `backup.sh`、`restore.sh` | 备份目录（必填），见 [备份与恢复](/deploy/backup) |
| `GONGGONG_DATABASE_URL`、`GONGGONG_DB`、`GONGGONG_PG_PORT`、`GONGGONG_DATA_DIR` | 备份脚本、`release.sh --publish` | 与 server 相同的含义 |
| `GONGGONG_ADMIN_PASSWORD` | `release.sh --publish` | 以管理员身份登录发布（必填） |
| `GONGGONG_ADMIN_ACCOUNT` | `release.sh --publish` | 发布用的管理员账号，默认 `admin` |
| `GONGGONG_CACERT` | `release.sh --publish` | server 使用自签证书时，信任的证书文件 |
| `GONGGONG_DOWNLOAD_BASE` | `release.sh` | 安装包放在 CDN 时的下载地址前缀，默认 `/downloads` |

daemon（成员机器上的 `gg`）读取的环境变量，如 `GONGGONG_INSECURE_DEV`、`GONGGONG_NO_AUTO_UPGRADE`，见 [命令参考](/cli/reference) 与 [本地数据与日志](/cli/local-data)。

## 相关页面

- [从源码部署](/deploy/install)
- [系统参数](/admin/params)
