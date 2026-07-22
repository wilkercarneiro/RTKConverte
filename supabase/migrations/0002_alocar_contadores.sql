-- Alocação atômica dos contadores do credenciado (incrementa ao GERAR).
-- Retorna os valores-base (antes do incremento) para numerar os vértices.
create or replace function alocar_contadores(p_credenciado uuid, dm int, dp int, dv int)
returns table (base_m int, base_p int, base_v int)
language sql
set search_path = public
as $$
  update credenciados
     set contador_m = contador_m + dm,
         contador_p = contador_p + dp,
         contador_v = contador_v + dv
   where id = p_credenciado
   returning contador_m - dm, contador_p - dp, contador_v - dv;
$$;
