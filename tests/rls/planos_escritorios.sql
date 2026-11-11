-- Teste dos dois planos (Profissional e Empresarial) e dos escritórios
-- adicionais (supabase/migrations/0050_planos_escritorios.sql). Roda no fim do
-- npm run test:rls, no mesmo banco: superadmin do teste da 0024, Asaas ligado
-- pelos testes da 0040/0049.
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

select id as pl_prof from planos where nome = 'Profissional' \gset
select id as pl_emp from planos where nome = 'Empresarial' \gset
select user_id as sa from super_admins limit 1 \gset

-- ---------------------------------------------------------------- os planos
select pg_temp.ok((select preco_mensal from planos where id = :'pl_prof') = 299.90
                  and franquia_credito_plano.g = 8 and franquia_credito_plano.c = 16,
                  'Profissional: R$ 299,90, 8 créditos de projeto e 16 de CAR por mês')
  from (select (select por_mes from plano_creditos where plano_id = :'pl_prof' and tipo = 'geral') as g,
               (select por_mes from plano_creditos where plano_id = :'pl_prof' and tipo = 'car') as c) franquia_credito_plano;
select pg_temp.ok((select preco_mensal from planos where id = :'pl_emp') = 1000.00
                  and (select por_mes from plano_creditos where plano_id = :'pl_emp' and tipo = 'geral') is null
                  and (select por_mes from plano_creditos where plano_id = :'pl_emp' and tipo = 'car') is null,
                  'Empresarial: R$ 1.000,00 e créditos ilimitados (geral e CAR)');
select pg_temp.ok((select escritorios_adicionais from planos where id = :'pl_emp') = 2
                  and (select preco_escritorio from planos where id = :'pl_emp') = 99.90
                  and (select escritorios_adicionais from planos where id = :'pl_prof') = 0,
                  'Empresarial: até 2 escritórios adicionais a R$ 99,90; o Profissional não tem');
select pg_temp.ok(not exists (select 1 from planos where ativo and id not in (:'pl_prof', :'pl_emp'))
                  and not exists (select 1 from planos where vende_no_site and id not in (:'pl_prof', :'pl_emp')),
                  'só os dois planos ficam no cadastro (os outros saem, sem apagar ninguém)');
select pg_temp.ok((select array_agg(x ->> 'nome' order by ord) from jsonb_array_elements(cadastro_planos() -> 'planos') with ordinality t(x, ord))
                  = array['Profissional', 'Empresarial'],
                  'a página de cadastro mostra Profissional e Empresarial, nesta ordem');
select pg_temp.ok((select (x ->> 'escritorios_adicionais')::int = 2 and (x ->> 'preco_escritorio')::numeric = 99.90
                     from jsonb_array_elements(cadastro_planos() -> 'planos') x where x ->> 'nome' = 'Empresarial'),
                  'e o Empresarial diz quantos escritórios e quanto custa cada um');

-- ---------------------------------------------------------------- crédito adicional do Profissional
\set prof '\'95000000-0000-0000-0000-0000000000a1\''
\set dono_prof '\'95100000-0000-0000-0000-0000000000a1\''
insert into auth.users (id, email) values (:dono_prof, 'dono@prof.test') on conflict do nothing;
insert into escritorios (id, nome, status, plano_id, cnpj) values (:prof, 'Geo Profissional', 'ativo', :'pl_prof', '95950000000101');
insert into membros_escritorio (escritorio_id, user_id, papel) values (:prof, :dono_prof, 'dono');
select pg_temp.ok(pg_temp.erro($$select * from cotacao_credito('95000000-0000-0000-0000-0000000000a1', 'geral', 1)$$) like '%mínima é de 2%',
                  'crédito adicional: compra mínima de 2');
select pg_temp.ok((select total from cotacao_credito(:prof, 'geral', 2)) = 100.00
                  and (select total from cotacao_credito(:prof, 'geral', 5)) = 250.00,
                  'de 2 a 5 créditos: R$ 50,00 cada');
