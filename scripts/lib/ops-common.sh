#!/usr/bin/env bash
# Funções comuns de backup/restauração. Carregado (source) pelos scripts; não executar direto.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# Lê uma chave simples do .env.prod só se ela ainda não veio do ambiente (sem executar o arquivo).
load_env_key() {
  local key="$1" current="${!1:-}" line
  if [ -z "$current" ] && [ -f "$REPO_ROOT/.env.prod" ]; then
    line="$(grep -E "^${key}=" "$REPO_ROOT/.env.prod" | tail -1 || true)"
    if [ -n "$line" ]; then printf -v "$key" '%s' "${line#*=}"; fi
  fi
}

load_env_key BACKUP_DIR

if [ -z "${RUNTIME:-}" ]; then
  if command -v podman >/dev/null 2>&1; then RUNTIME=podman; else RUNTIME=docker; fi
fi
PG_CONTAINER="${PG_CONTAINER:-chamados_postgres_1}"
PG_USER="${PG_USER:-glpi}"
PG_DB="${PG_DB:-glpi_ia}"
PG_IMAGE="${PG_IMAGE:-docker.io/pgvector/pgvector:pg16}"
UPLOADS_DIR="${UPLOADS_DIR:-}"
UPLOADS_VOLUME="${UPLOADS_VOLUME:-chamados_uploads}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/chamados}"
# Pasta relativa vale a partir da raiz do projeto (a mesma regra do compose de produção).
case "$BACKUP_DIR" in /*) ;; *) BACKUP_DIR="$REPO_ROOT/${BACKUP_DIR#./}" ;; esac
STATE_FILE="$BACKUP_DIR/estado-backup.json"

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
now_iso() { date -u +%Y-%m-%dT%H:%M:%S.000Z; }

# Valor atual de um campo do estado (aceita o JSON compacto ou formatado); "null" se não existir.
state_field() {
  local key="$1" value=""
  if [ -f "$STATE_FILE" ]; then
    value="$(grep -o "\"$key\": *\(\"[^\"]*\"\|[^,}[:space:]]*\)" "$STATE_FILE" | head -1 | sed 's/^[^:]*: *//' || true)"
  fi
  printf '%s' "${value:-null}"
}

json_str() { printf '"%s"' "$(printf '%s' "$1" | tr -d '"\\\n\r' | cut -c1-300)"; }

# write_state <chave=valorJSON>...  Preserva os campos não informados e grava de forma atômica.
write_state() {
  local lastBackupAt lastBackupBytes lastBackupOk lastRestoreTestAt lastRestoreTestOk detail
  lastBackupAt="$(state_field lastBackupAt)"
  lastBackupBytes="$(state_field lastBackupBytes)"
  lastBackupOk="$(state_field lastBackupOk)"; [ "$lastBackupOk" = null ] && lastBackupOk=false
  lastRestoreTestAt="$(state_field lastRestoreTestAt)"
  lastRestoreTestOk="$(state_field lastRestoreTestOk)"
  detail="null"
  local pair
  for pair in "$@"; do
    case "${pair%%=*}" in
      lastBackupAt) lastBackupAt="${pair#*=}" ;;
      lastBackupBytes) lastBackupBytes="${pair#*=}" ;;
      lastBackupOk) lastBackupOk="${pair#*=}" ;;
      lastRestoreTestAt) lastRestoreTestAt="${pair#*=}" ;;
      lastRestoreTestOk) lastRestoreTestOk="${pair#*=}" ;;
      detail) detail="${pair#*=}" ;;
    esac
  done
  mkdir -p "$BACKUP_DIR"
  local tmp
  tmp="$(mktemp "$STATE_FILE.XXXXXX")"
  {
    printf '{\n'
    printf '  "lastBackupAt": %s,\n' "$lastBackupAt"
    printf '  "lastBackupBytes": %s,\n' "$lastBackupBytes"
    printf '  "lastBackupOk": %s,\n' "$lastBackupOk"
    printf '  "lastRestoreTestAt": %s,\n' "$lastRestoreTestAt"
    printf '  "lastRestoreTestOk": %s' "$lastRestoreTestOk"
    if [ "$detail" != null ]; then printf ',\n  "detail": %s\n}\n' "$detail"; else printf '\n}\n'; fi
  } > "$tmp"
  chmod 644 "$tmp"
  mv -f "$tmp" "$STATE_FILE"
}

latest_dump() { { ls -1 "$BACKUP_DIR"/chamados-*.dump 2>/dev/null || true; } | sort | tail -1; }

psql_in() { # psql_in <contêiner> <usuário> <banco> <sql>
  "$RUNTIME" exec "$1" psql -U "$2" -d "$3" -Atc "$4"
}
