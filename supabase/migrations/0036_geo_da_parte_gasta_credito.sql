-- GEO de cada parte da divisão passa a gastar crédito (pedido de 03/11/2026).
--
-- Até aqui todo serviço com `origem_id` num serviço de glebas era "derivado" e
-- não gastava: a gleba separada em serviço próprio e o GEO de cada herdeiro da
-- partilha. Agora o GEO da parte é um serviço novo de verdade — no nome do
-- herdeiro, com SIGEF e peças próprios — e gasta 1 crédito por parte, como a
-- tela avisa antes de criar ("vai consumir N créditos", N = partes escolhidas).
--
-- Continua sem gastar só a gleba separada: o mesmo levantamento, repartido
-- (origem com tem_glebas e SEM divisao). A partilha é a origem com `divisao`.
--
-- Nada mais muda: consumir_credito() chama servico_derivado() e segue a
-- ordem de sempre (franquia do mês → extra), recusando com SEM_CREDITO.
create or replace function servico_derivado(s servicos)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select s.origem_id is not null and exists (
    select 1 from servicos o
     where o.id = s.origem_id and o.escritorio_id = s.escritorio_id and o.tem_glebas
       and o.divisao is null)
$$;

revoke execute on function servico_derivado(servicos) from public, anon, authenticated;
