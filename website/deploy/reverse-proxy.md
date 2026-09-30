# 反向代理与预览域名

本页说明如何用 Nginx 反向代理共工空间（主站与 daemon 连接），以及 Bot 结果预览的两种访问方式：端口模式与泛域名模式。

## 预览的两种模式

Bot 在成员机器上启动的网页、服务，经 daemon 与 server 之间的隧道暴露给浏览器。server 按以下两种方式之一提供预览地址：

| | 端口模式 | 泛域名模式 |
| --- | --- | --- |
| 适用 | 局域网、开发试用 | 生产环境、需要对外分享 |
| 启用 | 默认（未设置 `GONGGONG_PREVIEW_DOMAIN`） | 设置 `GONGGONG_PREVIEW_DOMAIN` |
| 预览地址 | `<协议>://<主站主机名>:<端口>` | `https://<16 位随机标识>.<预览域名>` |
| 监听 | 每个打开的预览占一个端口，范围 `GONGGONG_PREVIEW_PORTS`（默认 `41000-41099`） | 不额外占端口，由 server 主端口按 Host 头分流 |
| 反向代理 | 端口需直接对浏览器开放 | Nginx 只需一个固定的泛域名 server 块 |
| Cookie 隔离 | 与主站同一主机，较弱 | 独立域名，完全隔离 |

### 端口模式

适合局域网：成员直接访问服务器的预览端口。

```ini
GONGGONG_PREVIEW_PORTS=41000-41099   # 可选，调整端口范围
GONGGONG_PREVIEW_HOST=0.0.0.0        # 让预览端口对局域网开放（默认跟随 HOST，即只监听本机）
```

- 防火墙需放行整个端口范围。端口用完时新预览会失败并提示「预览端口 … 已用完」。
- server 配置了 TLS 时，预览端口同样使用这张证书提供 HTTPS。
- 预览页面与主站同一个主机名，浏览器会把主站的会话 Cookie 也发给预览端口（Cookie 不区分端口）。server 在转发给成员机器前会去掉 Cookie，并拒绝来自其他来源的写请求和 WebSocket，但 Bot 写的页面仍与主站同源性较近。**对外开放时请使用泛域名模式。**

### 泛域名模式

预览放在一个**与主站不同的独立可注册域名**下，例如：

| 用途 | 域名 |
| --- | --- |
| 主站 | `gg.example.com` |
| 预览 | `*.example-preview.com` |

```ini
GONGGONG_PREVIEW_DOMAIN=example-preview.com
GONGGONG_PUBLIC_URL=https://gg.example.com
```

::: danger 预览域名不能是主站的子域
不要用 `preview.example.com` 或 `*.gg.example.com` 这类与主站同属一个可注册域名的地址。预览页面是 Bot 写的任意代码，只有放在独立的可注册域名下，浏览器才能保证它读写不到主站的 Cookie。
:::

server 收到请求时检查 Host 头：形如 `<标识>.example-preview.com` 的请求（只认一级子域）交给对应预览，其余按主站处理（见 `apps/server/src/modules/previews/gateway.ts`）。因此**新增预览不需要改 Nginx 或 DNS**，一条泛解析加一个泛域名 server 块就够了。未登录的访问者打开预览时，会被带到主站登录后再回来；公开链接的访问者则不需要登录。

## 必须设置 GONGGONG_PUBLIC_URL

server 没有开启对代理头的信任（Fastify `trustProxy`），放在 Nginx 后面时，它看到的请求协议永远是 `http`，端口也不是浏览器实际用的端口。`GONGGONG_PUBLIC_URL` 告诉 server 浏览器实际访问主站的地址，用于：

- 拼接预览地址的协议和端口（否则会生成 `http://…` 这样的错误地址）；
- 把未登录的预览访问者跳转回主站登录；
- 生成 Bot 可以在回复里提及的预览链接。

```ini
GONGGONG_PUBLIC_URL=https://gg.example.com   # 不要带结尾斜杠
```

## DNS

| 记录 | 类型 | 值 |
| --- | --- | --- |
| `gg.example.com` | A / AAAA | 服务器 IP |
| `*.example-preview.com` | A / AAAA | 服务器 IP |

只用端口模式时不需要第二条。

## Nginx 配置

以下配置假设：网页构建产物在 `/srv/gonggong/apps/web/dist`，server 以 HTTP 监听 `127.0.0.1:8787`（HTTPS 由 Nginx 终止，见 [HTTPS 与证书 · 方案一](/deploy/https#方案一-公网域名-受信任证书)）。

### 需要代理的路径

server 不托管网页，只有以下路径需要转发，其余都是网页静态文件：

| 路径 | 用途 |
| --- | --- |
| `/api/` | 全部 HTTP 接口，包括 daemon 的 `/api/daemon/*` |
| `/ws/web` | 浏览器实时推送（WebSocket） |
| `/ws/daemon` | daemon 主连接（WebSocket） |
| `/ws/daemon/tunnel` | daemon 预览隧道（WebSocket） |
| `/livekit` | 实时画面信令（WebSocket） |
| `/downloads/` | daemon 与 gg-cast 安装包，daemon 自动升级从这里下载 |

### 完整示例

`/etc/nginx/conf.d/gonggong.conf`：

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    server_name gg.example.com *.example-preview.com;
    return 301 https://$host$request_uri;
}

# 主站：网页 + 接口 + daemon 连接
server {
    listen 443 ssl;
    http2 on;
    server_name gg.example.com;

    ssl_certificate     /etc/nginx/ssl/gg.example.com/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/gg.example.com/key.pem;

    client_max_body_size 300m;   # 附件上限 50 MB，客户端安装包上传上限 300 MB

    root /srv/gonggong/apps/web/dist;

    location / {
        try_files $uri /index.html;   # 单页应用：未知路径回落到 index.html
    }

    location = /sw.js {
        add_header Cache-Control "no-cache";
    }

    location ~ ^/(api|ws|livekit|downloads)(/|$) {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }
}

