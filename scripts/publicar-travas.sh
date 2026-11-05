#!/usr/bin/env bash
# Publica na VPS as TRAVAS da reanálise de 04/11/2026 (itens 2, 3, 4 e 5):
#   2. login (GoTrue): senha mínima 8 com letras e números; /token limitado a
#      60 por 5 min por IP (era 150). O IP não é falsificável: o Traefik descarta
#      o X-Forwarded-For do cliente (conferido em 04/11).
#   3. gateway: limite por IP no Traefik para a API do sb_rtkconverte
#      (middleware rtk-limite-api@file: 40 req/s, rajada de 200).
#   4. banco: migração 0039 (contorno assinado: 1 crédito = 1 imóvel) +
#      gerar-documentos, gerar-planta e gerar-pecas conferindo o contorno
#      (index.ts + _shared/contorno.ts novo).
#   5. função NOVA `entregar` (pacote único, scripts/empacotar-entregar.mjs):
#      os arquivos do CAR e do loteamento passam a sair do servidor.
#   + stack.json sincronizado com o que roda (funções, auth, rótulos do gateway)
#     — ele estava sem os mapas de cobranca/equipe/gprol/ler-arquivo/superadmin.
#   O site (telas que pedem os arquivos ao servidor + painel do superadmin) sai
#   pelo push na main DEPOIS deste script (a tela nova chama `entregar`).
#
#   bash scripts/publicar-travas.sh              # simulação: lê a VPS e testa as funções localmente
#   bash scripts/publicar-travas.sh --executar   # publica de verdade
set -euo pipefail
cd "$(dirname "$0")/.."

VPS="root@31.97.85.119"
CHAVE="$HOME/.ssh/orbit_vps"
BASE="/opt/supabase/rtkconverte"
FN="$BASE/volumes/functions"
DATA="$(date +%Y%m%d-%H%M)"
BKF="$BASE/backup-funcoes-$DATA-travas"
BKB="$BASE/backup-banco-$DATA-travas"
MIG="supabase/migrations/0039_contorno_assinado.sql"
ANTES="1cf4e06"
HOST="utxqkbgfgpbczqjtieyu.supabase.agenteselevex.top"
TRAEFIK_ARQ="/etc/traefik/dynamic/rtkconverte-limite.yml"
GERADORAS=(gerar-documentos gerar-planta gerar-pecas)
EXEC=false
[ "${1:-}" = "--executar" ] && EXEC=true

ssh_() { ssh -n -i "$CHAVE" -o ConnectTimeout=20 "$VPS" "$@"; }
ssh_in() { ssh -i "$CHAVE" -o ConnectTimeout=20 "$VPS" "$@"; }
passo() { echo; echo "==> $*"; }
roda() { if $EXEC; then "$@"; else echo "   [simulação] $*"; fi; }
md5_repo() { { git show "$1:$2" 2>/dev/null || true; } | tr -d '\r' | md5sum | cut -c1-32; }
md5_local() { tr -d '\r' < "$1" | md5sum | cut -c1-32; }
ANON="$(grep -E '^VITE_SUPABASE_ANON_KEY=' .env | head -1 | cut -d= -f2- | tr -d '"\r')"

# ------------------------------------------------------------ 0. conferência
passo "0. As geradoras no ar são o $ANTES?"
for f in "${GERADORAS[@]}"; do
  noar="$(ssh_ "tr -d '\r' < $FN/$f/functions/$f/index.ts | md5sum | cut -c1-32")"
  rep="$(md5_repo "$ANTES" "supabase/functions/$f/index.ts")"
  novo="$(md5_local "supabase/functions/$f/index.ts")"
  if [ "$noar" = "$rep" ]; then echo "   $f: no ar = $ANTES (ok)"
  elif [ "$noar" = "$novo" ]; then echo "   $f: já é o novo"
  else echo "   $f: no ar é OUTRO código ($noar) — pare e confira"; exit 1; fi
done
ssh_ "test -e $FN/entregar && echo '   entregar: já existe no ar' || echo '   entregar: nova'"

