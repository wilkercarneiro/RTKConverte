-- Créditos de serviço: quantos serviços cada empresa faz por mês.
--
-- Depende da 0024 (planos, recursos) e da 0025 (equipe). O plano continua
-- decidindo O QUE a empresa enxerga; esta migração decide QUANTO ela usa:
--
--   planos.limite_servicos_mes   — teto de serviços no mês, somando todos (null = sem teto)
--   plano_recursos.limite_mes    — teto de um serviço no mês, dentro do plano (null = sem teto)
--   escritorio_limites           — o que foi negociado com a empresa: troca o teto
--                                  do plano (chave 'total' ou 'servico.x'; limite
--                                  null = sem teto). Sem linha = segue o plano.
--   pacotes_credito              — pacotes que a empresa pode comprar (negociados
--                                  empresa a empresa: nome, serviço, quantidade, preço)
--   creditos_extras              — créditos comprados ou dados: o pedido do cliente
--                                  nasce 'pendente' e vale quando o superadmin aprova
--                                  (o pagamento é combinado fora do sistema)
--   consumos_credito             — um crédito gasto = uma linha. Nasce quando o
--                                  serviço nasce, isto é, quando o arquivo de
--                                  entrada (TXT, KML ou PDF do SIGEF) é enviado.
--                                  Apagar o serviço NÃO devolve o crédito
--                                  (servico_id vira null, a linha fica).
--
-- Ordem do gasto: primeiro a franquia do mês (precisa caber no teto do serviço E
-- no teto total); acabou, usa o crédito extra daquele serviço; depois o extra
-- "qualquer serviço". Crédito extra não vence no fim do mês.
--
-- Serviço derivado (gleba separada, GEO de cada herdeiro da divisão) não gasta
-- crédito: ele sai de um serviço que já gastou. É marcado por `origem_id`.
--
-- Teste local: `npm run test:rls` (tests/rls/creditos.sql).

-- ------------------------------------------------------------------ tetos
alter table planos add column if not exists limite_servicos_mes int
  check (limite_servicos_mes is null or limite_servicos_mes >= 0);
alter table plano_recursos add column if not exists limite_mes int
  check (limite_mes is null or limite_mes >= 0);

create table if not exists escritorio_limites (
  escritorio_id uuid not null references escritorios(id) on delete cascade,
  chave text not null check (chave = 'total' or chave like 'servico.%'),
  limite int check (limite is null or limite >= 0),
  atualizado_em timestamptz not null default now(),
  primary key (escritorio_id, chave)
);

