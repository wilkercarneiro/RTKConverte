-- Teste das parcelas do SIGEF por empresa (supabase/migrations/0030_sigef_parcelas_por_empresa.sql).
-- Precisa do PostGIS: scripts/testar-rls.sh só roda quando a extensão existe.
-- Mesmo cenário dos outros testes: A = escritório legado (a1), B = escritório novo (b1 dono).
-- Três etapas:
--   -v etapa=antes      → 0018/0019 aplicadas: a falha (empresa grava parcela para todos)
--   -v etapa=depois     → 0030 aplicada: quarentena, isolamento, só o servidor grava oficial
--   -v etapa=reaplicada → 0030 aplicada de novo: nada muda
\set ON_ERROR_STOP 1

\if :{?etapa}
\else
  \echo 'informe -v etapa=antes|depois|reaplicada'
  \quit
\endif

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
-- retângulo lon/lat como GeoJSON Polygon
create function pg_temp.quad(x0 float8, y0 float8, x1 float8, y1 float8) returns jsonb language sql immutable as $$
  select jsonb_build_object('type', 'Polygon', 'coordinates',
    jsonb_build_array(jsonb_build_array(
      jsonb_build_array(x0, y0), jsonb_build_array(x1, y0), jsonb_build_array(x1, y1), jsonb_build_array(x0, y1), jsonb_build_array(x0, y0))))
$$;
-- "codigo:fonte" de cada parcela do mapa, em ordem
create function pg_temp.mapa(r jsonb) returns text language sql immutable as $$
  select coalesce(string_agg((f->'properties'->>'codigo') || ':' || (f->'properties'->>'fonte'), ',' order by f->'properties'->>'codigo', f->'properties'->>'fonte'), '')
    from jsonb_array_elements(r->'parcelas'->'features') f
$$;
-- códigos das sobreposições, em ordem
create function pg_temp.sobre(r jsonb) returns text language sql immutable as $$
  select coalesce(string_agg(s->>'codigo', ',' order by s->>'codigo'), '')
    from jsonb_array_elements(r->'sobreposicoes') s
$$;
create function pg_temp.imovel() returns jsonb language sql immutable as $$
  select pg_temp.quad(-49.001, -16.001, -48.999, -15.999)
$$;
grant usage on schema extensions to anon, authenticated, service_role;
grant execute on all functions in schema pg_temp to public;

select :'etapa' = 'antes' as eh_antes, :'etapa' = 'depois' as eh_depois \gset
select id as esc_b from escritorios where not modelos_compartilhados \gset

\if :eh_antes
-- ================================================================ antes (0018/0019)
-- base oficial vinda do INCRA
select sigef_guardar(jsonb_build_array(
  jsonb_build_object('codigo', 'W1', 'nome', 'OFICIAL 1', 'uf', 'GO', 'fonte', 'wfs', 'geometria', pg_temp.quad(-49.0, -16.001, -48.998, -15.999)),
  jsonb_build_object('codigo', 'W2', 'nome', 'OFICIAL 2', 'uf', 'GO', 'fonte', 'wfs', 'geometria', pg_temp.quad(-49.001, -16.0015, -48.999, -16.0))));

-- a falha: B (usuário comum) grava pela RPC um "CSV" que vira certificado para todos —
-- uma parcela inventada (C1) e o contorno trocado de uma oficial (W2)
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok(sigef_guardar(jsonb_build_array(
  jsonb_build_object('codigo', 'C1', 'nome', 'FALSA', 'uf', 'GO', 'fonte', 'csv', 'geometria', pg_temp.quad(-49.002, -16.0005, -49.0005, -15.9995)),
  jsonb_build_object('codigo', 'W2', 'nome', 'TROCADA', 'uf', 'GO', 'registro', 'FALSO', 'fonte', 'csv', 'geometria', pg_temp.quad(-49.0005, -15.9995, -48.9995, -15.9985)))) = 2,
  'antes: usuário logado grava parcela na base que todas as empresas leem (a falha)');
reset role;

select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok(pg_temp.sobre(sigef_consultar(pg_temp.imovel())) = 'C1,W1,W2', 'antes: a outra empresa vê a parcela falsa como sobreposição');
reset role;
\echo 'etapa antes: ok'
\endif

\if :eh_depois
-- ================================================================ depois (0030)
-- ---------------------------------------------------------------- dados antigos
select pg_temp.ok((select count(*) from parcelas_sigef) = 3, 'nenhuma linha apagada pela migração');
select pg_temp.ok((select string_agg(codigo, ',' order by codigo) from parcelas_sigef where oculta) = 'C1,W2',
                  'CSV gravado antes (sem dono) vai para a quarentena');
select pg_temp.ok((select not oculta and escritorio_id is null from parcelas_sigef where codigo = 'W1'), 'parcela oficial continua global');

