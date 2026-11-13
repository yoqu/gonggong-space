# Docker 部署

本页介绍用仓库自带的 Docker 文件部署服务端（PostgreSQL、server、Nginx + 网页），以及在服务器上用容器运行常驻在线的成员机器（daemon）。需要 Docker 与 Docker Compose v2。

## 部署服务端

适合试用和小团队内网部署。

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

compose 里 PostgreSQL 的账号密码固定为 `gonggong`，数据库端口不对外发布。

### 证书

首次启动时 server 在数据卷里生成自签证书（包含 `GONGGONG_PUBLIC_URL` 的主机名、`localhost`、`127.0.0.1`，有效期 825 天），Nginx 与 server 共用：

- 浏览器会提示证书不受信任，确认继续即可。
- 成员机器的 daemon 默认按系统 CA 校验证书，绑定这台服务器时要带证书指纹。先查看指纹：
  ```bash
  docker compose exec server openssl x509 -in /data/tls/cert.pem -noout -fingerprint -sha256
  ```
  再在网页「绑定新机器」→「其他方式」→「使用命令行」复制的命令后加上 `--fingerprint <指纹>` 执行，详见 [HTTPS 与证书](/deploy/https#查看证书指纹并绑定)。
- 网页上「发给你的 Agent」一句话接入需要受信任的证书，用自签证书时请改用命令行或桌面端绑定。
- 改了 `GONGGONG_PUBLIC_URL` 的主机名后，删掉数据卷里的 `tls/` 目录重启以重新生成。证书变了，用指纹绑定的机器要带新指纹重新绑定。

正式环境建议换成受信任证书或按 [从源码部署](/deploy/install) 配置。

### 数据与密钥

| 卷 | 内容 |
| --- | --- |
| `pg` | PostgreSQL 数据 |
| `data` | server 数据目录：加密附件、产物、头像、强制同步文件、镜像、客户端安装包、证书，以及未设置 `GONGGONG_DATA_KEY` 时自动生成的 `data.key` |

`data.key` 与数据放在同一个卷里只适合试用。正式使用请把 `openssl rand -base64 32` 生成的值作为 `GONGGONG_DATA_KEY` 传给 server 并单独保管，见 [备份与恢复](/deploy/backup)。

### 预览

使用端口模式，开放 `41000–41019` 共 20 个预览端口，由 server 用同一张证书提供 HTTPS。防火墙需放行这些端口。实时画面（LiveKit）未在 compose 中开放端口。

### 升级

```bash
git pull && docker compose up -d --build
```

数据库迁移在 server 启动时自动执行。升级前建议先 [备份](/deploy/backup)。

## 在服务器上运行成员机器（daemon）

`docker/daemon/` 里的镜像把一台服务器变成常驻在线的成员机器：daemon 只向共工空间服务器发起连接，预览也走这条连接，不需要开放任何入站端口。

镜像内置：`gg`、Claude Code、Codex、Node.js 24、git（含 `gh`）、ripgrep、jq、编译工具、python3 与 `uv`（供 npx / uvx 启动的 MCP）、Chromium 与中文字体（截图、网页预览）、Xvfb（桌面应用预览）。`gg-cast` 不打进镜像，首次使用时从服务器下载。daemon 以普通用户 `gg` 运行，数据都在 `/home/gg` 一个卷里。

微信开发者工具、小程序实时画面和「用本机应用打开」只支持 macOS / Windows，容器里不可用。

### 启动

1. 进入目录并写好 `.env`。`GG_VERSION` 填要打包的 `gg` 版本；`GONGGONG_MACHINE_ID` 每个容器各取一个、之后不要改：

   ```bash
   cd docker/daemon
   printf 'GG_VERSION=0.4.20\nGONGGONG_MACHINE_ID=%s\n' "$(openssl rand -hex 16)" > .env
   ```

2. 在网页点头像菜单里的「绑定新机器」，展开「其他方式」→「在 Docker 中运行」，把那一行 `GONGGONG_BIND_URL='<接入链接>'` 加到 `.env`，然后构建、启动并常驻：

   ```bash
   docker compose up -d --build
   docker compose logs -f daemon
   ```

   容器首次启动时用这条接入链接自动绑定，绑定信息存进数据卷，之后重启不再需要它。接入码 30 分钟内有效；容器无人值守，接入码过期时不会转网页确认，而是直接失败，请重新生成后再启动。也可以先手动绑定再启动：`docker compose run --rm daemon gg login '<接入链接>'`。

   ::: tip 服务器用的是自签证书
   在接入链接末尾加上 `&fp=<证书指纹>`（指纹查看方法见上文「证书」），daemon 就只信任这张证书。
   :::

3. 登录 Agent，二选一：
   - 在网页上给这台机器配 API Key 类型的 [供应商](/user/agents-providers)，不用在容器里登录；
   - 用官方账号：在机器页「Agent 与供应商」的「官方登录」点「登录…」，按提示打开该机器的终端（或在服务器上 `docker compose exec daemon bash`）运行 `claude`（再输入 `/login`）或 `codex login --device-auth`。

4. 配置 git 凭据：在机器页「Git 访问」里生成 SSH 密钥并把公钥加到 Git 托管平台，或按主机添加 HTTPS 令牌，再用「测试连接」检查仓库地址。令牌只保存在容器的数据卷里，服务器不保存。首次连接新的 SSH 主机时自动信任其主机密钥。

5. 在机器页「诊断」里查看自检结果（等同 `gg doctor`）。

机器页的使用方法见 [我的机器](/user/machines)。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `GG_VERSION` | 无（必填） | 打包的 `gg` 版本，也是镜像标签 |
| `GONGGONG_MACHINE_ID` | 无（必填） | 机器身份。重建容器只要它不变，就还是同一台机器，Bot 不用重新绑定 |
| `GONGGONG_BIND_URL` | 无 | 「在 Docker 中运行」给出的接入链接，首次启动时自动绑定；已绑定后忽略 |
| `GG_CPUS` / `GG_MEMORY` | `4` / `8g` | 容器的 CPU 与内存上限 |
| `GG_DOWNLOAD_URL`（构建参数） | GitHub Releases | `gg` 的下载地址，可改为你们服务器的 `https://<服务器>/downloads`；文件都按 GitHub 发布的 `SHA256SUMS` 校验 |
| `NPM_REGISTRY`（构建参数） | `https://registry.npmmirror.com` | 安装 Claude Code、Codex 的 npm 源 |
| `CLAUDE_CODE_VERSION` / `CODEX_VERSION`（构建参数） | `latest` | 固定 Agent 版本 |

::: warning 旧版 Docker
Docker 20.10.10 以下的默认 seccomp 规则不认识 Debian 12 用到的新系统调用，镜像里的 apt、git 等会报错。请升级 Docker；暂时不能升级时，在本机构建镜像（`docker build --platform linux/amd64`）后用 `docker save` / `docker load` 传过去，并给 `daemon` 服务加 `security_opt: [seccomp:unconfined]`。
:::

要在一台服务器上跑多台机器，在 `compose.yml` 里复制 `daemon` 服务，各自换 `hostname`、`GONGGONG_MACHINE_ID` 和卷。

### 升级

容器里的 `gg` 放在数据卷（`/home/gg/.local/bin`），和其他 Linux 命令行 daemon 一样：服务器发布新版本后自动下载，空闲时重启完成升级；也可以在网页机器页点「立即升级」。新版本写进数据卷，重建容器后仍保留；启动时只有镜像里的 `gg` 比卷里的新，才会替换它。

Claude Code、Codex 在镜像里关闭了自动更新，随镜像升级：改 `.env` 里的 `GG_VERSION`（及需要时的 Agent 版本）后执行

```bash
docker compose build --pull && docker compose up -d
```

登录状态、供应商、工作区都在卷里，不受影响。用 v0.4.14 之前的 `docker/daemon` 文件建的容器不能在网页升级（机器页会给出改 `GG_VERSION` 重建的提示），先换成最新的 `Dockerfile`、`entrypoint.sh` 按上面重建一次。

::: warning 不要挂载 docker.sock
Bot 在容器里能执行任意命令。挂载 `/var/run/docker.sock` 等于把宿主机 root 交给 Bot。
:::

## 相关页面

- [部署概览](/deploy/)
- [HTTPS 与证书](/deploy/https)
- [我的机器](/user/machines)
- [升级与发布客户端](/deploy/upgrade)
