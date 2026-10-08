# Vários escritórios (multiempresa) — como aplicar

Status: **pronto para aplicar, ainda NÃO aplicado em produção.** A migração está em
`docs/multiescritorio/0020_escritorios.sql` (fora de `supabase/migrations/` de
propósito, até o dono revisar e aplicar).

## O que muda

- Novo: `escritorios`, `membros_escritorio` (um escritório por conta; papel `dono`/`membro`), `aceites_termos`.
- `escritorio_id` em `servicos`, `clientes`, `credenciados`, `responsaveis_tecnicos`, `config_empresa` — preenchido sozinho no INSERT.
- Policies passam de "qualquer usuário logado vê tudo" para "só o meu escritório"; as tabelas filhas (`vertices`, `trechos_confrontantes`, `glebas`, `documentos_gerados`) seguem o serviço; o Storage (`gerados/{servico}/…`, `templates/escritorios/{id}/…`) também.
- Conta criada pela tela de cadastro com "novo escritório" vira dona de um escritório novo. Conta criada no painel do Supabase fica **sem escritório** até um dono adicioná-la (Configurações → Equipe) — nunca entra sozinha num escritório.

## O escritório que já usa (não pode parar)

- A migração cria UM escritório com **todos os dados e todos os usuários atuais**. Nome = razão social em Configurações (ou "Escritório principal").
- O primeiro usuário criado vira **dono**; os demais, operadores.
- Ele fica com `modelos_compartilhados = true`: continua usando os modelos e a logo da raiz do bucket `templates`, exatamente como hoje.
- Nenhuma linha é apagada. O teste local confere isso (abaixo).

## Ordem para aplicar

1. **Backup** antes de tudo: `bash scripts/backup-banco.sh` (ver `docs/operacao/backup-e-monitoramento.md`).
2. **Edge functions** já atualizadas (`bash scripts/deploy-functions.sh`). Elas funcionam antes e depois da migração — publique primeiro.
3. **Frontend** atualizado (também funciona nos dois estados do banco).
4. **Banco**: copie para `supabase/migrations/0020_escritorios.sql` e aplique (SQL Editor do painel, ou `npx supabase db push`).
5. Confira: `select e.nome, m.papel, u.email from membros_escritorio m join escritorios e on e.id = m.escritorio_id join auth.users u on u.id = m.user_id;` — toda conta listada passa a ver os dados do escritório. Tire quem não deveria estar (`delete from membros_escritorio where user_id = '…'`).
6. Entre no sistema com o usuário do escritório atual e confira se os serviços, clientes e a logo aparecem.
7. Só então: publique modelos neutros em `templates/padrao/…` (mesmos nomes da raiz, sem timbre de ninguém) para os escritórios novos, e ligue `VITE_CADASTRO_ABERTO=true` na Vercel.

## Teste antes de aplicar

```sh
npm run test:rls
```

Sobe um Postgres descartável, aplica as migrações do repositório + esta, e verifica (54 asserções): backfill sem perda, isolamento de leitura e escrita entre dois escritórios em todas as tabelas e no Storage, credenciado/RT/cliente de outro escritório recusado, cadastro criando escritório, equipe (só o dono adiciona), anônimo sem acesso e a compatibilidade com a edge function antiga. Precisa de `initdb`/`pg_ctl`/`psql` no PATH.

## Teste com dois escritórios de verdade (definição de pronto)

Depois de aplicar: crie duas contas pela tela de cadastro, cada uma com "novo escritório"; em cada uma, cadastre um cliente e envie um TXT. Uma não pode ver nada da outra (Clientes, Serviços, Configurações, Histórico).

## Volta atrás

A migração não apaga dados. Para desfazer o isolamento num aperto, recrie as policies `using (true)` das migrações 0001/0006/0007/0011/0017 — os dados continuam com `escritorio_id` e podem ser isolados de novo depois.
