#!/usr/bin/env bash
# Publica a correção da SATÉLITE DE OUTRO LUGAR (67e9c98, 06/11/2026) na VPS.
#
#   bash scripts/publicar-satelite.sh              # simulação (só lê a VPS)
#   bash scripts/publicar-satelite.sh --executar   # publica de verdade
#
# Funções: troca functions/_shared/satelite.ts em buscar-satelite, gerar-planta
# e gerar-documentos, e functions/buscar-satelite/index.ts. Nenhum módulo novo:
# o resto do que está no ar já é igual ao repositório (md5 conferido antes).
# Banco: refaz lat_gms/lon_gms dos vértices cujo GMS ficou no fuso antigo
# (scripts/reparo-gms-fuso.mjs), com backup das linhas antes.
set -euo pipefail
cd "$(dirname "$0")/.."

VPS="root@31.97.85.119"
CHAVE="$HOME/.ssh/orbit_vps"
BASE="/opt/supabase/rtkconverte"
FN="$BASE/volumes/functions"
DATA="$(date +%Y%m%d-%H%M)"
BK="$BASE/backup-funcoes-$DATA-satelite"
BKB="$BASE/backup-banco-$DATA-satelite"
EXEC=false
[ "${1:-}" = "--executar" ] && EXEC=true
BASE_COMMIT="67e9c98^"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

ssh_() { ssh -i "$CHAVE" -o ConnectTimeout=20 "$VPS" "$@"; }
passo() { echo; echo "==> $*"; }
md5_repo() { git show "$1:$2" | tr -d '\r' | md5sum | cut -c1-32; }
md5_local() { tr -d '\r' < "$1" | md5sum | cut -c1-32; }
md5_vps() { ssh_ "tr -d '\r' < $1 | md5sum | cut -c1-32"; }
psql_() { ssh_ "C=\$(docker ps -q -f name=sb_rtkconverte_db | head -1); docker exec -i \$C psql -U postgres -v ON_ERROR_STOP=1 $*"; }

# pares "caminho no ar (relativo a $FN)" : "arquivo do repo"
PARES=(
  "buscar-satelite/functions/_shared/satelite.ts:supabase/functions/_shared/satelite.ts"
  "gerar-planta/functions/_shared/satelite.ts:supabase/functions/_shared/satelite.ts"
  "gerar-documentos/functions/_shared/satelite.ts:supabase/functions/_shared/satelite.ts"
  "buscar-satelite/functions/buscar-satelite/index.ts:supabase/functions/buscar-satelite/index.ts"
)

# ------------------------------------------------------------ 0. conferência
passo "0. O que está no ar é o esperado ($BASE_COMMIT)?"
for par in "${PARES[@]}"; do
  r="${par%%:*}"; l="${par#*:}"
  noar="$(md5_vps "$FN/$r")"; esperado="$(md5_repo "$BASE_COMMIT" "$l")"; novo="$(md5_local "$l")"
  if [ "$noar" = "$novo" ]; then echo "   $r já é o novo"; continue; fi
  [ "$noar" = "$esperado" ] || { echo "   $r no ar ($noar) != $BASE_COMMIT ($esperado): alguém publicou outra coisa. Parando."; exit 1; }
  echo "   $r = $BASE_COMMIT (ok)"
done

passo "0b. Vértices com GMS desencontrado do E/N (só leitura)"
psql_ "-At -F'|' -c \"select v.id, v.servico_id, s.fuso_utm, v.e, v.n, v.lat_gms, v.lon_gms, v.inserido_manual from vertices v join servicos s on s.id=v.servico_id where s.fuso_utm is not null and v.e is not null and v.n is not null and coalesce(v.lat_gms,'')<>'' and coalesce(v.lon_gms,'')<>''\"" > "$TMP/vertices.psv"
node scripts/reparo-gms-fuso.mjs "$TMP/vertices.psv" "$TMP/reparo.sql"
NUPD="$(grep -c '^update' "$TMP/reparo.sql" || true)"

