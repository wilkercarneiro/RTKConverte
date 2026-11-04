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

-- ---------------------------------------------------------------- a tela numera os marcos (GEO da parte antes de gerar)
-- O "Gerar GEO" da divisão reserva os números do credenciado pela tela
-- (alocar_contadores, como o gerar-documentos): um membro comum da empresa, sem
-- permissão de cadastro, precisa conseguir — e nunca o credenciado de outra empresa.
select escritorio_id as esc_b from membros_escritorio where user_id = 'b3000000-0000-0000-0000-000000000003' limit 1 \gset
insert into credenciados (nome, prefixo_vertice, contador_m, contador_p, contador_v, escritorio_id)
values ('CRED B', 'BBBB', 10, 20, 1, :'esc_b') returning id as cred_b \gset
insert into credenciados (nome, prefixo_vertice, contador_m, contador_p, contador_v, escritorio_id)
values ('CRED A', 'AAAA', 10, 20, 1, :'esc_a') returning id as cred_a \gset
select set_config('request.jwt.claim.sub', 'b3000000-0000-0000-0000-000000000003', false);
set role authenticated;
select base_m as bm, base_p as bp from alocar_contadores(:'cred_b', 2, 3, 0) \gset
select pg_temp.ok(:bm = 10 and :bp = 20, 'membro comum reserva os números do credenciado da empresa (devolve a base)');
select pg_temp.ok(not exists (select 1 from alocar_contadores(:'cred_a', 2, 3, 0)), 'credenciado de outra empresa: nenhuma reserva');
reset role;
select pg_temp.ok((select contador_m = 12 and contador_p = 23 and contador_v = 1 from credenciados where id = :'cred_b'), 'contadores andaram o que foi reservado');
select pg_temp.ok((select contador_m = 10 from credenciados where id = :'cred_a'), 'o da outra empresa ficou intacto');
