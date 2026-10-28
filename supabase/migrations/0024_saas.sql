-- Vértice como SaaS: planos, recursos liberáveis, painel do superadmin.
--
-- Depende da 0020 (escritórios). O escritório É a empresa cliente; esta
-- migração dá a ele os dados de cadastro (CNPJ, responsável, contato), um plano
-- e um status, e cria:
--
--   super_admins          — quem administra o SaaS (o dono do sistema)
--   planos                — pacotes de recursos (sem preço: o fechamento é por reunião)
--   recursos              — catálogo de recursos do sistema. A FONTE é o código
--                           (src/lib/recursos.ts); o painel do superadmin
--                           sincroniza esta tabela toda vez que abre, então
--                           recurso novo aparece sozinho para ser gerenciado.
--   plano_recursos        — o que cada plano libera
--   escritorio_recursos   — exceção por empresa (libera ou bloqueia só para ela)
--   senhas_provisorias    — quem entrou com a senha padrão e ainda precisa trocar
--   saas_config           — configurações do painel (ex.: senha padrão)
--   contatos_site         — pedidos de reunião vindos da página pública
--
-- Regra do recurso liberado, nesta ordem:
--   exceção da empresa  >  linha do plano  >  `padrao` do catálogo  >  liberado
-- Recurso novo (sem linha em plano nenhum) segue o `padrao` até o superadmin
-- decidir plano a plano.
--
-- Empresa suspensa ou cancelada deixa de enxergar os próprios dados (a RLS de
-- todas as tabelas passa por escritorio_atual(), que agora exige status ativo).
-- Nada é apagado: reativar devolve tudo.
--
-- Teste local: `npm run test:rls` (tests/rls/saas.sql).

-- ------------------------------------------------------------------ superadmin
create table if not exists super_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table super_admins enable row level security;
revoke all on super_admins from anon, authenticated;

create or replace function sou_superadmin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from super_admins where user_id = auth.uid())
$$;

-- ------------------------------------------------------------------ planos e recursos
create table if not exists planos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text,
  cor text not null default '#178552',
  ordem int not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists planos_nome_unico on planos (lower(nome));

create table if not exists recursos (
  chave text primary key check (chave ~ '^[a-z0-9][a-z0-9_.-]*$'),
  nome text not null,
  grupo text not null default 'Geral',
  descricao text,
  -- liberado para quem o plano ainda não decidiu (recurso novo)
  padrao boolean not null default true,
  ordem int not null default 0,
  -- false quando saiu do código (a última sincronização não o trouxe)
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  visto_em timestamptz not null default now()
);

create table if not exists plano_recursos (
  plano_id uuid not null references planos(id) on delete cascade,
  recurso_chave text not null references recursos(chave) on delete cascade on update cascade,
  liberado boolean not null,
  primary key (plano_id, recurso_chave)
);

create table if not exists escritorio_recursos (
  escritorio_id uuid not null references escritorios(id) on delete cascade,
  recurso_chave text not null references recursos(chave) on delete cascade on update cascade,
  liberado boolean not null,
  motivo text,
  created_at timestamptz not null default now(),
  primary key (escritorio_id, recurso_chave)
);

-- ------------------------------------------------------------------ cadastro da empresa
alter table escritorios add column if not exists cnpj text;
alter table escritorios add column if not exists responsavel text;
alter table escritorios add column if not exists telefone text;
alter table escritorios add column if not exists email text;
alter table escritorios add column if not exists plano_id uuid references planos(id) on delete set null;
alter table escritorios add column if not exists status text not null default 'ativo';
alter table escritorios add column if not exists observacoes text;
alter table escritorios add column if not exists atualizado_em timestamptz not null default now();
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'escritorios_status_valido') then
    alter table escritorios add constraint escritorios_status_valido check (status in ('ativo', 'suspenso', 'cancelado'));
  end if;