# 预览泛域名：整站转发给 server，由 server 按 Host 分流
server {
    listen 443 ssl;
    http2 on;
    server_name *.example-preview.com;

    ssl_certificate     /etc/nginx/ssl/example-preview.com/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/example-preview.com/key.pem;

    client_max_body_size 300m;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }
}
```

`http2 on;` 需要 Nginx 1.25.1 及以上；更早的版本改为 `listen 443 ssl http2;`。

### 各项为什么需要

| 配置 | 原因 |
| --- | --- |
| `proxy_set_header Host $host` | **必须原样透传 Host。** server 靠 Host 判断请求属于哪个预览；还会比对浏览器的 Origin 与 Host，不一致的写请求和 WebSocket 会被拒绝（「拒绝跨站请求」）。Nginx 不监听标准 443 端口时改用 `$http_host`，保留端口号 |
| `Upgrade` / `Connection` + `map` | 转发 WebSocket 握手。浏览器实时推送、daemon 连接、预览隧道、实时画面都依赖 WebSocket；预览里的网页也可能用 WebSocket（如开发服务器热更新） |
| `proxy_http_version 1.1` | WebSocket 与长连接需要 |
| `X-Forwarded-Proto` / `X-Forwarded-For` | 传递原始协议和客户端地址，供预览里的本地服务使用 |
| `proxy_buffering off` | 流式响应（运行过程、预览里的 SSE 等）不被 Nginx 攒起来 |
| `proxy_request_buffering off` | 附件和安装包上传直接流给 server，不先落到 Nginx 临时文件 |
| `proxy_read_timeout 1h` | WebSocket 长时间保持；daemon 自带心跳，1 小时足够 |
| `client_max_body_size 300m` | Nginx 默认只允许 1 MB 请求体，会挡住附件和安装包上传 |

修改后执行 `nginx -t && nginx -s reload`。

::: tip 只用端口模式时
删掉预览泛域名的 server 块和 80 端口里的 `*.example-preview.com` 即可，主站配置不变；预览端口按上文直接对浏览器开放。
:::

## 泛域名证书

预览域名需要一张泛域名证书。Let's Encrypt 和 ZeroSSL 都免费签发泛域名证书，但**泛域名只能用 DNS-01 验证**：签发工具要调用 DNS 服务商的 API 添加 TXT 记录。

以 [acme.sh](https://github.com/acmesh-official/acme.sh) 和阿里云 DNS 为例：

```bash
# 1. 安装 acme.sh
curl https://get.acme.sh | sh -s email=admin@example.com

# 2. 提供 DNS API 凭据（建议用只有 DNS 解析权限的子账号 AccessKey）
export Ali_Key="…"
export Ali_Secret="…"

# 3. 签发：泛域名不包含裸域，两个 -d 都要写
acme.sh --issue --server letsencrypt --dns dns_ali \
  -d example-preview.com -d '*.example-preview.com'

# 4. 安装到 Nginx 目录，续期后自动重载
mkdir -p /etc/nginx/ssl/example-preview.com
acme.sh --install-cert -d example-preview.com \
  --key-file       /etc/nginx/ssl/example-preview.com/key.pem \
  --fullchain-file /etc/nginx/ssl/example-preview.com/fullchain.pem \
  --reloadcmd      "nginx -s reload"
```

- 其他 DNS 服务商：DNSPod（腾讯云）用 `--dns dns_tencent`（凭据 `Tencent_SecretId` / `Tencent_SecretKey`），Cloudflare 用 `--dns dns_cf`（凭据 `CF_Token` 及 `CF_Account_ID` 或 `CF_Zone_ID`）。
- acme.sh 默认 CA 是 ZeroSSL，需要 Let's Encrypt 时加 `--server letsencrypt`（上例已加）。
- 凭据会保存在 acme.sh 配置里，安装时自动加入定时任务，到期前自动续期并执行 `--reloadcmd`。
- 主站证书用同样方法签发（`-d gg.example.com`，也可用 `--nginx` 走 HTTP-01）。

::: warning 主站证书续期会影响 daemon
daemon 只连主站，并固定主站证书的指纹，**主站**证书续期后成员需要重新绑定；预览域名证书续期不影响 daemon。详见 [HTTPS 与证书 · 续期与更换](/deploy/https#续期与更换)。
:::

也可以用 Caddy 代替 Nginx：它能自动申请和续期证书，泛域名证书需要使用带对应 DNS 服务商插件的 Caddy 构建。

## 注意事项

### 单实例

server 的浏览器实时推送、daemon 连接和预览隧道都保存在进程内存里，每条隧道 WebSocket 只连在一个 server 实例上。请只运行**一个** server 实例，不要在 Nginx 后面挂多个实例做负载均衡，否则预览请求可能落到没有该隧道的实例上而失败。

### 客户端 IP

server 不信任代理头，放在 Nginx 后面时所有请求在它看来都来自 `127.0.0.1`。按 IP 计数的限流会因此由全体成员共享：

- 绑定码连续输错 10 次（10 分钟内）后，所有人都要等 10 分钟才能再绑定；
- 开放自助注册时，每小时最多注册 5 个账号。

登录失败限流按账号计数，不受影响。

## 相关页面

- [HTTPS 与证书](/deploy/https)
- [环境变量](/deploy/env)
- [结果预览](/user/previews)
- [公开分享](/user/shares)
- [安全模型](/deploy/security)
