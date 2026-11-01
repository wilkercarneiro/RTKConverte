#!/usr/bin/env bash
# Publica a LEITURA UNIVERSAL na VPS (Supabase self-host, stack sb_rtkconverte):
#   1. backup do banco (pg_dump -Fc) e das funções que mudam + mapas de ambiente
#   2. migração 0035 numa transação (psql -1, ON_ERROR_STOP) + REST reiniciado
#   3. funções: parse-txt e reunir-certificados trocadas; ler-arquivo NOVA
#      (pasta com shim, deno.json, functions/ler-arquivo e functions/_shared)
#   4. mapas FUNCTIONS_IMPORT_MAPS / FUNCTIONS_VERIFY_JWT_MAP ganham "ler-arquivo"
#      (+ OPENAI_API_KEY, se houver no .env local) e o serviço reinicia
#   5. fumaça: as três respondem pelo próprio código (401 "Sessão inválida")
#
# Os stubs memorial.ts/ods.ts de cada função NÃO são tocados.
# Uso:  bash scripts/publicar-leitura-universal.sh            (só mostra)
#       bash scripts/publicar-leitura-universal.sh --executar (publica)
set -euo pipefail
cd "$(dirname "$0")/.."

VPS="root@31.97.85.119"
CHAVE="$HOME/.ssh/orbit_vps"
BASE="/opt/supabase/rtkconverte"
FN="$BASE/volumes/functions"
DATA="$(date +%Y%m%d-%H%M)"
EXEC=false
[ "${1:-}" = "--executar" ] && EXEC=true

ssh_() { ssh -i "$CHAVE" -o ConnectTimeout=20 "$VPS" "$@"; }
passo() { echo; echo "==> $*"; }
roda() { if $EXEC; then "$@"; else echo "   [simulação] $*"; fi; }

# ---------------------------------------------------------------- pacote local
PACOTE="$(mktemp -d)"
trap 'rm -rf "$PACOTE"' EXIT
LEITOR=(abertura arquivo assinatura detector executor formatos ia index numeros ordem receita validador)
monta() { # monta <função> <arquivos de _shared...>
  local f="$1"; shift
  mkdir -p "$PACOTE/$f/functions/$f" "$PACOTE/$f/functions/_shared"
  cp "supabase/functions/$f/index.ts" "$PACOTE/$f/functions/$f/index.ts"
  cp "supabase/functions/$f/deno.json" "$PACOTE/$f/functions/$f/deno.json"
  cp "supabase/functions/$f/deno.json" "$PACOTE/$f/deno.json"
  printf '// Generated: the deployed entrypoint keeps its original location.\nimport "./functions/%s/index.ts";\n' "$f" > "$PACOTE/$f/index.ts"
  for s in "$@"; do cp "supabase/functions/_shared/$s" "$PACOTE/$f/functions/_shared/$s"; done
}
monta parse-txt servico.ts certificados.ts
monta reunir-certificados servico.ts certificados.ts
monta ler-arquivo geo.ts acesso.ts
for f in parse-txt ler-arquivo; do
  mkdir -p "$PACOTE/$f/functions/_shared/leitor"
  for m in "${LEITOR[@]}"; do cp "supabase/functions/_shared/leitor/$m.ts" "$PACOTE/$f/functions/_shared/leitor/$m.ts"; done
done
echo "Pacote montado em $PACOTE:"; (cd "$PACOTE" && find . -type f | sort | sed 's/^/   /')

# ---------------------------------------------------------------- 1. backups
passo "1. Backups em $BASE/backup-*-$DATA-leitura"
roda ssh_ "set -e; mkdir -p $BASE/backup-banco-$DATA-leitura $BASE/backup-funcoes-$DATA-leitura
  C=\$(docker ps --format '{{.Names}}' | grep sb_rtkconverte_db | head -1)
  docker exec \$C pg_dump -U postgres -Fc postgres > $BASE/backup-banco-$DATA-leitura/postgres.dump
  cp -a $FN/parse-txt $FN/reunir-certificados $BASE/backup-funcoes-$DATA-leitura/
  docker service inspect sb_rtkconverte_functions --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' | grep -E '^FUNCTIONS_(IMPORT_MAPS|VERIFY_JWT_MAP)=' > $BASE/backup-funcoes-$DATA-leitura/env-maps-antes.txt
  ls -la $BASE/backup-banco-$DATA-leitura $BASE/backup-funcoes-$DATA-leitura"

# ---------------------------------------------------------------- 2. migração
passo "2. Migração 0035 (transação única) + REST"
roda scp -q -i "$CHAVE" supabase/migrations/0035_leitura_universal.sql "$VPS:/tmp/0035.sql"
roda ssh_ "set -e; C=\$(docker ps --format '{{.Names}}' | grep sb_rtkconverte_db | head -1)
  docker cp /tmp/0035.sql \$C:/tmp/0035.sql
  docker exec \$C psql -U postgres -d postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0035.sql
  docker exec \$C rm -f /tmp/0035.sql; rm -f /tmp/0035.sql
  docker service update --force --quiet sb_rtkconverte_rest >/dev/null && echo 'REST reiniciado'"

