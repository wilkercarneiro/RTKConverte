-- PROPOSTA DE MIGRAÇÃO — AINDA NÃO APLICADA EM PRODUÇÃO.
-- Para aplicar: revisar, copiar para supabase/migrations/0020_escritorios.sql e
-- seguir docs/multiescritorio/README.md (ordem: banco → edge functions → frontend).
--
-- Vários escritórios no mesmo banco (multiempresa).
--
-- Até aqui todo usuário autenticado via TUDO (`using (true)`): o sistema nasceu
-- para um escritório só. Vender para outros exige que cada escritório enxergue
-- apenas os próprios clientes, serviços, cadastros e documentos.
--
-- Modelo:
--   escritorios          — a empresa cliente do Vértice
--   membros_escritorio   — quem trabalha em qual escritório (um escritório por
--                          usuário; `dono` administra a equipe)
--   escritorio_id        — nas tabelas-raiz (servicos, clientes, credenciados,
--                          responsaveis_tecnicos, config_empresa). As tabelas
--                          filhas (vertices, trechos, glebas, documentos) herdam
--                          pelo servico_id.
--
-- Compatibilidade (nada do que existe muda de dono nem some):
--   - Os dados atuais e TODOS os usuários atuais vão para um escritório criado
--     aqui, marcado `modelos_compartilhados` — ele continua usando os modelos e
--     a logo da raiz do bucket `templates`, exatamente como hoje.
--   - `escritorio_id` é preenchido sozinho no INSERT (trigger) pelo escritório
--     de quem insere. Edge function antiga (service_role, sem escritório) ainda
--     funciona ENQUANTO houver um escritório só; as funções novas mandam o
--     escritório explícito.
--   - Nenhuma linha é apagada; o que muda são as policies (de `true` para
--     "do meu escritório") e a chave de config_empresa (key → escritorio+key).
--
-- Teste local: `npm run test:rls` (Postgres descartável, ver scripts/testar-rls.sh).

