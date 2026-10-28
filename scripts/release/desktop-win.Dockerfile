# Cross-compiles the Windows desktop installer on Linux (https://v2.tauri.app/distribute/windows-installer/): the MSVC
# target through cargo-xwin (clang-cl + lld-link + the downloaded MSVC CRT/SDK), NSIS for the installer, llvm-rc for
# the app's resources.
FROM node:24-bookworm AS node
FROM rust:1.98.0-bookworm
RUN apt-get update && apt-get install -y -o Acquire::Retries=5 --no-install-recommends clang lld llvm nsis \
    && rm -rf /var/lib/apt/lists/* \
    && rustup target add x86_64-pc-windows-msvc \
    && cargo install --locked cargo-xwin@0.23.1 \
    && git config --system --add safe.directory '*'
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && npm install -g pnpm@11.3.0
WORKDIR /src
ENV CARGO_TARGET_DIR=/target CARGO_NET_RETRY=10 XWIN_ACCEPT_LICENSE=1 XWIN_CACHE_DIR=/target/xwin \
    CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16 CI=true
