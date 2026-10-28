#!/usr/bin/env bash
# Testa a migração de escritórios (RLS) num Postgres descartável, sem tocar em
# nenhum projeto Supabase.
#
#   1. initdb numa pasta temporária e sobe o servidor numa porta livre
#   2. stubs do Supabase (papéis, auth, storage) — tests/rls/stubs.sql
#   3. migrações 0001..N do repositório (pula as que dependem de PostGIS)
#   4. dados do escritório legado → migração de escritórios → asserções
#
# Precisa de initdb/pg_ctl/psql no PATH (PostgreSQL 15+).
# Uso: npm run test:rls
set -euo pipefail

cd "$(dirname "$0")/.."
MIGRACAO_ESCRITORIOS=supabase/migrations/0020_escritorios.sql
MIGRACAO_SAAS=supabase/migrations/0024_saas.sql

TMP="$(mktemp -d)"
PORTA="${PGPORT_TESTE:-54329}"
LOG="$TMP/pg.log"
cleanup() { pg_ctl -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

initdb -D "$TMP/data" -U postgres -A trust -E UTF8 >/dev/null
# socket na pasta temporária: o PostgreSQL do Ubuntu (runner do GitHub) usa
# /var/run/postgresql, sem permissão de escrita para o usuário — o servidor não
# subia e o CI falhava desde 2026-10-08. A conexão é por TCP (-h localhost).
SOCK="$TMP"
command -v cygpath >/dev/null && SOCK="$(cygpath -m "$TMP")"  # Git Bash: Postgres nativo do Windows
if ! pg_ctl -D "$TMP/data" -o "-p $PORTA -c listen_addresses=localhost -c unix_socket_directories=$SOCK -c lc_messages=C -c client_min_messages=warning" -l "$LOG" -w start >/dev/null; then
  cat "$LOG" >&2
  exit 1
fi

PSQL=(psql -X -q -h localhost -p "$PORTA" -U postgres -d postgres -v ON_ERROR_STOP=1)

"${PSQL[@]}" -f tests/rls/stubs.sql
for f in supabase/migrations/*.sql; do
  case "$(basename "$f")" in
    0018_*|0019_*) continue ;;  # PostGIS (parcelas do SIGEF) — fora deste teste
    0020_escritorios.sql|0024_saas.sql) continue ;;  # aplicadas abaixo, entre as etapas
    # usa servicos.tipo, que só nasce na 0005: em produção foi aplicada depois
    0002_confrontacao_no_vertice.sql) continue ;;
  esac
  "${PSQL[@]}" -f "$f" >/dev/null
  [ "$(basename "$f")" = "0005_tipo_servico.sql" ] && "${PSQL[@]}" -f supabase/migrations/0002_confrontacao_no_vertice.sql >/dev/null
done

"${PSQL[@]}" -v etapa=antes -f tests/rls/escritorios.sql
"${PSQL[@]}" -f "$MIGRACAO_ESCRITORIOS" >/dev/null
echo "migração aplicada: $MIGRACAO_ESCRITORIOS"
# resultados das consultas vão para /dev/null; ficam os avisos "ok: …" e os erros
PGOPTIONS="-c client_min_messages=notice" "${PSQL[@]}" -v etapa=depois -f tests/rls/escritorios.sql 2>&1 >/dev/null \
  | sed -E 's/^psql:[^ ]+ (NOTICE|NOTA): +//'
echo "testes de RLS dos escritórios: todos passaram"

"${PSQL[@]}" -f "$MIGRACAO_SAAS" >/dev/null
echo "migração aplicada: $MIGRACAO_SAAS"
PGOPTIONS="-c client_min_messages=notice" "${PSQL[@]}" -f tests/rls/saas.sql 2>&1 >/dev/null \
  | sed -E 's/^psql:[^ ]+ (NOTICE|NOTA): +//'
echo "testes do SaaS (planos, recursos, superadmin): todos passaram"
