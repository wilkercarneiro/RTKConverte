-- Dois tipos de serviço no dashboard:
--   'geo'   = TXT → Memorial DOCX + Planilha ODS (fluxo original)
--   'pecas' = PDF do SIGEF → 7 peças técnicas (fluxo direto, sem TXT)
alter table servicos
  add column if not exists tipo text not null default 'geo' check (tipo in ('geo', 'pecas'));

-- Em serviços 'pecas' não há tabela de vértices: o trecho referencia
-- diretamente o CÓDIGO do vértice inicial lido do PDF do SIGEF.
alter table trechos_confrontantes
  add column if not exists codigo_inicio text;
