# Vértice como SaaS

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

> Nada disto foi feito ainda. Cada passo de produção precisa do aval do Wilker.

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

## Volta atrás

Nenhuma das migrações apaga dados. Para desfazer o bloqueio por plano num aperto: `update escritorios set plano_id = (select id from planos where nome = 'Completo'), status = 'ativo';`. Para desfazer o isolamento, ver `docs/multiescritorio/README.md`.
