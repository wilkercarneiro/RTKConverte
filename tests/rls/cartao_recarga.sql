-- Teste do cartão de crédito e da compra automática de créditos
-- (supabase/migrations/0037_cartao_recarga_automatica.sql).
-- Roda depois de tests/rls/geo_parte.sql, no mesmo cenário:
--   A = escritório legado (a1 superadmin), B = b1 dono, b2 gerente.
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
-- deixa a carteira `t` de `e` zerada (gasta a franquia e o extra)
create function pg_temp.zerar(e uuid, t text) returns void language plpgsql as $$
declare i int;
begin
  for i in 1 .. greatest(coalesce(franquia_credito(e, t), 0) - uso_credito(e, t), 0) loop
    insert into consumos_credito (escritorio_id, chave, mes, origem, tipo) values (e, 'servico.car', inicio_periodo(e), 'plano', t);
  end loop;
  for i in 1 .. greatest(saldo_extra(e, t), 0) loop
    insert into consumos_credito (escritorio_id, chave, mes, origem, tipo) values (e, 'servico.car', inicio_periodo(e), 'extra', t);
  end loop;
end $$;
grant execute on all functions in schema pg_temp to public;

select id as esc_b from escritorios where not modelos_compartilhados and id <> 'd0000000-0000-0000-0000-00000000000d' limit 1 \gset
select escritorio_id as esc_b from membros_escritorio where user_id = 'b1000000-0000-0000-0000-000000000001' \gset
select id as pl_car from planos where nome = 'Só CAR' \gset

-- B no Só CAR (49,90/mês; CAR: 5 por mês, extra 19,90 de 2 a 9, 15,00 de 10 a 50), com o Asaas ligado
update escritorios set plano_id = :'pl_car', status = 'ativo', mensalidade = null where id = :'esc_b';
delete from escritorio_creditos where escritorio_id = :'esc_b';
delete from precos_credito where escritorio_id = :'esc_b';
insert into cobranca_config (key, value) values ('asaas_api_key', '$aact_teste') on conflict (key) do update set value = excluded.value;

-- ---------------------------------------------------------------- o aviso "cadastre o cartão"
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok((minha_cobranca() ->> 'precisa_cartao')::boolean, 'empresa que paga e não tem cartão: aparece o aviso');
select pg_temp.ok(minha_cobranca() -> 'cartao' = 'null'::jsonb, 'ainda sem cartão');
select pg_temp.ok(minha_cobranca() -> 'contato' ?& array['email', 'telefone', 'cnpj', 'responsavel'], 'o contato da empresa vem para pré-preencher o titular');
select pg_temp.ok(pg_temp.erro('select * from cobranca_cartoes') like '%permission denied%', 'ninguém lê a tabela do cartão pelo REST');
select pg_temp.ok(pg_temp.erro($$insert into recarga_automatica (escritorio_id, tipo, quantidade) values (escritorio_atual(), 'car', 10)$$) like '%permission denied%',
                  'a compra automática não é gravada direto (só pela função do dono)');
select pg_temp.ok(pg_temp.erro(format('select reservar_recarga_automatica(%L, %L, null)', :'esc_b', 'car')) like '%permission denied%',
                  'quem reserva a compra é só o servidor');

-- ---------------------------------------------------------------- o dono liga a compra automática
select pg_temp.ok(pg_temp.erro($$select definir_recarga_automatica('car', true, 1, null)$$) like '%mínima é de 2%', 'quantidade abaixo do mínimo da tabela');
select pg_temp.ok(pg_temp.erro($$select definir_recarga_automatica('geral', true, 5, null)$$) like '%não estão à venda%', 'carteira que o plano não vende');
select pg_temp.ok(pg_temp.erro($$select definir_recarga_automatica('car', true, 10, 100)$$) like '%menor que uma compra%', 'teto menor que uma compra (10 × 15,00)');
select pg_temp.ok((definir_recarga_automatica('car', true, 10, 300) -> 'car' ->> 'quantidade')::int = 10, 'liga: 10 de CAR, teto de R$ 300 por mês');
select pg_temp.ok((meus_creditos() -> 'recarga' -> 'car' ->> 'limite_periodo')::numeric = 300, 'a tela de créditos vê a configuração');
reset role;

select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-000000000002', false);
set role authenticated;
select pg_temp.ok(pg_temp.erro($$select definir_recarga_automatica('car', false, 10, null)$$) like '%Só o dono%', 'o gerente não mexe na compra automática');
reset role;

-- ---------------------------------------------------------------- reservar (o que a edge function chama)
set role service_role;
select pg_temp.ok((reservar_recarga_automatica(:'esc_b', 'car', null) ->> 'motivo') = 'sem_cartao', 'sem cartão salvo: não compra');
insert into cobranca_cartoes (escritorio_id, asaas_token, bandeira, final, validade, titular)
values (:'esc_b', null, 'VISA', '1111', '12/2029', 'MARIA');
select pg_temp.ok((reservar_recarga_automatica(:'esc_b', 'car', null) ->> 'motivo') = 'sem_cartao', 'cartão sem token (Asaas sem tokenização): não compra');
update cobranca_cartoes set asaas_token = 'tok_teste' where escritorio_id = :'esc_b';
select pg_temp.ok((reservar_recarga_automatica(:'esc_b', 'car', null) ->> 'motivo') = 'tem_saldo', 'carteira com saldo: não compra');
select pg_temp.zerar(:'esc_b', 'car');
select pg_temp.ok(restante_carteira(:'esc_b', 'car') = 0, 'carteira de CAR zerada');
select reservar_recarga_automatica(:'esc_b', 'car', null) as r1 \gset
select pg_temp.ok((:'r1'::jsonb ->> 'pode')::boolean and (:'r1'::jsonb ->> 'valor')::numeric = 150, 'zerou: reserva 10 por R$ 150,00');
select pg_temp.ok((select automatica and finalidade = 'creditos' and status = 'CRIANDO' from pagamentos where id = (:'r1'::jsonb ->> 'pagamento_id')::uuid),
                  'nasce o pagamento marcado como automático');
