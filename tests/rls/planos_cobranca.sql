-- Teste dos planos novos, das carteiras de crédito e da cobrança pelo Asaas
-- (supabase/migrations/0034_planos_creditos_cobranca.sql).
-- Roda depois de tests/rls/conclusao.sql, no mesmo cenário:
--   A = escritório legado (a1 superadmin, plano Completo), B = b1 dono, b2 gerente
-- e com os créditos que o tests/rls/creditos.sql deixou em B.
\set ON_ERROR_STOP 1

\set d1 '''d1000000-0000-0000-0000-000000000001'''

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
-- carteira `t` do retrato de créditos
create function pg_temp.cart(c jsonb, t text) returns jsonb language sql as $$
  select x from jsonb_array_elements(c -> 'carteiras') x where x ->> 'chave' = t
$$;
grant execute on all functions in schema pg_temp to public;

select id as esc_a from escritorios where modelos_compartilhados \gset
select id as esc_b from escritorios where not modelos_compartilhados \gset
select id as pl_essencial from planos where nome = 'Essencial' \gset
select id as pl_completo from planos where nome = 'Completo' \gset
select id as pl_autonomo from planos where nome = 'Autônomo' \gset
select id as pl_prof from planos where nome = 'Profissional' \gset
select id as pl_emp from planos where nome = 'Empresarial' \gset
select id as pl_car from planos where nome = 'Só CAR' \gset

-- ---------------------------------------------------------------- a migração dos dados
select pg_temp.ok((select count(*) from tipos_credito) = 2, 'duas carteiras: geral e CAR');
select pg_temp.ok((select por_mes from plano_creditos where plano_id = :'pl_essencial' and tipo = 'geral') = 3,
                  'o teto total da 0027 virou créditos gerais do plano');
select pg_temp.ok((select por_mes from plano_creditos where plano_id = :'pl_completo' and tipo = 'geral') is null
                  and (select por_mes from plano_creditos where plano_id = :'pl_completo' and tipo = 'car') is null,
                  'o plano Completo (a D''Prol) continua sem limite');
select pg_temp.ok(not (select ativo from planos where id = :'pl_essencial') and not (select ativo from planos where id = :'pl_completo'),
                  'os planos de antes saem do cadastro de empresa nova');
select pg_temp.ok((select array_agg(por_mes order by tipo) from plano_creditos where plano_id = :'pl_autonomo') = array[12, 6],
                  'Autônomo: 6 gerais e 12 de CAR');
select pg_temp.ok((select array_agg(por_mes order by tipo) from plano_creditos where plano_id = :'pl_prof') = array[25, 12],
                  'Profissional: 12 gerais e 25 de CAR');
select pg_temp.ok((select array_agg(por_mes order by tipo) from plano_creditos where plano_id = :'pl_emp') = array[50, 25],
                  'Empresarial: 25 gerais e 50 de CAR');
select pg_temp.ok((select array_agg(por_mes order by tipo) from plano_creditos where plano_id = :'pl_car') = array[5, 0],
                  'Só CAR: 5 de CAR e nenhum geral');
select pg_temp.ok((select preco from precos_credito where plano_id = :'pl_autonomo' and tipo = 'geral') = 70
                  and (select preco from precos_credito where plano_id = :'pl_prof' and tipo = 'geral') = 60
                  and (select preco from precos_credito where plano_id = :'pl_emp' and tipo = 'geral') = 50,
                  'crédito geral extra: 70, 60 e 50');
select pg_temp.ok((select count(*) from precos_credito where tipo = 'car' and preco = 9.90 and a_partir_de = 2
                     and plano_id in (:'pl_autonomo', :'pl_prof', :'pl_emp')) = 3, 'CAR extra nos planos completos: 9,90, mínimo 2');
select pg_temp.ok((select array_agg(a_partir_de || ':' || preco order by a_partir_de) from precos_credito where plano_id = :'pl_car')
                  = array['2:19.90', '10:15.00', '51:10.00'], 'Só CAR: 19,90 até 9; 15,00 de 10 a 50; 10,00 acima de 50');
select pg_temp.ok(not exists (select 1 from precos_credito where plano_id = :'pl_car' and tipo = 'geral'), 'Só CAR não vende crédito geral');
select pg_temp.ok((select array_agg(preco_mensal order by ordem) from planos where id in (:'pl_autonomo', :'pl_prof', :'pl_emp', :'pl_car'))
                  = array[299.90, 599.90, 999.90, 49.90]::numeric[], 'mensalidades: 299,90 · 599,90 · 999,90 · Só CAR 49,90');
