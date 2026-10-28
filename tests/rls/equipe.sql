-- Teste da migração da equipe (supabase/migrations/0025_equipe.sql).
-- Roda depois de tests/rls/saas.sql, no mesmo cenário:
--   B = escritório do cadastro (b1 dono, b2 membro), plano Essencial
\set ON_ERROR_STOP 1

\set b1 '''b1000000-0000-0000-0000-000000000001'''
\set b2 '''b2000000-0000-0000-0000-000000000002'''
\set b3 '''b3000000-0000-0000-0000-000000000003'''
\set b4 '''b4000000-0000-0000-0000-000000000004'''

create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FALHOU: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;
create function pg_temp.recusa(cmd text) returns boolean language plpgsql as $$
begin
  execute cmd;
  return false;
exception when others then
  return true;
end $$;
create function pg_temp.afetadas(cmd text) returns int language plpgsql as $$
declare n int;
begin
  execute cmd;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on all functions in schema pg_temp to public;

select id as esc_b from escritorios where not modelos_compartilhados \gset

-- um terceiro funcionário em B (como a edge function faria, com a service_role)
insert into auth.users (id, email) values (:b3, 'campo@novo.test'), (:b4, 'extra@novo.test');
insert into membros_escritorio (escritorio_id, user_id, papel, nome, permissoes)
values (:'esc_b', :b3, 'membro', 'Equipe de Campo', array['servicos.criar']);

select pg_temp.ok((select permissoes from membros_escritorio where user_id = :b2) @> array['servicos.excluir', 'clientes.editar'],
                  'quem já era operador mantém o que fazia antes');
select pg_temp.ok(not ((select permissoes from membros_escritorio where user_id = :b2) @> array['equipe.gerenciar']),
                  'operador antigo não ganha gerenciar a equipe');

-- ---------------------------------------------------------------- dono
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok(tem_permissao('equipe.gerenciar') and tem_permissao('empresa.configurar'), 'dono tem todas as permissões');
select pg_temp.ok((select count(*) from listar_membros()) = 3, 'dono vê a equipe toda');
select pg_temp.ok(((pode_adicionar_membro()) ->> 'ok')::boolean, 'dono pode adicionar (sem limite no plano)');
select definir_membro(:b2, 'Maria Projetista', 'Projetista', array['servicos.criar', 'documentos.gerar', 'inventada'], true);
select pg_temp.ok((select permissoes from membros_escritorio where user_id = :b2) = array['documentos.gerar', 'servicos.criar'],
                  'permissões gravadas (a inventada é descartada)');
select pg_temp.ok((select nome from membros_escritorio where user_id = :b2) = 'Maria Projetista', 'nome e cargo gravados');
select pg_temp.ok(pg_temp.recusa(format('select definir_membro(%L, %L, null, null, false)', 'b1000000-0000-0000-0000-000000000001', 'Dono')),
                  'dono não se desativa');
reset role;

-- ---------------------------------------------------------------- operador com poucas permissões
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-000000000002', false);
set role authenticated;
select pg_temp.ok((select permissoes from meu_escritorio()) = array['documentos.gerar', 'servicos.criar'], 'meu_escritorio() traz as permissões');
select pg_temp.ok(pg_temp.afetadas('delete from servicos') = 0, 'sem servicos.excluir, nada é apagado');
select pg_temp.ok(pg_temp.recusa($$insert into clientes (nome) values ('sem permissão')$$), 'sem clientes.editar, não cadastra cliente');
select pg_temp.ok(pg_temp.afetadas($$update clientes set nome = 'x'$$) = 0, 'sem clientes.editar, não edita cliente');
select pg_temp.ok(pg_temp.recusa($$insert into credenciados (nome, prefixo_vertice) values ('X', 'XXXX')$$), 'sem cadastros.editar, não inclui credenciado');
select pg_temp.ok(pg_temp.afetadas($$update config_empresa set value = 'hack'$$) = 0, 'sem empresa.configurar, não mexe nos dados da empresa');
select pg_temp.ok(pg_temp.recusa(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'templates', 'escritorios/' || :'esc_b' || '/logo-empresa.png')),
                  'sem empresa.configurar, não troca a logo');
