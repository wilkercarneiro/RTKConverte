#!/usr/bin/env bash
# Publica na VPS as FERRAMENTAS (plano docs/plano-ferramentas-campo-consulta-terraplanagem.md):
#   - banco: *_analises_imovel (0045), *_terraplanagens (0046) e *_medicoes_campo
#     (0047) — achadas pelo NOME, as que existirem no repositório; a que já está
#     na VPS (a tabela existe) é recusada; cada uma numa transação, REST
#     reiniciado DEPOIS de todas;
#   - função NOVA analise-imovel (focos do INPE e laudo por IA): pasta com o
#     shim, deno.json e o fecho de imports (scripts/fecho-imports.mjs), testada
#     no Deno daqui ("Listening") antes de ir;
#   - mapas de ambiente FUNCTIONS_IMPORT_MAPS / FUNCTIONS_VERIFY_JWT_MAP com
#     "analise-imovel" (verify true) — sem isso a função nova cai no deno.jsonc da
#     raiz, sem supabase-js (memória rtkconverte-saas). A OPENAI_API_KEY já está
#     no serviço desde a leitura universal (01/11): não é tocada;
#   - fumaça: a função nova responde pelo próprio código (401 sem login) e as
#     tabelas novas existem no REST.
#   O site sai pelo push da main DEPOIS deste script (as telas chamam a função
#   e as tabelas novas).
#
#   bash scripts/publicar-ferramentas.sh              # simulação (padrão): monta e testa tudo aqui, não escreve na VPS
#   bash scripts/publicar-ferramentas.sh --executar   # publica de verdade (só com o aval do Wilker)
set -euo pipefail
cd "$(dirname "$0")/.."

VPS="root@31.97.85.119"
CHAVE="$HOME/.ssh/orbit_vps"
BASE="/opt/supabase/rtkconverte"
FN="$BASE/volumes/functions"
DATA="$(date +%Y%m%d-%H%M)"
BKF="$BASE/backup-funcoes-$DATA-ferramentas"
BKB="$BASE/backup-banco-$DATA-ferramentas"
HOST="utxqkbgfgpbczqjtieyu.supabase.agenteselevex.top"
NOVA="analise-imovel"
EXEC=false
[ "${1:-}" = "--executar" ] && EXEC=true

ssh_() { ssh -n -i "$CHAVE" -o ConnectTimeout=20 "$VPS" "$@"; }
passo() { echo; echo "==> $*"; }
roda() { if $EXEC; then "$@"; else echo "   [simulação] $*"; fi; }
ANON="$( { grep -E '^VITE_SUPABASE_ANON_KEY=' .env 2>/dev/null || true; } | head -1 | cut -d= -f2- | tr -d '"\r')"

# pelo NOME, não pelo número: a numeração do plano (0044–0046) não vale mais — a 0044 da main é a
# adesão (já publicada em 06/11) e o Campo virou 0047. Cada nome é também a tabela que a migração cria:
# se ela já existe na VPS, a migração é recusada (não reaplica nada que já está no ar).
FERRAMENTAS=(analises_imovel terraplanagens medicoes_campo)
MIGRACOES=()
for t in "${FERRAMENTAS[@]}"; do
  for m in supabase/migrations/[0-9][0-9][0-9][0-9]_"$t".sql; do
    [ -f "$m" ] && MIGRACOES+=("$m")
  done
done

# ------------------------------------------------------------ 0. o que vai
passo "0. O que vai"
for m in "${MIGRACOES[@]}"; do echo "   migração: $m"; done
[ "${#MIGRACOES[@]}" -eq 0 ] && echo "   (nenhuma migração das ferramentas no repositório: ${FERRAMENTAS[*]})"
echo "   função nova: $NOVA"

# ------------------------------------------------------------ 1. pacote local + Deno
passo "1. Monta a pasta da $NOVA (shim + deno.json + fecho de imports) e testa no Deno"
PACOTE="$(mktemp -d)"
trap 'rm -rf "$PACOTE"' EXIT
P="$PACOTE/$NOVA"
mkdir -p "$P/functions"
cp "supabase/functions/$NOVA/deno.json" "$P/deno.json"
printf '// Generated: the deployed entrypoint keeps its original location.\nimport "./functions/%s/index.ts";\n' "$NOVA" > "$P/index.ts"
while IFS= read -r arq; do
  [ -z "$arq" ] && continue
  destino="$P/functions/${arq#supabase/functions/}"
  mkdir -p "$(dirname "$destino")" && cp "$arq" "$destino"
