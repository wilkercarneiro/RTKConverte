#!/usr/bin/env bash
# Publica o TIMBRE AUTOMÁTICO na VPS: gerar-pecas e gerar-documentos.
#
#   bash scripts/publicar-timbre.sh              # simulação (só lê a VPS)
#   bash scripts/publicar-timbre.sh --executar   # publica de verdade
#
# Troca SÓ três arquivos por função — functions/<f>/index.ts e
# functions/_shared/timbre_automatico.ts (novo) — porque o resto do que está no
# ar já é igual ao repositório (conferido por md5 antes de trocar). Não mexe em
# servico.ts, deno.json nem nos esboços de tipos (memorial.ts/ods.ts/planta.ts
# do gerar-pecas). Banco: nada.
set -euo pipefail
cd "$(dirname "$0")/.."

VPS="root@31.97.85.119"
CHAVE="$HOME/.ssh/orbit_vps"
BASE="/opt/supabase/rtkconverte"
FN="$BASE/volumes/functions"
DATA="$(date +%Y%m%d-%H%M)"
BK="$BASE/backup-funcoes-$DATA-timbre"
EXEC=false
[ "${1:-}" = "--executar" ] && EXEC=true
FUNCOES=(gerar-pecas gerar-documentos)
# o index.ts no ar tem de ser o do commit anterior ao timbre (15ea701)
BASE_COMMIT="15ea701"

ssh_() { ssh -i "$CHAVE" -o ConnectTimeout=20 "$VPS" "$@"; }
passo() { echo; echo "==> $*"; }
md5_repo() { git show "$1:$2" | tr -d '\r' | md5sum | cut -c1-32; }
md5_local() { tr -d '\r' < "$1" | md5sum | cut -c1-32; }
md5_vps() { ssh_ "tr -d '\r' < $1 | md5sum | cut -c1-32"; }

# ------------------------------------------------------------ 0. conferência
passo "0. O que está no ar é o esperado?"
for f in "${FUNCOES[@]}"; do
  esperado="$(md5_repo "$BASE_COMMIT" "supabase/functions/$f/index.ts")"
  noar="$(md5_vps "$FN/$f/functions/$f/index.ts")"
  if [ "$noar" != "$esperado" ]; then
    echo "   $f/index.ts no ar ($noar) != $BASE_COMMIT ($esperado): alguém publicou outra coisa. Parando."; exit 1
  fi
  echo "   $f/index.ts = $BASE_COMMIT (ok)"
  ssh_ "test -f $FN/$f/functions/_shared/modelos.ts && test -f $FN/$f/functions/_shared/planta_dados.ts" \
    || { echo "   $f sem modelos.ts/planta_dados.ts no _shared: parando."; exit 1; }
done

# ------------------------------------------------------------ 1. backup
passo "1. Backup em $BK"
if $EXEC; then
  ssh_ "set -e; mkdir -p $BK; for f in ${FUNCOES[*]}; do cp -a $FN/\$f $BK/; done; ls $BK"
else
  echo "   [simulação] cp -a ${FUNCOES[*]} → $BK"
fi

# ------------------------------------------------------------ 2. troca
passo "2. Troca dos arquivos"
for f in "${FUNCOES[@]}"; do
  if $EXEC; then
    scp -q -i "$CHAVE" "supabase/functions/$f/index.ts" "$VPS:$FN/$f/functions/$f/index.ts"
    scp -q -i "$CHAVE" "supabase/functions/_shared/timbre_automatico.ts" "$VPS:$FN/$f/functions/_shared/timbre_automatico.ts"
  else
    echo "   [simulação] $f: functions/$f/index.ts + functions/_shared/timbre_automatico.ts"
  fi
done

# ------------------------------------------------------------ 3. reinício
passo "3. Reinício das funções"
if $EXEC; then
  ssh_ "uptime; docker service update --force --quiet sb_rtkconverte_functions >/dev/null && echo 'funções reiniciadas'; uptime"
else
  echo "   [simulação] docker service update --force sb_rtkconverte_functions"
fi

# ------------------------------------------------------------ 4. conferência + fumaça
passo "4. md5 no ar = repositório, e fumaça"
if $EXEC; then
  for f in "${FUNCOES[@]}"; do
    for par in "functions/$f/index.ts:supabase/functions/$f/index.ts" "functions/_shared/timbre_automatico.ts:supabase/functions/_shared/timbre_automatico.ts"; do
      r="${par%%:*}"; l="${par#*:}"
      [ "$(md5_vps "$FN/$f/$r")" = "$(md5_local "$l")" ] && echo "   $f/$r = repo" || { echo "   $f/$r DIFERENTE do repo"; exit 1; }
    done
  done
  sleep 20
  ANON="$(grep -E '^VITE_SUPABASE_ANON_KEY=' .env | cut -d= -f2- | tr -d '"\r')"
  URL="https://utxqkbgfgpbczqjtieyu.supabase.agenteselevex.top/functions/v1"
  for f in "${FUNCOES[@]}"; do
    printf '   %-18s ' "$f"
    node -e "fetch('$URL/$f',{method:'POST',headers:{apikey:'$ANON',Authorization:'Bearer $ANON','Content-Type':'application/json'},body:'{}'}).then(async r=>console.log(r.status,(await r.text()).slice(0,120)))"
  done
  echo; echo "Publicado. Backup: $BK"
  echo "Volta atrás: ssh … 'for f in ${FUNCOES[*]}; do rm -rf $FN/\$f && cp -a $BK/\$f $FN/; done; docker service update --force sb_rtkconverte_functions'"
else
  echo "   [simulação] md5 dos 4 arquivos no ar = repo; POST {} sem usuário → esperado 401/400 do próprio código"
  echo; echo "Simulação concluída. Rode com --executar para publicar."
fi
