# 从源码部署

本页按步骤在一台 Linux 服务器上从源码部署共工Bot 服务端：准备环境、建库、构建网页、配置并用 systemd 启动 server、创建首个管理员。

以下示例假设：代码放在 `/srv/gonggong`，数据目录 `/var/lib/gonggong`，配置文件 `/etc/gonggong/server.env`，以系统用户 `gonggong` 运行。

## 1. 准备环境

| 软件 | 版本 |
| --- | --- |
| Node.js | 22 或更高 |
| pnpm | 由 corepack 提供，版本按根目录 `package.json` 的 `packageManager` 锁定 |
| PostgreSQL | 推荐 17 |
| git | 任意较新版本 |
| Nginx | 用于 HTTPS 与静态文件，见 [反向代理](/deploy/reverse-proxy) |

```bash
sudo corepack enable      # 启用 pnpm
node --version            # 确认 ≥ 22
```

## 2. 获取代码并安装依赖

```bash
sudo useradd --system --home /srv/gonggong --shell /usr/sbin/nologin gonggong
sudo git clone https://github.com/yoqu/gonggong.git /srv/gonggong
sudo chown -R gonggong: /srv/gonggong
cd /srv/gonggong
sudo -u gonggong pnpm install --frozen-lockfile
```

server 直接用 `tsx` 运行 TypeScript 源码，没有单独的编译步骤，所以需要安装完整依赖（含 devDependencies）。

## 3. 创建数据库

server 只需要一个空库，表结构会在启动时自动创建和升级。

```bash
sudo -u postgres createuser --pwprompt gonggong
sudo -u postgres createdb --owner gonggong gonggong
```

连接串形如 `postgres://gonggong:<密码>@127.0.0.1:5432/gonggong`，稍后写进 `GONGGONG_DATABASE_URL`。

::: tip
开发时用的 `pnpm db:up` 会在仓库目录里起一个免密的本地 PostgreSQL（端口 54329），只适合开发和试用，生产环境请用正式安装的 PostgreSQL。
:::

## 4. 构建网页

```bash
cd /srv/gonggong
sudo -u gonggong pnpm --filter @gonggong/web build
```

产物在 `apps/web/dist/`，是纯静态文件，由 Nginx 直接托管（server 不提供网页文件）。构建不需要任何环境变量，同一份产物可用于任意域名。

## 5. 写配置文件

生成数据加密密钥并建目录：

```bash
sudo mkdir -p /etc/gonggong /var/lib/gonggong
sudo chown gonggong: /var/lib/gonggong
openssl rand -base64 32      # 输出填到下面的 GONGGONG_DATA_KEY
```

`/etc/gonggong/server.env`（权限设为 `600`，属主 root 或 gonggong）：

```ini
GONGGONG_DATABASE_URL=postgres://gonggong:<密码>@127.0.0.1:5432/gonggong
GONGGONG_DATA_DIR=/var/lib/gonggong
GONGGONG_DATA_KEY=<上一步生成的 base64>
GONGGONG_ADMIN_PASSWORD=<首个管理员的初始密码>
# 由 Nginx 终止 HTTPS 时必须设置：
GONGGONG_SECURE_COOKIES=1
GONGGONG_PUBLIC_URL=https://gg.example.com
# 需要对外分享预览时（见「反向代理与预览域名」）：
# GONGGONG_PREVIEW_DOMAIN=example-preview.com
```

::: danger 务必显式设置 GONGGONG_DATA_KEY
不设置时 server 会在工作目录下生成 `.gonggong-dev/data.key` 当作密钥，只适合开发。密钥丢失后附件、diff 和运行过程都无法解密。请把它保存在密钥管理或离线介质中，**不要**和数据库备份放在一起。
:::

`GONGGONG_DATA_DIR`、`GONGGONG_DATABASE_URL` 都有开发用的默认值（相对工作目录的 `.gonggong-dev/…` 和本地 54329 端口），生产环境请全部显式设置。完整列表见 [环境变量](/deploy/env)。

### 仓库访问凭据

群绑定 Git 仓库后，server 会在数据目录的 `mirrors/` 下维护基准分支镜像，用于输入 `@` 时的文件候选和文件搜索。server 以运行用户的身份执行 `git`，并关闭了交互式密码提示，所以需要预先配置好只读凭据，例如部署密钥：

```ini
GIT_SSH_COMMAND=ssh -i /etc/gonggong/deploy_key -o IdentitiesOnly=yes
```

也可以用 git 的 credential helper。没有凭据时 Bot 照常工作（成员机器用自己的凭据克隆），只是 `@` 文件候选和文件搜索拿不到该仓库的文件。

## 6. 用 systemd 启动

`/etc/systemd/system/gonggong.service`：

```ini
[Unit]
Description=Gonggong server
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=gonggong
WorkingDirectory=/srv/gonggong/apps/server
EnvironmentFile=/etc/gonggong/server.env
ExecStart=/srv/gonggong/apps/server/node_modules/.bin/tsx src/main.ts
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

`ExecStart` 等同于在 `apps/server` 下执行 `pnpm start`。启动并检查：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now gonggong
curl -s http://127.0.0.1:8787/api/health     # 返回 {"ok":true,"protocol":…}
journalctl -u gonggong -f                    # 查看日志
```

server 默认只监听 `127.0.0.1:8787`，由 Nginx 对外，见 [反向代理与预览域名](/deploy/reverse-proxy)。需要逐条请求日志时设置 `GONGGONG_LOG=1`。

### 数据库迁移

每次启动时 server 会自动应用 `apps/server/drizzle/` 下尚未执行的迁移，**不需要手动迁移**。升级代码后重启即可，见 [升级与发布客户端](/deploy/upgrade)。

## 首次管理员

数据库里还没有任何账号时，server 启动会用 `GONGGONG_ADMIN_PASSWORD` 创建系统管理员：

- 账号：`admin`
- 密码：`GONGGONG_ADMIN_PASSWORD` 的值
- 首次登录必须修改密码

之后该变量不再起作用（已有账号时不会重复创建或重置密码），可以从配置文件里删掉。

1. 浏览器打开主站，用 `admin` 和初始密码登录，按提示修改密码。
2. 进入「管理后台 → 账号与角色」，为成员创建账号，见 [账号与角色](/admin/users)。
3. 在 [客户端发布](/admin/releases) 上传 daemon 安装包，成员即可 [绑定机器](/user/bind-machine)。

## 下一步

- [HTTPS 与证书](/deploy/https)
- [反向代理与预览域名](/deploy/reverse-proxy)
- [备份与恢复](/deploy/backup)
- [安全模型](/deploy/security)
