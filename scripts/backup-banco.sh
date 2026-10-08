#!/usr/bin/env bash
# Cópia de segurança do banco de produção (pg_dump, formato custom).
#
# O Supabase já faz backup diário no plano pago, mas ele fica preso à conta e
# só volta inteiro, por cima de tudo. Esta cópia fica com o dono, e
# `restaurar-teste.sh` prova que ela abre (backup nunca restaurado é hipótese).
#
# Uso:
#   SUPABASE_DB_URL='postgresql://postgres.utxqkbgfgpbczqjtieyu:SENHA@aws-0-sa-east-1.pooler.supabase.com:5432/postgres' \
#     bash scripts/backup-banco.sh [pasta-destino]
# A URL está em Supabase → Project Settings → Database → Connection string
# (Session pooler). A senha é a do banco, NÃO a chave anon.
#
# Os arquivos do Storage (DOCX/PDF gerados, templates) NÃO estão no dump:
# veja docs/operacao/backup-e-monitoramento.md.
set -euo pipefail

: "${SUPABASE_DB_URL:?defina SUPABASE_DB_URL (ver cabeçalho do script)}"
DESTINO="${1:-backups}"
mkdir -p "$DESTINO"
ARQ="$DESTINO/vertice-$(date +%Y%m%d-%H%M%S).dump"

# public (dados do sistema) + auth (contas, para restaurar logins) + storage
# (metadados dos arquivos). --no-owner/--no-acl: restaura em qualquer servidor.
pg_dump "$SUPABASE_DB_URL" -Fc --no-owner --no-acl \
  --schema=public --schema=auth --schema=storage \
  -f "$ARQ"

echo "backup: $ARQ ($(du -h "$ARQ" | cut -f1))"
echo "teste de restauração: bash scripts/restaurar-teste.sh $ARQ"
