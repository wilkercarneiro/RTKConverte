-- Três modalidades de serviço + glebas desenhadas dentro do perímetro.
--
-- MODALIDADE não é o mesmo eixo que `tipo`. `tipo` ('geo'|'pecas') diz DE ONDE
-- vêm os dados — TXT do levantamento ou PDF do SIGEF. `modalidade` diz O QUE o
-- cliente contratou. Sobrecarregar `tipo` obrigaria a revisar todo
-- `if (tipo === 'pecas')` do código, que é exatamente o tipo de mudança que
-- quebra o fluxo que hoje funciona.
--
-- GLEBA é eixo independente da modalidade: "serviço com gleba" é o serviço
-- completo com `tem_glebas`, não um quarto caminho. Os três cartões da tela são
-- combinações destas duas colunas:
--
--   Serviço completo     → ('completo',    false)
--   Conferência de área  → ('conferencia', false)
--   Serviço com gleba    → ('completo',    true)
--
-- Os defaults cobrem 100% das linhas existentes: nenhuma migração de dados.
alter table servicos
  add column if not exists modalidade text    not null default 'completo',
  add column if not exists tem_glebas boolean not null default false,
  -- Folha da planta da conferência (o operador escolhe A4 ou A3). Nulo = A4.
  -- Só vale na conferência: o serviço completo segue a regra histórica
  -- (posse → A3, matrícula → A1), que não é escolha de ninguém.
  add column if not exists folha_conferencia text;

do $$ begin
  alter table servicos add constraint servicos_modalidade_check
    check (modalidade in ('completo', 'conferencia'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table servicos add constraint servicos_folha_conferencia_check
    check (folha_conferencia is null or folha_conferencia in ('A1', 'A3', 'A4'));
exception when duplicate_object then null; end $$;

comment on column servicos.modalidade is
  'O que foi contratado: completo (memorial→SIGEF→peças) ou conferencia (prévia de área, sem SIGEF). Ortogonal a `tipo`, que é a origem do dado.';
comment on column servicos.tem_glebas is
  'Serviço com glebas: sub-polígonos desenhados dentro do perímetro na mesma planta.';

-- Anel de cada gleba em coordenadas UTM do fuso do serviço.
--
-- O anel vai em jsonb, e não numa tabela de pontos, porque a gleba é editada e
-- salva como uma unidade: o editor manipula o contorno inteiro e grava de uma
-- vez. Uma tabela filha custaria uma transação de N linhas a cada arrastar de
-- ponto, sem nada em troca — não há consulta que pergunte por um ponto isolado.
create table if not exists glebas (
  id         uuid primary key default gen_random_uuid(),
  servico_id uuid not null references servicos(id) on delete cascade,
  ordem      int  not null default 0,
  nome       text not null default '',
  anel       jsonb not null default '[]'::jsonb,   -- [[e,n], [e,n], ...]
  created_at timestamptz not null default now()
);

create index if not exists glebas_servico_idx on glebas (servico_id, ordem);

alter table glebas enable row level security;

do $$ begin
  create policy glebas_autenticado on glebas
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
