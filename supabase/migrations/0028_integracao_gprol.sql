-- 0028 — Integração com o GPROL (CRM do mesmo ramo).
--
-- O escritório conecta o Vertces à empresa dele no GPROL (o admin autoriza lá;
-- a chave da integração fica só aqui, numa tabela sem policy). Depois:
--   * serviço do GPROL vira PEDIDO a executar (pedidos_externos). Não consome
--     crédito: o crédito sai como sempre, quando o serviço nasce no upload;
--   * um pedido pode virar vários serviços (bloco "Geo + CAR"): servicos.pedido_externo_id;
--     glebas e partes herdam o pedido do pai;
--   * o que acontece aqui vai ao GPROL como ESTADO (marcos já atingidos), não
--     como evento solto: repetir é inofensivo e o card anda só para frente lá;
--   * serviço feito direto aqui nasce no GPROL quando gera os primeiros
--     documentos (vira um pedido de origem 'vertces');
--   * clientes ligados (vinculos_externos) trocam só os campos que mudaram.
--
-- Fila de saída com versão: integracao_saida tem UMA linha pendente por
-- (tipo, ref); mudança nova sobe a versão, e o worker só dá baixa na versão
-- que enviou. Quem processa é a edge function `gprol` (ao agir e ao abrir as telas).
--
-- Escrita vinda do GPROL marca `app.origem = 'gprol'` na transação: os
-- triggers de fila ignoram (sem eco) e a auditoria registra "GPROL".
-- Plano: docs/integracao-gprol.md.

-- ------------------------------------------------------------------ recurso
insert into recursos (chave, nome, grupo, descricao, padrao, ordem)
values ('integracao.gprol', 'Integração com o GPROL', 'Integrações',
        'Conectar ao GPROL: clientes, pedidos de serviço, etapas e documentos', true, 900)
on conflict (chave) do nothing;

-- ------------------------------------------------------------------ tabelas
create table if not exists integracoes (
  escritorio_id uuid not null references escritorios(id) on delete cascade,
  provedor text not null default 'gprol' check (provedor in ('gprol')),
  status text not null default 'ativa' check (status in ('ativa', 'desconectada')),
  empresa_externa_id text,
  empresa_externa_nome text,
  conectado_por uuid,
  conectado_em timestamptz,
  desconectado_em timestamptz,
  travado_ate timestamptz,
  ultima_sincronizacao timestamptz,
  ultimo_erro text,
  resumo jsonb,
  primary key (escritorio_id, provedor)
);

create table if not exists integracoes_segredos (
  escritorio_id uuid not null,
  provedor text not null,
  segredo text not null unique,
  criado_em timestamptz not null default now(),
  primary key (escritorio_id, provedor),
  foreign key (escritorio_id, provedor) references integracoes(escritorio_id, provedor) on delete cascade
);
-- hash da chave com que o GPROL chama de volta (abrir documentos)
alter table integracoes_segredos add column if not exists retorno_hash text;

create table if not exists integracao_estados (
  state text primary key,
  escritorio_id uuid not null references escritorios(id) on delete cascade,
  user_id uuid not null,
  expira_em timestamptz not null
);

create table if not exists vinculos_externos (
  escritorio_id uuid not null references escritorios(id) on delete cascade,
  provedor text not null default 'gprol',
  entidade text not null check (entidade in ('cliente')),
  local_id uuid not null,
  externo_id uuid not null,
  criado_em timestamptz not null default now(),
  primary key (escritorio_id, provedor, entidade, local_id),
  unique (escritorio_id, provedor, entidade, externo_id)
);

