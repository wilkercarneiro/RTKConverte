#!/usr/bin/env bash
# Publica as edge functions no projeto de produção.
#
# Existe porque o deploy manual saiu de sincronia com o repositório: em
# 2026-08-05 as functions foram publicadas 65 min ANTES do commit que criou o
# fallback LA3 (`ehViaPorLimite`), e as plantas passaram a sair sem a linha
# vermelha da faixa de domínio. Publicar tudo de uma vez, sempre, evita repetir.
#
# A lista de funções sai das pastas de `supabase/functions/` (menos `_shared`):
# a lista fixa que havia aqui esqueceu `consultar-sigef` quando ela nasceu.
# `verify_jwt` de cada função vem de `supabase/config.toml` (admin-setup é a
# única sem JWT — é protegida pelo segredo de `config_setup`).
#
# Uso:
#   npx supabase login          # uma vez, abre o navegador
#   bash scripts/deploy-functions.sh            # todas
#   bash scripts/deploy-functions.sh parse-txt  # só as citadas
#
# ou, sem login interativo (CI):
#   SUPABASE_ACCESS_TOKEN=sbp_... bash scripts/deploy-functions.sh
set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-utxqkbgfgpbczqjtieyu}"

cd "$(dirname "$0")/.."

if [ "$#" -gt 0 ]; then
  FUNCTIONS=("$@")
else
  FUNCTIONS=()
  for d in supabase/functions/*/; do
    fn="$(basename "$d")"
    [ "$fn" = "_shared" ] && continue
    FUNCTIONS+=("$fn")
  done
fi

echo "== testes =="
node --test tests/*.test.mjs

echo
echo "== deploy em $PROJECT_REF (${#FUNCTIONS[@]} funções: ${FUNCTIONS[*]}) =="
for fn in "${FUNCTIONS[@]}"; do
  echo "--- $fn"
  # --use-api: empacota no servidor, sem Docker na máquina
  npx supabase functions deploy "$fn" --project-ref "$PROJECT_REF" --use-api
done

echo
echo "OK. Confira as versões com: npx supabase functions list --project-ref $PROJECT_REF"
