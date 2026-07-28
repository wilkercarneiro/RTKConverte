-- Confrontação passa a viver no próprio vértice M (fluxo 'geo').
-- Invariante: um vértice M inicia uma confrontação, que vai até o próximo M.
-- Ver ARQUITETURA-TRECHOS.md.
--
-- O fluxo 'pecas' NÃO é migrado: seus trechos ancoram por codigo_inicio (código
-- do SIGEF, estável por construção) e não têm vínculo com a tabela vertices.

alter table vertices
  add column if not exists descritivo  text,
  add column if not exists tipo_limite text,
  add column if not exists eh_via      boolean not null default false,
  add column if not exists cns         text,
  add column if not exists matricula   text,
  add column if not exists apelido_txt text;

-- faixa de domínio pública explícita também no fluxo 'pecas'
alter table trechos_confrontantes
  add column if not exists eh_via boolean not null default false;

-- ---------------------------------------------------------------------------
-- Backfill 'geo': copia cada trecho para o vértice da sua âncora.
-- Preserva o comportamento atual, inclusive onde a âncora está errada — corrigir
-- automaticamente exigiria adivinhar a intenção do levantamento.
-- ---------------------------------------------------------------------------
update vertices v
   set descritivo  = t.descritivo,
       tipo_limite = t.tipo_limite,
       cns         = t.cns,
       matricula   = t.matricula,
       apelido_txt = t.apelido_txt,
       eh_via      = (t.tipo_limite ~ '^LA[34567]')
  from trechos_confrontantes t
  join servicos s on s.id = t.servico_id
 where v.servico_id = t.servico_id
   and v.ordem      = t.vertice_inicio_ordem
   and s.tipo       = 'geo';

-- todo vértice que recebeu confrontação é, por definição, um M
update vertices
   set tipo = 'M'
 where descritivo is not null and tipo <> 'M';

-- backfill do eh_via no fluxo 'pecas'
update trechos_confrontantes
   set eh_via = true
 where tipo_limite ~ '^LA[34567]';

create index if not exists vertices_confrontacao
  on vertices (servico_id) where descritivo is not null;