done <<< "$(node scripts/fecho-imports.mjs "$NOVA" | grep -v '^#')"
cp "supabase/functions/$NOVA/deno.json" "$P/functions/$NOVA/deno.json"
(cd "$PACOTE" && find . -type f | sort | sed 's/^/   /')
if command -v deno >/dev/null; then
  ( cd "$P"
    SUPABASE_URL="https://$HOST" SUPABASE_ANON_KEY="${ANON:-x}" SUPABASE_SERVICE_ROLE_KEY=x PORT=0 \
      timeout 120 deno run --no-check -A --config deno.json index.ts > "$PACOTE/deno.log" 2>&1 & echo $! > "$PACOTE/deno.pid" )
  ok=false
  for _ in $(seq 1 90); do grep -q "Listening" "$PACOTE/deno.log" && { ok=true; break; }; sleep 1; done
  pid="$(cat "$PACOTE/deno.pid")"; pkill -P "$pid" 2>/dev/null || true; kill "$pid" 2>/dev/null || true
  if $ok; then echo "   $NOVA: sobe no Deno (Listening)"; else echo "   $NOVA: NÃO subiu:"; tail -12 "$PACOTE/deno.log"; exit 1; fi
else
  echo "   deno não instalado aqui: a função não foi testada — pare e instale antes de --executar"; $EXEC && exit 1
fi

# ------------------------------------------------------------ 2. testes
passo "2. Testes do repositório"
roda node --test tests/consulta.test.mjs

# ------------------------------------------------------------ 3. backups
passo "3. Backups ($BKB, $BKF)"
roda ssh_ "set -e; mkdir -p $BKB $BKF
  C=\$(docker ps --format '{{.Names}}' | grep sb_rtkconverte_db | head -1)
  docker exec \$C pg_dump -U postgres -Fc postgres > $BKB/postgres.dump
  docker service inspect sb_rtkconverte_functions --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' | grep -E '^FUNCTIONS_(IMPORT_MAPS|VERIFY_JWT_MAP)=' > $BKF/env-maps-antes.txt
  [ -d $FN/$NOVA ] && cp -a $FN/$NOVA $BKF/ || true
  ls -la $BKB $BKF"

# ------------------------------------------------------------ 4. migrações
passo "4. Migrações (cada uma em transação única) + REST"
for m in "${MIGRACOES[@]}"; do
  n="$(basename "$m")"
  tabela="$(basename "$m" .sql | sed -E 's/^[0-9]+_//')"
  if $EXEC; then
    ja="$(ssh_ "C=\$(docker ps --format '{{.Names}}' | grep sb_rtkconverte_db | head -1); docker exec \$C psql -U postgres -d postgres -tAc \"select to_regclass('public.$tabela') is not null\"" | tr -d '[:space:]')"
    if [ "$ja" = "t" ]; then echo "   RECUSADA: $n — a tabela $tabela já existe na VPS (já publicada); nada reaplicado"; continue; fi
    [ "$ja" = "f" ] || { echo "   não deu para conferir se $n já está na VPS (resposta: '$ja'): parei"; exit 1; }
  else
    echo "   [simulação] confere na VPS se a tabela $tabela já existe; se existir, recusa $n"
  fi
  roda scp -q -i "$CHAVE" "$m" "$VPS:/tmp/$n"
  roda ssh_ "set -e; C=\$(docker ps --format '{{.Names}}' | grep sb_rtkconverte_db | head -1)
    docker cp /tmp/$n \$C:/tmp/$n
    docker exec \$C psql -U postgres -d postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/$n
    cp /tmp/$n $BKB/$n
    docker exec \$C rm -f /tmp/$n; rm -f /tmp/$n
    echo 'aplicada: $n (cópia em $BKB)'"
done
roda ssh_ "docker service update --force --quiet sb_rtkconverte_rest >/dev/null && echo 'REST reiniciado'"

