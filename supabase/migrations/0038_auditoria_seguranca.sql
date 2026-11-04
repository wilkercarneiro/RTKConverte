-- Auditoria de segurança de 04/11/2026: travas de crédito, de equipe, de
-- vazamento e contra abuso. Cada bloco diz o que fechava antes.
--
-- Provado no banco real (begin … rollback) antes desta migração:
--   * empresa do plano Só CAR criou serviço com `origem_id = id` (derivado de
--     si mesmo) e NÃO gastou crédito;
--   * a partir dele, criou um GEO "completo" (fora do plano) também de graça.

-- ============================================================ 1. limites de uso
-- Contador por chave e janela, usado pelas edge functions (_shared/limite.ts)
-- para limitar a frequência de chamadas pesadas ou pagas.
create table if not exists limites_uso (
  chave text not null,
  janela timestamptz not null,
  n int not null default 0,
  primary key (chave, janela)
);
alter table limites_uso enable row level security;
revoke all on limites_uso from public, anon, authenticated;

create or replace function consumir_limite(p_chave text, p_max int, p_janela_s int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_janela timestamptz := to_timestamp(floor(extract(epoch from now()) / greatest(p_janela_s, 1)) * greatest(p_janela_s, 1));
  v_n int;
begin
  insert into limites_uso (chave, janela, n) values (left(p_chave, 200), v_janela, 1)
  on conflict (chave, janela) do update set n = limites_uso.n + 1
  returning n into v_n;
  -- faxina ocasional: janelas de mais de 2 dias não servem para nada
  if random() < 0.01 then
    delete from limites_uso where janela < now() - interval '2 days';
  end if;
  return v_n <= p_max;
end $$;
revoke execute on function consumir_limite(text, int, int) from public, anon, authenticated;
grant execute on function consumir_limite(text, int, int) to service_role;

-- ============================================================ 2. serviço derivado
-- Antes: qualquer serviço com origem_id num serviço "de glebas" da mesma
-- empresa era derivado (não gastava crédito e pulava a checagem do plano), sem
-- limite de quantidade, de tipo, e podendo apontar para si mesmo.
-- Agora derivado é SÓ a gleba separada de verdade:
--   * não aponta para si mesmo, não tem glebas nem divisão;
--   * mesma empresa, mesmo tipo e mesma modalidade da origem;
--   * a origem tem glebas, não é partilha, não é derivada e PAGOU o crédito
--     (ou é anterior aos créditos, 29/10/2026);
--   * no máximo uma por gleba gravada na origem.
alter table servicos drop constraint if exists servicos_origem_nao_propria;
alter table servicos add constraint servicos_origem_nao_propria check (origem_id is null or origem_id <> id);

create or replace function servico_derivado(s servicos)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select s.origem_id is not null and s.origem_id <> s.id
    and not coalesce(s.tem_glebas, false) and s.divisao is null
    and exists (
      select 1 from servicos o
       where o.id = s.origem_id and o.escritorio_id = s.escritorio_id
         and o.tem_glebas and o.divisao is null and o.origem_id is null
         and o.tipo is not distinct from s.tipo
         and coalesce(o.modalidade, 'completo') = coalesce(s.modalidade, 'completo')
         and (exists (select 1 from consumos_credito c where c.servico_id = o.id)
              or o.created_at < timestamptz '2026-10-29 00:00:00-03'))
    and (select count(*) from servicos d where d.origem_id = s.origem_id and d.id <> s.id)
        < greatest((select count(*) from glebas g where g.servico_id = s.origem_id), 1)
$$;
revoke execute on function servico_derivado(servicos) from public, anon, authenticated;

-- ============================================================ 3. tipo do serviço depois de cobrado
-- Antes: criar como CAR (crédito de CAR, mais barato) e depois trocar a
-- modalidade para completo/loteamento — o crédito não era cobrado de novo.
create or replace function proteger_cobranca_servico()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_velha text := chave_recurso_do_servico(old);
  v_nova text := chave_recurso_do_servico(new);
begin
  -- funções do servidor (service_role) e o superadmin não passam por aqui
  if auth.uid() is null or sou_superadmin() then return new; end if;
  if new.origem_id is distinct from old.origem_id then
    raise exception 'A origem do serviço não pode ser trocada.' using errcode = '42501';
  end if;
  if ((new.divisao is null) <> (old.divisao is null) or new.tem_glebas is distinct from old.tem_glebas)
     and exists (select 1 from servicos d where d.origem_id = new.id) then
    raise exception 'Este serviço já tem glebas ou partes separadas: o tipo dele não muda mais.' using errcode = '42501';
  end if;
  if v_nova = v_velha then return new; end if;
  if exists (select 1 from consumos_credito c where c.servico_id = new.id) then
    if not exists (select 1 from consumos_credito c join tipos_credito t on t.chave = c.tipo
                    where c.servico_id = new.id and (t.servicos is null or v_nova = any (t.servicos))) then
      raise exception 'O crédito gasto neste serviço não cobre a troca de tipo. Crie um serviço novo para isso.'
        using errcode = '42501';
    end if;
  elsif old.origem_id is not null then
    raise exception 'Gleba separada não muda de tipo.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function proteger_cobranca_servico() from public, anon, authenticated;
drop trigger if exists servicos_zz_proteger_cobranca on servicos;
create trigger servicos_zz_proteger_cobranca
  before update of tipo, modalidade, tem_glebas, divisao, origem_id on servicos
  for each row execute function proteger_cobranca_servico();

-- ============================================================ 4. criar serviço exige a permissão
-- Antes: membro sem `servicos.criar` criava serviço direto pela API (gastando
-- o crédito da empresa). As funções criam com a service_role e já conferem.
drop policy if exists servicos_criar_permissao on servicos;
create policy servicos_criar_permissao on servicos as restrictive for insert to authenticated
  with check (tem_permissao('servicos.criar'));

-- ============================================================ 5. documento só na pasta do serviço
-- Antes: o cliente gravava em documentos_gerados um `path` de OUTRO serviço e
-- o GPROL assinava esse caminho com a service_role (vazamento entre empresas).
alter table documentos_gerados drop constraint if exists documentos_path_do_servico;
alter table documentos_gerados add constraint documentos_path_do_servico
  check (servico_id is null or path is null
         or (path like servico_id::text || '/%' and position('..' in path) = 0));

-- ============================================================ 6. estorno e chargeback
-- Antes: estorno só era anotado; os créditos comprados continuavam valendo.
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'creditos_extras'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%pendente%aprovado%' loop
    execute format('alter table creditos_extras drop constraint %I', c.conname);
  end loop;
end $$;
alter table creditos_extras add constraint creditos_extras_status_check
  check (status in ('pendente', 'aprovado', 'recusado', 'cancelado', 'estornado'));

create or replace function estorno_tira_creditos()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.credito_id is not null then
    if new.status in ('REFUNDED', 'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL') then
      -- o saldo extra fica negativo se já foram usados: bloqueia até comprar de novo
      update creditos_extras set status = 'estornado', resolvido_em = now()
       where id = new.credito_id and status = 'aprovado';
    elsif new.status in ('RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH')
          and old.status in ('CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL') then
      -- disputa ganha: os créditos voltam
      update creditos_extras set status = 'aprovado', resolvido_em = now()
       where id = new.credito_id and status = 'estornado';
    end if;
  end if;
  -- mensalidade contestada no cartão: volta a aguardar pagamento (o estorno feito
  -- pelo próprio Vertces, REFUNDED, não suspende — é decisão de quem estornou)
  if new.finalidade = 'mensalidade' and new.status = 'CHARGEBACK_REQUESTED' then
    update escritorios set status = 'aguardando_pagamento', atualizado_em = now()
     where id = new.escritorio_id and status = 'ativo';
    update cobranca_empresas set situacao = 'atrasada', atualizado_em = now()
     where escritorio_id = new.escritorio_id;
  end if;
  return new;
end $$;
revoke execute on function estorno_tira_creditos() from public, anon, authenticated;
drop trigger if exists pagamentos_estorno on pagamentos;
create trigger pagamentos_estorno
  after update of status on pagamentos
  for each row when (old.status is distinct from new.status)
  execute function estorno_tira_creditos();

-- ============================================================ 7. empresa sem plano
-- Antes: franquia_credito devolvia null (= ilimitado) para empresa sem plano.
-- Ilimitado agora só por configuração explícita (escritorio_creditos/plano_creditos).
do $$
declare v_def text := pg_get_functiondef('franquia_credito(uuid, text)'::regprocedure);
begin
  if position('if v_plano is null then return null; end if;' in v_def) = 0 then
    raise exception 'franquia_credito mudou: revisar a migração 0038';
  end if;
  execute replace(v_def, 'if v_plano is null then return null; end if;', 'if v_plano is null then return 0; end if;');
end $$;

-- ============================================================ 8. gestor não mexe em outro gestor
-- Antes: quem tinha equipe.gerenciar (sem ser dono) desativava ou tirava as
-- permissões de outro gestor. A troca de senha tem a mesma trava na função equipe.
do $$
declare
  v_def text := pg_get_functiondef('definir_membro(uuid, text, text, text[], boolean, text, text)'::regprocedure);
  v_ancora text := '  if p_user = auth.uid() and coalesce(p_ativo, true) = false then';
begin
  if position(v_ancora in v_def) = 0 then
    raise exception 'definir_membro mudou: revisar a migração 0038';
  end if;
  execute replace(v_def, v_ancora,
    '  if not v_sou_dono and p_user <> auth.uid() and (''equipe.gerenciar'' = any (coalesce(v_alvo.permissoes, ''{}''))'
    || ' or exists (select 1 from super_admins s where s.user_id = p_user)) then' || chr(10)
    || '    raise exception ''Quem gerencia a equipe só o dono da empresa altera'' using errcode = ''42501'';' || chr(10)
    || '  end if;' || chr(10) || v_ancora);
end $$;

-- ============================================================ 9. consulta SIGEF com teto
-- Antes: raio sem limite e cast para geography sem filtro de índice — um raio
-- enorme varria a base inteira.
do $$
declare
  v_def text := pg_get_functiondef('sigef_consultar(jsonb, double precision, text[], double precision)'::regprocedure);
  v_a1 text := '  g := public.sigef_multipoligono(imovel);';
  v_a2 text := '  where extensions.ST_DWithin(p.geom::extensions.geography, g::extensions.geography, greatest(raio_m, 0))';
begin
  if position(v_a1 in v_def) = 0 or position(v_a2 in v_def) = 0 then
    raise exception 'sigef_consultar mudou: revisar a migração 0038';
  end if;
  v_def := replace(v_def, v_a1,
    '  raio_m := least(greatest(coalesce(raio_m, 0), 0), 5000);' || chr(10) || v_a1 || chr(10)
    || '  if g is not null and extensions.ST_NPoints(g) > 50000 then' || chr(10)
    || '    raise exception ''Polígono com vértices demais para consultar'' using errcode = ''22023'';' || chr(10)
    || '  end if;');
  -- pré-filtro pelo índice GiST: 1 grau ≥ 80 km em todo o Brasil
  v_def := replace(v_def, v_a2,
    '  where p.geom && extensions.ST_Expand(g, raio_m / 80000.0 + 0.0001)' || chr(10)
    || '    and extensions.ST_DWithin(p.geom::extensions.geography, g::extensions.geography, greatest(raio_m, 0))');
  execute v_def;
end $$;

-- ============================================================ 10. integração de outra empresa
-- Antes: qualquer logado perguntava se OUTRA empresa tinha o GPROL ativo.
-- Só os gatilhos (security definer) e a service_role usam esta função.
revoke execute on function integracao_ativa(uuid) from authenticated;

-- ============================================================ 11. tamanho dos arquivos no Storage
-- Antes: buckets sem teto — um usuário enchia o disco da VPS.
update storage.buckets set file_size_limit = 26214400 where id in ('uploads-txt', 'uploads-recusados'); -- 25 MB
update storage.buckets set file_size_limit = 20971520 where id in ('suporte', 'templates');           -- 20 MB
update storage.buckets set file_size_limit = 104857600 where id = 'gerados';                            -- 100 MB (A1 em PDF)
