-- Cenário posse × matrícula e RG opcional do detentor (peças técnicas)
alter table servicos
  add column if not exists tipo_imovel text not null default 'matricula'
    check (tipo_imovel in ('matricula', 'posse')),
  add column if not exists detentor_rg text;
