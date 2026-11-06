-- 0045 — Consultar imóvel (#/consulta): histórico de consultas, laudo por IA
-- e o limite de laudos, por empresa.
--
-- 1. analises_imovel: uma linha por análise feita na ferramenta (sem serviço).
--    Guarda o que foi consultado (texto digitado, rótulo, área, geometria),
--    a frase do resultado e o resultado compacto (JSON, sem as geometrias
--    grandes das bases públicas). É dela que a função analise-imovel tira os
--    dados do laudo: a IA só vê o que está aqui.
--    RLS por escritório (escritorio_atual(), como servicos/clientes da 0020):
--    cada empresa só vê, grava e apaga as próprias. O escritório é preenchido
--    no INSERT (preencher_escritorio, 0020) e o autor é sempre quem insere.
--    As colunas do laudo (laudo, laudo_modelo, laudo_em, laudo_custo_usd) só a
--    service_role grava — a tela não escreve laudo nem "zera" o limite.
-- 2. Limite de laudos: a função conta laudo_em nas últimas 24 h da empresa
--    (índice parcial abaixo); padrão 20 por dia (LAUDOS_LIMITE_DIARIO).
-- 3. sigef_por_codigo(p_codigo): a parcela certificada pelo código (UUID do
--    SIGEF), com a mesma visibilidade da sigef_consultar (0030): a oficial e o
--    CSV da própria empresa; a oculta, nunca.
--
-- Idempotente: pode ser reaplicada.

-- ------------------------------------------------------------ 1. histórico
create table if not exists analises_imovel (
  id uuid primary key default gen_random_uuid(),
  escritorio_id uuid not null references escritorios(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null default auth.uid(),
  -- o que a pessoa digitou/enviou (código do CAR, coordenada, nome do arquivo)
  entrada text not null default '' check (char_length(entrada) <= 2000),
  tipo_entrada text not null check (tipo_entrada in ('car', 'sigef', 'coordenada', 'arquivo', 'desenho', 'campo')),
  rotulo text not null check (char_length(rotulo) between 1 and 300),
  codigo text check (codigo is null or char_length(codigo) <= 120),
  uf text check (uf is null or uf ~ '^[A-Z]{2}$'),
  municipio text check (municipio is null or char_length(municipio) <= 120),
  area_ha numeric check (area_ha is null or area_ha >= 0),
  -- a área analisada (MultiPolygon lon/lat), para reabrir no mapa
  geometria jsonb check (geometria is null or (jsonb_typeof(geometria) = 'object' and pg_column_size(geometria) <= 600000)),
  resumo text check (resumo is null or char_length(resumo) <= 600),
  tom text check (tom is null or tom in ('ok', 'aviso', 'alerta', 'perigo')),
  resultado jsonb not null default '{}'::jsonb check (jsonb_typeof(resultado) = 'object' and pg_column_size(resultado) <= 900000),
  laudo text check (laudo is null or char_length(laudo) <= 12000),
  laudo_modelo text,
  laudo_em timestamptz,
  laudo_custo_usd numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists analises_imovel_recentes on analises_imovel (escritorio_id, created_at desc);
create index if not exists analises_imovel_laudos on analises_imovel (escritorio_id, laudo_em) where laudo_em is not null;

comment on table analises_imovel is
  'Consultar imóvel (#/consulta): histórico das análises da empresa e os laudos por IA (limite diário contado em laudo_em). Ver 0045.';

drop trigger if exists analises_imovel_escritorio on analises_imovel;
create trigger analises_imovel_escritorio before insert on analises_imovel
  for each row execute function preencher_escritorio();

-- o autor é quem insere (não dá para gravar em nome de outro membro)
create or replace function analises_imovel_autor()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and auth.uid() is not null then
    new.user_id := auth.uid();
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists analises_imovel_autor on analises_imovel;
create trigger analises_imovel_autor before insert or update on analises_imovel
  for each row execute function analises_imovel_autor();

alter table analises_imovel enable row level security;
drop policy if exists analises_imovel_do_escritorio on analises_imovel;
create policy analises_imovel_do_escritorio on analises_imovel for all to authenticated
  using (escritorio_id = escritorio_atual())
  with check (escritorio_id = escritorio_atual());

revoke all on analises_imovel from public, anon, authenticated;
grant select, delete on analises_imovel to authenticated;
-- sem as colunas do laudo: só a função (service_role) grava o laudo
grant insert (entrada, tipo_entrada, rotulo, codigo, uf, municipio, area_ha, geometria, resumo, tom, resultado)
  on analises_imovel to authenticated;
grant update (rotulo, resumo, tom, resultado, area_ha, geometria, uf, municipio, updated_at)
  on analises_imovel to authenticated;
grant all on analises_imovel to service_role;

-- ------------------------------------------------------------ 3. SIGEF pelo código
create or replace function public.sigef_por_codigo(p_codigo text)
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  esc uuid := public.escritorio_atual();
  v_codigo text := lower(trim(coalesce(p_codigo, '')));
  r jsonb;
begin
  if v_codigo !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  select jsonb_build_object(
      'type', 'Feature',
      'id', p.id,
      'properties', jsonb_build_object('codigo', p.codigo, 'nome', p.nome, 'uf', p.uf, 'municipio', p.municipio,
        'situacao', p.situacao, 'area_ha', p.area_ha, 'fonte', p.fonte,
        'centro', jsonb_build_array(extensions.ST_X(extensions.ST_PointOnSurface(p.geom)), extensions.ST_Y(extensions.ST_PointOnSurface(p.geom)))),
      'geometry', extensions.ST_AsGeoJSON(p.geom, 8)::jsonb)
    into r
  from public.parcelas_sigef p
  where lower(p.codigo) = v_codigo
    and not p.oculta
    and (p.escritorio_id = esc or p.escritorio_id is null)
  order by (p.escritorio_id is not null) desc
  limit 1;
  return r;
end $$;
revoke execute on function public.sigef_por_codigo(text) from public, anon;
grant execute on function public.sigef_por_codigo(text) to authenticated, service_role;