select pg_temp.ok((select count(*) from creditos_extras where escritorio_id = :'esc_b' and tipo = 'geral') > 0
                  and not exists (select 1 from creditos_extras where tipo is null), 'créditos extras de antes viraram carteira geral');
select pg_temp.ok(not exists (select 1 from consumos_credito where tipo is null), 'consumos de antes ganharam a carteira');
select pg_temp.ok(not exists (select 1 from information_schema.tables where table_name in ('pacotes_credito', 'escritorio_limites')),
                  'pacotes e tetos da 0027 saíram');

-- daqui em diante B começa limpa, no Autônomo
delete from consumos_credito where escritorio_id = :'esc_b';
delete from creditos_extras where escritorio_id = :'esc_b';
update escritorios set plano_id = :'pl_autonomo' where id = :'esc_b';

-- ---------------------------------------------------------------- o retrato do cliente
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok((pg_temp.cart(meus_creditos(), 'geral') ->> 'por_mes')::int = 6, 'cliente vê 6 gerais por mês');
select pg_temp.ok((pg_temp.cart(meus_creditos(), 'car') ->> 'por_mes')::int = 12, 'e 12 de CAR');
select pg_temp.ok(pg_temp.cart(meus_creditos(), 'geral') -> 'precos' = '[{"preco": 70.00, "a_partir_de": 2}]'::jsonb, 'e o preço do crédito geral');
select pg_temp.ok((meus_creditos() ->> 'pagamento_online')::boolean = false, 'sem a chave do Asaas, a compra é por pedido');
select pg_temp.ok((meus_creditos() -> 'periodo' ->> 'inicio')::date = date_trunc('month', hoje_brasil())::date,
                  'empresa sem dia de renovação: o mês do calendário');
select pg_temp.ok(pg_temp.erro('select franquia_credito(gen_random_uuid(), ''geral'')') like '%permission denied%',
                  'as contas internas não são chamadas pelo cliente');
reset role;

-- ---------------------------------------------------------------- CAR primeiro gasta CAR; geral só com aceite
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select sa_definir_creditos_empresa(:'esc_b', 'car', 1);
select sa_definir_creditos_empresa(:'esc_b', 'geral', 2);
select pg_temp.ok((sa_creditos_empresa(:'esc_b') -> 'empresa' -> 'por_mes' ->> 'car')::int = 1, 'combinado só com a empresa');
reset role;

select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok((pg_temp.cart(meus_creditos(), 'car') ->> 'por_mes')::int = 1, 'o combinado vence o plano');
insert into servicos (id, nome_arquivo_txt, modalidade) values ('cc000000-0000-0000-0000-000000000001', 'car1.kml', 'car');
select pg_temp.ok((select tipo || ':' || origem from consumos_credito where servico_id = 'cc000000-0000-0000-0000-000000000001') = 'car:plano',
                  'o CAR gasta a carteira de CAR');
select pg_temp.ok((meus_creditos() -> 'servicos' -> 'servico.car' ->> 'precisa_aceite')::boolean, 'a tela sabe que o próximo CAR pede aceite');
select pg_temp.ok(pg_temp.erro($$insert into servicos (nome_arquivo_txt, modalidade) values ('car2.kml', 'car')$$) like 'ACEITE_CREDITO_GERAL:%',
                  'sem o aceite, o banco não gasta crédito geral no CAR');
insert into servicos (id, nome_arquivo_txt, modalidade, usar_credito_geral) values ('cc000000-0000-0000-0000-000000000002', 'car2.kml', 'car', true);
select pg_temp.ok((select tipo || ':' || origem || ':' || com_aceite from consumos_credito where servico_id = 'cc000000-0000-0000-0000-000000000002')
                  = 'geral:plano:true', 'com o aceite, o CAR usa 1 crédito geral (e fica registrado)');
insert into servicos (id, nome_arquivo_txt) values ('cc000000-0000-0000-0000-000000000003', 'completo.txt');
select pg_temp.ok((select tipo || ':' || com_aceite from consumos_credito where servico_id = 'cc000000-0000-0000-0000-000000000003') = 'geral:false',
                  'serviço sem carteira própria gasta geral sem pedir aceite');
