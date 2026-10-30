-- Parcelas do SIGEF por empresa: o CSV do vizinho deixa de ser "certificado"
-- para todo mundo.
--
-- A falha: `sigef_guardar` (0018/0019) podia ser chamada por qualquer usuário
-- logado — e, pelos privilégios padrão do Supabase em `public`, até pelo anon —
-- e gravava em `parcelas_sigef`, que todas as empresas leem (select `using (true)`).
-- A tela manda por ela o CSV do vizinho que a pessoa envia, e o CSV é o que a
-- pessoa quiser. Resultado: uma empresa punha uma parcela "certificada" falsa
-- (ou trocava o contorno de uma verdadeira, usando o mesmo código) no mapa e na
-- verificação de sobreposição de TODAS as outras.
--
-- Modelo a partir daqui:
--   - parcela OFICIAL (escritorio_id nulo): só o servidor grava, com service_role
--     — a edge function consultar-sigef (Geoportal do INCRA, via
--     `sigef_sincronizar`) e o scripts/importar-sigef.mjs (shapefile da UF).
--     Todas as empresas veem.
--   - parcela de CSV (escritorio_id = a empresa): o CSV do vizinho enviado na
--     etapa "área certificada", por `sigef_guardar_csv`. Só a própria empresa vê
--     e usa; para ela, substitui a oficial de mesmo código (o CSV, com 8 casas, é
--     o que virou vértice no serviço).
--   - em QUARENTENA (oculta): o CSV gravado antes desta migração. Não dá para
--     saber de qual empresa ele veio (o código da parcela só fica no arquivo, no
--     storage), então não aparece para ninguém — nem é apagado. A primeira
--     sincronização com o INCRA que trouxer o mesmo código troca a linha inteira
--     pela cópia oficial; o que o INCRA não conhece fica oculto. A empresa que
--     precisar do CSV no mapa só tem de enviá-lo de novo.
--
-- Idempotente: pode rodar de novo sem mudar nada. Depois de aplicar, reinicie o
-- REST (função nova). As edge functions não mudam.

-- ------------------------------------------------------------------ colunas
alter table public.parcelas_sigef
  add column if not exists escritorio_id uuid references public.escritorios(id) on delete cascade;
alter table public.parcelas_sigef
  add column if not exists oculta boolean not null default false;

-- O CSV antigo vai para a quarentena. Depois desta migração o servidor nunca grava
-- 'csv' sem empresa (ver sigef_guardar), então rodar de novo só pega o legado.
update public.parcelas_sigef set oculta = true
 where escritorio_id is null and fonte = 'csv' and not oculta;

-- ------------------------------------------------------------------ unicidade
-- Antes: um código, uma linha. Agora: uma oficial por código e, por empresa, um
-- CSV por código (a mesma parcela vizinha pode ter vindo de várias empresas).
create unique index if not exists parcelas_sigef_codigo_oficial
  on public.parcelas_sigef (codigo) where escritorio_id is null;
create unique index if not exists parcelas_sigef_codigo_escritorio
  on public.parcelas_sigef (escritorio_id, codigo) where escritorio_id is not null;
alter table public.parcelas_sigef drop constraint if exists parcelas_sigef_codigo_key;

-- ------------------------------------------------------------------ leitura
-- O select direto segue a mesma regra das funções: oficial + o CSV da empresa.
-- (select escritorio_atual()): uma chamada por consulta, não uma por linha.
drop policy if exists parcelas_sigef_select on public.parcelas_sigef;
create policy parcelas_sigef_select on public.parcelas_sigef for select to authenticated
  using (not oculta and (escritorio_id is null or escritorio_id = (select public.escritorio_atual())));

-- Ninguém escreve direto na tabela: só pelas funções abaixo. (Sem policy de
-- escrita a RLS já recusa; o revoke cobre o truncate, que a RLS não filtra.)
revoke insert, update, delete, truncate on public.parcelas_sigef from anon, authenticated;

-- ------------------------------------------------------------------ gravar (servidor)
-- Parcela oficial, upsert por código. Só service_role. O 'csv' é rótulo de
-- empresa: o que o servidor grava sem fonte (ou com 'csv') vira 'oficial'.
-- A linha em quarentena com o mesmo código é trocada inteira (nada do CSV antigo
-- — nome, registro… — sobrevive na cópia oficial).
create or replace function public.sigef_guardar(parcelas jsonb)
returns integer
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  n integer := 0;
  p jsonb;
  g extensions.geometry;
  f text;
