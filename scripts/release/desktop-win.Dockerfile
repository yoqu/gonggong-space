# Cross-compiles the Windows desktop installer on Linux (https://v2.tauri.app/distribute/windows-installer/): the MSVC
# target through cargo-xwin (clang-cl + lld-link + the downloaded MSVC CRT/SDK), NSIS for the installer, llvm-rc for
# the app's resources. Trixie for NSIS 3.11: bookworm's 3.08 lacks headers the installer script includes. The Tauri
# CLI asks pkg-config for appindicator on any Linux host, even for this target.
FROM node:24.15.0-bookworm-slim AS node
FROM rust:1.98.0-trixie
RUN apt-get update && apt-get install -y -o Acquire::Retries=5 --no-install-recommends clang lld llvm nsis \
      pkg-config libayatana-appindicator3-dev \
    && rm -rf /var/lib/apt/lists/* \
    && rustup target add x86_64-pc-windows-msvc \
    && cargo install --locked cargo-xwin@0.23.1 \
    && git config --system --add safe.directory '*'
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && npm install -g pnpm@11.3.0
# The bundler's NSIS plugin, fetched here with retries: GitHub downloads from the build machines often break off.
ARG NSIS_TAURI_UTILS=https://github.com/tauri-apps/nsis-tauri-utils/releases/download/nsis_tauri_utils-v0.5.3/nsis_tauri_utils.dll
RUN dir=/root/.cache/tauri/NSIS/Plugins/x86-unicode/additional && mkdir -p "$dir" \
    && curl -fsSL --retry 10 --retry-all-errors -o "$dir/nsis_tauri_utils.dll" "$NSIS_TAURI_UTILS" \
    && echo "75197fee3c6a814fe035788d1c34ead39349b860  $dir/nsis_tauri_utils.dll" | sha1sum -c -
WORKDIR /src
ENV CARGO_TARGET_DIR=/target CARGO_NET_RETRY=10 XWIN_ACCEPT_LICENSE=1 XWIN_CACHE_DIR=/target/xwin \
    CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16 CI=true