# ------------------------------------------------------------ pacote local
passo "Pacote local: entregar (esbuild) + geradoras com contorno.ts"
node scripts/empacotar-entregar.mjs
PACOTE="$(mktemp -d)"
trap 'rm -rf "$PACOTE"' EXIT
mkdir -p "$PACOTE/entregar" && cp build/funcoes/entregar/index.ts build/funcoes/entregar/deno.json "$PACOTE/entregar/"
# as geradoras como estão no ar, com os arquivos novos por cima — e cada uma tem
# de subir no Deno daqui (a armadilha dos stubs do gerar-pecas, 01/11)
for f in "${GERADORAS[@]}"; do
  scp -q -r -i "$CHAVE" "$VPS:$FN/$f" "$PACOTE/$f"
  cp "supabase/functions/$f/index.ts" "$PACOTE/$f/functions/$f/index.ts"
  cp supabase/functions/_shared/contorno.ts "$PACOTE/$f/functions/_shared/contorno.ts"
done
for f in "${GERADORAS[@]}" entregar; do
  ( cd "$PACOTE/$f"
    SUPABASE_URL="https://$HOST" SUPABASE_ANON_KEY="$ANON" SUPABASE_SERVICE_ROLE_KEY=x PORT=0 \
      timeout 120 deno run --no-check -A --config deno.json index.ts > "$PACOTE/$f.log" 2>&1 & echo $! > "$PACOTE/$f.pid" )
  ok=false
  for _ in $(seq 1 90); do grep -q "Listening" "$PACOTE/$f.log" && { ok=true; break; }; sleep 1; done
  # só o Deno que este passo abriu (o processo e os filhos dele)
  pid="$(cat "$PACOTE/$f.pid")"; pkill -P "$pid" 2>/dev/null || true; kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do node -e "require('net').connect(8000,'127.0.0.1').on('connect',()=>process.exit(1)).on('error',()=>process.exit(0))" && break; sleep 1; done
  if $ok; then echo "   $f: sobe no Deno (Listening)"; else echo "   $f: NÃO subiu:"; tail -5 "$PACOTE/$f.log"; exit 1; fi
done

# ------------------------------------------------------------ 1. backups
passo "1. Backups ($BKB, $BKF)"
roda ssh_ "set -e; mkdir -p $BKB $BKF
  C=\$(docker ps --format '{{.Names}}' | grep sb_rtkconverte_db | head -1)
  docker exec \$C pg_dump -U postgres -Fc postgres > $BKB/postgres.dump
  cp -a $FN/gerar-documentos $FN/gerar-planta $FN/gerar-pecas $BKF/
  cp -a $BASE/stack.json $BKF/stack.json
  docker service inspect sb_rtkconverte_functions --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' | grep -E '^FUNCTIONS_(IMPORT_MAPS|VERIFY_JWT_MAP)=' > $BKF/env-maps-antes.txt
  docker service inspect sb_rtkconverte_auth --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' | grep -E '^GOTRUE_(PASSWORD|RATE_LIMIT)' > $BKF/auth-antes.txt
  docker service inspect sb_rtkconverte_api-gw --format '{{json .Spec.Labels}}' > $BKF/api-gw-labels-antes.json
  chmod 600 $BKF/stack.json
  ls -la $BKB $BKF"

# ------------------------------------------------------------ 2. migração
passo "2. Migração 0039 (transação única) + REST"
roda scp -q -i "$CHAVE" "$MIG" "$VPS:/tmp/0039.sql"
roda ssh_ "set -e; C=\$(docker ps --format '{{.Names}}' | grep sb_rtkconverte_db | head -1)
  docker cp /tmp/0039.sql \$C:/tmp/0039.sql
  docker exec \$C psql -U postgres -d postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0039.sql
  docker exec \$C rm -f /tmp/0039.sql; rm -f /tmp/0039.sql
  docker exec \$C psql -U postgres -tAc \"select 'tabela ' || coalesce(to_regclass('public.servicos_contorno')::text, 'FALTA')\"
  docker service update --force --quiet sb_rtkconverte_rest >/dev/null && echo 'REST reiniciado'"

# ------------------------------------------------------------ 3. funções
passo "3. Geradoras (index.ts + _shared/contorno.ts) e entregar (nova)"
roda tar -C "$PACOTE" -czf "$PACOTE.tgz" entregar gerar-documentos gerar-planta gerar-pecas
roda scp -q -i "$CHAVE" "$PACOTE.tgz" "$VPS:/tmp/travas-funcoes.tgz"
roda ssh_ "set -e; rm -rf /tmp/travas-funcoes && mkdir -p /tmp/travas-funcoes && tar -xzf /tmp/travas-funcoes.tgz -C /tmp/travas-funcoes
  for f in gerar-documentos gerar-planta gerar-pecas; do
    cp /tmp/travas-funcoes/\$f/functions/\$f/index.ts $FN/\$f/functions/\$f/index.ts
    cp /tmp/travas-funcoes/\$f/functions/_shared/contorno.ts $FN/\$f/functions/_shared/contorno.ts
  done
  rm -rf $FN/entregar && cp -a /tmp/travas-funcoes/entregar $FN/entregar
  rm -rf /tmp/travas-funcoes /tmp/travas-funcoes.tgz
  find $FN/entregar -type f | xargs ls -la"
