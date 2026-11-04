#!/usr/bin/env bash
# Publica na VPS a AUDITORIA DE SEGURANÇA de 04/11/2026:
#   - banco: migração 0038 (serviço derivado sem brecha, troca de tipo depois de
#     cobrado, criar serviço exige permissão, documento só na pasta do serviço,
#     estorno tira créditos, empresa sem plano = 0, gestor não mexe em gestor,
#     teto na consulta SIGEF, limites_uso/consumir_limite, teto dos buckets);
#   - 14 funções: index.ts + _shared/limite.ts (novo) e, nas que usam,
#     _shared/acesso.ts (falha fecha); cobranca também troca fluxos.ts.
#   O site (popup do mapa + cabeçalhos de segurança) sai pelo push na main.
#   Ordem: banco → funções → push. As funções novas funcionam sem a 0038 (o
#   limite libera se a RPC não existir), mas a 0038 deve ir junto.
#
#   bash scripts/publicar-seguranca.sh              # simulação (só lê a VPS)
#   bash scripts/publicar-seguranca.sh --executar   # publica de verdade
set -euo pipefail
cd "$(dirname "$0")/.."

VPS="root@31.97.85.119"
CHAVE="$HOME/.ssh/orbit_vps"
BASE="/opt/supabase/rtkconverte"
VOL="$BASE/volumes/functions"
DATA="$(date +%Y%m%d-%H%M)"
BKF="$BASE/backup-funcoes-$DATA-seguranca"
BKB="$BASE/backup-banco-$DATA-seguranca"
MIG="supabase/migrations/0038_auditoria_seguranca.sql"
ANTES="9325728"
# acesso.ts que ainda roda em buscar-satelite, corrigir-sobreposicao e
# reunir-certificados (anterior às funções de auditoria; o novo é um superconjunto)
ACESSO_ANTIGO="1d571c44a465896c05233ff99efa4fc4"
EXEC=false
[ "${1:-}" = "--executar" ] && EXEC=true

ssh_() { ssh -n -i "$CHAVE" -o ConnectTimeout=20 "$VPS" "$@"; }
passo() { echo; echo "==> $*"; }
md5_repo() { { git show "$1:$2" 2>/dev/null || true; } | tr -d '\r' | md5sum | cut -c1-32; }
md5_local() { tr -d '\r' < "$1" | md5sum | cut -c1-32; }
VAZIO="$(printf '' | md5sum | cut -c1-32)"

# função : raiz do código dentro da pasta (functions/ ou a própria pasta)
FUNCOES=(gerar-pecas gerar-documentos gerar-planta parse-txt ler-arquivo buscar-satelite consultar-sigef
         corrigir-sobreposicao reunir-certificados equipe superadmin gprol admin-setup cobranca)
COM_ACESSO=" gerar-pecas gerar-documentos gerar-planta parse-txt ler-arquivo buscar-satelite consultar-sigef corrigir-sobreposicao reunir-certificados "
raiz() { case "$1" in consultar-sigef|admin-setup) echo "";; *) echo "functions/";; esac; }

# lista "função|caminho no ar (relativo à pasta da função)|arquivo do repo"
PARES=()
for f in "${FUNCOES[@]}"; do
  r="$(raiz "$f")"
  PARES+=("$f|${r}$f/index.ts|supabase/functions/$f/index.ts")
  PARES+=("$f|${r}_shared/limite.ts|supabase/functions/_shared/limite.ts")
  [[ "$COM_ACESSO" == *" $f "* ]] && PARES+=("$f|${r}_shared/acesso.ts|supabase/functions/_shared/acesso.ts")
done
PARES+=("cobranca|functions/cobranca/fluxos.ts|supabase/functions/cobranca/fluxos.ts")

# ------------------------------------------------------------ 0. conferência
passo "0. O que está no ar é o $ANTES (ou já o novo)?"
LISTA="$(printf '%s\n' "${PARES[@]}" | cut -d'|' -f1,2 | tr '|' '/')"
declare -A NOAR
while read -r h p; do NOAR["$p"]="$h"; done < <(ssh_ "cd $VOL; for p in $(echo $LISTA); do if [ -f \$p ]; then echo \"\$(tr -d '\r' < \$p | md5sum | cut -c1-32) \$p\"; else echo \"$VAZIO \$p\"; fi; done")
for par in "${PARES[@]}"; do
  IFS='|' read -r f r l <<< "$par"
  noar="${NOAR[$f/$r]}"; novo="$(md5_local "$l")"; base="$(md5_repo "$ANTES" "$l")"
  if [ "$noar" = "$novo" ]; then echo "   $f/$r já é o novo"
  elif [ "$noar" = "$base" ]; then echo "   $f/$r = $ANTES"
  elif [ "$noar" = "$VAZIO" ]; then echo "   $f/$r: novo (não existe no ar)"
  elif [[ "$r" == *acesso.ts && "$noar" = "$ACESSO_ANTIGO" ]]; then echo "   $f/$r = acesso.ts antigo conhecido"
  else echo "   $f/$r no ar ($noar) não é $ANTES ($base) nem o novo ($novo): parando."; exit 1; fi
done
ssh_ "DB=\$(docker ps -q -f name=sb_rtkconverte_db | head -1); docker exec \$DB psql -U postgres -d postgres -Atc \"select 'banco: 0038 ' || case when to_regclass('public.limites_uso') is null then 'ainda não aplicada' else 'já aplicada' end\""

