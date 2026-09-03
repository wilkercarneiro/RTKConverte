#!/usr/bin/env bash
# Publica as edge functions no projeto de produção.
#
# Existe porque o deploy manual saiu de sincronia com o repositório: em
# 2026-08-05 as functions foram publicadas 65 min ANTES do commit que criou o
# fallback LA3 (`ehViaPorLimite`), e as plantas passaram a sair sem a linha
# vermelha da faixa de domínio. Publicar tudo de uma vez, sempre, evita repetir.
#
# Uso:
#   npx supabase login          # uma vez, abre o navegador
#   bash scripts/deploy-functions.sh
#
# ou, sem login interativo:
#   SUPABASE_ACCESS_TOKEN=sbp_... bash scripts/deploy-functions.sh
set -euo pipefail

PROJECT_REF=utxqkbgfgpbczqjtieyu
FUNCTIONS=(gerar-planta gerar-documentos gerar-pecas parse-txt reunir-certificados corrigir-sobreposicao admin-setup)

cd "$(dirname "$0")/.."

echo "== testes =="
node --test tests/*.test.mjs

echo
echo "== deploy em $PROJECT_REF =="
for fn in "${FUNCTIONS[@]}"; do
  echo "--- $fn"
  npx supabase functions deploy "$fn" --project-ref "$PROJECT_REF"
done

echo
echo "OK. Confira as versões com: npx supabase functions list --project-ref $PROJECT_REF"
