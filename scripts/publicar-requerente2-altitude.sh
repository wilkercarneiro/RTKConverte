#!/usr/bin/env bash
# Publica na VPS:
#   - planta com o segundo requerente (6756bed): planta.ts + planta_dados.ts em
#     gerar-planta e gerar-documentos; planta_dados.ts em gerar-pecas (o
#     planta.ts de lá é esboço e NÃO é trocado);
#   - altitude pela coordenada (bf5a432): parse-txt e ler-arquivo (index.ts +
#     _shared/leitor/{executor,index}.ts).
#
#   bash scripts/publicar-requerente2-altitude.sh              # simulação (só lê)
#   bash scripts/publicar-requerente2-altitude.sh --executar   # publica
#
# Antes de trocar: confere por md5 que cada arquivo no ar é o do commit
# anterior à mudança; baixa a pasta da função, põe os novos por cima e roda
# no Deno até "Listening on". Banco: nada.
set -euo pipefail
cd "$(dirname "$0")/.."

VPS="root@31.97.85.119"
CHAVE="$HOME/.ssh/orbit_vps"
BASE="/opt/supabase/rtkconverte"
FN="$BASE/volumes/functions"
DATA="$(date +%Y%m%d-%H%M)"
BK="$BASE/backup-funcoes-$DATA-requerente2-altitude"
EXEC=false
[ "${1:-}" = "--executar" ] && EXEC=true

# função | arquivo (relativo a supabase/) | commit cujo arquivo deve estar no ar
TROCAS=(
  "gerar-planta|functions/_shared/planta.ts|6756bed^"
  "gerar-planta|functions/_shared/planta_dados.ts|6756bed^"
  "gerar-documentos|functions/_shared/planta.ts|6756bed^"
  "gerar-documentos|functions/_shared/planta_dados.ts|6756bed^"
  "gerar-pecas|functions/_shared/planta_dados.ts|6756bed^"
  "parse-txt|functions/parse-txt/index.ts|bf5a432^"
  "parse-txt|functions/_shared/leitor/executor.ts|bf5a432^"
  "parse-txt|functions/_shared/leitor/index.ts|bf5a432^"
  "ler-arquivo|functions/ler-arquivo/index.ts|bf5a432^"
  "ler-arquivo|functions/_shared/leitor/executor.ts|bf5a432^"
  "ler-arquivo|functions/_shared/leitor/index.ts|bf5a432^"
)
FUNCOES=(gerar-planta gerar-documentos gerar-pecas parse-txt ler-arquivo)

ssh_() { ssh -n -i "$CHAVE" -o ConnectTimeout=20 "$VPS" "$@"; }
passo() { echo; echo "==> $*"; }
md5_repo() { git show "$1:supabase/$2" | tr -d '\r' | md5sum | cut -c1-32; }
md5_local() { tr -d '\r' < "supabase/$1" | md5sum | cut -c1-32; }
md5_vps() { ssh_ "tr -d '\r' < $1 | md5sum | cut -c1-32"; }

passo "0. O que está no ar é a versão anterior?"
for t in "${TROCAS[@]}"; do
  IFS='|' read -r f arq base <<< "$t"
  noar="$(md5_vps "$FN/$f/$arq")"; antes="$(md5_repo "$base" "$arq")"; novo="$(md5_local "$arq")"
  if [ "$noar" = "$novo" ]; then echo "   $f/$arq já é o novo"
  elif [ "$noar" = "$antes" ]; then echo "   $f/$arq = $base"
  else echo "   $f/$arq no ar ($noar) não é $base ($antes) nem o novo: parando."; exit 1; fi
done

passo "0b. Cada função carrega com os arquivos novos?"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
for f in "${FUNCOES[@]}"; do
  scp -q -r -i "$CHAVE" "$VPS:$FN/$f" "$TMP/$f"
  for t in "${TROCAS[@]}"; do IFS='|' read -r g arq _ <<< "$t"; [ "$g" = "$f" ] && cp "supabase/$arq" "$TMP/$f/$arq"; done
  ( cd "$TMP/$f" && SUPABASE_URL=http://x SUPABASE_ANON_KEY=x SUPABASE_SERVICE_ROLE_KEY=x timeout 90 deno run -A --no-check --config deno.json index.ts > "$TMP/$f.log" 2>&1 ) || true
  grep -q "Listening on" "$TMP/$f.log" && echo "   $f: carrega" || { echo "   $f NÃO carrega:"; sed 's/^/      /' "$TMP/$f.log" | head -20; exit 1; }
done

$EXEC || { echo; echo "Simulação ok. Rode com --executar para publicar."; exit 0; }

passo "1. Backup em $BK"
ssh_ "set -e; mkdir -p $BK; for f in ${FUNCOES[*]}; do cp -a $FN/\$f $BK/; done; ls $BK"

passo "2. Troca"
for t in "${TROCAS[@]}"; do
  IFS='|' read -r f arq _ <<< "$t"
  scp -q -i "$CHAVE" "supabase/$arq" "$VPS:$FN/$f/$arq" < /dev/null
  [ "$(md5_vps "$FN/$f/$arq")" = "$(md5_local "$arq")" ] && echo "   $f/$arq ok" || { echo "   $f/$arq md5 diferente após a cópia!"; exit 1; }
done

passo "3. Reinício das funções"
ssh_ "uptime; docker service update --force --detach=false sb_rtkconverte_functions > /dev/null 2>&1; docker service ps sb_rtkconverte_functions --format '{{.CurrentState}}' | head -1; uptime"
echo; echo "Publicado. Rode a fumaça (chamada sem login: 401/400 = sobe; 503 = falta arquivo)."