select pg_temp.ok(pg_temp.recusa(format('select definir_membro(%L, null, null, %L, true)', 'b3000000-0000-0000-0000-000000000003', '{servicos.excluir}')),
                  'sem equipe.gerenciar, não mexe em ninguém');
select pg_temp.ok((select count(*) from listar_atividades()) = 0, 'sem equipe.gerenciar, não lê o histórico');
select pg_temp.ok(((pode_adicionar_membro()) ->> 'ok')::boolean is false, 'sem equipe.gerenciar, não adiciona ninguém');
reset role;

-- ---------------------------------------------------------------- gerente (não dono)
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select definir_membro(:b2, 'Maria Projetista', 'Gerente', array['equipe.gerenciar', 'servicos.criar'], true);
reset role;
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-000000000002', false);
set role authenticated;
select pg_temp.ok(pg_temp.recusa(format('select definir_membro(%L, null, null, %L, true)', 'b3000000-0000-0000-0000-000000000003', '{equipe.gerenciar}')),
                  'só o dono concede gerenciar a equipe');
select pg_temp.ok(pg_temp.recusa(format('select definir_membro(%L, %L, null, null, true)', 'b1000000-0000-0000-0000-000000000001', 'Outro')),
                  'gerente não altera o dono');
select pg_temp.ok(pg_temp.recusa(format('select definir_membro(%L, null, null, %L, true)', 'b2000000-0000-0000-0000-000000000002', '{servicos.criar}')),
                  'gerente não tira de si gerenciar a equipe');
select pg_temp.ok(pg_temp.recusa(format('select definir_membro(%L, null, null, %L, false)', 'b2000000-0000-0000-0000-000000000002', '{equipe.gerenciar}')),
                  'ninguém se desativa');
select definir_membro(:b3, 'Equipe de Campo', 'Campo', array['servicos.criar'], false);
select pg_temp.ok((select count(*) from listar_atividades() where acao = 'membro.desativado') = 1, 'histórico registra a desativação');
select pg_temp.ok(pg_temp.recusa(format('select remover_membro(%L)', 'b1000000-0000-0000-0000-000000000001')), 'dono não é removido');
reset role;

-- ---------------------------------------------------------------- desativado
select set_config('request.jwt.claim.sub', 'b3000000-0000-0000-0000-000000000003', false);
set role authenticated;
select pg_temp.ok((select count(*) from clientes) = 0 and (select count(*) from servicos) = 0, 'desativado não vê os dados da empresa');
select pg_temp.ok((select ativo from meu_escritorio()) = false, 'meu_escritorio() diz que está desativado');
select pg_temp.ok(not tem_permissao('servicos.criar'), 'desativado não tem permissão nenhuma');
reset role;

-- ---------------------------------------------------------------- limite do plano
update planos set limite_usuarios = 3 where nome = 'Essencial';
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select definir_membro(:b3, 'Equipe de Campo', 'Campo', array['servicos.criar'], true);
select pg_temp.ok((select count(*) from listar_membros() where ativo) = 3, 'reativou dentro do limite (3 de 3)');
select pg_temp.ok(((pode_adicionar_membro()) ->> 'ok')::boolean is false, 'no limite, não pode adicionar');
select pg_temp.ok((select count(*) from listar_atividades()) >= 2, 'dono lê o histórico');
reset role;
select pg_temp.ok(pg_temp.recusa(format('insert into membros_escritorio (escritorio_id, user_id, papel) values (%L, %L, %L)', :'esc_b', 'b4000000-0000-0000-0000-000000000004', 'membro')),
                  'o banco recusa passar do limite do plano');
update planos set limite_usuarios = null where nome = 'Essencial';

-- ---------------------------------------------------------------- histórico automático
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', false);
set role authenticated;
insert into clientes (nome) values ('Cliente do histórico');
select pg_temp.ok((select alvo from listar_atividades() where acao = 'cliente.criado' limit 1) = 'Cliente do histórico', 'cliente criado vai ao histórico');
reset role;

\echo 'equipe: todos os testes passaram'
