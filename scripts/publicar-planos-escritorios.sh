#!/usr/bin/env bash
# Publica na VPS os dois planos (Profissional e Empresarial) e os escritórios
# adicionais (pedido do Wilker, 11/11/2026):
#   - banco: 0050 (planos.escritorios_adicionais/preco_escritorio, escritorios.matriz_id,
#     escolha do escritório pelo dono, créditos do grupo, mensalidade com os
#     escritórios, os dois planos novos; quem já é cliente fica com a condição de
#     hoje gravada na empresa) numa transação + REST;
#   - funções: cobranca (mensalidade com os escritórios + escritorios_sincronizar)
#     e equipe (cuida da equipe do escritório em que o dono está) — o que mudou
#     desde $ANTES, por cima da pasta baixada da VPS; cada pacote sobe no Deno daqui;
#   - fumaça: cadastro_planos mostra os dois planos; funções respondem.
#   O site sai pelo push da main LOGO DEPOIS deste script (as telas novas chamam
#   meus_escritorios e lêem meu_escritorio com matriz_id, que só existem com a 0050).
#
#   bash scripts/publicar-planos-escritorios.sh              # simulação
#   bash scripts/publicar-planos-escritorios.sh --executar   # publica de verdade
set -euo pipefail
cd "$(dirname "$0")/.."

VPS="root@31.97.85.119"
CHAVE="$HOME/.ssh/orbit_vps"
BASE="/opt/supabase/rtkconverte"
FN="$BASE/volumes/functions"
DATA="$(date +%Y%m%d-%H%M)"
BKF="$BASE/backup-funcoes-$DATA-planos-escritorios"
BKB="$BASE/backup-banco-$DATA-planos-escritorios"
ANTES="${ANTES:-db18d8b}"  # o que está no ar (ANTES=<commit> para um ajuste depois da 1ª publicação)
HOST="utxqkbgfgpbczqjtieyu.supabase.agenteselevex.top"
MIGRACOES=(supabase/migrations/0050_planos_escritorios.sql)
# SEM_MIGRACAO=1: só as funções (a 0050 já está no ar)
[ "${SEM_MIGRACAO:-}" = "1" ] && MIGRACOES=()
EXEC=false
[ "${1:-}" = "--executar" ] && EXEC=true

ssh_() { ssh -n -i "$CHAVE" -o ConnectTimeout=20 "$VPS" "$@"; }
passo() { echo; echo "==> $*"; }
roda() { if $EXEC; then "$@"; else echo "   [simulação] $*"; fi; }
md5_repo() { { git show "$1:$2" 2>/dev/null || true; } | tr -d '\r' | md5sum | cut -c1-32; }
md5_local() { tr -d '\r' < "$1" | md5sum | cut -c1-32; }
ANON="$(grep -E '^VITE_SUPABASE_ANON_KEY=' .env | head -1 | cut -d= -f2- | tr -d '"\r')"

