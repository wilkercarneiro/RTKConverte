-- Trava contra apagar a cópia oficial do SIGEF em massa.
--
-- `sigef_sincronizar` (0030) apaga da caixa consultada as parcelas oficiais que
-- não vieram na resposta do INCRA. Se a resposta vier cortada sem avisar (limite
-- do GeoServer menor que o nosso, instabilidade), "não veio" vira "sumiu" e a
-- caixa inteira seria apagada. Parcela certificada raramente some do SIGEF:
-- agora a remoção só acontece quando é uma fração pequena do que existe na
-- caixa (até 10 parcelas, ou até 30%). Acima disso, nada é apagado e a resposta
-- diz quantas ficariam de fora (`remocao_suspensa`), para a próxima consulta.
--
-- Idempotente. Mesma assinatura e mesmos privilégios da 0030 (só service_role).

create or replace function public.sigef_sincronizar(parcelas jsonb, x0 double precision, y0 double precision,
  x1 double precision, y1 double precision, remover boolean default true)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  guardadas integer;
  removidas integer := 0;
  suspensas integer := 0;
  na_caixa integer;
  codigos text[];
  sumiram bigint[];
begin
  guardadas := public.sigef_guardar(parcelas);
  if remover then
    select coalesce(array_agg(x->>'codigo'), '{}') into codigos from jsonb_array_elements(coalesce(parcelas, '[]'::jsonb)) x;
    select coalesce(array_agg(p.id), '{}') into sumiram from public.parcelas_sigef p
    where p.fonte = 'wfs'
      and p.escritorio_id is null
      and p.geom && extensions.ST_MakeEnvelope(x0, y0, x1, y1, 4674)
      and extensions.ST_Intersects(p.geom, extensions.ST_MakeEnvelope(x0, y0, x1, y1, 4674))
      and not (p.codigo = any(codigos));
    suspensas := cardinality(sumiram);
    select count(*) into na_caixa from public.parcelas_sigef p
    where p.fonte = 'wfs' and p.escritorio_id is null
      and p.geom && extensions.ST_MakeEnvelope(x0, y0, x1, y1, 4674)
      and extensions.ST_Intersects(p.geom, extensions.ST_MakeEnvelope(x0, y0, x1, y1, 4674));
    if suspensas > 0 and (suspensas <= 10 or suspensas <= na_caixa * 0.3) then
      delete from public.parcelas_sigef p where p.id = any(sumiram);
      get diagnostics removidas = row_count;
      suspensas := 0;
    end if;
  end if;
  return jsonb_build_object('guardadas', guardadas, 'removidas', removidas, 'remocao_suspensa', suspensas);
end;
$$;

revoke execute on function public.sigef_sincronizar(jsonb, double precision, double precision, double precision, double precision, boolean) from public, anon, authenticated;
grant execute on function public.sigef_sincronizar(jsonb, double precision, double precision, double precision, double precision, boolean) to service_role;