# ---------------------------------------------------------------- 3. funções
passo "3. Funções parse-txt, reunir-certificados (trocadas) e ler-arquivo (nova)"
roda tar -C "$PACOTE" -czf "$PACOTE.tgz" parse-txt reunir-certificados ler-arquivo
roda scp -q -i "$CHAVE" "$PACOTE.tgz" "$VPS:/tmp/leitura-funcoes.tgz"
roda ssh_ "set -e; mkdir -p /tmp/leitura-funcoes && tar -xzf /tmp/leitura-funcoes.tgz -C /tmp/leitura-funcoes
  for f in parse-txt reunir-certificados; do
    cp /tmp/leitura-funcoes/\$f/index.ts /tmp/leitura-funcoes/\$f/deno.json $FN/\$f/
    cp /tmp/leitura-funcoes/\$f/functions/\$f/index.ts /tmp/leitura-funcoes/\$f/functions/\$f/deno.json $FN/\$f/functions/\$f/
    cp /tmp/leitura-funcoes/\$f/functions/_shared/servico.ts /tmp/leitura-funcoes/\$f/functions/_shared/certificados.ts $FN/\$f/functions/_shared/
  done
  rm -rf $FN/parse-txt/functions/_shared/leitor && cp -a /tmp/leitura-funcoes/parse-txt/functions/_shared/leitor $FN/parse-txt/functions/_shared/
  rm -rf $FN/ler-arquivo && cp -a /tmp/leitura-funcoes/ler-arquivo $FN/ler-arquivo
  rm -rf /tmp/leitura-funcoes /tmp/leitura-funcoes.tgz
  find $FN/ler-arquivo -type f | sort"
rm -f "$PACOTE.tgz"

# ---------------------------------------------------------------- 4. mapas + chave
passo "4. Mapas de ambiente com ler-arquivo (+ OPENAI_API_KEY do .env, se houver) e reinício"
OPENAI=""
if [ -f .env ] && grep -q '^OPENAI_API_KEY=' .env; then OPENAI="$(grep '^OPENAI_API_KEY=' .env | head -1 | cut -d= -f2- | tr -d '"\r')"; fi
[ -n "$OPENAI" ] && echo "   chave da OpenAI encontrada no .env (não exibida)" || echo "   sem OPENAI_API_KEY no .env: a IA fica desligada até a chave entrar"
if $EXEC; then
  ssh_ "python3 - <<'PY' > /tmp/env-leitura.txt
import json, subprocess
env = subprocess.check_output(['docker','service','inspect','sb_rtkconverte_functions','--format','{{json .Spec.TaskTemplate.ContainerSpec.Env}}']).decode()
env = dict(e.split('=',1) for e in json.loads(env))
imp = json.loads(env['FUNCTIONS_IMPORT_MAPS']); jwt = json.loads(env['FUNCTIONS_VERIFY_JWT_MAP'])
imp['ler-arquivo'] = '/home/deno/functions/ler-arquivo/deno.json'; jwt['ler-arquivo'] = True
print('FUNCTIONS_IMPORT_MAPS=' + json.dumps(imp, separators=(',',':')))
print('FUNCTIONS_VERIFY_JWT_MAP=' + json.dumps(jwt, separators=(',',':')))
PY
  chmod 600 /tmp/env-leitura.txt"
  if [ -n "$OPENAI" ]; then printf 'OPENAI_API_KEY=%s\n' "$OPENAI" | ssh_ "cat >> /tmp/env-leitura.txt"; fi
  ssh_ "set -e; ARGS=''; while IFS= read -r l; do ARGS=\"\$ARGS --env-add \$(printf %q \"\$l\")\"; done < /tmp/env-leitura.txt
    eval docker service update --quiet \$ARGS sb_rtkconverte_functions >/dev/null && echo 'funções reiniciadas (com os mapas novos)'
    rm -f /tmp/env-leitura.txt
    uptime"
else
  echo "   [simulação] FUNCTIONS_IMPORT_MAPS/FUNCTIONS_VERIFY_JWT_MAP += ler-arquivo; docker service update --force sb_rtkconverte_functions"
fi

# ---------------------------------------------------------------- 5. fumaça
passo "5. Fumaça (as funções respondem pelo próprio código)"
if $EXEC; then
  sleep 20
  ANON="$(grep -E '^VITE_SUPABASE_ANON_KEY=' .env | cut -d= -f2- | tr -d '"\r')"
  URL="https://utxqkbgfgpbczqjtieyu.supabase.agenteselevex.top/functions/v1"
  for f in ler-arquivo parse-txt reunir-certificados; do
    printf '   %-20s ' "$f"; node -e "fetch('$URL/$f',{method:'POST',headers:{apikey:'$ANON',Authorization:'Bearer $ANON','Content-Type':'application/json'},body:'{}'}).then(async r=>console.log(r.status, (await r.text()).slice(0,120)))"
  done
else
  echo "   [simulação] POST sem usuário em ler-arquivo, parse-txt, reunir-certificados → esperado 401/400 do código"
fi
echo; $EXEC && echo "Publicado. Backups: backup-banco-$DATA-leitura / backup-funcoes-$DATA-leitura" || echo "Simulação concluída. Rode com --executar para publicar."
