-- Monografia dos marcos: o que o sistema não sabe e o operador digita na tela
-- antes de gerar (data do levantamento, equipamento, tipo do marco e, por
-- marco, a descrição da localização e o itinerário de acesso).
--
-- Coluna jsonb no próprio serviço, e não tabela nova: os dados são do serviço,
-- são lidos e gravados junto com ele (autossalvamento da tela) e herdam as
-- políticas de RLS de `servicos` — quem não enxerga o serviço não enxerga nem
-- grava a monografia dele. A gerar-pecas lê com a service_role e normaliza
-- (supabase/functions/_shared/monografia.ts: normalizarCamposMonografia).
--
-- Forma: {"data_levantamento": "...", "equipamento": "...", "tipo_marco": "...",
--         "marcos": {"DSBN-M-3605": {"localizacao": "...", "acesso": "..."}}}
alter table servicos add column if not exists monografia jsonb;

comment on column servicos.monografia is
  'Campos digitados para a monografia dos marcos (ver _shared/monografia.ts). Objeto JSON; null = nada digitado.';

-- só objeto, e de tamanho razoável (texto livre de ~1000 marcos cabe com folga)
alter table servicos drop constraint if exists servicos_monografia_objeto;
alter table servicos add constraint servicos_monografia_objeto check (
  monografia is null
  or (jsonb_typeof(monografia) = 'object' and pg_column_size(monografia) <= 512000)
);
