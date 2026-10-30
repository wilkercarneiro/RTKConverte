-- Concluir serviço (supabase/migrations/0033_concluir_servico.sql), como postgres
-- e numa transação desfeita: carimbo do servidor, histórico próprio, pedido do
-- GPROL entregue só quando TODOS os serviços principais concluem, fila para o
-- GPROL, marco "entregue", reabrir e serviço derivado.
\set ON_ERROR_STOP 1
begin;

create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FALHOU: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;

do $$
declare
  -- um escritório com Geo e CAR no plano e alguém na equipe (o cenário dos outros testes tem dois)
  esc uuid := (select e.id from escritorios e
                where recurso_liberado(e.id, 'servico.completo') and recurso_liberado(e.id, 'servico.car')
                  and exists (select 1 from membros_escritorio m where m.escritorio_id = e.id)
                order by e.id limit 1);
  ped uuid := gen_random_uuid();
  geo uuid := gen_random_uuid();
  car uuid := gen_random_uuid();
  gleba uuid := gen_random_uuid();
  t0 timestamptz;
begin
  perform pg_temp.ok(esc is not null, 'há um escritório de teste');
  insert into integracoes (escritorio_id, provedor, status, empresa_externa_id, empresa_externa_nome)
    values (esc, 'gprol', 'ativa', gen_random_uuid()::text, 'GPROL de teste')
    on conflict (escritorio_id, provedor) do update set status = 'ativa';
  insert into pedidos_externos (id, escritorio_id, externo_id, origem, titulo, modalidades, status)
    values (ped, esc, gen_random_uuid(), 'gprol', 'Geo + CAR — Fazenda Teste', '{completo,car}', 'pendente');
  insert into servicos (id, escritorio_id, tipo, modalidade, status, denominacao)
    values (geo, esc, 'geo', 'completo', 'gerado', 'FAZENDA TESTE'),
           (car, esc, 'geo', 'car', 'gerado', 'FAZENDA TESTE CAR');
  update servicos set pedido_externo_id = ped where id in (geo, car);
  perform pg_temp.ok((select status from pedidos_externos where id = ped) = 'em_execucao', 'pedido em execução com os dois serviços');
  insert into servicos (id, escritorio_id, tipo, modalidade, status, denominacao, origem_id)
    values (gleba, esc, 'geo', 'completo', 'gerado', 'FAZENDA TESTE - PARTE 1', geo);
  perform pg_temp.ok((select pedido_externo_id from servicos where id = gleba) = ped, 'derivado herda o pedido');
  delete from integracao_saida where escritorio_id = esc;
  -- daqui em diante alguém logado (o cenário foi montado como servidor):
  -- sem usuário o gatilho genérico de auditoria nem registra
  perform set_config('request.jwt.claim.sub', (select user_id::text from membros_escritorio where escritorio_id = esc limit 1), true);
  perform pg_temp.ok(auth.uid() is not null, 'há um usuário do escritório logado');

  -- só o Geo concluído: o pedido não está entregue (falta o CAR)
  update servicos set concluido_em = '2000-01-01' where id = geo;
  select concluido_em into t0 from servicos where id = geo;
  perform pg_temp.ok(t0 > '2020-01-01', 'a data é a do servidor, não a da tela');
  perform pg_temp.ok((select status from pedidos_externos where id = ped) = 'em_execucao', 'um de dois concluído: pedido segue em execução');
  perform pg_temp.ok(not ('entregue' = any(integracao_marcos_do_pedido(ped))), 'sem marco entregue ainda');
  perform pg_temp.ok(exists (select 1 from atividades where servico_id = geo and acao = 'servico.concluido'), 'histórico: concluiu o serviço');
  perform pg_temp.ok(not exists (select 1 from atividades where servico_id = geo and acao = 'servico.alterado'
    and coalesce(detalhe->'campos', '[]'::jsonb) ? 'concluido_em'), 'sem "alterou o serviço" duplicado');
  perform pg_temp.ok((select concluido_por from servicos where id = geo) = auth.uid(), 'o autor é quem está logado');

  -- gravar de novo um serviço já concluído não muda a data
  update servicos set concluido_em = now() + interval '1 day' where id = geo;
  perform pg_temp.ok((select concluido_em from servicos where id = geo) = t0, 'data da conclusão não muda ao regravar');

  -- o derivado concluído não decide o pedido
  update servicos set concluido_em = now() where id = gleba;
  perform pg_temp.ok((select status from pedidos_externos where id = ped) = 'em_execucao', 'derivado concluído não entrega o pedido');

  -- o CAR concluído: todos os principais prontos → entregue + fila + marco
  update servicos set concluido_em = now() where id = car;
  perform pg_temp.ok((select status from pedidos_externos where id = ped) = 'entregue', 'todos concluídos: pedido entregue');
  perform pg_temp.ok((select entregue_em from pedidos_externos where id = ped) is not null, 'com a data da entrega');
  perform pg_temp.ok(exists (select 1 from integracao_saida where escritorio_id = esc and tipo = 'pedido' and ref_id = ped and enviado_em is null),
    'a entrega entra na fila do GPROL');
  perform pg_temp.ok('entregue' = any(integracao_marcos_do_pedido(ped)), 'marco entregue para o card andar');

  -- reabrir o CAR: o pedido volta a em execução (o card no GPROL não volta)
  update servicos set concluido_em = null where id = car;
  perform pg_temp.ok((select concluido_por from servicos where id = car) is null, 'reaberto limpa o autor');
  perform pg_temp.ok((select status from pedidos_externos where id = ped) = 'em_execucao', 'reabrir devolve o pedido a em execução');
  perform pg_temp.ok(exists (select 1 from atividades where servico_id = car and acao = 'servico.reaberto'), 'histórico: reabriu o serviço');

  -- serviço sem pedido: conclui sem mexer em nada do GPROL
  update servicos set pedido_externo_id = null where id = car;
  delete from integracao_saida where escritorio_id = esc;
  update servicos set concluido_em = now() where id = car;
  perform pg_temp.ok((select concluido_em from servicos where id = car) is not null, 'serviço solto conclui');
  perform pg_temp.ok(not exists (select 1 from integracao_saida where escritorio_id = esc and tipo = 'pedido'), 'e não mexe na fila');
end $$;

rollback;