-- ------------------------------------------------------------------ pacotes e créditos
create table if not exists pacotes_credito (
  id uuid primary key default gen_random_uuid(),
  escritorio_id uuid not null references escritorios(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 1 and 80),
  chave text not null default 'total' check (chave = 'total' or chave like 'servico.%'),
  quantidade int not null check (quantidade > 0),
  preco numeric(12, 2) check (preco is null or preco >= 0),
  ativo boolean not null default true,
  ordem int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists pacotes_credito_escritorio on pacotes_credito (escritorio_id);

create table if not exists creditos_extras (
  id uuid primary key default gen_random_uuid(),
  escritorio_id uuid not null references escritorios(id) on delete cascade,
  chave text not null default 'total' check (chave = 'total' or chave like 'servico.%'),
  quantidade int not null check (quantidade > 0),
  preco numeric(12, 2) check (preco is null or preco >= 0),
  descricao text,
  pacote_id uuid references pacotes_credito(id) on delete set null,
  origem text not null default 'pedido' check (origem in ('pedido', 'manual')),
  status text not null default 'pendente' check (status in ('pendente', 'aprovado', 'recusado', 'cancelado')),
  observacao text,
  pedido_por uuid references auth.users(id) on delete set null,
  resolvido_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  resolvido_em timestamptz
);
create index if not exists creditos_extras_escritorio on creditos_extras (escritorio_id, status);

create table if not exists consumos_credito (
  id bigint generated always as identity primary key,
  escritorio_id uuid not null references escritorios(id) on delete cascade,
  servico_id uuid references servicos(id) on delete set null,
  chave text not null,
  mes date not null,
  -- 'plano' = franquia do mês; 'extra' = crédito comprado (extra_chave diz qual saldo)
  origem text not null check (origem in ('plano', 'extra')),
  extra_chave text,
  user_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists consumos_credito_mes on consumos_credito (escritorio_id, mes);

-- serviço derivado de outro (não gasta crédito)
alter table servicos add column if not exists origem_id uuid references servicos(id) on delete set null;

alter table escritorio_limites enable row level security;
alter table pacotes_credito enable row level security;
alter table creditos_extras enable row level security;
alter table consumos_credito enable row level security;

-- ------------------------------------------------------------------ contas
-- O mês é o do Brasil: um serviço às 22h do dia 31 conta no dia 31.
create or replace function mes_credito()
returns date
language sql stable
as $$
  select date_trunc('month', now() at time zone 'America/Sao_Paulo')::date
$$;

-- Teto do mês (null = sem teto). A negociação da empresa vence o plano.
create or replace function limite_credito(p_escritorio uuid, p_chave text)
returns int
language sql stable security definer
set search_path = public
as $$
  select case
    when exists (select 1 from escritorio_limites where escritorio_id = p_escritorio and chave = p_chave)
      then (select limite from escritorio_limites where escritorio_id = p_escritorio and chave = p_chave)
    when p_chave = 'total'
      then (select p.limite_servicos_mes from escritorios e join planos p on p.id = e.plano_id where e.id = p_escritorio)
    else (select pr.limite_mes from escritorios e join plano_recursos pr on pr.plano_id = e.plano_id
           where e.id = p_escritorio and pr.recurso_chave = p_chave)
  end
$$;

-- Franquia usada no mês (o crédito extra não conta aqui).
create or replace function uso_credito(p_escritorio uuid, p_chave text, p_mes date default null)
returns int
language sql stable security definer
set search_path = public
as $$
  select count(*)::int from consumos_credito
   where escritorio_id = p_escritorio and mes = coalesce(p_mes, mes_credito()) and origem = 'plano'
     and (p_chave = 'total' or chave = p_chave)
$$;

-- Saldo de crédito extra (aprovado − gasto). Não vence.
create or replace function saldo_extra(p_escritorio uuid, p_chave text)
returns int
language sql stable security definer
set search_path = public
as $$
  select coalesce((select sum(quantidade) from creditos_extras
                    where escritorio_id = p_escritorio and chave = p_chave and status = 'aprovado'), 0)::int
       - (select count(*) from consumos_credito
           where escritorio_id = p_escritorio and origem = 'extra' and extra_chave = p_chave)::int
$$;

-- De onde sai o próximo crédito deste serviço: 'plano', 'extra:<chave>' ou null (acabou).
create or replace function fonte_credito(p_escritorio uuid, p_chave text)
returns text
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_lim_s int := limite_credito(p_escritorio, p_chave);
  v_lim_t int := limite_credito(p_escritorio, 'total');
begin
  if (v_lim_s is null or uso_credito(p_escritorio, p_chave) < v_lim_s)
     and (v_lim_t is null or uso_credito(p_escritorio, 'total') < v_lim_t) then
    return 'plano';
  end if;
  if saldo_extra(p_escritorio, p_chave) > 0 then return 'extra:' || p_chave; end if;
  if saldo_extra(p_escritorio, 'total') > 0 then return 'extra:total'; end if;
  return null;
end $$;

-- Retrato do mês para as telas: teto, usado e saldo extra de cada serviço.
create or replace function situacao_creditos(p_escritorio uuid)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'mes', mes_credito(),
    'total', jsonb_build_object(
      'limite', limite_credito(p_escritorio, 'total'),
      'usado', uso_credito(p_escritorio, 'total'),
      'extra', saldo_extra(p_escritorio, 'total')),
    'servicos', coalesce((
      select jsonb_object_agg(r.chave, jsonb_build_object(
        'limite', limite_credito(p_escritorio, r.chave),
        'usado', uso_credito(p_escritorio, r.chave),
        'extra', saldo_extra(p_escritorio, r.chave),
        'disponivel', fonte_credito(p_escritorio, r.chave) is not null))
        from recursos r where r.ativo and r.chave like 'servico.%'
    ), '{}'::jsonb)
  )
$$;

-- ------------------------------------------------------------------ o gasto
create or replace function servico_derivado(s servicos)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select s.origem_id is not null and exists (
    select 1 from servicos o where o.id = s.origem_id and o.escritorio_id = s.escritorio_id and o.tem_glebas)
$$;

create or replace function consumir_credito()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_chave text := chave_recurso_do_servico(new);
  v_fonte text;
  v_nome text;
begin
  if servico_derivado(new) then return new; end if;
  -- uma empresa por vez: dois envios ao mesmo tempo não passam do teto
  perform 1 from escritorios where id = new.escritorio_id for update;
  v_fonte := fonte_credito(new.escritorio_id, v_chave);
  if v_fonte is null then
    select coalesce(nome, v_chave) into v_nome from recursos where chave = v_chave;
    raise exception 'SEM_CREDITO: os créditos de % deste mês acabaram. Compre mais créditos para continuar.', coalesce(v_nome, v_chave)
      using errcode = 'P0001';
  end if;
  insert into consumos_credito (escritorio_id, servico_id, chave, mes, origem, extra_chave, user_id)
  values (new.escritorio_id, new.id, v_chave, mes_credito(),
          case when v_fonte = 'plano' then 'plano' else 'extra' end,
          case when v_fonte = 'plano' then null else substr(v_fonte, 7) end,
          coalesce(new.criado_por, auth.uid()));
  return new;
end $$;

drop trigger if exists servicos_zz_consumir_credito on servicos;
create trigger servicos_zz_consumir_credito
  after insert on servicos
  for each row execute function consumir_credito();

-- A trava do recurso agora vale também no INSERT: o parse-txt passou a criar o
-- serviço já com a modalidade escolhida. O derivado herda a liberação da origem.
create or replace function validar_recurso_servico()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare v_chave text := chave_recurso_do_servico(new);
begin
  if tg_op = 'INSERT' and servico_derivado(new) then return new; end if;
  if tg_op = 'UPDATE' and v_chave = chave_recurso_do_servico(old) then return new; end if;
  if not recurso_liberado(new.escritorio_id, v_chave) then
    raise exception 'O plano da empresa não inclui este serviço (%)', v_chave using errcode = '42501';
  end if;
  return new;
end $$;

-- ------------------------------------------------------------------ o cliente
create or replace function sou_dono_de(p_escritorio uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from membros_escritorio
                  where user_id = auth.uid() and escritorio_id = p_escritorio and papel = 'dono')
$$;

create or replace function meus_creditos()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare v_esc uuid := escritorio_atual();
begin
  if v_esc is null then return null; end if;
  return situacao_creditos(v_esc) || jsonb_build_object(
    'sou_dono', sou_dono_de(v_esc),
    'pacotes', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome, 'chave', p.chave,
                                          'quantidade', p.quantidade, 'preco', p.preco) order by p.ordem, p.quantidade)
        from pacotes_credito p where p.escritorio_id = v_esc and p.ativo
    ), '[]'::jsonb),
    'pedidos', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'chave', c.chave, 'quantidade', c.quantidade, 'preco', c.preco,
                                          'descricao', c.descricao, 'status', c.status, 'created_at', c.created_at)
                       order by c.created_at desc)
        from (select * from creditos_extras where escritorio_id = v_esc order by created_at desc limit 20) c
    ), '[]'::jsonb)
  );
