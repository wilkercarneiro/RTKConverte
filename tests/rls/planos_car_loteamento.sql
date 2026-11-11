-- Teste da 0051: o Só CAR (e o Loteamento, se existir) voltam ao cadastro;
-- o Autônomo continua fora. Roda depois da 0050 no npm run test:rls.
\set ON_ERROR_STOP 1

create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FALHOU: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;

select pg_temp.ok((select ativo and vende_no_site from planos where nome = 'Só CAR'), 'o Só CAR volta ao cadastro');
select pg_temp.ok(coalesce((select ativo and vende_no_site from planos where nome = 'Loteamento'), true), 'o Loteamento (se existir) volta ao cadastro');
select pg_temp.ok(not (select ativo from planos where nome = 'Autônomo'), 'o Autônomo continua fora');
select pg_temp.ok((select array_agg(x ->> 'nome' order by ord) from jsonb_array_elements(cadastro_planos() -> 'planos') with ordinality t(x, ord))
                  @> array['Profissional', 'Empresarial', 'Só CAR'],
                  'a página de cadastro mostra Profissional, Empresarial e Só CAR');
select pg_temp.ok((select (x -> 'creditos' -> 1 ->> 'por_mes')::int = 5 from jsonb_array_elements(cadastro_planos() -> 'planos') x where x ->> 'nome' = 'Só CAR'),
                  'o Só CAR continua com os 5 créditos de CAR por mês');