end $$;
-- CNPJ só com dígitos; o mesmo CNPJ não vira duas empresas
create unique index if not exists escritorios_cnpj_unico on escritorios (cnpj) where cnpj is not null;

create table if not exists senhas_provisorias (
  user_id uuid primary key references auth.users(id) on delete cascade,
  definida_em timestamptz not null default now()
);
alter table senhas_provisorias enable row level security;
revoke all on senhas_provisorias from anon, authenticated;

create table if not exists saas_config (
  key text primary key,
  value text not null
);
-- Senha padrão inicial sorteada aqui (nunca fixa no repositório): o superadmin
-- vê e troca em Painel → Configurações. Letras + números, 14 caracteres.
insert into saas_config (key, value)
values ('senha_padrao', 'Vt' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10) || (floor(random() * 90) + 10)::int)
on conflict do nothing;

create table if not exists contatos_site (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(nome) between 2 and 120),
  empresa text check (length(empresa) <= 160),
  telefone text not null check (length(telefone) between 8 and 30),
  email text check (length(email) <= 160),
  cidade_uf text check (length(cidade_uf) <= 80),
  mensagem text check (length(mensagem) <= 2000),
  origem text check (length(origem) <= 80),
  status text not null default 'novo' check (status in ('novo', 'em_contato', 'reuniao', 'fechado', 'descartado')),
  created_at timestamptz not null default now()
);

alter table planos enable row level security;
alter table recursos enable row level security;
alter table plano_recursos enable row level security;
alter table escritorio_recursos enable row level security;
alter table saas_config enable row level security;
alter table contatos_site enable row level security;

-- ------------------------------------------------------------------ empresa ativa
-- Suspensa ou cancelada: escritorio_atual() devolve null e a RLS de todas as
-- tabelas (0020) passa a não mostrar nada. meu_escritorio() continua dizendo
-- qual é a empresa e o status, para a tela explicar o bloqueio.
create or replace function escritorio_atual()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select m.escritorio_id
    from membros_escritorio m join escritorios e on e.id = m.escritorio_id
   where m.user_id = auth.uid() and e.status = 'ativo'
$$;

drop function if exists meu_escritorio();
create or replace function meu_escritorio()
returns table (id uuid, nome text, papel text, modelos_compartilhados boolean, status text, plano text)
language sql stable security definer
set search_path = public
as $$
  select e.id, e.nome, m.papel, e.modelos_compartilhados, e.status, p.nome
    from membros_escritorio m
    join escritorios e on e.id = m.escritorio_id
    left join planos p on p.id = e.plano_id
   where m.user_id = auth.uid()
$$;

-- ------------------------------------------------------------------ recurso liberado
create or replace function recurso_liberado(p_escritorio uuid, p_chave text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select liberado from escritorio_recursos where escritorio_id = p_escritorio and recurso_chave = p_chave),
    (select pr.liberado from escritorios e join plano_recursos pr on pr.plano_id = e.plano_id
      where e.id = p_escritorio and pr.recurso_chave = p_chave),
    (select padrao from recursos where chave = p_chave),
    true
  )
$$;

-- Tudo o que a tela precisa saber na entrada, numa chamada só.
create or replace function minha_conta()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_esc uuid;
  v_out jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sessão ausente' using errcode = '42501';
  end if;
  select m.escritorio_id into v_esc from membros_escritorio m where m.user_id = auth.uid();
  select jsonb_build_object(
    'superadmin', sou_superadmin(),
    'trocar_senha', exists (select 1 from senhas_provisorias where user_id = auth.uid()),
    'recursos', coalesce((
      select jsonb_object_agg(r.chave, recurso_liberado(v_esc, r.chave))
        from recursos r where v_esc is not null
    ), '{}'::jsonb)
  ) into v_out;
  return v_out;
end $$;

