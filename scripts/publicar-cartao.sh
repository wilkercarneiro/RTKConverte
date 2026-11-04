#!/usr/bin/env bash
# Publica na VPS o CARTÃO DE CRÉDITO + COMPRA AUTOMÁTICA + WHATSAPP POR QR CODE:
#   - banco: migração 0037 (cobranca_cartoes, recarga_automatica, minha_cobranca
#     e meus_creditos com o cartão, reservar_recarga_automatica…);
#   - função `cobranca`: index.ts + fluxos.ts + _shared/{asaas,whatsapp,
#     mensagens_cobranca,precos}.ts e os NOVOS _shared/{cartao,cnpj}.ts.
#   O site sai depois, pelo push na main (Vercel): banco → função → push, sem
#   intervalo (o site novo chama ações que só a função nova conhece).
#
#   bash scripts/publicar-cartao.sh              # simulação (só lê a VPS)
#   bash scripts/publicar-cartao.sh --executar   # publica de verdade
#
# Antes de trocar: confere por md5 que a função no ar é a do commit base
# (81b1c20, igual ao repositório antes desta entrega) e roda a pasta nova no
# Deno até "Listening on".
set -euo pipefail
cd "$(dirname "$0")/.."

VPS="root@31.97.85.119"
CHAVE="$HOME/.ssh/orbit_vps"
BASE="/opt/supabase/rtkconverte"
FN="$BASE/volumes/functions/cobranca"
DATA="$(date +%Y%m%d-%H%M)"
BKF="$BASE/backup-funcoes-$DATA-cartao"
BKB="$BASE/backup-banco-$DATA-cartao"
MIG="supabase/migrations/0037_cartao_recarga_automatica.sql"
ANTES="81b1c20"
EXEC=false
[ "${1:-}" = "--executar" ] && EXEC=true

ssh_() { ssh -n -i "$CHAVE" -o ConnectTimeout=20 "$VPS" "$@"; }
passo() { echo; echo "==> $*"; }
md5_repo() { git show "$1:$2" | tr -d '\r' | md5sum | cut -c1-32; }
md5_local() { tr -d '\r' < "$1" | md5sum | cut -c1-32; }
md5_vps() { ssh_ "cat $1 2>/dev/null | tr -d '\r' | md5sum | cut -c1-32"; }

# no ar (relativo à pasta da função) : no repositório
ARQS=(
  "functions/cobranca/index.ts:supabase/functions/cobranca/index.ts"
  "functions/cobranca/fluxos.ts:supabase/functions/cobranca/fluxos.ts"
  "functions/_shared/asaas.ts:supabase/functions/_shared/asaas.ts"
  "functions/_shared/whatsapp.ts:supabase/functions/_shared/whatsapp.ts"
  "functions/_shared/mensagens_cobranca.ts:supabase/functions/_shared/mensagens_cobranca.ts"
  "functions/_shared/precos.ts:supabase/functions/_shared/precos.ts"
  "functions/_shared/cartao.ts:supabase/functions/_shared/cartao.ts"
  "functions/_shared/cnpj.ts:supabase/functions/_shared/cnpj.ts"
)

# ------------------------------------------------------------ 0. conferência
passo "0. A função no ar é a de $ANTES (ou já a nova)?"
for par in "${ARQS[@]}"; do
  r="${par%%:*}"; l="${par#*:}"
  noar="$(md5_vps "$FN/$r")"; novo="$(md5_local "$l")"
  esperado="$(git cat-file -e "$ANTES:$l" 2>/dev/null && md5_repo "$ANTES" "$l" || echo ausente)"
  vazio="$(printf '' | md5sum | cut -c1-32)"
  if [ "$noar" = "$novo" ]; then echo "   $r já é o novo"
  elif [ "$noar" = "$esperado" ]; then echo "   $r = $ANTES"
  elif [ "$noar" = "$vazio" ]; then echo "   $r: novo nesta função (não existe no ar)"
  else echo "   $r no ar ($noar) não é $ANTES ($esperado) nem o novo ($novo): parando."; exit 1; fi
done
ssh_ "DB=\$(docker ps -q -f name=sb_rtkconverte_db | head -1); docker exec \$DB psql -U postgres -d postgres -Atc \"select 'banco: 0037 ' || case when to_regclass('public.cobranca_cartoes') is null then 'ainda não aplicada' else 'já aplicada' end\""