select pg_temp.ok(pg_temp.erro($$insert into servicos (nome_arquivo_txt) values ('outro.txt')$$) like 'SEM_CREDITO:%',
                  'acabou o geral: o banco recusa');
select pg_temp.ok(not (meus_creditos() -> 'servicos' -> 'servico.car' ->> 'disponivel')::boolean, 'e o CAR também acabou');
select pg_temp.ok((pg_temp.cart(meus_creditos(), 'geral') ->> 'usado')::int = 2, 'usado do geral conta o CAR com aceite');

-- ---------------------------------------------------------------- compra por pedido (sem o Asaas)
select pg_temp.ok(pg_temp.erro($$select pedir_creditos('car', 1)$$) like '%mínima é de 2%', 'compra mínima de 2');
select pg_temp.ok(pg_temp.erro($$select pedir_creditos('car', 1001)$$) like '%máximo 1000%', 'compra máxima de 1000');
select pg_temp.ok(pg_temp.erro($$select pedir_creditos('loteamento', 5)$$) like '%inválido%', 'carteira que não existe');
select pedir_creditos('car', 3) ->> 'credito_id' as pedido_car \gset
select pg_temp.ok((select origem || ':' || status || ':' || preco || ':' || valor_unitario from creditos_extras where id = :'pedido_car')
                  = 'pedido:pendente:29.70:9.90', 'pedido com o preço da tabela: 3 × 9,90');
select pg_temp.ok(not exists (select 1 from pagamentos where credito_id = :'pedido_car'), 'sem o Asaas, nenhuma cobrança é criada');
select pg_temp.ok((select descricao from creditos_extras where id = :'pedido_car') = '3 créditos de CAR', 'a descrição mantém a sigla CAR');
reset role;

select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-000000000002', false);
set role authenticated;
select pg_temp.ok(pg_temp.erro($$select pedir_creditos('car', 2)$$) like '%dono%', 'só o dono compra');
reset role;

select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok((select origem from sa_pedidos_credito_pendentes() where id = :'pedido_car') = 'pedido', 'superadmin vê o pedido');
select sa_resolver_pedido_credito(:'pedido_car', true);
reset role;

select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', false);
set role authenticated;
insert into servicos (id, nome_arquivo_txt, modalidade) values ('cc000000-0000-0000-0000-000000000004', 'car3.kml', 'car');
select pg_temp.ok((select tipo || ':' || origem from consumos_credito where servico_id = 'cc000000-0000-0000-0000-000000000004') = 'car:extra',
                  'aprovado, o extra de CAR paga o CAR');
select pg_temp.ok((pg_temp.cart(meus_creditos(), 'car') ->> 'extra')::int = 2, 'saldo extra de CAR desconta');
select pg_temp.ok(pg_temp.erro($$insert into servicos (nome_arquivo_txt) values ('mais.txt')$$) like 'SEM_CREDITO:%',
                  'crédito de CAR não paga outro serviço');
reset role;

-- ---------------------------------------------------------------- tabela de preço por faixa
select pg_temp.ok((select unitario || ':' || total from cotacao_credito(:'esc_b', 'geral', 2)) = '70.00:140.00', 'Autônomo: 2 gerais = 140');
update escritorios set plano_id = :'pl_car' where id = :'esc_b';
select pg_temp.ok((select unitario || ':' || total from cotacao_credito(:'esc_b', 'car', 2)) = '19.90:39.80', 'Só CAR: 2 = 39,80');
select pg_temp.ok((select unitario from cotacao_credito(:'esc_b', 'car', 9)) = 19.90, 'Só CAR: 9 ainda a 19,90');
select pg_temp.ok((select unitario || ':' || total from cotacao_credito(:'esc_b', 'car', 10)) = '15.00:150.00', 'Só CAR: 10 a 15,00');
select pg_temp.ok((select unitario from cotacao_credito(:'esc_b', 'car', 50)) = 15.00, 'Só CAR: 50 ainda a 15,00');
select pg_temp.ok((select unitario || ':' || total from cotacao_credito(:'esc_b', 'car', 51)) = '10.00:510.00', 'Só CAR: 51 a 10,00');
select pg_temp.ok(pg_temp.erro(format('select * from cotacao_credito(%L, ''geral'', 5)', :'esc_b')) like '%não estão à venda%',
                  'Só CAR não vende crédito geral');

