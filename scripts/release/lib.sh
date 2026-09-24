# Helpers shared by the release scripts (sourced). Sources go into containers with `docker cp`, never bind mounts,
# so they also work where Docker cannot share the checkout's folder.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUILDER=aiws-build:1.98-bullseye
# Docker Desktop's `credsStore: desktop` needs its credential helper, which a Homebrew docker CLI does not put on PATH.
DOCKER_DESKTOP_BIN=/Applications/Docker.app/Contents/Resources/bin
[ -d "$DOCKER_DESKTOP_BIN" ] && PATH="$PATH:$DOCKER_DESKTOP_BIN"

aiws_version() { sed -n 's/^version = "\(.*\)"$/\1/p' "$ROOT/crates/aiws/Cargo.toml" | head -1; }

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
  id=$(docker create -v aiws-cargo-registry:/usr/local/cargo/registry -v aiws-target:/target "$BUILDER" \
    bash -eo pipefail -c "mkdir -p /out; $script")
  source_tar | docker cp - "$id:/src" >/dev/null && docker start -a "$id" || rc=$?
  if [ "$rc" = 0 ]; then
    mkdir -p "$out"
    docker cp "$id:/out/." "$out" >/dev/null
  fi
  docker rm -f "$id" >/dev/null
  return "$rc"
}