create table if not exists pedidos_externos (
  id uuid primary key default gen_random_uuid(),
  escritorio_id uuid not null references escritorios(id) on delete cascade,
  provedor text not null default 'gprol',
  externo_id uuid not null,
  origem text not null default 'gprol' check (origem in ('gprol', 'vertces')),
  cliente_id uuid references clientes(id) on delete set null,
  titulo text,
  nome_servico text,
  modalidades text[] not null default '{}',
  dados jsonb not null default '{}'::jsonb,
  etapa text,
  status text not null default 'pendente'
    check (status in ('pendente', 'em_execucao', 'entregue', 'cancelado', 'descartado')),
  recebido_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  entregue_em timestamptz,
  unique (escritorio_id, provedor, externo_id)
);
create index if not exists pedidos_externos_abertos on pedidos_externos (escritorio_id, status);
create index if not exists pedidos_externos_cliente on pedidos_externos (cliente_id);

alter table servicos add column if not exists pedido_externo_id uuid references pedidos_externos(id) on delete set null;
create index if not exists servicos_pedido_externo on servicos (pedido_externo_id) where pedido_externo_id is not null;

create table if not exists integracao_saida (
  id bigserial primary key,
  escritorio_id uuid not null references escritorios(id) on delete cascade,
  tipo text not null check (tipo in ('servico', 'pedido', 'cliente')),
  ref_id uuid not null,
  campos text[] not null default '{}',
  versao int not null default 1,
  tentativas int not null default 0,
  proxima_tentativa timestamptz not null default now(),
  enviado_em timestamptz,
  erro text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists integracao_saida_pendente
  on integracao_saida (escritorio_id, tipo, ref_id) where enviado_em is null;
create index if not exists integracao_saida_fila
  on integracao_saida (escritorio_id, proxima_tentativa) where enviado_em is null;

alter table integracoes enable row level security;
alter table integracoes_segredos enable row level security;
alter table integracao_estados enable row level security;
alter table vinculos_externos enable row level security;
alter table pedidos_externos enable row level security;
alter table integracao_saida enable row level security;

drop policy if exists integracoes_do_escritorio on integracoes;
create policy integracoes_do_escritorio on integracoes for select
  using (escritorio_id = escritorio_atual());
drop policy if exists vinculos_do_escritorio on vinculos_externos;
create policy vinculos_do_escritorio on vinculos_externos for select
  using (escritorio_id = escritorio_atual());
drop policy if exists pedidos_do_escritorio on pedidos_externos;
create policy pedidos_do_escritorio on pedidos_externos for select
  using (escritorio_id = escritorio_atual());
-- integracoes_segredos, integracao_estados, integracao_saida: sem policy (só service_role)
revoke all on integracoes_segredos, integracao_estados, integracao_saida from anon, authenticated;
revoke insert, update, delete on integracoes, vinculos_externos, pedidos_externos from anon, authenticated;

-- ------------------------------------------------------------------ apoio
create or replace function integracao_ativa(p_escritorio uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from integracoes where escritorio_id = p_escritorio and provedor = 'gprol' and status = 'ativa')
$$;

create or replace function origem_da_escrita()
returns text
language sql stable
as $$ select coalesce(nullif(current_setting('app.origem', true), ''), 'vertces') $$;

create or replace function integracao_enfileirar(p_escritorio uuid, p_tipo text, p_ref uuid, p_campos text[] default '{}')
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if p_escritorio is null or p_ref is null or not integracao_ativa(p_escritorio) then return; end if;
  insert into integracao_saida (escritorio_id, tipo, ref_id, campos)
  values (p_escritorio, p_tipo, p_ref, coalesce(p_campos, '{}'))
  on conflict (escritorio_id, tipo, ref_id) where enviado_em is null
  do update set versao = integracao_saida.versao + 1,
                campos = array(select distinct unnest(integracao_saida.campos || excluded.campos)),
                proxima_tentativa = least(integracao_saida.proxima_tentativa, now()),
                atualizado_em = now();
end $$;

-- Pedido com serviço está em execução; sem nenhum, volta a pendente (o do
-- GPROL) ou some (o que nasceu aqui). Entregue/cancelado/descartado não mudam.
create or replace function integracao_recalcular_pedido(p_pedido uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_n int; p pedidos_externos;
begin
  if p_pedido is null then return; end if;
  select * into p from pedidos_externos where id = p_pedido;
  if p.id is null then return; end if;
  select count(*) into v_n from servicos where pedido_externo_id = p_pedido;
  if p.status = 'pendente' and v_n > 0 then
    update pedidos_externos set status = 'em_execucao', atualizado_em = now() where id = p_pedido;
  elsif p.status = 'em_execucao' and v_n = 0 then
    update pedidos_externos set status = case when p.origem = 'gprol' then 'pendente' else 'descartado' end,
           atualizado_em = now() where id = p_pedido;
  end if;
end $$;

-- Marcos já atingidos por um pedido (estado, não evento).
create or replace function integracao_marcos_do_pedido(p_pedido uuid)
returns text[]
language sql stable security definer
set search_path = public
as $$
  with sv as (select id, modalidade, status from servicos where pedido_externo_id = p_pedido),
  docs as (select tipo from documentos_gerados where servico_id in (select id from sv))
  select array_remove(array[
    case when exists (select 1 from sv) then 'iniciado' end,
    case when exists (select 1 from docs where tipo in ('memorial_docx', 'planilha_ods', 'planta_pdf_sistema', 'gleba_planta_pdf'))
           or exists (select 1 from sv where modalidade in ('car', 'loteamento') and status = 'gerado')
         then 'documentos' end,
    case when exists (select 1 from docs where tipo in ('planta_pdf', 'planta_pdf_editada')) then 'planta_sigef' end,
    case when exists (select 1 from docs where tipo like 'peca\_%') then 'pecas' end,
    case when (select status from pedidos_externos where id = p_pedido) = 'entregue' then 'entregue' end
  ], null)
$$;

-- ------------------------------------------------------------------ serviços
-- Glebas e partes herdam o pedido do serviço de origem; pedido de outro
-- escritório é recusado.
create or replace function servico_pedido_externo()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.pedido_externo_id is null and new.origem_id is not null and tg_op = 'INSERT' then
    select pedido_externo_id into new.pedido_externo_id from servicos where id = new.origem_id;
  end if;
  if new.pedido_externo_id is not null and not exists (
    select 1 from pedidos_externos where id = new.pedido_externo_id and escritorio_id = new.escritorio_id) then
    raise exception 'Pedido do GPROL não encontrado neste escritório' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists servicos_zy_pedido_externo on servicos;
create trigger servicos_zy_pedido_externo before insert or update of pedido_externo_id on servicos
  for each row execute function servico_pedido_externo();

create or replace function integracao_servico_mudou()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare v_esc uuid := coalesce(new.escritorio_id, old.escritorio_id);
begin
  begin
    if tg_op = 'DELETE' then
      perform integracao_recalcular_pedido(old.pedido_externo_id);
      -- serviço que some antes de sair (ex.: CAR que não salvou) não chega ao GPROL
      delete from integracao_saida where escritorio_id = v_esc and tipo = 'servico' and ref_id = old.id and enviado_em is null;
      return old;
    end if;
    if tg_op = 'UPDATE' and new.pedido_externo_id is distinct from old.pedido_externo_id then
      perform integracao_recalcular_pedido(old.pedido_externo_id);
    end if;
    perform integracao_recalcular_pedido(new.pedido_externo_id);
    if origem_da_escrita() = 'gprol' then return new; end if;
    if tg_op = 'INSERT' or new.pedido_externo_id is distinct from old.pedido_externo_id then
      perform integracao_enfileirar(v_esc, 'servico', new.id);
    elsif new.status is distinct from old.status and new.status = 'gerado' then
      if new.pedido_externo_id is not null then
        perform integracao_enfileirar(v_esc, 'pedido', new.pedido_externo_id);
      else
        perform integracao_enfileirar(v_esc, 'servico', new.id);
      end if;
    end if;
  exception when others then
    raise warning 'Integração GPROL (serviço %): %', coalesce(new.id, old.id), sqlerrm;
  end;
  return coalesce(new, old);
end $$;
drop trigger if exists servicos_zz_integracao on servicos;
create trigger servicos_zz_integracao after insert or update of pedido_externo_id, status or delete on servicos
  for each row execute function integracao_servico_mudou();

create or replace function integracao_documento_gerado()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare s servicos;
begin
  begin
    select * into s from servicos where id = new.servico_id;
    if s.id is null then return null; end if;
    if s.pedido_externo_id is not null then
      perform integracao_enfileirar(s.escritorio_id, 'pedido', s.pedido_externo_id);
    else
      perform integracao_enfileirar(s.escritorio_id, 'servico', s.id);
    end if;
  exception when others then
    raise warning 'Integração GPROL (documento %): %', new.id, sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists documentos_integracao on documentos_gerados;
create trigger documentos_integracao after insert on documentos_gerados
  for each row execute function integracao_documento_gerado();

-- ------------------------------------------------------------------ clientes
create or replace function integracao_cliente_mudou()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare v_campos text[] := '{}';
begin
  begin
    if tg_op = 'DELETE' then
      delete from vinculos_externos where escritorio_id = old.escritorio_id and entidade = 'cliente' and local_id = old.id;
      delete from integracao_saida where escritorio_id = old.escritorio_id and tipo = 'cliente' and ref_id = old.id and enviado_em is null;
      return old;
    end if;
    if origem_da_escrita() = 'gprol' then return new; end if;
    if not exists (select 1 from vinculos_externos where escritorio_id = new.escritorio_id and entidade = 'cliente' and local_id = new.id) then
      return new;
    end if;
    if new.nome is distinct from old.nome then v_campos := array_append(v_campos, 'nome'); end if;
    if new.cpf_cnpj is distinct from old.cpf_cnpj then v_campos := array_append(v_campos, 'cpf_cnpj'); end if;
    if new.email is distinct from old.email then v_campos := array_append(v_campos, 'email'); end if;
    if new.telefone is distinct from old.telefone then v_campos := array_append(v_campos, 'telefone'); end if;
    if new.endereco is distinct from old.endereco then v_campos := array_append(v_campos, 'endereco'); end if;
    if cardinality(v_campos) > 0 then
      perform integracao_enfileirar(new.escritorio_id, 'cliente', new.id, v_campos);
    end if;
  exception when others then
    raise warning 'Integração GPROL (cliente %): %', coalesce(new.id, old.id), sqlerrm;
  end;
  return coalesce(new, old);
end $$;
drop trigger if exists clientes_zz_integracao on clientes;
create trigger clientes_zz_integracao after update of nome, cpf_cnpj, email, telefone, endereco or delete on clientes
  for each row execute function integracao_cliente_mudou();

-- ------------------------------------------------------------------ aplicar o que veio do GPROL
-- Cliente do GPROL → cliente daqui. Sem vínculo: casa pelo CPF/CNPJ (o que tem
-- mais serviços) e só completa o que está vazio; sem documento, só cria se
-- p_forcar (cliente de um pedido). Devolve o id local (ou null).
create or replace function gprol_aplicar_cliente(p_escritorio uuid, p jsonb, p_forcar boolean default false)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_ext uuid := nullif(p ->> 'id', '')::uuid;
  v_doc text := nullif(regexp_replace(coalesce(p ->> 'cpf_cnpj', ''), '\D', '', 'g'), '');
  v_campos text[] := array(select jsonb_array_elements_text(coalesce(p -> 'fields', '[]'::jsonb)));
  v_todos boolean;
begin
  perform set_config('app.origem', 'gprol', true);
  if v_ext is null then return null; end if;
  select local_id into v_id from vinculos_externos
   where escritorio_id = p_escritorio and provedor = 'gprol' and entidade = 'cliente' and externo_id = v_ext;
  if coalesce((p ->> 'deleted')::boolean, false) then
    delete from vinculos_externos where escritorio_id = p_escritorio and entidade = 'cliente' and externo_id = v_ext;
    return null;
  end if;

  if v_id is not null and not exists (select 1 from clientes where id = v_id) then
    delete from vinculos_externos where escritorio_id = p_escritorio and entidade = 'cliente' and externo_id = v_ext;
    v_id := null;
  end if;

  if v_id is not null then
    v_todos := cardinality(v_campos) = 0;
    update clientes c set
      nome = case when (v_todos or 'full_name' = any (v_campos)) and nullif(btrim(coalesce(p ->> 'full_name', '')), '') is not null
                  then btrim(p ->> 'full_name') else c.nome end,
      cpf_cnpj = case when v_todos or 'cpf_cnpj' = any (v_campos) then nullif(btrim(coalesce(p ->> 'cpf_cnpj', '')), '') else c.cpf_cnpj end,
      email = case when v_todos or 'email' = any (v_campos) then nullif(btrim(coalesce(p ->> 'email', '')), '') else c.email end,
      telefone = case when v_todos or 'phone' = any (v_campos) then nullif(btrim(coalesce(p ->> 'phone', '')), '') else c.telefone end,
      endereco = case when v_todos or 'address' = any (v_campos) then nullif(btrim(coalesce(p ->> 'address', '')), '') else c.endereco end
     where c.id = v_id;
    return v_id;
  end if;

  if v_doc is not null then
    select c.id into v_id from clientes c
     where c.escritorio_id = p_escritorio and regexp_replace(coalesce(c.cpf_cnpj, ''), '\D', '', 'g') = v_doc
       and not exists (select 1 from vinculos_externos v where v.escritorio_id = p_escritorio and v.entidade = 'cliente' and v.local_id = c.id)
     order by (select count(*) from servicos s where s.cliente_id = c.id) desc, c.created_at
     limit 1;
  end if;
  if v_id is not null then
    update clientes c set
      email = coalesce(c.email, nullif(btrim(coalesce(p ->> 'email', '')), '')),
      telefone = coalesce(c.telefone, nullif(btrim(coalesce(p ->> 'phone', '')), '')),
      endereco = coalesce(c.endereco, nullif(btrim(coalesce(p ->> 'address', '')), ''))
     where c.id = v_id;
  elsif v_doc is not null or p_forcar then
    if nullif(btrim(coalesce(p ->> 'full_name', '')), '') is null then return null; end if;
    insert into clientes (escritorio_id, nome, cpf_cnpj, email, telefone, endereco)
    values (p_escritorio, btrim(p ->> 'full_name'), nullif(btrim(coalesce(p ->> 'cpf_cnpj', '')), ''),
            nullif(btrim(coalesce(p ->> 'email', '')), ''), nullif(btrim(coalesce(p ->> 'phone', '')), ''),
            nullif(btrim(coalesce(p ->> 'address', '')), ''))
    returning id into v_id;
  else
    return null;
  end if;
  insert into vinculos_externos (escritorio_id, provedor, entidade, local_id, externo_id)
  values (p_escritorio, 'gprol', 'cliente', v_id, v_ext)
  on conflict do nothing;
  return v_id;
end $$;

-- Serviço do GPROL → pedido daqui. Devolve { pedido_id, cliente_id }.
create or replace function gprol_aplicar_servico(p_escritorio uuid, p jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_ext uuid := nullif(p ->> 'id', '')::uuid;
  v_ped pedidos_externos;
  v_cli uuid;
  v_cancelado boolean := coalesce((p ->> 'deleted')::boolean, false) or (p ->> 'status') = 'canceled';
  v_mods text[] := array(select jsonb_array_elements_text(case jsonb_typeof(p -> 'modalities')
                                                            when 'array' then p -> 'modalities' else '[]'::jsonb end));
  v_dados jsonb;
begin
  perform set_config('app.origem', 'gprol', true);
  if v_ext is null then return null; end if;
  select * into v_ped from pedidos_externos where escritorio_id = p_escritorio and provedor = 'gprol' and externo_id = v_ext;

  if v_cancelado then
    if v_ped.id is not null and v_ped.status not in ('descartado', 'cancelado') then
      update pedidos_externos set status = 'cancelado', atualizado_em = now() where id = v_ped.id;
    end if;
    return jsonb_build_object('pedido_id', v_ped.id, 'cancelado', true);
  end if;

  if jsonb_typeof(p -> 'client') = 'object' then
    v_cli := gprol_aplicar_cliente(p_escritorio, p -> 'client', true);
  end if;
  v_dados := jsonb_strip_nulls(jsonb_build_object(
    'fazenda', p ->> 'farm_name', 'local', p ->> 'property_location', 'area_m2', p -> 'area_m2',
    'observacoes', p ->> 'notes', 'cliente_gprol', p -> 'client' ->> 'full_name', 'criado_em', p ->> 'created_at'));

  if v_ped.id is null then
    insert into pedidos_externos (escritorio_id, provedor, externo_id, origem, cliente_id, titulo, nome_servico,
                                  modalidades, dados, etapa, status)
    values (p_escritorio, 'gprol', v_ext, coalesce(nullif(p ->> 'origin', ''), 'gprol'), v_cli,
            coalesce(nullif(p ->> 'card_title', ''), p ->> 'service_name'), p ->> 'service_name',
            v_mods, v_dados, p ->> 'stage_name',
            case when (p ->> 'status') = 'completed' then 'entregue' else 'pendente' end)
    returning * into v_ped;
  else
    update pedidos_externos set
      cliente_id = coalesce(cliente_id, v_cli),
      titulo = coalesce(nullif(p ->> 'card_title', ''), p ->> 'service_name', titulo),
      nome_servico = coalesce(p ->> 'service_name', nome_servico),
      modalidades = case when cardinality(v_mods) > 0 then v_mods else modalidades end,
      dados = v_dados,
      etapa = coalesce(p ->> 'stage_name', etapa),
      status = case
        when (p ->> 'status') = 'completed' and status in ('pendente', 'em_execucao') then 'entregue'
        when status = 'cancelado' then
          case when exists (select 1 from servicos where pedido_externo_id = v_ped.id) then 'em_execucao' else 'pendente' end
        else status end,
      atualizado_em = now()
     where id = v_ped.id
    returning * into v_ped;
  end if;
  return jsonb_build_object('pedido_id', v_ped.id, 'cliente_id', v_cli);
end $$;

-- Liga um serviço daqui (e glebas/partes dele) a um pedido, sem voltar à fila.
create or replace function integracao_definir_pedido(p_servico uuid, p_pedido uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform set_config('app.origem', 'gprol', true);
  with recursive arvore as (
    select id from servicos where id = p_servico
    union all
    select s.id from servicos s join arvore a on s.origem_id = a.id
  )
  update servicos set pedido_externo_id = p_pedido where id in (select id from arvore);
end $$;

-- Trava por escritório com prazo (advisory lock não serve: o PostgREST usa pool).
create or replace function integracao_travar(p_escritorio uuid, p_segundos int default 90)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare v_ok boolean;
begin
  update integracoes set travado_ate = now() + make_interval(secs => p_segundos)
   where escritorio_id = p_escritorio and provedor = 'gprol' and status = 'ativa'
     and (travado_ate is null or travado_ate < now())
  returning true into v_ok;
  return coalesce(v_ok, false);
end $$;

-- ------------------------------------------------------------------ auditoria: escrita do GPROL aparece
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
  elsif origem_da_escrita() = 'gprol' then
    new.criado_por := old.criado_por;
    new.atualizado_por := null;
    new.atualizado_em := now();
  end if;
  return new;
end $$;

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
    if auth.uid() is null and origem_da_escrita() <> 'gprol' then return new; end if;
    v_campos := campos_alterados(to_jsonb(old), to_jsonb(new),
      array['atualizado_por', 'atualizado_em', 'criado_por', 'created_at', 'escritorio_id', 'id']);
    if cardinality(v_campos) = 0 then return new; end if;
    perform registrar_auditoria(new.escritorio_id, auth.uid(), 'servico.alterado',
      nome_do_servico(new), new.id, new.id, v_campos,
      case when auth.uid() is null then jsonb_build_object('origem', 'gprol') end, interval '15 minutes');
    return new;
  end if;
  perform registrar_auditoria(old.escritorio_id, auth.uid(), 'servico.excluido',
    nome_do_servico(old), null, old.id, null, jsonb_build_object('servico_id', old.id));
  return old;
end $$;

create or replace function atividade_cliente()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare v_campos text[];
begin
  if tg_op = 'INSERT' then
    perform registrar_auditoria(new.escritorio_id, coalesce(auth.uid(), new.criado_por), 'cliente.criado',
      new.nome, null, new.id, null,
      jsonb_build_object('cliente_id', new.id)
        || case when auth.uid() is null and origem_da_escrita() = 'gprol' then jsonb_build_object('origem', 'gprol') else '{}'::jsonb end);
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if auth.uid() is null and origem_da_escrita() <> 'gprol' then return new; end if;
    v_campos := campos_alterados(to_jsonb(old), to_jsonb(new),
      array['atualizado_por', 'atualizado_em', 'criado_por', 'created_at', 'escritorio_id', 'id']);
    if cardinality(v_campos) = 0 then return new; end if;
    perform registrar_auditoria(new.escritorio_id, auth.uid(), 'cliente.alterado',
      new.nome, null, new.id, v_campos,
      jsonb_build_object('cliente_id', new.id)
        || case when auth.uid() is null then jsonb_build_object('origem', 'gprol') else '{}'::jsonb end,
      interval '15 minutes');
    return new;
  end if;
  perform registrar_auditoria(old.escritorio_id, auth.uid(), 'cliente.excluido',
    old.nome, null, old.id, null, jsonb_build_object('cliente_id', old.id));
  return old;
end $$;

-- ------------------------------------------------------------------ permissões
revoke all on function integracao_enfileirar(uuid, text, uuid, text[]) from public, anon, authenticated;
revoke all on function integracao_recalcular_pedido(uuid) from public, anon, authenticated;
revoke all on function integracao_marcos_do_pedido(uuid) from public, anon, authenticated;
revoke all on function gprol_aplicar_cliente(uuid, jsonb, boolean) from public, anon, authenticated;
revoke all on function gprol_aplicar_servico(uuid, jsonb) from public, anon, authenticated;
revoke all on function integracao_definir_pedido(uuid, uuid) from public, anon, authenticated;
revoke all on function integracao_travar(uuid, int) from public, anon, authenticated;
revoke all on function integracao_ativa(uuid) from public, anon;
grant execute on function integracao_enfileirar(uuid, text, uuid, text[]) to service_role;
grant execute on function integracao_recalcular_pedido(uuid) to service_role;
grant execute on function integracao_marcos_do_pedido(uuid) to service_role;
grant execute on function gprol_aplicar_cliente(uuid, jsonb, boolean) to service_role;
grant execute on function gprol_aplicar_servico(uuid, jsonb) to service_role;
grant execute on function integracao_definir_pedido(uuid, uuid) to service_role;
grant execute on function integracao_travar(uuid, int) to service_role;
grant execute on function integracao_ativa(uuid) to authenticated, service_role;