select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok(pg_temp.erro(format($$select sa_definir_precos(null, %L, 'car', '[{"a_partir_de": 2, "preco": 5}, {"a_partir_de": 2, "preco": 4}]')$$, :'esc_b'))
                  like '%Duas faixas%', 'faixa repetida é recusada');
select pg_temp.ok(pg_temp.erro(format($$select sa_definir_precos(%L, %L, 'car', '[]')$$, :'pl_car', :'esc_b')) like '%plano ou a empresa%',
                  'preço é do plano OU da empresa');
select sa_definir_precos(null, :'esc_b', 'car', '[{"a_partir_de": 5, "preco": 8.5}]');
reset role;
select pg_temp.ok((select unitario from cotacao_credito(:'esc_b', 'car', 5)) = 8.50, 'o preço só desta empresa vence o do plano');
select pg_temp.ok(pg_temp.erro(format('select * from cotacao_credito(%L, ''car'', 4)', :'esc_b')) like '%mínima é de 5%',
                  'e a primeira faixa dela é a compra mínima');
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select sa_definir_precos(null, :'esc_b', 'car', null);
reset role;
select pg_temp.ok((select unitario from cotacao_credito(:'esc_b', 'car', 2)) = 19.90, 'null volta à tabela do plano');

-- ---------------------------------------------------------------- Só CAR bloqueia o resto
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok((minha_conta() -> 'recursos' ->> 'servico.car')::boolean, 'Só CAR libera o CAR');
select pg_temp.ok(not (minha_conta() -> 'recursos' ->> 'servico.completo')::boolean
                  and not (minha_conta() -> 'recursos' ->> 'servico.loteamento')::boolean, 'e bloqueia os outros serviços');
select pg_temp.ok(pg_temp.erro($$insert into servicos (nome_arquivo_txt) values ('bloq.txt')$$) like '%plano da empresa não inclui%',
                  'o banco recusa serviço fora do Só CAR');
reset role;
insert into recursos (chave, nome, grupo, padrao) values ('servico.novo_teste', 'Serviço novo', 'Serviços', true);
select pg_temp.ok(not recurso_liberado(:'esc_b', 'servico.novo_teste'), 'serviço que entrar depois nasce bloqueado no Só CAR');
update escritorios set plano_id = :'pl_autonomo' where id = :'esc_b';
select pg_temp.ok(recurso_liberado(:'esc_b', 'servico.novo_teste'), 'e liberado nos planos completos (o padrão do catálogo)');
delete from recursos where chave = 'servico.novo_teste';
update escritorios set plano_id = :'pl_car' where id = :'esc_b';

-- ---------------------------------------------------------------- compra pelo Asaas + webhook
insert into cobranca_config (key, value) values ('asaas_api_key', '$aact_teste');
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok(pg_temp.erro('select * from cobranca_config') like '%permission denied%', 'ninguém lê a chave do Asaas pelo REST');
select pg_temp.ok((meus_creditos() ->> 'pagamento_online')::boolean, 'com a chave, a compra é online');
select pedir_creditos('car', 10) as compra \gset
select pg_temp.ok((:'compra'::jsonb ->> 'valor')::numeric = 150 and (:'compra'::jsonb ->> 'online')::boolean, 'compra de 10 no Só CAR: R$ 150');
select pg_temp.ok((select origem || ':' || status from creditos_extras where id = (:'compra'::jsonb ->> 'credito_id')::uuid) = 'compra:pendente',
                  'a compra espera o pagamento');
select pg_temp.ok((select status || ':' || valor from pagamentos where id = (:'compra'::jsonb ->> 'pagamento_id')::uuid) = 'CRIANDO:150.00',
                  'e já tem a cobrança a emitir');
select pg_temp.ok(pg_temp.erro(format($$update creditos_extras set status = 'aprovado' where id = %L$$, :'compra'::jsonb ->> 'credito_id')) is not null
                  or (select status from creditos_extras where id = (:'compra'::jsonb ->> 'credito_id')::uuid) = 'pendente', 'cliente não aprova a própria compra');
select pg_temp.ok(pg_temp.erro($$insert into pagamentos (escritorio_id, finalidade, valor) values (escritorio_atual(), 'creditos', 0)$$) is not null,
                  'cliente não cria pagamento');
select pg_temp.ok(pg_temp.erro($$select aplicar_pagamento_asaas('PAYMENT_CONFIRMED', '{"id": "x"}')$$) like '%permission denied%',
                  'cliente não chama o webhook por dentro');
