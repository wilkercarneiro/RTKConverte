-- 0039 — Contorno assinado: 1 crédito = 1 imóvel (auditoria de 04/11/2026, item 4)
--
-- Antes: o crédito era gasto ao criar o serviço, mas nada amarrava o serviço ao
-- imóvel. Trocando os vértices (GEO/loteamento) ou o perímetro do KML (CAR),
-- o mesmo serviço gerava os documentos de outro imóvel sem gastar crédito.
--
-- Agora: a primeira geração oficial (memorial/planta/peças do GEO, arquivos do
-- CAR e do loteamento — todas no servidor) grava o contorno do imóvel. Toda
-- geração seguinte é comparada com ESSE contorno (nunca com o da geração
-- anterior, senão daria para "andar" o imóvel aos poucos):
--   a parte comum precisa cobrir pelo menos metade do contorno assinado E
--   pelo menos metade do contorno novo.
-- Corrigir um ponto, tirar um vértice errado, acrescentar uma ponta esquecida
-- passa; outro imóvel (longe, ou dentro/em volta deste) não passa.
-- Caso legítimo fora da regra (levantamento do mesmo imóvel refeito): o
-- superadmin libera com sa_liberar_contorno e a próxima geração assina de novo.
--
-- Tabela à parte (e não coluna em `servicos`): o `select *` das telas não
-- carrega o polígono, e a API não enxerga nem escreve — RLS ligada sem
-- política; só as funções security definer abaixo mexem.

create table if not exists servicos_contorno (
  servico_id uuid primary key references servicos(id) on delete cascade,
  contorno extensions.geometry(MultiPolygon, 4674) not null,
  area_m2 double precision not null,
  assinado_em timestamptz not null default now()
);
alter table servicos_contorno enable row level security;
revoke all on servicos_contorno from anon, authenticated;

-- GeoJSON (Polygon/MultiPolygon, lon/lat em grau) → MultiPolygon válido, ou null
create or replace function contorno_de_geojson(p jsonb)
returns extensions.geometry
language plpgsql immutable
set search_path = public, extensions
as $$
declare g geometry;
begin
  if p is null then return null; end if;
  g := ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(p::text), 4674)), 3);
  if g is null or ST_IsEmpty(g) then return null; end if;
  return ST_Multi(ST_UnaryUnion(g));
exception when others then
  return null;
end $$;
revoke execute on function contorno_de_geojson(jsonb) from public, anon, authenticated;

-- Confere (e na 1ª vez grava) o contorno do serviço. Só as funções do servidor
-- chamam (service_role). Devolve {ok, assinado, motivo?, comum?}.
create or replace function conferir_contorno(p_servico uuid, p_geojson jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_novo geometry := contorno_de_geojson(p_geojson);
  v_ass geometry;
  a_ass double precision;
  a_novo double precision;
  a_int double precision;
  v_comum numeric;
begin
  -- uma geração por vez neste serviço (duas abas não assinam dois imóveis)
  perform 1 from servicos where id = p_servico for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'Serviço não encontrado.');
  end if;
  -- contorno ilegível (dado legado torto): não trava a geração, mas também não assina
  if v_novo is null then
    return jsonb_build_object('ok', true, 'assinado', false);
  end if;
  a_novo := ST_Area(v_novo::geography);
  if a_novo < 1 then
    return jsonb_build_object('ok', true, 'assinado', false);
  end if;
  select contorno, area_m2 into v_ass, a_ass from servicos_contorno where servico_id = p_servico;
  if v_ass is null then
    insert into servicos_contorno (servico_id, contorno, area_m2) values (p_servico, v_novo, a_novo)
      on conflict (servico_id) do update set contorno = excluded.contorno, area_m2 = excluded.area_m2,
        assinado_em = now();
    return jsonb_build_object('ok', true, 'assinado', true);
  end if;
  begin
    a_int := coalesce(ST_Area(ST_Intersection(v_ass, v_novo)::geography), 0);
  exception when others then
    a_int := 0;
  end;
  v_comum := round((a_int / greatest(a_ass, a_novo))::numeric, 3);
  if a_int >= 0.5 * a_ass and a_int >= 0.5 * a_novo then
    return jsonb_build_object('ok', true, 'assinado', false, 'comum', v_comum);
  end if;
  return jsonb_build_object(
    'ok', false, 'comum', v_comum,
    'motivo', 'O desenho deste serviço não é mais o imóvel da primeira geração (só '
      || round(100 * v_comum, 0) || '% em comum). Cada crédito vale para um imóvel: '
      || 'para outro imóvel, crie um serviço novo. Se é o mesmo imóvel levantado de novo, '
      || 'peça ao suporte para liberar.'
  );
end $$;
revoke execute on function conferir_contorno(uuid, jsonb) from public, anon, authenticated;
grant execute on function conferir_contorno(uuid, jsonb) to service_role;

-- O superadmin libera um serviço (levantamento do mesmo imóvel refeito):
-- a próxima geração assina de novo.
create or replace function sa_liberar_contorno(p_servico uuid)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if not sou_superadmin() then
    raise exception 'Só o superadmin libera o contorno de um serviço.' using errcode = '42501';
  end if;
  delete from servicos_contorno where servico_id = p_servico;
end $$;
revoke execute on function sa_liberar_contorno(uuid) from public, anon;
grant execute on function sa_liberar_contorno(uuid) to authenticated;

-- Painel do superadmin (ficha da empresa): os serviços com imóvel assinado,
-- os mais recentes primeiro, para achar o que o cliente pediu para liberar.
create or replace function sa_contornos_da_empresa(p_escritorio uuid)
returns table (servico_id uuid, denominacao text, modalidade text, area_ha numeric, assinado_em timestamptz)
language plpgsql stable security definer
set search_path = public, extensions
as $$
begin
  if not sou_superadmin() then
    raise exception 'Só o superadmin vê os contornos.' using errcode = '42501';
  end if;
  return query
    select s.id, coalesce(s.denominacao, s.nome_arquivo_txt, '(sem nome)')::text, s.modalidade::text,
           round((c.area_m2 / 10000)::numeric, 4), c.assinado_em
      from servicos_contorno c join servicos s on s.id = c.servico_id
     where s.escritorio_id = p_escritorio
     order by c.assinado_em desc
     limit 200;
end $$;
revoke execute on function sa_contornos_da_empresa(uuid) from public, anon;
grant execute on function sa_contornos_da_empresa(uuid) to authenticated;
