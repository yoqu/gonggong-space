# 部署概览

本页介绍共工空间服务端由哪些组件组成、各自用哪些端口、推荐的最小部署拓扑，以及服务器需要准备的软件。

## 组件

| 组件 | 说明 |
| --- | --- |
| server | `apps/server`，Node.js（Fastify）。提供 `/api` 接口、浏览器与 daemon 的 WebSocket、附件存储、预览入口、客户端下载。**不提供网页静态文件** |
| web | `apps/web`，React 单页应用。`vite build` 后得到纯静态文件 `apps/web/dist/`，由 Nginx 等 Web 服务器托管 |
| PostgreSQL | 唯一的数据库。表结构在 server 启动时自动迁移 |
| 数据目录 | `GONGGONG_DATA_DIR`：加密附件、基准分支镜像、客户端安装包、LiveKit 程序等 |
| LiveKit（可选） | 「实时画面」预览用的媒体服务。默认由 server 在第一次使用时自动启动一个本机 `livekit-server` 子进程，也可以接入外部 LiveKit |
| daemon | 运行在**成员机器**上，不部署在服务器，见 [命令行 gg](/cli/) 与 [桌面端](/desktop/) |

server 按**单实例**设计：浏览器实时推送、daemon 连接、预览隧道都保存在进程内存中。不要运行多个 server 实例做负载均衡。

## 端口

| 端口 | 谁监听 | 谁访问 | 说明 |
| --- | --- | --- | --- |
| 443（及 80 跳转） | Nginx | 浏览器、daemon | 对外唯一入口 |
| 8787 | server | Nginx | 默认只监听 `127.0.0.1`，由 `HOST` / `PORT` 修改 |
| 5432 | PostgreSQL | server | 自建数据库时的默认端口；开发用 `pnpm db:up` 是 54329 |
| 41000–41099 | server | 浏览器 | 仅预览「端口模式」使用，每个打开的预览占一个端口；泛域名模式不用，见 [反向代理与预览域名](/deploy/reverse-proxy) |
| 7881/TCP、7882/UDP | livekit-server | 浏览器、daemon | 仅使用实时画面时需要，必须能被浏览器和成员机器直接访问（不经过 Nginx） |

## 最小部署拓扑

一台服务器即可跑起全部服务端组件：

```text
                   ┌──────────────────────── 服务器 ────────────────────────┐
 浏览器 ─┐          │                                                        │
         │  HTTPS   │  Nginx :443                                            │
         ├────────→ │   ├─ /                → apps/web/dist（静态文件）       │
 成员机器 │  WSS     │   ├─ /api /ws /livekit /downloads → server 127.0.0.1:8787 │
 daemon ─┘          │   └─ *.预览域名       → server（按 Host 分流到预览）   │
                    │                                                        │
                    │  server ──→ PostgreSQL                                 │
                    │     └────→ 数据目录 GONGGONG_DATA_DIR                   │
                    └────────────────────────────────────────────────────────┘
```

- Nginx 负责 HTTPS、托管网页静态文件，并把 `/api`、`/ws`、`/livekit`、`/downloads` 反向代理给 server。
- 成员机器上的 daemon 通过同一个域名连 server：`/api/daemon/*`、`/ws/daemon`（主连接）、`/ws/daemon/tunnel`（预览隧道）、`/downloads/*`（自动升级）。
- 需要让团队外的人访问 Bot 做出的网页预览时，再配置独立的预览泛域名。

具体配置见 [反向代理与预览域名](/deploy/reverse-proxy)。

::: tip 局域网试用
只在局域网里试用，可以不装 Nginx：用 `pnpm dev:server` + `pnpm dev:web` 启动，网页开发服务器会代理 `/api`、`/ws`、`/livekit` 到 server，局域网成员即可接入；想加密传输再配上自签证书，见 [HTTPS 与证书](/deploy/https#生成自签证书) 和 [快速上手](/guide/quick-start)。
:::

## 软件要求

| 软件 | 要求 |
| --- | --- |
| 操作系统 | Linux 或 macOS |
| Node.js | 22 或更高 |
| pnpm | 通过 `corepack enable` 启用，版本由根目录 `package.json` 锁定 |
| PostgreSQL | 推荐 17 |
| git | server 用它维护群仓库的基准分支镜像（`@` 文件候选和文件搜索），需要能访问群仓库，见 [从源码部署](/deploy/install#仓库访问凭据) |
| Nginx | 或其他能反向代理 WebSocket 的 Web 服务器 |
| openssl | 生成自签证书时需要 |
| livekit-server | 可选。Linux、Windows（x86_64 / arm64）上 server 会自动从 GitHub 下载官方发布包并校验；也可自行安装后用 `GONGGONG_LIVEKIT_BIN` 指定 |

服务器不需要安装 Claude Code、Codex 或 Rust，这些只在成员机器（或构建客户端的机器）上需要。

::: warning 磁盘加密
附件、diff 和运行过程在数据库或磁盘上是加密存储的，但基准分支镜像（数据目录下的 `mirrors/`）是明文 git 仓库。生产环境请开启服务器磁盘加密（如 LUKS）。见 [安全模型](/deploy/security#静态加密)。
:::

## 下一步

1. [从源码部署](/deploy/install)
2. [环境变量](/deploy/env)
3. [HTTPS 与证书](/deploy/https)
4. [反向代理与预览域名](/deploy/reverse-proxy)
5. [备份与恢复](/deploy/backup)
