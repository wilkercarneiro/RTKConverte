-- Equipe da empresa: o dono (e quem ele autorizar) cadastra funcionários, dá e
-- tira permissões, desativa o acesso sem apagar a conta, e vê o histórico do
-- que a equipe fez. Depende da 0020 (escritórios) e da 0024 (SaaS).
--
--   membros_escritorio  + nome, cargo, permissoes[], ativo
--   planos              + limite_usuarios (null = sem limite)
--   atividades          — histórico por empresa (gravado por triggers)
--
-- Permissões (o catálogo é src/lib/permissoes.ts; o dono tem todas):
--   servicos.criar, servicos.excluir, clientes.editar, clientes.excluir,
--   documentos.gerar, cadastros.editar, empresa.configurar, equipe.gerenciar
--
-- O banco trava o que é administrativo ou destrutivo (policies RESTRICTIVE, que
-- se somam às da 0020 com E): excluir serviço/cliente, editar cliente, incluir
-- e remover RT/credenciado, dados e modelos da empresa, a equipe. Criar serviço
-- e gerar documento são travados na tela e nas edge functions.
--
-- Membro desativado perde o acesso na hora (escritorio_atual() exige ativo).
--
-- Teste local: `npm run test:rls` (tests/rls/equipe.sql).

-- ------------------------------------------------------------------ colunas
alter table membros_escritorio add column if not exists nome text;
alter table membros_escritorio add column if not exists cargo text;
alter table membros_escritorio add column if not exists permissoes text[] not null default '{}';
alter table membros_escritorio add column if not exists ativo boolean not null default true;
alter table membros_escritorio add column if not exists atualizado_em timestamptz not null default now();

-- quem já trabalhava continua podendo fazer o mesmo de antes (tudo menos
-- administrar a equipe e a empresa)
update membros_escritorio
   set permissoes = array['servicos.criar', 'servicos.excluir', 'clientes.editar', 'clientes.excluir', 'documentos.gerar', 'cadastros.editar']
 where papel = 'membro' and permissoes = '{}';

alter table planos add column if not exists limite_usuarios int check (limite_usuarios is null or limite_usuarios > 0);

