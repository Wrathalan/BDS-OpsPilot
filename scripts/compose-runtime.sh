#!/bin/sh

OPSPILOT_COMPOSE_RELEASE="v2.35.1"
OPSPILOT_COMPOSE_MODE=""
OPSPILOT_COMPOSE_BIN=""

opspilot_compose_fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

opspilot_compose_major() {
  "$@" version --short 2>/dev/null | sed -n 's/^v\{0,1\}\([0-9][0-9]*\).*/\1/p' | head -1
}

opspilot_file_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{ print $1 }'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$1" | sed 's/^.*= //'
  else
    opspilot_compose_fail "A SHA-256 utility (sha256sum, shasum, or openssl) is required to verify Docker Compose."
  fi
}

opspilot_download_file() {
  if command -v curl >/dev/null 2>&1; then
    curl -fL --retry 3 --connect-timeout 20 "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$2" "$1"
  else
    opspilot_compose_fail "curl or wget is required to download Docker Compose."
  fi
}

opspilot_compose_asset() {
  case "$(uname -m)" in
    x86_64|amd64)
      printf '%s %s\n' "x86_64" "7bdb2ce2916e5dd0354e5d129892bf96fdcdb1a9ab8eed69b9173e131db4c230"
      ;;
    aarch64|arm64)
      printf '%s %s\n' "aarch64" "a91e930a076b91e6c69f11d1dbe3c06729ae765fb9dbb3f97cb808e784647399"
      ;;
    *)
      opspilot_compose_fail "Automatic Docker Compose installation supports x86_64 and aarch64. Install Docker Compose v2 or newer for this host architecture."
      ;;
  esac
}

opspilot_bootstrap_compose() {
  repo_root=$1
  compose_asset=$(opspilot_compose_asset)
  set -- $compose_asset
  asset_arch=$1
  expected_sha256=$2
  compose_dir="$repo_root/.opspilot/bin"
  compose_bin="$compose_dir/docker-compose-${OPSPILOT_COMPOSE_RELEASE}-linux-${asset_arch}"

  mkdir -p "$compose_dir"
  chmod 0700 "$repo_root/.opspilot" "$compose_dir"

  if [ ! -x "$compose_bin" ]; then
    temp_file="${compose_bin}.tmp.$$"
    download_url="https://github.com/docker/compose/releases/download/${OPSPILOT_COMPOSE_RELEASE}/docker-compose-linux-${asset_arch}"
    printf 'Docker Compose v2 or newer was not found; downloading pinned %s for %s.\n' "$OPSPILOT_COMPOSE_RELEASE" "$asset_arch"
    trap 'rm -f "$temp_file"' EXIT INT TERM
    opspilot_download_file "$download_url" "$temp_file"
    actual_sha256=$(opspilot_file_sha256 "$temp_file")
    if [ "$actual_sha256" != "$expected_sha256" ]; then
      opspilot_compose_fail "Docker Compose checksum verification failed."
    fi
    chmod 0755 "$temp_file"
    mv "$temp_file" "$compose_bin"
    trap - EXIT INT TERM
  fi

  actual_sha256=$(opspilot_file_sha256 "$compose_bin")
  if [ "$actual_sha256" != "$expected_sha256" ]; then
    rm -f "$compose_bin"
    opspilot_compose_fail "The cached Docker Compose binary failed checksum verification and was removed. Run setup again to download a verified copy."
  fi
  "$compose_bin" version >/dev/null 2>&1 || opspilot_compose_fail "The locally installed Docker Compose binary could not start."
  OPSPILOT_COMPOSE_BIN=$compose_bin
}

opspilot_require_compose() {
  repo_root=$1

  command -v docker >/dev/null 2>&1 || opspilot_compose_fail "Docker is not installed or is not available on PATH."
  docker info --format '{{.ServerVersion}}' >/dev/null 2>&1 || opspilot_compose_fail "Docker is installed, but the Docker daemon is not available."

  if docker compose version >/dev/null 2>&1; then
    OPSPILOT_COMPOSE_MODE="plugin"
    return
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    standalone_major=$(opspilot_compose_major docker-compose)
    if [ -n "$standalone_major" ] && [ "$standalone_major" -ge 2 ]; then
      OPSPILOT_COMPOSE_MODE="standalone"
      return
    fi
  fi

  opspilot_bootstrap_compose "$repo_root"
  OPSPILOT_COMPOSE_MODE="local"
}

opspilot_compose() {
  case "$OPSPILOT_COMPOSE_MODE" in
    plugin) docker compose "$@" ;;
    standalone) docker-compose "$@" ;;
    local) "$OPSPILOT_COMPOSE_BIN" "$@" ;;
    *) opspilot_compose_fail "Docker Compose has not been initialized." ;;
  esac
}