# ------------------------------------------------------------ 0b. carga no Deno
passo "0b. A função carrega com os arquivos novos? (cópia local da pasta no ar)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
scp -q -r -i "$CHAVE" "$VPS:$FN" "$TMP/cobranca"
for par in "${ARQS[@]}"; do cp "${par#*:}" "$TMP/cobranca/${par%%:*}"; done
( cd "$TMP/cobranca" && SUPABASE_URL=http://x SUPABASE_ANON_KEY=x SUPABASE_SERVICE_ROLE_KEY=x timeout 90 deno run -A --no-check --no-lock --config deno.json index.ts > "$TMP/boot.log" 2>&1 ) || true
grep -q "Listening on" "$TMP/boot.log" && echo "   cobranca: carrega (Listening on)" || { echo "   cobranca NÃO carrega:"; sed 's/^/      /' "$TMP/boot.log" | head -20; exit 1; }

# ------------------------------------------------------------ 1. banco
passo "1. Banco: backup em $BKB e migração 0037 (uma transação)"
if $EXEC; then
  scp -q -i "$CHAVE" "$MIG" "$VPS:/tmp/0037.sql" < /dev/null
  ssh_ "set -e; mkdir -p $BKB; DB=\$(docker ps -q -f name=sb_rtkconverte_db | head -1)
    docker exec \$DB pg_dump -U postgres -d postgres -Fc -f /tmp/antes0037.dump; docker cp \$DB:/tmp/antes0037.dump $BKB/postgres.dump; docker exec \$DB rm -f /tmp/antes0037.dump
    cp /tmp/0037.sql $BKB/; docker cp /tmp/0037.sql \$DB:/tmp/0037.sql
    docker exec \$DB psql -U postgres -d postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0037.sql
    docker exec \$DB rm -f /tmp/0037.sql; rm -f /tmp/0037.sql
    echo '   0037 aplicada'; ls -la $BKB
    docker service update --force --quiet sb_rtkconverte_rest >/dev/null && echo '   REST reiniciado (funções novas no esquema)'"
else
  echo "   [simulação] pg_dump → $BKB/postgres.dump; psql -1 -f 0037; docker service update --force sb_rtkconverte_rest"
fi

# ------------------------------------------------------------ 2. função
passo "2. Função: backup em $BKF e troca dos arquivos"
if $EXEC; then
  ssh_ "set -e; mkdir -p $BKF; cp -a $FN $BKF/; ls $BKF"
  for par in "${ARQS[@]}"; do scp -q -i "$CHAVE" "${par#*:}" "$VPS:$FN/${par%%:*}" < /dev/null; done
  ssh_ "uptime; docker service update --force --quiet sb_rtkconverte_functions >/dev/null && echo '   funções reiniciadas'; uptime"
else
  for par in "${ARQS[@]}"; do echo "   [simulação] cobranca/${par%%:*}"; done
  echo "   [simulação] docker service update --force sb_rtkconverte_functions"
fi

# ------------------------------------------------------------ 3. conferência + fumaça
passo "3. md5 no ar = repositório, e fumaça"
if $EXEC; then
  for par in "${ARQS[@]}"; do
    [ "$(md5_vps "$FN/${par%%:*}")" = "$(md5_local "${par#*:}")" ] && echo "   ${par%%:*} = repo" || { echo "   ${par%%:*} DIFERENTE do repo"; exit 1; }
  done
  sleep 20
  ANON="$(grep -E '^VITE_SUPABASE_ANON_KEY=' .env | cut -d= -f2- | tr -d '"\r')"
  URL="https://utxqkbgfgpbczqjtieyu.supabase.agenteselevex.top"
  printf '   cobranca sem login (espera 401 "Sessão inválida") '
  node -e "fetch('$URL/functions/v1/cobranca',{method:'POST',headers:{apikey:'$ANON',Authorization:'Bearer $ANON','Content-Type':'application/json'},body:JSON.stringify({acao:'whatsapp_qrcode'})}).then(async r=>console.log(r.status,(await r.text()).slice(0,120)))"
  printf '   REST: minha_cobranca para o anônimo (espera 401/403/permissão negada) '
  node -e "fetch('$URL/rest/v1/rpc/minha_cobranca',{method:'POST',headers:{apikey:'$ANON',Authorization:'Bearer $ANON','Content-Type':'application/json'},body:'{}'}).then(async r=>console.log(r.status,(await r.text()).slice(0,120)))"
  printf '   REST: cobranca_cartoes para o anônimo (espera negado) '
  node -e "fetch('$URL/rest/v1/cobranca_cartoes?select=*',{headers:{apikey:'$ANON',Authorization:'Bearer $ANON'}}).then(async r=>console.log(r.status,(await r.text()).slice(0,120)))"
  echo; echo "Publicado. Backups: $BKB e $BKF"
  echo "Volta atrás da função: ssh … 'rm -rf $FN && cp -a $BKF/cobranca $FN && docker service update --force sb_rtkconverte_functions'"
  echo "Volta atrás do banco: pg_restore do $BKB/postgres.dump (perde o que entrou depois)"
else
  echo; echo "Simulação concluída. Rode com --executar para publicar."
fi
