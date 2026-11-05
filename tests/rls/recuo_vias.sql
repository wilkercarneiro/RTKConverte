-- Recuo legal das rodovias: servicos.recuo_vias (supabase/migrations/0041_recuo_vias.sql).
-- A coluna guarda um objeto (ou nulo) e o membro da empresa grava o do serviço
-- dele pela própria policy de servicos; outra coisa na coluna é recusada.
\set ON_ERROR_STOP 1

create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FALHOU: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;

select id as esc_a from escritorios where modelos_compartilhados \gset
insert into servicos (escritorio_id, nome_arquivo_txt) values (:'esc_a', 'recuo.txt') returning id as sid \gset

select pg_temp.ok((select recuo_vias is null from servicos where id = :'sid'), 'serviço novo nasce sem recuo gravado (vale o padrão)');

update servicos set recuo_vias = '{"planta": true, "vias": {"BR-116": {"dominio": 40, "naoEdificavel": 15, "confirmado": true}}}' where id = :'sid';
select pg_temp.ok((select recuo_vias #>> '{vias,BR-116,dominio}' = '40' from servicos where id = :'sid'), 'grava o recuo conferido de cada via');

do $$
begin
  begin
    update servicos set recuo_vias = '[1, 2]' where nome_arquivo_txt = 'recuo.txt';
    raise exception 'FALHOU: lista na coluna deveria ser recusada';
  exception when check_violation then
    raise notice 'ok: lista em vez de objeto é recusada (check)';
  end;
end $$;

delete from servicos where id = :'sid';