rm -f "$PACOTE.tgz"
if $EXEC; then
  for f in "${GERADORAS[@]}"; do
    a="$(ssh_ "tr -d '\r' < $FN/$f/functions/$f/index.ts | md5sum | cut -c1-32")"; b="$(md5_local "supabase/functions/$f/index.ts")"
    c="$(ssh_ "tr -d '\r' < $FN/$f/functions/_shared/contorno.ts | md5sum | cut -c1-32")"; d="$(md5_local supabase/functions/_shared/contorno.ts)"
    [ "$a" = "$b" ] && [ "$c" = "$d" ] && echo "   $f: md5 = repo" || { echo "   $f: md5 DIFERENTE"; exit 1; }
  done
fi

# ------------------------------------------------------------ 4. mapas + reinício das funções
passo "4. Mapas de ambiente com entregar (verify_jwt) e reinício das funções"
if $EXEC; then
  ssh_in "python3 - > /tmp/env-travas.txt" <<'PY'
import json, subprocess
env = subprocess.check_output(['docker','service','inspect','sb_rtkconverte_functions','--format','{{json .Spec.TaskTemplate.ContainerSpec.Env}}']).decode()
env = dict(e.split('=',1) for e in json.loads(env))
imp = json.loads(env['FUNCTIONS_IMPORT_MAPS']); jwt = json.loads(env['FUNCTIONS_VERIFY_JWT_MAP'])
imp['entregar'] = '/home/deno/functions/entregar/deno.json'; jwt['entregar'] = True
print('FUNCTIONS_IMPORT_MAPS=' + json.dumps(imp, separators=(',',':')))
print('FUNCTIONS_VERIFY_JWT_MAP=' + json.dumps(jwt, separators=(',',':')))
PY
  ssh_ "set -e; chmod 600 /tmp/env-travas.txt; ARGS=''; while IFS= read -r l; do ARGS=\"\$ARGS --env-add \$(printf %q \"\$l\")\"; done < /tmp/env-travas.txt
    eval docker service update --quiet --force \$ARGS sb_rtkconverte_functions >/dev/null && echo 'funções reiniciadas (mapas com entregar)'
    rm -f /tmp/env-travas.txt; uptime"
else
  echo "   [simulação] FUNCTIONS_IMPORT_MAPS/FUNCTIONS_VERIFY_JWT_MAP += entregar; docker service update --force sb_rtkconverte_functions"
fi

# ------------------------------------------------------------ 5. login (GoTrue)
passo "5. GoTrue: senha mínima 8 com letras e números; /token 60 por 5 min por IP"
roda ssh_ "set -e; docker service update --quiet \
    --env-add GOTRUE_PASSWORD_MIN_LENGTH=8 \
    --env-add GOTRUE_PASSWORD_REQUIRED_CHARACTERS=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789 \
    --env-add GOTRUE_RATE_LIMIT_TOKEN_REFRESH=60 \
    sb_rtkconverte_auth >/dev/null && echo 'auth reiniciado'"

# ------------------------------------------------------------ 6. gateway (Traefik)
passo "6. Limite por IP na API (Traefik, $TRAEFIK_ARQ)"
if $EXEC; then
  ssh_in "cat > $TRAEFIK_ARQ" <<'YML'
# Limite por IP da API do RTKConverte/Vertces (sb_rtkconverte), auditoria 04/11/2026.
# O Traefik publica as portas em modo host: o IP de origem é o do cliente.
# Usado pelo rótulo traefik.http.routers.sb-rtkconverte-api.middlewares do
# serviço sb_rtkconverte_api-gw. Apagar este arquivo SEM tirar o rótulo derruba
# a API (middleware inexistente): tire o rótulo primeiro.
http:
  middlewares:
    rtk-limite-api:
      rateLimit:
        average: 40
        period: 1s
        burst: 200
