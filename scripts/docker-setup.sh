#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
cd "$REPO_ROOT"

. "$SCRIPT_DIR/compose-runtime.sh"

ENV_FILE=${OPSPILOT_ENV_FILE:-.env}
PORT=${OPSPILOT_PORT:-3000}
WAIT_TIMEOUT=${OPSPILOT_WAIT_TIMEOUT:-900}
HOST_ADDRESS=${OPSPILOT_HOST:-}
PUBLIC_URL=${OPSPILOT_PUBLIC_URL:-}
ENV_WAS_CREATED=0
GENERATED_PASSWORD=

case "$PORT" in
  ''|*[!0-9]*) echo "OPSPILOT_PORT must be a number." >&2; exit 1 ;;
esac
if [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  echo "OPSPILOT_PORT must be between 1 and 65535." >&2
  exit 1
fi

opspilot_require_compose "$REPO_ROOT"

generate_secret() {
  od -An -N "$1" -tx1 /dev/urandom | tr -d ' \n'
}

detect_host() {
  if command -v ip >/dev/null 2>&1; then
    ip route get 1.1.1.1 2>/dev/null | awk '{ for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit } }'
    return
  fi
  if command -v hostname >/dev/null 2>&1; then
    hostname -I 2>/dev/null | awk '{ print $1 }'
  fi
}

get_env() {
  key=$1
  value=$(grep -E "^[[:space:]]*${key}[[:space:]]*=" "$ENV_FILE" 2>/dev/null | tail -n 1 || true)
  value=${value#*=}
  value=$(printf '%s' "$value" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
  printf '%s' "$value"
}

set_env() {
  key=$1
  value=$2
  temp_file="${ENV_FILE}.tmp.$$"
  awk -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    $0 ~ "^[[:space:]]*" key "[[:space:]]*=" {
      print key "=\"" value "\""
      found = 1
      next
    }
    { print }
    END {
      if (!found) print key "=\"" value "\""
    }
  ' "$ENV_FILE" > "$temp_file"
  mv "$temp_file" "$ENV_FILE"
}

if [ ! -f "$ENV_FILE" ]; then
  cp .env.example "$ENV_FILE"
  ENV_WAS_CREATED=1
fi
chmod 600 "$ENV_FILE"
mkdir -p backups

SESSION_SECRET=$(get_env SESSION_SECRET)
if [ -z "$SESSION_SECRET" ] || [ "$SESSION_SECRET" = "replace-with-at-least-32-random-characters" ]; then
  set_env SESSION_SECRET "$(generate_secret 32)"
fi

ADMIN_PASSWORD=$(get_env BOOTSTRAP_ADMIN_PASSWORD)
ALLOW_KNOWN_ADMIN_PASSWORD=$(get_env ALLOW_KNOWN_ADMIN_PASSWORD)
LEGACY_PASSWORD_ALLOWED=0
if [ "$ALLOW_KNOWN_ADMIN_PASSWORD" = "1" ] && [ "$ADMIN_PASSWORD" = "Ethic0n1" ]; then
  LEGACY_PASSWORD_ALLOWED=1
fi
if [ "$LEGACY_PASSWORD_ALLOWED" -eq 0 ]; then
  if [ -z "$ADMIN_PASSWORD" ] || [ "${#ADMIN_PASSWORD}" -lt 12 ] || [ "$ADMIN_PASSWORD" = "Ethic0n1" ] || [ "$ADMIN_PASSWORD" = "change-this-before-starting" ]; then
    GENERATED_PASSWORD=$(generate_secret 16)
    set_env BOOTSTRAP_ADMIN_PASSWORD "$GENERATED_PASSWORD"
  fi
fi

if [ "$ENV_WAS_CREATED" -eq 1 ] || [ -n "${OPSPILOT_HOST+x}" ] || [ -n "${OPSPILOT_PORT+x}" ] || [ -n "$PUBLIC_URL" ]; then
  if [ -z "$HOST_ADDRESS" ]; then
    HOST_ADDRESS=$(detect_host)
  fi
  if [ -z "$HOST_ADDRESS" ]; then
    HOST_ADDRESS=127.0.0.1
  fi
  if ! printf '%s' "$HOST_ADDRESS" | grep -Eq '^[A-Za-z0-9.-]+$'; then
    echo "OPSPILOT_HOST must be an IPv4 address or DNS host name." >&2
    exit 1
  fi

  set_env OPSPILOT_PORT "$PORT"
  CONTROL_PLANE_URL="http://${HOST_ADDRESS}:${PORT}"
  if [ -n "$PUBLIC_URL" ]; then
    case "$PUBLIC_URL" in
      https://*) CONTROL_PLANE_URL=${PUBLIC_URL%/} ;;
      *) echo "OPSPILOT_PUBLIC_URL must be an absolute HTTPS URL." >&2; exit 1 ;;
    esac
  fi
  set_env APP_URL "$CONTROL_PLANE_URL"
  set_env AGENT_SERVER_URL "$CONTROL_PLANE_URL"
  case "$CONTROL_PLANE_URL" in
    https://*) set_env SESSION_COOKIE_SECURE "true"; set_env ALLOW_INSECURE_HTTP "0" ;;
    http://127.0.0.1:*|http://localhost:*|http://\[::1\]:*) set_env SESSION_COOKIE_SECURE "false"; set_env ALLOW_INSECURE_HTTP "0" ;;
    *) set_env SESSION_COOKIE_SECURE "false"; set_env ALLOW_INSECURE_HTTP "1" ;;
  esac
  set_env RUSTDESK_ID_SERVER "${HOST_ADDRESS}:21116"
  set_env RUSTDESK_RELAY_SERVER "${HOST_ADDRESS}:21117"
fi

chmod 600 "$ENV_FILE"

opspilot_compose --env-file "$ENV_FILE" config --quiet

if [ "${OPSPILOT_CONFIG_ONLY:-0}" = "1" ]; then
  echo "Docker configuration is valid: $ENV_FILE"
  exit 0
fi

opspilot_compose --env-file "$ENV_FILE" up --build --detach --remove-orphans --wait --wait-timeout "$WAIT_TIMEOUT"
opspilot_compose --env-file "$ENV_FILE" exec -T --user node opspilot node scripts/create-backup.mjs
opspilot_compose --env-file "$ENV_FILE" ps

APP_URL=$(get_env APP_URL)
ADMIN_USERNAME=$(get_env BOOTSTRAP_ADMIN_USERNAME)
printf '\nOpsPilot is ready: %s\n' "$APP_URL"
printf 'Administrator: %s\n' "$ADMIN_USERNAME"
if [ -n "$GENERATED_PASSWORD" ]; then
  printf 'Generated password: %s\n' "$GENERATED_PASSWORD"
  printf 'The password is stored only in %s.\n' "$ENV_FILE"
else
  printf 'Existing administrator credentials were retained from %s.\n' "$ENV_FILE"
fi
