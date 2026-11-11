#!/usr/bin/env bash
# Publica na VPS tudo o que estava no repositório e não no ar em 11/11/2026
# (pedido do Wilker: "pode publicar tudo que está pendente"). Levantado por md5
# de cada arquivo das funções no ar contra o repositório:
#   - banco: 0048 (medicoes_campo.calibracoes — "Calibrar num marco" do Medir
#     no campo), idempotente;
#   - _shared/servico.ts em gerar-documentos, gerar-planta, parse-txt e
#     reunir-certificados (41bab96 confrontação no sentido horário, a57bfe3 e
#     bb5b0c4 — só o gerar-pecas tinha recebido);
#   - _shared/planta_cena.ts nas três funções de planta (1a164d1);
#   - _shared/certificados.ts no corrigir-sobreposicao (a57bfe3);
#   - _shared/leitor/{executor,index}.ts no analise-imovel (bf5a432);
#   - pacote entregar (no ar desde 05/11; falta 1a164d1, planta editável do
#     loteamento + dados do cliente nas Entregas).
#   Fica de fora: memorial.ts/ods.ts, que no ar são esboços de tipo (de
#   propósito), e a 0051 (trabalho em andamento de outra sessão).
#
#   bash scripts/publicar-pendentes-1111.sh              # simulação (só lê)
#   bash scripts/publicar-pendentes-1111.sh --executar   # publica
set -euo pipefail
cd "$(dirname "$0")/.."

VPS="root@31.97.85.119"
CHAVE="$HOME/.ssh/orbit_vps"
BASE="/opt/supabase/rtkconverte"
FN="$BASE/volumes/functions"
DATA="$(date +%Y%m%d-%H%M)"
BKF="$BASE/backup-funcoes-$DATA-pendentes"
BKB="$BASE/backup-banco-$DATA-pendentes"
HOST="utxqkbgfgpbczqjtieyu.supabase.agenteselevex.top"
MIGRACOES=(supabase/migrations/0048_medicoes_calibracoes.sql)
EXEC=false
[ "${1:-}" = "--executar" ] && EXEC=true

# função | arquivo (relativo à pasta da função na VPS) | md5 no ar em 11/11
TROCAS=(
  "gerar-documentos|functions/_shared/servico.ts|a555d02d44d1de1649e961855b1aaec2"
  "gerar-planta|functions/_shared/servico.ts|611b804e292a6414b3f49d140ab16a8f"
  "parse-txt|functions/_shared/servico.ts|4716f34e24b4e450bab1751e9ff664a8"
  "reunir-certificados|functions/_shared/servico.ts|4716f34e24b4e450bab1751e9ff664a8"
  "gerar-documentos|functions/_shared/planta_cena.ts|cb30f2ebf45a12ae0095c93c9c65d029"
  "gerar-pecas|functions/_shared/planta_cena.ts|cb30f2ebf45a12ae0095c93c9c65d029"
  "gerar-planta|functions/_shared/planta_cena.ts|cb30f2ebf45a12ae0095c93c9c65d029"
  "corrigir-sobreposicao|functions/_shared/certificados.ts|c265d8ff68036247d2f4c93cc54f6a8f"
  "analise-imovel|functions/_shared/leitor/executor.ts|18d6aea9be4b2ddccb66b4fd8712659b"
  "analise-imovel|functions/_shared/leitor/index.ts|413c56b186f212b4735677169fec72c0"
)
FUNCOES=(gerar-documentos gerar-planta gerar-pecas parse-txt reunir-certificados corrigir-sobreposicao analise-imovel)

ssh_() { ssh -n -i "$CHAVE" -o ConnectTimeout=20 "$VPS" "$@"; }
passo() { echo; echo "==> $*"; }
md5_local() { tr -d '\r' < "$1" | md5sum | cut -c1-32; }
md5_vps() { ssh_ "tr -d '\r' < $1 | md5sum | cut -c1-32"; }
ANON="$(grep -E '^VITE_SUPABASE_ANON_KEY=' .env | head -1 | cut -d= -f2- | tr -d '"\r')"

passo "0. O que está no ar é o que foi levantado?"
for t in "${TROCAS[@]}"; do
  IFS='|' read -r f arq h <<< "$t"
  noar="$(md5_vps "$FN/$f/$arq")"; novo="$(md5_local "supabase/$arq")"
  if [ "$noar" = "$novo" ]; then echo "   $f/$arq já é o novo"
  elif [ "$noar" = "$h" ]; then echo "   $f/$arq = levantado"
  else echo "   $f/$arq mudou no ar desde o levantamento ($noar): parando."; exit 1; fi
done
[ "$(md5_vps "$FN/entregar/index.ts")" = "762aeff5bd03f26d19f5c03bf491d245" ] && echo "   entregar = pacote de 05/11" || { echo "   entregar mudou no ar: parando."; exit 1; }

passo "1. Pacotes locais (pasta da VPS + arquivos novos) e teste no Deno"
PACOTE="$(mktemp -d)"; trap 'rm -rf "$PACOTE"' EXIT
for f in "${FUNCOES[@]}"; do
  scp -q -r -i "$CHAVE" "$VPS:$FN/$f" "$PACOTE/$f"
  for t in "${TROCAS[@]}"; do IFS='|' read -r g arq _ <<< "$t"; [ "$g" = "$f" ] && cp "supabase/$arq" "$PACOTE/$f/$arq"; done
