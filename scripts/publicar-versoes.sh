#!/usr/bin/env bash
# Publica a REGRA DAS VERSÕES DOS PONTOS (leitor/versoes.ts) na VPS:
# parse-txt e ler-arquivo — as duas funções que reexecutam a leitura.
#
#   bash scripts/publicar-versoes.sh              # simulação (só lê a VPS)
#   bash scripts/publicar-versoes.sh --executar   # publica de verdade
#
# Troca por função: functions/<f>/index.ts e, em functions/_shared/leitor/,
# executor.ts, index.ts, ordem.ts e versoes.ts (novo). Antes de trocar:
#   - confere por md5 que o que está no ar é o commit anterior (BASE_COMMIT);
#   - baixa a pasta da função, põe os arquivos novos por cima e roda no Deno
#     até "Listening on" (prova que carrega com o _shared que está lá).
# Banco: nada. reunir-certificados não muda (lê o anel do leitura.json).
set -euo pipefail
cd "$(dirname "$0")/.."

VPS="root@31.97.85.119"
CHAVE="$HOME/.ssh/orbit_vps"
BASE="/opt/supabase/rtkconverte"
FN="$BASE/volumes/functions"
DATA="$(date +%Y%m%d-%H%M)"
BK="$BASE/backup-funcoes-$DATA-versoes"
EXEC=false
[ "${1:-}" = "--executar" ] && EXEC=true
FUNCOES=(parse-txt ler-arquivo)
LEITOR_MUDA=(executor index ordem)   # + versoes.ts, novo
# o que está no ar tem de ser o da leitura universal (inalterado até 3477bb3)
BASE_COMMIT="3477bb3"

ssh_() { ssh -i "$CHAVE" -o ConnectTimeout=20 "$VPS" "$@"; }
passo() { echo; echo "==> $*"; }
md5_repo() { git show "$1:$2" | tr -d '\r' | md5sum | cut -c1-32; }
md5_local() { tr -d '\r' < "$1" | md5sum | cut -c1-32; }
md5_vps() { ssh_ "tr -d '\r' < $1 | md5sum | cut -c1-32"; }

# pares "no ar (relativo à pasta da função)":"no repositório"
pares() {
  local f="$1"
  echo "functions/$f/index.ts:supabase/functions/$f/index.ts"
  for m in "${LEITOR_MUDA[@]}" versoes; do echo "functions/_shared/leitor/$m.ts:supabase/functions/_shared/leitor/$m.ts"; done
}

# ------------------------------------------------------------ 0. conferência
passo "0. O que está no ar é o esperado ($BASE_COMMIT)?"
for f in "${FUNCOES[@]}"; do
  for par in "functions/$f/index.ts:supabase/functions/$f/index.ts" $(for m in "${LEITOR_MUDA[@]}"; do echo "functions/_shared/leitor/$m.ts:supabase/functions/_shared/leitor/$m.ts"; done); do
    r="${par%%:*}"; l="${par#*:}"
    esperado="$(md5_repo "$BASE_COMMIT" "$l")"; noar="$(md5_vps "$FN/$f/$r")"
    [ "$noar" = "$esperado" ] || { echo "   $f/$r no ar ($noar) != $BASE_COMMIT ($esperado): parando."; exit 1; }
    echo "   $f/$r = $BASE_COMMIT"
  done
  ssh_ "test ! -e $FN/$f/functions/_shared/leitor/versoes.ts" || { echo "   $f já tem versoes.ts no ar: parando."; exit 1; }
done

# ------------------------------------------------------------ 0b. carga no Deno
passo "0b. A função carrega com os arquivos novos? (cópia local da pasta no ar)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
for f in "${FUNCOES[@]}"; do
  scp -q -r -i "$CHAVE" "$VPS:$FN/$f" "$TMP/$f"
  while IFS= read -r par; do cp "${par#*:}" "$TMP/$f/${par%%:*}"; done < <(pares "$f")
  ( cd "$TMP/$f" && SUPABASE_URL=http://x SUPABASE_ANON_KEY=x SUPABASE_SERVICE_ROLE_KEY=x timeout 90 deno run -A --no-check --config deno.json index.ts > "$TMP/$f.log" 2>&1 ) || true
  grep -q "Listening on" "$TMP/$f.log" && echo "   $f: carrega (Listening on)" || { echo "   $f NÃO carrega:"; sed 's/^/      /' "$TMP/$f.log" | head -20; exit 1; }
done

# ------------------------------------------------------------ 1. backup
passo "1. Backup em $BK"
if $EXEC; then
  ssh_ "set -e; mkdir -p $BK; for f in ${FUNCOES[*]}; do cp -a $FN/\$f $BK/; done; ls $BK"
else
  echo "   [simulação] cp -a ${FUNCOES[*]} → $BK"
fi

# ------------------------------------------------------------ 2. troca
passo "2. Troca dos arquivos"
for f in "${FUNCOES[@]}"; do
  while IFS= read -r par; do
    if $EXEC; then scp -q -i "$CHAVE" "${par#*:}" "$VPS:$FN/$f/${par%%:*}"; else echo "   [simulação] $f/${par%%:*}"; fi
  done < <(pares "$f")
done

# ------------------------------------------------------------ 3. reinício
passo "3. Reinício das funções"
if $EXEC; then
  ssh_ "uptime; docker service update --force --quiet sb_rtkconverte_functions >/dev/null && echo 'funções reiniciadas'; uptime"
else
  echo "   [simulação] docker service update --force sb_rtkconverte_functions"
fi

# ------------------------------------------------------------ 4. conferência + fumaça
passo "4. md5 no ar = repositório, e fumaça"
if $EXEC; then
  for f in "${FUNCOES[@]}"; do
    while IFS= read -r par; do
      r="${par%%:*}"; l="${par#*:}"
      [ "$(md5_vps "$FN/$f/$r")" = "$(md5_local "$l")" ] && echo "   $f/$r = repo" || { echo "   $f/$r DIFERENTE do repo"; exit 1; }
    done < <(pares "$f")
  done
  sleep 20
  ANON="$(grep -E '^VITE_SUPABASE_ANON_KEY=' .env | cut -d= -f2- | tr -d '"\r')"
  URL="https://utxqkbgfgpbczqjtieyu.supabase.agenteselevex.top/functions/v1"
  for f in "${FUNCOES[@]}"; do
    printf '   %-12s ' "$f"
    node -e "fetch('$URL/$f',{method:'POST',headers:{apikey:'$ANON',Authorization:'Bearer $ANON','Content-Type':'application/json'},body:'{}'}).then(async r=>console.log(r.status,(await r.text()).slice(0,120)))"
  done
  echo; echo "Publicado. Backup: $BK"
  echo "Volta atrás: ssh … 'for f in ${FUNCOES[*]}; do rm -rf $FN/\$f && cp -a $BK/\$f $FN/; done; docker service update --force sb_rtkconverte_functions'"
else
  echo "   [simulação] md5 no ar = repo; POST {} sem usuário → esperado 401 do próprio código"
  echo; echo "Simulação concluída. Rode com --executar para publicar."
fi
