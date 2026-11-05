-- Teste do autocadastro com pagamento (supabase/migrations/0040_autocadastro.sql).
-- Roda depois de tests/rls/cartao_recarga.sql, no mesmo cenário:
--   A = escritório legado (a1 superadmin), B = b1 dono, b2 gerente.
-- As empresas do site são criadas aqui como a edge function `cobranca` cria.
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
-- o plano `id` na lista pública
create function pg_temp.plano(c jsonb, id uuid) returns jsonb language sql as $$
  select x from jsonb_array_elements(c -> 'planos') x where x ->> 'id' = id::text
$$;
grant execute on all functions in schema pg_temp to public;

select id as pl_autonomo from planos where nome = 'Autônomo' \gset
select id as pl_prof from planos where nome = 'Profissional' \gset
select id as pl_car from planos where nome = 'Só CAR' \gset

-- ---------------------------------------------------------------- a migração
select pg_temp.ok((select count(*) from planos where vende_no_site) > 0
                  and not exists (select 1 from planos where ativo and coalesce(preco_mensal, 0) > 0 and not vende_no_site),
                  'os planos à venda com mensalidade entram no autocadastro');
select pg_temp.ok(not exists (select 1 from planos where vende_no_site and not ativo), 'plano fora do cadastro não é vendido no site');
select pg_temp.ok(not exists (select 1 from escritorios where origem <> 'painel'), 'as empresas de antes ficam como criadas no painel');
select pg_temp.ok(not exists (select 1 from cobranca_empresas where ciclo <> 'MONTHLY'), 'e as assinaturas de antes, mensais');
select pg_temp.ok(pg_temp.erro($$update escritorios set origem = 'loja' where id = (select id from escritorios limit 1)$$) like '%escritorios_origem_valida%',
                  'origem só painel ou site');

-- ---------------------------------------------------------------- a página pública (anônimo)
insert into cobranca_config (key, value) values ('asaas_api_key', '$aact_teste')
on conflict (key) do update set value = excluded.value;
set role anon;
select pg_temp.ok(pg_temp.erro('select * from cobranca_config') like '%permission denied%', 'anônimo não lê a configuração (nem a chave do Asaas)');
select pg_temp.ok(pg_temp.erro('select regras_cadastro()') like '%permission denied%', 'nem as regras direto');
select pg_temp.ok(pg_temp.erro('select minha_cobranca()') like '%permission denied%', 'nem a cobrança de alguém');
select pg_temp.ok(pg_temp.erro($$select aplicar_pagamento_asaas('PAYMENT_CONFIRMED', '{"id": "x"}')$$) like '%permission denied%', 'nem o webhook por dentro');
select cadastro_planos() as cp \gset
select pg_temp.ok(not (:'cp'::jsonb ->> 'aberto')::boolean, 'cadastro fechado até o superadmin abrir');
reset role;