begin
  if parcelas is null or jsonb_typeof(parcelas) <> 'array' then return 0; end if;
  for p in select * from jsonb_array_elements(parcelas) loop
    if coalesce(p->>'codigo', '') = '' or p->'geometria' is null then continue; end if;
    begin
      g := public.sigef_multipoligono(p->'geometria');
    exception when others then
      continue;
    end;
    if g is null or extensions.ST_IsEmpty(g) then continue; end if;
    f := coalesce(nullif(p->>'fonte', ''), 'oficial');
    if f = 'csv' then f := 'oficial'; end if;
    delete from public.parcelas_sigef q
     where q.codigo = p->>'codigo' and q.escritorio_id is null and q.oculta;
    insert into public.parcelas_sigef (codigo, nome, uf, municipio, codigo_imovel, registro, situacao, area_ha, fonte, geom, atualizado_em, escritorio_id, oculta)
    values (
      p->>'codigo', nullif(p->>'nome', ''), nullif(upper(p->>'uf'), ''), nullif(p->>'municipio', ''),
      nullif(p->>'codigo_imovel', ''), nullif(p->>'registro', ''), nullif(p->>'situacao', ''),
      round((extensions.ST_Area(g::extensions.geography) / 10000)::numeric, 4),
      f, g, now(), null, false)
    on conflict (codigo) where escritorio_id is null do update set
      nome = coalesce(excluded.nome, parcelas_sigef.nome),
      uf = coalesce(excluded.uf, parcelas_sigef.uf),
      municipio = coalesce(excluded.municipio, parcelas_sigef.municipio),
      codigo_imovel = coalesce(excluded.codigo_imovel, parcelas_sigef.codigo_imovel),
      registro = coalesce(excluded.registro, parcelas_sigef.registro),
      situacao = coalesce(excluded.situacao, parcelas_sigef.situacao),
      area_ha = excluded.area_ha,
      fonte = excluded.fonte,
      geom = excluded.geom,
      oculta = false,
      atualizado_em = now();
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ------------------------------------------------------------------ gravar (CSV da empresa)
-- O CSV do vizinho que a tela envia: fica com a empresa de quem chama e só ela
-- o vê. Fonte sempre 'csv', seja o que for que venha no corpo.
create or replace function public.sigef_guardar_csv(parcelas jsonb)
returns integer
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  esc uuid := public.escritorio_atual();
  n integer := 0;
  p jsonb;
  g extensions.geometry;
begin
  if esc is null then
    raise exception 'Sem empresa ativa: a parcela do CSV não foi guardada' using errcode = '42501';
  end if;
  if parcelas is null or jsonb_typeof(parcelas) <> 'array' then return 0; end if;
  if jsonb_array_length(parcelas) > 100 then
    raise exception 'No máximo 100 parcelas por envio' using errcode = '22023';
  end if;
  for p in select * from jsonb_array_elements(parcelas) loop
    if coalesce(p->>'codigo', '') = '' or length(p->>'codigo') > 200 or p->'geometria' is null then continue; end if;
    begin
      g := public.sigef_multipoligono(p->'geometria');
    exception when others then
      continue;
    end;
    if g is null or extensions.ST_IsEmpty(g) then continue; end if;
    insert into public.parcelas_sigef (codigo, nome, uf, municipio, area_ha, fonte, geom, atualizado_em, escritorio_id, oculta)
    values (
      p->>'codigo', nullif(p->>'nome', ''), nullif(upper(p->>'uf'), ''), nullif(p->>'municipio', ''),
      round((extensions.ST_Area(g::extensions.geography) / 10000)::numeric, 4),
      'csv', g, now(), esc, false)
    on conflict (escritorio_id, codigo) where escritorio_id is not null do update set
      nome = coalesce(excluded.nome, parcelas_sigef.nome),
      uf = coalesce(excluded.uf, parcelas_sigef.uf),
      municipio = coalesce(excluded.municipio, parcelas_sigef.municipio),
      area_ha = excluded.area_ha,
      geom = excluded.geom,
      oculta = false,
      atualizado_em = now();
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ------------------------------------------------------------------ sincronizar (servidor)
-- Igual à 0019, mas a limpeza só toca a cópia oficial do WFS: o CSV de empresa
-- e a quarentena não são do INCRA para ele remover.
create or replace function public.sigef_sincronizar(parcelas jsonb, x0 double precision, y0 double precision,
  x1 double precision, y1 double precision, remover boolean default true)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  guardadas integer;
  removidas integer := 0;
  codigos text[];
