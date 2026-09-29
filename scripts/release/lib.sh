# Helpers shared by the release scripts (sourced). Sources go into containers with `docker cp`, never bind mounts,
# so they also work where Docker cannot share the checkout's folder.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUILDER=gonggong-build:1.98-bullseye
# Docker Desktop's `credsStore: desktop` needs its credential helper, which a Homebrew docker CLI does not put on PATH.
DOCKER_DESKTOP_BIN=/Applications/Docker.app/Contents/Resources/bin
[ -d "$DOCKER_DESKTOP_BIN" ] && PATH="$PATH:$DOCKER_DESKTOP_BIN"

gonggong_version() { sed -n 's/^version = "\(.*\)"$/\1/p' "$ROOT/crates/gonggong/Cargo.toml" | head -1; }

# Linux arch of this Docker host, as Rust names it.
docker_arch() {
  case "$(docker version --format '{{.Server.Arch}}')" in
    arm64 | aarch64) echo aarch64 ;;
    *) echo x86_64 ;;
  esac
}

sha256_of() { shasum -a 256 "$1" | cut -d' ' -f1; }

# Tar of the working tree (tracked + untracked, minus ignored files) on stdout.
source_tar() { (cd "$ROOT" && git ls-files -z --cached --others --exclude-standard | COPYFILE_DISABLE=1 tar --no-xattrs --null -cf - -T -); }

# builder <out-dir> <bash-script>: runs the script in the build image with the working tree at /src; files it writes
# to /out are copied to <out-dir>. The cargo registry and target dir persist in named volumes between runs.
builder() {
  local out="$1" script="$2" id rc=0
  docker build -q -t "$BUILDER" "$ROOT/scripts/release" >/dev/null
  id=$(docker create -v gonggong-cargo-registry:/usr/local/cargo/registry -v gonggong-target:/target "$BUILDER" \
    bash -eo pipefail -c "mkdir -p /out; $script")
  source_tar | docker cp - "$id:/src" >/dev/null && docker start -a "$id" || rc=$?
  if [ "$rc" = 0 ]; then
    mkdir -p "$out"
    docker cp "$id:/out/." "$out" >/dev/null
  fi
  docker rm -f "$id" >/dev/null
  return "$rc"
}

# cast_image [<platform>]: builds the gg-cast image (release/cast.Dockerfile) for the Docker host's Linux arch, or for
# <platform> (another arch, emulated); prints its tag, ending in the arch (or "native").
cast_image() {
  local platform="${1:-}" arch
  arch="${platform#linux/}"
  arch="${arch:-native}"
  docker build -q ${platform:+--platform "$platform"} -t "gonggong-cast-build:1.98-bullseye-$arch" \
    -f "$ROOT/scripts/release/cast.Dockerfile" "$ROOT/scripts/release" >/dev/null || return
  echo "gonggong-cast-build:1.98-bullseye-$arch"
}

# in_container <image> <out-dir> <bash-script> [docker create options…]: runs the script in the image with the working
# tree at /src; whatever it wrote to /out is copied to <out-dir>, also when it failed (test reports).
in_container() {
  local image="$1" out="$2" script="$3" id rc=0
  shift 3
  id=$(docker create "$@" "$image" bash -eo pipefail -c "mkdir -p /out; $script")
  source_tar | docker cp - "$id:/src" >/dev/null && docker start -a "$id" || rc=$?
  mkdir -p "$out"
  docker cp "$id:/out/." "$out" >/dev/null 2>&1 || true
  docker rm -f "$id" >/dev/null
  return "$rc"
}

# cast_builder <out-dir> <platform or ""> <bash-script>: `builder` in the gg-cast image, for another Linux arch through
# emulation when a platform is given. Cargo registry and target dir are per arch.
cast_builder() {
  local out="$1" platform="$2" script="$3" image
  image="$(cast_image "$platform")"
  in_container "$image" "$out" "$script" ${platform:+--platform "$platform"} \
    -v "gonggong-cast-registry-${image##*-}:/usr/local/cargo/registry" -v "gonggong-cast-target-${image##*-}:/target"
}
