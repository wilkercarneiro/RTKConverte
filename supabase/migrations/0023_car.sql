-- Serviço de CAR (Cadastro Ambiental Rural).
--
-- MODALIDADE nova, mesmo eixo de 'completo', 'conferencia' e 'loteamento'. A
-- entrada é o KML da área total do imóvel (não o TXT): o serviço é criado pela
-- própria tela, sem parse-txt e sem vértices. Tudo é calculado no navegador
-- (src/lib/car) e as saídas são os shapefiles que o SICAR recebe.
--
-- O PROJETO é uma linha por serviço, em jsonb, como no loteamento: perímetro do
-- KML, polígonos da reserva legal (com a porcentagem pedida) e rios com a faixa
-- de APP. Reserva, APP e área produtiva são recalculadas a cada abertura.

alter table servicos drop constraint if exists servicos_modalidade_check;
alter table servicos add constraint servicos_modalidade_check
  check (modalidade in ('completo', 'conferencia', 'loteamento', 'car'));

comment on column servicos.modalidade is
  'O que foi contratado: completo (memorial→SIGEF→peças), conferencia (prévia de área, sem SIGEF), loteamento (projeto de parcelamento da gleba + locação) ou car (reserva legal, APP e área produtiva em shapefile para o SICAR). Ortogonal a `tipo`, que é a origem do dado.';

create table if not exists car_projetos (
  servico_id uuid primary key references servicos(id) on delete cascade,
  projeto    jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table car_projetos is
  'Projeto de CAR de um serviço (modalidade car): perímetro do KML, reserva legal e rios com a faixa de APP. As camadas são recalculadas pela tela.';

alter table car_projetos enable row level security;

do $$ begin
  drop policy if exists car_projetos_autenticado on car_projetos;
  drop policy if exists car_projetos_do_escritorio on car_projetos;
  if to_regprocedure('servico_do_escritorio(uuid)') is not null then
    create policy car_projetos_do_escritorio on car_projetos for all to authenticated
      using (servico_do_escritorio(servico_id))
      with check (servico_do_escritorio(servico_id));
  else
    create policy car_projetos_autenticado on car_projetos for all to authenticated
      using (true) with check (true);
  end if;
end $$;
