# Reverse proxy and preview domains

This page explains how to put Gonggong Space (the main site and daemon connections) behind an Nginx reverse proxy, and the two ways to serve Bot previews: port mode and wildcard-domain mode.

## The two preview modes

Web pages and services that a Bot starts on a member's machine are exposed to the browser through a tunnel between the daemon and the server. The server provides preview URLs in one of two ways:

| | Port mode | Wildcard-domain mode |
| --- | --- | --- |
| Suited to | LANs, development trials | Production, sharing outside the team |
| Enabled | By default (`GONGGONG_PREVIEW_DOMAIN` not set) | Set `GONGGONG_PREVIEW_DOMAIN` |
| Preview URL | `<协议>://<主站主机名>:<端口>` (scheme, main site host name, port) | `https://<16 位随机标识>.<预览域名>` (16-character random ID, preview domain) |
| Listening | Each open preview takes one port from `GONGGONG_PREVIEW_PORTS` (default `41000-41099`) | No extra ports; the server's main port routes by the Host header |
| Reverse proxy | Ports must be directly open to browsers | Nginx needs just one fixed wildcard server block |
| Cookie isolation | Same host as the main site, weaker | Separate domain, fully isolated |

### Port mode

Suited to LANs: members access the server's preview ports directly.

```ini
GONGGONG_PREVIEW_PORTS=41000-41099   # optional, adjust the port range
GONGGONG_PREVIEW_HOST=0.0.0.0        # open preview ports to the LAN (defaults to HOST, i.e. local only)
```

