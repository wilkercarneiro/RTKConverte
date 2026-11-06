-- Medições de campo (supabase/migrations/0047_medicoes_campo.sql): o escritório
-- vem do banco, cada empresa só vê e grava as suas, versão velha não
-- sobrescreve a nova e quem criou não muda. Numa transação desfeita.
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
-- a mensagem do erro (a tela separa "outra conta" de "sessão vencida" por ela)
create function pg_temp.erro(cmd text) returns text language plpgsql as $$
begin
  execute cmd;
  return null;
exception when others then
  return sqlerrm;
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

select pg_temp.ok(to_regclass('medicoes_campo') is not null, 'tabela medicoes_campo existe');
select pg_temp.ok((select relrowsecurity from pg_class where relname = 'medicoes_campo'), 'RLS ligada em medicoes_campo');

-- ---------------------------------------------------------------- como membro da empresa A
select set_config('request.jwt.claim.sub', :'ua', false);
set role authenticated;
insert into medicoes_campo (id, nome, vertices, fechada, n_vertices, area_m2, criado_em, atualizado_em)
values ('11111111-1111-4111-8111-111111111111', 'Pasto do Sr. João',
        '[{"lon": -41.39, "lat": -12.56, "precisao": 3, "t": 0, "modo": "ponto"}]', true, 1, 26123.4,
        '2026-11-06T17:32:00Z', '2026-11-06T17:40:00Z');
select pg_temp.ok((select escritorio_id from medicoes_campo where id = '11111111-1111-4111-8111-111111111111') = :'esc_a',
                  'o escritório vem do banco (gatilho preencher_escritorio)');
select pg_temp.ok((select criado_por from medicoes_campo where id = '11111111-1111-4111-8111-111111111111') = :'ua',
                  'criado_por é quem gravou');
insert into medicoes_campo (id, nome, criado_por) values ('55555555-5555-4555-8555-555555555555', 'Autor forjado', :'ub');
select pg_temp.ok((select criado_por from medicoes_campo where id = '55555555-5555-4555-8555-555555555555') = :'ua',
                  'o cliente não escolhe o criado_por (o gatilho põe quem gravou)');
delete from medicoes_campo where id = '55555555-5555-4555-8555-555555555555';
select pg_temp.ok(pg_temp.recusa(format(
  'insert into medicoes_campo (id, escritorio_id, nome) values (%L, %L, %L)', '22222222-2222-4222-8222-222222222222', :'esc_b', 'intrusa')),
  'não grava medição com o escritório de outra empresa');
select pg_temp.ok(pg_temp.recusa($$insert into medicoes_campo (id, nome, vertices) values ('33333333-3333-4333-8333-333333333333', 'x', '{"a": 1}')$$),
                  'vertices só aceita lista');
select pg_temp.ok(pg_temp.recusa($$insert into medicoes_campo (id, nome) values ('44444444-4444-4444-8444-444444444444', '   ')$$),
                  'nome vazio é recusado');

-- upsert pelo id (como a tela grava): versão nova entra, versão velha não sobrescreve
insert into medicoes_campo (id, nome, atualizado_em) values ('11111111-1111-4111-8111-111111111111', 'Renomeada no escritório', '2026-11-06T18:00:00Z')
  on conflict (id) do update set nome = excluded.nome, atualizado_em = excluded.atualizado_em;
select pg_temp.ok((select nome from medicoes_campo where id = '11111111-1111-4111-8111-111111111111') = 'Renomeada no escritório', 'upsert com versão nova grava');
insert into medicoes_campo (id, nome, atualizado_em) values ('11111111-1111-4111-8111-111111111111', 'Versão velha do celular', '2026-11-06T17:50:00Z')
  on conflict (id) do update set nome = excluded.nome, atualizado_em = excluded.atualizado_em;
select pg_temp.ok((select nome from medicoes_campo where id = '11111111-1111-4111-8111-111111111111') = 'Renomeada no escritório',
                  'versão mais velha não sobrescreve a mais nova');
-- a tela (conta.ts) sabe que a conta tem versão mais nova porque o upsert ... returning volta VAZIO
select pg_temp.ok(pg_temp.afetadas($$insert into medicoes_campo (id, nome, atualizado_em) values ('11111111-1111-4111-8111-111111111111', 'Outra velha', '2026-11-06T17:55:00Z')
  on conflict (id) do update set nome = excluded.nome, atualizado_em = excluded.atualizado_em returning atualizado_em$$) = 0,
  'upsert de versão velha não devolve linha (a tela guarda a do aparelho como cópia)');
update medicoes_campo set escritorio_id = :'esc_b', criado_por = null, atualizado_em = '2026-11-06T19:00:00Z' where id = '11111111-1111-4111-8111-111111111111';
select pg_temp.ok((select escritorio_id = :'esc_a' and criado_por = :'ua' from medicoes_campo where id = '11111111-1111-4111-8111-111111111111'),
                  'escritório e autor não mudam no update');

-- ---------------------------------------------------------------- como outra empresa
reset role;
select set_config('request.jwt.claim.sub', :'ub', false);
set role authenticated;
select pg_temp.ok(not exists (select 1 from medicoes_campo where id = '11111111-1111-4111-8111-111111111111'), 'outra empresa não vê a medição de A');
select pg_temp.ok(pg_temp.afetadas($$update medicoes_campo set nome = 'x' where id = '11111111-1111-4111-8111-111111111111'$$) = 0,
                  'outra empresa não altera a medição de A');
select pg_temp.ok(pg_temp.afetadas($$delete from medicoes_campo where id = '11111111-1111-4111-8111-111111111111'$$) = 0,
                  'outra empresa não apaga a medição de A');
-- o mesmo id por outra empresa: o upsert não toma a linha de A (RLS barra o update)
select pg_temp.ok(pg_temp.recusa($$insert into medicoes_campo (id, nome, atualizado_em) values ('11111111-1111-4111-8111-111111111111', 'sequestro', '2030-01-01')
  on conflict (id) do update set nome = excluded.nome, atualizado_em = excluded.atualizado_em$$),
  'outra empresa não sequestra a medição de A pelo upsert do id');
-- e o erro fala de row-level security (a tela mostra "é de outra conta", não "sessão expirou")
select pg_temp.ok(pg_temp.erro($$insert into medicoes_campo (id, nome, atualizado_em) values ('11111111-1111-4111-8111-111111111111', 'sequestro', '2030-01-01')
  on conflict (id) do update set nome = excluded.nome, atualizado_em = excluded.atualizado_em$$) ilike '%row-level security%',
  'o erro do sequestro é de row-level security');

-- ---------------------------------------------------------------- anônimo
reset role;
set role anon;
select pg_temp.ok(pg_temp.recusa('select count(*) from medicoes_campo'), 'anônimo não lê medições');
reset role;

-- ---------------------------------------------------------------- a dona apaga
select set_config('request.jwt.claim.sub', :'ua', false);
set role authenticated;
select pg_temp.ok(pg_temp.afetadas($$delete from medicoes_campo where id = '11111111-1111-4111-8111-111111111111'$$) = 1, 'a empresa apaga a sua medição');
reset role;

rollback;