end $$;

-- Pedido de créditos: por pacote da empresa, ou quantidade livre (o superadmin
-- combina o preço). Só o dono compra. Vale quando o superadmin aprova.
create or replace function pedir_creditos(p_pacote uuid default null, p_chave text default null,
                                          p_quantidade int default null, p_observacao text default null)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_esc uuid := escritorio_atual();
  v_pac pacotes_credito;
  v_id uuid;
begin
  if v_esc is null then raise exception 'Sua conta não está ligada a uma empresa ativa.' using errcode = '42501'; end if;
  if not sou_dono_de(v_esc) then
    raise exception 'Só o dono da empresa compra créditos.' using errcode = '42501';
  end if;
  if (select count(*) from creditos_extras where escritorio_id = v_esc and status = 'pendente') >= 10 then
    raise exception 'Há pedidos demais esperando aprovação.' using errcode = '22023';
  end if;
  if p_pacote is not null then
    select * into v_pac from pacotes_credito where id = p_pacote and escritorio_id = v_esc and ativo;
    if not found then raise exception 'Pacote não encontrado.' using errcode = 'P0002'; end if;
    insert into creditos_extras (escritorio_id, chave, quantidade, preco, descricao, pacote_id, observacao, pedido_por)
    values (v_esc, v_pac.chave, v_pac.quantidade, v_pac.preco, v_pac.nome, v_pac.id, nullif(trim(p_observacao), ''), auth.uid())
    returning id into v_id;
  else
    if p_quantidade is null or p_quantidade < 1 or p_quantidade > 10000 then
      raise exception 'Quantidade inválida.' using errcode = '22023';
    end if;
    if coalesce(p_chave, 'total') <> 'total' and not exists (select 1 from recursos where chave = p_chave and chave like 'servico.%') then
      raise exception 'Serviço inválido.' using errcode = '22023';
    end if;
    insert into creditos_extras (escritorio_id, chave, quantidade, descricao, observacao, pedido_por)
    values (v_esc, coalesce(p_chave, 'total'), p_quantidade, 'Pedido avulso', nullif(trim(p_observacao), ''), auth.uid())
    returning id into v_id;
  end if;
  perform registrar_atividade(v_esc, 'creditos.pedido', (select descricao from creditos_extras where id = v_id));
  return v_id;
