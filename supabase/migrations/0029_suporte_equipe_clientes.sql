-- Suporte, equipe e clientes mais completos, e auditoria de uso. Depende da 0020
-- (escritórios), 0024 (SaaS/superadmin), 0025 (equipe), 0026 (auditoria) e 0028.
--
--   membros_escritorio  + descricao, telefone (o que a pessoa faz; contato)
--   clientes            + qualificação completa (PF/PJ, RG, estado civil,
--                         profissão, cônjuge, endereço com cidade/UF/CEP,
--                         representante da PJ, segundo telefone, origem)
--   acessos             — sessões de uso: quem entrou, quando, de onde (IP e
--                         navegador), até quando ficou e quantas telas abriu
--   chamados            — central de suporte: a empresa abre pelo chat do
--   chamado_mensagens     sistema, o superadmin responde no painel; anexos no
--                         bucket privado `suporte`
--   tutoriais           — vídeos de ajuda por módulo (o superadmin cadastra)
--
-- O que é da empresa passa por escritorio_atual(); o que é do suporte, por
-- sou_superadmin(). Escrita em chamados só pelas RPCs (security definer).
--
-- Teste local: `npm run test:rls` (tests/rls/suporte.sql).

-- ------------------------------------------------------------------ equipe
alter table membros_escritorio add column if not exists descricao text;
alter table membros_escritorio add column if not exists telefone text;