select pg_temp.ok((select unitario from cotacao_credito(:prof, 'geral', 6)) = 40.00
                  and (select total from cotacao_credito(:prof, 'geral', 10)) = 400.00,
                  'a partir de 6: R$ 40,00 cada');
select pg_temp.ok(mensalidade_de(:prof) = 299.90, 'a mensalidade do Profissional é R$ 299,90');

select set_config('request.jwt.claim.sub', '95100000-0000-0000-0000-0000000000a1', false);
set role authenticated;
select pg_temp.ok(pg_temp.erro($$select criar_escritorio('Filial')$$) like '%não inclui escritórios%',
                  'no Profissional não dá para criar escritório (a mensagem aponta o Empresarial)');
select pg_temp.ok(meus_escritorios() ->> 'limite' = '0', 'a tela de escritórios sabe que o limite é 0');
reset role;

-- ---------------------------------------------------------------- a empresa no Empresarial
\set mat '\'95000000-0000-0000-0000-0000000000b1\''
\set dona '\'95100000-0000-0000-0000-0000000000b1\''
\set membro '\'95100000-0000-0000-0000-0000000000b2\''
\set outro '\'95100000-0000-0000-0000-0000000000c1\''
insert into auth.users (id, email) values (:dona, 'dona@emp.test'), (:membro, 'membro@emp.test'), (:outro, 'outro@x.test')
on conflict do nothing;
insert into escritorios (id, nome, status, plano_id, cnpj, responsavel, telefone, dia_renovacao)
values (:mat, 'Geo Empresarial', 'ativo', :'pl_emp', '95950000000202', 'Dona', '75999990000', 7);
insert into membros_escritorio (escritorio_id, user_id, papel) values (:mat, :dona, 'dono');
insert into membros_escritorio (escritorio_id, user_id, papel, permissoes) values (:mat, :membro, 'membro', array['servicos.criar']);
insert into membros_escritorio (escritorio_id, user_id, papel) values (:prof, :outro, 'membro');
insert into config_empresa (escritorio_id, key, value) values
  (:mat, 'razao_social', 'Geo Empresarial Ltda'), (:mat, 'endereco_empresa', 'Rua A, 1'), (:mat, 'gprol_token', 'segredo');
select pg_temp.ok(mensalidade_de(:mat) = 1000.00, 'sem escritórios, a mensalidade é a do plano');

select set_config('request.jwt.claim.sub', '95100000-0000-0000-0000-0000000000b1', false);
set role authenticated;
select meus_escritorios() as me \gset
select pg_temp.ok((:'me'::jsonb ->> 'disponivel')::boolean and (:'me'::jsonb ->> 'limite')::int = 2
                  and (:'me'::jsonb ->> 'preco')::numeric = 99.90 and (:'me'::jsonb ->> 'ativos')::int = 0
                  and (:'me'::jsonb -> 'mensalidade' ->> 'total')::numeric = 1000.00,
                  'a dona vê: até 2 escritórios, R$ 99,90 cada, nenhum ainda');
select criar_escritorio('Filial Norte') ->> 'id' as f1 \gset
select pg_temp.ok((select (criar_escritorio('Filial Sul') -> 'mensalidade' ->> 'total')::numeric) = 1199.80,
                  'dois escritórios: R$ 1.000,00 + 2 × R$ 99,90 = R$ 1.199,80');
select (meus_escritorios() -> 'escritorios' -> 1 ->> 'id') as f2 \gset
select pg_temp.ok(pg_temp.erro($$select criar_escritorio('Filial Leste')$$) like '%permite 2%',
                  'o terceiro escritório é recusado (limite do plano)');
