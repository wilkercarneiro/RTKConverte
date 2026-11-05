-- Monografia dos marcos (supabase/migrations/0042_monografia.sql): a coluna
-- servicos.monografia herda o RLS de `servicos` — só a empresa do serviço lê e
-- grava — e só aceita objeto JSON. Numa transação desfeita.
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

select id as esc_a from escritorios where modelos_compartilhados order by id limit 1 \gset
select id as sa from servicos where escritorio_id = :'esc_a' order by id limit 1 \gset
select m.user_id as ub, m.escritorio_id as esc_b from membros_escritorio m
 where m.escritorio_id <> :'esc_a' and m.papel = 'dono' order by m.user_id limit 1 \gset
select id as sb from servicos where escritorio_id = :'esc_b' order by id limit 1 \gset

select pg_temp.ok(exists (select 1 from information_schema.columns where table_name = 'servicos' and column_name = 'monografia'),
                  'coluna servicos.monografia existe');
select pg_temp.ok(pg_temp.recusa(format('update servicos set monografia = %L where id = %L', '[1, 2]', :'sa')),
                  'monografia só aceita objeto JSON (lista é recusada)');
select pg_temp.ok(pg_temp.recusa(format('update servicos set monografia = %L where id = %L', '"texto"', :'sa')),
                  'monografia só aceita objeto JSON (texto é recusado)');
select pg_temp.ok(pg_temp.recusa(format('update servicos set monografia = jsonb_build_object(%L, repeat(%L, 600000)) where id = %L', 'equipamento', 'x', :'sa')),
                  'monografia gigante é recusada');
update servicos set monografia = '{"equipamento": "RECEPTOR DE A"}' where id = :'sa';

-- ---------------------------------------------------------------- como o dono de outra empresa
select set_config('request.jwt.claim.sub', :'ub', false);
set role authenticated;
select pg_temp.ok(not exists (select 1 from servicos where id = :'sa'), 'outra empresa não lê a monografia de A');
select pg_temp.ok(pg_temp.afetadas(format('update servicos set monografia = %L where id = %L', '{"equipamento": "intruso"}', :'sa')) = 0,
                  'outra empresa não grava a monografia de A');
select pg_temp.ok(pg_temp.afetadas(format('update servicos set monografia = %L where id = %L',
                  '{"data_levantamento": "12/08/2026", "marcos": {"M-1": {"acesso": "pela BA 408"}}}', :'sb')) = 1,
                  'a empresa grava a monografia do próprio serviço');
select pg_temp.ok((select monografia #>> '{marcos,M-1,acesso}' from servicos where id = :'sb') = 'pela BA 408',
                  'e lê o que gravou');
reset role;
select pg_temp.ok((select monografia ->> 'equipamento' from servicos where id = :'sa') = 'RECEPTOR DE A', 'a de A ficou intacta');

rollback;
