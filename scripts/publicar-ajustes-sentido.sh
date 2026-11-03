#!/usr/bin/env bash
# Publica na VPS:
#   - AJUSTES DE PONTOS da conferência do TXT (7279e5e): parse-txt e ler-arquivo
#     (index.ts + _shared/leitor/{executor,index,ordem}.ts);
#   - SENTIDO ANTI-HORÁRIO nas peças (41bab96): gerar-pecas
#     (index.ts + _shared/servico.ts).
#
#   bash scripts/publicar-ajustes-sentido.sh              # simulação (só lê a VPS)
#   bash scripts/publicar-ajustes-sentido.sh --executar   # publica de verdade
#
# Antes de trocar: confere por md5 que o que está no ar é o commit anterior de
# cada arquivo (o "antes" de 7279e5e/41bab96) e roda cada função no Deno, com a
# pasta baixada da VPS + os arquivos novos, até "Listening on". Banco: nada.
set -euo pipefail
cd "$(dirname "$0")/.."

VPS="root@31.97.85.119"
CHAVE="$HOME/.ssh/orbit_vps"
BASE="/opt/supabase/rtkconverte"
FN="$BASE/volumes/functions"
DATA="$(date +%Y%m%d-%H%M)"
BK="$BASE/backup-funcoes-$DATA-ajustes-sentido"
EXEC=false
[ "${1:-}" = "--executar" ] && EXEC=true
FUNCOES=(parse-txt ler-arquivo gerar-pecas)

ssh_() { ssh -n -i "$CHAVE" -o ConnectTimeout=20 "$VPS" "$@"; }
passo() { echo; echo "==> $*"; }
md5_repo() { git show "$1:$2" | tr -d '\r' | md5sum | cut -c1-32; }
md5_local() { tr -d '\r' < "$1" | md5sum | cut -c1-32; }
md5_vps() { ssh_ "tr -d '\r' < $1 2>/dev/null | md5sum | cut -c1-32"; }

# "commit-que-muda:no-ar(relativo à pasta da função):no-repositório"
pares() {
  case "$1" in
    parse-txt|ler-arquivo)
      echo "7279e5e:functions/$1/index.ts:supabase/functions/$1/index.ts"
      for m in executor index ordem; do echo "7279e5e:functions/_shared/leitor/$m.ts:supabase/functions/_shared/leitor/$m.ts"; done ;;
    gerar-pecas)
      echo "41bab96:functions/gerar-pecas/index.ts:supabase/functions/gerar-pecas/index.ts"
      echo "41bab96:functions/_shared/servico.ts:supabase/functions/_shared/servico.ts" ;;
  esac
}

# ------------------------------------------------------------ 0. conferência
passo "0. O que está no ar é a versão anterior de cada arquivo?"
for f in "${FUNCOES[@]}"; do
  while IFS= read -r par; do
    c="${par%%:*}"; resto="${par#*:}"; r="${resto%%:*}"; l="${resto#*:}"
    esperado="$(md5_repo "$c^" "$l")"; novo="$(md5_local "$l")"; noar="$(md5_vps "$FN/$f/$r")"
    # o servico.ts do gerar-pecas no ar é o de bb5b0c4 (30/10): a57bfe3 mudou só
    # o sugerirTrechos, que o gerar-pecas não usa — essa versão também serve de "antes"
    [ "$f/$r" = "gerar-pecas/functions/_shared/servico.ts" ] && [ "$noar" = "$(md5_repo bb5b0c4 "$l")" ] && esperado="$noar"
    if [ "$noar" = "$esperado" ]; then echo "   $f/$r = anterior";
    elif [ "$noar" = "$novo" ]; then echo "   $f/$r já é o novo";
    else echo "   $f/$r no ar ($noar) não é $c^ ($esperado) nem o novo ($novo): parando."; exit 1; fi
  done < <(pares "$f")
done

# ------------------------------------------------------------ 0b. carga no Deno
passo "0b. Cada função carrega com os arquivos novos? (cópia local da pasta no ar)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
for f in "${FUNCOES[@]}"; do
  scp -q -r -i "$CHAVE" "$VPS:$FN/$f" "$TMP/$f"
  while IFS= read -r par; do resto="${par#*:}"; cp "${resto#*:}" "$TMP/$f/${resto%%:*}"; done < <(pares "$f")
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
    resto="${par#*:}"
    if $EXEC; then scp -q -i "$CHAVE" "${resto#*:}" "$VPS:$FN/$f/${resto%%:*}" < /dev/null; else echo "   [simulação] $f/${resto%%:*}"; fi
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
      resto="${par#*:}"; r="${resto%%:*}"; l="${resto#*:}"
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
  echo; echo "Simulação concluída. Rode com --executar para publicar."
fi
