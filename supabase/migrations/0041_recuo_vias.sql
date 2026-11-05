-- Recuo legal das rodovias (pedido do Wilker, 05/11/2026: "o sistema,
-- automaticamente nos serviços, fazer recuo com base na lei ou manual de BA e
-- BR"; pesquisa e fontes em docs/recuo-rodovias.md, regras em
-- supabase/functions/_shared/recuo.ts).
--
-- O serviço guarda o que o operador conferiu de cada estrada/rodovia que o
-- imóvel confronta, para a planta sair com a faixa não edificável certa:
--   {
--     "planta": true,                          -- a faixa sai na planta (padrão)
--     "vias": {
--       "BR-116": { "dominio": 40, "naoEdificavel": 15, "leiMunicipal": null, "confirmado": true },
--       "BA-120": { "naoEdificavel": 8, "leiMunicipal": "Lei 1.234/2020" }
--     }
--   }
-- Nulo = o padrão (faixa de 15 m nos trechos de BR/estadual/ferrovia). A
-- redução abaixo de 15 m só vale com a lei municipal e nunca abaixo de 5 m — o
-- servidor revalida (naoEdificavelDaPlanta), não confia no que veio da tela.
--
-- Só uma coluna: as policies de servicos (membro da empresa atualiza o serviço
-- dela) já cobrem, e o gatilho servicos_zz_proteger_cobranca não olha para ela.
alter table servicos add column if not exists recuo_vias jsonb;

comment on column servicos.recuo_vias is
  'Recuo legal das rodovias conferido pelo operador: { planta: bool, vias: { "<sigla ou tipo>": { dominio, naoEdificavel, leiMunicipal, confirmado } } }. Nulo = padrão (faixa não edificável de 15 m na planta). Ver supabase/functions/_shared/recuo.ts.';

-- a coluna precisa ser um objeto (ou nula): lixo na coluna quebraria a planta
alter table servicos drop constraint if exists servicos_recuo_vias_objeto;
alter table servicos add constraint servicos_recuo_vias_objeto
  check (recuo_vias is null or jsonb_typeof(recuo_vias) = 'object');
