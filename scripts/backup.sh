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
acquire_lock
counts="$BACKUP_DIR/chamados-$stamp.counts"

fail() {
  log "backup falhou: $1"
  rm -f "$dump.partial" "$attachments.partial" "$counts.partial"
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
      rm -f "$f" "${f%.dump}-anexos.tar.gz" "${f%.dump}.counts"
      log "removido pela retenção: $(basename "$f")"
    fi
  done
  # anexos sem dump correspondente também saem
  for f in "$BACKUP_DIR"/chamados-*-anexos.tar.gz "$BACKUP_DIR"/chamados-*.counts; do
    [ -e "$f" ] || continue
    base="${f%-anexos.tar.gz}"; base="${base%.counts}"
    [ -e "$base.dump" ] || rm -f "$f"
  done
}

# Contagens antes e depois do dump: o teste de restauração confere que o restaurado fica entre as duas.
count_all() {
  local t n
  for t in $COUNT_TABLES; do
    n="$(psql_in "$PG_CONTAINER" "$PG_USER" "$PG_DB" "SELECT count(*) FROM \"$t\"" 2>"$BACKUP_DIR/.count.err")" || return 1
    printf '%s ' "$n"
  done
}
before="$(count_all)" || fail "não foi possível contar as tabelas antes do dump ($(head -c 200 "$BACKUP_DIR/.count.err" 2>/dev/null | tr '\n' ' '))"

log "dump do banco $PG_DB ($PG_CONTAINER)"
"$RUNTIME" exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -d "$PG_DB" -Fc > "$dump.partial" 2>"$BACKUP_DIR/.pg_dump.err" || fail "pg_dump falhou: $(head -c 200 "$BACKUP_DIR/.pg_dump.err" 2>/dev/null | tr '\n' ' ')"
rm -f "$BACKUP_DIR/.pg_dump.err" "$BACKUP_DIR/.count.err"
[ -s "$dump.partial" ] || fail "o dump saiu vazio"
"$RUNTIME" exec -i "$PG_CONTAINER" pg_restore --list < "$dump.partial" >/dev/null 2>&1 || fail "o dump não pôde ser lido de volta (pg_restore --list)"
after="$(count_all)" || fail "não foi possível contar as tabelas depois do dump ($(head -c 200 "$BACKUP_DIR/.count.err" 2>/dev/null | tr '\n' ' '))"
{
  i=0
  read -ra b <<< "$before"; read -ra a <<< "$after"
  for t in $COUNT_TABLES; do printf '%s %s %s\n' "$t" "${b[$i]}" "${a[$i]}"; i=$((i + 1)); done
} > "$counts.partial"

log "anexos"
if [ -n "$UPLOADS_DIR" ] && [ -d "$UPLOADS_DIR" ]; then
  tar czf "$attachments.partial" -C "$UPLOADS_DIR" . || fail "falha ao compactar os anexos"
elif "$RUNTIME" volume inspect "$UPLOADS_VOLUME" >/dev/null 2>&1; then
  "$RUNTIME" run --rm --entrypoint tar -v "$UPLOADS_VOLUME":/data:ro "$PG_IMAGE" czf - -C /data . > "$attachments.partial" || fail "falha ao compactar o volume de anexos"
elif [ "${ALLOW_EMPTY_ATTACHMENTS:-0}" = 1 ]; then
  tar czf "$attachments.partial" -T /dev/null || fail "falha ao criar o arquivo de anexos vazio"
else
  fail "pasta de anexos (UPLOADS_DIR) e volume ($UPLOADS_VOLUME) não encontrados; confira o nome ou use ALLOW_EMPTY_ATTACHMENTS=1 se não há anexos"
fi
# O dump só ganha o nome final depois de tudo pronto: o .dump é o que marca um backup completo.
mv -f "$attachments.partial" "$attachments"
mv -f "$counts.partial" "$counts"
mv -f "$dump.partial" "$dump"

bytes=$(( $(stat -c %s "$dump") + $(stat -c %s "$attachments") ))
apply_retention
write_state "lastBackupAt=$(json_str "$(now_iso)")" "lastBackupBytes=$bytes" "lastBackupOk=true"
log "backup concluído: $(basename "$dump") ($bytes bytes)"