done
node scripts/empacotar-entregar.mjs > /dev/null
mkdir -p "$PACOTE/entregar" && cp build/funcoes/entregar/index.ts build/funcoes/entregar/deno.json "$PACOTE/entregar/"
porta_livre() { node -e "require('net').connect(8000,'127.0.0.1').on('connect',()=>process.exit(1)).on('error',()=>process.exit(0))"; }
for f in "${FUNCOES[@]}" entregar; do
  for _ in $(seq 1 300); do porta_livre && break; sleep 1; done
  porta_livre || { echo "   porta 8000 ocupada há 5 min — pare e confira"; exit 1; }
  ( cd "$PACOTE/$f"
    SUPABASE_URL="https://$HOST" SUPABASE_ANON_KEY="$ANON" SUPABASE_SERVICE_ROLE_KEY=x PORT=0 \
      timeout 120 deno run --no-check -A --config deno.json index.ts > "$PACOTE/$f.log" 2>&1 & echo $! > "$PACOTE/$f.pid" )
  ok=false
  for _ in $(seq 1 90); do grep -q "Listening" "$PACOTE/$f.log" && { ok=true; break; }; sleep 1; done
  pid="$(cat "$PACOTE/$f.pid")"
  wpid="$(cat "/proc/$pid/winpid" 2>/dev/null || true)"
  [ -n "$wpid" ] && taskkill //F //T //PID "$wpid" >/dev/null 2>&1 || true
  pkill -P "$pid" 2>/dev/null || true; kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do porta_livre && break; sleep 1; done
  if $ok; then echo "   $f: carrega"; else echo "   $f NÃO carrega:"; tail -8 "$PACOTE/$f.log"; exit 1; fi
done

$EXEC || { echo; echo "Simulação ok. Rode com --executar para publicar."; exit 0; }

passo "2. Backups ($BKB, $BKF)"
ssh_ "set -e; mkdir -p $BKB $BKF
  C=\$(docker ps --format '{{.Names}}' | grep sb_rtkconverte_db | head -1)
  docker exec \$C pg_dump -U postgres -Fc postgres > $BKB/postgres.dump
  for f in ${FUNCOES[*]} entregar; do cp -a $FN/\$f $BKF/; done
  du -sh $BKB/postgres.dump; ls $BKF"

passo "3. Migração (transação única) + REST"
for m in "${MIGRACOES[@]}"; do
  n="$(basename "$m")"
  scp -q -i "$CHAVE" "$m" "$VPS:/tmp/$n" < /dev/null
  ssh_ "set -e; C=\$(docker ps --format '{{.Names}}' | grep sb_rtkconverte_db | head -1)
    docker cp /tmp/$n \$C:/tmp/$n
    docker exec \$C psql -U postgres -d postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/$n
    cp /tmp/$n $BKB/$n; docker exec \$C rm -f /tmp/$n; rm -f /tmp/$n
    docker exec \$C psql -U postgres -At -c \"select 'coluna calibracoes: '||count(*) from information_schema.columns where table_name='medicoes_campo' and column_name='calibracoes'\""
done
ssh_ "docker service update --force --quiet sb_rtkconverte_rest >/dev/null && echo '   REST reiniciado'"

passo "4. Troca dos arquivos + entregar"
for t in "${TROCAS[@]}"; do
  IFS='|' read -r f arq _ <<< "$t"
  scp -q -i "$CHAVE" "supabase/$arq" "$VPS:$FN/$f/$arq" < /dev/null
  [ "$(md5_vps "$FN/$f/$arq")" = "$(md5_local "supabase/$arq")" ] && echo "   $f/$arq ok" || { echo "   $f/$arq md5 diferente após a cópia!"; exit 1; }
done
scp -q -i "$CHAVE" build/funcoes/entregar/index.ts "$VPS:$FN/entregar/index.ts" < /dev/null
scp -q -i "$CHAVE" build/funcoes/entregar/deno.json "$VPS:$FN/entregar/deno.json" < /dev/null
[ "$(md5_vps "$FN/entregar/index.ts")" = "$(md5_local build/funcoes/entregar/index.ts)" ] && echo "   entregar ok" || { echo "   entregar md5 diferente!"; exit 1; }

passo "5. Reinício das funções"
ssh_ "docker service update --force --detach=false sb_rtkconverte_functions > /dev/null 2>&1; docker service ps sb_rtkconverte_functions --format '{{.CurrentState}}' | head -1"

passo "6. Fumaça (sem login: 401/400 = sobe; 503/500 BOOT = problema)"
sleep 15
for f in "${FUNCOES[@]}" entregar; do
  echo "   $f $(curl -s -o /dev/null -w '%{http_code}' -X POST "https://$HOST/functions/v1/$f" -H "apikey: $ANON" -H 'Content-Type: application/json' -d '{}')"
done
echo "   REST medicoes_campo.calibracoes: $(curl -s -o /dev/null -w '%{http_code}' "https://$HOST/rest/v1/medicoes_campo?select=calibracoes&limit=1" -H "apikey: $ANON" -H "Authorization: Bearer $ANON")"
echo; echo "Publicado. Backups: $BKB / $BKF"