# ------------------------------------------------------------ 1. backup
passo "1. Backup em $BK e $BKB"
if $EXEC; then
  ssh_ "set -e; mkdir -p $BK $BKB; for f in buscar-satelite gerar-planta gerar-documentos; do cp -a $FN/\$f $BK/; done; ls $BK"
  psql_ "-At -c \"copy vertices to stdout with csv header\"" > "$TMP/vertices-antes.csv"
  scp -q -i "$CHAVE" "$TMP/vertices-antes.csv" "$TMP/reparo.sql" "$VPS:$BKB/"
  echo "   vertices-antes.csv ($(wc -l < "$TMP/vertices-antes.csv") linhas) + reparo.sql em $BKB"
else
  echo "   [simulação] cp -a funções → $BK; vertices (csv) + reparo.sql → $BKB"
fi

# ------------------------------------------------------------ 2. funções
passo "2. Troca dos arquivos + reinício"
if $EXEC; then
  for par in "${PARES[@]}"; do scp -q -i "$CHAVE" "${par#*:}" "$VPS:$FN/${par%%:*}"; done
  ssh_ "uptime; docker service update --force --quiet sb_rtkconverte_functions >/dev/null && echo 'funções reiniciadas'; uptime"
else
  for par in "${PARES[@]}"; do echo "   [simulação] ${par#*:} → ${par%%:*}"; done
  echo "   [simulação] docker service update --force sb_rtkconverte_functions"
fi

# ------------------------------------------------------------ 3. banco
passo "3. Reparo do GMS ($NUPD UPDATE)"
if $EXEC && [ "$NUPD" -gt 0 ]; then
  psql_ "-q -1" < "$TMP/reparo.sql"
  psql_ "-At -F'|' -c \"select v.id, v.servico_id, s.fuso_utm, v.e, v.n, v.lat_gms, v.lon_gms, v.inserido_manual from vertices v join servicos s on s.id=v.servico_id where s.fuso_utm is not null and v.e is not null and v.n is not null and coalesce(v.lat_gms,'')<>'' and coalesce(v.lon_gms,'')<>''\"" > "$TMP/depois.psv"
  node scripts/reparo-gms-fuso.mjs "$TMP/depois.psv" "$TMP/sobra.sql" | tail -1
else
  echo "   [simulação] psql -1 < reparo.sql"
fi

# ------------------------------------------------------------ 4. conferência + fumaça
passo "4. md5 no ar = repositório, e fumaça"
if $EXEC; then
  for par in "${PARES[@]}"; do
    r="${par%%:*}"; l="${par#*:}"
    [ "$(md5_vps "$FN/$r")" = "$(md5_local "$l")" ] && echo "   $r = repo" || { echo "   $r DIFERENTE do repo"; exit 1; }
  done
  sleep 20
  ANON="$(grep -E '^VITE_SUPABASE_ANON_KEY=' .env | cut -d= -f2- | tr -d '"\r')"
  URL="https://utxqkbgfgpbczqjtieyu.supabase.agenteselevex.top/functions/v1"
  for f in buscar-satelite gerar-planta gerar-documentos; do
    printf '   %-18s ' "$f"
    node -e "fetch('$URL/$f',{method:'POST',headers:{apikey:'$ANON',Authorization:'Bearer $ANON','Content-Type':'application/json'},body:'{}'}).then(async r=>console.log(r.status,(await r.text()).slice(0,120)))"
  done
  echo; echo "Publicado. Backups: $BK e $BKB"
  echo "Volta atrás (funções): ssh … 'for f in buscar-satelite gerar-planta gerar-documentos; do rm -rf $FN/\$f && cp -a $BK/\$f $FN/; done; docker service update --force sb_rtkconverte_functions'"
else
  echo "   [simulação] 4 arquivos no ar = repo; POST {} sem usuário → esperado 400/401 do próprio código (503 = falta arquivo)"
  echo; echo "Simulação concluída. Rode com --executar para publicar."
fi
