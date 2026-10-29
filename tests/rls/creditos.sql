-- Teste dos créditos de serviço (supabase/migrations/0027_creditos.sql).
-- Roda depois de tests/rls/auditoria.sql, no mesmo cenário:
--   A = escritório legado (a1 superadmin), B = plano Essencial (b1 dono, b2 gerente, b3 campo)
\set ON_ERROR_STOP 1

\set b1 '''b1000000-0000-0000-0000-000000000001'''

create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FALHOU: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;
create function pg_temp.erro(cmd text) returns text language plpgsql as $$
begin
  execute cmd;
  return null;
exception when others then
  return sqlerrm;
end $$;
grant execute on all functions in schema pg_temp to public;

select id as esc_a from escritorios where modelos_compartilhados \gset
select id as esc_b from escritorios where not modelos_compartilhados \gset
select id as pl_essencial from planos where nome = 'Essencial' \gset
select id as sv_glebas from servicos where escritorio_id = :'esc_b' limit 1 \gset

-- ---------------------------------------------------------------- sem teto, nada muda
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok((meus_creditos() -> 'total' ->> 'limite') is null, 'plano sem teto: total sem limite');
select pg_temp.ok((meus_creditos() -> 'total' ->> 'usado')::int = 0, 'serviços de antes da migração não contam');
insert into servicos (nome_arquivo_txt) values ('livre.txt');
select pg_temp.ok((meus_creditos() -> 'total' ->> 'usado')::int = 1, 'enviar o arquivo gasta um crédito');
reset role;

-- ---------------------------------------------------------------- o plano põe teto
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', false);
set role authenticated;
update planos set limite_servicos_mes = 3 where id = :'pl_essencial';
update plano_recursos set limite_mes = 2 where plano_id = :'pl_essencial' and recurso_chave = 'servico.completo';
reset role;

select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok((meus_creditos() -> 'servicos' -> 'servico.completo' ->> 'limite')::int = 2, 'teto do serviço vem do plano');
insert into servicos (nome_arquivo_txt) values ('segundo.txt');
select pg_temp.ok(pg_temp.erro($$insert into servicos (nome_arquivo_txt) values ('terceiro.txt')$$) like 'SEM_CREDITO:%',
                  'passou do teto do serviço: o banco recusa');
select pg_temp.ok(not (meus_creditos() -> 'servicos' -> 'servico.completo' ->> 'disponivel')::boolean, 'tela sabe que o completo acabou');
select pg_temp.ok((meus_creditos() -> 'servicos' -> 'servico.conferencia' ->> 'disponivel')::boolean, 'conferência ainda tem crédito');
insert into servicos (nome_arquivo_txt, modalidade) values ('conf.txt', 'conferencia');
select pg_temp.ok(pg_temp.erro($$insert into servicos (nome_arquivo_txt, modalidade) values ('conf2.txt', 'conferencia')$$) like 'SEM_CREDITO:%',
                  'passou do teto total: o banco recusa');
select pg_temp.ok(pg_temp.erro($$insert into servicos (nome_arquivo_txt, modalidade) values ('lot.txt', 'loteamento')$$) like '%plano da empresa não inclui%',
                  'modalidade fora do plano é recusada já no envio');
reset role;

-- ---------------------------------------------------------------- derivado não gasta
set session_replication_role = replica;
update servicos set tem_glebas = true where id = :'sv_glebas';
set session_replication_role = default;
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', false);
set role authenticated;
insert into servicos (nome_arquivo_txt, origem_id) values ('parte.txt', :'sv_glebas');
select pg_temp.ok((meus_creditos() -> 'total' ->> 'usado')::int = 3, 'gleba separada / parte da divisão não gasta crédito');
reset role;

-- ---------------------------------------------------------------- comprar créditos
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-000000000002', false);
set role authenticated;
select pg_temp.ok(pg_temp.erro($$select pedir_creditos(null, 'total', 5)$$) like '%dono%', 'só o dono compra créditos');
reset role;