# ------------------------------------------------------------ 0b. carga no Deno
passo "0b. Cada função carrega com os arquivos novos? (cópia local da pasta no ar)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
for f in "${FUNCOES[@]}"; do
  scp -q -r -i "$CHAVE" "$VPS:$VOL/$f" "$TMP/$f" < /dev/null
  for par in "${PARES[@]}"; do
    IFS='|' read -r ff r l <<< "$par"; [ "$ff" = "$f" ] || continue
    mkdir -p "$(dirname "$TMP/$f/$r")"; cp "$l" "$TMP/$f/$r"
  done
  ( cd "$TMP/$f" && SUPABASE_URL=http://x SUPABASE_ANON_KEY=x SUPABASE_SERVICE_ROLE_KEY=x timeout 90 deno run -A --no-check --no-lock --config deno.json index.ts > "$TMP/$f.log" 2>&1 ) || true
  grep -q "Listening on" "$TMP/$f.log" && echo "   $f: carrega" || { echo "   $f NÃO carrega:"; sed 's/^/      /' "$TMP/$f.log" | head -20; exit 1; }
done

# ------------------------------------------------------------ 1. banco
passo "1. Banco: backup em $BKB e migração 0038 (uma transação)"
if $EXEC; then
  scp -q -i "$CHAVE" "$MIG" "$VPS:/tmp/0038.sql" < /dev/null
  ssh_ "set -e; mkdir -p $BKB; DB=\$(docker ps -q -f name=sb_rtkconverte_db | head -1)
    docker exec \$DB pg_dump -U postgres -d postgres -Fc -f /tmp/antes0038.dump; docker cp \$DB:/tmp/antes0038.dump $BKB/postgres.dump; docker exec \$DB rm -f /tmp/antes0038.dump
    cp /tmp/0038.sql $BKB/; docker cp /tmp/0038.sql \$DB:/tmp/0038.sql
    docker exec \$DB psql -U postgres -d postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0038.sql
    docker exec \$DB rm -f /tmp/0038.sql; rm -f /tmp/0038.sql
    echo '   0038 aplicada'; ls -la $BKB
    docker service update --force --quiet sb_rtkconverte_rest >/dev/null && echo '   REST reiniciado (consumir_limite no esquema)'"
else
  echo "   [simulação] pg_dump → $BKB/postgres.dump; psql -1 -f 0038; docker service update --force sb_rtkconverte_rest"
fi

# ------------------------------------------------------------ 2. funções
passo "2. Funções: backup em $BKF e troca dos arquivos"
if $EXEC; then
  ssh_ "set -e; mkdir -p $BKF; cd $VOL; cp -a ${FUNCOES[*]} $BKF/; ls $BKF"
  for par in "${PARES[@]}"; do
    IFS='|' read -r f r l <<< "$par"
    ssh_ "mkdir -p \"\$(dirname $VOL/$f/$r)\""
    scp -q -i "$CHAVE" "$l" "$VPS:$VOL/$f/$r" < /dev/null
  done
  ssh_ "uptime; docker service update --force --quiet sb_rtkconverte_functions >/dev/null && echo '   funções reiniciadas'; uptime"
else
  for par in "${PARES[@]}"; do IFS='|' read -r f r l <<< "$par"; echo "   [simulação] $f/$r ← $l"; done
  echo "   [simulação] docker service update --force sb_rtkconverte_functions"
fi

# ------------------------------------------------------------ 3. conferência + fumaça
passo "3. md5 no ar = repositório, e fumaça"
if $EXEC; then
  for par in "${PARES[@]}"; do
    IFS='|' read -r f r l <<< "$par"
    noar="$(ssh_ "tr -d '\r' < $VOL/$f/$r | md5sum | cut -c1-32")"
    [ "$noar" = "$(md5_local "$l")" ] || { echo "   $f/$r DIFERENTE do repo"; exit 1; }
  done
  echo "   ${#PARES[@]} arquivos = repo"
  sleep 25
  ANON="$(grep -E '^VITE_SUPABASE_ANON_KEY=' .env | cut -d= -f2- | tr -d '"\r')"
  URL="https://utxqkbgfgpbczqjtieyu.supabase.agenteselevex.top"
  chamar() { node -e "fetch('$URL/functions/v1/$1',{method:'POST',headers:{apikey:'$ANON',Authorization:'Bearer $ANON','Content-Type':'application/json'},body:JSON.stringify($2)}).then(async r=>console.log(r.status,(await r.text()).slice(0,110)))"; }
  printf '   gerar-pecas analisar sem login (espera 401)   '; chamar gerar-pecas '{modo:"analisar",pdf_base64:"JVBERi0x"}'
  for f in gerar-documentos gerar-planta parse-txt ler-arquivo buscar-satelite consultar-sigef corrigir-sobreposicao reunir-certificados equipe superadmin cobranca; do
    printf '   %-22s (espera 400/401/403 do código) ' "$f"; chamar "$f" '{}'
  done
  printf '   gprol sem chave (espera 401/400 do código)   '; chamar gprol '{acao:"x"}'
  printf '   REST: consumir_limite para o anônimo (espera negado) '
  node -e "fetch('$URL/rest/v1/rpc/consumir_limite',{method:'POST',headers:{apikey:'$ANON',Authorization:'Bearer $ANON','Content-Type':'application/json'},body:JSON.stringify({p_chave:'x',p_max:1,p_janela_s:60})}).then(async r=>console.log(r.status,(await r.text()).slice(0,110)))"
  echo; echo "Publicado. Backups: $BKB e $BKF"
  echo "Volta atrás das funções: ssh … 'cd $VOL && for f in ${FUNCOES[*]}; do rm -rf \$f && cp -a $BKF/\$f \$f; done && docker service update --force sb_rtkconverte_functions'"
  echo "Volta atrás do banco: pg_restore do $BKB/postgres.dump (perde o que entrou depois)"
else
  echo; echo "Simulação concluída. Rode com --executar para publicar."
fi
