# Build/test image for the Linux and Windows daemon builds. Debian bullseye keeps the glibc baseline at 2.31
# (Ubuntu 20.04+, Debian 11+, RHEL 9+). Cross linkers are installed for whichever Linux arch is not native.
FROM node:22-bullseye AS node
FROM rust:1.98-bullseye
RUN arch="$(dpkg --print-architecture)"; pkgs="gcc-mingw-w64-x86-64"; \
    [ "$arch" = amd64 ] || pkgs="$pkgs gcc-x86-64-linux-gnu libc6-dev-amd64-cross"; \
    [ "$arch" = arm64 ] || pkgs="$pkgs gcc-aarch64-linux-gnu libc6-dev-arm64-cross"; \
    apt-get update && apt-get install -y -o Acquire::Retries=5 --no-install-recommends $pkgs && rm -rf /var/lib/apt/lists/* \
    && rustup target add x86_64-unknown-linux-gnu aarch64-unknown-linux-gnu x86_64-pc-windows-gnu \
    && git config --system --add safe.directory '*'
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm
WORKDIR /src
ENV CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER=x86_64-linux-gnu-gcc \
    CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc \
    CC_x86_64_unknown_linux_gnu=x86_64-linux-gnu-gcc \
    CC_aarch64_unknown_linux_gnu=aarch64-linux-gnu-gcc \
    CARGO_TARGET_DIR=/target CARGO_NET_RETRY=10 CARGO_PROFILE_DEV_DEBUG=line-tables-only
