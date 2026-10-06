# Operação: produção local

Este roteiro sobe o Sentinela "em produção" na sua própria máquina: HTTPS local, banco com backup e teste de restauração. Não há domínio nem servidor; tudo roda em contêineres no seu computador.

```
navegador ──https://localhost:8443──► Caddy ──► web (Next.js) ──► Postgres (pgvector)
                                                  worker (pg-boss) ──┘
backups: ~/…/backups  ◄── scripts/backup.sh (diário)  ·  scripts/restore-test.sh (semanal)
```

Só o Caddy escuta portas, e só em `127.0.0.1`. O web, o worker e o Postgres ficam numa rede interna.

## Pré-requisitos

- Podman com `podman-compose` (ou Docker com `docker compose`; neste caso use `COMPOSE="docker compose"` nos comandos abaixo).
- Node 24 só para os comandos `npm run …` (eles apenas chamam os scripts).
- `openssl` (gera os segredos).

## 1. Primeira subida

```bash
npm run prod:init     # cria .env.prod com segredos novos (permissão 600) e não imprime nenhum
npm run prod:up       # constrói as imagens e sobe tudo
```

Confira o estado: `podman ps` (todos "healthy" em cerca de um minuto) e

```bash
curl -sk https://localhost:8443/api/health/ready
```

Deve responder `{"status":"ok", …}`. Se o worker acabou de subir, espere até 1 minuto pelo primeiro batimento.

Em Fedora/RHEL (SELinux) as montagens do compose já levam `:z`, que ajusta o rótulo do `Caddyfile` e da pasta de backup para o contêiner poder lê-los.

### Criar o primeiro administrador

```bash
read -rs ADMIN_PASSWORD && export ADMIN_PASSWORD
npm run prod:admin -- --email voce@exemplo.com --name "Seu Nome"
```

O comando roda dentro do contêiner do worker já em execução (`chamados_worker_1`; com Docker Compose o nome usa hífen: `WORKER_CONTAINER=chamados-worker-1` e `RUNTIME=docker`). A senha vem só da variável (nunca de argumento) e precisa seguir a política (12 caracteres ou mais).

### Abrir no navegador

`https://localhost:8443`. O certificado é do próprio Caddy (interno, só vale para `localhost`): o navegador avisa na primeira vez, e basta aceitar a exceção.

## 2. Dia a dia

| Ação | Comando |
|---|---|
| Parar | `npm run prod:down` |
| Subir de novo | `npm run prod:up` |
| Ver logs | `podman logs -f chamados_web_1` (ou `_worker_1`, `_caddy_1`, `_postgres_1`) |
| Saúde | Administração → Saúde, ou `curl -sk https://localhost:8443/api/health/ready` |
| Backup agora | `npm run backup` |
| Testar a restauração agora | `npm run restore:test` |

Os logs são JSON (um objeto por linha) com `requestId`, método, rota, status e tempo; use o `X-Request-Id` da resposta para achar uma requisição. O nível sai de `LOG_LEVEL` no `.env.prod`.

### Ligar a IA

No `.env.prod`: `AI_ENABLED=true`, `LLM_PROVIDER=gemini`, `EMBEDDING_PROVIDER=gemini` e `GEMINI_API_KEY=…` (a chave só no arquivo, nunca no chat nem no git). Depois `npm run prod:up`. Em Administração → IA, use **Reindexar tudo** para indexar o histórico. Veja [ia.md](ia.md).

## 3. Atualizar e voltar versão

```bash
git pull
npm run prod:up        # reconstrói e reinicia; as migrações rodam sozinhas na subida do web
```

Antes de atualizar rode `npm run backup`. Para voltar: `git checkout <versão anterior>` e `npm run prod:up`. Migrações que mudam o banco **não** são desfeitas sozinhas: se a versão nova mexeu no esquema, volte também o banco com o backup (seção 5).

## 4. Backup

`npm run backup` (`scripts/backup.sh`) grava em `BACKUP_DIR` (padrão `./backups` na raiz do projeto, ou `~/backups/chamados` se a variável não existir):

- `chamados-AAAAMMDD-HHMMSS.dump`: o banco inteiro, com os vetores (formato comprimido do `pg_dump`);
- `chamados-AAAAMMDD-HHMMSS-anexos.tar.gz`: os anexos;
- `chamados-AAAAMMDD-HHMMSS.counts`: contagens das tabelas na hora do dump (o teste de restauração confere contra elas, não contra o banco vivo);
- `estado-backup.json`: o que a página de saúde lê (último backup e último teste de restauração).

