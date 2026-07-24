-- Adiciona campos de espólio e inventariante nas tabelas clientes e servicos
alter table clientes
  add column if not exists is_espolio boolean not null default false,
  add column if not exists inventariante_nome text,
  add column if not exists inventariante_cpf text,
  add column if not exists inventariante_rg text;

alter table servicos
  add column if not exists is_espolio boolean not null default false,
  add column if not exists inventariante_nome text,
  add column if not exists inventariante_cpf text,
  add column if not exists inventariante_rg text;
