-- 0048 — Calibrações das medições de campo (Medir no campo → "Calibrar num marco").
--
-- O agrimensor para sobre um ponto conhecido (vértice certificado do SIGEF, marco
-- do IBGE, ponto já levantado de RTK) e o deslocamento medido sai de todos os
-- vértices da medição (src/lib/campo/calibracao.ts). Os vértices já sobem
-- corrigidos, cada um com o bruto e o deslocamento aplicado; esta coluna guarda a
-- LISTA de calibrações, para recalibrar (ou desfazer) em outro aparelho.
--
-- [{id, rotulo, conhecido:{lon,lat}, medido:{lon,lat,precisao,leituras}, dE, dN, t}]
-- O front funciona sem esta coluna (sobe sem ela) até a migração ser aplicada.
-- Idempotente: pode ser reaplicada.

alter table medicoes_campo add column if not exists calibracoes jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'medicoes_campo_calibracoes_lista') then
    alter table medicoes_campo add constraint medicoes_campo_calibracoes_lista
      check (jsonb_typeof(calibracoes) = 'array' and jsonb_array_length(calibracoes) <= 20 and pg_column_size(calibracoes) <= 100000);
  end if;
end $$;

comment on column medicoes_campo.calibracoes is
  'Calibrações em pontos conhecidos (Medir no campo). Os vértices já vêm corrigidos; a lista serve para recalibrar. Ver 0048.';

notify pgrst, 'reload schema';