reset role;

-- a edge function emitiu a cobrança no Asaas
update pagamentos set asaas_id = 'pay_cred_1', status = 'PENDING', link = 'https://sandbox.asaas.com/i/1'
 where id = (:'compra'::jsonb ->> 'pagamento_id')::uuid;
set role service_role;
select pg_temp.ok((aplicar_pagamento_asaas('PAYMENT_CREATED', '{"id": "pay_cred_1", "status": "PENDING"}') ->> 'acao') = 'atualizado',
                  'evento de cobrança criada não dá crédito');
select pg_temp.ok((aplicar_pagamento_asaas('PAYMENT_CONFIRMED', '{"id": "pay_cred_1", "status": "CONFIRMED", "billingType": "PIX", "value": 150}') ->> 'acao') = 'creditos',
                  'pagamento confirmado: os créditos entram');
select pg_temp.ok((aplicar_pagamento_asaas('PAYMENT_RECEIVED', '{"id": "pay_cred_1", "status": "RECEIVED", "billingType": "PIX"}') ->> 'acao') = 'repetido',
                  'o segundo aviso do mesmo pagamento não dá crédito de novo');
select pg_temp.ok((aplicar_pagamento_asaas('PAYMENT_CONFIRMED', '{"id": "pay_desconhecido", "status": "CONFIRMED"}') ->> 'acao') = 'ignorado',
                  'cobrança que não é nossa é ignorada');
reset role;
select pg_temp.ok(saldo_extra(:'esc_b', 'car') = 12, 'saldo de CAR: os 2 que sobraram + os 10 comprados');
select pg_temp.ok((select status || ':' || forma from pagamentos where asaas_id = 'pay_cred_1') = 'RECEIVED:PIX', 'pagamento guarda a forma');

-- cobrança apagada no Asaas cancela a compra pendente
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pedir_creditos('car', 2) as compra2 \gset
reset role;
update pagamentos set asaas_id = 'pay_cred_2', status = 'PENDING' where id = (:'compra2'::jsonb ->> 'pagamento_id')::uuid;
set role service_role;
select pg_temp.ok((aplicar_pagamento_asaas('PAYMENT_DELETED', '{"id": "pay_cred_2", "status": "PENDING", "deleted": true}') ->> 'acao') = 'cancelado',
                  'cobrança apagada no Asaas cancela a compra');
reset role;
select pg_temp.ok((select status from creditos_extras where id = (:'compra2'::jsonb ->> 'credito_id')::uuid) = 'cancelado', 'e nenhum crédito entra');

-- cancelar a compra pendente marca a cobrança
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pedir_creditos('car', 2) as compra3 \gset
select cancelar_pedido_credito((:'compra3'::jsonb ->> 'credito_id')::uuid);
select pg_temp.ok((select status from pagamentos where id = (:'compra3'::jsonb ->> 'pagamento_id')::uuid) = 'CANCELADO', 'dono cancela a compra e a cobrança');
reset role;

-- ---------------------------------------------------------------- empresa nova: paga e ativa
insert into auth.users (id, email) values (:d1, 'dono@pagante.test');
insert into escritorios (id, nome, status, plano_id, cnpj, telefone)
values ('d0000000-0000-0000-0000-00000000000d', 'Pagante Topografia', 'aguardando_pagamento', :'pl_prof', '11222333000181', '71999990000');
insert into membros_escritorio (escritorio_id, user_id, papel) values ('d0000000-0000-0000-0000-00000000000d', :d1, 'dono');
insert into cobranca_empresas (escritorio_id, asaas_cliente_id, asaas_assinatura_id, valor, situacao, link_pagamento, proximo_vencimento)
values ('d0000000-0000-0000-0000-00000000000d', 'cus_1', 'sub_1', 199.90, 'aguardando', 'https://sandbox.asaas.com/i/m1', hoje_brasil());
insert into pagamentos (escritorio_id, finalidade, asaas_id, valor, status, link, vencimento)
values ('d0000000-0000-0000-0000-00000000000d', 'mensalidade', 'pay_m1', 199.90, 'PENDING', 'https://sandbox.asaas.com/i/m1', hoje_brasil());