- Your firewall must allow the whole port range. When the ports run out, new previews fail with 「预览端口 … 已用完」 ("preview ports … used up").
- When the server has TLS configured, preview ports serve HTTPS with the same certificate.
- Preview pages share the main site's host name, so the browser also sends the main site's session cookie to preview ports (cookies don't distinguish ports). The server strips cookies before forwarding to the member's machine and rejects cross-origin write requests and WebSockets, but pages written by Bots are still close to same-origin with the main site. **Use wildcard-domain mode when exposing previews publicly.**

### Wildcard-domain mode

Previews live under a **separate registrable domain, different from the main site's**, for example:

| Purpose | Domain |
| --- | --- |
| Main site | `gg.example.com` |
| Previews | `*.example-preview.com` |

```ini
GONGGONG_PREVIEW_DOMAIN=example-preview.com
GONGGONG_PUBLIC_URL=https://gg.example.com
```

::: danger The preview domain must not be a subdomain of the main site
Don't use addresses like `preview.example.com` or `*.gg.example.com` that share a registrable domain with the main site. Preview pages are arbitrary code written by Bots; only under a separate registrable domain can the browser guarantee they can't read or write the main site's cookies.
:::

When the server receives a request it checks the Host header: requests shaped like `<标识>.example-preview.com` (an ID, single-level subdomains only) go to the matching preview, and everything else is treated as the main site (see `apps/server/src/modules/previews/gateway.ts`). So **new previews need no Nginx or DNS changes**; one wildcard DNS record plus one wildcard server block is enough. Signed-out visitors who open a preview are taken to the main site to sign in and then brought back; visitors with a public link don't need to sign in.

## GONGGONG_PUBLIC_URL is required

The server doesn't trust proxy headers (Fastify `trustProxy` is off), so behind Nginx the request scheme it sees is always `http`, and the port isn't the one the browser actually uses. `GONGGONG_PUBLIC_URL` tells the server the address browsers really use for the main site. It's used to:

- Build the scheme and port of preview URLs (otherwise you get wrong addresses like `http://…`);
- Send signed-out preview visitors back to the main site to sign in;
- Generate preview links that Bots can mention in replies.

```ini
GONGGONG_PUBLIC_URL=https://gg.example.com   # no trailing slash
```

## DNS

| Record | Type | Value |
| --- | --- | --- |
| `gg.example.com` | A / AAAA | Server IP |
| `*.example-preview.com` | A / AAAA | Server IP |

You don't need the second record if you only use port mode.

## Nginx configuration

The configuration below assumes the web build output is in `/srv/gonggong/apps/web/dist` and the server listens over HTTP on `127.0.0.1:8787` (Nginx terminates HTTPS; see [HTTPS and certificates · Option 1](/en/deploy/https#option-1-public-domain-trusted-certificate-recommended)).

### Paths to proxy

The server doesn't host the web app. Only the following paths need to be forwarded; everything else is the web app's static files:

| Path | Purpose |
| --- | --- |
| `/api/` | All HTTP endpoints, including the daemon's `/api/daemon/*` |
| `/ws/web` | Browser real-time pushes (WebSocket) |
| `/ws/terminals/…` | Machine terminal sessions (WebSocket) |
| `/ws/daemon` | Daemon main connection (WebSocket) |
| `/ws/daemon/tunnel` | Daemon preview tunnel (WebSocket) |
| `/livekit` | Live view signaling (WebSocket) |
| `/downloads/` | Daemon and gg-cast installers; daemon auto-upgrade downloads from here |

### Full example

`/etc/nginx/conf.d/gonggong.conf`:

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

# Main site: web app + API + daemon connections
server {
    listen 443 ssl;
    http2 on;
    server_name gg.example.com;

    ssl_certificate     /etc/nginx/ssl/gg.example.com/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/gg.example.com/key.pem;

    client_max_body_size 300m;   # attachments are capped at 50 MB, client installer uploads at 300 MB

    root /srv/gonggong/apps/web/dist;

    location / {
        try_files $uri /index.html;   # single-page app: unknown paths fall back to index.html
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

# Wildcard preview domain: forward everything to the server, which routes by Host
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

`http2 on;` requires Nginx 1.25.1 or later; on older versions use `listen 443 ssl http2;` instead.

### Why each setting is needed

| Setting | Reason |
| --- | --- |
| `proxy_set_header Host $host` | **The Host header must be passed through unchanged.** The server uses Host to decide which preview a request belongs to; it also compares the browser's Origin with Host and rejects mismatched write requests and WebSockets (「拒绝跨站请求」, "Cross-site request refused"). If Nginx doesn't listen on the standard port 443, use `$http_host` instead to keep the port number |
| `Upgrade` / `Connection` + `map` | Forwards the WebSocket handshake. Browser real-time pushes, daemon connections, preview tunnels, and live view all rely on WebSockets; pages inside a preview may use WebSockets too (such as a dev server's hot reload) |
| `proxy_http_version 1.1` | Required for WebSockets and keep-alive connections |
| `X-Forwarded-Proto` / `X-Forwarded-For` | Pass the original scheme and client address for local services inside previews |
| `proxy_buffering off` | Keeps streaming responses (run details, SSE inside previews, etc.) from being buffered by Nginx |
| `proxy_request_buffering off` | Streams attachment and installer uploads straight to the server instead of first writing them to an Nginx temp file |
| `proxy_read_timeout 1h` | Keeps WebSockets open for long periods; the daemon has its own heartbeat, so 1 hour is plenty |
| `client_max_body_size 300m` | Nginx allows only 1 MB request bodies by default, which would block attachment and installer uploads |

After changing the configuration, run `nginx -t && nginx -s reload`.

::: tip Port mode only
Delete the wildcard preview server block and `*.example-preview.com` from the port 80 block; the main site configuration stays the same. Open the preview ports directly to browsers as described above.
:::

## Wildcard certificates

The preview domain needs a wildcard certificate. Let's Encrypt and ZeroSSL both issue wildcard certificates for free, but **wildcards can only be validated with DNS-01**: the issuing tool has to call your DNS provider's API to add a TXT record.

Using [acme.sh](https://github.com/acmesh-official/acme.sh) and Alibaba Cloud DNS as an example:

```bash
# 1. Install acme.sh
curl https://get.acme.sh | sh -s email=admin@example.com

# 2. Provide DNS API credentials (preferably a sub-account AccessKey with DNS-only permissions)
export Ali_Key="…"
export Ali_Secret="…"

# 3. Issue: a wildcard doesn't cover the bare domain, so include both -d flags
acme.sh --issue --server letsencrypt --dns dns_ali \
  -d example-preview.com -d '*.example-preview.com'

# 4. Install into the Nginx directory and reload automatically after renewal
mkdir -p /etc/nginx/ssl/example-preview.com
acme.sh --install-cert -d example-preview.com \
  --key-file       /etc/nginx/ssl/example-preview.com/key.pem \
  --fullchain-file /etc/nginx/ssl/example-preview.com/fullchain.pem \
  --reloadcmd      "nginx -s reload"
```

- Other DNS providers: DNSPod (Tencent Cloud) uses `--dns dns_tencent` (credentials `Tencent_SecretId` / `Tencent_SecretKey`); Cloudflare uses `--dns dns_cf` (credentials `CF_Token` plus `CF_Account_ID` or `CF_Zone_ID`).
- acme.sh's default CA is ZeroSSL; add `--server letsencrypt` if you want Let's Encrypt (already included above).
- Credentials are saved in the acme.sh configuration, and installation adds a scheduled job that renews before expiry and runs `--reloadcmd`.
- Issue the main site certificate the same way (`-d gg.example.com`; you can also use `--nginx` for HTTP-01).

::: tip Certificate renewal doesn't affect the daemon
The daemon only connects to the main site. When the main site uses a public CA certificate, the daemon verifies it against the system CAs and doesn't need to rebind after renewal; the preview domain's certificate has nothing to do with the daemon. See [HTTPS and certificates · Renewal and replacement](/en/deploy/https#renewal-and-replacement).
:::

You can also use Caddy instead of Nginx: it obtains and renews certificates automatically, though wildcard certificates need a Caddy build with the plugin for your DNS provider.

## Caveats

### Single instance

The server keeps browser real-time pushes, daemon connections, and preview tunnels in process memory, and each tunnel WebSocket is attached to a single server instance. Run only **one** server instance; don't put several instances behind Nginx for load balancing, or preview requests may land on an instance that doesn't hold the tunnel and fail.

### Client IP

The server doesn't trust proxy headers, so behind Nginx every request appears to come from `127.0.0.1`. Per-IP rate limits are therefore shared by all members:

- After 10 wrong connect codes (within 10 minutes), everyone has to wait 10 minutes before binding again; web confirmation requests that `gg` sends after a connect code expires also count toward this limit;
- When self-registration is open, at most 5 accounts can be registered per hour.

Login-failure rate limiting counts per account and isn't affected.

## Related pages

- [HTTPS and certificates](/en/deploy/https)
- [Environment variables](/en/deploy/env)
- [Previews](/en/user/previews)
- [Public sharing](/en/user/shares)
- [Security model](/en/deploy/security)