-- A pessoa trocou a senha provisória (a troca em si é no Auth, pelo cliente).
create or replace function marcar_senha_trocada()
returns void
language sql security definer
set search_path = public
as $$
  delete from senhas_provisorias where user_id = auth.uid()
$$;

-- ------------------------------------------------------------------ trava no banco
-- A tela esconde a modalidade que o plano não libera; o banco recusa quem
-- tentar por fora. O serviço nasce como 'completo' (default do parse-txt) e a
-- tela carimba a modalidade escolhida logo depois, por isso o INSERT de um
-- 'completo' não é checado — a mudança para outra modalidade é.
create or replace function chave_recurso_do_servico(s servicos)
returns text
language sql immutable
as $$
  select case
    when s.tipo = 'pecas' then 'servico.pecas'
    when s.modalidade = 'conferencia' then 'servico.conferencia'
    when s.modalidade = 'loteamento' then 'servico.loteamento'
    when s.modalidade = 'car' then 'servico.car'
    when s.divisao is not null then 'servico.divisao'
    when s.tem_glebas then 'servico.gleba'
    else 'servico.completo'
  end
$$;

create or replace function validar_recurso_servico()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare v_chave text := chave_recurso_do_servico(new);
begin
  if tg_op = 'INSERT' and v_chave = 'servico.completo' then return new; end if;
  if tg_op = 'UPDATE' and v_chave = chave_recurso_do_servico(old) then return new; end if;
  if not recurso_liberado(new.escritorio_id, v_chave) then
    raise exception 'O plano da empresa não inclui este serviço (%)', v_chave using errcode = '42501';
  end if;
  return new;
end $$;

-- "zz": depois do preencher_escritorio e do z_validar_referencias
drop trigger if exists servicos_zz_validar_recurso on servicos;
create trigger servicos_zz_validar_recurso
  before insert or update of tipo, modalidade, tem_glebas, divisao on servicos
  for each row execute function validar_recurso_servico();

-- ------------------------------------------------------------------ policies
drop policy if exists planos_leitura on planos;
create policy planos_leitura on planos for select to authenticated using (true);
drop policy if exists planos_superadmin on planos;
create policy planos_superadmin on planos for all to authenticated using (sou_superadmin()) with check (sou_superadmin());

drop policy if exists recursos_leitura on recursos;
create policy recursos_leitura on recursos for select to authenticated using (true);
drop policy if exists recursos_superadmin on recursos;
create policy recursos_superadmin on recursos for all to authenticated using (sou_superadmin()) with check (sou_superadmin());

drop policy if exists plano_recursos_superadmin on plano_recursos;
create policy plano_recursos_superadmin on plano_recursos for all to authenticated using (sou_superadmin()) with check (sou_superadmin());
drop policy if exists escritorio_recursos_superadmin on escritorio_recursos;
create policy escritorio_recursos_superadmin on escritorio_recursos for all to authenticated using (sou_superadmin()) with check (sou_superadmin());
drop policy if exists saas_config_superadmin on saas_config;
create policy saas_config_superadmin on saas_config for all to authenticated using (sou_superadmin()) with check (sou_superadmin());

-- a página pública grava o pedido de reunião; só o superadmin lê
drop policy if exists contatos_site_insere on contatos_site;
create policy contatos_site_insere on contatos_site for insert to anon, authenticated with check (status = 'novo');
drop policy if exists contatos_site_superadmin on contatos_site;
create policy contatos_site_superadmin on contatos_site for all to authenticated using (sou_superadmin()) with check (sou_superadmin());
revoke update, delete on contatos_site from anon;
revoke select on contatos_site from anon;

-- o superadmin lê todas as empresas; escrever nelas só pelas RPCs sa_*
-- (a coluna-grant de update é por papel, e o dono também é `authenticated`)
drop policy if exists escritorios_superadmin on escritorios;
create policy escritorios_superadmin on escritorios for select to authenticated using (sou_superadmin());