select set_config('request.jwt.claim.sub', 'd1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok(escritorio_atual() is null and meus_creditos() is null, 'antes de pagar, a empresa não vê nada');
select pg_temp.ok((minha_cobranca() ->> 'status') = 'aguardando_pagamento' and (minha_cobranca() ->> 'link') = 'https://sandbox.asaas.com/i/m1',
                  'mas vê o link para pagar');
reset role;

set role service_role;
select pg_temp.ok((aplicar_pagamento_asaas('PAYMENT_RECEIVED',
                    format('{"id": "pay_m1", "subscription": "sub_1", "status": "RECEIVED", "billingType": "BOLETO", "dueDate": "%s"}', hoje_brasil())::jsonb) ->> 'acao') = 'ativou',
                  'pagou a 1ª mensalidade: a empresa ativa');
select pg_temp.ok((aplicar_pagamento_asaas('PAYMENT_CONFIRMED',
                    format('{"id": "pay_m1", "subscription": "sub_1", "status": "CONFIRMED", "dueDate": "%s"}', hoje_brasil())::jsonb) ->> 'acao') = 'renovou',
                  'o aviso repetido não ativa de novo');
reset role;
select pg_temp.ok((select status from escritorios where id = 'd0000000-0000-0000-0000-00000000000d') = 'ativo', 'status ativo');
select pg_temp.ok((select situacao || ':' || coalesce(link_pagamento, '-') || ':' || proximo_vencimento from cobranca_empresas where escritorio_id = 'd0000000-0000-0000-0000-00000000000d')
                  = 'em_dia:-:' || (hoje_brasil() + interval '1 month')::date, 'assinatura em dia, sem fatura aberta, vence daqui a um mês');

select set_config('request.jwt.claim.sub', 'd1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok((pg_temp.cart(meus_creditos(), 'geral') ->> 'por_mes')::int = 12, 'ativa, vê os créditos do Profissional');
reset role;

-- a mensalidade do mês seguinte
set role service_role;
select aplicar_pagamento_asaas('PAYMENT_CREATED', format('{"id": "pay_m2", "subscription": "sub_1", "status": "PENDING", "value": 199.90, "dueDate": "%s", "invoiceUrl": "https://sandbox.asaas.com/i/m2"}',
                               (hoje_brasil() + interval '1 month')::date)::jsonb);
reset role;
select pg_temp.ok((select link_pagamento from cobranca_empresas where escritorio_id = 'd0000000-0000-0000-0000-00000000000d') = 'https://sandbox.asaas.com/i/m2',
                  'a fatura nova da assinatura vira a fatura aberta');
select pg_temp.ok((select finalidade || ':' || valor from pagamentos where asaas_id = 'pay_m2') = 'mensalidade:199.90', 'e entra nos pagamentos');
set role service_role;
select pg_temp.ok((aplicar_pagamento_asaas('PAYMENT_OVERDUE', '{"id": "pay_m2", "subscription": "sub_1", "status": "OVERDUE"}') ->> 'acao') = 'suspendeu',
                  'mensalidade vencida suspende o acesso');
select pg_temp.ok((aplicar_pagamento_asaas('PAYMENT_OVERDUE', '{"id": "pay_m2", "subscription": "sub_1", "status": "OVERDUE"}') ->> 'acao') = 'atrasou',
                  'o aviso repetido não suspende de novo');
reset role;
select pg_temp.ok((select status from escritorios where id = 'd0000000-0000-0000-0000-00000000000d') = 'aguardando_pagamento', 'empresa fora do ar');
select set_config('request.jwt.claim.sub', 'd1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok(escritorio_atual() is null, 'suspensa, a empresa não vê os dados');
select pg_temp.ok((minha_cobranca() ->> 'situacao') = 'atrasada' and (minha_cobranca() ->> 'link') = 'https://sandbox.asaas.com/i/m2',
                  'mas vê a mensalidade vencida e o link para pagar');
reset role;
set role service_role;
select pg_temp.ok((aplicar_pagamento_asaas('PAYMENT_RECEIVED', '{"id": "pay_m2", "subscription": "sub_1", "status": "RECEIVED"}') ->> 'acao') = 'ativou',
                  'pagou a vencida: o acesso volta sozinho');
reset role;
select pg_temp.ok((select situacao from cobranca_empresas where escritorio_id = 'd0000000-0000-0000-0000-00000000000d') = 'em_dia'
                  and (select status from escritorios where id = 'd0000000-0000-0000-0000-00000000000d') = 'ativo', 'em dia e ativa');
-- suspensão manual do superadmin não é desfeita por pagamento
insert into pagamentos (escritorio_id, finalidade, asaas_id, valor, status, vencimento)
values ('d0000000-0000-0000-0000-00000000000d', 'mensalidade', 'pay_m3', 199.90, 'PENDING', hoje_brasil());
update escritorios set status = 'suspenso' where id = 'd0000000-0000-0000-0000-00000000000d';
set role service_role;
select pg_temp.ok((aplicar_pagamento_asaas('PAYMENT_OVERDUE', '{"id": "pay_m3", "status": "OVERDUE"}') ->> 'acao') = 'atrasou', 'suspensa à mão: vencer não muda o status');
select pg_temp.ok((aplicar_pagamento_asaas('PAYMENT_RECEIVED', '{"id": "pay_m3", "status": "RECEIVED"}') ->> 'acao') = 'renovou', 'e pagar não reativa');
reset role;
select pg_temp.ok((select status from escritorios where id = 'd0000000-0000-0000-0000-00000000000d') = 'suspenso', 'continua suspensa à mão');
update escritorios set status = 'ativo' where id = 'd0000000-0000-0000-0000-00000000000d';

-- ---------------------------------------------------------------- o mês do crédito segue o dia da renovação
select pg_temp.ok(ancora_mes(31, '2027-02-10') = '2027-02-28' and ancora_mes(31, '2026-04-03') = '2026-04-30'
                  and ancora_mes(5, '2026-10-30') = '2026-10-05', 'dia 31 cai no último dia dos meses curtos');
update escritorios set dia_renovacao = extract(day from hoje_brasil())::int where id = 'd0000000-0000-0000-0000-00000000000d';
select pg_temp.ok(inicio_periodo('d0000000-0000-0000-0000-00000000000d') = hoje_brasil(), 'renova hoje: o período começa hoje');
select pg_temp.ok(renovacao_periodo('d0000000-0000-0000-0000-00000000000d') = ancora_mes(extract(day from hoje_brasil())::int, (hoje_brasil() + interval '1 month')::date),
                  'e renova daqui a um mês');
insert into consumos_credito (escritorio_id, chave, mes, origem, tipo, created_at)
values ('d0000000-0000-0000-0000-00000000000d', 'servico.completo', hoje_brasil(), 'plano', 'geral', now() - interval '40 days');
select pg_temp.ok(uso_credito('d0000000-0000-0000-0000-00000000000d', 'geral') = 0, 'consumo do período passado não conta');

-- ---------------------------------------------------------------- painel
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok((select cobranca from sa_empresas() where id = 'd0000000-0000-0000-0000-00000000000d') = 'em_dia', 'lista de empresas mostra a cobrança');
select pg_temp.ok(jsonb_array_length(sa_cobranca_empresa('d0000000-0000-0000-0000-00000000000d') -> 'pagamentos') = 3, 'aba Cobrança lista as mensalidades');
select sa_atualizar_empresa('d0000000-0000-0000-0000-00000000000d', '{"mensalidade": 149.9}');
select pg_temp.ok((select mensalidade from sa_empresas() where id = 'd0000000-0000-0000-0000-00000000000d') = 149.90, 'mensalidade só desta empresa');
select sa_atualizar_empresa('d0000000-0000-0000-0000-00000000000d', '{"status": "aguardando_pagamento"}');
select pg_temp.ok((select status from escritorios where id = 'd0000000-0000-0000-0000-00000000000d') = 'aguardando_pagamento', 'status novo aceito');
select pg_temp.ok(pg_temp.erro($$select sa_atualizar_empresa('d0000000-0000-0000-0000-00000000000d', '{"dia_renovacao": 40}')$$) like '%renovação%',
                  'dia de renovação fora de 1–31');
select pg_temp.ok(jsonb_array_length(sa_creditos_empresa(:'esc_b') -> 'historico') >= 1, 'histórico de uso por mês');
reset role;

select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok(pg_temp.erro(format('select sa_cobranca_empresa(%L)', :'esc_b')) like '%restrito%', 'cliente não abre o painel de cobrança');
select pg_temp.ok((select count(*) from pagamentos) = (select count(*) from pagamentos where escritorio_id = :'esc_b'), 'cliente só vê os próprios pagamentos');
reset role;

\echo 'planos e cobrança: todos os testes passaram'
