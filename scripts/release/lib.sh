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

# docker_build <args…>: `docker build`, retried: BuildKit asks Docker Hub for the base image's metadata on every build,
# and a flaky link to auth.docker.io fails it even when the image is local.
docker_build() {
  local n
  for n in 1 2 3 4 5; do
    docker build "$@" && return
    echo "docker build failed (attempt $n), retrying" >&2
    sleep $((n * 5))
  done
  return 1
}

# Tar of the working tree (tracked + untracked, minus ignored files) on stdout.
source_tar() { (cd "$ROOT" && git ls-files -z --cached --others --exclude-standard | COPYFILE_DISABLE=1 tar --no-xattrs --null -cf - -T -); }

# builder <out-dir> <bash-script>: runs the script in the build image with the working tree at /src; files it writes
# to /out are copied to <out-dir>. The cargo registry and target dir persist in named volumes between runs.
builder() {
  local out="$1" script="$2" id rc=0
  docker_build -q -t "$BUILDER" "$ROOT/scripts/release" >/dev/null
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

