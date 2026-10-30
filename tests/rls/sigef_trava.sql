-- Trava da 0032: a sincronização com o INCRA não apaga a cópia oficial em massa.
-- Roda depois da 0030 (scripts/testar-rls.sh, só com PostGIS). Como postgres
-- (no ar quem chama é a edge function, com service_role).
\set ON_ERROR_STOP 1

create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FALHOU: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;
-- n parcelas oficiais pequenas numa fileira, longe das do outro teste
create function pg_temp.lote(n int) returns jsonb language sql immutable as $$
  select jsonb_agg(jsonb_build_object(
    'codigo', 'trava-' || i, 'nome', 'PARCELA ' || i, 'uf', 'BA', 'fonte', 'wfs',
    'geometria', jsonb_build_object('type', 'MultiPolygon', 'coordinates', jsonb_build_array(jsonb_build_array(jsonb_build_array(
      jsonb_build_array(-45 + i * 0.001, -10.0), jsonb_build_array(-45 + i * 0.001 + 0.0008, -10.0),
      jsonb_build_array(-45 + i * 0.001 + 0.0008, -9.9992), jsonb_build_array(-45 + i * 0.001, -9.9992),
      jsonb_build_array(-45 + i * 0.001, -10.0)))))))
  from generate_series(1, n) i
$$;
create function pg_temp.na_caixa() returns int language sql as $$
  select count(*)::int from public.parcelas_sigef where codigo like 'trava-%' and escritorio_id is null
$$;

do $$
declare r jsonb;
begin
  r := public.sigef_sincronizar(pg_temp.lote(20), -45.0, -10.001, -44.97, -9.99, true);
  perform pg_temp.ok(pg_temp.na_caixa() = 20, 'a primeira consulta guarda as 20 parcelas');

  -- resposta "cortada": só 5 das 20 vieram → 15 sumiriam (mais de 10 e de 30%)
  r := public.sigef_sincronizar(pg_temp.lote(5), -45.0, -10.001, -44.97, -9.99, true);
  perform pg_temp.ok((r->>'removidas')::int = 0, 'resposta incompleta não apaga nada');
  perform pg_temp.ok((r->>'remocao_suspensa')::int = 15, 'e diz quantas ficaram mantidas (15)');
  perform pg_temp.ok(pg_temp.na_caixa() = 20, 'as 20 continuam na cópia');

  -- 18 de 20: duas canceladas de verdade no SIGEF → saem
  r := public.sigef_sincronizar(pg_temp.lote(18), -45.0, -10.001, -44.97, -9.99, true);
  perform pg_temp.ok((r->>'removidas')::int = 2, 'remoção pequena acontece (2)');
  perform pg_temp.ok((r->>'remocao_suspensa')::int = 0, 'sem suspensão');
  perform pg_temp.ok(pg_temp.na_caixa() = 18, 'ficam 18');

  -- remover = false (resposta cortada pelo nosso limite) não apaga nada
  r := public.sigef_sincronizar(pg_temp.lote(17), -45.0, -10.001, -44.97, -9.99, false);
  perform pg_temp.ok((r->>'removidas')::int = 0 and pg_temp.na_caixa() = 18, 'sem remover: nada sai');

  delete from public.parcelas_sigef where codigo like 'trava-%';
end $$;

select pg_temp.ok(not has_function_privilege('authenticated',
  'public.sigef_sincronizar(jsonb, double precision, double precision, double precision, double precision, boolean)', 'execute'),
  'usuário logado não chama sigef_sincronizar');
select pg_temp.ok(not has_function_privilege('anon',
  'public.sigef_sincronizar(jsonb, double precision, double precision, double precision, double precision, boolean)', 'execute'),
  'anon não chama sigef_sincronizar');