select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pedir_creditos(null, 'total', 2) as pedido \gset
select pg_temp.ok((select status from creditos_extras where id = :'pedido') = 'pendente', 'pedido nasce pendente');
select pg_temp.ok(pg_temp.erro($$insert into servicos (nome_arquivo_txt) values ('espera.txt')$$) like 'SEM_CREDITO:%',
                  'pedido pendente ainda não vale');
select pg_temp.ok(pg_temp.erro(format($$update creditos_extras set status = 'aprovado' where id = %L$$, :'pedido')) is not null
                  or (select status from creditos_extras where id = :'pedido') = 'pendente', 'cliente não aprova o próprio pedido');
select pg_temp.ok(pg_temp.erro(format($$insert into creditos_extras (escritorio_id, quantidade, status) values (%L, 99, 'aprovado')$$, :'esc_b')) is not null,
                  'cliente não cria crédito direto');
select pg_temp.ok(pg_temp.erro(format($$insert into consumos_credito (escritorio_id, chave, mes, origem) values (%L, 'x', current_date, 'plano')$$, :'esc_b')) is not null,
                  'cliente não mexe nos consumos');
reset role;

select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok((select count(*) from sa_pedidos_credito_pendentes()) = 1, 'superadmin vê o pedido pendente');
select sa_resolver_pedido_credito(:'pedido', true);
reset role;

select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', false);
set role authenticated;
insert into servicos (id, nome_arquivo_txt) values ('ce000000-0000-0000-0000-000000000001', 'extra.txt');
select pg_temp.ok((select origem || ':' || extra_chave from consumos_credito where servico_id = 'ce000000-0000-0000-0000-000000000001') = 'extra:total',
                  'aprovado, o crédito extra paga o serviço acima do teto');
select pg_temp.ok((meus_creditos() -> 'total' ->> 'extra')::int = 1, 'saldo extra desconta');
-- apagar não devolve
delete from servicos where id = 'ce000000-0000-0000-0000-000000000001';
select pg_temp.ok((meus_creditos() -> 'total' ->> 'extra')::int = 1, 'apagar o serviço não devolve o crédito');
select pg_temp.ok((select count(*) from consumos_credito where servico_id is null) = 1, 'o consumo fica registrado sem o serviço');
reset role;

-- ---------------------------------------------------------------- negociação por empresa e pacotes
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select sa_definir_limite_empresa(:'esc_b', 'total', 10);
select sa_definir_limite_empresa(:'esc_b', 'servico.completo', null);
insert into pacotes_credito (escritorio_id, nome, chave, quantidade, preco) values (:'esc_b', 'CAR 10', 'servico.conferencia', 10, 450) returning id as pacote \gset
insert into pacotes_credito (escritorio_id, nome, quantidade) values (:'esc_a', 'Pacote do A', 5);
select pg_temp.ok((sa_creditos_empresa(:'esc_b') -> 'negociado' ->> 'total')::int = 10, 'teto negociado guardado');
reset role;

select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok((meus_creditos() -> 'total' ->> 'limite')::int = 10, 'a negociação da empresa vence o teto do plano');
select pg_temp.ok((meus_creditos() -> 'servicos' -> 'servico.completo' ->> 'limite') is null, 'serviço negociado sem teto');
insert into servicos (nome_arquivo_txt) values ('negociado.txt');
select pg_temp.ok((select origem from consumos_credito order by id desc limit 1) = 'plano', 'com o teto novo volta a usar a franquia');
select pg_temp.ok(jsonb_array_length(meus_creditos() -> 'pacotes') = 1, 'empresa vê só os próprios pacotes');
select pedir_creditos(:'pacote') as pedido2 \gset
select pg_temp.ok((select preco from creditos_extras where id = :'pedido2') = 450, 'pedido por pacote leva o preço negociado');
select cancelar_pedido_credito(:'pedido2');
select pg_temp.ok((select status from creditos_extras where id = :'pedido2') = 'cancelado', 'dono cancela o pedido pendente');
reset role;

select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select sa_definir_limite_empresa(:'esc_b', 'total', null, true);
select pg_temp.ok((sa_creditos_empresa(:'esc_b') -> 'negociado' ->> 'total') is null, 'seguir o plano apaga a negociação');
reset role;

\echo 'créditos: todos os testes passaram'
