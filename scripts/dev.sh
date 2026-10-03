#!/usr/bin/env bash
# Sobe Postgres, aplica migrações e roda site + worker juntos. Ctrl+C encerra tudo.
set -e
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:$PATH"
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm use 24 >/dev/null
podman-compose up -d postgres
npm run db:migrate
trap 'kill 0' EXIT
npm run worker &
npm run dev