O backup **falha** (em vez de gravar um arquivo de anexos vazio) se não achar a pasta (`UPLOADS_DIR`) nem o volume (`UPLOADS_VOLUME`, padrão `chamados_uploads`); se de fato não existe anexo nenhum, rode com `ALLOW_EMPTY_ATTACHMENTS=1`. Backup e teste usam uma trava (`.lock` na pasta de backup): nunca rodam ao mesmo tempo.

Os scripts de backup assumem os nomes do Podman (`chamados_postgres_1`); com Docker Compose os nomes levam hífen: `RUNTIME=docker PG_CONTAINER=chamados-postgres-1 UPLOADS_VOLUME=chamados_uploads npm run backup`.

Retenção: os 14 mais recentes mais um por semana (até 8 semanas). Se o backup falhar, os antigos **não** são apagados e a página de saúde mostra o erro.

### Agendar (systemd do usuário)

```bash
mkdir -p ~/.config/systemd/user
cp deploy/systemd/chamados-*.{service,timer} ~/.config/systemd/user/
# ajuste o WorkingDirectory/ExecStart se o projeto não estiver em ~/glpi_IA
systemctl --user daemon-reload
systemctl --user enable --now chamados-backup.timer chamados-restore-test.timer
loginctl enable-linger "$USER"     # para rodar mesmo sem sessão aberta
systemctl --user list-timers | grep chamados
```

O backup roda todo dia às 2h e o teste de restauração aos domingos às 3h30 (`Persistent=true`: se a máquina estava desligada, roda quando ligar).

**Importante:** guarde também uma cópia fora desta máquina (disco externo ou nuvem). Backup só na mesma máquina não protege de perder a máquina.

## 5. Restauração

O **teste de restauração** (`npm run restore:test`) não mexe no seu banco: sobe um Postgres descartável, restaura o último backup, confere as contagens da hora do dump (usuários, chamados, comentários, artigos, vetores, anexos, migrações) e se todo anexo registrado no banco está no arquivo de anexos, remove o contêiner e grava o resultado. Backup que nunca foi restaurado não conta como backup.

Para restaurar de verdade (substitui o banco atual):

```bash
podman stop chamados_web_1 chamados_worker_1 chamados_caddy_1   # só o banco fica de pé
bash scripts/restore.sh                               # lista os backups
bash scripts/restore.sh backups/chamados-AAAAMMDD-HHMMSS.dump backups/chamados-AAAAMMDD-HHMMSS-anexos.tar.gz
npm run prod:up
```

O script pede para você digitar `restaurar` antes de tocar no banco (ou use `--yes` em automações). A restauração roda numa única transação: se falhar no meio, o banco continua como estava.

Cuidado com versões: o dump traz o esquema da versão que o gerou. Se você já atualizou o código para uma versão com migrações novas, restaure com a versão do código do backup (`git checkout`) e só depois suba a versão nova, que aplica as migrações sozinha.

## 6. Quando algo falha

| Sintoma | O que olhar |
|---|---|
| `/api/health/ready` devolve 503 | O corpo diz qual verificação falhou (`banco`, `vetor`, `migracoes`, `fila`, `worker`). |
| `worker` vermelho | `podman logs chamados_worker_1`; o worker bate o coração a cada minuto, e fica vermelho depois de 3 minutos sem bater. |
| `migracoes` vermelho | Uma migração falhou na subida do web: `podman logs chamados_web_1`, corrija e suba de novo. |
| Fila com falhas | Administração → Saúde mostra por fila; avisos ao n8n que falharam têm botão "Reenviar" em Administração → Integrações. |
| Backup atrasado (mais de 26 h) | Rode `npm run backup`, confira `systemctl --user status chamados-backup.timer` e o espaço em disco. |
| Navegador não abre o `https://localhost:8443` | Confirme as portas em `.env.prod` e `podman ps`; aceite o certificado local. |
| "Mudou a chave do Gemini" | Edite o `.env.prod` e rode `npm run prod:up`. |

## 7. O que não está incluído

Domínio público e certificado real, alta disponibilidade, cópia automática dos backups para fora da máquina e alertas por e-mail. Para quem quiser um alerta, o n8n pode consultar `/api/health/ready` de tempos em tempos.
