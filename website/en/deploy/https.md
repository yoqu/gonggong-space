# HTTPS and certificates

This page explains how the daemon verifies the server certificate, how to set up each of the two certificate options (trusted certificate, self-signed certificate), and how members' machines bind under each.

## Daemon connection rules

When the daemon on a member's machine (command-line `gg` and the desktop app) connects to the server:

| Server address | Allowed | Certificate verification |
| --- | --- | --- |
| `https://…` | Allowed | Verified against the system CA store by default; you can also specify a certificate fingerprint or CA file when binding |
| Local addresses such as `http://localhost`, `http://127.0.0.1` | Allowed | Not encrypted |
| Any other `http://…` | **Rejected** with 「只允许通过 https:// 连接非本机服务器」 ("Non-local servers must use https://") | — |

In other words, **when members' machines and the server are not the same machine, the server must have HTTPS enabled**. The verification method is decided at bind time and saved in the local binding information:

| Certificate | How to bind |
| --- | --- |
| Issued by a public CA (Let's Encrypt, etc.) | Use the connect link or command from 「绑定新机器」 (Bind new machine) on the web as is; no extra parameters |
| Self-signed | `gg login --server <地址> --code <接入码> --fingerprint <证书指纹>`, which trusts only that one certificate |
| Issued by an internal CA | `gg login --server <地址> --code <接入码> --ca-file <CA 证书 PEM 文件>` |

(`<地址>` = server address, `<接入码>` = connect code, `<证书指纹>` = certificate fingerprint, `<CA 证书 PEM 文件>` = CA certificate PEM file.)

`--fingerprint` and `--ca-file` are mutually exclusive, and both must be used with `--server`. A connect link (`gonggong://bind?…`) can also carry an `fp=<证书指纹>` parameter, which has the same effect as `--fingerprint`. For all parameters, see [Command reference](/en/cli/reference).

::: warning Skipping the browser's certificate warning doesn't mean the daemon can connect
Clicking 「继续访问」 (Proceed) in the browser only applies to the browser. For a server with a self-signed certificate, binding the daemon without `--fingerprint` or `--ca-file` fails with a certificate error.
:::

## Option 1: public domain + trusted certificate (recommended)

For production deployments: Nginx terminates HTTPS with a certificate issued by a public CA such as Let's Encrypt, and the server listens on HTTP locally only. Members bind without any certificate parameters, and the one-sentence setup via 「发给你的 Agent」 (Send to your agent) on the web works out of the box only in this setup (the install script downloads `gg` with `curl`, which verifies the certificate).

1. Get a certificate for the main site domain (such as `gg.example.com`). A single-domain certificate can use HTTP-01 validation (`certbot --nginx` or `acme.sh --nginx`); the wildcard preview certificate can only use DNS-01. See [Reverse proxy and preview domains](/en/deploy/reverse-proxy#wildcard-certificates).
2. Configure the certificate in Nginx and reverse-proxy to `http://127.0.0.1:8787`. See [Reverse proxy and preview domains](/en/deploy/reverse-proxy).
3. On the server, **don't set** `GONGGONG_TLS_CERT` / `GONGGONG_TLS_KEY`, but you must set:
   ```ini
   GONGGONG_SECURE_COOKIES=1
   GONGGONG_PUBLIC_URL=https://gg.example.com
   ```

## Option 2: LAN self-signed certificate

For internal networks or LANs without a public domain.

### Generate a self-signed certificate

The repository includes a script that generates a self-signed certificate covering `localhost`, `127.0.0.1`, and all of this machine's LAN IPv4 addresses (valid for 825 days):

```bash
bash scripts/dev-cert.sh                     # writes to .gonggong-dev/tls/ by default
bash scripts/dev-cert.sh /etc/gonggong/tls   # or specify a directory
```

The script prints the environment variables to set:

```text
GONGGONG_TLS_CERT=/…/cert.pem GONGGONG_TLS_KEY=/…/key.pem
```

Set them as the server's environment variables. Once set, the server **serves only HTTPS/WSS** on the same port, and the session cookie gets `Secure` automatically. If you issue the certificate for your own domain or from an internal CA, put the certificate and private key paths into the same two variables.

### Check the certificate fingerprint and bind

On the server, look up the certificate's SHA-256 fingerprint:

```bash
openssl x509 -in /etc/gonggong/tls/cert.pem -noout -fingerprint -sha256
# sha256 Fingerprint=AB:CD:… (32 groups in total)
```

Send the fingerprint to members. A member copies the bind command from 「绑定新机器」 (Bind new machine) → 「其他方式」 (Other ways) → 「使用命令行」 (Use the command line) on the web, appends `--fingerprint <指纹>` (the fingerprint), and runs it on the machine:

```bash
gg login --server https://192.168.1.10 --code K7QM-4X2P --fingerprint AB:CD:…
```

The input box in the desktop app's first-run setup also accepts this full command with `--fingerprint`. The fingerprint can be written as `AB:CD:…`, `sha256:AB:CD:…`, or 64 hex digits without colons, in any case. If the server certificate doesn't match the fingerprint, the daemon refuses to connect with 「服务器证书指纹不匹配」 ("Server certificate fingerprint mismatch").

If your internal network has its own CA, distribute the CA certificate (PEM) to members' machines and use `--ca-file /path/to/ca.pem` instead; later switching to a new certificate issued by the same CA doesn't require rebinding.

### Trying it with the dev server

When you only want a LAN trial without deploying Nginx, the web dev server reads the same pair of variables, serves HTTPS, and proxies to the server:

```bash
export GONGGONG_TLS_CERT=… GONGGONG_TLS_KEY=…
GONGGONG_ADMIN_PASSWORD=初始密码 pnpm dev:server
WEB_HOST=0.0.0.0 pnpm dev:web          # members open https://<this machine's LAN IP>:5173
```

(`初始密码` = the initial password.) The browser warns that the certificate isn't trusted; confirm to continue. Members' machines bind to `https://<本机局域网 IP>:5173` (this machine's LAN IP) with `--fingerprint` as described above.

### With Nginx

A proper internal deployment still needs Nginx to host the web app, and it can reuse the server's certificate files directly:

```nginx
ssl_certificate     /etc/gonggong/tls/cert.pem;
ssl_certificate_key /etc/gonggong/tls/key.pem;

location ~ ^/(api|ws|livekit|downloads)(/|$) {
    proxy_pass https://127.0.0.1:8787;   # the server has TLS enabled, so the upstream uses https
    proxy_ssl_verify off;
    # other proxy_set_header lines are the same as on the reverse proxy page
}
```

## Renewal and replacement

| Binding method | After the certificate is renewed or replaced |
| --- | --- |
| System CAs (public certificate) | Connects as usual, **no rebinding needed** (including Let's Encrypt auto-renewal) |
| `--ca-file` | Connects as usual if the new certificate is issued by the same CA |
| `--fingerprint` | The fingerprint changes with the certificate, so you **must rebind**: generate a new connect code on the web and run `gg login` again with the new fingerprint as above. The machine's existing record and Bots are restored |

So give self-signed certificates a long enough validity period up front, and notify members in advance.

## Bindings from earlier versions

Machines bound before v0.4.4 didn't save a certificate verification method and, after upgrading, verify against the system CAs. If the server uses a self-signed certificate, these machines fail to connect and need to run `gg login` again with `--fingerprint` or `--ca-file`.

::: danger GONGGONG_INSECURE_DEV is for local development only
When the daemon reads the environment variable `GONGGONG_INSECURE_DEV=1`, it disables certificate verification, and the connection can be impersonated by a man in the middle. Never set it on members' machines in production.
:::

## Related pages

- [Reverse proxy and preview domains](/en/deploy/reverse-proxy)
- [Docker deployment](/en/deploy/docker)
- [Security model](/en/deploy/security)
- [Bind a machine](/en/user/bind-machine)
- [Command reference](/en/cli/reference)
