#!/usr/bin/env bash
# Restaura um backup (scripts/backup-banco.sh) num Postgres descartável local e
# conta as linhas das tabelas principais. Não toca em produção.
#
# Uso: bash scripts/restaurar-teste.sh backups/vertice-AAAAMMDD-HHMMSS.dump
#
# Objetos próprios do Supabase (extensões, funções internas do auth/storage)
# podem dar aviso na restauração: o que importa é a contagem no fim bater com a
# de produção (compare com o mesmo SELECT no SQL Editor do painel).
set -uo pipefail

ARQ="${1:?informe o arquivo .dump}"
[ -f "$ARQ" ] || { echo "arquivo não encontrado: $ARQ"; exit 1; }

TMP="$(mktemp -d)"
PORTA="${PGPORT_TESTE:-54330}"
cleanup() { pg_ctl -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

initdb -D "$TMP/data" -U postgres -A trust -E UTF8 >/dev/null || exit 1
pg_ctl -D "$TMP/data" -o "-p $PORTA -c listen_addresses=localhost -c lc_messages=C" -l "$TMP/pg.log" -w start >/dev/null || exit 1

PSQL=(psql -X -q -h localhost -p "$PORTA" -U postgres -d postgres)
"${PSQL[@]}" -c "create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
                 create schema if not exists extensions;" >/dev/null

echo "restaurando $ARQ…"
pg_restore -h localhost -p "$PORTA" -U postgres -d postgres --no-owner --no-acl "$ARQ" 2>"$TMP/restore.err"
echo "avisos/erros da restauração: $(grep -c 'error' "$TMP/restore.err" || true) (detalhe: tail do arquivo abaixo)"
tail -5 "$TMP/restore.err"

echo
echo "== linhas por tabela =="
"${PSQL[@]}" -c "
select 'auth.users' tabela, count(*) from auth.users
union all select 'servicos', count(*) from public.servicos
union all select 'vertices', count(*) from public.vertices
union all select 'clientes', count(*) from public.clientes
union all select 'documentos_gerados', count(*) from public.documentos_gerados
union all select 'credenciados', count(*) from public.credenciados
union all select 'responsaveis_tecnicos', count(*) from public.responsaveis_tecnicos
union all select 'storage.objects', count(*) from storage.objects;"