# ------------------------------------------------------------ 5. função nova + mapas
passo "5. Função $NOVA (pasta nova) e mapas de ambiente"
if $EXEC; then
  tar -C "$PACOTE" -czf "$PACOTE.tgz" "$NOVA"
  scp -q -i "$CHAVE" "$PACOTE.tgz" "$VPS:/tmp/ferramentas-funcao.tgz"
  ssh_ "set -e; rm -rf /tmp/ferramentas-funcao && mkdir -p /tmp/ferramentas-funcao && tar -xzf /tmp/ferramentas-funcao.tgz -C /tmp/ferramentas-funcao
    rm -rf $FN/$NOVA && cp -a /tmp/ferramentas-funcao/$NOVA $FN/$NOVA
    rm -rf /tmp/ferramentas-funcao /tmp/ferramentas-funcao.tgz
    find $FN/$NOVA -type f | sort"
  for arq in $(cd "$P" && find . -type f | sed 's#^\./##'); do
    a="$(ssh_ "tr -d '\r' < $FN/$NOVA/$arq | md5sum | cut -c1-32")"; b="$(tr -d '\r' < "$P/$arq" | md5sum | cut -c1-32)"
    [ "$a" = "$b" ] && echo "   $arq: md5 ok" || { echo "   $arq: md5 DIFERENTE"; exit 1; }
  done
  ssh_ "python3 - <<'PY' > /tmp/env-ferramentas.txt
import json, subprocess
env = subprocess.check_output(['docker','service','inspect','sb_rtkconverte_functions','--format','{{json .Spec.TaskTemplate.ContainerSpec.Env}}']).decode()
env = dict(e.split('=',1) for e in json.loads(env))
imp = json.loads(env['FUNCTIONS_IMPORT_MAPS']); jwt = json.loads(env['FUNCTIONS_VERIFY_JWT_MAP'])
imp['$NOVA'] = '/home/deno/functions/$NOVA/deno.json'; jwt['$NOVA'] = True
print('FUNCTIONS_IMPORT_MAPS=' + json.dumps(imp, separators=(',',':')))
print('FUNCTIONS_VERIFY_JWT_MAP=' + json.dumps(jwt, separators=(',',':')))
PY
  chmod 600 /tmp/env-ferramentas.txt"
  ssh_ "set -e; ARGS=''; while IFS= read -r l; do ARGS=\"\$ARGS --env-add \$(printf %q \"\$l\")\"; done < /tmp/env-ferramentas.txt
    eval docker service update --quiet \$ARGS sb_rtkconverte_functions >/dev/null && echo 'funções reiniciadas (com os mapas novos)'
    rm -f /tmp/env-ferramentas.txt
    uptime"
  rm -f "$PACOTE.tgz"
else
  echo "   [simulação] copia a pasta acima para $FN/$NOVA, confere o md5 de cada arquivo,"
  echo "   [simulação] FUNCTIONS_IMPORT_MAPS/FUNCTIONS_VERIFY_JWT_MAP += $NOVA (verify true) e reinicia sb_rtkconverte_functions"
fi

# ------------------------------------------------------------ 6. fumaça
passo "6. Fumaça"
if $EXEC; then
  sleep 20
  node - "$HOST" "$ANON" <<'JS'
const [host, anon] = process.argv.slice(2);
const U = `https://${host}`;
const h = { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" };
const t = async (n, url, o = {}) => { try { const r = await fetch(url, { headers: h, ...o }); console.log(`   ${n.padEnd(40)} ${r.status} ${(await r.text()).slice(0, 100)}`); } catch (e) { console.log(`   ${n} ERRO ${e.message}`); } };
await t("analise-imovel focos sem login (401)", `${U}/functions/v1/analise-imovel`, { method: "POST", body: JSON.stringify({ acao: "focos", caixa: [-41.3, -12.5, -41.1, -12.3], desde: "2026-01-01" }) });
await t("analise-imovel laudo sem login (401)", `${U}/functions/v1/analise-imovel`, { method: "POST", body: JSON.stringify({ acao: "laudo", analise_id: "00000000-0000-0000-0000-000000000000" }) });
await t("analises_imovel anônimo (vazio ou 401)", `${U}/rest/v1/analises_imovel?select=id&limit=1`);
await t("sigef_por_codigo anônimo (negado)", `${U}/rest/v1/rpc/sigef_por_codigo`, { method: "POST", body: JSON.stringify({ p_codigo: "8b68c253-6175-49b8-b3df-c3d602d22701" }) });
JS
else
  echo "   [simulação] analise-imovel sem login → 401 \"Sessão inválida\" (do código, não 503 BOOT_ERROR); analises_imovel anônimo → vazio/401; sigef_por_codigo anônimo → negado"
fi
echo; $EXEC && echo "Publicado. Backups: $BKB / $BKF. Agora: push da main (site)." || echo "Simulação concluída. Rode com --executar para publicar (só com o aval do Wilker)."
