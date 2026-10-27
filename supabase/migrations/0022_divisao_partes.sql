-- Divisão em partes iguais (partilha / herança).
--
-- A divisão é um serviço de GLEBAS: o motor da tela corta o perímetro em partes
-- de mesma área, grava os pontos novos das divisas como vértices M e cada parte
-- vira uma linha em `glebas`. O que a partilha acrescenta é QUEM recebe cada
-- parte — o herdeiro vira o proprietário na identificação da parte, na divisa
-- interna da parte vizinha e no GEO individual criado para ela.

alter table servicos
  add column if not exists divisao jsonb;

comment on column servicos.divisao is
  'Divisão em partes iguais: parâmetros do motor (azimute das divisas, inverter, partes iguais). Nulo = não é divisão.';

alter table glebas
  add column if not exists denominacao text,
  add column if not exists detentor_nome text,
  add column if not exists detentor_cpf text,
  add column if not exists fracao numeric,
  add column if not exists servico_parte_id uuid references servicos(id) on delete set null;

comment on column glebas.denominacao is 'Denominação própria da parte; nulo = "<denominação do imóvel> - <nome da gleba>".';
comment on column glebas.detentor_nome is 'Herdeiro/adquirente da parte (partilha); nulo = o proprietário do imóvel.';
comment on column glebas.detentor_cpf is 'CPF do herdeiro da parte.';
comment on column glebas.fracao is 'Fração da área total que coube à parte (0–1).';
comment on column glebas.servico_parte_id is 'GEO individual (serviço completo) criado para esta parte.';
