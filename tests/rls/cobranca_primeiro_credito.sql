-- Teste da mensalidade que começa no 1º crédito gasto e do convite de cadastro
-- (supabase/migrations/0049_cobranca_primeiro_credito.sql). Roda no fim do
-- npm run test:rls, no mesmo banco: planos da 0034, Asaas ligado pelo teste da
-- 0040, superadmin do teste da 0024.
\set ON_ERROR_STOP 1

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

select id as pl_autonomo from planos where nome = 'Autônomo' \gset
-- um teste anterior pode ter tirado o plano de linha: aqui ele vale (6 gerais/mês, R$ 299,90)
update planos set ativo = true, preco_mensal = coalesce(preco_mensal, 299.90) where id = :'pl_autonomo';
select user_id as sa from super_admins limit 1 \gset
-- um dia de renovação diferente de hoje: o 1º crédito tem de trocá-lo
select (extract(day from hoje_brasil())::int % 28) + 1 as dia_outro \gset
insert into cobranca_config (key, value) values ('asaas_api_key', '$aact_teste')
on conflict (key) do update set value = excluded.value;

-- ---------------------------------------------------------------- a empresa escolhida
\set esc '\'9c000000-0000-0000-0000-0000000000c1\''
\set dona '\'9c100000-0000-0000-0000-0000000000a1\''
insert into auth.users (id, email) values (:dona, 'dona@primeiro.test') on conflict do nothing;
insert into escritorios (id, nome, status, plano_id, cnpj, origem, dia_renovacao)
values (:esc, 'Primeiro Crédito Geo', 'ativo', :'pl_autonomo', '86288366757', 'convite', :dia_outro);
insert into membros_escritorio (escritorio_id, user_id, papel) values (:esc, :dona, 'dono');
insert into cobranca_empresas (escritorio_id, ciclo, valor, situacao, inicio_no_primeiro_credito)
values (:esc, 'MONTHLY', 299.90, 'sem_assinatura', true);
select pg_temp.ok(true, 'origem convite é aceita');

select set_config('request.jwt.claim.sub', '9c100000-0000-0000-0000-0000000000a1', false);
set role authenticated;
select minha_cobranca() as mc \gset
select pg_temp.ok((:'mc'::jsonb ->> 'inicio_no_primeiro_credito')::boolean and not (:'mc'::jsonb ->> 'mensalidade_a_iniciar')::boolean
                  and :'mc'::jsonb ->> 'primeiro_credito_em' is null and :'mc'::jsonb ->> 'status' = 'ativo',
                  'a empresa entra liberada e a tela sabe que a mensalidade espera o 1º crédito');
select pg_temp.ok(not (:'mc'::jsonb ->> 'precisa_cartao')::boolean, 'antes do 1º crédito não pede o cartão (criaria a assinatura antes da hora)');
select pg_temp.ok(pg_temp.erro($$update cobranca_empresas set inicio_no_primeiro_credito = false$$) is not null
                  and pg_temp.erro($$update escritorios set origem = 'painel' where id = '9c000000-0000-0000-0000-0000000000c1'$$) is not null,
                  'o cliente não mexe na condição nem na origem');
reset role;

select set_config('request.jwt.claim.sub', :'sa', false);
set role authenticated;
select pg_temp.ok((select inicio_cobranca from sa_empresas() where id = :esc) = 'esperando', 'o painel mostra: esperando o 1º crédito');
reset role;

-- ---------------------------------------------------------------- o 1º crédito
select set_config('request.jwt.claim.sub', '9c100000-0000-0000-0000-0000000000a1', false);
set role authenticated;
insert into servicos (id, nome_arquivo_txt) values ('9c200000-0000-0000-0000-000000000001', 'primeiro.txt');
reset role;
select pg_temp.ok((select primeiro_credito_em from cobranca_empresas where escritorio_id = :esc) is not null,
                  'o 1º crédito gasto marca o dia');
select pg_temp.ok((select dia_renovacao from escritorios where id = :esc) = extract(day from hoje_brasil())::int
                  and inicio_periodo(:esc) = hoje_brasil(),
                  'o mês dos créditos passa a começar hoje (crédito e mensalidade andam juntos)');
select pg_temp.ok(uso_credito(:esc, 'geral') = 1, 'e o crédito gasto conta no período novo');
select pg_temp.ok(exists (select 1 from atividades where escritorio_id = :esc and acao = 'cobranca.primeiro_credito'), 'fica no histórico da empresa');
select primeiro_credito_em as marca from cobranca_empresas where escritorio_id = :esc \gset