end $$;

create or replace function cancelar_pedido_credito(p_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_esc uuid := escritorio_atual();
begin
  if v_esc is null or not sou_dono_de(v_esc) then
    raise exception 'Só o dono da empresa cancela o pedido.' using errcode = '42501';
  end if;
  update creditos_extras set status = 'cancelado', resolvido_em = now(), resolvido_por = auth.uid()
   where id = p_id and escritorio_id = v_esc and status = 'pendente';
  if not found then raise exception 'Pedido não encontrado ou já resolvido.' using errcode = 'P0002'; end if;
end $$;

-- ------------------------------------------------------------------ o superadmin
-- Tudo da aba Créditos da empresa numa chamada: tetos com a origem, uso do mês,
-- pacotes e o histórico de créditos extras.
create or replace function sa_creditos_empresa(p_escritorio uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform exigir_superadmin();
  return situacao_creditos(p_escritorio) || jsonb_build_object(
    'plano', (select jsonb_build_object('total', p.limite_servicos_mes, 'servicos', coalesce((
                select jsonb_object_agg(pr.recurso_chave, pr.limite_mes) from plano_recursos pr
                 where pr.plano_id = p.id and pr.recurso_chave like 'servico.%'), '{}'::jsonb))
                from escritorios e join planos p on p.id = e.plano_id where e.id = p_escritorio),
    'negociado', coalesce((select jsonb_object_agg(chave, limite) from escritorio_limites where escritorio_id = p_escritorio), '{}'::jsonb),
    'pacotes', coalesce((select jsonb_agg(to_jsonb(p) order by p.ordem, p.quantidade)
                           from pacotes_credito p where p.escritorio_id = p_escritorio), '[]'::jsonb),
    'extras', coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object('quem', u.email) order by c.created_at desc)
                          from (select * from creditos_extras where escritorio_id = p_escritorio order by created_at desc limit 100) c
                          left join auth.users u on u.id = c.pedido_por), '[]'::jsonb),
    'historico', coalesce((select jsonb_agg(jsonb_build_object('mes', mes, 'total', total) order by mes desc)
                             from (select mes, count(*)::int total from consumos_credito
                                    where escritorio_id = p_escritorio group by mes order by mes desc limit 12) h), '[]'::jsonb)
  );
end $$;

-- Teto negociado. p_seguir_plano = true apaga a negociação (volta ao plano);
-- senão grava p_limite (null = sem teto).
create or replace function sa_definir_limite_empresa(p_escritorio uuid, p_chave text, p_limite int, p_seguir_plano boolean default false)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform exigir_superadmin();
  if p_seguir_plano then
    delete from escritorio_limites where escritorio_id = p_escritorio and chave = p_chave;
  else
    insert into escritorio_limites (escritorio_id, chave, limite) values (p_escritorio, p_chave, p_limite)
    on conflict (escritorio_id, chave) do update set limite = excluded.limite, atualizado_em = now();
  end if;
end $$;

