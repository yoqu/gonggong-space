# HTTPS and certificates

This page explains why to use HTTPS with Gonggong Space, how to set up either of the two certificate options, and what to expect when you change certificates.

## Why use HTTPS

- **Encryption.** The daemon accepts both `https://` and `http://` server addresses, but `http://` sends everything—including the machine credential and the code your Bots read and write—in plain text. Use HTTPS whenever traffic crosses a network you don't fully trust.
- The session cookie needs the `Secure` flag under HTTPS.
- Features such as browser push notifications are only available in a secure context (HTTPS).

## How the daemon treats the certificate

The daemon (`gg` and the desktop app) **doesn't verify the server certificate**: it accepts any certificate, self-signed included, with no fingerprint pinning and no CA check. Binding works the same with any certificate, and renewing or replacing the certificate doesn't affect bound machines.

The flip side is that HTTPS here protects against eavesdropping but doesn't authenticate the server: on an untrusted network, a man in the middle could impersonate it. Run the server on a trusted network or have members connect over a VPN. See [Security model](/en/deploy/security).

## Option 1: public domain with a trusted certificate

For production deployments facing the internet: Nginx terminates HTTPS with a certificate issued by a public CA such as Let's Encrypt, and the server listens locally over HTTP only.

1. Get a certificate for the main site's domain (such as `gg.example.com`). A single-domain certificate can use HTTP-01 validation (`certbot --nginx` or `acme.sh --nginx`); a wildcard certificate for the preview domain can only use DNS-01. See [Reverse proxy and preview domains](/en/deploy/reverse-proxy#wildcard-certificate).
2. Configure the certificate in Nginx and reverse-proxy to `http://127.0.0.1:8787`. See [Reverse proxy and preview domains](/en/deploy/reverse-proxy).
3. On the server, **do not set** `GONGGONG_TLS_CERT` / `GONGGONG_TLS_KEY`, but you must set:
   ```ini
   GONGGONG_SECURE_COOKIES=1
   GONGGONG_PUBLIC_URL=https://gg.example.com
   ```

## Option 2: self-signed certificate on a LAN

For intranets or LANs without a public domain: use a self-signed certificate. The daemon accepts it as is.

### Generate a self-signed certificate

The repository includes a script that generates a self-signed certificate covering `localhost`, `127.0.0.1`, and every LAN IPv4 address of the machine (valid for 825 days):

```bash
bash scripts/dev-cert.sh              # outputs to .gonggong-dev/tls/ by default
bash scripts/dev-cert.sh /etc/gonggong/tls   # or specify a directory
```

The script prints one line:

```text
GONGGONG_TLS_CERT=/…/cert.pem GONGGONG_TLS_KEY=/…/key.pem
```

Set it as the server's environment variables. Once set, the server **serves only HTTPS/WSS** on the same port, and the session cookie gets `Secure` automatically.

If you issue the certificate from your own domain or an internal CA, just put the certificate and private key paths into the same two variables.

### Try it with the dev server

If you're only trying it out on a LAN without Nginx, the web dev server reads the same pair of variables, serves over HTTPS, and proxies to the server:

```bash
export GONGGONG_TLS_CERT=… GONGGONG_TLS_KEY=…
GONGGONG_ADMIN_PASSWORD=<initial-password> pnpm dev:server
WEB_HOST=0.0.0.0 pnpm dev:web          # members open https://<this machine's LAN IP>:5173
```

The browser will warn that the certificate isn't trusted; confirm to continue.

### Use it with Nginx

A proper intranet deployment still needs Nginx to host the web app. Nginx can use the same certificate files as the server:

```nginx
ssl_certificate     /etc/gonggong/tls/cert.pem;
ssl_certificate_key /etc/gonggong/tls/key.pem;

location ~ ^/(api|ws|livekit|downloads)(/|$) {
    proxy_pass https://127.0.0.1:8787;   # the server has TLS enabled, so the upstream uses https
    proxy_ssl_verify off;
    # other proxy_set_header lines etc. same as on the "Reverse proxy" page
}
```

## Renewal and replacement

| Certificate | Validity | Impact on daemons |
| --- | --- | --- |
| `dev-cert.sh` self-signed | 825 days | Replace manually before expiry; members don't need to rebind |
| Let's Encrypt | 90 days, usually auto-renewed every 60 days | None |
| Other public CAs | As issued | None |

Because the daemon doesn't pin the certificate, bound machines keep working after a renewal or replacement; members don't need to run `gg login` again. Browsers still check the certificate as usual, so a self-signed certificate keeps showing a warning in the browser.

## Related pages

- [Reverse proxy and preview domains](/en/deploy/reverse-proxy)
- [Security model](/en/deploy/security)
- [Bind a machine](/en/user/bind-machine)
- [Command reference](/en/cli/reference)
