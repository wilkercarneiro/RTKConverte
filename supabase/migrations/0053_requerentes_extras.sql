-- Requerentes a partir do 3º (pedido de cliente, 23/11/2026): o operador escolhe
-- quantos requerentes assinam ("Quantos assinam?" na etapa Dados) e TODOS saem
-- nas peças técnicas, no memorial e na planta — nome, CPF e assinatura.
--
-- O 1º continua em detentor_*, o 2º em requerente2_* (colunas de 0004, usadas em
-- todo o sistema); do 3º em diante, uma lista em ordem:
--   [{"nome": "...", "cpf": "...", "genero": "M" | "F"}, ...]
-- A lista é limpa pela tela (sem nome = não entra); o servidor ainda ignora item
-- sem nome. Limite de 10 itens (12 requerentes no total) contra abuso.
alter table public.servicos
  add column if not exists requerentes_extras jsonb not null default '[]'::jsonb;

alter table public.servicos drop constraint if exists servicos_requerentes_extras_lista;
alter table public.servicos add constraint servicos_requerentes_extras_lista
  check (jsonb_typeof(requerentes_extras) = 'array' and jsonb_array_length(requerentes_extras) <= 10);