-- Aprovar (o crédito passa a valer) ou recusar um pedido.
create or replace function sa_resolver_pedido_credito(p_id uuid, p_aprovar boolean, p_observacao text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform exigir_superadmin();
  update creditos_extras
     set status = case when p_aprovar then 'aprovado' else 'recusado' end,
         resolvido_em = now(), resolvido_por = auth.uid(),
         observacao = coalesce(nullif(trim(p_observacao), ''), observacao)
   where id = p_id and status = 'pendente';
  if not found then raise exception 'Pedido não encontrado ou já resolvido.' using errcode = 'P0002'; end if;
end $$;

-- Crédito dado direto pelo superadmin (cortesia, venda fechada por fora).
create or replace function sa_adicionar_creditos(p_escritorio uuid, p_chave text, p_quantidade int, p_descricao text default null, p_preco numeric default null)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v_id uuid;
begin
  perform exigir_superadmin();
  insert into creditos_extras (escritorio_id, chave, quantidade, preco, descricao, origem, status, pedido_por, resolvido_por, resolvido_em)
  values (p_escritorio, coalesce(p_chave, 'total'), p_quantidade, p_preco, coalesce(nullif(trim(p_descricao), ''), 'Crédito adicionado'),
          'manual', 'aprovado', auth.uid(), auth.uid(), now())
  returning id into v_id;
  return v_id;
end $$;

-- Pedidos esperando o superadmin, de todas as empresas (aviso do painel).
create or replace function sa_pedidos_credito_pendentes()
returns table (id uuid, escritorio_id uuid, empresa text, chave text, quantidade int, preco numeric, descricao text, created_at timestamptz)
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform exigir_superadmin();
  return query
  select c.id, c.escritorio_id, e.nome, c.chave, c.quantidade, c.preco, c.descricao, c.created_at
    from creditos_extras c join escritorios e on e.id = c.escritorio_id
   where c.status = 'pendente'
   order by c.created_at;
end $$;

-- ------------------------------------------------------------------ policies
-- A empresa lê o que é dela; escreve só pelas RPCs. O superadmin faz tudo.
drop policy if exists escritorio_limites_superadmin on escritorio_limites;
create policy escritorio_limites_superadmin on escritorio_limites for all to authenticated
  using (sou_superadmin()) with check (sou_superadmin());

drop policy if exists pacotes_credito_leitura on pacotes_credito;
create policy pacotes_credito_leitura on pacotes_credito for select to authenticated
  using (escritorio_id = escritorio_atual() and ativo);
drop policy if exists pacotes_credito_superadmin on pacotes_credito;
create policy pacotes_credito_superadmin on pacotes_credito for all to authenticated
  using (sou_superadmin()) with check (sou_superadmin());

drop policy if exists creditos_extras_leitura on creditos_extras;
create policy creditos_extras_leitura on creditos_extras for select to authenticated
  using (escritorio_id = escritorio_atual());
drop policy if exists creditos_extras_superadmin on creditos_extras;
create policy creditos_extras_superadmin on creditos_extras for all to authenticated
  using (sou_superadmin()) with check (sou_superadmin());

drop policy if exists consumos_credito_leitura on consumos_credito;
create policy consumos_credito_leitura on consumos_credito for select to authenticated
  using (escritorio_id = escritorio_atual() or sou_superadmin());
revoke insert, update, delete on consumos_credito from anon, authenticated;

-- ------------------------------------------------------------------ permissões das funções
revoke execute on function mes_credito() from public, anon;
revoke execute on function limite_credito(uuid, text) from public, anon, authenticated;
revoke execute on function uso_credito(uuid, text, date) from public, anon, authenticated;
revoke execute on function saldo_extra(uuid, text) from public, anon, authenticated;
revoke execute on function fonte_credito(uuid, text) from public, anon, authenticated;
revoke execute on function situacao_creditos(uuid) from public, anon, authenticated;
revoke execute on function servico_derivado(servicos) from public, anon, authenticated;
revoke execute on function consumir_credito() from public, anon, authenticated;
revoke execute on function sou_dono_de(uuid) from public, anon, authenticated;
revoke execute on function meus_creditos() from public, anon;
revoke execute on function pedir_creditos(uuid, text, int, text) from public, anon;
revoke execute on function cancelar_pedido_credito(uuid) from public, anon;
revoke execute on function sa_creditos_empresa(uuid) from public, anon;
revoke execute on function sa_definir_limite_empresa(uuid, text, int, boolean) from public, anon;
revoke execute on function sa_resolver_pedido_credito(uuid, boolean, text) from public, anon;
revoke execute on function sa_adicionar_creditos(uuid, text, int, text, numeric) from public, anon;
revoke execute on function sa_pedidos_credito_pendentes() from public, anon;
grant execute on function mes_credito() to authenticated, service_role;
grant execute on function meus_creditos() to authenticated;
grant execute on function pedir_creditos(uuid, text, int, text) to authenticated;
grant execute on function cancelar_pedido_credito(uuid) to authenticated;
grant execute on function sa_creditos_empresa(uuid) to authenticated;
grant execute on function sa_definir_limite_empresa(uuid, text, int, boolean) to authenticated;
grant execute on function sa_resolver_pedido_credito(uuid, boolean, text) to authenticated;
grant execute on function sa_adicionar_creditos(uuid, text, int, text, numeric) to authenticated;
grant execute on function sa_pedidos_credito_pendentes() to authenticated;
