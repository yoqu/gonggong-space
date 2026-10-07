# A plain Linux member machine for scripts/linux-e2e.sh: Node 24 + git + the mock ACP agent (tools/mock-agent),
# on a newer Debian than the bullseye build image. Build context: tools/mock-agent.
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y -o Acquire::Retries=5 --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/* && git config --system --add safe.directory '*'
WORKDIR /opt/mock-agent
COPY package.json agent.js ./
RUN npm install --no-audit --no-fund --omit=dev
