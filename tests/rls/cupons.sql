-- Teste dos cupons de desconto (supabase/migrations/0052_cupons.sql). Roda no
-- fim do npm run test:rls, no mesmo banco: planos da 0050/0051, superadmin do
-- teste da 0024.
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

-- ---------------------------------------------------------------- o painel (só superadmin)
\set dona '\'9d100000-0000-0000-0000-0000000000a1\''
insert into auth.users (id, email) values (:dona, 'dona@cupom.test') on conflict do nothing;

select set_config('request.jwt.claim.sub', '9d100000-0000-0000-0000-0000000000a1', false);
set role authenticated;
select pg_temp.ok(pg_temp.erro('select sa_cupons()') is not null, 'quem não é superadmin não lista cupons');
select pg_temp.ok(pg_temp.erro($$select sa_salvar_cupom(null, '{"codigo":"HACK","adesao_tipo":"isencao"}')$$) is not null, 'nem cria');
select pg_temp.ok(pg_temp.erro('select count(*) from cupons') is not null, 'nem lê a tabela');
select pg_temp.ok(pg_temp.erro($$select conferir_cupom('HACK', null)$$) is not null, 'conferir é só da função (service_role)');
select pg_temp.ok(pg_temp.erro($$select reservar_cupom('HACK', null, null)$$) is not null, 'reservar também');
reset role;

set role anon;
select pg_temp.ok(pg_temp.erro($$select conferir_cupom('HACK', null)$$) is not null, 'a página pública não confere direto no banco (passa pela função, com limite por IP)');
reset role;

select set_config('request.jwt.claim.sub', :'sa', false);
set role authenticated;
select (sa_salvar_cupom(null, '{"codigo":" bem vindo ","adesao_tipo":"isencao","mensalidade_tipo":"percentual","mensalidade_valor":"20","mensalidade_vezes":"3","isencao_meses":"5","max_usos":"2"}') ->> 'id') as c1 \gset
reset role;
select pg_temp.ok((select codigo from cupons where id = :'c1') = 'BEMVINDO', 'o código vira maiúsculas, sem espaço');
select pg_temp.ok((select isencao_meses is null and adesao_valor is null from cupons where id = :'c1'), 'campo que o tipo não usa não guarda lixo');
set role authenticated;
select pg_temp.ok(pg_temp.erro($$select sa_salvar_cupom(null, '{"codigo":"BEMVINDO","adesao_tipo":"isencao"}')$$) like '%Já existe%', 'código repetido é recusado');
select pg_temp.ok(pg_temp.erro($$select sa_salvar_cupom(null, '{"codigo":"NADA"}')$$) like 'Confira o cupom%', 'sem adesão nem mensalidade é recusado');
select pg_temp.ok(pg_temp.erro($$select sa_salvar_cupom(null, '{"codigo":"CEM","mensalidade_tipo":"percentual","mensalidade_valor":"100"}')$$) like 'Confira o cupom%', '100% na mensalidade é recusado (é isenção)');
select pg_temp.ok(pg_temp.erro($$select sa_salvar_cupom(null, '{"codigo":"LONGO","mensalidade_tipo":"isencao","isencao_meses":"25"}')$$) like 'Confira o cupom%', 'isenção acima de 24 meses é recusada');
select pg_temp.ok(pg_temp.erro($$select sa_salvar_cupom(null, '{"codigo":"X","adesao_tipo":"isencao"}')$$) like 'O código%', 'código curto é recusado');
select (sa_salvar_cupom(null, jsonb_build_object('codigo', 'SOEMP', 'mensalidade_tipo', 'isencao', 'isencao_meses', '2', 'planos', jsonb_build_array(:'pl_emp'))) ->> 'id') as c2 \gset
select (sa_salvar_cupom(null, '{"codigo":"VENCIDO","adesao_tipo":"valor","adesao_valor":"100","valido_ate":"2020-01-01"}') ->> 'id') as c3 \gset
select pg_temp.ok(jsonb_array_length(sa_cupons()) = 3, 'o superadmin lista os cupons');
select pg_temp.ok((select x ->> 'situacao' from jsonb_array_elements(sa_cupons()) x where x ->> 'codigo' = 'VENCIDO') = 'expirado', 'a lista mostra o vencido');
select pg_temp.ok((select x -> 'nomes_planos' ->> 0 from jsonb_array_elements(sa_cupons()) x where x ->> 'codigo' = 'SOEMP') = 'Empresarial', 'e os planos em que vale');
reset role;

