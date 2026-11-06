-- Consultar imóvel (supabase/migrations/0045_analises_imovel.sql): o histórico
-- de consultas é por empresa (RLS), o escritório e o autor são preenchidos no
-- INSERT, e a tela não grava o laudo (só a service_role). Numa transação desfeita.
\set ON_ERROR_STOP 1
begin;

create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FALHOU: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;
create function pg_temp.recusa(cmd text) returns boolean language plpgsql as $$
begin
  execute cmd;
  return false;
exception when others then
  return true;
end $$;
create function pg_temp.afetadas(cmd text) returns int language plpgsql as $$
declare n int;
begin
  execute cmd;
  get diagnostics n = row_count;
  return n;
end $$;

select m.user_id as ua, m.escritorio_id as esc_a from membros_escritorio m join escritorios e on e.id = m.escritorio_id
 where e.status = 'ativo' order by m.escritorio_id, m.user_id limit 1 \gset
select m.user_id as ub, m.escritorio_id as esc_b from membros_escritorio m join escritorios e on e.id = m.escritorio_id
 where e.status = 'ativo' and m.escritorio_id <> :'esc_a' order by m.user_id limit 1 \gset

select pg_temp.ok(to_regclass('analises_imovel') is not null, 'tabela analises_imovel existe');

-- ---------------------------------------------------------------- como membro da empresa A
select set_config('request.jwt.claim.sub', :'ua', false);
set role authenticated;
insert into analises_imovel (entrada, tipo_entrada, rotulo, codigo, uf, area_ha, resumo, tom, resultado)
values ('BA-2919306-4185CFD257C54A4788F5C145A504C5C8', 'car', 'CAR BA-2919306', 'BA-2919306-4185CFD257C54A4788F5C145A504C5C8', 'BA', 743.8531,
        'Nenhuma restrição encontrada', 'ok', '{"imovel": {}}');
select pg_temp.ok((select escritorio_id from analises_imovel where rotulo = 'CAR BA-2919306') = :'esc_a', 'o escritório é preenchido no insert');
select pg_temp.ok((select user_id from analises_imovel where rotulo = 'CAR BA-2919306') = :'ua', 'o autor é quem inseriu');
select pg_temp.ok(pg_temp.recusa(format('insert into analises_imovel (tipo_entrada, rotulo, resultado, escritorio_id) values (%L, %L, %L, %L)', 'car', 'x', '{}', :'esc_b')),
                  'não dá para gravar em nome de outra empresa');
select pg_temp.ok(pg_temp.recusa($$insert into analises_imovel (tipo_entrada, rotulo, laudo) values ('car', 'x', 'laudo falso')$$),
                  'a tela não grava laudo');
select pg_temp.ok(pg_temp.recusa($$update analises_imovel set laudo_em = null where rotulo = 'CAR BA-2919306'$$),
                  'a tela não mexe no limite de laudos (laudo_em)');
select pg_temp.ok(pg_temp.recusa($$insert into analises_imovel (tipo_entrada, rotulo, resultado) values ('car', 'x', '[1]')$$),
                  'resultado só aceita objeto JSON');
select pg_temp.ok(pg_temp.recusa($$insert into analises_imovel (tipo_entrada, rotulo, resultado) values ('outro', 'x', '{}')$$),
                  'tipo de entrada fora da lista é recusado');
select pg_temp.ok(pg_temp.afetadas($$update analises_imovel set resumo = 'Sobrepõe X', tom = 'perigo' where rotulo = 'CAR BA-2919306'$$) = 1,
                  'a empresa atualiza o resumo da própria consulta');
reset role;

-- ---------------------------------------------------------------- como membro da empresa B
select set_config('request.jwt.claim.sub', :'ub', false);
set role authenticated;
select pg_temp.ok(not exists (select 1 from analises_imovel where rotulo = 'CAR BA-2919306'), 'outra empresa não vê a consulta de A');
select pg_temp.ok(pg_temp.afetadas($$delete from analises_imovel where rotulo = 'CAR BA-2919306'$$) = 0, 'outra empresa não apaga a consulta de A');
select pg_temp.ok(pg_temp.afetadas($$update analises_imovel set resumo = 'intruso' where rotulo = 'CAR BA-2919306'$$) = 0, 'outra empresa não altera a consulta de A');
reset role;

