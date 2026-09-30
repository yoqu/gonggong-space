# HTTPS 与证书

本页说明共工Bot 为什么必须用 HTTPS、两种证书方案怎么配，以及 daemon 的证书指纹固定对换证书意味着什么。

## 为什么必须 HTTPS

- **daemon 只允许用 `https://` 连接非本机服务器。** `http://` 只接受回环地址（`localhost`、`127.0.0.0/8`、`::1`），用于本机开发；其他地址一律报错「只允许通过 https:// 连接非本机服务器」。
- 会话 Cookie 需要在 HTTPS 下带 `Secure` 标记。
- 浏览器推送通知等功能只在安全上下文（HTTPS）中可用。

## daemon 的证书固定

daemon 不依赖 CA 证书链，而是**固定服务器叶子证书的 SHA-256 指纹**：

1. 成员执行 `gg login` 绑定时：
   - 带 `--fingerprint sha256:AB:CD:…`（或使用 Web 生成的接入链接，其中带有指纹）：只接受该指纹的证书。
   - 不带指纹：首次信任，把当时看到的证书指纹写入本机配置并打印出来，成员应与管理员公布的值核对。
2. 之后 daemon 的所有 HTTPS 与 WebSocket 连接都校验这个指纹，不一致就拒绝连接并报错「服务器证书指纹不匹配，拒绝连接」。

因此自签证书和公共 CA 证书一样安全，而且 daemon 不会因为操作系统信任了某个 CA 就被中间人冒充。命令用法见 [命令参考](/cli/reference)。

::: warning 换证书 = 指纹变化
固定的是**整张叶子证书**，不是 CA 也不是公钥。证书续期或更换后（包括 Let's Encrypt 的自动续期），指纹都会变，所有已绑定的 daemon 会拒绝连接。此时需要：

1. 公布新证书的指纹。
2. 每位成员在网页上重新生成绑定码，执行 `gg login` 重新绑定（原有机器记录和 Bot 会自动恢复）。

规划证书方案时请考虑这一点，见下文 [续期与更换](#续期与更换)。
:::

## 查看证书指纹

```bash
openssl x509 -in cert.pem -noout -fingerprint -sha256 | sed 's/.*=/sha256:/'
```

对于包含证书链的文件（如 Let's Encrypt 的 `fullchain.pem`），`openssl x509` 只读第一张，也就是叶子证书，正是 daemon 固定的那张。

`gg login --fingerprint` 接受 `sha256:AB:CD:…`、`AB:CD:…` 或不带冒号的 64 位十六进制，大小写均可。

## 方案一：公网域名 + 受信任证书

适合面向公网的正式部署：Nginx 使用 Let's Encrypt 等公共 CA 签发的证书终止 HTTPS，server 只在本机用 HTTP 监听。

1. 为主站域名（如 `gg.example.com`）申请证书。单域名证书可用 HTTP-01 验证（`certbot --nginx` 或 `acme.sh --nginx`）；预览泛域名证书只能用 DNS-01，见 [反向代理与预览域名](/deploy/reverse-proxy#泛域名证书)。
2. 在 Nginx 中配置证书，反向代理到 `http://127.0.0.1:8787`，见 [反向代理与预览域名](/deploy/reverse-proxy)。
3. server **不设置** `GONGGONG_TLS_CERT` / `GONGGONG_TLS_KEY`，但必须设置：
   ```ini
   GONGGONG_SECURE_COOKIES=1
   GONGGONG_PUBLIC_URL=https://gg.example.com
   ```
4. 用上面的命令算出 Nginx 所用证书的指纹，公布给成员。

此方案下 server 自己没有证书，Web「绑定新机器」生成的命令和接入链接**不带指纹**，daemon 首次绑定时信任它看到的 Nginx 证书，并打印指纹供核对。

## 方案二：局域网自签证书

适合内网或局域网：没有公网域名，用自签证书，指纹由接入链接自动带给 daemon。

### 生成自签证书

仓库自带脚本，生成包含 `localhost`、`127.0.0.1` 和本机所有局域网 IPv4 地址的自签证书（有效期 825 天）：

```bash
bash scripts/dev-cert.sh              # 默认输出到 .gonggong-dev/tls/
bash scripts/dev-cert.sh /etc/gonggong/tls   # 或指定目录
```

脚本打印两行：

```text
GONGGONG_TLS_CERT=/…/cert.pem GONGGONG_TLS_KEY=/…/key.pem
sha256:AB:CD:…
```

把第一行设为 server 的环境变量，第二行就是要公布的指纹。设置后 server 在同一端口**只提供 HTTPS/WSS**，会话 Cookie 自动带 `Secure`，Web 生成的接入链接自动带上指纹。

用自己的域名或内网 CA 签发证书时，同样把证书和私钥路径填进这两个变量即可。

### 配合开发服务器试用

不部署 Nginx、只在局域网试用时，网页开发服务器会读取同一对变量，以 HTTPS 对外并代理到 server：

```bash
export GONGGONG_TLS_CERT=… GONGGONG_TLS_KEY=…
GONGGONG_ADMIN_PASSWORD=初始密码 pnpm dev:server
WEB_HOST=0.0.0.0 pnpm dev:web          # 成员访问 https://<本机局域网 IP>:5173
```

浏览器会提示证书不受信任，确认继续即可。

### 配合 Nginx

正式的内网部署仍需要 Nginx 托管网页。**让 Nginx 使用与 server 完全相同的证书文件**，daemon 看到的证书才与接入链接里的指纹一致：

```nginx
ssl_certificate     /etc/gonggong/tls/cert.pem;
ssl_certificate_key /etc/gonggong/tls/key.pem;

location ~ ^/(api|ws|livekit|downloads)(/|$) {
    proxy_pass https://127.0.0.1:8787;   # server 已启用 TLS，上游用 https
    proxy_ssl_verify off;
    # 其余 proxy_set_header 等同「反向代理」页
}
```

如果 Nginx 与 server 用的证书不同，接入链接里的指纹会与 daemon 实际看到的不符而绑定失败。这时让成员改用不带 `--fingerprint` 的命令绑定，再人工核对指纹。

## 续期与更换

| 证书 | 有效期 | 对 daemon 的影响 |
| --- | --- | --- |
| `dev-cert.sh` 自签 | 825 天 | 到期前手动更换，一次性通知成员重新绑定 |
| Let's Encrypt | 90 天，一般每 60 天自动续期 | 每次续期后成员都需要重新绑定 |
| 其他公共 CA | 以签发为准 | 每次更换后需要重新绑定 |

::: tip
换证书前先在群里通知成员，并准备好新指纹。成员重新绑定时执行 `gg login` 即可，原有机器记录和 Bot 绑定保持不变。桌面端用户在应用里重新粘贴绑定命令，见 [桌面端首次引导](/desktop/onboarding)。
:::

## 开发用：关闭证书固定

在成员机器上设置 `GONGGONG_INSECURE_DEV=1` 会关闭证书固定（daemon 会醒目警告），连接可被中间人冒充，**只能用于本地开发**。

## 相关页面

- [反向代理与预览域名](/deploy/reverse-proxy)
- [安全模型](/deploy/security)
- [绑定机器](/user/bind-machine)
- [命令参考](/cli/reference)