YML
  sleep 5
  ssh_ "set -e; docker service update --quiet --label-add traefik.http.routers.sb-rtkconverte-api.middlewares=rtk-limite-api@file sb_rtkconverte_api-gw >/dev/null && echo 'rótulo do limite no gateway'"
  sleep 15
  st="$(node -e "fetch('https://$HOST/rest/v1/servicos?select=id&limit=1',{headers:{apikey:'$ANON',Authorization:'Bearer $ANON'}}).then(r=>console.log(r.status)).catch(()=>console.log('ERRO'))")"
  if [ "$st" != "200" ]; then
    echo "   API respondeu $st depois do limite — desfazendo o rótulo"
    ssh_ "docker service update --quiet --label-rm traefik.http.routers.sb-rtkconverte-api.middlewares sb_rtkconverte_api-gw >/dev/null"
    exit 1
  fi
  echo "   API ok (200) com o limite"
else
  echo "   [simulação] escreve $TRAEFIK_ARQ (rtk-limite-api: 40/s, rajada 200) + rótulo no sb-rtkconverte-api; confere a API e desfaz se não responder 200"
fi

# ------------------------------------------------------------ 7. stack.json = o que roda
passo "7. stack.json sincronizado com o que roda (functions/auth env, rótulos do api-gw)"
if $EXEC; then
  ssh_in "python3 - $BASE/stack.json" <<'PY'
import json, subprocess, sys
p = sys.argv[1]; s = json.load(open(p))
def env(svc):
    e = json.loads(subprocess.check_output(['docker','service','inspect',svc,'--format','{{json .Spec.TaskTemplate.ContainerSpec.Env}}']).decode())
    return dict(x.split('=',1) for x in e)
def labels(svc):
    return json.loads(subprocess.check_output(['docker','service','inspect',svc,'--format','{{json .Spec.Labels}}']).decode())
s['services']['functions']['environment'] = env('sb_rtkconverte_functions')
s['services']['auth']['environment'] = env('sb_rtkconverte_auth')
s['services']['api-gw'].setdefault('deploy', {})['labels'] = {k: v for k, v in labels('sb_rtkconverte_api-gw').items() if not k.startswith('com.docker.stack.')}
json.dump(s, open(p, 'w'), indent=1)
print('stack.json atualizado')
PY
  ssh_ "chmod 600 $BASE/stack.json"
else
  echo "   [simulação] stack.json ← env de functions/auth e rótulos do api-gw que estão rodando"
fi

# ------------------------------------------------------------ 8. fumaça
passo "8. Fumaça"
if $EXEC; then
  sleep 20
  node - "$HOST" "$ANON" <<'JS'
const [host, anon] = process.argv.slice(2);
const U = `https://${host}`;
const h = { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" };
const t = async (n, url, o = {}) => { try { const r = await fetch(url, { headers: h, ...o }); console.log(`   ${n.padEnd(34)} ${r.status} ${(await r.text()).slice(0, 90)}`); } catch (e) { console.log(`   ${n} ERRO ${e.message}`); } };
await t("REST anônimo", `${U}/rest/v1/servicos?select=id&limit=1`);
await t("conferir_contorno anônimo", `${U}/rest/v1/rpc/conferir_contorno`, { method: "POST", body: JSON.stringify({ p_servico: "00000000-0000-0000-0000-000000000000", p_geojson: {} }) });
await t("servicos_contorno anônimo", `${U}/rest/v1/servicos_contorno?select=*`);
for (const f of ["entregar", "gerar-documentos", "gerar-planta", "gerar-pecas"])
  await t(`fn ${f} sem login`, `${U}/functions/v1/${f}`, { method: "POST", body: JSON.stringify({ servico_id: "00000000-0000-0000-0000-000000000000", saida: "planta" }) });
await t("auth settings", `${U}/auth/v1/settings`);
// rajada de 300 pedidos de um IP só: o limite tem de responder 429 em parte deles
const rs = await Promise.all(Array.from({ length: 300 }, () => fetch(`${U}/auth/v1/health`, { headers: h }).then((r) => r.status).catch(() => 0)));
const c = rs.reduce((m, s) => (m[s] = (m[s] ?? 0) + 1, m), {});
console.log(`   rajada de 300 em /auth/v1/health: ${JSON.stringify(c)} (esperado: parte em 429)`);
JS
else
  echo "   [simulação] REST 200; conferir_contorno/servicos_contorno negados; funções 401; rajada de 300 → parte 429"
fi
echo; $EXEC && echo "Publicado. Backups: $BKB / $BKF. Agora: push da main (site)." || echo "Simulação concluída. Rode com --executar para publicar."
