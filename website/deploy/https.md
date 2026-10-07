# HTTPS 与证书

本页说明共工空间什么时候该用 HTTPS，以及两种证书方案怎么配。

## 要不要 HTTPS

daemon（`gg` 与桌面端）用 `http://` 或 `https://` 都能连接任意服务器，绑定不需要额外的证书操作。但在不可信的网络上，建议启用 HTTPS：

- 网页登录、机器凭据和 Bot 的过程数据都经由这条连接传输，HTTPS 能防止被旁路窃听。
- 会话 Cookie 需要在 HTTPS 下带 `Secure` 标记。
- 浏览器推送通知等功能只在安全上下文（HTTPS）中可用。

::: warning daemon 不校验服务器证书
为了让绑定「拿到就能用」，daemon 接受服务器出示的**任何证书**（包括自签证书），不校验 CA 链，也不固定证书指纹。HTTPS 提供的是加密，但不能防止主动的中间人冒充服务器。公网部署请确认服务器地址无误，敏感场景建议放在内网或 VPN 内使用。
:::

## 方案一：公网域名 + 受信任证书

适合面向公网的正式部署：Nginx 使用 Let's Encrypt 等公共 CA 签发的证书终止 HTTPS，server 只在本机用 HTTP 监听。

1. 为主站域名（如 `gg.example.com`）申请证书。单域名证书可用 HTTP-01 验证（`certbot --nginx` 或 `acme.sh --nginx`）；预览泛域名证书只能用 DNS-01，见 [反向代理与预览域名](/deploy/reverse-proxy#泛域名证书)。
2. 在 Nginx 中配置证书，反向代理到 `http://127.0.0.1:8787`，见 [反向代理与预览域名](/deploy/reverse-proxy)。
3. server **不设置** `GONGGONG_TLS_CERT` / `GONGGONG_TLS_KEY`，但必须设置：
   ```ini
   GONGGONG_SECURE_COOKIES=1
   GONGGONG_PUBLIC_URL=https://gg.example.com
   ```

## 方案二：局域网自签证书

适合内网或局域网：没有公网域名，用自签证书，daemon 直接接受，无需额外配置。

### 生成自签证书

仓库自带脚本，生成包含 `localhost`、`127.0.0.1` 和本机所有局域网 IPv4 地址的自签证书（有效期 825 天）：

```bash
bash scripts/dev-cert.sh              # 默认输出到 .gonggong-dev/tls/
bash scripts/dev-cert.sh /etc/gonggong/tls   # 或指定目录
```

脚本打印要设置的环境变量：

```text
GONGGONG_TLS_CERT=/…/cert.pem GONGGONG_TLS_KEY=/…/key.pem
```

把它设为 server 的环境变量。设置后 server 在同一端口**只提供 HTTPS/WSS**，会话 Cookie 自动带 `Secure`。

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

证书到期前直接替换证书文件并重启 server（或 Nginx）即可。daemon 不固定证书，续期或更换（包括 Let's Encrypt 的自动续期）后已绑定的机器照常连接，**不需要重新绑定**。

## 相关页面

- [反向代理与预览域名](/deploy/reverse-proxy)
- [安全模型](/deploy/security)
- [绑定机器](/user/bind-machine)
- [命令参考](/cli/reference)