-- ------------------------------------------------------------------ RPCs do superadmin
create or replace function exigir_superadmin()
returns void
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not sou_superadmin() then
    raise exception 'Acesso restrito ao administrador do sistema' using errcode = '42501';
  end if;
end $$;

-- O código manda o catálogo; o banco acompanha. Devolve quantos são novos.
create or replace function sa_sincronizar_recursos(p_itens jsonb)
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_novos int;
begin
  perform exigir_superadmin();
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Catálogo vazio' using errcode = '22023';
  end if;
  select count(*) into v_novos
    from jsonb_array_elements(p_itens) i
   where not exists (select 1 from recursos r where r.chave = i ->> 'chave');
  insert into recursos (chave, nome, grupo, descricao, padrao, ordem, ativo, visto_em)
  select i ->> 'chave', i ->> 'nome', coalesce(i ->> 'grupo', 'Geral'), i ->> 'descricao',
         coalesce((i ->> 'padrao')::boolean, true), coalesce((i ->> 'ordem')::int, 0), true, now()
    from jsonb_array_elements(p_itens) i
  on conflict (chave) do update
     set nome = excluded.nome, grupo = excluded.grupo, descricao = excluded.descricao,
         padrao = excluded.padrao, ordem = excluded.ordem, ativo = true, visto_em = now();
  -- o que saiu do código fica guardado (as decisões dos planos não se perdem), mas inativo
  update recursos set ativo = false
   where chave not in (select i ->> 'chave' from jsonb_array_elements(p_itens) i);
  return v_novos;
end $$;

create or replace function sa_empresas()
returns table (
  id uuid, nome text, cnpj text, responsavel text, telefone text, email text, status text,
  plano_id uuid, plano text, observacoes text, created_at timestamptz,
  usuarios int, servicos int, servicos_30d int, ultimo_servico timestamptz, ultimo_acesso timestamptz,
  excecoes int
)
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform exigir_superadmin();
  return query
  select e.id, e.nome, e.cnpj, e.responsavel, e.telefone, e.email, e.status,
         e.plano_id, p.nome, e.observacoes, e.created_at,
         (select count(*)::int from membros_escritorio m where m.escritorio_id = e.id),
         (select count(*)::int from servicos s where s.escritorio_id = e.id),
         (select count(*)::int from servicos s where s.escritorio_id = e.id and s.created_at > now() - interval '30 days'),
         (select max(s.created_at) from servicos s where s.escritorio_id = e.id),
         (select max(u.last_sign_in_at) from membros_escritorio m join auth.users u on u.id = m.user_id where m.escritorio_id = e.id),
         (select count(*)::int from escritorio_recursos x where x.escritorio_id = e.id)
    from escritorios e left join planos p on p.id = e.plano_id
   order by e.created_at desc;
end $$;

create or replace function sa_empresa_usuarios(p_escritorio uuid)
returns table (user_id uuid, email text, papel text, desde timestamptz, ultimo_acesso timestamptz, senha_provisoria boolean)
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform exigir_superadmin();
  return query
  select m.user_id, u.email::text, m.papel, m.created_at, u.last_sign_in_at,
         exists (select 1 from senhas_provisorias sp where sp.user_id = m.user_id)
    from membros_escritorio m join auth.users u on u.id = m.user_id
   where m.escritorio_id = p_escritorio
   order by m.papel = 'dono' desc, m.created_at;
end $$;

-- Uso por modalidade (serviços criados) de uma empresa ou de todas (null).
create or replace function sa_uso_modalidades(p_escritorio uuid default null, p_dias int default 30)
returns table (chave text, total int)
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform exigir_superadmin();
  return query
  select chave_recurso_do_servico(s), count(*)::int
    from servicos s
   where (p_escritorio is null or s.escritorio_id = p_escritorio)
     and s.created_at > now() - make_interval(days => p_dias)
   group by 1 order by 2 desc;
end $$;