select set_config('request.jwt.claim.sub', '9c100000-0000-0000-0000-0000000000a1', false);
set role authenticated;
select minha_cobranca() as mc \gset
select pg_temp.ok((:'mc'::jsonb ->> 'mensalidade_a_iniciar')::boolean, 'a tela vê que a mensalidade tem de começar (e chama a função)');
select pg_temp.ok(not (:'mc'::jsonb ->> 'precisa_cartao')::boolean, 'até a cobrança existir, ainda não pede o cartão');
insert into servicos (id, nome_arquivo_txt) values ('9c200000-0000-0000-0000-000000000002', 'segundo.txt');
reset role;
select pg_temp.ok((select primeiro_credito_em from cobranca_empresas where escritorio_id = :esc) = :'marca'::timestamptz,
                  'o 2º crédito não muda o dia: vale só o primeiro');
select pg_temp.ok((select count(*) from atividades where escritorio_id = :esc and acao = 'cobranca.primeiro_credito') = 1, 'e não repete o histórico');

select set_config('request.jwt.claim.sub', :'sa', false);
set role authenticated;
select pg_temp.ok((select inicio_cobranca from sa_empresas() where id = :esc) = 'a_iniciar', 'o painel mostra: gastou, falta a cobrança');
reset role;

-- a função criou a cobrança no Asaas
update cobranca_empresas set mensalidade_iniciada_em = now(), asaas_assinatura_id = 'sub_pc', situacao = 'aguardando'
 where escritorio_id = :esc;
select set_config('request.jwt.claim.sub', '9c100000-0000-0000-0000-0000000000a1', false);
set role authenticated;
select minha_cobranca() as mc \gset
select pg_temp.ok(not (:'mc'::jsonb ->> 'mensalidade_a_iniciar')::boolean and (:'mc'::jsonb ->> 'precisa_cartao')::boolean,
                  'cobrança criada: nada mais a iniciar, e agora pede o cartão como para qualquer empresa');
reset role;
select set_config('request.jwt.claim.sub', :'sa', false);
set role authenticated;
select pg_temp.ok((select inicio_cobranca from sa_empresas() where id = :esc) is null, 'e some do painel como pendência');
reset role;

-- empresa sem a condição: gastar crédito não marca nada
select escritorio_id as esc_b from membros_escritorio where user_id = 'b1000000-0000-0000-0000-000000000001' limit 1 \gset
select pg_temp.ok(not exists (select 1 from cobranca_empresas where escritorio_id = :'esc_b' and primeiro_credito_em is not null),
                  'empresa sem a condição: o gatilho não marca');
select pg_temp.ok(not espera_primeiro_credito(:'esc_b'), 'e não espera o 1º crédito');

-- ---------------------------------------------------------------- o convite
select set_config('request.jwt.claim.sub', '9c100000-0000-0000-0000-0000000000a1', false);
set role authenticated;
select pg_temp.ok(pg_temp.erro(format('select sa_criar_convite(%L)', :'pl_autonomo')) is not null, 'cliente não cria convite');
select pg_temp.ok(pg_temp.erro('select count(*) from convites_cadastro') is not null, 'cliente não lê os convites');
reset role;

select set_config('request.jwt.claim.sub', :'sa', false);
set role authenticated;
select sa_criar_convite(:'pl_autonomo', '  Fulano da Geo  ', 30) as cv \gset
select pg_temp.ok((:'cv'::jsonb ->> 'token') ~ '^[0-9a-f]{64}$', 'o superadmin cria o convite com um token de 64 caracteres');
select pg_temp.ok((:'cv'::jsonb ->> 'expira_em')::timestamptz between now() + interval '29 days' and now() + interval '31 days', 'vale 30 dias');
select sa_criar_convite(:'pl_autonomo', null, 7) as cv2 \gset
select pg_temp.ok(:'cv'::jsonb ->> 'token' <> :'cv2'::jsonb ->> 'token', 'cada convite tem o seu token');
select pg_temp.ok(pg_temp.erro(format('select sa_criar_convite(%L, null, 0)', :'pl_autonomo')) like '%1 a 90 dias%', 'validade fora de 1 a 90 dias: recusa');
select pg_temp.ok(jsonb_array_length(sa_convites()) >= 2
                  and (select x ->> 'nome' from jsonb_array_elements(sa_convites()) x where x ->> 'id' = :'cv'::jsonb ->> 'id') = 'Fulano da Geo'
                  and (select x ->> 'situacao' from jsonb_array_elements(sa_convites()) x where x ->> 'id' = :'cv'::jsonb ->> 'id') = 'aberto',
                  'a lista mostra o convite aberto, com para quem é');
