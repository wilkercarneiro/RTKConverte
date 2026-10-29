# Vertces como SaaS

Várias empresas no mesmo sistema, cada uma isolada, com plano e recursos
liberados pelo painel do superadmin. Página pública em `/`; sistema em `/app/`.

## Peças

| Peça | Onde |
|---|---|
| Empresas isoladas (escritórios, RLS) | `supabase/migrations/0020_escritorios.sql` |
| Planos, recursos, superadmin, status, senha provisória, contatos do site | `supabase/migrations/0024_saas.sql` |
| Catálogo de recursos (a fonte) | `src/lib/recursos.ts` |
| Conta de quem entrou (superadmin, troca de senha, recursos) | `src/lib/conta.ts` → RPC `minha_conta()` |
| Painel do superadmin | `src/components/admin/*` → `#/admin/...` |
| Criar empresa/usuário, redefinir senha | edge function `supabase/functions/superadmin` |
| Página pública (sem preço, sem login) | `index.html` + `src/site/*` |
| Testes | `npm run test:rls` (banco), `tests/recursos.test.mjs` (catálogo) |

## Regra do recurso liberado

exceção da empresa > decisão do plano > `padrao` do catálogo > liberado.

Superadmin vê tudo. Banco sem a 0024 (estado "legado"): tudo liberado, como antes.

## Recurso novo: como entra no painel

1. Modalidade de serviço nova: basta a entrada em `SERVICOS` (`src/lib/modalidades.ts`). Ela vira `servico.<chave>` sozinha.
   Acrescente também o caso em `chave_recurso_do_servico()` numa migração, para a trava do banco reconhecer a modalidade (o `tests/recursos.test.mjs` cobra isso).
2. Outro recurso: uma entrada em `EXTRAS` (`src/lib/recursos.ts`) e `temRecurso("chave")` no ponto da tela. Chave fora do catálogo não compila.
3. Na próxima vez que o painel abrir, o catálogo é sincronizado (`sa_sincronizar_recursos`). O recurso aparece em **Recursos** com o selo "novo" e na matriz de **Planos** como "decidir". Até alguém decidir, vale o `padrao`.

## Cadastro de cliente

Painel → Empresas → **Nova empresa**: CNPJ (validado), nome da empresa, responsável, telefone/WhatsApp, e-mail da empresa (é o login) e a senha padrão (Painel → Configurações; a migração sorteia uma inicial, troque por uma que você lembre).
A edge function cria a conta já confirmada, a empresa, o vínculo de dono, a razão social/CNPJ em Configurações e marca a senha como provisória. O painel mostra a mensagem de acesso para copiar ou mandar no WhatsApp.
No primeiro acesso, o cliente cria a própria senha antes de ver o sistema.

## Publicar (ordem)

> **Publicado em 2026-10-28** (aval do Wilker: "pode publicar tudo"), nesta ordem, menos o passo 4 (ver abaixo):
> - backups em `/opt/supabase/rtkconverte/backup-banco-20261028-saas/` e `backup-funcoes-20261028-saas/`;
> - funções do repositório (`08bbe70` + `ba2dd5d` + `superadmin`); `superadmin` entrou em `FUNCTIONS_IMPORT_MAPS` e `FUNCTIONS_VERIFY_JWT_MAP` do serviço `sb_rtkconverte_functions`;
> - migrações 0020 + 0024 numa transação; REST reiniciado (o `NOTIFY pgrst` não bastou);
> - modelos neutros gerados por `scripts/modelos-neutros.mjs` a partir dos modelos em uso, em `templates/padrao/`;
> - Auth: `GOTRUE_DISABLE_SIGNUP=true` (antes qualquer um criava conta pela API e, com a 0020, a própria empresa), `GOTRUE_SITE_URL` e `GOTRUE_URI_ALLOW_LIST` em `https://rtk-converte.vercel.app`;
> - push da `main`.
>
> **Pendente:** passo 4. A criação da conta de superadmin foi barrada pela trava de permissões do Claude Code (dar acesso de administrador pede confirmação explícita). O Wilker cria por este comando na VPS: `docker exec <db> psql -U postgres -c "insert into super_admins (user_id) select id from auth.users where email = '<e-mail>'"`, depois de criar a conta no Auth.

