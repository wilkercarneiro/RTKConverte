-- Teste da taxa de adesão do autocadastro (supabase/migrations/0044_adesao.sql).
-- Roda depois de tests/rls/autocadastro.sql, no mesmo banco (planos da 0034,
-- Asaas e cadastro ligados pelo teste da 0040).
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
-- o fim do autocadastro.sql reaplica a 0040 (que redefine as funções): a 0044 volta por cima
\i supabase/migrations/0044_adesao.sql

-- ---------------------------------------------------------------- as regras
select pg_temp.ok((select value from cobranca_config where key = 'adesao_valor') = '500', 'a migração grava a adesão de hoje: R$ 500');
select pg_temp.ok((regras_cadastro() ->> 'adesao')::numeric = 500, 'as regras levam a adesão');
set role anon;
select pg_temp.ok((cadastro_planos() #>> '{regras,adesao}')::numeric = 500, 'a página pública de cadastro mostra a adesão');
reset role;
update cobranca_config set value = '750.50' where key = 'adesao_valor';
insert into cobranca_config (key, value) values ('adesao_texto', 'Implantação e treinamento.')
on conflict (key) do update set value = excluded.value;
select pg_temp.ok((regras_cadastro() ->> 'adesao')::numeric = 750.50 and regras_cadastro() ->> 'adesao_texto' = 'Implantação e treinamento.',
                  'o valor e o texto que o superadmin gravou valem');
update cobranca_config set value = 'abc' where key = 'adesao_valor';
select pg_temp.ok((regras_cadastro() ->> 'adesao')::numeric = 500, 'valor quebrado: o padrão (a página não cai)');
update cobranca_config set value = '0' where key = 'adesao_valor';
select pg_temp.ok((regras_cadastro() ->> 'adesao')::numeric = 0, '0 = sem adesão');
update cobranca_config set value = '500' where key = 'adesao_valor';
-- rodar de novo não passa por cima do valor gravado
update cobranca_config set value = '650' where key = 'adesao_valor';
\i supabase/migrations/0044_adesao.sql
select pg_temp.ok((select value from cobranca_config where key = 'adesao_valor') = '650', 'migração idempotente: não volta para 500');
update cobranca_config set value = '500' where key = 'adesao_valor';
select pg_temp.ok(pg_temp.erro($$insert into pagamentos (escritorio_id, finalidade, asaas_id, valor, status, adesao)
                                 values ((select id from escritorios limit 1), 'mensalidade', 'pay_neg', 1, 'PENDING', -1)$$) like '%pagamentos_adesao_valida%',
                  'adesão negativa não entra');

-- ---------------------------------------------------------------- Pix avulso: período + adesão
insert into auth.users (id, email) values ('ad100000-0000-0000-0000-0000000000a1', 'dona@adesao.test');
insert into escritorios (id, nome, status, plano_id, cnpj, origem)
values ('ad000000-0000-0000-0000-0000000000ad', 'Adesão Geo', 'aguardando_pagamento', :'pl_autonomo', '39053344705', 'site');
insert into membros_escritorio (escritorio_id, user_id, papel) values ('ad000000-0000-0000-0000-0000000000ad', 'ad100000-0000-0000-0000-0000000000a1', 'dono');
-- a função gerou o Pix avulso (sem assinatura) e gravou a parte da adesão
insert into cobranca_empresas (escritorio_id, asaas_cliente_id, ciclo, valor, situacao, link_pagamento, proximo_vencimento)
values ('ad000000-0000-0000-0000-0000000000ad', 'cus_ad', 'MONTHLY', 299.90, 'aguardando', 'https://sandbox.asaas.com/i/ad', hoje_brasil());
insert into pagamentos (escritorio_id, finalidade, asaas_id, valor, status, forma, link, vencimento, parcelas, ciclo, adesao)
values ('ad000000-0000-0000-0000-0000000000ad', 'mensalidade', 'pay_ad_1', 799.90, 'PENDING', 'PIX', 'https://sandbox.asaas.com/i/ad', hoje_brasil(), 1, 'MONTHLY', 500);

select set_config('request.jwt.claim.sub', 'ad100000-0000-0000-0000-0000000000a1', false);
set role authenticated;
select minha_cobranca() as mc \gset
select pg_temp.ok((:'mc'::jsonb #>> '{ultimo_pagamento,adesao}')::numeric = 500 and :'mc'::jsonb #>> '{ultimo_pagamento,forma}' = 'PIX'
                  and (:'mc'::jsonb #>> '{regras,adesao}')::numeric = 500,
                  'a tela de pagamento vê o Pix com adesão (e volta a mostrar o mesmo)');
reset role;

set role service_role;
select aplicar_pagamento_asaas('PAYMENT_RECEIVED', format('{"id": "pay_ad_1", "status": "RECEIVED", "billingType": "PIX", "value": 799.90, "dueDate": "%s"}',
                               hoje_brasil())::jsonb) as r \gset
select aplicar_pagamento_asaas('PAYMENT_CONFIRMED', format('{"id": "pay_ad_1", "status": "CONFIRMED", "billingType": "PIX", "value": 799.90, "dueDate": "%s"}',
                               hoje_brasil())::jsonb) as r2 \gset
reset role;
select pg_temp.ok(:'r'::jsonb ->> 'acao' = 'ativou' and (:'r'::jsonb ->> 'criar_assinatura')::boolean and :'r'::jsonb ->> 'ciclo' = 'MONTHLY'
                  and (:'r'::jsonb ->> 'proximo_vencimento')::date = (hoje_brasil() + interval '1 month')::date,
                  'Pix com adesão pago: ativa e pede a assinatura das renovações, vencendo daqui a um mês');
select pg_temp.ok(not (:'r2'::jsonb ? 'criar_assinatura'), 'o aviso repetido não pede outra assinatura');
select pg_temp.ok((select valor from pagamentos where asaas_id = 'pay_ad_1') = 799.90, 'o pagamento guarda o total (período + adesão)');
select pg_temp.ok((select valor from cobranca_empresas where escritorio_id = 'ad000000-0000-0000-0000-0000000000ad') = 299.90,
                  'a cobrança da empresa continua só com o plano (é o que renova)');
select pg_temp.ok((select status from escritorios where id = 'ad000000-0000-0000-0000-0000000000ad') = 'ativo', 'empresa ativa');

-- a fatura do mês seguinte, criada pela assinatura nova: sem adesão e sem pedir outra assinatura
update cobranca_empresas set asaas_assinatura_id = 'sub_ad' where escritorio_id = 'ad000000-0000-0000-0000-0000000000ad';
set role service_role;
select aplicar_pagamento_asaas('PAYMENT_RECEIVED', format('{"id": "pay_ad_2", "subscription": "sub_ad", "status": "RECEIVED", "billingType": "PIX", "value": 299.90, "dueDate": "%s"}',
                               (hoje_brasil() + interval '1 month')::date)::jsonb) as r3 \gset
reset role;
select pg_temp.ok(:'r3'::jsonb ->> 'acao' = 'renovou' and not (:'r3'::jsonb ? 'criar_assinatura')
                  and (select adesao from pagamentos where asaas_id = 'pay_ad_2') is null,
                  'renovação: só o plano, sem adesão');

-- pagamento sem adesão e sem parcelamento (a assinatura de antes) não pede assinatura
insert into escritorios (id, nome, status, plano_id, cnpj, origem)
values ('ad000000-0000-0000-0000-0000000000ae', 'Sem Adesão Geo', 'aguardando_pagamento', :'pl_autonomo', '15350946056', 'site');
insert into cobranca_empresas (escritorio_id, ciclo, valor, situacao) values ('ad000000-0000-0000-0000-0000000000ae', 'MONTHLY', 299.90, 'aguardando');
insert into pagamentos (escritorio_id, finalidade, asaas_id, valor, status, forma, vencimento, ciclo)
values ('ad000000-0000-0000-0000-0000000000ae', 'mensalidade', 'pay_sem_ad', 299.90, 'PENDING', 'PIX', hoje_brasil(), 'MONTHLY');
set role service_role;
select aplicar_pagamento_asaas('PAYMENT_RECEIVED', format('{"id": "pay_sem_ad", "status": "RECEIVED", "billingType": "PIX", "value": 299.90, "dueDate": "%s"}',
                               hoje_brasil())::jsonb) as r4 \gset
reset role;
select pg_temp.ok(:'r4'::jsonb ->> 'acao' = 'ativou' and not (:'r4'::jsonb ? 'criar_assinatura'), 'sem adesão: o comportamento de antes');

-- permissões
set role anon;
select pg_temp.ok(pg_temp.erro('select regras_cadastro()') like '%permission denied%', 'anônimo não chama as regras direto');
select pg_temp.ok(pg_temp.erro($$select aplicar_pagamento_asaas('PAYMENT_CONFIRMED', '{"id": "x"}')$$) like '%permission denied%', 'nem o webhook por dentro');
reset role;