reset role;
select pg_temp.ok((select nome from escritorios where id = :'f2') = 'Filial Sul', 'a lista da tela traz os escritórios na ordem de criação');
select pg_temp.ok(mensalidade_de(:mat) = 1199.80 and mensalidade_de(:'f1') = 0,
                  'a matriz paga os escritórios; o escritório não tem mensalidade própria');
select pg_temp.ok((select plano_id = :'pl_emp' and dia_renovacao = 7 and matriz_id = :mat and origem = 'escritorio' and cnpj is null
                     from escritorios where id = :'f1'),
                  'o escritório nasce no plano e no dia de renovação da matriz');
select pg_temp.ok(exists (select 1 from config_empresa where escritorio_id = :'f1' and key = 'razao_social' and value = 'Geo Empresarial Ltda')
                  and not exists (select 1 from config_empresa where escritorio_id = :'f1' and key = 'gprol_token'),
                  'leva os dados da empresa, nunca as chaves de integração');
select pg_temp.ok(exists (select 1 from atividades where escritorio_id = :mat and acao = 'escritorio.criado'),
                  'a criação fica no histórico da matriz');

select set_config('request.jwt.claim.sub', '95100000-0000-0000-0000-0000000000b1', false);
set role authenticated;
select pg_temp.ok(pg_temp.erro($$select definir_escritorio('$$ || :'f2' || $$', 'filial norte')$$) like '%Já existe%',
                  'dois escritórios com o mesmo nome, não');
select pg_temp.ok(jsonb_array_length((select escritorios from meu_escritorio())) = 3,
                  'o seletor do topo lista a matriz e os dois escritórios');

-- trabalha no escritório
select usar_escritorio(:'f1');
select pg_temp.ok(escritorio_atual() = :'f1'::uuid, 'a dona entra na Filial Norte');
select pg_temp.ok((select id = :'f1'::uuid and papel = 'dono' and matriz_nome = 'Geo Empresarial' from meu_escritorio()),
                  'o sistema mostra o escritório, a matriz e que ela é dona');
insert into servicos (id, nome_arquivo_txt) values ('95200000-0000-0000-0000-000000000001', 'filial.txt');
select pg_temp.ok((select escritorio_id from servicos where id = '95200000-0000-0000-0000-000000000001') = :'f1'::uuid,
                  'o serviço criado no escritório é dele');
select pg_temp.ok((select bool_and(c ->> 'por_mes' is null) from jsonb_array_elements(meus_creditos() -> 'carteiras') c),
                  'no escritório, os créditos são os da matriz: ilimitados');
select pg_temp.ok((meus_creditos() ->> 'sou_dono')::boolean and (meus_creditos() ->> 'escritorio')::boolean,
                  'ela continua dona (compra créditos) e a tela sabe que está num escritório');
select pg_temp.ok((minha_cobranca() ->> 'empresa') = 'Geo Empresarial' and (minha_cobranca() ->> 'mensalidade')::numeric = 1199.80
                  and (minha_cobranca() -> 'mensalidade_detalhe' ->> 'escritorios')::int = 2,
                  'a cobrança é a da matriz, com os escritórios na conta');
select usar_escritorio(null);
select pg_temp.ok(escritorio_atual() = :mat::uuid, 'volta à matriz');
select pg_temp.ok(not exists (select 1 from servicos where id = '95200000-0000-0000-0000-000000000001'),
                  'na matriz, o serviço da filial não aparece (espaços separados)');
reset role;
select pg_temp.ok(uso_credito(:mat, 'geral') = uso_credito(:'f1', 'geral') and uso_credito(:mat, 'geral') >= 1,
                  'o crédito gasto na filial conta no saldo do grupo');

