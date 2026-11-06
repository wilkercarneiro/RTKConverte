-- Terraplanagem (ferramenta, sem serviço): projetos de plataforma com volumes
-- de corte e aterro. Plano em docs/plano-ferramentas-campo-consulta-terraplanagem.md, seção 4.
--
-- Uma linha por projeto. `projeto` guarda a INTENÇÃO (pontos do levantamento,
-- plataforma, cota, taludes, fatores) — volumes, mapa e seções são
-- recalculados no navegador a cada abertura (src/lib/terraplanagem). `resumo`
-- é só para a lista "Projetos recentes" (corte, aterro, cota, nº de pontos).
--
-- RLS por escritório, como as tabelas-raiz da 0020: o escritório é preenchido
-- no INSERT pelo de quem grava (preencher_escritorio) e ninguém lê nem grava
-- projeto de outro escritório. A tela grava também uma cópia no aparelho:
-- antes desta migração no ar, o projeto fica só no navegador (sem erro).

create table if not exists terraplanagens (
  id            uuid primary key default gen_random_uuid(),
  escritorio_id uuid not null references escritorios(id) on delete cascade,
  criado_por    uuid default auth.uid() references auth.users(id) on delete set null,
  nome          text not null default 'Terraplanagem',
  projeto       jsonb not null default '{}'::jsonb,
  resumo        jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table terraplanagens is
  'Projetos de terraplanagem (ferramenta #/terraplanagem): pontos com cota, plataforma, cota (equilíbrio ou fixa), taludes e fatores. Volumes recalculados no navegador.';

-- lixo na coluna quebraria a tela; e um projeto não passa de ~5 MB (≈ 60 mil pontos)
alter table terraplanagens drop constraint if exists terraplanagens_projeto_objeto;
alter table terraplanagens add constraint terraplanagens_projeto_objeto
  check (jsonb_typeof(projeto) = 'object' and octet_length(projeto::text) <= 5000000);
alter table terraplanagens drop constraint if exists terraplanagens_nome_tamanho;
alter table terraplanagens add constraint terraplanagens_nome_tamanho check (char_length(nome) between 1 and 200);

create index if not exists terraplanagens_escritorio_recentes on terraplanagens (escritorio_id, updated_at desc);

drop trigger if exists terraplanagens_preencher_escritorio on terraplanagens;
create trigger terraplanagens_preencher_escritorio before insert on terraplanagens
  for each row execute function preencher_escritorio();

-- o escritório e o autor não mudam depois de criado
create or replace function terraplanagens_proteger()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.escritorio_id := old.escritorio_id;
  new.criado_por := old.criado_por;
  new.created_at := old.created_at;
  return new;
end $$;

drop trigger if exists terraplanagens_z_proteger on terraplanagens;
create trigger terraplanagens_z_proteger before update on terraplanagens
  for each row execute function terraplanagens_proteger();

alter table terraplanagens enable row level security;

drop policy if exists terraplanagens_do_escritorio on terraplanagens;
create policy terraplanagens_do_escritorio on terraplanagens for all to authenticated
  using (escritorio_id = escritorio_atual())
  with check (escritorio_id = escritorio_atual());

grant select, insert, update, delete on terraplanagens to authenticated;
