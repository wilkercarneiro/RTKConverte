-- Auditoria da empresa: quem criou, quem mexeu por último e o que cada pessoa
-- da equipe fez, para os administradores (permissão equipe.gerenciar).
-- Depende da 0025 (equipe + atividades).
--
--   servicos, clientes   + criado_por, atualizado_por, atualizado_em
--   documentos_gerados   + gerado_por (as edge functions gravam com a
--                          service_role; sem a coluna o documento sairia "sistema")
--   atividades           + servico_id, ref_id, vezes
--
-- O que passa a ser registrado (além do que a 0025 já registrava):
--   serviço alterado (quais campos), vértices / confrontantes / glebas,
--   loteamento e CAR, cliente alterado, RT e credenciado (incluir, alterar,
--   excluir) e os dados da empresa.
--
-- Edição em série (o autosave grava a cada poucos segundos) não vira uma linha
-- por gravação: a mesma pessoa mexendo no mesmo alvo dentro de 15 minutos
-- AGRUPA na linha anterior (vezes + 1, campos somados, hora atualizada).
--
-- Só o que a pessoa faz conta: escrita com a service_role (auth.uid() nulo,
-- edge functions) não gera "alterado" — a ação dela já é registrada por quem
-- tem o nome (documento gerado, serviço criado).
--
-- Teste local: `npm run test:rls` (tests/rls/auditoria.sql).

-- ------------------------------------------------------------------ colunas
alter table servicos add column if not exists criado_por uuid references auth.users(id) on delete set null;
alter table servicos add column if not exists atualizado_por uuid references auth.users(id) on delete set null;
alter table servicos add column if not exists atualizado_em timestamptz;
alter table clientes add column if not exists criado_por uuid references auth.users(id) on delete set null;
alter table clientes add column if not exists atualizado_por uuid references auth.users(id) on delete set null;
alter table clientes add column if not exists atualizado_em timestamptz;
alter table documentos_gerados add column if not exists gerado_por uuid references auth.users(id) on delete set null;

alter table atividades add column if not exists servico_id uuid;
alter table atividades add column if not exists ref_id uuid;
alter table atividades add column if not exists vezes int not null default 1;
create index if not exists atividades_servico on atividades (servico_id, created_at desc) where servico_id is not null;
create index if not exists atividades_agrupar on atividades (escritorio_id, user_id, acao, ref_id, created_at desc);

-- o que já existia: serviço criado pela tela tem o autor no histórico da 0025
update atividades set servico_id = (detalhe->>'servico_id')::uuid
 where servico_id is null and detalhe ? 'servico_id';
update servicos s set criado_por = a.user_id
  from atividades a
 where s.criado_por is null and a.acao = 'servico.criado' and a.servico_id = s.id and a.user_id is not null;
update servicos set atualizado_em = coalesce(atualizado_em, created_at), atualizado_por = coalesce(atualizado_por, criado_por);
update clientes set atualizado_em = coalesce(atualizado_em, created_at);

