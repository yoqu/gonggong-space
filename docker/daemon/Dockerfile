# A headless member machine: gg (daemon) with Claude Code, Codex, Node 24, git and what Bots commonly need (Chromium
# for snapshots and html_render, Xvfb for GUI previews, python3 + uv for MCP servers). Everything the daemon writes
# lives under /home/gg (one volume). See website/deploy/docker.md.
FROM ghcr.io/astral-sh/uv:0.13.6 AS uv

FROM node:24-bookworm-slim
ARG NPM_REGISTRY=https://registry.npmmirror.com
RUN apt-get update && apt-get install -y -o Acquire::Retries=5 --no-install-recommends \
      tini ca-certificates curl tzdata git openssh-client gh ripgrep jq less procps build-essential python3 python3-venv \
      chromium fonts-noto-cjk \
      xvfb libx11-6 libxext6 libxfixes3 libxdamage1 libxrandr2 libxcomposite1 libgbm1 libdrm2 \
    && rm -rf /var/lib/apt/lists/* \
    && git config --system --add safe.directory '*' \
    # git runs with BatchMode: trust a host on first use instead of failing every clone of a new host.
    && printf 'Host *\n  StrictHostKeyChecking accept-new\n' > /etc/ssh/ssh_config.d/gonggong.conf \
    # The daemon adds --no-sandbox only as root; Docker's default seccomp profile denies Chromium's sandbox.
    && printf '#!/bin/sh\nexec /usr/bin/chromium --no-sandbox "$@"\n' > /usr/local/bin/chromium-gg \
    && chmod +x /usr/local/bin/chromium-gg
COPY --from=uv /uv /uvx /usr/local/bin/

ARG CLAUDE_CODE_VERSION=latest
ARG CODEX_VERSION=latest
RUN npm install -g --registry="$NPM_REGISTRY" --no-audit --no-fund \
      "@anthropic-ai/claude-code@$CLAUDE_CODE_VERSION" "@openai/codex@$CODEX_VERSION" \
    && npm cache clean --force

# gg of one release, checked against its SHA256SUMS. GG_DOWNLOAD_URL may be a 共工 server's /downloads. No gg-cast:
# gg fetches the server's on first use, so it stays matched after gg upgrades itself.
ARG GG_VERSION
ARG GG_DOWNLOAD_URL=https://github.com/yoqu/gonggong-space/releases/download/v${GG_VERSION}
ARG GG_SUMS_URL=https://github.com/yoqu/gonggong-space/releases/download/v${GG_VERSION}/SHA256SUMS
ARG TARGETARCH
RUN test -n "$GG_VERSION" || { echo "GG_VERSION is required" >&2; exit 1; } \
    && arch="$(case "$TARGETARCH" in arm64) echo aarch64 ;; *) echo x86_64 ;; esac)" \
    && mkdir -p /opt/gonggong && cd /opt/gonggong \
    && curl -fsSL --retry 3 -o SHA256SUMS "$GG_SUMS_URL" \
    && f="gonggong-$GG_VERSION-linux-$arch" \
    && curl -fsSL --retry 3 -o "$f" "$GG_DOWNLOAD_URL/$f" && grep " $f\$" SHA256SUMS | sha256sum -c - \
    && mv "$f" gg && rm SHA256SUMS && chmod 755 gg && ln -s /opt/gonggong/gg /usr/local/bin/gg

# The node image's uid 1000 user, renamed: Claude Code will not skip permission prompts as root.
RUN usermod -l gg -d /home/gg -m node && groupmod -n gg node
COPY entrypoint.sh /usr/local/bin/gg-entrypoint
USER gg
WORKDIR /home/gg
# gg runs from the volume (entrypoint) and upgrades itself there; the agent CLIs come with the image.
ENV LANG=C.UTF-8 \
    TZ=Asia/Shanghai \
    SHELL=/bin/bash \
    PATH=/home/gg/.local/bin:$PATH \
    GONGGONG_CONTAINER=1 \
    GONGGONG_BROWSER=/usr/local/bin/chromium-gg \
    DISABLE_AUTOUPDATER=1
ENTRYPOINT ["tini", "--", "gg-entrypoint"]
CMD ["gg", "run"]
