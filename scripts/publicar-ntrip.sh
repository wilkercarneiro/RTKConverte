#!/usr/bin/env bash
# Publica na VPS a função NOVA ntrip (repasse da correção RTK para o receptor
# do Medir no campo — supabase/functions/ntrip, cliente em src/lib/campo/ntrip.ts):
#   - pasta da função com o shim, deno.json e o fecho de imports
#     (scripts/fecho-imports.mjs: index.ts, rede.ts, _shared/acesso.ts, _shared/limite.ts),
#     testada no Deno daqui ("Listening") antes de ir;
#   - mapas de ambiente FUNCTIONS_IMPORT_MAPS / FUNCTIONS_VERIFY_JWT_MAP com
#     "ntrip" e verify FALSE: o WebSocket do navegador não manda Authorization; a
#     função confere o login ela mesma (token da query no WS, cabeçalho no POST);
#   - sem migração, sem segredo novo (usa SUPABASE_URL/ANON/SERVICE_ROLE que o
#     serviço já tem). Opcional: NTRIP_IPS_BLOQUEADOS (IPs públicos proibidos
#     além da própria VPS) — não é posto aqui;
#   - fumaça: POST sem login → 401 do código; WebSocket sem login → abre e
#     recebe {"tipo":"erro","codigo":"sessao"} (prova que Traefik + Kong + runtime
#     deixam passar o upgrade); WebSocket com destino interno → recusado.
#
# ANTES de --executar, conferir na VPS (não automatizado aqui):
#   - o tempo máximo de um worker no main/index.ts do edge-runtime
#     (workerTimeoutMs; o modelo do Supabase usa 5 min). A sessão NTRIP dura
#     horas: com 5 min, a correção cai a cada 5 min e o navegador religa
#     sozinho (espera de 1 s), mas o receptor perde o RTK fixo por alguns
#     segundos. O certo é subir o limite para a ntrip.
#   - o timeout de inatividade do Traefik/Kong para WebSocket.
#
#   bash scripts/publicar-ntrip.sh              # simulação (padrão): monta e testa tudo aqui, não escreve na VPS
#   bash scripts/publicar-ntrip.sh --executar   # publica de verdade (só com o aval do Wilker)
set -euo pipefail
cd "$(dirname "$0")/.."

VPS="root@31.97.85.119"
CHAVE="$HOME/.ssh/orbit_vps"
BASE="/opt/supabase/rtkconverte"
FN="$BASE/volumes/functions"
DATA="$(date +%Y%m%d-%H%M)"
BKF="$BASE/backup-funcoes-$DATA-ntrip"
HOST="utxqkbgfgpbczqjtieyu.supabase.agenteselevex.top"
NOVA="ntrip"
EXEC=false
[ "${1:-}" = "--executar" ] && EXEC=true

ssh_() { ssh -n -i "$CHAVE" -o ConnectTimeout=20 "$VPS" "$@"; }
passo() { echo; echo "==> $*"; }
ANON="$( { grep -E '^VITE_SUPABASE_ANON_KEY=' .env 2>/dev/null || true; } | head -1 | cut -d= -f2- | tr -d '"\r')"

if $EXEC && [ -z "$ANON" ]; then
  echo "PAREI: VITE_SUPABASE_ANON_KEY vazia — não há .env em $(pwd)."
  echo "Rode a partir de D:/RTKConverte, que tem o .env:  cd D:/RTKConverte && bash scripts/publicar-ntrip.sh --executar"
  exit 1
fi
[ -z "$ANON" ] && echo "(aviso: sem VITE_SUPABASE_ANON_KEY no .env daqui — em --executar o script para)"

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
  ( cd "$P" && deno check --config deno.json index.ts >/dev/null ) && echo "   deno check: ok" || { echo "   deno check FALHOU"; exit 1; }
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
RESUMO() { grep -E "^# (tests|pass|fail|skipped) " "$PACOTE/testes.log" | sed 's/^# //' | paste -sd' ' -; }
if node --test --test-reporter=tap tests/*.test.mjs >"$PACOTE/testes.log" 2>&1; then
  echo "   testes: tudo passou ($(RESUMO))"
else
  echo "   testes FALHARAM ($(RESUMO)):"
  grep -E "^ *not ok " "$PACOTE/testes.log" | sed -E 's/^ */   /' | head -20
  exit 1
fi

# ------------------------------------------------------------ 3. backup
passo "3. Backup dos mapas de ambiente ($BKF)"
if $EXEC; then
  ssh_ "set -e; mkdir -p $BKF
    docker service inspect sb_rtkconverte_functions --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' | grep -E '^FUNCTIONS_(IMPORT_MAPS|VERIFY_JWT_MAP)=' > $BKF/env-maps-antes.txt
    [ -d $FN/$NOVA ] && cp -a $FN/$NOVA $BKF/ || true
    ls -la $BKF"
else
  echo "   [simulação] guarda FUNCTIONS_IMPORT_MAPS/FUNCTIONS_VERIFY_JWT_MAP de agora (e a pasta $FN/$NOVA, se existir) em $BKF"
