# Docker 部署

用仓库自带的 `docker-compose.yml` 一条命令起全部服务端组件（PostgreSQL、server、Nginx + 网页），适合试用和小团队内网部署。需要 Docker 与 Docker Compose v2。

## 启动

```bash
git clone https://github.com/yoqu/gonggong-space.git && cd gonggong-space
GONGGONG_ADMIN_PASSWORD=<初始密码> GONGGONG_PUBLIC_URL=https://<服务器 IP 或域名> docker compose up -d
```

首次启动会构建镜像（几分钟）。完成后浏览器打开 `GONGGONG_PUBLIC_URL`，用 `admin` 和初始密码登录，按提示修改密码，然后 [绑定机器](/user/bind-machine)。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `GONGGONG_ADMIN_PASSWORD` | 无 | 首个管理员 `admin` 的初始密码，只在数据库没有账号时生效 |
| `GONGGONG_PUBLIC_URL` | `https://localhost` | 浏览器和成员机器访问主站的地址。只在本机试用可不填；局域网里填服务器 IP，端口不是 443 时要带上端口 |
| `GONGGONG_HTTPS_PORT` / `GONGGONG_HTTP_PORT` | `443` / `80` | 对外发布的端口 |
| `NPM_REGISTRY`（构建参数） | `https://registry.npmmirror.com` | 构建镜像时的 npm 源，海外可用 `docker compose build --build-arg NPM_REGISTRY=https://registry.npmjs.org` |

## 证书

首次启动时 server 在数据卷里生成自签证书（包含 `GONGGONG_PUBLIC_URL` 的主机名、`localhost`、`127.0.0.1`），Nginx 与 server 共用：

- 浏览器会提示证书不受信任，确认继续即可；
- 网页「绑定新机器」复制的命令带有证书指纹，daemon 固定这张证书，连接同样安全；
- 改了 `GONGGONG_PUBLIC_URL` 的主机名后，删掉数据卷里的 `tls/` 目录重启以重新生成，成员需重新 `gg login`。

正式环境建议换成受信任证书或按 [从源码部署](/deploy/install) 配置，见 [HTTPS 与证书](/deploy/https)。

## 数据与密钥

| 卷 | 内容 |
| --- | --- |
| `pg` | PostgreSQL 数据 |
| `data` | server 数据目录：加密附件、镜像、客户端安装包、证书，以及未设置 `GONGGONG_DATA_KEY` 时自动生成的 `data.key` |

`data.key` 与数据放在同一个卷里只适合试用。正式使用请把 `openssl rand -base64 32` 生成的值作为 `GONGGONG_DATA_KEY` 传给 server 并单独保管，见 [备份与恢复](/deploy/backup)。

## 预览

使用端口模式，开放 `41000–41019` 共 20 个预览端口，由 server 用同一张证书提供 HTTPS。防火墙需放行这些端口。实时画面（LiveKit）未在 compose 中开放端口。

## 升级

```bash
git pull && docker compose up -d --build
```

数据库迁移在 server 启动时自动执行。