-- ---------------------------------------------------------------- a regra (service_role)
select pg_temp.ok((conferir_cupom('BEMVINDO', :'pl_prof') ->> 'valido')::boolean, 'cupom bom vale');
select pg_temp.ok((conferir_cupom('BEMVINDO', :'pl_prof') -> 'cupom' ->> 'mensalidade_vezes') = '3', 'e devolve a foto (o que ele dá)');
select pg_temp.ok(conferir_cupom('NAOEXISTE', :'pl_prof') ->> 'motivo' = 'inexistente', 'inexistente');
select pg_temp.ok(conferir_cupom('bemvindo', :'pl_prof') ->> 'motivo' = 'inexistente', 'minúsculas não chegam aqui (a função normaliza antes)');
select pg_temp.ok(conferir_cupom('VENCIDO', :'pl_prof') ->> 'motivo' = 'expirado', 'vencido');
select pg_temp.ok(conferir_cupom('SOEMP', :'pl_prof') ->> 'motivo' = 'plano', 'fora do plano');
select pg_temp.ok((conferir_cupom('SOEMP', :'pl_emp') ->> 'valido')::boolean, 'no plano dele vale');

-- três empresas do site para gastar o limite de 2 usos
\set e1 '\'9d000000-0000-0000-0000-0000000000e1\''
\set e2 '\'9d000000-0000-0000-0000-0000000000e2\''
\set e3 '\'9d000000-0000-0000-0000-0000000000e3\''
insert into escritorios (id, nome, status, plano_id, cnpj, origem) values
  (:e1, 'Cupom Um', 'aguardando_pagamento', :'pl_prof', null, 'site'),
  (:e2, 'Cupom Dois', 'aguardando_pagamento', :'pl_prof', null, 'site'),
  (:e3, 'Cupom Três', 'aguardando_pagamento', :'pl_prof', null, 'site');
insert into cobranca_empresas (escritorio_id, ciclo, valor, situacao) values (:e1, 'MONTHLY', 299.90, 'sem_assinatura');

select pg_temp.ok((reservar_cupom('BEMVINDO', :'pl_prof', :e1) ->> 'valido')::boolean, '1º uso');
select pg_temp.ok((select cupom ->> 'codigo' from cobranca_empresas where escritorio_id = :e1) = 'BEMVINDO', 'a foto vai para a cobrança da empresa');
select pg_temp.ok((select cupom_id from cobranca_empresas where escritorio_id = :e1) = :'c1', 'com o cupom ligado');
select pg_temp.ok((reservar_cupom('BEMVINDO', :'pl_prof', :e2) ->> 'valido')::boolean, '2º uso (a empresa sem cobrança ainda ganha a linha)');
select pg_temp.ok(reservar_cupom('BEMVINDO', :'pl_prof', :e3) ->> 'motivo' = 'esgotado', 'o 3º passa do limite');
select pg_temp.ok(not exists (select 1 from cupons_usos where escritorio_id = :e3), 'e não grava nada');
select pg_temp.ok(pg_temp.erro($$select reservar_cupom('SOEMP', '$$ || :'pl_emp' || $$', '9d000000-0000-0000-0000-0000000000e1')$$) is not null, 'uma empresa usa um cupom só');

-- mudar o cupom não mexe em quem já usou (a foto fica)
select set_config('request.jwt.claim.sub', :'sa', false);
set role authenticated;
select sa_salvar_cupom(:'c1', '{"codigo":"BEMVINDO","adesao_tipo":"percentual","adesao_valor":"10","max_usos":"2"}');
select pg_temp.ok(pg_temp.erro($$select sa_excluir_cupom('$$ || :'c1' || $$')$$) like '%desative%', 'cupom usado não se apaga (desativa)');
select sa_ativar_cupom(:'c1', false);
select sa_excluir_cupom(:'c3');
reset role;
select pg_temp.ok(not exists (select 1 from cupons where id = :'c3'), 'cupom nunca usado se apaga');
select pg_temp.ok((select cupom ->> 'adesao_tipo' from cobranca_empresas where escritorio_id = :e1) = 'isencao', 'a empresa continua com o cupom do dia do cadastro');
select pg_temp.ok(conferir_cupom('BEMVINDO', :'pl_prof') ->> 'motivo' = 'inativo', 'desativado não vale mais');

-- a empresa apagada (cadastro abandonado) devolve o uso
update cupons set ativo = true where id = :'c1';
delete from escritorios where id = :e2;
select pg_temp.ok((select count(*) from cupons_usos where cupom_id = :'c1') = 1, 'a empresa apagada devolve o uso');
select pg_temp.ok((reservar_cupom('BEMVINDO', :'pl_prof', :e3) ->> 'valido')::boolean, 'e outra pode usar');