fi

# ------------------------------------------------------------ 4. função nova + mapas
passo "4. Função $NOVA (pasta nova) e mapas de ambiente"
if $EXEC; then
  tar -C "$PACOTE" -czf "$PACOTE.tgz" "$NOVA"
  scp -q -i "$CHAVE" "$PACOTE.tgz" "$VPS:/tmp/ntrip-funcao.tgz"
  ssh_ "set -e; rm -rf /tmp/ntrip-funcao && mkdir -p /tmp/ntrip-funcao && tar -xzf /tmp/ntrip-funcao.tgz -C /tmp/ntrip-funcao
    rm -rf $FN/$NOVA && cp -a /tmp/ntrip-funcao/$NOVA $FN/$NOVA
    rm -rf /tmp/ntrip-funcao /tmp/ntrip-funcao.tgz
    find $FN/$NOVA -type f | sort"
  for arq in $(cd "$P" && find . -type f | sed 's#^\./##'); do
    a="$(ssh_ "tr -d '\r' < $FN/$NOVA/$arq | md5sum | cut -c1-32")"; b="$(tr -d '\r' < "$P/$arq" | md5sum | cut -c1-32)"
    [ "$a" = "$b" ] && echo "   $arq: md5 ok" || { echo "   $arq: md5 DIFERENTE"; exit 1; }
  done
  ssh_ "python3 - <<'PY' > /tmp/env-ntrip.txt
import json, subprocess
env = subprocess.check_output(['docker','service','inspect','sb_rtkconverte_functions','--format','{{json .Spec.TaskTemplate.ContainerSpec.Env}}']).decode()
env = dict(e.split('=',1) for e in json.loads(env))
imp = json.loads(env['FUNCTIONS_IMPORT_MAPS']); jwt = json.loads(env['FUNCTIONS_VERIFY_JWT_MAP'])
imp['$NOVA'] = '/home/deno/functions/$NOVA/deno.json'; jwt['$NOVA'] = False
print('FUNCTIONS_IMPORT_MAPS=' + json.dumps(imp, separators=(',',':')))
print('FUNCTIONS_VERIFY_JWT_MAP=' + json.dumps(jwt, separators=(',',':')))
PY
  chmod 600 /tmp/env-ntrip.txt"
  ssh_ "set -e; ARGS=''; while IFS= read -r l; do ARGS=\"\$ARGS --env-add \$(printf %q \"\$l\")\"; done < /tmp/env-ntrip.txt
    eval docker service update --quiet \$ARGS sb_rtkconverte_functions >/dev/null && echo 'funções reiniciadas (com os mapas novos)'
    rm -f /tmp/env-ntrip.txt
    uptime"
  rm -f "$PACOTE.tgz"
else
  echo "   [simulação] copia a pasta acima para $FN/$NOVA, confere o md5 de cada arquivo,"
  echo "   [simulação] FUNCTIONS_IMPORT_MAPS += $NOVA, FUNCTIONS_VERIFY_JWT_MAP += $NOVA: false, e reinicia sb_rtkconverte_functions"
fi

# ------------------------------------------------------------ 5. fumaça
passo "5. Fumaça"
if $EXEC; then
  sleep 20
  node - "$HOST" "$ANON" <<'JS'
const [host, anon] = process.argv.slice(2);
const U = `https://${host}/functions/v1/ntrip`;
try {
  const r = await fetch(U, { method: "POST", headers: { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" }, body: JSON.stringify({ acao: "tabela", host: "gps-ntrip.ibge.gov.br", porta: 2101 }) });
  console.log(`   ntrip tabela sem login (401)          ${r.status} ${(await r.text()).slice(0, 100)}`);
} catch (e) { console.log(`   ntrip tabela ERRO ${e.message}`); }
const ws = (rotulo) => new Promise((res) => {
  const w = new WebSocket(`wss://${host}/functions/v1/ntrip?access_token=invalido&apikey=${encodeURIComponent(anon)}`);
  const msgs = [];
  w.onopen = () => w.send(JSON.stringify({ tipo: "abrir", host: "gps-ntrip.ibge.gov.br", porta: 2101, montagem: "BRAZ1" }));
  w.onmessage = (e) => msgs.push(String(e.data));
  w.onclose = (e) => { console.log(`   ${rotulo.padEnd(38)} fechou ${e.code} ${msgs.join(" ").slice(0, 140)}`); res(); };
  setTimeout(() => w.close(), 15000);
});
await ws("ntrip WebSocket sem login (sessao)");
JS
else
  echo "   [simulação] POST sem login → 401 \"Sessão inválida\" (do código, não 503 BOOT_ERROR);"
  echo "   [simulação] WebSocket sem login → abre e recebe {\"tipo\":\"erro\",…,\"codigo\":\"sessao\"} (o upgrade passa por Traefik + Kong)"
fi
echo; $EXEC && echo "Publicado. Backup: $BKF. A tela do Campo usa a função quando a integração for para o site." || echo "Simulação concluída. Rode com --executar para publicar (só com o aval do Wilker)."
