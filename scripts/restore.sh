#!/usr/bin/env bash
# Restaura um backup no banco VIVO. Sem argumentos, lista os backups. Pede confirmação (ou use --yes).
# Pare o web e o worker antes (veja docs/operacao.md).
set -euo pipefail
# shellcheck source=lib/ops-common.sh
source "$(dirname "$0")/lib/ops-common.sh"

assume_yes=0
args=()
for a in "$@"; do
  if [ "$a" = "--yes" ]; then assume_yes=1; else args+=("$a"); fi
done

if [ "${#args[@]}" -eq 0 ]; then
  echo "Backups disponíveis em $BACKUP_DIR:"
  ls -1 "$BACKUP_DIR"/chamados-*.dump 2>/dev/null | sort -r | xargs -n1 basename 2>/dev/null || echo "(nenhum)"
  echo
  echo "Uso: scripts/restore.sh [--yes] <arquivo.dump> [anexos.tar.gz]"
  exit 0
fi

dump="${args[0]}"
attachments="${args[1]:-}"
[ -f "$dump" ] || { echo "arquivo não encontrado: $dump" >&2; exit 1; }

if [ "$assume_yes" -ne 1 ]; then
  echo "ATENÇÃO: isto SOBRESCREVE o banco $PG_DB ($PG_CONTAINER) com $(basename "$dump")." >&2
  printf 'Digite "restaurar" para continuar: ' >&2
  read -r answer || answer=""
  [ "$answer" = "restaurar" ] || { echo "cancelado: nada foi alterado." >&2; exit 1; }
fi

log "restaurando $(basename "$dump")"
"$RUNTIME" exec -i "$PG_CONTAINER" pg_restore -U "$PG_USER" -d "$PG_DB" --clean --if-exists --no-owner --no-privileges --exit-on-error < "$dump"

if [ -n "$attachments" ]; then
  [ -f "$attachments" ] || { echo "anexos não encontrados: $attachments" >&2; exit 1; }
  if [ -n "$UPLOADS_DIR" ]; then
    mkdir -p "$UPLOADS_DIR"
    tar xzf "$attachments" -C "$UPLOADS_DIR"
  else
    "$RUNTIME" run --rm -i --entrypoint tar -v "$UPLOADS_VOLUME":/data "$PG_IMAGE" xzf - -C /data < "$attachments"
  fi
  log "anexos restaurados"
fi
log "restauração concluída"