# ------------------------------------------------------------ 0. o que muda
passo "0. Funções com mudança desde $ANTES (fecho de imports)"
declare -A ARQS
FUNCOES=()
for d in supabase/functions/*/; do
  f="$(basename "$d")"
  [ "$f" = "_shared" ] || [ "$f" = "entregar" ] || [ ! -f "$d/index.ts" ] && continue
  lista="$(node scripts/fecho-imports.mjs --desde "$ANTES" "$f" 2>/dev/null | grep -v '^#' || true)"
  [ -z "$lista" ] && continue
  FUNCOES+=("$f"); ARQS[$f]="$lista"
  echo "   $f:"; echo "$lista" | sed 's/^/      /'
done
ENTREGAR=false
# os planos e escritórios não tocam o pacote entregar (car/loteamento/exportar): fica como está
echo "   entregar (pacote): $($ENTREGAR && echo 'muda' || echo 'igual')"
for m in "${MIGRACOES[@]}"; do [ -f "$m" ] && echo "   migração: $m"; done

# ------------------------------------------------------------ 1. conferência e pacote local
passo "1. No ar = $ANTES? Monta cada pacote (pasta da VPS + arquivos novos) e testa no Deno"
PACOTE="$(mktemp -d)"
trap 'rm -rf "$PACOTE"' EXIT
destino_vps() { # caminho do repo → caminho dentro da pasta da função na VPS
  local f="$1" p="$2"
  case "$p" in
    supabase/functions/_shared/*) echo "functions/_shared/${p#supabase/functions/_shared/}" ;;
    supabase/functions/$f/*) echo "functions/$f/${p#supabase/functions/$f/}" ;;
    *) echo "" ;;
  esac
}
for f in "${FUNCOES[@]}"; do
  scp -q -r -i "$CHAVE" "$VPS:$FN/$f" "$PACOTE/$f"
  # funções antigas sem a pasta functions/ (consultar-sigef, admin-setup): pare
  [ -d "$PACOTE/$f/functions" ] || { echo "   $f: layout sem functions/ — publique à mão"; exit 1; }
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    dv="$(destino_vps "$f" "$p")"; [ -z "$dv" ] && { echo "   $f: $p fora da função"; exit 1; }
    alvo="$PACOTE/$f/$dv"
    if [ -f "$alvo" ]; then
      noar="$(md5_local "$alvo")"
      if [ "$(wc -c < "$alvo")" -lt 300 ] && grep -q "export {}" "$alvo"; then
        echo "   $f: $dv é ESBOÇO na VPS — mantido"; continue
      fi
      if [ "$noar" != "$(md5_repo "$ANTES" "$p")" ] && [ "$noar" != "$(md5_local "$p")" ]; then
        echo "   $f: $dv no ar é OUTRO código ($noar) — pare e confira"; exit 1
      fi
    fi
    mkdir -p "$(dirname "$alvo")" && cp "$p" "$alvo"
    echo "   $f: $dv ← repo"
  done <<< "${ARQS[$f]}"
  # arquivo do fecho que NÃO mudou mas a função passou a importar e que não
  # existe na pasta da VPS (ex.: gerar-planta agora importa timbre_automatico.ts)
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    dv="$(destino_vps "$f" "$p")"; [ -z "$dv" ] && continue
    alvo="$PACOTE/$f/$dv"
    [ -f "$alvo" ] && continue
    mkdir -p "$(dirname "$alvo")" && cp "$p" "$alvo"
    # entra também na lista que o passo 4 copia (em 05/11 só ia ao pacote
    # local: a gerar-planta subiu sem o timbre_automatico.ts e deu BOOT_ERROR)
    ARQS[$f]+=$'\n'"$p"
    echo "   $f: $dv ← repo (faltava na VPS)"
  done <<< "$(node scripts/fecho-imports.mjs "$f" 2>/dev/null | grep -v '^#' || true)"
done
if $ENTREGAR; then
  node scripts/empacotar-entregar.mjs
  mkdir -p "$PACOTE/entregar" && cp build/funcoes/entregar/index.ts build/funcoes/entregar/deno.json "$PACOTE/entregar/"
fi
porta_livre() { node -e "require('net').connect(8000,'127.0.0.1').on('connect',()=>process.exit(1)).on('error',()=>process.exit(0))"; }
for f in "${FUNCOES[@]}" $($ENTREGAR && echo entregar); do
  # outra sessão pode estar testando a função dela na 8000: espera (até 5 min), não derruba
  for _ in $(seq 1 300); do porta_livre && break; sleep 1; done
  porta_livre || { echo "   porta 8000 ocupada por outro processo há 5 min — pare e confira"; exit 1; }
  ( cd "$PACOTE/$f"
    SUPABASE_URL="https://$HOST" SUPABASE_ANON_KEY="$ANON" SUPABASE_SERVICE_ROLE_KEY=x PORT=0 \
      timeout 120 deno run --no-check -A --config deno.json index.ts > "$PACOTE/$f.log" 2>&1 & echo $! > "$PACOTE/$f.pid" )
  ok=false
  for _ in $(seq 1 90); do grep -q "Listening" "$PACOTE/$f.log" && { ok=true; break; }; sleep 1; done
  pid="$(cat "$PACOTE/$f.pid")"
  # Windows (Git Bash): o kill do MSYS não derruba o deno.exe filho — taskkill na árvore pelo PID do Windows
  wpid="$(cat "/proc/$pid/winpid" 2>/dev/null || true)"
  [ -n "$wpid" ] && taskkill //F //T //PID "$wpid" >/dev/null 2>&1 || true
  pkill -P "$pid" 2>/dev/null || true; kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do porta_livre && break; sleep 1; done
  if $ok; then echo "   $f: sobe no Deno (Listening)"; else echo "   $f: NÃO subiu:"; tail -8 "$PACOTE/$f.log"; exit 1; fi
done

# ------------------------------------------------------------ 2. backups
passo "2. Backups ($BKB, $BKF)"
roda ssh_ "set -e; mkdir -p $BKB $BKF
  C=\$(docker ps --format '{{.Names}}' | grep sb_rtkconverte_db | head -1)
  docker exec \$C pg_dump -U postgres -Fc postgres > $BKB/postgres.dump
  for f in ${FUNCOES[*]} entregar; do [ -d $FN/\$f ] && cp -a $FN/\$f $BKF/; done
  ls -la $BKB $BKF"

# ------------------------------------------------------------ 3. migrações
passo "3. Migrações (cada uma em transação única) + REST"
for m in "${MIGRACOES[@]}"; do
  [ -f "$m" ] || continue
  n="$(basename "$m")"
  roda scp -q -i "$CHAVE" "$m" "$VPS:/tmp/$n"
  roda ssh_ "set -e; C=\$(docker ps --format '{{.Names}}' | grep sb_rtkconverte_db | head -1)
    docker cp /tmp/$n \$C:/tmp/$n
    docker exec \$C psql -U postgres -d postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/$n
    cp /tmp/$n $BKB/$n
    docker exec \$C rm -f /tmp/$n; rm -f /tmp/$n
    echo 'aplicada: $n (cópia em $BKB)'"
done
roda ssh_ "docker service update --force --quiet sb_rtkconverte_rest >/dev/null && echo 'REST reiniciado'"

# ------------------------------------------------------------ 4. funções
passo "4. Funções (só os arquivos novos) e reinício"
if $EXEC; then
  tar -C "$PACOTE" -czf "$PACOTE.tgz" "${FUNCOES[@]}" $($ENTREGAR && echo entregar)
  scp -q -i "$CHAVE" "$PACOTE.tgz" "$VPS:/tmp/planos-escritorios-funcoes.tgz"
  ssh_ "set -e; rm -rf /tmp/planos-escritorios-funcoes && mkdir -p /tmp/planos-escritorios-funcoes && tar -xzf /tmp/planos-escritorios-funcoes.tgz -C /tmp/planos-escritorios-funcoes"
  for f in "${FUNCOES[@]}"; do
    while IFS= read -r p; do
      [ -z "$p" ] && continue
      dv="$(destino_vps "$f" "$p")"
      ssh_ "set -e; mkdir -p \$(dirname $FN/$f/$dv); cp /tmp/planos-escritorios-funcoes/$f/$dv $FN/$f/$dv"
      a="$(ssh_ "tr -d '\r' < $FN/$f/$dv | md5sum | cut -c1-32")"; b="$(md5_local "$PACOTE/$f/$dv")"
      [ "$a" = "$b" ] && echo "   $f/$dv: md5 ok" || { echo "   $f/$dv: md5 DIFERENTE"; exit 1; }
    done <<< "${ARQS[$f]}"
  done
  $ENTREGAR && ssh_ "set -e; rm -rf $FN/entregar && cp -a /tmp/planos-escritorios-funcoes/entregar $FN/entregar && echo '   entregar: pacote novo'"
  ssh_ "rm -rf /tmp/planos-escritorios-funcoes /tmp/planos-escritorios-funcoes.tgz; docker service update --force --quiet sb_rtkconverte_functions >/dev/null && echo 'funções reiniciadas'; uptime"
  rm -f "$PACOTE.tgz"
else
  echo "   [simulação] copia os arquivos acima para $FN/<função>/…, confere o md5 de cada um e reinicia sb_rtkconverte_functions"
fi

# ------------------------------------------------------------ 5. fumaça
passo "5. Fumaça"
if $EXEC; then
  sleep 20
  node - "$HOST" "$ANON" <<'JS'
const [host, anon] = process.argv.slice(2);
const U = `https://${host}`;
const h = { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" };
const t = async (n, url, o = {}) => { try { const r = await fetch(url, { headers: h, ...o }); console.log(`   ${n.padEnd(36)} ${r.status} ${(await r.text()).slice(0, 100)}`); } catch (e) { console.log(`   ${n} ERRO ${e.message}`); } };
await t("REST anônimo", `${U}/rest/v1/servicos?select=id&limit=1`);
{ const r = await fetch(`${U}/rest/v1/rpc/cadastro_planos`, { method: "POST", headers: h, body: "{}" }); const j = await r.json().catch(() => null);
  const planos = (j?.planos ?? []).map((p) => `${p.nome} ${p.mensalidade} (+${p.escritorios_adicionais ?? "?"} esc.)`).join(" · ");
  console.log(`   cadastro_planos (público)            ${r.status} ${planos}  (esperado: Profissional 299.9 (+0) · Empresarial 1000 (+2))`); }
{ const r = await fetch(`${U}/rest/v1/rpc/meus_escritorios`, { method: "POST", headers: h, body: "{}" });
  console.log(`   meus_escritorios pelo anônimo        ${r.status}  (esperado: 401/403/404, nunca 200)`); }
{ const r = await fetch(`${U}/rest/v1/rpc/criar_escritorio`, { method: "POST", headers: h, body: JSON.stringify({ p_nome: "fumaça" }) });
  console.log(`   criar_escritorio pelo anônimo        ${r.status}  (esperado: 401/403/404, nunca 200)`); }
await t("cobranca escritorios_sincronizar s/ login", `${U}/functions/v1/cobranca`, { method: "POST", body: JSON.stringify({ acao: "escritorios_sincronizar" }) });
await t("cobranca cadastro_criar vazio", `${U}/functions/v1/cobranca`, { method: "POST", body: JSON.stringify({ acao: "cadastro_criar" }) });
for (const f of ["superadmin", "equipe"])
  await t(`fn ${f} sem login`, `${U}/functions/v1/${f}`, { method: "POST", body: JSON.stringify({ servico_id: "00000000-0000-0000-0000-000000000000", saida: "area", formato: "kml" }) });
JS
else
  echo "   [simulação] REST 200; cadastro_planos com Profissional e Empresarial; RPCs dos escritórios negadas ao anônimo; funções 401/400"
fi
echo; $EXEC && echo "Publicado. Backups: $BKB / $BKF. Agora: push da main (site)." || echo "Simulação concluída. Rode com --executar para publicar."
