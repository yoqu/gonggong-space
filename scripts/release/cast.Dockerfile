# Build image for gg-cast (crates/gg-cast) on Linux and Windows. libwebrtc's prebuilt archives are compiled with
# Chromium's clang and hermetic libc++ (webrtc-sys refuses GCC), and for Windows with the MSVC ABI, which mingw cannot
# link: Windows builds go through cargo-xwin (clang-cl + lld-link + the downloaded MSVC CRT/SDK). Debian bullseye keeps
# the glibc baseline of the daemon (2.31). Linux builds are native to the image's arch (`--platform` for the other).
FROM rust:1.98.0-bullseye
ARG LLVM=21
# Bullseye is past its security support: deb.debian.org's bullseye-security index lists packages its pool no longer
# serves (404), so that suite comes from the snapshot the base image was built from.
RUN sed -i 's|^deb http://deb.debian.org/debian-security|deb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/20260824T000000Z|' \
      /etc/apt/sources.list \
    && curl -fsSL https://apt.llvm.org/llvm-snapshot.gpg.key | gpg --dearmor -o /usr/share/keyrings/llvm.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/llvm.gpg] http://apt.llvm.org/bullseye/ llvm-toolchain-bullseye-$LLVM main" \
      > /etc/apt/sources.list.d/llvm.list \
    && apt-get update && apt-get install -y -o Acquire::Retries=5 --no-install-recommends \
      clang-$LLVM lld-$LLVM llvm-$LLVM pkg-config libglib2.0-dev \
    && rm -rf /var/lib/apt/lists/* \
    && for t in clang clang++ clang-cl lld lld-link llvm-lib llvm-ar llvm-rc llvm-dlltool; do \
      ln -sf "/usr/bin/$t-$LLVM" "/usr/local/bin/$t"; done \
    && rustup target add x86_64-pc-windows-msvc \
    && cargo install --locked cargo-xwin@0.23.1 \
    && git config --system --add safe.directory '*'
WORKDIR /src
# libwebrtc's Windows archives use the static CRT (/MT); everything else linked with them must too.
ENV CC=clang CXX=clang++ CARGO_TARGET_DIR=/target CARGO_NET_RETRY=10 XWIN_ACCEPT_LICENSE=1 XWIN_CACHE_DIR=/target/xwin \
    CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS="-C target-feature=+crt-static"