-- ---------------------------------------------------------------- a tela de pagamento
insert into membros_escritorio (escritorio_id, user_id, papel) values (:e1, :dona, 'dono');
update cobranca_empresas set cupom_desconto_ate = '2027-01-30' where escritorio_id = :e1;
select set_config('request.jwt.claim.sub', '9d100000-0000-0000-0000-0000000000a1', false);
set role authenticated;
select minha_cobranca() as mc \gset
reset role;
select pg_temp.ok((:'mc'::jsonb -> 'cupom' ->> 'codigo') = 'BEMVINDO', 'minha_cobranca mostra o cupom');
select pg_temp.ok((:'mc'::jsonb ->> 'cupom_desconto_ate') = '2027-01-30', 'e o fim do desconto');

-- ---------------------------------------------------------------- o webhook: só a adesão não empurra o vencimento
update cobranca_empresas set proximo_vencimento = (hoje_brasil() + interval '3 months')::date, situacao = 'aguardando' where escritorio_id = :e1;
insert into pagamentos (escritorio_id, finalidade, asaas_id, valor, status, forma, vencimento, ciclo, adesao, sem_periodo)
values (:e1, 'mensalidade', 'pay_cupom_adesao', 500, 'PENDING', 'PIX', hoje_brasil(), 'MONTHLY', 500, true);
select aplicar_pagamento_asaas('PAYMENT_CREATED', jsonb_build_object('id', 'pay_cupom_adesao', 'status', 'PENDING', 'value', 500, 'dueDate', hoje_brasil()::text, 'invoiceUrl', 'https://x/i/1'));
select pg_temp.ok((select proximo_vencimento from cobranca_empresas where escritorio_id = :e1) = (hoje_brasil() + interval '3 months')::date,
  'a fatura só da adesão em aberto não troca o vencimento da 1ª mensalidade');
select aplicar_pagamento_asaas('PAYMENT_RECEIVED', jsonb_build_object('id', 'pay_cupom_adesao', 'status', 'RECEIVED', 'value', 500, 'dueDate', hoje_brasil()::text)) as r \gset
select pg_temp.ok((:'r'::jsonb ->> 'acao') = 'ativou', 'paga a adesão, a empresa entra');
select pg_temp.ok((:'r'::jsonb ->> 'criar_assinatura')::boolean, 'e pede a assinatura');
select pg_temp.ok((:'r'::jsonb ->> 'proximo_vencimento') = ((hoje_brasil() + interval '3 months')::date)::text,
  'vencendo no fim da isenção (não um período depois do pagamento)');

-- o pagamento normal (com período) continua empurrando um período
update escritorios set status = 'aguardando_pagamento' where id = :e3;
insert into cobranca_empresas (escritorio_id, ciclo, valor, situacao) values (:e3, 'MONTHLY', 299.90, 'aguardando')
on conflict (escritorio_id) do update set situacao = 'aguardando', proximo_vencimento = null;
insert into pagamentos (escritorio_id, finalidade, asaas_id, valor, status, forma, vencimento, ciclo, adesao)
values (:e3, 'mensalidade', 'pay_cupom_normal', 799.90, 'PENDING', 'PIX', hoje_brasil(), 'MONTHLY', 500);
select aplicar_pagamento_asaas('PAYMENT_RECEIVED', jsonb_build_object('id', 'pay_cupom_normal', 'status', 'RECEIVED', 'value', 799.90, 'dueDate', hoje_brasil()::text)) as r \gset
select pg_temp.ok((:'r'::jsonb ->> 'proximo_vencimento') = ((hoje_brasil() + interval '1 month')::date)::text, 'período + adesão: um mês depois, como antes');

-- cadastro do site que ficou 24 h sem pagar não segura o cupom
insert into cupons (codigo, adesao_tipo, max_usos) values ('UMSO', 'isencao', 1);
insert into escritorios (id, nome, status, plano_id, origem) values ('9d000000-0000-0000-0000-0000000000e4', 'Cupom Abandonado', 'aguardando_pagamento', :'pl_prof', 'site');
select reservar_cupom('UMSO', :'pl_prof', '9d000000-0000-0000-0000-0000000000e4');
select pg_temp.ok(conferir_cupom('UMSO', :'pl_prof') ->> 'motivo' = 'esgotado', 'o uso recente conta');
update cupons_usos set usado_em = now() - interval '25 hours' where escritorio_id = '9d000000-0000-0000-0000-0000000000e4';
select pg_temp.ok((conferir_cupom('UMSO', :'pl_prof') ->> 'valido')::boolean, 'abandonado há mais de 24 h: o uso volta a valer para outro');
update escritorios set status = 'ativo' where id = '9d000000-0000-0000-0000-0000000000e4';
select pg_temp.ok(conferir_cupom('UMSO', :'pl_prof') ->> 'motivo' = 'esgotado', 'quem pagou (ativo) conta sempre');
delete from escritorios where id = '9d000000-0000-0000-0000-0000000000e4';

-- limpeza
delete from pagamentos where asaas_id in ('pay_cupom_adesao', 'pay_cupom_normal');
delete from escritorios where id in (:e1, :e3);
delete from cupons;