-- ---------------------------------------------------------------- a função (service_role) grava o laudo
-- o limite é a MESMA conta da função analise-imovel: chamadas aprovadas em chamadas_ia nas últimas 24 h
create function pg_temp.laudos_hoje(esc uuid) returns bigint language sql as $$
  select count(*) from chamadas_ia where escritorio_id = esc and nome_arquivo = 'laudo:consulta-imovel' and aprovada
     and created_at > now() - interval '24 hours'
$$;
set role service_role;
insert into chamadas_ia (escritorio_id, user_id, nome_arquivo, modelo, tentativa, aprovada, motivo)
values (:'esc_a', :'ua', 'laudo:consulta-imovel', 'teste', 1, true, 'laudo');
update analises_imovel set laudo = '1. Identificação', laudo_em = now(), laudo_modelo = 'teste' where rotulo = 'CAR BA-2919306';
reset role;
select pg_temp.ok(pg_temp.laudos_hoje(:'esc_a') = 1, 'o laudo conta no limite diário da empresa');
select pg_temp.ok((select user_id from analises_imovel where rotulo = 'CAR BA-2919306') = :'ua', 'gravar o laudo não troca o autor');

-- refazer o laudo na mesma consulta (a mesma linha é sobrescrita) conta de novo
set role service_role;
insert into chamadas_ia (escritorio_id, user_id, nome_arquivo, modelo, tentativa, aprovada, motivo)
values (:'esc_a', :'ua', 'laudo:consulta-imovel', 'teste', 1, true, 'laudo');
update analises_imovel set laudo = '1. Identificação (refeito)', laudo_em = now() where rotulo = 'CAR BA-2919306';
reset role;
select pg_temp.ok(pg_temp.laudos_hoje(:'esc_a') = 2, 'refazer o laudo conta de novo no limite');
select pg_temp.ok((select count(*) from analises_imovel where escritorio_id = :'esc_a' and laudo_em is not null) = 1,
                  '(a contagem antiga, por laudo_em, daria 1: era burlável)');

-- ---------------------------------------------------------------- a tela não mexe no limite nem no laudo
select set_config('request.jwt.claim.sub', :'ua', false);
set role authenticated;
select pg_temp.ok(pg_temp.afetadas($$update analises_imovel set resumo = 'Nenhuma restrição', tom = 'ok' where rotulo = 'CAR BA-2919306'$$) = 1,
                  'a tela muda o resumo');
reset role;
select pg_temp.ok((select laudo from analises_imovel where rotulo = 'CAR BA-2919306') is not null, 'mudar só o resumo mantém o laudo');
set role authenticated;
select pg_temp.ok(pg_temp.afetadas($$update analises_imovel set resultado = '{"imovel": {}, "forjado": true}' where rotulo = 'CAR BA-2919306'$$) = 1,
                  'a tela regrava o resultado (tentar de novo uma fonte)');
reset role;
select pg_temp.ok((select laudo is null and laudo_em is null and laudo_modelo is null from analises_imovel where rotulo = 'CAR BA-2919306'),
                  'resultado trocado pela tela apaga o laudo: o laudo nunca sai com dados diferentes dos dele');
set role authenticated;
select pg_temp.ok(pg_temp.recusa($$delete from chamadas_ia$$) and pg_temp.recusa($$update chamadas_ia set aprovada = false$$)
                  and pg_temp.recusa($$insert into chamadas_ia (escritorio_id, modelo, tentativa) values (escritorio_atual(), 'x', 1)$$),
                  'a tela não apaga, altera nem insere em chamadas_ia');
select pg_temp.ok(pg_temp.afetadas($$delete from analises_imovel where rotulo = 'CAR BA-2919306'$$) = 1, 'a empresa apaga a própria consulta');
reset role;
select pg_temp.ok(pg_temp.laudos_hoje(:'esc_a') = 2, 'apagar a consulta com laudo NÃO devolve o laudo para a conta');

-- anônimo não vê nada
set role anon;
select pg_temp.ok(pg_temp.recusa('select count(*) from analises_imovel'), 'anônimo não lê o histórico');
reset role;

rollback;