-- Série diária de serviços criados (para o gráfico da visão geral).
create or replace function sa_serie_servicos(p_dias int default 30)
returns table (dia date, total int)
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform exigir_superadmin();
  return query
  select d::date, (select count(*)::int from servicos s where s.created_at::date = d::date)
    from generate_series(current_date - (p_dias - 1), current_date, interval '1 day') d
   order by 1;
end $$;

create or replace function sa_atualizar_empresa(p_escritorio uuid, p_dados jsonb)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform exigir_superadmin();
  if p_dados ? 'status' and p_dados ->> 'status' not in ('ativo', 'suspenso', 'cancelado') then
    raise exception 'Status inválido' using errcode = '22023';
  end if;
  update escritorios set
    nome = case when p_dados ? 'nome' then nullif(trim(p_dados ->> 'nome'), '') else nome end,
    cnpj = case when p_dados ? 'cnpj' then nullif(regexp_replace(p_dados ->> 'cnpj', '\D', '', 'g'), '') else cnpj end,
    responsavel = case when p_dados ? 'responsavel' then nullif(trim(p_dados ->> 'responsavel'), '') else responsavel end,
    telefone = case when p_dados ? 'telefone' then nullif(regexp_replace(p_dados ->> 'telefone', '\D', '', 'g'), '') else telefone end,
    email = case when p_dados ? 'email' then nullif(lower(trim(p_dados ->> 'email')), '') else email end,
    plano_id = case when p_dados ? 'plano_id' then nullif(p_dados ->> 'plano_id', '')::uuid else plano_id end,
    status = case when p_dados ? 'status' then p_dados ->> 'status' else status end,
    observacoes = case when p_dados ? 'observacoes' then nullif(trim(p_dados ->> 'observacoes'), '') else observacoes end,
    atualizado_em = now()
  where id = p_escritorio;
  if not found then raise exception 'Empresa não encontrada' using errcode = 'P0002'; end if;
end $$;

