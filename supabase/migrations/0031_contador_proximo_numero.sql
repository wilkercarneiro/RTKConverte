-- Contadores do credenciado: o número 0000 nunca sai.
--
-- Cada contador guarda o PRÓXIMO número a usar (alocar_contadores devolve o
-- valor de antes do incremento e o gerador numera a partir dele). Credenciado
-- novo nascia com 0, e o primeiro vértice saía M-0000 — número que não existe
-- na sequência do Anexo A. A tela passa a falar em "último número usado"
-- (= contador − 1) e grava último + 1; aqui o banco garante o resto:
--
--   * contador 0 vale como 1 na alocação (o primeiro vértice é o 0001);
--   * credenciado novo nasce com 1 (nenhum número usado ainda).
--
-- Quem já está em 1 ou mais não muda em nada: greatest(x, 1) = x. Nenhum
-- contador existente é reescrito por esta migration, e nenhum código já
-- emitido é tocado.
create or replace function alocar_contadores(p_credenciado uuid, dm int, dp int, dv int)
returns table (base_m int, base_p int, base_v int)
language sql
set search_path = public
as $$
  update credenciados
     set contador_m = case when dm > 0 then greatest(contador_m, 1) + dm else contador_m end,
         contador_p = case when dp > 0 then greatest(contador_p, 1) + dp else contador_p end,
         contador_v = case when dv > 0 then greatest(contador_v, 1) + dv else contador_v end
   where id = p_credenciado
   returning greatest(contador_m - dm, 1), greatest(contador_p - dp, 1), greatest(contador_v - dv, 1);
$$;

alter table credenciados alter column contador_m set default 1;
alter table credenciados alter column contador_p set default 1;
alter table credenciados alter column contador_v set default 1;