create table if not exists atividades (
  id bigint generated always as identity primary key,
  escritorio_id uuid not null references escritorios(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  acao text not null,
  alvo text,
  detalhe jsonb,
  created_at timestamptz not null default now()
);
create index if not exists atividades_escritorio_data on atividades (escritorio_id, created_at desc);
alter table atividades enable row level security;
revoke insert, update, delete on atividades from anon, authenticated;

-- ------------------------------------------------------------------ funções base
create or replace function escritorio_atual()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select m.escritorio_id
    from membros_escritorio m join escritorios e on e.id = m.escritorio_id
   where m.user_id = auth.uid() and e.status = 'ativo' and m.ativo
$$;

-- O dono pode tudo; os demais, o que estiver na lista. Desativado não pode nada.
create or replace function tem_permissao(p text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from membros_escritorio m join escritorios e on e.id = m.escritorio_id
     where m.user_id = auth.uid() and m.ativo and e.status = 'ativo'
       and (m.papel = 'dono' or p = any (m.permissoes))
  )
$$;

drop function if exists meu_escritorio();
create or replace function meu_escritorio()
returns table (id uuid, nome text, papel text, modelos_compartilhados boolean, status text, plano text,
               ativo boolean, permissoes text[], meu_nome text)
language sql stable security definer
set search_path = public
as $$
  select e.id, e.nome, m.papel, e.modelos_compartilhados, e.status, p.nome,
         m.ativo, m.permissoes, m.nome
    from membros_escritorio m
    join escritorios e on e.id = m.escritorio_id
    left join planos p on p.id = e.plano_id
   where m.user_id = auth.uid()
$$;

-- ------------------------------------------------------------------ histórico
create or replace function registrar_atividade(p_escritorio uuid, p_acao text, p_alvo text, p_detalhe jsonb default null)
returns void
language sql security definer
set search_path = public
as $$
  insert into atividades (escritorio_id, user_id, acao, alvo, detalhe)
  values (p_escritorio, auth.uid(), p_acao, left(p_alvo, 200), p_detalhe)
$$;

create or replace function atividade_servico()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform registrar_atividade(new.escritorio_id, 'servico.criado',
      coalesce(nullif(new.denominacao, ''), new.nome_arquivo_txt, 'serviço'), jsonb_build_object('servico_id', new.id));
    return new;
  end if;
  perform registrar_atividade(old.escritorio_id, 'servico.excluido',
    coalesce(nullif(old.denominacao, ''), old.nome_arquivo_txt, 'serviço'), jsonb_build_object('servico_id', old.id));
  return old;
end $$;
drop trigger if exists servicos_atividade on servicos;
create trigger servicos_atividade after insert or delete on servicos
  for each row execute function atividade_servico();

create or replace function atividade_cliente()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform registrar_atividade(new.escritorio_id, 'cliente.criado', new.nome, jsonb_build_object('cliente_id', new.id));
    return new;
  end if;
  perform registrar_atividade(old.escritorio_id, 'cliente.excluido', old.nome, jsonb_build_object('cliente_id', old.id));
  return old;
end $$;
drop trigger if exists clientes_atividade on clientes;
create trigger clientes_atividade after insert or delete on clientes
  for each row execute function atividade_cliente();

create or replace function atividade_documento()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare v_esc uuid; v_nome text;
begin
  select s.escritorio_id, coalesce(nullif(s.denominacao, ''), s.nome_arquivo_txt) into v_esc, v_nome
    from servicos s where s.id = new.servico_id;
  if v_esc is not null then
    perform registrar_atividade(v_esc, 'documento.gerado', coalesce(new.titulo, new.tipo),
      jsonb_build_object('servico_id', new.servico_id, 'servico', v_nome, 'versao', new.versao));
  end if;
  return new;
end $$;
drop trigger if exists documentos_atividade on documentos_gerados;
create trigger documentos_atividade after insert on documentos_gerados
  for each row execute function atividade_documento();

-- ------------------------------------------------------------------ travas (RESTRICTIVE)
do $$
begin
  -- serviços: excluir
  drop policy if exists servicos_excluir_permissao on servicos;
  create policy servicos_excluir_permissao on servicos as restrictive for delete to authenticated
    using (tem_permissao('servicos.excluir'));
  -- clientes: criar/editar e excluir
  drop policy if exists clientes_inserir_permissao on clientes;
  create policy clientes_inserir_permissao on clientes as restrictive for insert to authenticated
    with check (tem_permissao('clientes.editar'));
  drop policy if exists clientes_editar_permissao on clientes;
  create policy clientes_editar_permissao on clientes as restrictive for update to authenticated
    using (tem_permissao('clientes.editar'));
  drop policy if exists clientes_excluir_permissao on clientes;
  create policy clientes_excluir_permissao on clientes as restrictive for delete to authenticated
    using (tem_permissao('clientes.excluir'));
  -- RT e credenciado: incluir e remover (atualizar o TRT faz parte do serviço)
  drop policy if exists rts_inserir_permissao on responsaveis_tecnicos;
  create policy rts_inserir_permissao on responsaveis_tecnicos as restrictive for insert to authenticated
    with check (tem_permissao('cadastros.editar'));
  drop policy if exists rts_excluir_permissao on responsaveis_tecnicos;
  create policy rts_excluir_permissao on responsaveis_tecnicos as restrictive for delete to authenticated
    using (tem_permissao('cadastros.editar'));
  drop policy if exists credenciados_inserir_permissao on credenciados;
  create policy credenciados_inserir_permissao on credenciados as restrictive for insert to authenticated
    with check (tem_permissao('cadastros.editar'));
  drop policy if exists credenciados_excluir_permissao on credenciados;
  create policy credenciados_excluir_permissao on credenciados as restrictive for delete to authenticated
    using (tem_permissao('cadastros.editar'));
  -- dados da empresa
  drop policy if exists config_empresa_inserir_permissao on config_empresa;
  create policy config_empresa_inserir_permissao on config_empresa as restrictive for insert to authenticated
    with check (tem_permissao('empresa.configurar'));
  drop policy if exists config_empresa_editar_permissao on config_empresa;
  create policy config_empresa_editar_permissao on config_empresa as restrictive for update to authenticated
    using (tem_permissao('empresa.configurar'));
  drop policy if exists config_empresa_excluir_permissao on config_empresa;
  create policy config_empresa_excluir_permissao on config_empresa as restrictive for delete to authenticated
    using (tem_permissao('empresa.configurar'));
  -- logo e modelos (bucket templates); os outros buckets seguem como estão
  drop policy if exists templates_escrever_permissao on storage.objects;
  create policy templates_escrever_permissao on storage.objects as restrictive for insert to authenticated
    with check (bucket_id <> 'templates' or tem_permissao('empresa.configurar'));
  drop policy if exists templates_trocar_permissao on storage.objects;
  create policy templates_trocar_permissao on storage.objects as restrictive for update to authenticated
    using (bucket_id <> 'templates' or tem_permissao('empresa.configurar'));
  drop policy if exists templates_apagar_permissao on storage.objects;
  create policy templates_apagar_permissao on storage.objects as restrictive for delete to authenticated
    using (bucket_id <> 'templates' or tem_permissao('empresa.configurar'));
end $$;

-- histórico: quem administra a equipe lê o da empresa
drop policy if exists atividades_leitura on atividades;
create policy atividades_leitura on atividades for select to authenticated
  using (escritorio_id = escritorio_atual() and tem_permissao('equipe.gerenciar'));

-- ------------------------------------------------------------------ RPCs da equipe
drop function if exists listar_membros();
create or replace function listar_membros()
returns table (user_id uuid, email text, nome text, cargo text, papel text, permissoes text[], ativo boolean,
               desde timestamptz, ultimo_acesso timestamptz, senha_provisoria boolean)
language sql stable security definer
set search_path = public
as $$
  select m.user_id, u.email::text, m.nome, m.cargo, m.papel, m.permissoes, m.ativo, m.created_at,
         u.last_sign_in_at, exists (select 1 from senhas_provisorias sp where sp.user_id = m.user_id)
    from membros_escritorio m join auth.users u on u.id = m.user_id
   where m.escritorio_id = escritorio_atual()
   order by m.papel = 'dono' desc, m.ativo desc, coalesce(m.nome, u.email::text)
$$;

-- Nome, cargo, permissões e ativo de um membro. Regras:
--   - precisa de equipe.gerenciar;
--   - o dono não é alterado por ninguém além dele mesmo (e ele não se desativa);
--   - só o dono concede equipe.gerenciar;
--   - ninguém se desativa nem tira de si equipe.gerenciar (não se tranca fora).
create or replace function definir_membro(p_user uuid, p_nome text, p_cargo text, p_permissoes text[], p_ativo boolean)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_esc uuid := escritorio_atual();
  v_sou_dono boolean := exists (select 1 from membros_escritorio where user_id = auth.uid() and escritorio_id = v_esc and papel = 'dono');
  v_alvo membros_escritorio;
  v_validas text[] := array['servicos.criar', 'servicos.excluir', 'clientes.editar', 'clientes.excluir',
                            'documentos.gerar', 'cadastros.editar', 'empresa.configurar', 'equipe.gerenciar'];
  v_perm text[];
begin
  if v_esc is null or not tem_permissao('equipe.gerenciar') then
    raise exception 'Você não tem permissão para gerenciar a equipe' using errcode = '42501';
  end if;
  select * into v_alvo from membros_escritorio where user_id = p_user and escritorio_id = v_esc;
  if not found then raise exception 'Pessoa não encontrada na equipe' using errcode = 'P0002'; end if;
  if v_alvo.papel = 'dono' and p_user <> auth.uid() then
    raise exception 'Os dados do dono só ele mesmo altera' using errcode = '42501';
  end if;
  if p_user = auth.uid() and coalesce(p_ativo, true) = false then
    raise exception 'Você não pode desativar o próprio acesso' using errcode = '42501';
  end if;
  v_perm := array(select distinct x from unnest(coalesce(p_permissoes, '{}')) x where x = any (v_validas) order by 1);
  if not v_sou_dono and 'equipe.gerenciar' = any (v_perm) and not ('equipe.gerenciar' = any (v_alvo.permissoes)) then
    raise exception 'Só o dono concede a permissão de gerenciar a equipe' using errcode = '42501';
  end if;
  if p_user = auth.uid() and v_alvo.papel <> 'dono' and not ('equipe.gerenciar' = any (v_perm)) then
    raise exception 'Você não pode tirar de si a permissão de gerenciar a equipe' using errcode = '42501';
  end if;
  update membros_escritorio set
    nome = nullif(trim(p_nome), ''),
    cargo = nullif(trim(p_cargo), ''),
    permissoes = case when papel = 'dono' then permissoes else v_perm end,
    ativo = case when papel = 'dono' then true else coalesce(p_ativo, ativo) end,
    atualizado_em = now()
  where user_id = p_user and escritorio_id = v_esc;
  perform registrar_atividade(v_esc,
    case when v_alvo.ativo and coalesce(p_ativo, true) = false then 'membro.desativado'
         when not v_alvo.ativo and coalesce(p_ativo, false) then 'membro.reativado'
         else 'membro.alterado' end,
    coalesce(nullif(trim(p_nome), ''), (select email from auth.users where id = p_user)),
    jsonb_build_object('antes', v_alvo.permissoes, 'depois', v_perm));
end $$;

-- O que a edge function `equipe` precisa conferir antes de criar uma conta.
create or replace function pode_adicionar_membro()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_esc uuid := escritorio_atual();
  v_limite int;
  v_total int;
begin
  if v_esc is null then return jsonb_build_object('ok', false, 'motivo', 'Sua conta não está ligada a uma empresa ativa.'); end if;
  if not tem_permissao('equipe.gerenciar') then
    return jsonb_build_object('ok', false, 'motivo', 'Você não tem permissão para gerenciar a equipe.');
  end if;
  if not recurso_liberado(v_esc, 'empresa.equipe') then
    return jsonb_build_object('ok', false, 'motivo', 'O plano da empresa não inclui equipe. Fale com o suporte do Vértice.');
  end if;
  select p.limite_usuarios into v_limite from escritorios e left join planos p on p.id = e.plano_id where e.id = v_esc;
  select count(*) into v_total from membros_escritorio where escritorio_id = v_esc and ativo;
  if v_limite is not null and v_total >= v_limite then
    return jsonb_build_object('ok', false, 'motivo', format('O plano da empresa permite %s usuário(s) ativo(s). Desative alguém ou fale com o suporte para ampliar.', v_limite));
  end if;
  return jsonb_build_object('ok', true, 'escritorio_id', v_esc, 'sou_dono',
    exists (select 1 from membros_escritorio where user_id = auth.uid() and escritorio_id = v_esc and papel = 'dono'),
    'limite', v_limite, 'ativos', v_total);
end $$;

-- Reativar alguém também conta no limite do plano.
create or replace function validar_limite_membros()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare v_limite int; v_total int;
begin
  if new.ativo and (tg_op = 'INSERT' or not old.ativo) then
    select p.limite_usuarios into v_limite from escritorios e left join planos p on p.id = e.plano_id where e.id = new.escritorio_id;
    select count(*) into v_total from membros_escritorio where escritorio_id = new.escritorio_id and ativo and user_id <> new.user_id;
    if v_limite is not null and v_total >= v_limite then
      raise exception 'O plano da empresa permite % usuário(s) ativo(s)', v_limite using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists membros_limite on membros_escritorio;
create trigger membros_limite before insert or update of ativo on membros_escritorio
  for each row execute function validar_limite_membros();

-- remover pela RPC antiga continua possível (tira da equipe, a conta fica);
-- a edge function `equipe` apaga a conta inteira.
create or replace function remover_membro(p_user uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_esc uuid := escritorio_atual(); v_alvo membros_escritorio;
begin
  if v_esc is null or not tem_permissao('equipe.gerenciar') then
    raise exception 'Você não tem permissão para gerenciar a equipe' using errcode = '42501';
  end if;
  select * into v_alvo from membros_escritorio where user_id = p_user and escritorio_id = v_esc;
  if not found then raise exception 'Pessoa não encontrada na equipe' using errcode = 'P0002'; end if;
  if v_alvo.papel = 'dono' then raise exception 'O dono não pode ser removido' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'Você não pode remover a si mesmo' using errcode = '42501'; end if;
  delete from membros_escritorio where user_id = p_user and escritorio_id = v_esc;
  perform registrar_atividade(v_esc, 'membro.removido', coalesce(v_alvo.nome, (select email from auth.users where id = p_user)), null);
end $$;

-- adicionar por e-mail de conta já existente (fluxo antigo): agora com permissão
create or replace function adicionar_membro(p_email text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
begin
  raise exception 'Use "Adicionar pessoa" na Equipe: o sistema cria a conta com senha provisória' using errcode = '0A000';
end $$;

-- Uso do superadmin: limite do plano e equipe com permissões.
drop function if exists sa_empresa_usuarios(uuid);
create or replace function sa_empresa_usuarios(p_escritorio uuid)
returns table (user_id uuid, email text, nome text, papel text, ativo boolean, permissoes text[],
               desde timestamptz, ultimo_acesso timestamptz, senha_provisoria boolean)
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform exigir_superadmin();
  return query
  select m.user_id, u.email::text, m.nome, m.papel, m.ativo, m.permissoes, m.created_at, u.last_sign_in_at,
         exists (select 1 from senhas_provisorias sp where sp.user_id = m.user_id)
    from membros_escritorio m join auth.users u on u.id = m.user_id
   where m.escritorio_id = p_escritorio
   order by m.papel = 'dono' desc, m.created_at;
end $$;

create or replace function sa_atividades(p_escritorio uuid, p_limite int default 100)
returns table (id bigint, acao text, alvo text, detalhe jsonb, created_at timestamptz, quem text)
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform exigir_superadmin();
  return query
  select a.id, a.acao, a.alvo, a.detalhe, a.created_at, coalesce(m.nome, u.email::text, 'sistema')
    from atividades a
    left join auth.users u on u.id = a.user_id
    left join membros_escritorio m on m.user_id = a.user_id
   where a.escritorio_id = p_escritorio
   order by a.created_at desc limit greatest(1, least(p_limite, 500));
end $$;

create or replace function listar_atividades(p_limite int default 100)
returns table (id bigint, acao text, alvo text, detalhe jsonb, created_at timestamptz, quem text)
language sql stable security definer
set search_path = public
as $$
  select a.id, a.acao, a.alvo, a.detalhe, a.created_at, coalesce(m.nome, u.email::text, 'sistema')
    from atividades a
    left join auth.users u on u.id = a.user_id
    left join membros_escritorio m on m.user_id = a.user_id
   where a.escritorio_id = escritorio_atual() and tem_permissao('equipe.gerenciar')
   order by a.created_at desc limit greatest(1, least(p_limite, 500))
$$;

-- ------------------------------------------------------------------ permissões das funções
revoke execute on function tem_permissao(text) from public, anon;
revoke execute on function meu_escritorio() from public, anon;
revoke execute on function registrar_atividade(uuid, text, text, jsonb) from public, anon, authenticated;
revoke execute on function atividade_servico() from public, anon, authenticated;
revoke execute on function atividade_cliente() from public, anon, authenticated;
revoke execute on function atividade_documento() from public, anon, authenticated;
revoke execute on function validar_limite_membros() from public, anon, authenticated;
revoke execute on function listar_membros() from public, anon;
revoke execute on function definir_membro(uuid, text, text, text[], boolean) from public, anon;
revoke execute on function pode_adicionar_membro() from public, anon;
revoke execute on function remover_membro(uuid) from public, anon;
revoke execute on function adicionar_membro(text) from public, anon;
revoke execute on function sa_empresa_usuarios(uuid) from public, anon;
revoke execute on function sa_atividades(uuid, int) from public, anon;
revoke execute on function listar_atividades(int) from public, anon;
grant execute on function tem_permissao(text) to authenticated, service_role;
grant execute on function meu_escritorio() to authenticated;
grant execute on function registrar_atividade(uuid, text, text, jsonb) to service_role;
grant execute on function listar_membros() to authenticated;
grant execute on function definir_membro(uuid, text, text, text[], boolean) to authenticated;
grant execute on function pode_adicionar_membro() to authenticated;
grant execute on function remover_membro(uuid) to authenticated;
grant execute on function adicionar_membro(text) to authenticated;
grant execute on function sa_empresa_usuarios(uuid) to authenticated;
grant execute on function sa_atividades(uuid, int) to authenticated;
grant execute on function listar_atividades(int) to authenticated;
