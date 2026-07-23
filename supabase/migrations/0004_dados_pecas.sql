-- Dados do cliente (requerentes) e extras do RT p/ geração das peças técnicas
alter table servicos
  add column if not exists detentor_genero text default 'M' check (detentor_genero in ('M','F')),
  add column if not exists requerente2_nome text,
  add column if not exists requerente2_cpf text,
  add column if not exists requerente2_genero text default 'M' check (requerente2_genero in ('M','F')),
  add column if not exists endereco_detentor text,
  add column if not exists area_matricula_ha text,
  add column if not exists via_dominio text;

alter table responsaveis_tecnicos
  add column if not exists formacao text,
  add column if not exists conselho_sigla text,
  add column if not exists conselho_numero text,
  add column if not exists identidade text;
