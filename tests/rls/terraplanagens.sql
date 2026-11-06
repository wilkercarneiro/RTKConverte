-- Terraplanagens (supabase/migrations/0046_terraplanagens.sql): o escritório
-- vem do banco, o autor é quem grava, cada empresa só vê e grava os seus
-- projetos e escritório/autor não mudam no update. Numa transação desfeita.
-- (Rodar depois das migrações de escritórios/equipe: npm run test:rls.)
\set ON_ERROR_STOP 1
begin;

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

select m.user_id as ua, m.escritorio_id as esc_a from membros_escritorio m join escritorios e on e.id = m.escritorio_id
 where e.status = 'ativo' and m.ativo order by m.escritorio_id, m.user_id limit 1 \gset
select m.user_id as ub, m.escritorio_id as esc_b from membros_escritorio m join escritorios e on e.id = m.escritorio_id
 where e.status = 'ativo' and m.ativo and m.escritorio_id <> :'esc_a' order by m.user_id limit 1 \gset

select pg_temp.ok(to_regclass('terraplanagens') is not null, 'tabela terraplanagens existe');
select pg_temp.ok((select relrowsecurity from pg_class where relname = 'terraplanagens'), 'RLS ligada em terraplanagens');

-- ---------------------------------------------------------------- como membro da empresa A
select set_config('request.jwt.claim.sub', :'ua', false);
set role authenticated;
insert into terraplanagens (id, nome, projeto, resumo, criado_por)
values ('66666666-6666-4666-8666-666666666666', 'Galpão do Sr. João', '{"pontos": []}', '{"corte": 10, "aterro": 10}', :'ub');
select pg_temp.ok((select escritorio_id from terraplanagens where id = '66666666-6666-4666-8666-666666666666') = :'esc_a',
                  'o escritório vem do banco (gatilho preencher_escritorio)');
select pg_temp.ok((select criado_por from terraplanagens where id = '66666666-6666-4666-8666-666666666666') = :'ua',
                  'o cliente não escolhe o criado_por (o gatilho põe quem gravou)');
select pg_temp.ok(pg_temp.recusa(format(
  'insert into terraplanagens (escritorio_id, nome) values (%L, %L)', :'esc_b', 'intruso')),
  'não grava projeto com o escritório de outra empresa');
select pg_temp.ok(pg_temp.recusa($$insert into terraplanagens (nome, projeto) values ('x', '[1, 2]')$$),
                  'projeto só aceita objeto');
select pg_temp.ok(pg_temp.recusa($$insert into terraplanagens (nome) values ('')$$),
                  'nome vazio é recusado');
update terraplanagens set escritorio_id = :'esc_b', criado_por = null, nome = 'Galpão (rev. 2)' where id = '66666666-6666-4666-8666-666666666666';
select pg_temp.ok((select escritorio_id = :'esc_a' and criado_por = :'ua' and nome = 'Galpão (rev. 2)'
                     from terraplanagens where id = '66666666-6666-4666-8666-666666666666'),
                  'o update grava, mas escritório e autor não mudam');

-- ---------------------------------------------------------------- como outra empresa
reset role;
select set_config('request.jwt.claim.sub', :'ub', false);
set role authenticated;
select pg_temp.ok(not exists (select 1 from terraplanagens where id = '66666666-6666-4666-8666-666666666666'), 'outra empresa não vê o projeto de A');
select pg_temp.ok(pg_temp.afetadas($$update terraplanagens set nome = 'x' where id = '66666666-6666-4666-8666-666666666666'$$) = 0,
                  'outra empresa não altera o projeto de A');
select pg_temp.ok(pg_temp.afetadas($$delete from terraplanagens where id = '66666666-6666-4666-8666-666666666666'$$) = 0,
                  'outra empresa não apaga o projeto de A');

-- ---------------------------------------------------------------- anônimo
reset role;
set role anon;
select pg_temp.ok(pg_temp.recusa('select count(*) from terraplanagens'), 'anônimo não lê terraplanagens');
reset role;

-- ---------------------------------------------------------------- a dona apaga
select set_config('request.jwt.claim.sub', :'ua', false);
set role authenticated;
select pg_temp.ok(pg_temp.afetadas($$delete from terraplanagens where id = '66666666-6666-4666-8666-666666666666'$$) = 1, 'a empresa apaga o seu projeto');
reset role;

rollback;
