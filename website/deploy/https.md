# HTTPS 与证书

本页说明 daemon 如何校验服务器证书，以及两种证书方案（受信任证书、自签证书）怎么配、成员机器怎么绑定。

## daemon 的连接规则

成员机器上的 daemon（命令行 `gg` 与桌面端）连接服务器时：

| 服务器地址 | 是否允许 | 证书校验 |
| --- | --- | --- |
| `https://…` | 允许 | 默认按系统 CA 证书库校验；也可在绑定时指定证书指纹或 CA 文件 |
| `http://localhost`、`http://127.0.0.1` 等本机地址 | 允许 | 不加密 |
| 其他 `http://…` | **拒绝**，提示「只允许通过 https:// 连接非本机服务器」 | — |

也就是说，**成员机器和服务器不在同一台机器上时，服务器必须启用 HTTPS**。证书校验方式在绑定时确定，保存在本机的绑定信息里：

| 证书 | 绑定方式 |
| --- | --- |
| 公共 CA 签发（Let's Encrypt 等） | 直接用网页「绑定新机器」给出的接入链接或命令，无需额外参数 |
| 自签证书 | `gg login --server <地址> --code <接入码> --fingerprint <证书指纹>`，只信任这一张证书 |
| 内网 CA 签发 | `gg login --server <地址> --code <接入码> --ca-file <CA 证书 PEM 文件>` |

`--fingerprint` 与 `--ca-file` 二选一，都要和 `--server` 一起用。接入链接（`gonggong://bind?…`）也可以带 `fp=<证书指纹>` 参数，效果与 `--fingerprint` 相同。完整参数见 [命令参考](/cli/reference)。

::: warning 浏览器跳过证书警告不等于 daemon 能连
浏览器里点「继续访问」只对浏览器有效。自签证书的服务器，daemon 不带 `--fingerprint` 或 `--ca-file` 绑定会报证书错误。
:::

## 方案一：公网域名 + 受信任证书（推荐）

适合正式部署：Nginx 使用 Let's Encrypt 等公共 CA 签发的证书终止 HTTPS，server 只在本机用 HTTP 监听。成员绑定时无需任何证书参数，网页上的「发给你的 Agent」一句话接入也只在这种情况下开箱可用（安装脚本用 `curl` 下载 `gg`，会校验证书）。

1. 为主站域名（如 `gg.example.com`）申请证书。单域名证书可用 HTTP-01 验证（`certbot --nginx` 或 `acme.sh --nginx`）；预览泛域名证书只能用 DNS-01，见 [反向代理与预览域名](/deploy/reverse-proxy#泛域名证书)。
2. 在 Nginx 中配置证书，反向代理到 `http://127.0.0.1:8787`，见 [反向代理与预览域名](/deploy/reverse-proxy)。
3. server **不设置** `GONGGONG_TLS_CERT` / `GONGGONG_TLS_KEY`，但必须设置：
   ```ini
   GONGGONG_SECURE_COOKIES=1
   GONGGONG_PUBLIC_URL=https://gg.example.com
   ```

## 方案二：局域网自签证书

适合没有公网域名的内网或局域网。

### 生成自签证书

仓库自带脚本，生成包含 `localhost`、`127.0.0.1` 和本机所有局域网 IPv4 地址的自签证书（有效期 825 天）：

```bash
bash scripts/dev-cert.sh                     # 默认输出到 .gonggong-dev/tls/
bash scripts/dev-cert.sh /etc/gonggong/tls   # 或指定目录
```

脚本打印要设置的环境变量：

```text
GONGGONG_TLS_CERT=/…/cert.pem GONGGONG_TLS_KEY=/…/key.pem
```

把它设为 server 的环境变量。设置后 server 在同一端口**只提供 HTTPS/WSS**，会话 Cookie 自动带 `Secure`。用自己的域名或内网 CA 签发证书时，同样把证书和私钥路径填进这两个变量即可。

### 查看证书指纹并绑定

在服务器上查看证书的 SHA-256 指纹：

```bash
openssl x509 -in /etc/gonggong/tls/cert.pem -noout -fingerprint -sha256
# sha256 Fingerprint=AB:CD:…（共 32 组）
```

把指纹发给成员。成员在网页「绑定新机器」→「其他方式」→「使用命令行」复制绑定命令，在末尾加上 `--fingerprint <指纹>` 后在机器上执行：

```bash
gg login --server https://192.168.1.10 --code K7QM-4X2P --fingerprint AB:CD:…
```

桌面端首次引导的输入框也接受这条带 `--fingerprint` 的完整命令。指纹可写成 `AB:CD:…`、`sha256:AB:CD:…` 或不带冒号的 64 位十六进制，大小写不限。服务器证书与指纹不符时，daemon 拒绝连接并提示「服务器证书指纹不匹配」。

内网有自己的 CA 时，把 CA 证书（PEM）分发到成员机器，改用 `--ca-file /path/to/ca.pem`；之后换用同一 CA 签发的新证书无需重新绑定。

### 配合开发服务器试用

不部署 Nginx、只在局域网试用时，网页开发服务器会读取同一对变量，以 HTTPS 对外并代理到 server：

```bash
export GONGGONG_TLS_CERT=… GONGGONG_TLS_KEY=…
GONGGONG_ADMIN_PASSWORD=初始密码 pnpm dev:server
WEB_HOST=0.0.0.0 pnpm dev:web          # 成员访问 https://<本机局域网 IP>:5173
```

浏览器会提示证书不受信任，确认继续即可；成员机器按上文用 `--fingerprint` 绑定 `https://<本机局域网 IP>:5173`。

### 配合 Nginx

正式的内网部署仍需要 Nginx 托管网页，可以直接复用 server 的证书文件：

```nginx
ssl_certificate     /etc/gonggong/tls/cert.pem;
ssl_certificate_key /etc/gonggong/tls/key.pem;

location ~ ^/(api|ws|livekit|downloads)(/|$) {
    proxy_pass https://127.0.0.1:8787;   # server 已启用 TLS，上游用 https
    proxy_ssl_verify off;
    # 其余 proxy_set_header 等同「反向代理」页
}
```

## 续期与更换

| 绑定方式 | 证书续期或更换后 |
| --- | --- |
| 系统 CA（公共证书） | 照常连接，**不需要重新绑定**（包括 Let's Encrypt 自动续期） |
| `--ca-file` | 新证书仍由同一 CA 签发时照常连接 |
| `--fingerprint` | 指纹随证书变化，**需要重新绑定**：在网页生成新的接入码，按上文带新指纹再执行一次 `gg login`，本机原有的机器记录和 Bot 会恢复 |

所以自签证书请一次给足有效期，并提前通知成员。

## 早期版本的绑定

v0.4.4 之前绑定的机器没有保存证书校验方式，升级后按系统 CA 校验。服务器用的是自签证书时，这些机器会连接失败，需要带 `--fingerprint` 或 `--ca-file` 重新执行 `gg login`。

::: danger GONGGONG_INSECURE_DEV 只用于本地开发
daemon 读到环境变量 `GONGGONG_INSECURE_DEV=1` 时会关闭证书校验，连接可被中间人冒充。不要在正式环境的成员机器上设置。
:::

## 相关页面

- [反向代理与预览域名](/deploy/reverse-proxy)
- [Docker 部署](/deploy/docker)
- [安全模型](/deploy/security)
- [绑定机器](/user/bind-machine)
- [命令参考](/cli/reference)
