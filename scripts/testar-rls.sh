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
    0018_*|0019_*|0030_*|0032_*) continue ;;  # PostGIS (parcelas do SIGEF) — no fim, se houver PostGIS
    0020_escritorios.sql|0024_saas.sql|0025_equipe.sql|0026_auditoria.sql|0027_creditos.sql|0028_*|0029_*|0033_*|0034_*) continue ;;  # aplicadas abaixo, entre as etapas
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

"${PSQL[@]}" -f supabase/migrations/0025_equipe.sql >/dev/null
echo "migração aplicada: supabase/migrations/0025_equipe.sql"
PGOPTIONS="-c client_min_messages=notice" "${PSQL[@]}" -f tests/rls/equipe.sql 2>&1 >/dev/null   | sed -E 's/^psql:[^ ]+ (NOTICE|NOTA): +//'
echo "testes da equipe (permissões, desativação, limite, histórico): todos passaram"

"${PSQL[@]}" -f supabase/migrations/0026_auditoria.sql >/dev/null
echo "migração aplicada: supabase/migrations/0026_auditoria.sql"
PGOPTIONS="-c client_min_messages=notice" "${PSQL[@]}" -f tests/rls/auditoria.sql 2>&1 >/dev/null   | sed -E 's/^psql:[^ ]+ (NOTICE|NOTA): +//'
echo "testes da auditoria (autoria, agrupamento, edge functions, leitura): todos passaram"

"${PSQL[@]}" -f supabase/migrations/0027_creditos.sql >/dev/null
echo "migração aplicada: supabase/migrations/0027_creditos.sql"
PGOPTIONS="-c client_min_messages=notice" "${PSQL[@]}" -f tests/rls/creditos.sql 2>&1 >/dev/null   | sed -E 's/^psql:[^ ]+ (NOTICE|NOTA): +//'
echo "testes dos créditos (tetos, compra, derivado, negociação): todos passaram"

# 0028 (GPROL) depende dos recursos da 0024: entra depois da 0027
"${PSQL[@]}" -f supabase/migrations/0028_integracao_gprol.sql >/dev/null
echo "migração aplicada: supabase/migrations/0028_integracao_gprol.sql"

"${PSQL[@]}" -f supabase/migrations/0029_suporte_equipe_clientes.sql >/dev/null
echo "migração aplicada: supabase/migrations/0029_suporte_equipe_clientes.sql"
PGOPTIONS="-c client_min_messages=notice" "${PSQL[@]}" -f tests/rls/suporte.sql 2>&1 >/dev/null   | sed -E 's/^psql:[^ ]+ (NOTICE|NOTA): +//'
echo "testes do suporte, acessos, equipe e clientes: todos passaram"

# 0033 (concluir serviço) redefine o atividade_servico da 0028: entra depois dela
"${PSQL[@]}" -f supabase/migrations/0033_concluir_servico.sql >/dev/null
echo "migração aplicada: supabase/migrations/0033_concluir_servico.sql"
PGOPTIONS="-c client_min_messages=notice" "${PSQL[@]}" -f tests/rls/conclusao.sql 2>&1 >/dev/null | sed -E 's/^psql:[^ ]+ (NOTICE|NOTA): +//'
echo "testes de concluir serviço (pedido do GPROL entregue, fila, reabrir): todos passaram"

# 0034 (planos, carteiras, cobrança) migra os dados que a 0027 e o teste dela deixaram
"${PSQL[@]}" -f supabase/migrations/0034_planos_creditos_cobranca.sql >/dev/null
echo "migração aplicada: supabase/migrations/0034_planos_creditos_cobranca.sql"
PGOPTIONS="-c client_min_messages=notice" "${PSQL[@]}" -f tests/rls/planos_cobranca.sql 2>&1 >/dev/null | sed -E 's/^psql:[^ ]+ (NOTICE|NOTA): +//'
echo "testes dos planos, carteiras de crédito e cobrança pelo Asaas: todos passaram"

# Parcelas do SIGEF (0018/0019 → 0030): precisam do PostGIS. Sem a extensão no
# Postgres local (ou no CI), o teste fica de fora e o script avisa.
if [ "$("${PSQL[@]}" -tAc "select count(*) from pg_available_extensions where name = 'postgis'")" = "1" ]; then
  "${PSQL[@]}" -f supabase/migrations/0018_parcelas_sigef.sql >/dev/null
  "${PSQL[@]}" -f supabase/migrations/0019_sigef_online.sql >/dev/null
  PGOPTIONS="-c client_min_messages=notice" "${PSQL[@]}" -v etapa=antes -f tests/rls/sigef.sql 2>&1 >/dev/null | sed -E 's/^psql:[^ ]+ (NOTICE|NOTA): +//'
  "${PSQL[@]}" -f supabase/migrations/0030_sigef_parcelas_por_empresa.sql >/dev/null
  echo "migração aplicada: supabase/migrations/0030_sigef_parcelas_por_empresa.sql"
  PGOPTIONS="-c client_min_messages=notice" "${PSQL[@]}" -v etapa=depois -f tests/rls/sigef.sql 2>&1 >/dev/null | sed -E 's/^psql:[^ ]+ (NOTICE|NOTA): +//'
  "${PSQL[@]}" -f supabase/migrations/0030_sigef_parcelas_por_empresa.sql >/dev/null
  PGOPTIONS="-c client_min_messages=notice" "${PSQL[@]}" -v etapa=reaplicada -f tests/rls/sigef.sql 2>&1 >/dev/null | sed -E 's/^psql:[^ ]+ (NOTICE|NOTA): +//'
  echo "testes das parcelas do SIGEF por empresa (quarentena, isolamento, só o servidor grava oficial): todos passaram"
  "${PSQL[@]}" -f supabase/migrations/0032_sigef_sincronizar_trava.sql >/dev/null
  echo "migração aplicada: supabase/migrations/0032_sigef_sincronizar_trava.sql"
  PGOPTIONS="-c client_min_messages=notice" "${PSQL[@]}" -f tests/rls/sigef_trava.sql 2>&1 >/dev/null | sed -E 's/^psql:[^ ]+ (NOTICE|NOTA): +//'
  echo "testes da trava contra apagar a cópia oficial em massa: todos passaram"
else
  echo "PostGIS ausente: testes das parcelas do SIGEF (0018/0019/0030) pulados"
fi