1. **Backup do banco** da VPS (`scripts/backup-banco.sh`, ou `pg_dump` no `sb_rtkconverte_db`).
2. **Edge functions na VPS** (ver a memória `rtkconverte-vps`): as que estão no ar são de antes do `08bbe70` e não conhecem escritórios. Depois da 0020, um serviço criado por elas sem `escritorio_id` só funciona enquanto houver UMA empresa. Antes de cadastrar a segunda empresa, publique:
   - `parse-txt`, `gerar-documentos`, `gerar-planta`, `gerar-pecas`, `corrigir-sobreposicao`, `reunir-certificados`, `consultar-sigef` com `_shared/acesso.ts` e `_shared/modelos.ts` (`08bbe70`). Isso traz junto o `ba2dd5d`, ainda não publicado: decidir.
   - `superadmin` (nova): `index.ts`, `deno.json`, `functions/_shared/cnpj.ts`.
3. **Migrações**: `0020_escritorios.sql` e depois `0024_saas.sql`. Em seguida, reiniciar o REST (`docker service update --force sb_rtkconverte_rest`).
4. **Superadmin**: `insert into super_admins (user_id) select id from auth.users where lower(email) = '<e-mail do Wilker>';`
5. **Conferir** com `select e.nome, e.status, p.nome plano, m.papel, u.email from membros_escritorio m join escritorios e on e.id = m.escritorio_id left join planos p on p.id = e.plano_id join auth.users u on u.id = m.user_id;`. A D'Prol deve estar no plano Completo, com todos os usuários atuais. Tire quem não deveria estar.
6. **Modelos neutros** em `templates/padrao/…` (mesmos nomes da raiz, sem timbre da D'Prol). Sem eles, a empresa nova não gera memorial nem peças (`_shared/modelos.ts`).
7. **Auth → URL Configuration**: incluir `https://<domínio>/app/` nas Redirect URLs (o link de redefinição de senha agora volta para `/app/`).
8. **Push** da branch para a `main`: a Vercel publica a página em `/` e o sistema em `/app/`. Links antigos (`/#/servico/…`) e links de redefinição de senha são redirecionados para `/app/` pela própria página.
9. Avisar a equipe da D'Prol que o endereço do sistema passa a ser `/app/`.

## Equipe da empresa (0025)

- O dono (e quem ele autorizar com "Gerenciar a equipe") abre **Equipe** no menu: adiciona pessoas (o sistema cria a conta com uma senha provisória aleatória, mostrada uma vez para ser passada), escolhe um perfil pronto (Operador, Projetista, Consulta, Gerente) ou marca permissão por permissão, desativa sem apagar, gera senha nova e remove.
- Permissões (`src/lib/permissoes.ts`, mesma lista em `definir_membro`): criar serviços, gerar documentos, excluir serviços, cadastrar/editar clientes, excluir clientes, RT e credenciados, dados da empresa, gerenciar a equipe (só o dono concede).
- O banco trava o administrativo e o destrutivo com policies RESTRICTIVE; criar serviço e gerar documento são travados na tela e nas edge functions (`exigirPermissao` em `_shared/acesso.ts`).
- Desativado perde o acesso na hora. Plano pode ter `limite_usuarios` (painel → Planos); o banco recusa passar dele.
- Histórico (`atividades`): serviço criado/excluído, cliente criado/excluído, documento gerado, mudanças na equipe. A empresa vê em Equipe → Histórico; o superadmin, na aba Histórico da empresa.
- Testes: `tests/rls/equipe.sql` (rodado pelo `npm run test:rls`).

### Publicar a equipe

> **Publicado em 2026-10-28, 15h36–15h45** (aval: "Pode publicar"). Backups `backup-banco-20261028-equipe/` e `backup-funcoes-20261028-equipe/`. Atenção: o `0fd03f6` (divisão na planta A1) foi junto, e a `gerar-planta` precisou de `_shared/sigef_glebas.ts` e do `planta_dados.ts` novo — sem eles ficou ~4 min com BOOT_ERROR. Sempre comparar o fecho de imports com a VPS (md5) antes de reiniciar.

1. Backup do banco.
2. `0025_equipe.sql` numa transação; reiniciar o REST (`docker service update --force sb_rtkconverte_rest`).
3. Funções: `parse-txt`, `gerar-documentos`, `gerar-planta`, `gerar-pecas` (index.ts + `_shared/acesso.ts` de cada uma) e a nova `equipe` (`index.ts`, `deno.json`, `functions/_shared/cnpj.ts`), com `equipe` incluída em `FUNCTIONS_IMPORT_MAPS` e `FUNCTIONS_VERIFY_JWT_MAP` do serviço `sb_rtkconverte_functions` (como foi feito com a `superadmin`).
4. Push da `main` (o site novo depende da 0025 para a página Equipe; o resto funciona nos dois estados).

## Volta atrás

Nenhuma das migrações apaga dados. Para desfazer o bloqueio por plano num aperto: `update escritorios set plano_id = (select id from planos where nome = 'Completo'), status = 'ativo';`. Para desfazer o isolamento, ver `docs/multiescritorio/README.md`.