-- ------------------------------------------------------------------ tabelas
create table if not exists escritorios (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  -- true só no escritório que já existia: usa os modelos/logo da raiz do
  -- bucket `templates`. Escritório novo usa `templates/escritorios/{id}/`.
  modelos_compartilhados boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists membros_escritorio (
  escritorio_id uuid not null references escritorios(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  papel text not null default 'membro' check (papel in ('dono', 'membro')),
  created_at timestamptz not null default now(),
  primary key (escritorio_id, user_id)
);
create unique index if not exists membros_escritorio_um_por_usuario on membros_escritorio (user_id);

-- Prova do aceite dos termos no cadastro (LGPD): versão e momento.
create table if not exists aceites_termos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  versao text not null,
  aceito_em timestamptz not null default now()
);
create index if not exists aceites_termos_user on aceites_termos (user_id);

alter table escritorios enable row level security;
alter table membros_escritorio enable row level security;
alter table aceites_termos enable row level security;

-- ------------------------------------------------------------------ funções base
-- security definer: as policies consultam membros_escritorio sem cair na RLS
-- dela mesma (recursão) e sem depender de grant de leitura.
create or replace function escritorio_atual()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select escritorio_id from membros_escritorio where user_id = auth.uid()
$$;

create or replace function escritorio_compartilha_modelos()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((select modelos_compartilhados from escritorios where id = escritorio_atual()), false)
$$;

-- ------------------------------------------------------------------ backfill
-- O escritório que já usa o sistema: leva todos os usuários e todos os dados.
-- O primeiro usuário criado vira `dono` (administra a equipe); os demais, membros.
-- CONFERIR depois de aplicar: `select * from membros_escritorio` — toda conta
-- que existir no Auth entra aqui (inclusive alguma criada por engano).
do $$
declare v_id uuid;
begin
  if not exists (select 1 from escritorios) then
    insert into escritorios (nome, modelos_compartilhados)
    values (
      coalesce((select nullif(trim(value), '') from config_empresa where key = 'razao_social'), 'Escritório principal'),
      true
    )
    returning id into v_id;

    insert into membros_escritorio (escritorio_id, user_id, papel)
    select v_id, u.id,
           case when row_number() over (order by u.created_at, u.id) = 1 then 'dono' else 'membro' end
      from auth.users u
    on conflict do nothing;
  end if;
end $$;

-- ------------------------------------------------------------------ escritorio_id nas tabelas-raiz
-- Preenche o escritório no INSERT. Ordem: o informado > o de quem insere >
-- (service_role sem escritório e banco com UM escritório só) esse único.
create or replace function preencher_escritorio()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.escritorio_id is null then
    new.escritorio_id := escritorio_atual();
  end if;
  if new.escritorio_id is null and auth.uid() is null and (select count(*) from escritorios) = 1 then
    select id into new.escritorio_id from escritorios;
  end if;
  if new.escritorio_id is null then
    raise exception 'Sem escritório: informe escritorio_id ou entre com um usuário ligado a um escritório'
      using errcode = '42501';
  end if;
  return new;
end $$;

do $$
declare
  t text;
  v_id uuid := (select id from escritorios order by created_at limit 1);
begin
  foreach t in array array['servicos', 'clientes', 'credenciados', 'responsaveis_tecnicos', 'config_empresa'] loop
    execute format('alter table %I add column if not exists escritorio_id uuid references escritorios(id)', t);
    execute format('update %I set escritorio_id = %L where escritorio_id is null', t, v_id);
    execute format('alter table %I alter column escritorio_id set not null', t);
    execute format('create index if not exists %I on %I (escritorio_id)', t || '_escritorio_idx', t);
    execute format('drop trigger if exists %I on %I', t || '_preencher_escritorio', t);
    execute format('create trigger %I before insert on %I for each row execute function preencher_escritorio()',
                   t || '_preencher_escritorio', t);
  end loop;
end $$;

-- config_empresa: a chave passa a ser (escritório, key). Os valores atuais já
-- foram para o escritório existente no update acima.
alter table config_empresa drop constraint if exists config_empresa_pkey;
alter table config_empresa add constraint config_empresa_pkey primary key (escritorio_id, key);

-- Tabelas filhas: o serviço é do meu escritório? (criada depois da coluna)
create or replace function servico_do_escritorio(p_servico uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from servicos s
     where s.id = p_servico and s.escritorio_id = escritorio_atual()
  )
$$;

-- Para o Storage: o primeiro segmento do caminho em `gerados` é o id do serviço.
create or replace function pasta_do_escritorio(p_pasta text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select case
    when p_pasta ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then servico_do_escritorio(p_pasta::uuid)
    else false
  end
$$;

-- Um serviço só pode apontar para cliente, credenciado e RT do próprio
-- escritório: a edge function lê esses cadastros com service_role, então um id
-- de outro escritório levaria o RT/contador alheio para o documento.
create or replace function validar_referencias_servico()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.cliente_id is not null and not exists (
       select 1 from clientes where id = new.cliente_id and escritorio_id = new.escritorio_id) then
    raise exception 'Cliente de outro escritório' using errcode = '42501';
  end if;
  if new.credenciado_id is not null and not exists (
       select 1 from credenciados where id = new.credenciado_id and escritorio_id = new.escritorio_id) then
    raise exception 'Credenciado de outro escritório' using errcode = '42501';
  end if;
  if new.rt_id is not null and not exists (
       select 1 from responsaveis_tecnicos where id = new.rt_id and escritorio_id = new.escritorio_id) then
    raise exception 'Responsável técnico de outro escritório' using errcode = '42501';
  end if;
  return new;
end $$;

-- nome com "z" para rodar DEPOIS do servicos_preencher_escritorio (ordem alfabética)
drop trigger if exists servicos_z_validar_referencias on servicos;
create trigger servicos_z_validar_referencias
  before insert or update of cliente_id, credenciado_id, rt_id, escritorio_id on servicos
  for each row execute function validar_referencias_servico();

-- ------------------------------------------------------------------ policies das tabelas
drop policy if exists autenticado_servicos on servicos;
drop policy if exists autenticado_clientes on clientes;
drop policy if exists autenticado_credenciados on credenciados;
drop policy if exists autenticado_rts on responsaveis_tecnicos;
drop policy if exists autenticado_config_empresa on config_empresa;
drop policy if exists autenticado_vertices on vertices;
drop policy if exists autenticado_trechos on trechos_confrontantes;
drop policy if exists glebas_autenticado on glebas;
drop policy if exists autenticado_documentos on documentos_gerados;

do $$
declare t text;
begin
  foreach t in array array['servicos', 'clientes', 'credenciados', 'responsaveis_tecnicos', 'config_empresa'] loop
    execute format('drop policy if exists %I on %I', t || '_do_escritorio', t);
    execute format(
      'create policy %I on %I for all to authenticated
         using (escritorio_id = escritorio_atual())
         with check (escritorio_id = escritorio_atual())', t || '_do_escritorio', t);
  end loop;
  foreach t in array array['vertices', 'trechos_confrontantes', 'glebas', 'documentos_gerados'] loop
    execute format('drop policy if exists %I on %I', t || '_do_escritorio', t);
    execute format(
      'create policy %I on %I for all to authenticated
         using (servico_do_escritorio(servico_id))
         with check (servico_do_escritorio(servico_id))', t || '_do_escritorio', t);
  end loop;
  -- loteamentos (0021) pode ter sido aplicada antes desta: troca a policy aberta
  if to_regclass('loteamentos') is not null then
    drop policy if exists loteamentos_autenticado on loteamentos;
    drop policy if exists loteamentos_do_escritorio on loteamentos;
    create policy loteamentos_do_escritorio on loteamentos for all to authenticated
      using (servico_do_escritorio(servico_id))
      with check (servico_do_escritorio(servico_id));
  end if;
  -- car_projetos (0023), idem
  if to_regclass('car_projetos') is not null then
    drop policy if exists car_projetos_autenticado on car_projetos;
    drop policy if exists car_projetos_do_escritorio on car_projetos;
    create policy car_projetos_do_escritorio on car_projetos for all to authenticated
      using (servico_do_escritorio(servico_id))
      with check (servico_do_escritorio(servico_id));
  end if;
end $$;

-- escritorios: vê o próprio; o dono só renomeia (coluna `nome`). Quem decide
-- `modelos_compartilhados` é a migração, nunca o cliente.
drop policy if exists escritorios_proprio on escritorios;
create policy escritorios_proprio on escritorios for select to authenticated
  using (id = escritorio_atual());
drop policy if exists escritorios_dono_renomeia on escritorios;
create policy escritorios_dono_renomeia on escritorios for update to authenticated
  using (id = escritorio_atual() and exists (
    select 1 from membros_escritorio m where m.user_id = auth.uid() and m.escritorio_id = escritorios.id and m.papel = 'dono'))
  with check (id = escritorio_atual());
revoke insert, update, delete on escritorios from anon, authenticated;
grant select on escritorios to authenticated;
grant update (nome) on escritorios to authenticated;

-- membros: só leitura do próprio escritório; mudanças pelas funções abaixo.
drop policy if exists membros_do_escritorio on membros_escritorio;
create policy membros_do_escritorio on membros_escritorio for select to authenticated
  using (escritorio_id = escritorio_atual());
revoke insert, update, delete on membros_escritorio from anon, authenticated;

-- aceites: o usuário lê os próprios; quem grava é o trigger do cadastro.
drop policy if exists aceites_proprios on aceites_termos;
create policy aceites_proprios on aceites_termos for select to authenticated
  using (user_id = auth.uid());
revoke insert, update, delete on aceites_termos from anon, authenticated;

-- ------------------------------------------------------------------ Storage
-- gerados/{servico}/…: leitura e a pasta entrada/ só do serviço do escritório.
drop policy if exists gerados_select on storage.objects;
create policy gerados_select on storage.objects for select to authenticated
  using (bucket_id = 'gerados' and pasta_do_escritorio((storage.foldername(name))[1]));

drop policy if exists entrada_insert on storage.objects;
drop policy if exists entrada_update on storage.objects;
drop policy if exists entrada_delete on storage.objects;
create policy entrada_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'gerados' and (storage.foldername(name))[2] = 'entrada'
              and pasta_do_escritorio((storage.foldername(name))[1]));
create policy entrada_update on storage.objects for update to authenticated
  using (bucket_id = 'gerados' and (storage.foldername(name))[2] = 'entrada'
         and pasta_do_escritorio((storage.foldername(name))[1]))
  with check (bucket_id = 'gerados' and (storage.foldername(name))[2] = 'entrada'
              and pasta_do_escritorio((storage.foldername(name))[1]));
create policy entrada_delete on storage.objects for delete to authenticated
  using (bucket_id = 'gerados' and (storage.foldername(name))[2] = 'entrada'
         and pasta_do_escritorio((storage.foldername(name))[1]));

-- templates: a logo da raiz (logo-empresa.*) fica com o escritório que já a
-- usava; cada escritório novo mexe só em templates/escritorios/{seu id}/.
drop policy if exists logo_select on storage.objects;
drop policy if exists logo_insert on storage.objects;
drop policy if exists logo_update on storage.objects;
drop policy if exists logo_delete on storage.objects;
create policy logo_select on storage.objects for select to authenticated
  using (bucket_id = 'templates' and name like 'logo-empresa.%' and escritorio_compartilha_modelos());
create policy logo_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'templates' and name like 'logo-empresa.%' and escritorio_compartilha_modelos());
create policy logo_update on storage.objects for update to authenticated
  using (bucket_id = 'templates' and name like 'logo-empresa.%' and escritorio_compartilha_modelos())
  with check (bucket_id = 'templates' and name like 'logo-empresa.%' and escritorio_compartilha_modelos());
create policy logo_delete on storage.objects for delete to authenticated
  using (bucket_id = 'templates' and name like 'logo-empresa.%' and escritorio_compartilha_modelos());

drop policy if exists modelos_escritorio_select on storage.objects;
drop policy if exists modelos_escritorio_insert on storage.objects;
drop policy if exists modelos_escritorio_update on storage.objects;
drop policy if exists modelos_escritorio_delete on storage.objects;
create policy modelos_escritorio_select on storage.objects for select to authenticated
  using (bucket_id = 'templates' and (storage.foldername(name))[1] = 'escritorios'
         and (storage.foldername(name))[2] = escritorio_atual()::text);
create policy modelos_escritorio_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'templates' and (storage.foldername(name))[1] = 'escritorios'
              and (storage.foldername(name))[2] = escritorio_atual()::text);
create policy modelos_escritorio_update on storage.objects for update to authenticated
  using (bucket_id = 'templates' and (storage.foldername(name))[1] = 'escritorios'
         and (storage.foldername(name))[2] = escritorio_atual()::text)
  with check (bucket_id = 'templates' and (storage.foldername(name))[1] = 'escritorios'
              and (storage.foldername(name))[2] = escritorio_atual()::text);
create policy modelos_escritorio_delete on storage.objects for delete to authenticated
  using (bucket_id = 'templates' and (storage.foldername(name))[1] = 'escritorios'
         and (storage.foldername(name))[2] = escritorio_atual()::text);

-- ------------------------------------------------------------------ cadastro self-service
-- Conta criada pela tela de cadastro traz `escritorio_nome` nos metadados: nasce
-- um escritório novo, com quem se cadastrou como dono. Conta sem esse dado
-- (criada no painel, ou convidada) fica sem escritório até um dono adicioná-la.
-- NUNCA entra sozinha num escritório existente.
create or replace function ao_criar_usuario()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_nome text := nullif(trim(coalesce(new.raw_user_meta_data ->> 'escritorio_nome', '')), '');
  v_termos text := nullif(trim(coalesce(new.raw_user_meta_data ->> 'termos_versao', '')), '');
  v_id uuid;
begin
  if v_nome is not null and not exists (select 1 from membros_escritorio where user_id = new.id) then
    insert into escritorios (nome) values (left(v_nome, 120)) returning id into v_id;
    insert into membros_escritorio (escritorio_id, user_id, papel) values (v_id, new.id, 'dono');
  end if;
  if v_termos is not null then
    insert into aceites_termos (user_id, versao) values (new.id, left(v_termos, 40));
  end if;
  return new;
end $$;

drop trigger if exists vertice_ao_criar_usuario on auth.users;
create trigger vertice_ao_criar_usuario
  after insert on auth.users
  for each row execute function ao_criar_usuario();

-- ------------------------------------------------------------------ RPCs da equipe
create or replace function meu_escritorio()
returns table (id uuid, nome text, papel text, modelos_compartilhados boolean)
language sql stable security definer
set search_path = public
as $$
  select e.id, e.nome, m.papel, e.modelos_compartilhados
    from membros_escritorio m join escritorios e on e.id = m.escritorio_id
   where m.user_id = auth.uid()
$$;

create or replace function listar_membros()
returns table (user_id uuid, email text, papel text, desde timestamptz)
language sql stable security definer
set search_path = public
as $$
  select m.user_id, u.email::text, m.papel, m.created_at
    from membros_escritorio m join auth.users u on u.id = m.user_id
   where m.escritorio_id = escritorio_atual()
   order by m.created_at
$$;

create or replace function adicionar_membro(p_email text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_esc uuid := escritorio_atual();
  v_user uuid;
begin
  if v_esc is null or not exists (
       select 1 from membros_escritorio where user_id = auth.uid() and escritorio_id = v_esc and papel = 'dono') then
    raise exception 'Só o dono do escritório adiciona pessoas à equipe' using errcode = '42501';
  end if;
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'Nenhuma conta com o e-mail %. Peça para a pessoa criar a conta primeiro (sem informar escritório).', trim(p_email)
      using errcode = 'P0002';
  end if;
  if exists (select 1 from membros_escritorio where user_id = v_user) then
    raise exception 'Esta conta já pertence a um escritório' using errcode = '23505';
  end if;
  insert into membros_escritorio (escritorio_id, user_id, papel) values (v_esc, v_user, 'membro');
  return v_user;
end $$;

create or replace function remover_membro(p_user uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_esc uuid := escritorio_atual();
begin
  if v_esc is null or not exists (
       select 1 from membros_escritorio where user_id = auth.uid() and escritorio_id = v_esc and papel = 'dono') then
    raise exception 'Só o dono do escritório remove pessoas da equipe' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'O dono não pode remover a si mesmo' using errcode = '42501';
  end if;
  delete from membros_escritorio where user_id = p_user and escritorio_id = v_esc;
end $$;

revoke execute on function escritorio_atual() from public, anon;
revoke execute on function servico_do_escritorio(uuid) from public, anon;
revoke execute on function pasta_do_escritorio(text) from public, anon;
revoke execute on function escritorio_compartilha_modelos() from public, anon;
revoke execute on function meu_escritorio() from public, anon;
revoke execute on function listar_membros() from public, anon;
revoke execute on function adicionar_membro(text) from public, anon;
revoke execute on function remover_membro(uuid) from public, anon;
revoke execute on function preencher_escritorio() from public, anon, authenticated;
revoke execute on function validar_referencias_servico() from public, anon, authenticated;
revoke execute on function ao_criar_usuario() from public, anon, authenticated;
grant execute on function escritorio_atual() to authenticated, service_role;
grant execute on function servico_do_escritorio(uuid) to authenticated, service_role;
grant execute on function pasta_do_escritorio(text) to authenticated, service_role;
grant execute on function escritorio_compartilha_modelos() to authenticated, service_role;
grant execute on function meu_escritorio() to authenticated;
grant execute on function listar_membros() to authenticated;
grant execute on function adicionar_membro(text) to authenticated;
grant execute on function remover_membro(uuid) to authenticated;