begin
  guardadas := public.sigef_guardar(parcelas);
  if remover then
    select coalesce(array_agg(x->>'codigo'), '{}') into codigos from jsonb_array_elements(coalesce(parcelas, '[]'::jsonb)) x;
    delete from public.parcelas_sigef p
    where p.fonte = 'wfs'
      and p.escritorio_id is null
      and p.geom && extensions.ST_MakeEnvelope(x0, y0, x1, y1, 4674)
      and extensions.ST_Intersects(p.geom, extensions.ST_MakeEnvelope(x0, y0, x1, y1, 4674))
      and not (p.codigo = any(codigos));
    get diagnostics removidas = row_count;
  end if;
  return jsonb_build_object('guardadas', guardadas, 'removidas', removidas);
end;
$$;

-- ------------------------------------------------------------------ consultar
-- Igual à 0019, só que cada empresa enxerga as parcelas oficiais + o próprio
-- CSV (que esconde a oficial de mesmo código) e nada da quarentena. A junção
-- das partes com a parcela passa a ser pelo id: o código já não é único na tabela.
create or replace function public.sigef_consultar(imovel jsonb, raio_m double precision default 300,
  ignorar_codigos text[] default '{}', largura_min_m double precision default 0.5)
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  esc uuid := public.escritorio_atual();
  g extensions.geometry;
  area_imovel double precision;
  parcelas jsonb;
  sobre jsonb;
  encostos jsonb;
begin
  g := public.sigef_multipoligono(imovel);
  if g is null or extensions.ST_IsEmpty(g) then
    return jsonb_build_object('parcelas', jsonb_build_object('type', 'FeatureCollection', 'features', '[]'::jsonb),
      'sobreposicoes', '[]'::jsonb, 'encostos', '[]'::jsonb);
  end if;
  area_imovel := extensions.ST_Area(g::extensions.geography);

  select coalesce(jsonb_agg(jsonb_build_object(
      'type', 'Feature',
      'id', p.id,
      'properties', jsonb_build_object('codigo', p.codigo, 'nome', p.nome, 'uf', p.uf, 'municipio', p.municipio,
        'situacao', p.situacao, 'area_ha', p.area_ha, 'fonte', p.fonte,
        'centro', jsonb_build_array(extensions.ST_X(extensions.ST_PointOnSurface(p.geom)), extensions.ST_Y(extensions.ST_PointOnSurface(p.geom)))),
      'geometry', extensions.ST_AsGeoJSON(extensions.ST_SimplifyPreserveTopology(p.geom, 0.0000005), 7)::jsonb)), '[]'::jsonb)
    into parcelas
  from public.parcelas_sigef p
  where extensions.ST_DWithin(p.geom::extensions.geography, g::extensions.geography, greatest(raio_m, 0))
    and not (p.codigo = any(ignorar_codigos))
    and not p.oculta
    and (p.escritorio_id = esc
      or (p.escritorio_id is null and not exists (
        select 1 from public.parcelas_sigef q where q.escritorio_id = esc and q.codigo = p.codigo and not q.oculta)));

  -- cada parte da interseção, com a largura média; "real" = passa na tolerância
  with partes as (
    select p.id, p.codigo, d.geom, a.area_m2,
      case when a.perim_m > 0 then 2 * a.area_m2 / a.perim_m else 0 end as largura_m
    from public.parcelas_sigef p
    cross join lateral extensions.ST_Dump(extensions.ST_CollectionExtract(extensions.ST_Intersection(p.geom, g), 3)) d
    cross join lateral (select extensions.ST_Area(d.geom::extensions.geography) as area_m2,
                               extensions.ST_Perimeter(d.geom::extensions.geography) as perim_m) a
    where p.geom && g and extensions.ST_Intersects(p.geom, g)
      and not (p.codigo = any(ignorar_codigos))
      and not p.oculta
      and (p.escritorio_id = esc
        or (p.escritorio_id is null and not exists (
          select 1 from public.parcelas_sigef q where q.escritorio_id = esc and q.codigo = p.codigo and not q.oculta)))
      and a.area_m2 > 0.01
  ),
  marcadas as (
    select *, (largura_m >= largura_min_m and area_m2 >= 1) as eh_real from partes
  ),
  sob0 as (
    select p.codigo, p.nome, p.municipio, p.uf, p.situacao, p.area_ha, p.fonte, p.geom as geom_parcela,
      sum(t.area_m2) as area_m2,
      max(t.largura_m) as largura_media_m,
      case when area_imovel > 0 then 100 * sum(t.area_m2) / area_imovel else 0 end as percentual_imovel,
      extensions.ST_Multi(extensions.ST_Union(t.geom)) as geom_inter
    from marcadas t join public.parcelas_sigef p on p.id = t.id
    where t.eh_real
    group by p.id, p.codigo, p.nome, p.municipio, p.uf, p.situacao, p.area_ha, p.fonte, p.geom
  ),
  -- A MESMA parcela: o imóvel (ou uma gleba/parte dele) já está certificado.
  -- Interseção cobre >= 98% da parcela e >= 98% de alguma parte do imóvel.
  sob as (
    select s.codigo, s.nome, s.municipio, s.uf, s.situacao, s.area_ha, s.fonte, s.area_m2, s.largura_media_m, s.percentual_imovel,
      100 * s.area_m2 / nullif(extensions.ST_Area(s.geom_parcela::extensions.geography), 0) as percentual_parcela,
      pt.percentual_parte,
      (100 * s.area_m2 / nullif(extensions.ST_Area(s.geom_parcela::extensions.geography), 0) >= 98 and pt.percentual_parte >= 98) as mesma_parcela,
      extensions.ST_AsGeoJSON(s.geom_inter, 7)::jsonb as geometria
    from sob0 s
    cross join lateral (
      select max(100 * extensions.ST_Area(extensions.ST_Intersection(s.geom_inter, d.geom)::extensions.geography)
                 / nullif(extensions.ST_Area(d.geom::extensions.geography), 0)) as percentual_parte
      from extensions.ST_Dump(g) d
    ) pt
  ),
  -- confrontantes certificados que só encostam (faixa de divisa desprezada)
  enc as (
    select t.codigo, sum(t.area_m2) as area_m2, max(t.largura_m) as largura_max_m
    from marcadas t
    where not t.eh_real and not exists (select 1 from marcadas r where r.codigo = t.codigo and r.eh_real)
    group by t.codigo
  )
  select
    (select coalesce(jsonb_agg(to_jsonb(s) order by s.area_m2 desc), '[]'::jsonb) from sob s),
    (select coalesce(jsonb_agg(to_jsonb(e) order by e.area_m2 desc), '[]'::jsonb) from enc e)
  into sobre, encostos;

  return jsonb_build_object('parcelas', jsonb_build_object('type', 'FeatureCollection', 'features', parcelas),
    'sobreposicoes', sobre, 'encostos', encostos, 'area_imovel_m2', area_imovel, 'largura_min_m', largura_min_m);
