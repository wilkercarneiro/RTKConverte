-- GEO de cada parte da divisão gasta crédito; a gleba separada continua sem
-- gastar (supabase/migrations/0036_geo_da_parte_gasta_credito.sql).
-- Roda depois de tests/rls/leitura.sql: A = escritório legado (plano Completo, sem limite).
\set ON_ERROR_STOP 1

create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FALHOU: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;

select id as esc_a from escritorios where modelos_compartilhados \gset

insert into servicos (escritorio_id, nome_arquivo_txt, tem_glebas) values (:'esc_a', 'mae-glebas.txt', true) returning id as mae_g \gset
insert into servicos (escritorio_id, nome_arquivo_txt, tem_glebas, divisao) values (:'esc_a', 'mae-divisao.txt', true, '{"iguais": true}') returning id as mae_d \gset
insert into servicos (escritorio_id, nome_arquivo_txt, origem_id) values (:'esc_a', 'gleba.txt', :'mae_g') returning id as filho_g \gset
insert into servicos (escritorio_id, nome_arquivo_txt, origem_id) values (:'esc_a', 'herdeiro-1.txt', :'mae_d') returning id as filho_d1 \gset
insert into servicos (escritorio_id, nome_arquivo_txt, origem_id) values (:'esc_a', 'herdeiro-2.txt', :'mae_d') returning id as filho_d2 \gset

select pg_temp.ok((select count(*) from consumos_credito where servico_id = :'mae_d') = 1, 'o serviço da divisão gasta o crédito dele');
select pg_temp.ok(not exists (select 1 from consumos_credito where servico_id = :'filho_g'), 'gleba separada em serviço próprio não gasta crédito');
select pg_temp.ok((select count(*) from consumos_credito where servico_id in (:'filho_d1', :'filho_d2')) = 2, 'GEO de cada parte da divisão gasta 1 crédito por parte');
