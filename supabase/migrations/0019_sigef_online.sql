-- SIGEF em tempo real + tolerância de divisa.
--
-- 1) O WFS do INCRA voltou (https://acervofundiario.incra.gov.br/i3geo/ogc.php).
--    A edge function `consultar-sigef` baixa as parcelas certificadas ao redor do
--    imóvel e chama `sigef_sincronizar`, que guarda o que veio e remove da base
--    as parcelas "wfs" daquela caixa que o INCRA não devolve mais (canceladas).
--    A base local continua sendo a cópia usada quando o INCRA cai.
--
-- 2) O WFS só entrega 6 casas decimais (~10 cm) e o levantamento RTK nunca bate
--    exatamente com a divisa certificada do vizinho. Com o limite antigo
--    (interseção > 0,5 m²) todo confrontante que só ENCOSTA virava sobreposição:
--    uma faixa de 300 m × 5 cm já dá 15 m². Agora a interseção é quebrada em
--    partes e só conta a parte com largura média (2·área/perímetro) de pelo
--    menos `largura_min_m` — faixa de divisa é descartada, sobreposição real não.

-- Guardar: parcela vinda do CSV (8 casas, a própria exportação do SIGEF) não é
-- rebaixada pela cópia de 6 casas do WFS com o mesmo código.
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
      area_ha = case when parcelas_sigef.fonte = 'csv' and excluded.fonte = 'wfs' then parcelas_sigef.area_ha else excluded.area_ha end,
      fonte = case when parcelas_sigef.fonte = 'csv' and excluded.fonte = 'wfs' then parcelas_sigef.fonte else excluded.fonte end,
      geom = case when parcelas_sigef.fonte = 'csv' and excluded.fonte = 'wfs' then parcelas_sigef.geom else excluded.geom end,
      atualizado_em = now();
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Sincroniza uma caixa (lon/lat) com o que o WFS devolveu. `remover` = false
-- quando a resposta pode ter vindo truncada (maxfeatures atingido).
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
      and p.geom && extensions.ST_MakeEnvelope(x0, y0, x1, y1, 4674)
      and extensions.ST_Intersects(p.geom, extensions.ST_MakeEnvelope(x0, y0, x1, y1, 4674))
      and not (p.codigo = any(codigos));
    get diagnostics removidas = row_count;
  end if;
  return jsonb_build_object('guardadas', guardadas, 'removidas', removidas);
end;
$$;

drop function if exists public.sigef_consultar(jsonb, double precision, text[]);

create or replace function public.sigef_consultar(imovel jsonb, raio_m double precision default 300,
  ignorar_codigos text[] default '{}', largura_min_m double precision default 0.5)
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
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
    and not (p.codigo = any(ignorar_codigos));

  -- cada parte da interseção, com a largura média; "real" = passa na tolerância
  with partes as (
    select p.codigo, d.geom, a.area_m2,
      case when a.perim_m > 0 then 2 * a.area_m2 / a.perim_m else 0 end as largura_m
    from public.parcelas_sigef p
    cross join lateral extensions.ST_Dump(extensions.ST_CollectionExtract(extensions.ST_Intersection(p.geom, g), 3)) d
    cross join lateral (select extensions.ST_Area(d.geom::extensions.geography) as area_m2,
                               extensions.ST_Perimeter(d.geom::extensions.geography) as perim_m) a
    where p.geom && g and extensions.ST_Intersects(p.geom, g)
      and not (p.codigo = any(ignorar_codigos))
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
    from marcadas t join public.parcelas_sigef p on p.codigo = t.codigo
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

grant execute on function public.sigef_guardar(jsonb) to authenticated, service_role;
grant execute on function public.sigef_sincronizar(jsonb, double precision, double precision, double precision, double precision, boolean) to service_role;
revoke execute on function public.sigef_sincronizar(jsonb, double precision, double precision, double precision, double precision, boolean) from public, anon, authenticated;
grant execute on function public.sigef_consultar(jsonb, double precision, text[], double precision) to authenticated, service_role;