reset role;
insert into planos (id, nome, ativo, preco_mensal) values ('9c300000-0000-0000-0000-000000000001', 'Sem preço (teste)', true, null);
select set_config('request.jwt.claim.sub', :'sa', false);
set role authenticated;
select pg_temp.ok(pg_temp.erro($$select sa_criar_convite('9c300000-0000-0000-0000-000000000001')$$) like '%não tem mensalidade%',
                  'plano sem mensalidade não vira convite');
reset role;

set role anon;
select convite_cadastro(:'cv'::jsonb ->> 'token') as pub \gset
select pg_temp.ok((:'pub'::jsonb ->> 'valido')::boolean and :'pub'::jsonb #>> '{plano,nome}' = 'Autônomo'
                  and (:'pub'::jsonb ->> 'inicio_no_primeiro_credito')::boolean and :'pub'::jsonb ? 'regras',
                  'a página pública abre o convite: plano e regras');
select pg_temp.ok(not (:'pub'::jsonb ? 'nome'), 'sem dizer para quem era');
select pg_temp.ok(convite_cadastro(repeat('a', 64)) ->> 'motivo' = 'inexistente' and convite_cadastro('x'' or 1=1') ->> 'motivo' = 'inexistente',
                  'token desconhecido ou torto: inexistente');
select pg_temp.ok(pg_temp.erro(format('select reservar_convite(%L)', :'cv'::jsonb ->> 'token')) is not null, 'anônimo não reserva convite');
select pg_temp.ok(pg_temp.erro('select count(*) from convites_cadastro') is not null, 'anônimo não lê os convites');
reset role;

set role service_role;
select reservar_convite(:'cv'::jsonb ->> 'token') as r \gset
select pg_temp.ok((:'r'::jsonb ->> 'plano_id')::uuid = :'pl_autonomo', 'a função reserva o convite (uso único)');
select pg_temp.ok(reservar_convite(:'cv'::jsonb ->> 'token') is null, 'a 2ª reserva não passa');
reset role;
set role anon;
select pg_temp.ok(convite_cadastro(:'cv'::jsonb ->> 'token') ->> 'motivo' = 'usado', 'convite usado não abre de novo');
reset role;

select set_config('request.jwt.claim.sub', :'sa', false);
set role authenticated;
select pg_temp.ok(pg_temp.erro(format('select sa_cancelar_convite(%L)', :'cv'::jsonb ->> 'id')) like '%usado ou cancelado%', 'convite usado não se cancela');
select sa_cancelar_convite((:'cv2'::jsonb ->> 'id')::uuid);
reset role;
set role anon;
select pg_temp.ok(convite_cadastro(:'cv2'::jsonb ->> 'token') ->> 'motivo' = 'cancelado', 'convite cancelado não abre');
reset role;
set role service_role;
select pg_temp.ok(reservar_convite(:'cv2'::jsonb ->> 'token') is null, 'nem é reservado');
reset role;

select set_config('request.jwt.claim.sub', :'sa', false);
set role authenticated;
select sa_criar_convite(:'pl_autonomo') as cv3 \gset
reset role;
update convites_cadastro set expira_em = now() - interval '1 minute' where id = (:'cv3'::jsonb ->> 'id')::uuid;
set role anon;
select pg_temp.ok(convite_cadastro(:'cv3'::jsonb ->> 'token') ->> 'motivo' = 'expirado', 'convite vencido não abre');
reset role;
set role service_role;
select pg_temp.ok(reservar_convite(:'cv3'::jsonb ->> 'token') is null, 'nem é reservado');
reset role;

-- o plano do convite saiu de linha depois: o convite não abre
select set_config('request.jwt.claim.sub', :'sa', false);
set role authenticated;
select sa_criar_convite(:'pl_autonomo') as cv4 \gset
reset role;
update planos set ativo = false where id = :'pl_autonomo';
set role anon;
select pg_temp.ok(convite_cadastro(:'cv4'::jsonb ->> 'token') ->> 'motivo' = 'plano', 'plano desativado: o convite não abre');
reset role;
update planos set ativo = true where id = :'pl_autonomo';

-- a migração roda de novo sem perder nada
\i supabase/migrations/0049_cobranca_primeiro_credito.sql
select pg_temp.ok((select inicio_no_primeiro_credito and primeiro_credito_em is not null from cobranca_empresas where escritorio_id = :esc)
                  and (select count(*) from convites_cadastro) >= 4, 'migração idempotente');
