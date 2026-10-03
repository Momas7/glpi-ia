#!/usr/bin/env bash
# Backup do banco (pg_dump comprimido, com os vetores) e dos anexos, com retenção e estado para a página de saúde.
# Variáveis: RUNTIME, PG_CONTAINER, PG_USER, PG_DB, UPLOADS_DIR ou UPLOADS_VOLUME, BACKUP_DIR (veja docs/operacao.md).
set -euo pipefail
# shellcheck source=lib/ops-common.sh
source "$(dirname "$0")/lib/ops-common.sh"

stamp="$(date +%Y%m%d-%H%M%S)"
dump="$BACKUP_DIR/chamados-$stamp.dump"
attachments="$BACKUP_DIR/chamados-$stamp-anexos.tar.gz"
mkdir -p "$BACKUP_DIR"

fail() {
  log "backup falhou: $1"
  rm -f "$dump.partial" "$attachments.partial"
  write_state "lastBackupOk=false" "detail=$(json_str "$1")"
  exit 1
}

# Retenção: 14 mais recentes + o mais novo de cada semana (até 8 semanas) entre os demais.
apply_retention() {
  local files keep=() week seen=() i=0 f base d
  mapfile -t files < <(ls -1 "$BACKUP_DIR"/chamados-*.dump 2>/dev/null | sort -r)
  declare -A weeks=()
  for f in "${files[@]}"; do
    i=$((i + 1))
    base="$(basename "$f" .dump)"
    if [ "$i" -le 14 ]; then keep+=("$f"); continue; fi
    d="${base#chamados-}"; d="${d%%-*}"
    week="$(date -d "${d:0:4}-${d:4:2}-${d:6:2}" +%G-%V 2>/dev/null || echo "$d")"
    if [ -z "${weeks[$week]:-}" ] && [ "${#weeks[@]}" -lt 8 ]; then weeks[$week]=1; keep+=("$f"); fi
  done
  for f in "${files[@]}"; do
    if ! printf '%s\n' "${keep[@]}" | grep -qxF "$f"; then
      rm -f "$f" "${f%.dump}-anexos.tar.gz"
      log "removido pela retenção: $(basename "$f")"
    fi
  done
  # anexos sem dump correspondente também saem
  for f in "$BACKUP_DIR"/chamados-*-anexos.tar.gz; do
    [ -e "$f" ] || continue
    [ -e "${f%-anexos.tar.gz}.dump" ] || rm -f "$f"
  done
}

log "dump do banco $PG_DB ($PG_CONTAINER)"
"$RUNTIME" exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -d "$PG_DB" -Fc > "$dump.partial" 2>"$BACKUP_DIR/.pg_dump.err" || fail "pg_dump falhou: $(head -c 200 "$BACKUP_DIR/.pg_dump.err" 2>/dev/null | tr '\n' ' ')"
rm -f "$BACKUP_DIR/.pg_dump.err"
[ -s "$dump.partial" ] || fail "o dump saiu vazio"
"$RUNTIME" exec -i "$PG_CONTAINER" pg_restore --list < "$dump.partial" >/dev/null 2>&1 || fail "o dump não pôde ser lido de volta (pg_restore --list)"
mv -f "$dump.partial" "$dump"

log "anexos"
if [ -n "$UPLOADS_DIR" ] && [ -d "$UPLOADS_DIR" ]; then
  tar czf "$attachments.partial" -C "$UPLOADS_DIR" . || fail "falha ao compactar os anexos"
elif "$RUNTIME" volume inspect "$UPLOADS_VOLUME" >/dev/null 2>&1; then
  "$RUNTIME" run --rm --entrypoint tar -v "$UPLOADS_VOLUME":/data:ro "$PG_IMAGE" czf - -C /data . > "$attachments.partial" || fail "falha ao compactar o volume de anexos"
else
  tar czf "$attachments.partial" -T /dev/null || fail "falha ao criar o arquivo de anexos vazio"
fi
mv -f "$attachments.partial" "$attachments"

bytes=$(( $(stat -c %s "$dump") + $(stat -c %s "$attachments") ))
apply_retention
write_state "lastBackupAt=$(json_str "$(now_iso)")" "lastBackupBytes=$bytes" "lastBackupOk=true"
log "backup concluído: $(basename "$dump") ($bytes bytes)"