insert into cobranca_config (key, value) values ('cadastro_aberto', 'true')
on conflict (key) do update set value = excluded.value;
set role anon;
select cadastro_planos() as cp \gset
select pg_temp.ok((:'cp'::jsonb ->> 'aberto')::boolean, 'aberto pelo superadmin e com o Asaas ligado');
select pg_temp.ok(position('aact' in :'cp') = 0 and position('webhook' in :'cp') = 0, 'nada da configuração do Asaas sai na página');
select pg_temp.ok((:'cp'::jsonb #>> '{regras,parcelas_sem_juros}')::int = 6 and (:'cp'::jsonb #>> '{regras,parcelas_max}')::int = 12
                  and (:'cp'::jsonb #>> '{regras,juros_mes}')::numeric = 2.99
                  and (:'cp'::jsonb #>> '{regras,ciclos,MONTHLY,ativo}')::boolean and (:'cp'::jsonb #>> '{regras,ciclos,YEARLY,ativo}')::boolean,
                  'regras padrão: 6 sem juros, 12 no máximo, 2,99% a.m., os três períodos');
select pg_temp.ok(pg_temp.plano(:'cp'::jsonb, :'pl_prof') ->> 'nome' = 'Profissional'
                  and (pg_temp.plano(:'cp'::jsonb, :'pl_prof') ->> 'mensalidade')::numeric > 0, 'o Profissional está à venda, com a mensalidade');
select pg_temp.ok(jsonb_array_length(pg_temp.plano(:'cp'::jsonb, :'pl_prof') -> 'creditos') = 2
                  and (select (x ->> 'por_mes')::int from jsonb_array_elements(pg_temp.plano(:'cp'::jsonb, :'pl_prof') -> 'creditos') x where x ->> 'tipo' = 'geral') = 12,
                  'com os créditos por mês de cada carteira');
select pg_temp.ok(pg_temp.plano(:'cp'::jsonb, :'pl_prof') -> 'extra' ? 'geral', 'e o preço do crédito extra');
reset role;

update planos set vende_no_site = false where id = :'pl_prof';
set role anon;
select pg_temp.ok(pg_temp.plano(cadastro_planos(), :'pl_prof') is null, 'plano tirado do autocadastro some da página');
reset role;
update planos set vende_no_site = true where id = :'pl_prof';

-- valor quebrado no banco não derruba a página: vale o padrão
insert into cobranca_config (key, value) values ('ciclos', '{quebrado'), ('juros_mes', 'abc')
on conflict (key) do update set value = excluded.value;
select pg_temp.ok((regras_cadastro() ->> 'juros_mes')::numeric = 2.99 and (regras_cadastro() #>> '{ciclos,YEARLY,ativo}')::boolean,
                  'configuração quebrada: os padrões');
update cobranca_config set value = '{"YEARLY": {"ativo": true, "desconto": 10}, "SEMIANNUALLY": {"ativo": false, "desconto": 0}}' where key = 'ciclos';
update cobranca_config set value = '1.99' where key = 'juros_mes';
select pg_temp.ok((regras_cadastro() #>> '{ciclos,YEARLY,desconto}')::numeric = 10 and not (regras_cadastro() #>> '{ciclos,SEMIANNUALLY,ativo}')::boolean
                  and (regras_cadastro() #>> '{ciclos,MONTHLY,ativo}')::boolean and (regras_cadastro() ->> 'juros_mes')::numeric = 1.99,
                  'o que o superadmin gravou vale; o período que ele não mexeu fica com o padrão');

-- ---------------------------------------------------------------- empresa do site, anual, no Pix
insert into auth.users (id, email) values ('e1000000-0000-0000-0000-0000000000e1', 'dona@site.test');
insert into escritorios (id, nome, status, plano_id, cnpj, telefone, email, responsavel, origem)
values ('e0000000-0000-0000-0000-00000000000e', 'Site Topografia', 'aguardando_pagamento', :'pl_autonomo', '52998224725',
        '71988887777', 'dona@site.test', 'Ana Lima', 'site');
insert into membros_escritorio (escritorio_id, user_id, papel) values ('e0000000-0000-0000-0000-00000000000e', 'e1000000-0000-0000-0000-0000000000e1', 'dono');
insert into cobranca_empresas (escritorio_id, ciclo, valor, situacao)
values ('e0000000-0000-0000-0000-00000000000e', 'YEARLY', 3238.92, 'sem_assinatura');

select set_config('request.jwt.claim.sub', 'e1000000-0000-0000-0000-0000000000e1', false);
set role authenticated;
select minha_cobranca() as mc \gset
select pg_temp.ok(:'mc'::jsonb ->> 'status' = 'aguardando_pagamento' and :'mc'::jsonb ->> 'origem' = 'site'
                  and :'mc'::jsonb ->> 'ciclo' = 'YEARLY' and (:'mc'::jsonb ->> 'valor')::numeric = 3238.92,
                  'a dona vê a conta esperando o pagamento do ano');
select pg_temp.ok((:'mc'::jsonb ->> 'mensalidade')::numeric = (select preco_mensal from planos where id = :'pl_autonomo')
                  and (:'mc'::jsonb #>> '{regras,ciclos,YEARLY,desconto}')::numeric = 10 and not (:'mc'::jsonb ->> 'assinatura')::boolean
                  and :'mc'::jsonb -> 'ultimo_pagamento' = 'null'::jsonb and (:'mc'::jsonb ->> 'sou_dono')::boolean,
                  'com a mensalidade do plano, as regras e sem pagamento ainda (a tela de pagamento monta com isso)');
select pg_temp.ok(:'mc'::jsonb ? 'link' and :'mc'::jsonb ? 'cartao' and :'mc'::jsonb ? 'contato', 'os campos de antes continuam');
select pg_temp.ok(escritorio_atual() is null, 'antes de pagar, não vê os dados de empresa nenhuma');
select pg_temp.ok(pg_temp.erro('select cadastro_planos()') is null, 'logada, também lê os planos à venda');
reset role;

-- a função criou a assinatura anual (Pix, vencendo hoje) e o webhook confirma
update cobranca_empresas set asaas_cliente_id = 'cus_site', asaas_assinatura_id = 'sub_anual', situacao = 'aguardando',
       link_pagamento = 'https://sandbox.asaas.com/i/anual', proximo_vencimento = hoje_brasil()
 where escritorio_id = 'e0000000-0000-0000-0000-00000000000e';
insert into pagamentos (escritorio_id, finalidade, asaas_id, valor, status, link, vencimento, ciclo)
values ('e0000000-0000-0000-0000-00000000000e', 'mensalidade', 'pay_anual_1', 3238.92, 'PENDING', 'https://sandbox.asaas.com/i/anual', hoje_brasil(), 'YEARLY');
set role service_role;
select aplicar_pagamento_asaas('PAYMENT_RECEIVED', format('{"id": "pay_anual_1", "subscription": "sub_anual", "status": "RECEIVED", "billingType": "PIX", "value": 3238.92, "dueDate": "%s"}',
                               hoje_brasil())::jsonb) as r \gset
reset role;
select pg_temp.ok(:'r'::jsonb ->> 'acao' = 'ativou' and not (:'r'::jsonb ? 'criar_assinatura'), 'Pix do ano pago: ativa (a assinatura já existe)');
select pg_temp.ok((select proximo_vencimento from cobranca_empresas where escritorio_id = 'e0000000-0000-0000-0000-00000000000e')
                  = (hoje_brasil() + interval '12 months')::date, '(a) o próximo vencimento é daqui a um ano, não a um mês');
select pg_temp.ok((select status from escritorios where id = 'e0000000-0000-0000-0000-00000000000e') = 'ativo', 'empresa ativa');

-- a cobrança do ano seguinte, criada pela assinatura: entra com o período
set role service_role;
select aplicar_pagamento_asaas('PAYMENT_CREATED', format('{"id": "pay_anual_2", "subscription": "sub_anual", "status": "PENDING", "value": 3238.92, "dueDate": "%s"}',
                               (hoje_brasil() + interval '12 months')::date)::jsonb);
reset role;
select pg_temp.ok((select ciclo || ':' || valor from pagamentos where asaas_id = 'pay_anual_2') = 'YEARLY:3238.92', 'a fatura do ano seguinte entra com o período');

-- ---------------------------------------------------------------- cartão em 12x
insert into escritorios (id, nome, status, plano_id, cnpj, origem)
values ('f0000000-0000-0000-0000-00000000000f', 'Parcelada Geo', 'aguardando_pagamento', :'pl_autonomo', '11444777000161', 'site');
insert into cobranca_empresas (escritorio_id, asaas_cliente_id, ciclo, valor, situacao)
values ('f0000000-0000-0000-0000-00000000000f', 'cus_parc', 'YEARLY', 3238.92, 'aguardando');
-- a função cobrou o cartão (aprovado) e gravou a 1ª parcela com o TOTAL
insert into pagamentos (escritorio_id, finalidade, asaas_id, valor, status, forma, vencimento, parcelas, asaas_parcelamento, ciclo)
values ('f0000000-0000-0000-0000-00000000000f', 'mensalidade', 'pay_parc_1', 3600.00, 'CONFIRMED', 'CREDIT_CARD', hoje_brasil(), 12, 'inst_1', 'YEARLY');
set role service_role;
select aplicar_pagamento_asaas('CONFERENCIA', format('{"id": "pay_parc_1", "status": "CONFIRMED", "billingType": "CREDIT_CARD", "value": 300.00, "dueDate": "%s", "installment": "inst_1", "installmentNumber": 1}',
                               hoje_brasil())::jsonb) as r \gset
select aplicar_pagamento_asaas('PAYMENT_CONFIRMED', format('{"id": "pay_parc_1", "status": "CONFIRMED", "billingType": "CREDIT_CARD", "value": 300.00, "dueDate": "%s", "installment": "inst_1"}',
                               hoje_brasil())::jsonb) as r2 \gset
reset role;
select pg_temp.ok(:'r'::jsonb ->> 'acao' = 'ativou' and (:'r'::jsonb ->> 'criar_assinatura')::boolean and :'r'::jsonb ->> 'ciclo' = 'YEARLY'
                  and (:'r'::jsonb ->> 'proximo_vencimento')::date = (hoje_brasil() + interval '12 months')::date,
                  '12x aprovado: ativa e pede a assinatura dos próximos anos, vencendo daqui a um ano');
select pg_temp.ok(:'r2'::jsonb ->> 'acao' = 'renovou' and not (:'r2'::jsonb ? 'criar_assinatura'), 'o aviso repetido não pede outra assinatura');
select pg_temp.ok((select valor from pagamentos where asaas_id = 'pay_parc_1') = 3600.00, '(d) a compra guarda o total, não o valor da parcela');

-- (b) as parcelas 2..N chegam com o id do parcelamento
set role service_role;
select pg_temp.ok((aplicar_pagamento_asaas('PAYMENT_CONFIRMED', format('{"id": "pay_parc_2", "status": "CONFIRMED", "billingType": "CREDIT_CARD", "value": 300.00, "dueDate": "%s", "installment": "inst_1", "installmentNumber": 2}',
                    (hoje_brasil() + interval '1 month')::date)::jsonb) ->> 'acao') = 'parcela', '(b) a parcela 2 é reconhecida pelo parcelamento');
reset role;
select pg_temp.ok((select finalidade || ':' || parcela || ':' || valor || ':' || ciclo from pagamentos where asaas_id = 'pay_parc_2') = 'parcela:2:300.00:YEARLY',
                  'e fica registrada como parcela da compra');
update escritorios set status = 'aguardando_pagamento' where id = 'f0000000-0000-0000-0000-00000000000f';
set role service_role;
select pg_temp.ok((aplicar_pagamento_asaas('PAYMENT_RECEIVED', '{"id": "pay_parc_3", "status": "RECEIVED", "value": 300.00, "installment": "inst_1", "installmentNumber": 3}') ->> 'acao') = 'parcela',
                  'parcela 3 recebida');
reset role;
select pg_temp.ok((select status from escritorios where id = 'f0000000-0000-0000-0000-00000000000f') = 'aguardando_pagamento',
                  'parcela paga não reativa uma empresa suspensa');
update escritorios set status = 'ativo' where id = 'f0000000-0000-0000-0000-00000000000f';
set role service_role;
select pg_temp.ok((aplicar_pagamento_asaas('PAYMENT_CHARGEBACK_REQUESTED', '{"id": "pay_parc_2", "status": "CHARGEBACK_REQUESTED", "installment": "inst_1"}') ->> 'acao') = 'estorno_parcela',
                  'contestação de uma parcela é reconhecida');
select pg_temp.ok((aplicar_pagamento_asaas('PAYMENT_CONFIRMED', '{"id": "pay_x", "status": "CONFIRMED", "installment": "inst_de_outro"}') ->> 'acao') = 'ignorado',
                  'parcelamento que não é nosso é ignorado');
reset role;
select pg_temp.ok((select status from escritorios where id = 'f0000000-0000-0000-0000-00000000000f') = 'ativo'
                  and (select situacao from cobranca_empresas where escritorio_id = 'f0000000-0000-0000-0000-00000000000f') = 'em_dia',
                  'e não suspende a empresa nem muda a assinatura');
select pg_temp.ok(exists (select 1 from atividades where escritorio_id = 'f0000000-0000-0000-0000-00000000000f' and acao = 'pagamento.parcela_estornada'),
                  'só vira atividade (e aviso, pela função)');
select pg_temp.ok(pg_temp.erro($$insert into pagamentos (escritorio_id, finalidade, valor) values ('f0000000-0000-0000-0000-00000000000f', 'outra', 0)$$)
                  like '%pagamentos_finalidade_check%', 'finalidade só mensalidade, créditos ou parcela');

-- ---------------------------------------------------------------- análise de risco do cartão
insert into escritorios (id, nome, status, plano_id, origem) values
  ('a7000000-0000-0000-0000-0000000000a7', 'Em Analise', 'aguardando_pagamento', :'pl_autonomo', 'site'),
  ('a8000000-0000-0000-0000-0000000000a8', 'Recusada', 'aguardando_pagamento', :'pl_autonomo', 'site');
insert into cobranca_empresas (escritorio_id, ciclo, valor, situacao) values
  ('a7000000-0000-0000-0000-0000000000a7', 'SEMIANNUALLY', 1799.40, 'aguardando'),
  ('a8000000-0000-0000-0000-0000000000a8', 'YEARLY', 3238.92, 'aguardando');
insert into pagamentos (escritorio_id, finalidade, asaas_id, valor, status, forma, vencimento, parcelas, asaas_parcelamento, ciclo) values
  ('a7000000-0000-0000-0000-0000000000a7', 'mensalidade', 'pay_risco', 1799.40, 'AWAITING_RISK_ANALYSIS', 'CREDIT_CARD', hoje_brasil(), 6, 'inst_2', 'SEMIANNUALLY'),
  ('a8000000-0000-0000-0000-0000000000a8', 'mensalidade', 'pay_reprov', 3238.92, 'AWAITING_RISK_ANALYSIS', 'CREDIT_CARD', hoje_brasil(), 12, 'inst_3', 'YEARLY');
set role service_role;
select pg_temp.ok((aplicar_pagamento_asaas('PAYMENT_AWAITING_RISK_ANALYSIS', '{"id": "pay_risco", "status": "AWAITING_RISK_ANALYSIS", "installment": "inst_2"}') ->> 'acao') = 'em_analise',
                  '(c) esperando a análise de risco');
reset role;
select pg_temp.ok((select status from escritorios where id = 'a7000000-0000-0000-0000-0000000000a7') = 'aguardando_pagamento'
                  and (select situacao from cobranca_empresas where escritorio_id = 'a7000000-0000-0000-0000-0000000000a7') = 'aguardando',
                  'em análise nada muda');
set role service_role;
select aplicar_pagamento_asaas('PAYMENT_APPROVED_BY_RISK_ANALYSIS', format('{"id": "pay_risco", "status": "AWAITING_RISK_ANALYSIS", "dueDate": "%s", "installment": "inst_2"}',
                               hoje_brasil())::jsonb) as r \gset
select pg_temp.ok((aplicar_pagamento_asaas('PAYMENT_REPROVED_BY_RISK_ANALYSIS', '{"id": "pay_reprov", "status": "AWAITING_RISK_ANALYSIS", "installment": "inst_3"}') ->> 'acao') = 'recusado',
                  'reprovada na análise: recusa');
reset role;
select pg_temp.ok(:'r'::jsonb ->> 'acao' = 'ativou' and (:'r'::jsonb ->> 'criar_assinatura')::boolean
                  and (:'r'::jsonb ->> 'proximo_vencimento')::date = (hoje_brasil() + interval '6 months')::date,
                  'aprovada na análise: ativa e o próximo semestre vence daqui a 6 meses');
select pg_temp.ok((select status from pagamentos where asaas_id = 'pay_risco') = 'CONFIRMED', 'o pagamento aprovado fica confirmado');
select pg_temp.ok((select status from pagamentos where asaas_id = 'pay_reprov') = 'REPROVADO'
                  and (select status from escritorios where id = 'a8000000-0000-0000-0000-0000000000a8') = 'aguardando_pagamento',
                  'a reprovada não cobra nem libera: continua esperando o pagamento');

-- ---------------------------------------------------------------- reaplicar a migração
-- o Só CAR sai do autocadastro: rodar a 0040 de novo não pode religar a venda
-- (o script roda da raiz do repositório; os avisos "já existe" ficam de fora)
update planos set vende_no_site = false where id = :'pl_car';
set client_min_messages = warning;
\i supabase/migrations/0040_autocadastro.sql
set client_min_messages = notice;
select pg_temp.ok(not (select vende_no_site from planos where id = :'pl_car'), 'reaplicar a 0040 não religa a venda de um plano desligado');
select pg_temp.ok((select ciclo from cobranca_empresas where escritorio_id = 'e0000000-0000-0000-0000-00000000000e') = 'YEARLY'
                  and (select origem from escritorios where id = 'e0000000-0000-0000-0000-00000000000e') = 'site'
                  and (select finalidade from pagamentos where asaas_id = 'pay_parc_2') = 'parcela',
                  'e não mexe nos dados (período, origem, parcelas)');

\echo 'autocadastro: todos os testes passaram'