-- Exceção de um recurso para uma empresa. p_liberado null = volta a seguir o plano.
create or replace function sa_definir_recurso_empresa(p_escritorio uuid, p_chave text, p_liberado boolean, p_motivo text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform exigir_superadmin();
  if p_liberado is null then
    delete from escritorio_recursos where escritorio_id = p_escritorio and recurso_chave = p_chave;
  else
    insert into escritorio_recursos (escritorio_id, recurso_chave, liberado, motivo)
    values (p_escritorio, p_chave, p_liberado, nullif(trim(p_motivo), ''))
    on conflict (escritorio_id, recurso_chave) do update set liberado = excluded.liberado, motivo = excluded.motivo, created_at = now();
  end if;
end $$;

-- Recursos de uma empresa com a origem de cada decisão (para a aba Recursos).
create or replace function sa_recursos_empresa(p_escritorio uuid)
returns table (chave text, liberado boolean, origem text, excecao boolean)
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform exigir_superadmin();
  return query
  select r.chave, recurso_liberado(p_escritorio, r.chave),
         case
           when x.liberado is not null then 'excecao'
           when pr.liberado is not null then 'plano'
           else 'padrao'
         end,
         x.liberado
    from recursos r
    left join escritorio_recursos x on x.escritorio_id = p_escritorio and x.recurso_chave = r.chave
    left join escritorios e on e.id = p_escritorio
    left join plano_recursos pr on pr.plano_id = e.plano_id and pr.recurso_chave = r.chave
   where r.ativo
   order by r.ordem, r.chave;
end $$;

-- ------------------------------------------------------------------ catálogo inicial e planos
-- O mesmo catálogo de src/lib/recursos.ts (o painel sincroniza ao abrir; isto
-- só garante que os planos de partida possam apontar para as chaves).
insert into recursos (chave, nome, grupo, ordem) values
  ('servico.completo',    'Serviço completo',             'Serviços', 10),
  ('servico.conferencia', 'Conferência de área',          'Serviços', 20),
  ('servico.gleba',       'Serviço com gleba',            'Serviços', 30),
  ('servico.divisao',     'Divisão em partes iguais',     'Serviços', 40),
  ('servico.loteamento',  'Loteamento',                   'Serviços', 50),
  ('servico.car',         'CAR',                          'Serviços', 60),
  ('servico.pecas',       'Peças a partir do PDF do SIGEF','Serviços', 70)
on conflict (chave) do nothing;

do $$
declare v_ess uuid; v_pro uuid; v_comp uuid;
begin
  if not exists (select 1 from planos) then
    insert into planos (nome, descricao, cor, ordem) values
      ('Essencial', 'Georreferenciamento do levantamento à certificação.', '#5B6B63', 10) returning id into v_ess;
    insert into planos (nome, descricao, cor, ordem) values
      ('Profissional', 'Tudo do Essencial, mais glebas, partilha e CAR.', '#178552', 20) returning id into v_pro;
    insert into planos (nome, descricao, cor, ordem) values
      ('Completo', 'Todos os recursos, inclusive loteamento e maquete 3D.', '#0E3B2B', 30) returning id into v_comp;

    insert into plano_recursos (plano_id, recurso_chave, liberado)
    select v_ess, chave, chave in ('servico.completo', 'servico.conferencia', 'servico.pecas') from recursos;
    insert into plano_recursos (plano_id, recurso_chave, liberado)
    select v_pro, chave, chave <> 'servico.loteamento' from recursos;
    insert into plano_recursos (plano_id, recurso_chave, liberado)
    select v_comp, chave, true from recursos;

    -- a empresa que já usa o sistema fica com tudo
    update escritorios set plano_id = v_comp where modelos_compartilhados and plano_id is null;
  end if;
end $$;

-- ------------------------------------------------------------------ permissões das funções
revoke execute on function sou_superadmin() from public, anon;
revoke execute on function recurso_liberado(uuid, text) from public, anon;
revoke execute on function minha_conta() from public, anon;
revoke execute on function marcar_senha_trocada() from public, anon;
revoke execute on function meu_escritorio() from public, anon;
revoke execute on function exigir_superadmin() from public, anon;
revoke execute on function validar_recurso_servico() from public, anon, authenticated;
revoke execute on function sa_sincronizar_recursos(jsonb) from public, anon;
revoke execute on function sa_empresas() from public, anon;
revoke execute on function sa_empresa_usuarios(uuid) from public, anon;
revoke execute on function sa_uso_modalidades(uuid, int) from public, anon;
revoke execute on function sa_serie_servicos(int) from public, anon;
revoke execute on function sa_atualizar_empresa(uuid, jsonb) from public, anon;
revoke execute on function sa_definir_recurso_empresa(uuid, text, boolean, text) from public, anon;
revoke execute on function sa_recursos_empresa(uuid) from public, anon;
grant execute on function sou_superadmin() to authenticated, service_role;
grant execute on function recurso_liberado(uuid, text) to authenticated, service_role;
grant execute on function minha_conta() to authenticated;
grant execute on function marcar_senha_trocada() to authenticated;
grant execute on function meu_escritorio() to authenticated;
grant execute on function exigir_superadmin() to authenticated;
grant execute on function sa_sincronizar_recursos(jsonb) to authenticated;
grant execute on function sa_empresas() to authenticated;
grant execute on function sa_empresa_usuarios(uuid) to authenticated;
grant execute on function sa_uso_modalidades(uuid, int) to authenticated;
grant execute on function sa_serie_servicos(int) to authenticated;
grant execute on function sa_atualizar_empresa(uuid, jsonb) to authenticated;
grant execute on function sa_definir_recurso_empresa(uuid, text, boolean, text) to authenticated;
grant execute on function sa_recursos_empresa(uuid) to authenticated;
