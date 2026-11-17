#!/usr/bin/env bash
# Publica na VPS a função `entregar` com o formato novo "TXT do levantamento"
# (Exportar ▾ → TXT do levantamento: pontos com altitude, σ e confrontantes).
#
# O resto desta entrega é SÓ SITE (vai no push): a pergunta "Seu arquivo veio
# sem σ e altitude. Usar a configuração do GPS?" na conferência do TXT, a
# configuração do GPS em Configurações → Empresa (config_empresa, sem migração)
# e o "Usar a área em outro serviço" (monta no navegador, não passa por aqui).
#
# ORDEM: esta função PRIMEIRO, o push DEPOIS. Site novo com a função velha: o
# item "TXT do levantamento" responde "Formato de exportação inválido".
#
# O pacote também leva o que a `entregar` no ar ainda não tinha (comparado em
# 17/11 contra o arquivo da VPS, md5 48a3f1fa…): o registro da sobreposição do
# CAR na leitura do projeto (64df7d0, 13/11 — a função não foi republicada).
#
#   bash scripts/publicar-levar-area.sh              # simulação (só lê a VPS)
#   bash scripts/publicar-levar-area.sh --executar   # publica
set -euo pipefail
cd "$(dirname "$0")/.."

VPS="root@31.97.85.119"
CHAVE="$HOME/.ssh/orbit_vps"
BASE="/opt/supabase/rtkconverte"
FN="$BASE/volumes/functions"
DATA="$(date +%Y%m%d-%H%M)"
BKF="$BASE/backup-funcoes-$DATA-levar-area"
HOST="utxqkbgfgpbczqjtieyu.supabase.agenteselevex.top"
EXEC=false
[ "${1:-}" = "--executar" ] && EXEC=true

ssh_() { ssh -n -i "$CHAVE" -o ConnectTimeout=20 "$VPS" "$@"; }
passo() { echo; echo "==> $*"; }
md5_local() { tr -d '\r' < "$1" | md5sum | cut -c1-32; }
md5_vps() { ssh_ "tr -d '\r' < $1 | md5sum | cut -c1-32"; }
ANON="$(grep -E '^VITE_SUPABASE_ANON_KEY=' .env | head -1 | cut -d= -f2- | tr -d '"\r')"
fumaca() {
  # com a chave pública no Authorization passa o portão JWT e chega ao código: o formato é conferido antes do login
  curl -s -o /dev/null -w '%{http_code}' -X POST "https://$HOST/functions/v1/entregar" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H 'Content-Type: application/json' \
    -d '{"servico_id":"00000000-0000-0000-0000-000000000000","saida":"area","formato":"levantamento"}'
}

passo "0. Pacote local e o que está no ar"
node scripts/empacotar-entregar.mjs > /dev/null
NOVO="$(md5_local build/funcoes/entregar/index.ts)"
NOAR="$(md5_vps "$FN/entregar/index.ts")"
echo "   no ar: $NOAR · pacote novo: $NOVO"
[ "$NOAR" = "$NOVO" ] && { echo "   a entregar no ar já é este pacote: nada a fazer."; exit 0; }
[ "$NOAR" = "48a3f1fa5858d6983e6225cc67649e59" ] || { echo "   a entregar no ar mudou desde o levantamento de 17/11: parando (compare antes)."; exit 1; }
echo "   fumaça antes (400 = servidor sem o formato; 401 = já tem): $(fumaca)"

passo "1. O pacote carrega no Deno?"
PACOTE="$(mktemp -d)"; trap 'rm -rf "$PACOTE"' EXIT
cp build/funcoes/entregar/index.ts build/funcoes/entregar/deno.json "$PACOTE/"
porta_livre() { node -e "require('net').connect(8000,'127.0.0.1').on('connect',()=>process.exit(1)).on('error',()=>process.exit(0))"; }
for _ in $(seq 1 60); do porta_livre && break; sleep 1; done
( cd "$PACOTE"
  SUPABASE_URL="https://$HOST" SUPABASE_ANON_KEY="$ANON" SUPABASE_SERVICE_ROLE_KEY=x PORT=0 \
    timeout 120 deno run --no-check -A --config deno.json index.ts > "$PACOTE/log" 2>&1 & echo $! > "$PACOTE/pid" )
ok=false
for _ in $(seq 1 90); do grep -q "Listening" "$PACOTE/log" && { ok=true; break; }; sleep 1; done
pid="$(cat "$PACOTE/pid")"
wpid="$(cat "/proc/$pid/winpid" 2>/dev/null || true)"
[ -n "$wpid" ] && taskkill //F //T //PID "$wpid" >/dev/null 2>&1 || true
pkill -P "$pid" 2>/dev/null || true; kill "$pid" 2>/dev/null || true
if $ok; then echo "   entregar: carrega"; else echo "   entregar NÃO carrega:"; tail -8 "$PACOTE/log"; exit 1; fi

$EXEC || { echo; echo "Simulação ok. Rode com --executar para publicar (depois, o push)."; exit 0; }

passo "2. Backup ($BKF)"
ssh_ "set -e; mkdir -p $BKF; cp -a $FN/entregar $BKF/; ls $BKF/entregar"

passo "3. Troca do pacote"
scp -q -i "$CHAVE" build/funcoes/entregar/index.ts "$VPS:$FN/entregar/index.ts" < /dev/null
scp -q -i "$CHAVE" build/funcoes/entregar/deno.json "$VPS:$FN/entregar/deno.json" < /dev/null
[ "$(md5_vps "$FN/entregar/index.ts")" = "$NOVO" ] && echo "   entregar ok (md5 $NOVO)" || { echo "   entregar md5 diferente após a cópia!"; exit 1; }

passo "4. Reinício das funções"
ssh_ "docker service update --force --detach=false sb_rtkconverte_functions > /dev/null 2>&1; docker service ps sb_rtkconverte_functions --format '{{.CurrentState}}' | head -1"

passo "5. Fumaça: o formato novo passa da conferência (401 = sem login, depois do formato; 400 = servidor velho; 503 = não subiu)"
sleep 15
r="$(fumaca)"; echo "   entregar formato=levantamento: $r"
[ "$r" = "401" ] || { echo "   esperado 401 — confira (backup em $BKF)."; exit 1; }
echo; echo "Publicado. Backup: $BKF. Agora o push do site."