end;
$$;

-- ------------------------------------------------------------------ cobertura
-- Quantas parcelas a empresa enxerga por UF (oficiais + o próprio CSV).
create or replace function public.sigef_cobertura()
returns jsonb
language sql stable security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_object_agg(coalesce(uf, '?'), n), '{}'::jsonb)
  from (select uf, count(*) as n from public.parcelas_sigef
         where not oculta and (escritorio_id is null or escritorio_id = (select public.escritorio_atual()))
         group by uf) t;
$$;

-- ------------------------------------------------------------------ quem chama o quê
-- O Supabase concede execute em `public` ao anon e ao authenticated por padrão:
-- o revoke tem de nomear os papéis, não só o public.
revoke execute on function public.sigef_guardar(jsonb) from public, anon, authenticated;
grant execute on function public.sigef_guardar(jsonb) to service_role;
revoke execute on function public.sigef_sincronizar(jsonb, double precision, double precision, double precision, double precision, boolean) from public, anon, authenticated;
grant execute on function public.sigef_sincronizar(jsonb, double precision, double precision, double precision, double precision, boolean) to service_role;
revoke execute on function public.sigef_guardar_csv(jsonb) from public, anon, service_role;
grant execute on function public.sigef_guardar_csv(jsonb) to authenticated;
revoke execute on function public.sigef_consultar(jsonb, double precision, text[], double precision) from public, anon;
grant execute on function public.sigef_consultar(jsonb, double precision, text[], double precision) to authenticated, service_role;
revoke execute on function public.sigef_cobertura() from public, anon;
grant execute on function public.sigef_cobertura() to authenticated, service_role;
