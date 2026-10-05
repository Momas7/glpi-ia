#!/usr/bin/env bash
# Prova que o último backup restaura: sobe um Postgres descartável, restaura e compara contagens com o banco vivo.
# Grava o resultado em estado-backup.json. Backup que nunca foi restaurado não conta como backup.
set -euo pipefail
# shellcheck source=lib/ops-common.sh
source "$(dirname "$0")/lib/ops-common.sh"

acquire_lock
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

counts="${dump%.dump}.counts"
[ -f "$counts" ] || restore_test_fail "contagens da hora do backup ausentes ($(basename "$counts"))"
while read -r table before after; do
  restored="$(psql_in "$scratch" postgres restore_test "SELECT count(*) FROM \"$table\"" 2>/dev/null)" || restore_test_fail "tabela $table ausente no backup restaurado"
  lo=$(( before < after ? before : after )); hi=$(( before > after ? before : after ))
  if [ "$restored" -lt "$lo" ] || [ "$restored" -gt "$hi" ]; then
    restore_test_fail "$table: o backup restaurado tem $restored linhas, esperado entre $lo e $hi (contagem da hora do dump)"
  fi
  log "$table: restaurado=$restored (dump: $lo a $hi)"
done < "$counts"

[ -f "$attachments" ] || restore_test_fail "arquivo de anexos do backup não encontrado"
listing="$(mktemp)"
tar tzf "$attachments" 2>/dev/null | sed 's|^\./||' > "$listing" || { rm -f "$listing"; restore_test_fail "o arquivo de anexos está corrompido"; }
missing=0
while IFS= read -r stored; do
  [ -n "$stored" ] || continue
  grep -qxF -- "$stored" "$listing" || missing=$((missing + 1))
done < <(psql_in "$scratch" postgres restore_test 'SELECT "storedName" FROM "Attachment"')
rm -f "$listing"
[ "$missing" -eq 0 ] || restore_test_fail "$missing anexo(s) registrados no banco não estão no arquivo de anexos"

write_state "lastRestoreTestAt=$(json_str "$(now_iso)")" "lastRestoreTestOk=true"
log "teste de restauração OK ($(basename "$dump"))"
