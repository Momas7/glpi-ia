#!/usr/bin/env bash
# Cria o .env.prod da produção local com segredos novos (nunca os imprime) e permissão 600.
# Se o arquivo já existe, não toca nele.
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE="${ENV_FILE:-.env.prod}"
EXAMPLE=".env.prod.example"

if [ -e "$ENV_FILE" ]; then
  echo "$ENV_FILE já existe: nada foi alterado."
  exit 0
fi
command -v openssl >/dev/null || { echo "openssl não encontrado: instale-o para gerar os segredos." >&2; exit 1; }

umask 077
tmp="$(mktemp "${ENV_FILE}.XXXXXX")"
trap 'rm -f "$tmp"' EXIT

while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    SESSION_SECRET=)      printf 'SESSION_SECRET=%s\n' "$(openssl rand -hex 32)" ;;
    POSTGRES_PASSWORD=)   printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 16)" ;;
    N8N_WEBHOOK_SECRET=)  printf 'N8N_WEBHOOK_SECRET=%s\n' "$(openssl rand -hex 32)" ;;
    *)                    printf '%s\n' "$line" ;;
  esac
done < "$EXAMPLE" > "$tmp"

chmod 600 "$tmp"
mv "$tmp" "$ENV_FILE"
trap - EXIT

cat <<MSG
$ENV_FILE criado (permissão 600) com segredos novos.

Próximos passos:
  1. Revise as portas e a pasta de backup no $ENV_FILE.
  2. Suba tudo:
       podman-compose -f docker-compose.prod.yml --env-file $ENV_FILE up -d --build
  3. Crie o primeiro administrador (veja docs/operacao.md).
  4. Abra https://localhost:8443 (aceite o certificado local na primeira vez).
MSG
