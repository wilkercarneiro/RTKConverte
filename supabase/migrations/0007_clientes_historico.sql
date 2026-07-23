-- Arquitetura de trabalho: clientes como entidade + histórico de documentos.

create table clientes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nome text not null,
  cpf_cnpj text,
  genero text not null default 'M' check (genero in ('M','F')),
  endereco text,
  telefone text,
  email text,
  observacoes text
);
alter table clientes enable row level security;
create policy autenticado_clientes on clientes for all to authenticated using (true) with check (true);

alter table servicos add column if not exists cliente_id uuid references clientes(id) on delete set null;

-- Histórico: cada geração é uma VERSÃO preservada no Storage
create table documentos_gerados (
  id uuid primary key default gen_random_uuid(),
  servico_id uuid not null references servicos(id) on delete cascade,
  versao int not null,
  tipo text not null,      -- memorial_docx | planilha_ods | peca_1..peca_7 | planta_pdf
  titulo text not null,
  path text not null,      -- caminho no bucket gerados
  created_at timestamptz not null default now()
);
create index documentos_gerados_servico on documentos_gerados (servico_id, versao desc);
alter table documentos_gerados enable row level security;
create policy autenticado_documentos on documentos_gerados for all to authenticated using (true) with check (true);

-- Downloads do histórico a qualquer momento: leitura do bucket gerados
create policy gerados_select on storage.objects for select to authenticated
  using (bucket_id = 'gerados');

-- Backfill: cria clientes a partir dos detentores já cadastrados e vincula
insert into clientes (nome, cpf_cnpj, genero, endereco)
select distinct on (detentor_nome) detentor_nome, detentor_cpf, coalesce(detentor_genero, 'M'), endereco_detentor
from servicos
where detentor_nome is not null and detentor_nome <> ''
order by detentor_nome, created_at desc;

update servicos s set cliente_id = c.id
from clientes c
where s.cliente_id is null and s.detentor_nome = c.nome;