select pg_temp.ok((select status = 'pendente' and origem = 'compra' from creditos_extras where id = (:'r1'::jsonb ->> 'credito_id')::uuid),
                  'e o pedido pendente');
select pg_temp.ok((reservar_recarga_automatica(:'esc_b', 'car', null) ->> 'motivo') = 'em_andamento', 'duas telas ao mesmo tempo: só uma compra');

-- o cartão aprovou: o webhook (ou a própria função) aplica
update pagamentos set asaas_id = 'pay_auto_1', status = 'PENDING' where id = (:'r1'::jsonb ->> 'pagamento_id')::uuid;
select pg_temp.ok((aplicar_pagamento_asaas('PAYMENT_CONFIRMED', '{"id": "pay_auto_1", "status": "CONFIRMED", "billingType": "CREDIT_CARD"}') ->> 'acao') = 'creditos',
                  'pagou: os créditos entram');
select pg_temp.ok(restante_carteira(:'esc_b', 'car') = 10, 'a carteira volta a ter 10');
select pg_temp.ok((reservar_recarga_automatica(:'esc_b', 'car', null) ->> 'motivo') = 'tem_saldo', 'com saldo de novo: não compra');
select pg_temp.ok(gasto_recarga_periodo(:'esc_b', 'car') = 150, 'gasto da compra automática no mês: 150');

-- o teto do mês
select pg_temp.zerar(:'esc_b', 'car');
update recarga_automatica set limite_periodo = 200 where escritorio_id = :'esc_b';
select pg_temp.ok((reservar_recarga_automatica(:'esc_b', 'car', null) ->> 'motivo') = 'limite', 'passaria do teto (150 + 150 > 200): não compra');
update recarga_automatica set limite_periodo = null where escritorio_id = :'esc_b';

-- cartão recusado há pouco: segura
update cobranca_cartoes set recusa_em = now() - interval '1 hour', recusa_motivo = 'Cartão sem limite.' where escritorio_id = :'esc_b';
select pg_temp.ok((reservar_recarga_automatica(:'esc_b', 'car', null) ->> 'motivo') = 'recusado', 'recusado há 1 hora: espera');
update cobranca_cartoes set recusa_em = now() - interval '7 hours' where escritorio_id = :'esc_b';
select pg_temp.ok((reservar_recarga_automatica(:'esc_b', 'car', null) ->> 'pode')::boolean, 'recusa antiga: tenta de novo');

-- desligada, ou empresa suspensa: não compra
update recarga_automatica set ativo = false where escritorio_id = :'esc_b';
select pg_temp.ok((reservar_recarga_automatica(:'esc_b', 'car', null) ->> 'motivo') = 'desligada', 'desligada: não compra');
update recarga_automatica set ativo = true where escritorio_id = :'esc_b';
update escritorios set status = 'aguardando_pagamento' where id = :'esc_b';
select pg_temp.ok((reservar_recarga_automatica(:'esc_b', 'car', null) ->> 'motivo') = 'empresa_inativa', 'empresa suspensa: não compra');
update escritorios set status = 'ativo' where id = :'esc_b';
reset role;

-- ---------------------------------------------------------------- o que as telas veem
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok(not (minha_cobranca() ->> 'precisa_cartao')::boolean, 'com cartão: o aviso some');
select pg_temp.ok(minha_cobranca() -> 'cartao' ->> 'final' = '1111' and (minha_cobranca() -> 'cartao' ->> 'reutilizavel')::boolean,
                  'a tela mostra o final e se o cartão compra créditos');
select pg_temp.ok(not (minha_cobranca() -> 'cartao' ? 'asaas_token') and minha_cobranca()::text not like '%tok_teste%', 'o token nunca vai para o navegador');
select pg_temp.ok(exists (select 1 from jsonb_array_elements(meus_creditos() -> 'compras') c where (c ->> 'automatica')::boolean),
                  'a lista de compras marca a automática');
reset role;

select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok(sa_cobranca_empresa(:'esc_b') -> 'cartao' ->> 'bandeira' = 'VISA', 'o painel vê o cartão da empresa');
select pg_temp.ok((sa_cobranca_empresa(:'esc_b') -> 'recarga' -> 'car' ->> 'quantidade')::int = 10, 'e a compra automática');
reset role;

-- empresa que não paga nada (sem mensalidade e sem crédito à venda): sem aviso
update escritorios set mensalidade = 0 where id = :'esc_b';
delete from cobranca_cartoes where escritorio_id = :'esc_b';
insert into precos_credito (escritorio_id, tipo, a_partir_de, preco) values (:'esc_b', 'car', 1, 0) on conflict do nothing;
select pg_temp.ok(precisa_cartao(:'esc_b'), 'mensalidade zero, mas ainda compra créditos: pede o cartão');
delete from precos_credito where escritorio_id = :'esc_b';
update escritorios set plano_id = null where id = :'esc_b';
select pg_temp.ok(not precisa_cartao(:'esc_b'), 'sem mensalidade e sem crédito à venda: não pede cartão');
delete from cobranca_config where key = 'asaas_api_key';
select pg_temp.ok(not precisa_cartao(:'esc_b'), 'sem o Asaas ligado: não pede cartão');

\echo 'cartão e compra automática: todos os testes passaram'
