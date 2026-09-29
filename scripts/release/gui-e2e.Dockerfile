# The Linux machine of scripts/gui-e2e.sh (plan 结果预览 B5): Node 22 with pnpm, PostgreSQL, Xvfb, Tk for the test
# app, the X libraries libwebrtc loads at run time and Playwright's Chromium, so server, web, daemon, gg-cast and the
# browser share one host. gg and gg-cast come prebuilt from the bullseye build image; Playwright has no Chromium for
# Debian 11 on arm64, hence bookworm here.
FROM node:22-bookworm
RUN apt-get update && apt-get install -y -o Acquire::Retries=5 --no-install-recommends \
      postgresql xvfb python3-tk libx11-6 libxext6 libxfixes3 libxdamage1 libxrandr2 libxcomposite1 libgbm1 libdrm2 \
    && rm -rf /var/lib/apt/lists/*
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# The pnpm of package.json, so runs do not depend on fetching it.
RUN corepack enable pnpm && corepack prepare pnpm@11.3.0 --activate && npx -y playwright@1.63.0 install --with-deps chromium && rm -rf /var/lib/apt/lists/* \
    && git config --system --add safe.directory '*'
WORKDIR /src
