-- Serviço de loteamento.
--
-- MODALIDADE nova, mesmo eixo de 'completo' e 'conferencia': o que foi
-- contratado. O dado de entrada continua sendo o TXT do levantamento (tipo
-- 'geo'): o perímetro da gleba entra pelo mesmo parse-txt, com fuso, UF e
-- vértices, e só a tela que abre é outra.
--
-- O PROJETO do loteamento é uma linha por serviço, em jsonb. Ele guarda só a
-- intenção do operador — parâmetros, ruas, áreas e ajustes feitos à mão.
-- Quadras e lotes NÃO são gravados: saem do cálculo toda vez que a tela abre
-- (src/lib/loteamento/calculo.ts). Uma tabela de lotes ficaria desatualizada
-- no primeiro arrastar de rua, que mexe em todos eles de uma vez.
--
-- Numerada 0021 porque a 0020 está reservada para docs/multiescritorio. As
-- duas funcionam em qualquer ordem: a policy daqui usa o escritório se a 0020
-- já estiver aplicada, e a 0020 inclui esta tabela se ela já existir.

alter table servicos drop constraint if exists servicos_modalidade_check;
alter table servicos add constraint servicos_modalidade_check
  check (modalidade in ('completo', 'conferencia', 'loteamento'));

comment on column servicos.modalidade is
  'O que foi contratado: completo (memorial→SIGEF→peças), conferencia (prévia de área, sem SIGEF) ou loteamento (projeto de parcelamento da gleba + locação). Ortogonal a `tipo`, que é a origem do dado.';

create table if not exists loteamentos (
  servico_id uuid primary key references servicos(id) on delete cascade,
  projeto    jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table loteamentos is
  'Projeto de loteamento de um serviço (modalidade loteamento): parâmetros, ruas, áreas e ajustes. Quadras e lotes são recalculados pela tela.';

alter table loteamentos enable row level security;

do $$ begin
  drop policy if exists loteamentos_autenticado on loteamentos;
  drop policy if exists loteamentos_do_escritorio on loteamentos;
  if to_regprocedure('servico_do_escritorio(uuid)') is not null then
    create policy loteamentos_do_escritorio on loteamentos for all to authenticated
      using (servico_do_escritorio(servico_id))
      with check (servico_do_escritorio(servico_id));
  else
    create policy loteamentos_autenticado on loteamentos for all to authenticated
      using (true) with check (true);
  end if;
end $$;
