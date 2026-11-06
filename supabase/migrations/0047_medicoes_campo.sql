-- 0047 — Medições de campo (#/campo, "Medir no campo").
--
-- O agrimensor mede o contorno com o GPS do celular (croqui, orçamento, CAR).
-- A medição é gravada primeiro no aparelho e sobe para cá sozinha quando há
-- internet, para aparecer no computador do escritório ("Medições salvas").
-- Plano: docs/plano-ferramentas-campo-consulta-terraplanagem.md, seção 2.
--
-- - O id é gerado no APARELHO (uuid): a mesma medição no celular e na conta;
--   a tela grava com upsert pelo id.
-- - escritorio_id é preenchido pelo banco (preencher_escritorio, da 0020) e a
--   RLS só deixa ver/gravar as da própria empresa (escritorio_atual(), 0025).
-- - Duas gravações fora de ordem (o celular reenviando uma versão velha depois
--   que o computador já renomeou): a versão mais VELHA não sobrescreve a mais
--   nova (gatilho medicoes_campo_mais_nova, pela coluna atualizado_em).
-- - vertices: [{lon, lat, precisao, t, modo: caminhar|ponto|mao, leituras?, alt?}]
--   em lon/lat SIRGAS 2000. area_m2/perimetro_m/fuso saem do motor único da
--   tela (UTM no fuso do lugar, Gauss) e servem à lista; a geometria manda.
--
-- Idempotente: pode ser reaplicada.

create table if not exists medicoes_campo (
  id uuid primary key,
  escritorio_id uuid not null references escritorios(id) on delete cascade,
  criado_por uuid default auth.uid() references auth.users(id) on delete set null,
  nome text not null check (char_length(btrim(nome)) between 1 and 200),
  vertices jsonb not null default '[]'::jsonb
    check (jsonb_typeof(vertices) = 'array' and pg_column_size(vertices) <= 4000000),
  fechada boolean not null default false,
  n_vertices integer not null default 0 check (n_vertices >= 0),
  area_m2 numeric check (area_m2 is null or area_m2 >= 0),
  perimetro_m numeric check (perimetro_m is null or perimetro_m >= 0),
  fuso smallint check (fuso is null or fuso between 1 and 60),
  precisao_media_m numeric check (precisao_media_m is null or precisao_media_m >= 0),
  origem text not null default 'gps' check (origem in ('gps', 'mao', 'misto')),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table medicoes_campo is
  'Medições do "Medir no campo" (GPS do celular): contorno em lon/lat, gravado do aparelho por upsert do id. Ver 0047.';

create index if not exists medicoes_campo_escritorio_recentes on medicoes_campo (escritorio_id, atualizado_em desc);

-- escritório preenchido no INSERT (o informado > o de quem insere)
drop trigger if exists medicoes_campo_preencher_escritorio on medicoes_campo;
create trigger medicoes_campo_preencher_escritorio before insert on medicoes_campo
  for each row execute function preencher_escritorio();

-- o autor é quem grava: o cliente não escolhe o criado_por (como a 0045 faz com o user_id)
create or replace function medicoes_campo_autor()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null then
    new.criado_por := auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists medicoes_campo_autor on medicoes_campo;
create trigger medicoes_campo_autor before insert on medicoes_campo
  for each row execute function medicoes_campo_autor();

-- quem criou não muda; o escritório não muda; versão velha não sobrescreve a nova
create or replace function medicoes_campo_mais_nova()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.escritorio_id := old.escritorio_id;
  new.criado_por := old.criado_por;
  new.criado_em := old.criado_em;
  if new.atualizado_em < old.atualizado_em then
    return null; -- fica a mais nova; o upsert não dá erro
  end if;
  return new;
end $$;

drop trigger if exists medicoes_campo_mais_nova on medicoes_campo;
create trigger medicoes_campo_mais_nova before update on medicoes_campo
  for each row execute function medicoes_campo_mais_nova();

alter table medicoes_campo enable row level security;

drop policy if exists medicoes_campo_do_escritorio on medicoes_campo;
create policy medicoes_campo_do_escritorio on medicoes_campo for all to authenticated
  using (escritorio_id = escritorio_atual())
  with check (escritorio_id = escritorio_atual());

revoke all on medicoes_campo from public, anon;
grant select, insert, update, delete on medicoes_campo to authenticated;
grant all on medicoes_campo to service_role;