-- sessões de uso (ver "acessos" abaixo): criada aqui porque listar_membros já lê
create table if not exists acessos (
  id bigint generated always as identity primary key,
  escritorio_id uuid references escritorios(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  em timestamptz not null default now(),
  ultimo_em timestamptz not null default now(),
  ip text,
  navegador text,
  sistema text,
  dispositivo text,
  telas int not null default 1,
  ultima_tela text
);
create index if not exists acessos_escritorio_data on acessos (escritorio_id, em desc);
create index if not exists acessos_user_data on acessos (user_id, ultimo_em desc);
alter table acessos enable row level security;
revoke insert, update, delete on acessos from anon, authenticated;

drop function if exists listar_membros();
create or replace function listar_membros()
returns table (user_id uuid, email text, nome text, cargo text, papel text, permissoes text[], ativo boolean,
               desde timestamptz, ultimo_acesso timestamptz, senha_provisoria boolean,
               descricao text, telefone text)
language sql stable security definer
set search_path = public
as $$
  select m.user_id, u.email::text, m.nome, m.cargo, m.papel, m.permissoes, m.ativo, m.created_at,
         greatest(u.last_sign_in_at, (select max(a.ultimo_em) from acessos a where a.user_id = m.user_id)),
         exists (select 1 from senhas_provisorias sp where sp.user_id = m.user_id),
         m.descricao, m.telefone
    from membros_escritorio m join auth.users u on u.id = m.user_id
   where m.escritorio_id = escritorio_atual()
   order by m.papel = 'dono' desc, m.ativo desc, coalesce(m.nome, u.email::text)
$$;

-- A mesma regra da 0025, agora com descrição e telefone (parâmetros opcionais:
-- quem chama com os cinco de antes continua funcionando).
drop function if exists definir_membro(uuid, text, text, text[], boolean);
create or replace function definir_membro(p_user uuid, p_nome text, p_cargo text, p_permissoes text[], p_ativo boolean,
                                          p_descricao text default null, p_telefone text default null)
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
    descricao = case when p_descricao is null then descricao else nullif(left(trim(p_descricao), 500), '') end,
    telefone = case when p_telefone is null then telefone else nullif(left(trim(p_telefone), 30), '') end,
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

-- Minha conta: qualquer pessoa da equipe corrige o próprio nome e telefone.
create or replace function atualizar_meu_perfil(p_nome text, p_telefone text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_esc uuid := escritorio_atual();
begin
  if v_esc is null then raise exception 'Sua conta não está ligada a uma empresa ativa' using errcode = '42501'; end if;
  if length(trim(coalesce(p_nome, ''))) < 2 then raise exception 'Informe o seu nome' using errcode = '22023'; end if;
  update membros_escritorio set
    nome = left(trim(p_nome), 120),
    telefone = nullif(left(trim(coalesce(p_telefone, '')), 30), ''),
    atualizado_em = now()
  where user_id = auth.uid() and escritorio_id = v_esc;
end $$;

-- ------------------------------------------------------------------ clientes
alter table clientes add column if not exists tipo_pessoa text check (tipo_pessoa is null or tipo_pessoa in ('PF', 'PJ'));
alter table clientes add column if not exists rg text;
alter table clientes add column if not exists rg_orgao text;
alter table clientes add column if not exists data_nascimento date;
alter table clientes add column if not exists nacionalidade text;
alter table clientes add column if not exists estado_civil text;
alter table clientes add column if not exists regime_bens text;
alter table clientes add column if not exists profissao text;
alter table clientes add column if not exists conjuge_nome text;
alter table clientes add column if not exists conjuge_cpf text;
alter table clientes add column if not exists telefone2 text;
alter table clientes add column if not exists cep text;
alter table clientes add column if not exists cidade text;
alter table clientes add column if not exists uf text;
alter table clientes add column if not exists representante_nome text;
alter table clientes add column if not exists representante_cpf text;
alter table clientes add column if not exists origem text;

-- Linha do tempo do cliente, para quem é da empresa (não só quem gerencia a
-- equipe): o cadastro dele e tudo o que aconteceu nos serviços dele.
create or replace function historico_cliente(p_cliente uuid, p_limite int default 80)
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
   where a.escritorio_id = escritorio_atual()
     and exists (select 1 from clientes c where c.id = p_cliente and c.escritorio_id = escritorio_atual())
     and (a.ref_id = p_cliente
          or a.servico_id in (select s.id from servicos s where s.cliente_id = p_cliente))
   order by a.created_at desc limit greatest(1, least(p_limite, 300))
$$;

-- ------------------------------------------------------------------ acessos (uso do sistema)
-- Uma linha por sessão: o app chama registrar_acesso() ao abrir e de tempos em
-- tempos enquanto está aberto. Mesmo navegador e IP em menos de 30 min = a
-- mesma sessão (só estende `ultimo_em` e soma as telas).

-- IP de quem chama, pelos cabeçalhos que o PostgREST repassa (o primeiro do
-- x-forwarded-for é o do navegador). Fora do PostgREST, null.
create or replace function ip_da_requisicao()
returns text
language plpgsql stable
set search_path = public
as $$
declare h jsonb;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    return null;
  end;
  if h is null then return null; end if;
  return nullif(left(trim(split_part(coalesce(h ->> 'cf-connecting-ip', h ->> 'x-real-ip', h ->> 'x-forwarded-for', ''), ',', 1)), 64), '');
end $$;

create or replace function registrar_acesso(p_navegador text default null, p_sistema text default null,
                                            p_dispositivo text default null, p_tela text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_ip text := ip_da_requisicao();
  v_id bigint;
begin
  if v_user is null then return; end if;
  select a.id into v_id from acessos a
   where a.user_id = v_user and a.ultimo_em > now() - interval '30 minutes'
     and a.ip is not distinct from v_ip and a.navegador is not distinct from left(p_navegador, 60)
   order by a.ultimo_em desc limit 1;
  if v_id is not null then
    update acessos set ultimo_em = now(), telas = telas + 1,
           ultima_tela = coalesce(left(p_tela, 80), ultima_tela)
     where id = v_id;
    return;
  end if;
  insert into acessos (escritorio_id, user_id, ip, navegador, sistema, dispositivo, ultima_tela)
  values ((select m.escritorio_id from membros_escritorio m where m.user_id = v_user limit 1), v_user, v_ip,
          left(p_navegador, 60), left(p_sistema, 60), left(p_dispositivo, 20), left(p_tela, 80));
end $$;

create or replace function listar_acessos(p_limite int default 100, p_user uuid default null, p_antes timestamptz default null)
returns table (id bigint, user_id uuid, quem text, em timestamptz, ultimo_em timestamptz, ip text,
               navegador text, sistema text, dispositivo text, telas int, ultima_tela text)
language sql stable security definer
set search_path = public
as $$
  select a.id, a.user_id, coalesce(nullif(m.nome, ''), u.email::text), a.em, a.ultimo_em, a.ip,
         a.navegador, a.sistema, a.dispositivo, a.telas, a.ultima_tela
    from acessos a
    left join auth.users u on u.id = a.user_id
    left join membros_escritorio m on m.user_id = a.user_id and m.escritorio_id = a.escritorio_id
   where a.escritorio_id = escritorio_atual() and tem_permissao('equipe.gerenciar')
     and (p_user is null or a.user_id = p_user)
     and (p_antes is null or a.em < p_antes)
   order by a.em desc limit greatest(1, least(p_limite, 500))
$$;

-- Uso por pessoa num período: sessões, tempo aproximado e o que produziu.
create or replace function uso_da_equipe(p_dias int default 30)
returns table (user_id uuid, nome text, email text, ativo boolean, sessoes int, minutos int, ultimo_acesso timestamptz,
               servicos_criados int, documentos int, alteracoes int, clientes int)
language sql stable security definer
set search_path = public
as $$
  with periodo as (select now() - make_interval(days => greatest(1, least(coalesce(p_dias, 30), 365))) as desde)
  select m.user_id, coalesce(nullif(m.nome, ''), u.email::text), u.email::text, m.ativo,
         (select count(*)::int from acessos a, periodo p where a.user_id = m.user_id and a.escritorio_id = m.escritorio_id and a.em >= p.desde),
         (select coalesce(sum(greatest(1, extract(epoch from (a.ultimo_em - a.em)) / 60)), 0)::int
            from acessos a, periodo p where a.user_id = m.user_id and a.escritorio_id = m.escritorio_id and a.em >= p.desde),
         greatest(u.last_sign_in_at, (select max(a.ultimo_em) from acessos a where a.user_id = m.user_id)),
         (select count(*)::int from atividades t, periodo p where t.user_id = m.user_id and t.escritorio_id = m.escritorio_id
            and t.created_at >= p.desde and t.acao = 'servico.criado'),
         (select count(*)::int from atividades t, periodo p where t.user_id = m.user_id and t.escritorio_id = m.escritorio_id
            and t.created_at >= p.desde and t.acao = 'documento.gerado'),
         (select coalesce(sum(t.vezes), 0)::int from atividades t, periodo p where t.user_id = m.user_id and t.escritorio_id = m.escritorio_id
            and t.created_at >= p.desde and t.acao like '%.alterad%'),
         (select count(*)::int from atividades t, periodo p where t.user_id = m.user_id and t.escritorio_id = m.escritorio_id
            and t.created_at >= p.desde and t.acao = 'cliente.criado')
    from membros_escritorio m join auth.users u on u.id = m.user_id
   where m.escritorio_id = escritorio_atual() and tem_permissao('equipe.gerenciar')
   order by m.papel = 'dono' desc, m.ativo desc, coalesce(m.nome, u.email::text)
$$;

-- superadmin: as sessões de uma empresa
create or replace function sa_acessos(p_escritorio uuid, p_limite int default 100)
returns table (id bigint, user_id uuid, quem text, em timestamptz, ultimo_em timestamptz, ip text,
               navegador text, sistema text, dispositivo text, telas int, ultima_tela text)
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform exigir_superadmin();
  return query
  select a.id, a.user_id, coalesce(nullif(m.nome, ''), u.email::text), a.em, a.ultimo_em, a.ip,
         a.navegador, a.sistema, a.dispositivo, a.telas, a.ultima_tela
    from acessos a
    left join auth.users u on u.id = a.user_id
    left join membros_escritorio m on m.user_id = a.user_id and m.escritorio_id = a.escritorio_id
   where a.escritorio_id = p_escritorio
   order by a.em desc limit greatest(1, least(p_limite, 500));
end $$;

-- ------------------------------------------------------------------ suporte
create table if not exists chamados (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated always as identity,
  escritorio_id uuid not null references escritorios(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  assunto text not null,
  categoria text not null default 'duvida' check (categoria in ('duvida', 'erro', 'sugestao', 'financeiro', 'acesso', 'outro')),
  prioridade text not null default 'normal' check (prioridade in ('baixa', 'normal', 'alta', 'urgente')),
  status text not null default 'aberto' check (status in ('aberto', 'em_atendimento', 'aguardando_cliente', 'resolvido')),
  contexto jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  ultima_mensagem_em timestamptz not null default now(),
  ultima_mensagem_de text not null default 'cliente' check (ultima_mensagem_de in ('cliente', 'suporte')),
  lido_cliente_em timestamptz not null default now(),
  lido_suporte_em timestamptz,
  primeira_resposta_em timestamptz,
  resolvido_em timestamptz,
  avaliacao int check (avaliacao is null or avaliacao between 1 and 5),
  avaliacao_comentario text
);
create unique index if not exists chamados_numero on chamados (numero);
create index if not exists chamados_escritorio on chamados (escritorio_id, ultima_mensagem_em desc);
create index if not exists chamados_status on chamados (status, ultima_mensagem_em desc);

create table if not exists chamado_mensagens (
  id bigint generated always as identity primary key,
  chamado_id uuid not null references chamados(id) on delete cascade,
  autor_id uuid references auth.users(id) on delete set null,
  autor_tipo text not null check (autor_tipo in ('cliente', 'suporte', 'sistema')),
  texto text not null default '',
  anexos jsonb not null default '[]'::jsonb,
  interna boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists chamado_mensagens_chamado on chamado_mensagens (chamado_id, created_at);

alter table chamados enable row level security;
alter table chamado_mensagens enable row level security;
revoke insert, update, delete on chamados, chamado_mensagens from anon, authenticated;

-- quem abriu vê o seu; quem gerencia a equipe vê os da empresa; o suporte vê tudo
create or replace function posso_ver_chamado(p_chamado uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select sou_superadmin() or exists (
    select 1 from chamados c
     where c.id = p_chamado and c.escritorio_id = escritorio_atual()
       and (c.user_id = auth.uid() or tem_permissao('equipe.gerenciar')))
$$;

drop policy if exists chamados_leitura on chamados;
create policy chamados_leitura on chamados for select to authenticated
  using (sou_superadmin() or (escritorio_id = escritorio_atual() and (user_id = auth.uid() or tem_permissao('equipe.gerenciar'))));
drop policy if exists chamado_mensagens_leitura on chamado_mensagens;
create policy chamado_mensagens_leitura on chamado_mensagens for select to authenticated
  using (posso_ver_chamado(chamado_id) and (not interna or sou_superadmin()));

-- anexos: a primeira pasta é o escritório (o suporte grava na pasta da empresa)
insert into storage.buckets (id, name, public) values ('suporte', 'suporte', false) on conflict (id) do nothing;
drop policy if exists suporte_ler on storage.objects;
create policy suporte_ler on storage.objects for select to authenticated
  using (bucket_id = 'suporte' and (sou_superadmin() or (storage.foldername(name))[1] = escritorio_atual()::text));
drop policy if exists suporte_enviar on storage.objects;
create policy suporte_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'suporte' and (sou_superadmin() or (storage.foldername(name))[1] = escritorio_atual()::text));

-- anexos aceitos: [{path, nome, tipo, tamanho}], só da pasta da empresa do chamado
create or replace function anexos_validos(p_escritorio uuid, p_anexos jsonb)
returns jsonb
language sql immutable
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'path', x ->> 'path', 'nome', left(coalesce(x ->> 'nome', 'arquivo'), 120),
           'tipo', left(coalesce(x ->> 'tipo', ''), 80), 'tamanho', coalesce((x ->> 'tamanho')::bigint, 0))), '[]'::jsonb)
    from jsonb_array_elements(case when jsonb_typeof(p_anexos) = 'array' then p_anexos else '[]'::jsonb end) x
   where split_part(x ->> 'path', '/', 1) = p_escritorio::text
$$;

create or replace function abrir_chamado(p_assunto text, p_texto text, p_categoria text default 'duvida',
                                         p_prioridade text default 'normal', p_anexos jsonb default '[]'::jsonb,
                                         p_contexto jsonb default '{}'::jsonb)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v_esc uuid := escritorio_atual(); v_id uuid;
begin
  if v_esc is null then raise exception 'Sua conta não está ligada a uma empresa ativa' using errcode = '42501'; end if;
  if length(trim(coalesce(p_assunto, ''))) < 3 then raise exception 'Escreva o assunto do chamado' using errcode = '22023'; end if;
  if length(trim(coalesce(p_texto, ''))) < 3 then raise exception 'Conte o que aconteceu' using errcode = '22023'; end if;
  insert into chamados (escritorio_id, user_id, assunto, categoria, prioridade, contexto)
  values (v_esc, auth.uid(), left(trim(p_assunto), 140),
          case when p_categoria in ('duvida', 'erro', 'sugestao', 'financeiro', 'acesso', 'outro') then p_categoria else 'outro' end,
          case when p_prioridade in ('baixa', 'normal', 'alta', 'urgente') then p_prioridade else 'normal' end,
          coalesce(p_contexto, '{}'::jsonb) || jsonb_build_object('ip', ip_da_requisicao()))
  returning id into v_id;
  insert into chamado_mensagens (chamado_id, autor_id, autor_tipo, texto, anexos)
  values (v_id, auth.uid(), 'cliente', left(trim(p_texto), 8000), anexos_validos(v_esc, p_anexos));
  return v_id;
end $$;

-- resposta da empresa: reabre o chamado que estava resolvido ou aguardando
create or replace function responder_chamado(p_chamado uuid, p_texto text, p_anexos jsonb default '[]'::jsonb)
returns void
language plpgsql security definer
set search_path = public
as $$
declare c chamados;
begin
  select * into c from chamados where id = p_chamado;
  if not found or c.escritorio_id is distinct from escritorio_atual()
     or not (c.user_id = auth.uid() or tem_permissao('equipe.gerenciar')) then
    raise exception 'Chamado não encontrado' using errcode = 'P0002';
  end if;
  if length(trim(coalesce(p_texto, ''))) = 0 and jsonb_array_length(anexos_validos(c.escritorio_id, p_anexos)) = 0 then
    raise exception 'Escreva a mensagem' using errcode = '22023';
  end if;
  insert into chamado_mensagens (chamado_id, autor_id, autor_tipo, texto, anexos)
  values (p_chamado, auth.uid(), 'cliente', left(trim(coalesce(p_texto, '')), 8000), anexos_validos(c.escritorio_id, p_anexos));
  update chamados set
    status = case when status in ('resolvido', 'aguardando_cliente') then 'aberto' else status end,
    resolvido_em = case when status = 'resolvido' then null else resolvido_em end,
    ultima_mensagem_em = now(), ultima_mensagem_de = 'cliente', lido_cliente_em = now(), atualizado_em = now()
  where id = p_chamado;
end $$;

create or replace function marcar_chamado_lido(p_chamado uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if sou_superadmin() and not exists (select 1 from chamados where id = p_chamado and escritorio_id = escritorio_atual()) then
    update chamados set lido_suporte_em = now() where id = p_chamado;
  elsif posso_ver_chamado(p_chamado) then
    update chamados set lido_cliente_em = now() where id = p_chamado and escritorio_id = escritorio_atual();
  end if;
end $$;

-- a empresa encerra (resolvido) e pode dar uma nota ao atendimento
create or replace function encerrar_chamado(p_chamado uuid, p_nota int default null, p_comentario text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_status text;
begin
  select c.status into v_status from chamados c where c.id = p_chamado and c.escritorio_id = escritorio_atual()
     and (c.user_id = auth.uid() or tem_permissao('equipe.gerenciar'));
  if not found then raise exception 'Chamado não encontrado' using errcode = 'P0002'; end if;
  update chamados set status = 'resolvido', resolvido_em = coalesce(resolvido_em, now()), atualizado_em = now(),
         avaliacao = case when p_nota between 1 and 5 then p_nota else avaliacao end,
         avaliacao_comentario = coalesce(nullif(left(trim(coalesce(p_comentario, '')), 1000), ''), avaliacao_comentario)
   where id = p_chamado;
  -- avaliar um chamado que o suporte já resolveu não repete o aviso
  if v_status <> 'resolvido' then
    insert into chamado_mensagens (chamado_id, autor_id, autor_tipo, texto)
    values (p_chamado, auth.uid(), 'sistema', 'Chamado encerrado pela empresa.');
  end if;
end $$;

-- os chamados da pessoa (ou da empresa, para quem gerencia), com não lidas
create or replace function meus_chamados()
returns table (id uuid, numero bigint, assunto text, categoria text, prioridade text, status text,
               criado_em timestamptz, ultima_mensagem_em timestamptz, ultima_mensagem_de text,
               nao_lidas int, autor text, meu boolean, avaliacao int, previa text)
language sql stable security definer
set search_path = public
as $$
  select c.id, c.numero, c.assunto, c.categoria, c.prioridade, c.status, c.criado_em, c.ultima_mensagem_em,
         c.ultima_mensagem_de,
         (select count(*)::int from chamado_mensagens x where x.chamado_id = c.id and x.autor_tipo = 'suporte'
             and not x.interna and x.created_at > c.lido_cliente_em),
         coalesce(nullif(m.nome, ''), u.email::text, '—'), c.user_id = auth.uid(), c.avaliacao,
         (select left(x.texto, 140) from chamado_mensagens x where x.chamado_id = c.id and not x.interna
           order by x.created_at desc limit 1)
    from chamados c
    left join auth.users u on u.id = c.user_id
    left join membros_escritorio m on m.user_id = c.user_id and m.escritorio_id = c.escritorio_id
   where c.escritorio_id = escritorio_atual() and (c.user_id = auth.uid() or tem_permissao('equipe.gerenciar'))
   order by c.status = 'resolvido', c.ultima_mensagem_em desc
$$;

-- ---------------- lado do suporte (superadmin)
create or replace function sa_chamados()
returns table (id uuid, numero bigint, escritorio_id uuid, empresa text, plano text, autor text, autor_email text,
               assunto text, categoria text, prioridade text, status text, criado_em timestamptz,
               ultima_mensagem_em timestamptz, ultima_mensagem_de text, nao_lidas int,
               primeira_resposta_em timestamptz, resolvido_em timestamptz, avaliacao int, avaliacao_comentario text,
               mensagens int, contexto jsonb, previa text)
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform exigir_superadmin();
  return query
  select c.id, c.numero, c.escritorio_id, e.nome, p.nome, coalesce(nullif(m.nome, ''), u.email::text, '—'), u.email::text,
         c.assunto, c.categoria, c.prioridade, c.status, c.criado_em, c.ultima_mensagem_em, c.ultima_mensagem_de,
         (select count(*)::int from chamado_mensagens x where x.chamado_id = c.id and x.autor_tipo = 'cliente'
             and x.created_at > coalesce(c.lido_suporte_em, '-infinity'::timestamptz)),
         c.primeira_resposta_em, c.resolvido_em, c.avaliacao, c.avaliacao_comentario,
         (select count(*)::int from chamado_mensagens x where x.chamado_id = c.id and x.autor_tipo <> 'sistema'),
         c.contexto,
         (select left(x.texto, 160) from chamado_mensagens x where x.chamado_id = c.id and x.autor_tipo <> 'sistema'
           order by x.created_at desc limit 1)
    from chamados c
    join escritorios e on e.id = c.escritorio_id
    left join planos p on p.id = e.plano_id
    left join auth.users u on u.id = c.user_id
    left join membros_escritorio m on m.user_id = c.user_id and m.escritorio_id = c.escritorio_id
   order by c.ultima_mensagem_em desc;
end $$;

-- resposta do suporte; `p_interna` = nota que só o suporte vê.
-- `p_status` opcional: sem ele, responder põe o chamado "aguardando a empresa".
create or replace function sa_responder_chamado(p_chamado uuid, p_texto text, p_anexos jsonb default '[]'::jsonb,
                                                p_interna boolean default false, p_status text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare c chamados;
begin
  perform exigir_superadmin();
  select * into c from chamados where id = p_chamado;
  if not found then raise exception 'Chamado não encontrado' using errcode = 'P0002'; end if;
  if length(trim(coalesce(p_texto, ''))) = 0 and jsonb_array_length(anexos_validos(c.escritorio_id, p_anexos)) = 0 then
    raise exception 'Escreva a resposta' using errcode = '22023';
  end if;
  insert into chamado_mensagens (chamado_id, autor_id, autor_tipo, texto, anexos, interna)
  values (p_chamado, auth.uid(), 'suporte', left(trim(coalesce(p_texto, '')), 8000), anexos_validos(c.escritorio_id, p_anexos),
          coalesce(p_interna, false));
  if coalesce(p_interna, false) then
    update chamados set lido_suporte_em = now() where id = p_chamado;
    return;
  end if;
  update chamados set
    status = case when p_status in ('aberto', 'em_atendimento', 'aguardando_cliente', 'resolvido') then p_status else 'aguardando_cliente' end,
    resolvido_em = case when p_status = 'resolvido' then coalesce(resolvido_em, now()) else null end,
    primeira_resposta_em = coalesce(primeira_resposta_em, now()),
    ultima_mensagem_em = now(), ultima_mensagem_de = 'suporte', lido_suporte_em = now(), atualizado_em = now()
  where id = p_chamado;
end $$;

create or replace function sa_atualizar_chamado(p_chamado uuid, p_status text default null, p_prioridade text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare c chamados;
begin
  perform exigir_superadmin();
  select * into c from chamados where id = p_chamado;
  if not found then raise exception 'Chamado não encontrado' using errcode = 'P0002'; end if;
  update chamados set
    status = case when p_status in ('aberto', 'em_atendimento', 'aguardando_cliente', 'resolvido') then p_status else status end,
    prioridade = case when p_prioridade in ('baixa', 'normal', 'alta', 'urgente') then p_prioridade else prioridade end,
    resolvido_em = case when p_status = 'resolvido' then coalesce(resolvido_em, now())
                        when p_status is not null then null else resolvido_em end,
    atualizado_em = now()
  where id = p_chamado;
  if p_status is not null and p_status is distinct from c.status then
    insert into chamado_mensagens (chamado_id, autor_id, autor_tipo, texto)
    values (p_chamado, auth.uid(), 'sistema', case p_status
      when 'em_atendimento' then 'O suporte começou o atendimento.'
      when 'aguardando_cliente' then 'O suporte aguarda a resposta da empresa.'
      when 'resolvido' then 'O suporte marcou o chamado como resolvido.'
      else 'Chamado reaberto.' end);
  end if;
end $$;

-- números do painel: o que espera o suporte (badge do menu)
create or replace function sa_contagem_suporte()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform exigir_superadmin();
  return jsonb_build_object(
    'esperando', (select count(*) from chamados where status in ('aberto', 'em_atendimento') and ultima_mensagem_de = 'cliente'),
    'abertos', (select count(*) from chamados where status <> 'resolvido'),
    'nao_lidas', (select count(*) from chamado_mensagens x join chamados c on c.id = x.chamado_id
                   where x.autor_tipo = 'cliente' and x.created_at > coalesce(c.lido_suporte_em, '-infinity'::timestamptz)));
end $$;

-- ------------------------------------------------------------------ tutoriais
create table if not exists tutoriais (
  id uuid primary key default gen_random_uuid(),
  modulo text not null,
  titulo text not null,
  descricao text,
  video_url text,
  duracao text,
  ordem int not null default 0,
  publicado boolean not null default false,
  created_at timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table tutoriais enable row level security;
drop policy if exists tutoriais_leitura on tutoriais;
create policy tutoriais_leitura on tutoriais for select to authenticated using (publicado or sou_superadmin());
drop policy if exists tutoriais_superadmin on tutoriais;
create policy tutoriais_superadmin on tutoriais for all to authenticated using (sou_superadmin()) with check (sou_superadmin());

-- A trilha de vídeos a gravar (docs/tutoriais/roteiro-videos.md), como rascunho:
-- o superadmin cola o link de cada vídeo e publica. Só na primeira vez.
insert into tutoriais (modulo, titulo, descricao, duracao, ordem, publicado)
select v.modulo, v.titulo, v.descricao, v.duracao, v.ordem, false
  from (values
    ('inicio', 'Conheça o Vertces em 3 minutos', 'O Início, a barra lateral, onde ficam serviços, clientes, equipe e configurações.', '3:00', 1),
    ('inicio', 'Primeiro acesso: senha, perfil e dados da empresa', 'Criar a senha, completar o perfil, enviar a logo e preencher a empresa.', '4:00', 2),
    ('servicos', 'Serviço completo: do TXT do GNSS à conferência', 'Enviar o TXT, escolher o fuso, conferir vértices, área e perímetro.', '6:00', 1),
    ('servicos', 'Confrontantes por trecho', 'Vizinhos, estradas e rios; confrontante numerado; quem aparece na planta.', '5:00', 2),
    ('servicos', 'Dados do serviço, detentor e registro', 'Detentor pelo cliente, matrícula ou posse, RT e credenciado.', '4:00', 3),
    ('servicos', 'Confrontar com área certificada', 'Trazer o CSV do vizinho certificado e unir os vértices.', '4:00', 4),
    ('servicos', 'Mapa do SIGEF e correção de sobreposição', 'Ver as parcelas vizinhas e corrigir a sobreposição com vértices certificados.', '5:00', 5),
    ('documentos', 'Gerar memorial, planilha do SIGEF e planta', 'Uma geração, todos os documentos; versões guardadas no histórico.', '5:00', 1),
    ('documentos', 'Editor de planta', 'Mover rótulos, carimbo e legenda sem perder o desenho técnico.', '4:00', 2),
    ('documentos', 'Peças técnicas e peças a partir do PDF do SIGEF', 'Requerimento, declarações e cartas de anuência por confrontante.', '5:00', 3),
    ('documentos', 'Conferência de área', 'Prévia de área e perímetro sem passar pelo SIGEF.', '3:00', 4),
    ('loteamento', 'Serviço com glebas pela prancheta', 'Separar o imóvel em glebas e gerar os documentos de cada uma.', '5:00', 1),
    ('loteamento', 'Divisão em partes iguais (partilha)', 'O motor divide em partes de mesma área e gera o GEO de cada herdeiro.', '6:00', 2),
    ('loteamento', 'Loteamento: quadras, lotes e ruas', 'Gerar a proposta, ajustar à mão e exportar.', '6:00', 3),
    ('loteamento', 'Maquete 3D do loteamento', 'Apresentar o loteamento ao cliente com a maquete e o voo de drone.', '3:00', 4),
    ('car', 'CAR: do KML aos shapefiles do SICAR', 'Reserva legal, APP e área produtiva prontas para enviar.', '5:00', 1),
    ('clientes', 'Clientes: cadastro completo e qualificação', 'Os dados do cliente viram o detentor de todos os serviços dele.', '4:00', 1),
    ('equipe', 'Equipe: pessoas, permissões e senhas', 'Adicionar quem trabalha com você, definir senha e o que cada um pode fazer.', '4:00', 1),
    ('equipe', 'Uso da equipe, acessos e auditoria', 'Quem usou, de onde entrou e quem fez o quê, com exportação.', '4:00', 2),
    ('config', 'Responsáveis técnicos, credenciados e modelos', 'Quem assina os serviços e os modelos de documento do escritório.', '4:00', 1),
    ('config', 'Plano, créditos e suporte', 'Acompanhar o uso do mês, pedir créditos e abrir um chamado.', '3:00', 2),
    ('config', 'Conectar ao GPROL', 'Pedidos, etapas, documentos e clientes nos dois sistemas.', '4:00', 3)
  ) as v(modulo, titulo, descricao, duracao, ordem)
 where not exists (select 1 from tutoriais);

-- ------------------------------------------------------------------ permissões das funções
revoke execute on function listar_membros() from public, anon;
revoke execute on function definir_membro(uuid, text, text, text[], boolean, text, text) from public, anon;
revoke execute on function atualizar_meu_perfil(text, text) from public, anon;
revoke execute on function historico_cliente(uuid, int) from public, anon;
revoke execute on function ip_da_requisicao() from public, anon, authenticated;
revoke execute on function registrar_acesso(text, text, text, text) from public, anon;
revoke execute on function listar_acessos(int, uuid, timestamptz) from public, anon;
revoke execute on function uso_da_equipe(int) from public, anon;
revoke execute on function sa_acessos(uuid, int) from public, anon;
revoke execute on function posso_ver_chamado(uuid) from public, anon;
revoke execute on function anexos_validos(uuid, jsonb) from public, anon, authenticated;
revoke execute on function abrir_chamado(text, text, text, text, jsonb, jsonb) from public, anon;
revoke execute on function responder_chamado(uuid, text, jsonb) from public, anon;
revoke execute on function marcar_chamado_lido(uuid) from public, anon;
revoke execute on function encerrar_chamado(uuid, int, text) from public, anon;
revoke execute on function meus_chamados() from public, anon;
revoke execute on function sa_chamados() from public, anon;
revoke execute on function sa_responder_chamado(uuid, text, jsonb, boolean, text) from public, anon;
revoke execute on function sa_atualizar_chamado(uuid, text, text) from public, anon;
revoke execute on function sa_contagem_suporte() from public, anon;
grant execute on function listar_membros() to authenticated;
grant execute on function definir_membro(uuid, text, text, text[], boolean, text, text) to authenticated;
grant execute on function atualizar_meu_perfil(text, text) to authenticated;
grant execute on function historico_cliente(uuid, int) to authenticated;
grant execute on function ip_da_requisicao() to service_role;
grant execute on function registrar_acesso(text, text, text, text) to authenticated;
grant execute on function listar_acessos(int, uuid, timestamptz) to authenticated;
grant execute on function uso_da_equipe(int) to authenticated;
grant execute on function sa_acessos(uuid, int) to authenticated;
grant execute on function posso_ver_chamado(uuid) to authenticated;
grant execute on function anexos_validos(uuid, jsonb) to service_role;
grant execute on function abrir_chamado(text, text, text, text, jsonb, jsonb) to authenticated;
grant execute on function responder_chamado(uuid, text, jsonb) to authenticated;
grant execute on function marcar_chamado_lido(uuid) to authenticated;
grant execute on function encerrar_chamado(uuid, int, text) to authenticated;
grant execute on function meus_chamados() to authenticated;
grant execute on function sa_chamados() to authenticated;
grant execute on function sa_responder_chamado(uuid, text, jsonb, boolean, text) to authenticated;
grant execute on function sa_atualizar_chamado(uuid, text, text) to authenticated;
grant execute on function sa_contagem_suporte() to authenticated;