-- quem não é dono da matriz
select set_config('request.jwt.claim.sub', '95100000-0000-0000-0000-0000000000b2', false);
set role authenticated;
select pg_temp.ok(pg_temp.erro($$select criar_escritorio('Do membro')$$) like '%Só o dono%', 'membro da equipe não cria escritório');
select pg_temp.ok(pg_temp.erro($$select usar_escritorio('$$ || :'f1' || $$')$$) like '%Só o dono%', 'nem entra nos escritórios');
select pg_temp.ok((select escritorios from meu_escritorio()) is null, 'e não vê o seletor');
reset role;
select set_config('request.jwt.claim.sub', '95100000-0000-0000-0000-0000000000a1', false);
set role authenticated;
select pg_temp.ok(pg_temp.erro($$select usar_escritorio('$$ || :'f1' || $$')$$) is not null, 'dono de outra empresa não entra no escritório');
select pg_temp.ok(escritorio_atual() = :prof::uuid, 'e continua na empresa dele');
reset role;

-- a equipe própria do escritório
\set func '\'95100000-0000-0000-0000-0000000000b3\''
insert into auth.users (id, email) values (:func, 'func@filial.test') on conflict do nothing;
insert into membros_escritorio (escritorio_id, user_id, papel, permissoes) values (:'f1', :func, 'membro', array['servicos.criar']);
select set_config('request.jwt.claim.sub', '95100000-0000-0000-0000-0000000000b3', false);
set role authenticated;
select pg_temp.ok(escritorio_atual() = :'f1'::uuid and exists (select 1 from servicos where id = '95200000-0000-0000-0000-000000000001'),
                  'quem é da equipe da filial trabalha nela e vê os serviços dela');
select pg_temp.ok(not (minha_cobranca() ->> 'sou_dono')::boolean and minha_cobranca() ->> 'empresa' = 'Geo Empresarial',
                  'vê a situação da matriz, sem poder mexer na cobrança');
reset role;

-- matriz parada = escritórios parados
update escritorios set status = 'aguardando_pagamento' where id = :mat;
select set_config('request.jwt.claim.sub', '95100000-0000-0000-0000-0000000000b3', false);
set role authenticated;
select pg_temp.ok(escritorio_atual() is null and not tem_permissao('servicos.criar'),
                  'matriz esperando pagamento: a equipe da filial também fica sem acesso');
select pg_temp.ok((select status from meu_escritorio()) = 'aguardando_pagamento', 'e a tela mostra o motivo (o da matriz)');
reset role;
update escritorios set status = 'ativo' where id = :mat;

-- desativar e reativar
select set_config('request.jwt.claim.sub', '95100000-0000-0000-0000-0000000000b1', false);
set role authenticated;
select usar_escritorio(:'f2');
select pg_temp.ok((select (definir_escritorio(:'f2', null, false) -> 'mensalidade' ->> 'total')::numeric) = 1099.90,
                  'desativar a Filial Sul tira R$ 99,90 da mensalidade');
select pg_temp.ok(escritorio_atual() = :mat::uuid, 'quem estava nela volta para a matriz');
select pg_temp.ok(pg_temp.erro($$select usar_escritorio('$$ || :'f2' || $$')$$) like '%desativado%', 'escritório desativado não abre');
select pg_temp.ok((select (definir_escritorio(:'f2', 'Filial Sul 2', true) -> 'mensalidade' ->> 'total')::numeric) = 1199.80,
                  'reativar volta a cobrar');
reset role;
select pg_temp.ok((select nome from escritorios where id = :'f2') = 'Filial Sul 2', 'e o nome novo ficou');

-- o superadmin
select set_config('request.jwt.claim.sub', :'sa', false);
set role authenticated;
select pg_temp.ok((select escritorios = 2 and mensalidade = 1199.80 from sa_empresas() where id = :mat)
                  and (select matriz = 'Geo Empresarial' from sa_empresas() where id = :'f1'),
                  'o painel mostra a matriz com 2 escritórios e cada escritório com a matriz');
select pg_temp.ok(pg_temp.erro($$select sa_atualizar_empresa('$$ || :'f1' || $$', '{"plano_id": ""}')$$) like '%escritório adicional%',
                  'o escritório não troca de plano sozinho (segue a matriz)');
