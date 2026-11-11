-- 0051: o Só CAR e o Loteamento continuam à venda (correção da 0050).
--
-- A 0050 deixou no cadastro só o Profissional e o Empresarial e tirou todos os
-- outros planos (ativo = false, vende_no_site = false). O pedido do Wilker
-- (2026-11-11) era trocar os planos de "todos os serviços" — o Só CAR e o
-- Loteamento ficam. Aqui os dois voltam como estavam antes da 0050 (ativos e no
-- autocadastro), com tudo o que já tinham (créditos, preços, recursos), que a
-- 0050 não tocou. O Autônomo continua fora do cadastro.
update planos set ativo = true, vende_no_site = true
 where nome in ('Só CAR', 'Loteamento') or lower(nome) in ('só car', 'loteamento');