-- ---------------------------------------------------------------- quem grava
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok(pg_temp.erro($$select sigef_guardar('[]'::jsonb)$$) like '%permission denied%', 'usuário logado não grava parcela oficial');
select pg_temp.ok(pg_temp.erro($$select sigef_sincronizar('[]'::jsonb, 0, 0, 1, 1, true)$$) like '%permission denied%', 'usuário logado não sincroniza a base');
select pg_temp.ok(pg_temp.erro($$insert into parcelas_sigef (codigo, geom) values ('Z', extensions.ST_Multi(extensions.ST_MakeEnvelope(0, 0, 1, 1, 4674)))$$) is not null,
                  'usuário logado não insere direto na tabela');
select pg_temp.ok(pg_temp.erro($$update parcelas_sigef set nome = 'x'$$) is not null, 'usuário logado não altera direto na tabela');
select pg_temp.ok(pg_temp.erro($$delete from parcelas_sigef$$) is not null, 'usuário logado não apaga direto na tabela');

-- o CSV do vizinho fica com a empresa, mesmo que o corpo diga outra fonte
select pg_temp.ok(sigef_guardar_csv(jsonb_build_array(
  jsonb_build_object('codigo', 'X', 'nome', 'VIZINHO', 'uf', 'go', 'fonte', 'wfs', 'geometria', pg_temp.quad(-49.0008, -15.9995, -48.9992, -15.998)))) = 1,
  'CSV do vizinho é guardado');
select pg_temp.ok(sigef_guardar_csv(jsonb_build_array(
  jsonb_build_object('codigo', 'X', 'nome', 'VIZINHO', 'uf', 'GO', 'geometria', pg_temp.quad(-49.0008, -15.9995, -48.9992, -15.998)))) = 1,
  'mesmo CSV de novo atualiza, não duplica');
select pg_temp.ok(pg_temp.erro(format($$select sigef_guardar_csv(%L::jsonb)$$,
  (select jsonb_agg(jsonb_build_object('codigo', 'L' || i, 'geometria', pg_temp.quad(-49.0, -16.0, -48.999, -15.999))) from generate_series(1, 101) i)))
  like '%No máximo 100%', 'lote grande demais é recusado');
reset role;
select pg_temp.ok((select count(*) = 1 and bool_and(escritorio_id = :'esc_b' and fonte = 'csv' and uf = 'GO' and not oculta)
                     from parcelas_sigef where codigo = 'X'), 'CSV fica marcado com a empresa e com fonte csv');

select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-00000000000d', false);
set role authenticated;
select pg_temp.ok(pg_temp.erro($$select sigef_guardar_csv('[]'::jsonb)$$) like 'Sem empresa ativa%', 'quem não tem empresa ativa não guarda CSV');
reset role;

set role anon;
select pg_temp.ok(pg_temp.erro($$select sigef_guardar('[]'::jsonb)$$) like '%permission denied%', 'anon não grava parcela oficial');
select pg_temp.ok(pg_temp.erro($$select sigef_guardar_csv('[]'::jsonb)$$) like '%permission denied%', 'anon não grava CSV');
select pg_temp.ok(pg_temp.erro($$select sigef_consultar('{}'::jsonb)$$) like '%permission denied%', 'anon não consulta');
select pg_temp.ok(pg_temp.erro($$select sigef_cobertura()$$) like '%permission denied%', 'anon não vê a cobertura');
reset role;

-- ---------------------------------------------------------------- quem vê
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok(pg_temp.mapa(sigef_consultar(pg_temp.imovel())) = 'W1:wfs,X:csv', 'B vê a oficial e o próprio CSV no mapa (nada da quarentena)');
select pg_temp.ok(pg_temp.sobre(sigef_consultar(pg_temp.imovel())) = 'W1,X', 'B vê a sobreposição com o próprio CSV');
select pg_temp.ok(pg_temp.sobre(sigef_consultar(pg_temp.imovel(), 300, array['X'])) = 'W1', 'ignorar_codigos continua valendo');
select pg_temp.ok((select string_agg(codigo, ',' order by codigo) from parcelas_sigef) = 'W1,X', 'select direto: B vê a oficial e o próprio CSV');
reset role;

select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok(pg_temp.mapa(sigef_consultar(pg_temp.imovel())) = 'W1:wfs', 'A não vê o CSV de B no mapa');
select pg_temp.ok(pg_temp.sobre(sigef_consultar(pg_temp.imovel())) = 'W1', 'A não vê sobreposição com o CSV de B nem com a quarentena');
select pg_temp.ok((select string_agg(codigo, ',' order by codigo) from parcelas_sigef) = 'W1', 'select direto: A só vê a oficial');
reset role;