select sa_atualizar_empresa(:mat, '{"preco_escritorio": "79.90"}');
reset role;
select pg_temp.ok(mensalidade_de(:mat) = 1159.80, 'preço combinado com a empresa: R$ 79,90 por escritório');
set role authenticated;
select set_config('request.jwt.claim.sub', :'sa', false);
select sa_atualizar_empresa(:mat, '{"preco_escritorio": "", "limite_escritorios": "1"}');
reset role;
select pg_temp.ok((select count(*) from escritorios where matriz_id = :mat and status = 'ativo') = 1
                  and (select status from escritorios where id = :'f2') = 'suspenso'
                  and mensalidade_de(:mat) = 1099.90,
                  'limite reduzido a 1: o escritório mais novo é desativado e sai da conta');

-- trocar a matriz de plano: os escritórios acompanham
select set_config('request.jwt.claim.sub', :'sa', false);
set role authenticated;
select sa_atualizar_empresa(:mat, ('{"plano_id": "' || :'pl_prof' || '", "limite_escritorios": ""}')::jsonb);
reset role;
select pg_temp.ok((select plano_id from escritorios where id = :'f1') = :'pl_prof'::uuid
                  and (select status from escritorios where id = :'f1') = 'suspenso'
                  and mensalidade_de(:mat) = 299.90,
                  'matriz passou para o Profissional: os escritórios seguem o plano e param (o plano não tem)');
select pg_temp.ok(franquia_credito(:'f1', 'geral') = 8, 'e o escritório usa a franquia da matriz');

-- ---------------------------------------------------------------- quem já era cliente
-- Simula o banco de antes: o Profissional de R$ 599,90 (12/25, extra R$ 60) com
-- uma empresa nele, e reaplica a migração.
\set antiga '\'95000000-0000-0000-0000-0000000000d1\''
update planos set preco_mensal = 599.90 where id = :'pl_prof';
update plano_creditos set por_mes = 12 where plano_id = :'pl_prof' and tipo = 'geral';
update plano_creditos set por_mes = 25 where plano_id = :'pl_prof' and tipo = 'car';
delete from precos_credito where plano_id = :'pl_prof';
insert into precos_credito (plano_id, tipo, a_partir_de, preco) values (:'pl_prof', 'geral', 2, 60.00), (:'pl_prof', 'car', 2, 9.90);
insert into escritorios (id, nome, status, plano_id, cnpj) values (:antiga, 'Cliente Antigo', 'ativo', :'pl_prof', '95950000000303');
delete from saas_config where key = 'planos_0050';
\i supabase/migrations/0050_planos_escritorios.sql
select pg_temp.ok(mensalidade_de(:antiga) = 599.90 and franquia_credito(:antiga, 'geral') = 12 and franquia_credito(:antiga, 'car') = 25
                  and (select total from cotacao_credito(:antiga, 'geral', 2)) = 120.00,
                  'quem já era cliente continua com o valor e os créditos de antes (gravados na empresa)');
\set nova '\'95000000-0000-0000-0000-0000000000e1\''
insert into escritorios (id, nome, status, plano_id, cnpj) values (:nova, 'Cliente Novo', 'ativo', :'pl_prof', '95950000000404');
select pg_temp.ok((select preco_mensal from planos where id = :'pl_prof') = 299.90 and franquia_credito(:nova, 'geral') = 8
                  and franquia_credito(:nova, 'car') = 16 and mensalidade_de(:nova) = 299.90
                  and (select total from cotacao_credito(:nova, 'geral', 6)) = 240.00,
                  'e quem entra depois fica com a regra nova (R$ 299,90, 8 + 16, extra R$ 50/R$ 40)');
select pg_temp.ok((select count(*) from planos where ativo) = 2, 'reaplicar a migração continua com só dois planos no cadastro');
