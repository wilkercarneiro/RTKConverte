-- Base local de parcelas certificadas (SIGEF) para o mapa interativo e a
-- verificação automática de sobreposição.
--
-- Por que uma base própria: o WFS do acervo fundiário do INCRA cai com
-- frequência (504 no GetCapabilities, corpo vazio no GetFeature) e a
-- exportação de shapefile passou a exigir login gov.br. A tabela recebe as
-- parcelas de três origens, todas pelo mesmo `sigef_guardar`:
--   - shapefile/GeoJSON da UF importado por scripts/importar-sigef.mjs;
--   - o CSV de exportação que o operador já envia na etapa "área certificada";
--   - futuras consultas ao WFS, quando ele responder.
--
-- Geometria em SIRGAS 2000 geográfico (EPSG:4674), o mesmo datum do SIGEF.
-- `sigef_consultar` recebe o imóvel como MultiPolygon GeoJSON (lon/lat), devolve
-- as parcelas até `raio_m` do imóvel e a interseção com cada uma que sobrepõe.
create extension if not exists postgis with schema extensions;

create table if not exists public.parcelas_sigef (
  id bigserial primary key,
  -- código da parcela no SIGEF (UUID do QRCODE / parcela_co do shapefile)
  codigo text not null unique,
  nome text,
  uf text,
  municipio text,
  codigo_imovel text,
  registro text,
  situacao text,
  area_ha numeric,
  fonte text not null default 'csv',
  geom extensions.geometry(MultiPolygon, 4674) not null,
  atualizado_em timestamptz not null default now()
);
create index if not exists parcelas_sigef_geom_idx on public.parcelas_sigef using gist (geom);
create index if not exists parcelas_sigef_uf_idx on public.parcelas_sigef (uf);

alter table public.parcelas_sigef enable row level security;
create policy parcelas_sigef_select on public.parcelas_sigef for select to authenticated using (true);

-- Normaliza qualquer geometria poligonal para MultiPolygon válido em 4674.
create or replace function public.sigef_multipoligono(geojson jsonb)
returns extensions.geometry
language sql immutable
set search_path = public, extensions
as $$
  select extensions.ST_Multi(extensions.ST_CollectionExtract(
    extensions.ST_MakeValid(extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(geojson::text), 4674)), 3));
$$;

-- Guarda (upsert por código) um lote de parcelas. Cada item:
-- { codigo, nome?, uf?, municipio?, codigo_imovel?, registro?, situacao?, fonte?, geometria: <GeoJSON Polygon|MultiPolygon> }
create or replace function public.sigef_guardar(parcelas jsonb)
returns integer
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  n integer := 0;
  p jsonb;
  g extensions.geometry;
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
    insert into public.parcelas_sigef (codigo, nome, uf, municipio, codigo_imovel, registro, situacao, area_ha, fonte, geom, atualizado_em)
    values (
      p->>'codigo', nullif(p->>'nome', ''), nullif(upper(p->>'uf'), ''), nullif(p->>'municipio', ''),
      nullif(p->>'codigo_imovel', ''), nullif(p->>'registro', ''), nullif(p->>'situacao', ''),
      round((extensions.ST_Area(g::extensions.geography) / 10000)::numeric, 4),
      coalesce(nullif(p->>'fonte', ''), 'csv'), g, now())
    on conflict (codigo) do update set
      nome = coalesce(excluded.nome, parcelas_sigef.nome),
      uf = coalesce(excluded.uf, parcelas_sigef.uf),
      municipio = coalesce(excluded.municipio, parcelas_sigef.municipio),
      codigo_imovel = coalesce(excluded.codigo_imovel, parcelas_sigef.codigo_imovel),
      registro = coalesce(excluded.registro, parcelas_sigef.registro),
      situacao = coalesce(excluded.situacao, parcelas_sigef.situacao),
      area_ha = excluded.area_ha,
      fonte = excluded.fonte,
      geom = excluded.geom,
      atualizado_em = now();
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Parcelas próximas do imóvel e sobreposições.
-- imovel: GeoJSON MultiPolygon (lon/lat, anéis fechados). raio_m: vizinhança devolvida.
-- Retorna { parcelas: FeatureCollection, sobreposicoes: [...], total_uf: n }
create or replace function public.sigef_consultar(imovel jsonb, raio_m double precision default 300, ignorar_codigos text[] default '{}')
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  g extensions.geometry;
  area_imovel double precision;
  parcelas jsonb;
  sobre jsonb;
begin
  g := public.sigef_multipoligono(imovel);
  if g is null or extensions.ST_IsEmpty(g) then
    return jsonb_build_object('parcelas', jsonb_build_object('type', 'FeatureCollection', 'features', '[]'::jsonb), 'sobreposicoes', '[]'::jsonb);
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
    and not (p.codigo = any(ignorar_codigos));

  select coalesce(jsonb_agg(x order by x.area_m2 desc), '[]'::jsonb) into sobre
  from (
    select p.codigo, p.nome, p.municipio, p.uf, p.situacao, p.area_ha,
      extensions.ST_Area(i.geom::extensions.geography) as area_m2,
      case when area_imovel > 0 then 100 * extensions.ST_Area(i.geom::extensions.geography) / area_imovel else 0 end as percentual_imovel,
      extensions.ST_AsGeoJSON(i.geom, 7)::jsonb as geometria
    from public.parcelas_sigef p
    cross join lateral (select extensions.ST_CollectionExtract(extensions.ST_Intersection(p.geom, g), 3) as geom) i
    where p.geom && g and extensions.ST_Intersects(p.geom, g)
      and not (p.codigo = any(ignorar_codigos))
      and not extensions.ST_IsEmpty(i.geom)
      and extensions.ST_Area(i.geom::extensions.geography) > 0.5
  ) x;

  return jsonb_build_object('parcelas', jsonb_build_object('type', 'FeatureCollection', 'features', parcelas),
    'sobreposicoes', sobre, 'area_imovel_m2', area_imovel);
end;
$$;

-- Quantas parcelas a base tem por UF (para a tela dizer se a região está coberta).
create or replace function public.sigef_cobertura()
returns jsonb
language sql stable security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_object_agg(coalesce(uf, '?'), n), '{}'::jsonb)
  from (select uf, count(*) as n from public.parcelas_sigef group by uf) t;
$$;

grant execute on function public.sigef_multipoligono(jsonb) to authenticated, service_role;
grant execute on function public.sigef_guardar(jsonb) to authenticated, service_role;
grant execute on function public.sigef_consultar(jsonb, double precision, text[]) to authenticated, service_role;
grant execute on function public.sigef_cobertura() to authenticated, service_role;
