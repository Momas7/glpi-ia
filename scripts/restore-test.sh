#!/usr/bin/env bash
# Prova que o último backup restaura: sobe um Postgres descartável, restaura e compara contagens com o banco vivo.
# Grava o resultado em estado-backup.json. Backup que nunca foi restaurado não conta como backup.
set -euo pipefail
# shellcheck source=lib/ops-common.sh
source "$(dirname "$0")/lib/ops-common.sh"

dump="$(latest_dump)"
[ -n "$dump" ] || { echo "nenhum backup encontrado em $BACKUP_DIR: rode scripts/backup.sh primeiro." >&2; exit 1; }
attachments="${dump%.dump}-anexos.tar.gz"

scratch="chamados-restore-test-$$-$RANDOM"
cleanup() { "$RUNTIME" rm -f "$scratch" >/dev/null 2>&1 || true; }
trap cleanup EXIT

restore_test_fail() {
  log "teste de restauração FALHOU: $1"
  write_state "lastRestoreTestAt=$(json_str "$(now_iso)")" "lastRestoreTestOk=false" "detail=$(json_str "$1")"
  exit 1
}

log "subindo Postgres descartável ($scratch)"
"$RUNTIME" run -d --name "$scratch" -e POSTGRES_PASSWORD=teste-descartavel -e POSTGRES_DB=restore_test "$PG_IMAGE" >/dev/null
ready=0
for _ in $(seq 1 90); do
  if "$RUNTIME" exec "$scratch" pg_isready -U postgres -d restore_test >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[ "$ready" -eq 1 ] || restore_test_fail "o Postgres descartável não ficou pronto"
sleep 2 # o entrypoint reinicia o servidor uma vez depois de criar o banco

log "restaurando $(basename "$dump")"
"$RUNTIME" exec -i "$scratch" pg_restore -U postgres -d restore_test --no-owner --no-privileges --exit-on-error < "$dump" >/dev/null 2>&1 \
  || restore_test_fail "o pg_restore falhou (backup corrompido ou incompleto)"

for table in User Ticket Comment KbArticle KbChunk TicketEmbedding _prisma_migrations; do
  restored="$(psql_in "$scratch" postgres restore_test "SELECT count(*) FROM \"$table\"" 2>/dev/null)" || restore_test_fail "tabela $table ausente no backup restaurado"
  live="$(psql_in "$PG_CONTAINER" "$PG_USER" "$PG_DB" "SELECT count(*) FROM \"$table\"" 2>/dev/null)" || restore_test_fail "não foi possível contar $table no banco vivo"
  if [ "$table" = "_prisma_migrations" ]; then
    [ "$restored" -eq "$live" ] || restore_test_fail "migrações diferentes (backup $restored, banco $live)"
  elif [ "$restored" -gt "$live" ]; then
    restore_test_fail "$table tem mais linhas no backup ($restored) do que no banco vivo ($live)"
  fi
  log "$table: backup=$restored vivo=$live"
done

if [ -f "$attachments" ]; then
  tar tzf "$attachments" >/dev/null 2>&1 || restore_test_fail "o arquivo de anexos está corrompido"
else
  restore_test_fail "arquivo de anexos do backup não encontrado"
fi

write_state "lastRestoreTestAt=$(json_str "$(now_iso)")" "lastRestoreTestOk=true"
log "teste de restauração OK ($(basename "$dump"))"