-- B manda um CSV com o código de uma oficial: só a visão de B muda
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select sigef_guardar_csv(jsonb_build_array(
  jsonb_build_object('codigo', 'W1', 'nome', 'MEU CSV', 'uf', 'GO', 'geometria', pg_temp.quad(-49.0, -15.998, -48.998, -15.997))));
select pg_temp.ok(pg_temp.mapa(sigef_consultar(pg_temp.imovel())) = 'W1:csv,X:csv', 'para B, o próprio CSV substitui a oficial de mesmo código');
select pg_temp.ok(pg_temp.sobre(sigef_consultar(pg_temp.imovel())) = 'X', 'para B, a sobreposição usa o contorno do próprio CSV');
reset role;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok(pg_temp.mapa(sigef_consultar(pg_temp.imovel())) = 'W1:wfs', 'para A, W1 continua a oficial');
select pg_temp.ok(pg_temp.sobre(sigef_consultar(pg_temp.imovel())) = 'W1', 'para A, a sobreposição com W1 continua');
select pg_temp.ok((sigef_cobertura() ->> 'GO')::int = 1, 'cobertura de A: só a oficial');
reset role;
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok((sigef_cobertura() ->> 'GO')::int = 3, 'cobertura de B: a oficial e os próprios CSVs');
reset role;
select pg_temp.ok((select nome = 'OFICIAL 1' and fonte = 'wfs' from parcelas_sigef where codigo = 'W1' and escritorio_id is null),
                  'a oficial W1 não foi tocada pelo CSV de B');

-- ---------------------------------------------------------------- servidor (INCRA)
set role service_role;
select pg_temp.ok(pg_temp.erro($$select sigef_guardar_csv('[]'::jsonb)$$) like '%permission denied%', 'service_role não grava CSV de empresa');
-- o INCRA devolve W2: a cópia da quarentena é trocada inteira pela oficial
select pg_temp.ok((sigef_sincronizar(jsonb_build_array(
  jsonb_build_object('codigo', 'W2', 'nome', 'OFICIAL 2', 'uf', 'GO', 'fonte', 'wfs', 'geometria', pg_temp.quad(-49.001, -16.0015, -48.999, -16.0))),
  -49.01, -16.01, -48.99, -15.99, false) ->> 'guardadas')::int = 1, 'sincronização grava a oficial');
-- importação sem fonte (ou com 'csv') vira 'oficial', nunca 'csv' sem dono
select sigef_guardar(jsonb_build_array(jsonb_build_object('codigo', 'S1', 'uf', 'GO', 'fonte', 'csv', 'geometria', pg_temp.quad(-50.0, -17.0, -49.999, -16.999))));
reset role;
select pg_temp.ok((select count(*) = 1 and bool_and(not oculta and fonte = 'wfs' and nome = 'OFICIAL 2' and registro is null and escritorio_id is null)
                     from parcelas_sigef where codigo = 'W2'), 'quarentena curada pelo INCRA: nada do CSV antigo sobrevive');
select pg_temp.ok((select fonte from parcelas_sigef where codigo = 'S1') = 'oficial', 'servidor nunca grava fonte csv sem empresa');

select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok(pg_temp.sobre(sigef_consultar(pg_temp.imovel())) = 'W1,W2', 'A volta a ver W2, agora com o contorno oficial');
reset role;

-- o INCRA não devolve mais nada na caixa: some a cópia oficial do WFS, o resto fica
set role service_role;
select sigef_sincronizar('[]'::jsonb, -49.01, -16.01, -48.99, -15.99, true);
reset role;
select pg_temp.ok((select string_agg(codigo || ':' || coalesce(escritorio_id::text, '-') || ':' || oculta, ',' order by codigo, escritorio_id)
                     from parcelas_sigef where codigo <> 'S1') = format('C1:-:true,W1:%s:false,X:%s:false', :'esc_b', :'esc_b'),
                  'limpeza do WFS não toca o CSV de empresa nem a quarentena');
\echo 'etapa depois: todos os testes passaram'
\endif

\if :eh_antes
\elif :eh_depois
\else
-- ================================================================ reaplicada (0030 de novo)
select pg_temp.ok((select string_agg(codigo || ':' || coalesce(escritorio_id::text, '-') || ':' || oculta || ':' || fonte, ',' order by codigo, escritorio_id)
                     from parcelas_sigef) = format('C1:-:true:csv,S1:-:false:oficial,W1:%s:false:csv,X:%s:false:csv', :'esc_b', :'esc_b'),
                  'migração reaplicada não muda nada');
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok(pg_temp.mapa(sigef_consultar(pg_temp.imovel())) = 'W1:csv,X:csv', 'depois de reaplicar, B continua vendo os próprios CSVs');
reset role;
\echo 'etapa reaplicada: ok'
\endif