-- ------------------------------------------------------------------ registro
-- p_janela não nulo: agrupa na linha da mesma pessoa, ação e alvo dentro da janela.
create or replace function registrar_auditoria(
  p_escritorio uuid, p_user uuid, p_acao text, p_alvo text,
  p_servico uuid default null, p_ref uuid default null,
  p_campos text[] default null, p_detalhe jsonb default null, p_janela interval default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_id bigint;
begin
  if p_escritorio is null then return; end if;
  if p_janela is not null then
    select a.id into v_id from atividades a
     where a.escritorio_id = p_escritorio and a.user_id is not distinct from p_user
       and a.acao = p_acao and a.ref_id is not distinct from p_ref
       and a.created_at > now() - p_janela
     order by a.created_at desc limit 1;
    if v_id is not null then
      update atividades a set
        created_at = now(), vezes = a.vezes + 1,
        alvo = coalesce(left(p_alvo, 200), a.alvo),
        detalhe = coalesce(a.detalhe, '{}'::jsonb) || coalesce(p_detalhe, '{}'::jsonb)
          || case when p_campos is null then '{}'::jsonb else jsonb_build_object('campos', (
               select coalesce(jsonb_agg(distinct c order by c), '[]'::jsonb) from (
                 select jsonb_array_elements_text(coalesce(a.detalhe->'campos', '[]'::jsonb)) c
                 union select unnest(p_campos)) s)) end
       where a.id = v_id;
      return;
    end if;
  end if;
  insert into atividades (escritorio_id, user_id, acao, alvo, servico_id, ref_id, detalhe)
  values (p_escritorio, p_user, p_acao, left(p_alvo, 200), p_servico, p_ref,
          coalesce(p_detalhe, '{}'::jsonb)
            || case when p_campos is null then '{}'::jsonb else jsonb_build_object('campos', to_jsonb(p_campos)) end);
end $$;

-- colunas que mudaram entre old e new, tirando as de controle
create or replace function campos_alterados(p_old jsonb, p_new jsonb, p_ignorar text[])
returns text[]
language sql immutable
as $$
  select coalesce(array_agg(n.key order by n.key), '{}')
    from jsonb_each(p_new) n
   where n.value is distinct from (p_old -> n.key) and not (n.key = any (p_ignorar))
$$;

-- ------------------------------------------------------------------ autoria (antes de gravar)
create or replace function carimbar_autoria()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.criado_por := coalesce(new.criado_por, auth.uid());
    new.atualizado_por := coalesce(auth.uid(), new.criado_por);
    new.atualizado_em := now();
  elsif auth.uid() is not null then
    -- criado_por não muda depois de nascer
    new.criado_por := old.criado_por;
    new.atualizado_por := auth.uid();
    new.atualizado_em := now();
  end if;
  return new;
end $$;
drop trigger if exists servicos_autoria on servicos;
create trigger servicos_autoria before insert or update on servicos
  for each row execute function carimbar_autoria();
drop trigger if exists clientes_autoria on clientes;
create trigger clientes_autoria before insert or update on clientes
  for each row execute function carimbar_autoria();

create or replace function carimbar_gerado_por()
returns trigger
language plpgsql
as $$
begin
  new.gerado_por := coalesce(new.gerado_por, auth.uid());
  return new;
end $$;
drop trigger if exists documentos_gerado_por on documentos_gerados;
create trigger documentos_gerado_por before insert on documentos_gerados
  for each row execute function carimbar_gerado_por();

-- ------------------------------------------------------------------ serviços, clientes, documentos
create or replace function nome_do_servico(s servicos)
returns text
language sql stable
as $$ select coalesce(nullif(s.denominacao, ''), s.nome_arquivo_txt, 'serviço') $$;

create or replace function atividade_servico()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare v_campos text[];
begin
  if tg_op = 'INSERT' then
    perform registrar_auditoria(new.escritorio_id, coalesce(auth.uid(), new.criado_por), 'servico.criado',
      nome_do_servico(new), new.id, new.id, null, jsonb_build_object('servico_id', new.id));
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if auth.uid() is null then return new; end if;
    v_campos := campos_alterados(to_jsonb(old), to_jsonb(new),
      array['atualizado_por', 'atualizado_em', 'criado_por', 'created_at', 'escritorio_id', 'id']);
    if cardinality(v_campos) = 0 then return new; end if;
    perform registrar_auditoria(new.escritorio_id, auth.uid(), 'servico.alterado',
      nome_do_servico(new), new.id, new.id, v_campos, null, interval '15 minutes');
    return new;
  end if;
  perform registrar_auditoria(old.escritorio_id, auth.uid(), 'servico.excluido',
    nome_do_servico(old), null, old.id, null, jsonb_build_object('servico_id', old.id));
  return old;
end $$;
drop trigger if exists servicos_atividade on servicos;
create trigger servicos_atividade after insert or update or delete on servicos
  for each row execute function atividade_servico();

create or replace function atividade_cliente()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare v_campos text[];
begin
  if tg_op = 'INSERT' then
    perform registrar_auditoria(new.escritorio_id, coalesce(auth.uid(), new.criado_por), 'cliente.criado',
      new.nome, null, new.id, null, jsonb_build_object('cliente_id', new.id));
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if auth.uid() is null then return new; end if;
    v_campos := campos_alterados(to_jsonb(old), to_jsonb(new),
      array['atualizado_por', 'atualizado_em', 'criado_por', 'created_at', 'escritorio_id', 'id']);
    if cardinality(v_campos) = 0 then return new; end if;
    perform registrar_auditoria(new.escritorio_id, auth.uid(), 'cliente.alterado',
      new.nome, null, new.id, v_campos, jsonb_build_object('cliente_id', new.id), interval '15 minutes');
    return new;
  end if;
  perform registrar_auditoria(old.escritorio_id, auth.uid(), 'cliente.excluido',
    old.nome, null, old.id, null, jsonb_build_object('cliente_id', old.id));
  return old;
end $$;
drop trigger if exists clientes_atividade on clientes;
create trigger clientes_atividade after insert or update or delete on clientes
  for each row execute function atividade_cliente();

-- Uma geração grava vários arquivos (memorial, planilha, planta…): vira uma
-- linha só por pessoa e serviço, com os títulos em "campos".
create or replace function atividade_documento()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare s servicos;
begin
  select * into s from servicos where id = new.servico_id;
  if s.id is null then return new; end if;
  perform registrar_auditoria(s.escritorio_id, coalesce(auth.uid(), new.gerado_por), 'documento.gerado',
    nome_do_servico(s), s.id, s.id, array[coalesce(new.titulo, new.tipo)],
    jsonb_build_object('servico_id', s.id, 'servico', nome_do_servico(s), 'versao', new.versao),
    interval '5 minutes');
  return new;
end $$;
drop trigger if exists documentos_atividade on documentos_gerados;
create trigger documentos_atividade after insert on documentos_gerados
  for each row execute function atividade_documento();

-- ------------------------------------------------------------------ partes do serviço
-- vértices, confrontantes, glebas, loteamento e CAR: por comando (o autosave
-- regrava a tabela inteira de uma vez) e só quando é a pessoa que grava.
-- Também carimba o serviço como "alterado por" ela.
create or replace function atividade_parte_servico()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  s servicos;
begin
  if auth.uid() is null then return null; end if;
  if tg_op = 'DELETE' then
    select array_agg(distinct servico_id) into v_ids from velhas;
  else
    select array_agg(distinct servico_id) into v_ids from novas;
  end if;
  if v_ids is null then return null; end if;
  for s in select * from servicos where id = any (v_ids) loop
    perform registrar_auditoria(s.escritorio_id, auth.uid(), tg_argv[0], nome_do_servico(s), s.id, s.id,
      null, null, interval '15 minutes');
    update servicos set atualizado_por = auth.uid(), atualizado_em = now() where id = s.id;
  end loop;
  return null;
end $$;

do $$
declare
  t text;
  acao text;
  pares text[][] := array[
    array['vertices', 'vertices.alterados'],
    array['trechos_confrontantes', 'confrontantes.alterados'],
    array['glebas', 'glebas.alteradas'],
    array['loteamentos', 'loteamento.alterado'],
    array['car_projetos', 'car.alterado']];
  i int;
begin
  for i in 1 .. array_length(pares, 1) loop
    t := pares[i][1]; acao := pares[i][2];
    if to_regclass(t) is null then continue; end if;
    execute format('drop trigger if exists %I on %I', t || '_auditoria_ins', t);
    execute format('drop trigger if exists %I on %I', t || '_auditoria_upd', t);
    execute format('drop trigger if exists %I on %I', t || '_auditoria_del', t);
    execute format('create trigger %I after insert on %I referencing new table as novas
                      for each statement execute function atividade_parte_servico(%L)', t || '_auditoria_ins', t, acao);
    execute format('create trigger %I after update on %I referencing new table as novas
                      for each statement execute function atividade_parte_servico(%L)', t || '_auditoria_upd', t, acao);
    execute format('create trigger %I after delete on %I referencing old table as velhas
                      for each statement execute function atividade_parte_servico(%L)', t || '_auditoria_del', t, acao);
  end loop;
end $$;

-- ------------------------------------------------------------------ cadastros e empresa
create or replace function atividade_cadastro()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_tipo text := tg_argv[0];   -- 'rt' | 'credenciado'
  v_campos text[];
begin
  -- trigger AFTER: o retorno é ignorado
  if auth.uid() is null then return null; end if;
  if tg_op = 'INSERT' then
    perform registrar_auditoria(new.escritorio_id, auth.uid(), 'cadastro.' || v_tipo || '.criado', new.nome, null, new.id);
    return new;
  elsif tg_op = 'UPDATE' then
    v_campos := campos_alterados(to_jsonb(old), to_jsonb(new), array['escritorio_id', 'id', 'contador_m', 'contador_p', 'contador_v']);
    if cardinality(v_campos) > 0 then
      perform registrar_auditoria(new.escritorio_id, auth.uid(), 'cadastro.' || v_tipo || '.alterado', new.nome,
        null, new.id, v_campos, null, interval '15 minutes');
    end if;
    return new;
  end if;
  perform registrar_auditoria(old.escritorio_id, auth.uid(), 'cadastro.' || v_tipo || '.excluido', old.nome, null, old.id);
  return old;
end $$;
drop trigger if exists rts_auditoria on responsaveis_tecnicos;
create trigger rts_auditoria after insert or update or delete on responsaveis_tecnicos
  for each row execute function atividade_cadastro('rt');
drop trigger if exists credenciados_auditoria on credenciados;
create trigger credenciados_auditoria after insert or update or delete on credenciados
  for each row execute function atividade_cadastro('credenciado');

create or replace function atividade_config_empresa()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare r config_empresa;
begin
  if auth.uid() is null then return null; end if;
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  if tg_op = 'UPDATE' and old.value is not distinct from new.value then return null; end if;
  perform registrar_auditoria(r.escritorio_id, auth.uid(), 'empresa.configurada', 'dados da empresa',
    null, r.escritorio_id, array[r.key], null, interval '15 minutes');
  return null;
end $$;
drop trigger if exists config_empresa_auditoria on config_empresa;
create trigger config_empresa_auditoria after insert or update or delete on config_empresa
  for each row execute function atividade_config_empresa();

-- ------------------------------------------------------------------ leitura
-- Auditoria da empresa, com filtros (pessoa, serviço) e paginação por data.
drop function if exists listar_atividades(int);
create or replace function listar_atividades(
  p_limite int default 150, p_user uuid default null, p_servico uuid default null, p_antes timestamptz default null)
returns table (id bigint, acao text, alvo text, detalhe jsonb, created_at timestamptz, quem text,
               user_id uuid, servico_id uuid, vezes int)
language sql stable security definer
set search_path = public
as $$
  select a.id, a.acao, a.alvo, a.detalhe, a.created_at,
         coalesce(nullif(m.nome, ''), u.email::text, 'sistema'),
         a.user_id, a.servico_id, a.vezes
    from atividades a
    left join auth.users u on u.id = a.user_id
    left join membros_escritorio m on m.user_id = a.user_id and m.escritorio_id = a.escritorio_id
   where a.escritorio_id = escritorio_atual() and tem_permissao('equipe.gerenciar')
     and (p_user is null or a.user_id = p_user)
     and (p_servico is null or a.servico_id = p_servico)
     and (p_antes is null or a.created_at < p_antes)
   order by a.created_at desc limit greatest(1, least(p_limite, 500))
$$;

-- Quem criou e quem mexeu por último nos serviços: qualquer pessoa da empresa vê
-- (é o que aparece no topo do serviço e na lista).
create or replace function autoria_servicos(p_ids uuid[])
returns table (servico_id uuid, criado_por text, criado_em timestamptz, atualizado_por text, atualizado_em timestamptz)
language sql stable security definer
set search_path = public
as $$
  select s.id,
         (select coalesce(nullif(m.nome, ''), u.email::text) from auth.users u
            left join membros_escritorio m on m.user_id = u.id and m.escritorio_id = s.escritorio_id
           where u.id = s.criado_por),
         s.created_at,
         (select coalesce(nullif(m.nome, ''), u.email::text) from auth.users u
            left join membros_escritorio m on m.user_id = u.id and m.escritorio_id = s.escritorio_id
           where u.id = s.atualizado_por),
         s.atualizado_em
    from servicos s
   where s.id = any (p_ids) and s.escritorio_id = escritorio_atual()
$$;

-- superadmin: as mesmas colunas novas
drop function if exists sa_atividades(uuid, int);
create or replace function sa_atividades(p_escritorio uuid, p_limite int default 100)
returns table (id bigint, acao text, alvo text, detalhe jsonb, created_at timestamptz, quem text,
               user_id uuid, servico_id uuid, vezes int)
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform exigir_superadmin();
  return query
  select a.id, a.acao, a.alvo, a.detalhe, a.created_at, coalesce(nullif(m.nome, ''), u.email::text, 'sistema'),
         a.user_id, a.servico_id, a.vezes
    from atividades a
    left join auth.users u on u.id = a.user_id
    left join membros_escritorio m on m.user_id = a.user_id and m.escritorio_id = a.escritorio_id
   where a.escritorio_id = p_escritorio
   order by a.created_at desc limit greatest(1, least(p_limite, 500));
end $$;

-- ------------------------------------------------------------------ permissões das funções
revoke execute on function registrar_auditoria(uuid, uuid, text, text, uuid, uuid, text[], jsonb, interval) from public, anon, authenticated;
revoke execute on function atividade_parte_servico() from public, anon, authenticated;
revoke execute on function atividade_cadastro() from public, anon, authenticated;
revoke execute on function atividade_config_empresa() from public, anon, authenticated;
revoke execute on function listar_atividades(int, uuid, uuid, timestamptz) from public, anon;
revoke execute on function autoria_servicos(uuid[]) from public, anon;
revoke execute on function sa_atividades(uuid, int) from public, anon;
grant execute on function registrar_auditoria(uuid, uuid, text, text, uuid, uuid, text[], jsonb, interval) to service_role;
grant execute on function listar_atividades(int, uuid, uuid, timestamptz) to authenticated;
grant execute on function autoria_servicos(uuid[]) to authenticated;
grant execute on function sa_atividades(uuid, int) to authenticated;
