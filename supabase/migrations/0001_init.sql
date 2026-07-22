-- Sistema GEO: gerador de Memorial INCRA + Planilha SIGEF
-- Modelo de dados (seção 4 da especificação). RLS: usuário autenticado.

create table credenciados (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  prefixo_vertice text not null,
  contador_m int not null default 0,
  contador_p int not null default 0,
  contador_v int not null default 0
);

create table responsaveis_tecnicos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  crea text,
  trt text,
  cpf text
);

create table servicos (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  status text not null default 'rascunho' check (status in ('rascunho', 'gerado')),
  nome_arquivo_txt text,
  fuso_utm int,
  credenciado_id uuid references credenciados(id),
  rt_id uuid references responsaveis_tecnicos(id),
  -- identificação SIGEF
  natureza_servico text,
  tipo_pessoa text,
  detentor_nome text,
  detentor_cpf text,
  denominacao text,
  situacao text,
  natureza_area text,
  codigo_sncr text,
  cns text,
  matricula text,
  municipio text,
  uf text,
  vertice_inicial int,
  parcela_numero text,
  lado text,
  denominacao_parcela text
);

create table vertices (
  id uuid primary key default gen_random_uuid(),
  servico_id uuid not null references servicos(id) on delete cascade,
  ordem int not null,
  num_txt int,
  rotulo_txt text,
  e numeric,
  n numeric,
  h numeric,
  sigma_pos numeric,
  sigma_h numeric,
  tipo char(1) not null default 'P' check (tipo in ('M', 'P', 'V')),
  codigo text,
  metodo text not null default 'PG6',
  inserido_manual boolean not null default false,
  lat_gms text,
  lon_gms text,
  unique (servico_id, ordem) deferrable initially immediate
);

create table trechos_confrontantes (
  id uuid primary key default gen_random_uuid(),
  servico_id uuid not null references servicos(id) on delete cascade,
  vertice_inicio_ordem int not null,
  apelido_txt text,
  descritivo text,
  tipo_limite text not null default 'LA1',
  cns text,
  matricula text
);

create index vertices_servico_ordem on vertices (servico_id, ordem);
create index trechos_servico on trechos_confrontantes (servico_id);

-- RLS: acesso total para usuários autenticados da organização
alter table credenciados enable row level security;
alter table responsaveis_tecnicos enable row level security;
alter table servicos enable row level security;
alter table vertices enable row level security;
alter table trechos_confrontantes enable row level security;

create policy autenticado_credenciados on credenciados for all to authenticated using (true) with check (true);
create policy autenticado_rts on responsaveis_tecnicos for all to authenticated using (true) with check (true);
create policy autenticado_servicos on servicos for all to authenticated using (true) with check (true);
create policy autenticado_vertices on vertices for all to authenticated using (true) with check (true);
create policy autenticado_trechos on trechos_confrontantes for all to authenticated using (true) with check (true);

-- Storage buckets (privados)
insert into storage.buckets (id, name, public)
values ('uploads-txt', 'uploads-txt', false),
       ('templates', 'templates', false),
       ('gerados', 'gerados', false)
on conflict (id) do nothing;
