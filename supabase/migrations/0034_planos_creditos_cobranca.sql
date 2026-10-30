-- Planos novos, créditos em carteiras e cobrança pelo Asaas.
--
-- Depende da 0024 (planos, recursos), 0025 (equipe) e 0027 (créditos). A 0027
-- contava um teto "total" e um teto por serviço; agora o crédito mora em
-- CARTEIRAS, e cada carteira diz quais serviços ela paga:
--
--   tipos_credito        — as carteiras. 'geral' paga qualquer serviço;
--                          'car' paga só o CAR. Carteira nova = uma linha aqui
--                          (o código das telas percorre a lista, não a conhece).
--   plano_creditos       — quantos créditos de cada carteira o plano dá por mês
--                          (null = sem limite; carteira sem linha = 0)
--   escritorio_creditos  — o mesmo, combinado só com uma empresa (vence o plano)
--   precos_credito       — preço do crédito extra por faixa de quantidade, do
--                          plano ou só de uma empresa (a da empresa vence). A
--                          primeira faixa é a compra mínima. Sem faixa = a
--                          carteira não está à venda.
--   planos.preco_mensal / escritorios.mensalidade — a mensalidade (a da empresa vence)
--
-- Ordem do gasto num serviço (fonte_credito): primeiro as carteiras próprias do
-- serviço (o CAR gasta 'car'), franquia do mês e depois o extra; acabou, as
-- carteiras gerais. Gastar crédito GERAL num serviço que tem carteira própria
-- (o CAR) exige o aceite do cliente: o serviço nasce com usar_credito_geral.
--
-- O "mês" do crédito começa no dia da renovação da empresa (dia_renovacao; 1 =
-- mês do calendário). A empresa que paga pelo Asaas renova no dia do vencimento
-- da mensalidade, então os créditos do plano chegam junto com o mês pago.
--
-- Cobrança (Asaas):
--   cobranca_config      — chave da API, ambiente, token do webhook, WhatsApp.
--                          Ninguém lê pelo REST: só a edge function `cobranca`.
--   cobranca_empresas    — cliente e assinatura da empresa no Asaas
--   pagamentos           — cada cobrança que o Asaas emitiu para nós (mensalidade
--                          ou créditos), com o link e a situação
--   asaas_eventos        — tudo o que o webhook recebeu (e o que fez com isso)
--
-- A empresa nova que paga pelo Asaas nasce 'aguardando_pagamento': não vê nada
-- até o webhook (ou a conferência) confirmar a 1ª mensalidade.
--
-- Teste local: `npm run test:rls` (tests/rls/planos_cobranca.sql).

-- ================================================================== carteiras
create table if not exists tipos_credito (
  chave text primary key check (chave ~ '^[a-z][a-z0-9_]*$'),
  nome text not null,
  descricao text,
  -- serviços (chaves de recurso) que esta carteira paga; null = todos
  servicos text[],
  ordem int not null default 0,
  ativo boolean not null default true
);
insert into tipos_credito (chave, nome, descricao, servicos, ordem) values
  ('geral', 'Créditos gerais', 'Valem para qualquer serviço. No CAR, só com o seu aceite.', null, 10),
  ('car', 'Créditos de CAR', 'Valem só para o CAR.', array['servico.car'], 20)
on conflict (chave) do nothing;

-- ================================================================== planos
alter table planos add column if not exists preco_mensal numeric(12, 2) check (preco_mensal is null or preco_mensal >= 0);
-- false: recurso que entrar no catálogo depois nasce bloqueado neste plano (o "Só CAR")
alter table planos add column if not exists libera_recursos_novos boolean not null default true;

create table if not exists plano_creditos (
  plano_id uuid not null references planos(id) on delete cascade,
  tipo text not null references tipos_credito(chave) on update cascade on delete cascade,
  por_mes int check (por_mes is null or por_mes >= 0),
  primary key (plano_id, tipo)
);

create table if not exists escritorio_creditos (
  escritorio_id uuid not null references escritorios(id) on delete cascade,
  tipo text not null references tipos_credito(chave) on update cascade on delete cascade,
  por_mes int check (por_mes is null or por_mes >= 0),
  atualizado_em timestamptz not null default now(),
  primary key (escritorio_id, tipo)
);

create table if not exists precos_credito (
  id uuid primary key default gen_random_uuid(),
  plano_id uuid references planos(id) on delete cascade,
  escritorio_id uuid references escritorios(id) on delete cascade,
  tipo text not null references tipos_credito(chave) on update cascade on delete cascade,
  a_partir_de int not null check (a_partir_de between 1 and 1000),
  preco numeric(12, 2) not null check (preco >= 0),
  check ((plano_id is null) <> (escritorio_id is null))
);
create unique index if not exists precos_credito_plano on precos_credito (plano_id, tipo, a_partir_de) where plano_id is not null;
create unique index if not exists precos_credito_empresa on precos_credito (escritorio_id, tipo, a_partir_de) where escritorio_id is not null;

-- ================================================================== empresa
-- null = a mensalidade do plano; 0 = sem cobrança
alter table escritorios add column if not exists mensalidade numeric(12, 2) check (mensalidade is null or mensalidade >= 0);
alter table escritorios add column if not exists dia_renovacao int not null default 1 check (dia_renovacao between 1 and 31);
alter table escritorios drop constraint if exists escritorios_status_valido;
alter table escritorios add constraint escritorios_status_valido
  check (status in ('ativo', 'aguardando_pagamento', 'suspenso', 'cancelado'));

-- ================================================================== cobrança
create table if not exists cobranca_config (
  key text primary key,
  value text not null,
  atualizado_em timestamptz not null default now()
);

create table if not exists cobranca_empresas (
  escritorio_id uuid primary key references escritorios(id) on delete cascade,
  asaas_cliente_id text,
  asaas_assinatura_id text unique,
  valor numeric(12, 2),
  situacao text not null default 'sem_assinatura'
    check (situacao in ('sem_assinatura', 'aguardando', 'em_dia', 'atrasada', 'cancelada')),
  -- fatura em aberto (a 1ª até ser paga; depois, a do mês que vence)
  link_pagamento text,
  proximo_vencimento date,
  ultimo_pagamento_em timestamptz,
  whatsapp_em timestamptz,
  whatsapp_erro text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists pagamentos (
  id uuid primary key default gen_random_uuid(),
  escritorio_id uuid not null references escritorios(id) on delete cascade,
  finalidade text not null check (finalidade in ('mensalidade', 'creditos')),
  credito_id uuid references creditos_extras(id) on delete set null,
  asaas_id text unique,
  valor numeric(12, 2) not null check (valor >= 0),
  -- a situação do Asaas (PENDING, RECEIVED, CONFIRMED, OVERDUE, REFUNDED…);
  -- CRIANDO = ainda não chegou ao Asaas, CANCELADO = desistência nossa
  status text not null default 'CRIANDO',
  forma text,
  link text,
  vencimento date,
  pago_em timestamptz,
  erro text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists pagamentos_escritorio on pagamentos (escritorio_id, criado_em desc);
create index if not exists pagamentos_credito on pagamentos (credito_id);

create table if not exists asaas_eventos (
  id bigint generated always as identity primary key,
  evento_id text unique,
  evento text not null,
  pagamento_asaas_id text,
  resultado text,
  corpo jsonb,
  recebido_em timestamptz not null default now()
);

alter table tipos_credito enable row level security;
alter table plano_creditos enable row level security;
alter table escritorio_creditos enable row level security;
alter table precos_credito enable row level security;
alter table cobranca_config enable row level security;
alter table cobranca_empresas enable row level security;
alter table pagamentos enable row level security;
alter table asaas_eventos enable row level security;
revoke all on cobranca_config from anon, authenticated;

-- ================================================================== dados da 0027 → carteiras
-- crédito comprado ou dado: 'servico.car' vira carteira CAR, o resto vira geral
alter table creditos_extras add column if not exists tipo text references tipos_credito(chave) on update cascade;
alter table creditos_extras add column if not exists valor_unitario numeric(12, 2);
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'creditos_extras' and column_name = 'chave') then
    update creditos_extras set tipo = case when chave = 'servico.car' then 'car' else 'geral' end where tipo is null;
    alter table creditos_extras drop column chave;
  end if;
end $$;
update creditos_extras set tipo = 'geral' where tipo is null;
alter table creditos_extras alter column tipo set default 'geral';
alter table creditos_extras alter column tipo set not null;
-- 'compra' = paga pelo Asaas (entra sozinha quando o pagamento confirma)
alter table creditos_extras drop constraint if exists creditos_extras_origem_check;
alter table creditos_extras add constraint creditos_extras_origem_check check (origem in ('pedido', 'manual', 'compra'));
-- os pacotes negociados viram a tabela de preços por faixa
drop table if exists pacotes_credito cascade;
alter table creditos_extras drop column if exists pacote_id;

-- consumo: de qual carteira saiu, e se foi crédito geral num serviço com carteira própria
alter table consumos_credito add column if not exists tipo text references tipos_credito(chave) on update cascade;
alter table consumos_credito add column if not exists com_aceite boolean not null default false;
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'consumos_credito' and column_name = 'extra_chave') then
    update consumos_credito
       set tipo = case when (case when origem = 'extra' then extra_chave else chave end) = 'servico.car' then 'car' else 'geral' end
     where tipo is null;
    alter table consumos_credito drop column extra_chave;
  end if;
end $$;
update consumos_credito set tipo = 'geral' where tipo is null;
alter table consumos_credito alter column tipo set not null;
create index if not exists consumos_credito_periodo on consumos_credito (escritorio_id, tipo, created_at);

-- tetos da 0027 → créditos por mês
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'escritorio_limites') then
    insert into escritorio_creditos (escritorio_id, tipo, por_mes)
    select escritorio_id, case when chave = 'servico.car' then 'car' else 'geral' end, limite
      from escritorio_limites where chave in ('total', 'servico.car')
    on conflict do nothing;
    drop table escritorio_limites;
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'planos' and column_name = 'limite_servicos_mes') then
    insert into plano_creditos (plano_id, tipo, por_mes) select id, 'geral', limite_servicos_mes from planos
    on conflict do nothing;
    alter table planos drop column limite_servicos_mes;
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'plano_recursos' and column_name = 'limite_mes') then
    insert into plano_creditos (plano_id, tipo, por_mes)
    select p.id, 'car', (select pr.limite_mes from plano_recursos pr where pr.plano_id = p.id and pr.recurso_chave = 'servico.car')
      from planos p
    on conflict do nothing;
    alter table plano_recursos drop column limite_mes;
  end if;
end $$;
-- plano que já existia continua sem limite: ninguém perde o que tinha ao migrar
insert into plano_creditos (plano_id, tipo, por_mes)
select p.id, t.chave, null from planos p cross join tipos_credito t
on conflict do nothing;

-- serviço CAR que o cliente aceitou pagar com crédito geral
alter table servicos add column if not exists usar_credito_geral boolean not null default false;

-- ================================================================== período do crédito
create or replace function hoje_brasil()
returns date
language sql stable
as $$
  select (now() at time zone 'America/Sao_Paulo')::date
$$;

-- O dia `p_dia` no mês de `p_ref` (31 em fevereiro = último dia).
create or replace function ancora_mes(p_dia int, p_ref date)
returns date
language sql immutable
as $$
  select date_trunc('month', p_ref::timestamp)::date
         + least(p_dia, extract(day from date_trunc('month', p_ref::timestamp) + interval '1 month' - interval '1 day')::int) - 1
$$;

create or replace function inicio_periodo(p_escritorio uuid)
returns date
language sql stable security definer
set search_path = public
as $$
  select case when x.h >= ancora_mes(x.d, x.h) then ancora_mes(x.d, x.h)
              else ancora_mes(x.d, (x.h - interval '1 month')::date) end
    from (select coalesce((select dia_renovacao from escritorios where id = p_escritorio), 1) as d, hoje_brasil() as h) x
$$;

-- Dia em que os créditos do plano renovam (o começo do próximo período).
create or replace function renovacao_periodo(p_escritorio uuid)
returns date
language sql stable security definer
set search_path = public
as $$
  select ancora_mes(coalesce((select dia_renovacao from escritorios where id = p_escritorio), 1),
                    (inicio_periodo(p_escritorio) + interval '1 month')::date)
$$;

-- ================================================================== quanto cada carteira tem
-- Créditos do mês (null = sem limite). Empresa > plano; carteira fora do plano = 0;
-- empresa sem plano = sem limite (como antes).
create or replace function franquia_credito(p_escritorio uuid, p_tipo text)
returns int
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_plano uuid;
  v_por_mes int;
begin
  select por_mes into v_por_mes from escritorio_creditos where escritorio_id = p_escritorio and tipo = p_tipo;
  if found then return v_por_mes; end if;
  select plano_id into v_plano from escritorios where id = p_escritorio;
  if v_plano is null then return null; end if;
  select por_mes into v_por_mes from plano_creditos where plano_id = v_plano and tipo = p_tipo;
  if found then return v_por_mes; end if;
  return 0;
end $$;

drop function if exists uso_credito(uuid, text, date);
-- Franquia usada no período (o extra não conta aqui).
create or replace function uso_credito(p_escritorio uuid, p_tipo text)
returns int
language sql stable security definer
set search_path = public
as $$
  select count(*)::int from consumos_credito
   where escritorio_id = p_escritorio and tipo = p_tipo and origem = 'plano'
     and created_at >= (inicio_periodo(p_escritorio)::timestamp at time zone 'America/Sao_Paulo')
$$;

-- Saldo de crédito extra (aprovado − gasto). Não vence.
drop function if exists saldo_extra(uuid, text);
create or replace function saldo_extra(p_escritorio uuid, p_tipo text)
returns int
language sql stable security definer
set search_path = public
as $$
  select coalesce((select sum(quantidade) from creditos_extras
                    where escritorio_id = p_escritorio and tipo = p_tipo and status = 'aprovado'), 0)::int
       - (select count(*) from consumos_credito
           where escritorio_id = p_escritorio and origem = 'extra' and tipo = p_tipo)::int
$$;

-- Tabela de preço do crédito extra: a da empresa, se houver; senão a do plano.
create or replace function tabela_precos(p_escritorio uuid, p_tipo text)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select jsonb_agg(jsonb_build_object('a_partir_de', a_partir_de, 'preco', preco) order by a_partir_de)
       from precos_credito where escritorio_id = p_escritorio and tipo = p_tipo),
    (select jsonb_agg(jsonb_build_object('a_partir_de', pc.a_partir_de, 'preco', pc.preco) order by pc.a_partir_de)
       from precos_credito pc join escritorios e on e.plano_id = pc.plano_id
      where e.id = p_escritorio and pc.tipo = p_tipo),
    '[]'::jsonb)
$$;

-- Preço de uma compra: unitário da faixa da quantidade × quantidade.
create or replace function cotacao_credito(p_escritorio uuid, p_tipo text, p_quantidade int)
returns table (unitario numeric, total numeric)
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_faixas jsonb := tabela_precos(p_escritorio, p_tipo);
  v_min int;
  v_unit numeric;
begin
  if jsonb_array_length(v_faixas) = 0 then
    raise exception 'Estes créditos não estão à venda no plano da empresa.' using errcode = '22023';
  end if;
  select min((f ->> 'a_partir_de')::int) into v_min from jsonb_array_elements(v_faixas) f;
  if p_quantidade is null or p_quantidade < v_min then
    raise exception 'A compra mínima é de % créditos.', v_min using errcode = '22023';
  end if;
  if p_quantidade > 1000 then
    raise exception 'Compre no máximo 1000 créditos por vez.' using errcode = '22023';
  end if;
  select (f ->> 'preco')::numeric into v_unit from jsonb_array_elements(v_faixas) f
   where (f ->> 'a_partir_de')::int <= p_quantidade
   order by (f ->> 'a_partir_de')::int desc limit 1;
  return query select v_unit, round(v_unit * p_quantidade, 2);
end $$;

-- ================================================================== de onde sai o crédito
-- Uma linha: a carteira, a origem ('plano' = franquia, 'extra' = comprado) e se é
-- crédito geral num serviço que tem carteira própria (pede o aceite). Nenhuma = acabou.
drop function if exists fonte_credito(uuid, text);
create or replace function fonte_credito(p_escritorio uuid, p_chave text)
returns table (carteira text, origem text, precisa_aceite boolean)
language plpgsql stable security definer
set search_path = public
as $$
declare
  r record;
  v_tem_propria boolean := exists (select 1 from tipos_credito t
                                     where t.ativo and t.servicos is not null and p_chave = any (t.servicos));
  v_franquia int;
begin
  for r in select t.chave, t.servicos is null as geral from tipos_credito t
            where t.ativo and (t.servicos is null or p_chave = any (t.servicos))
            order by t.servicos is null, t.ordem loop
    v_franquia := franquia_credito(p_escritorio, r.chave);
    if v_franquia is null or uso_credito(p_escritorio, r.chave) < v_franquia then
      return query select r.chave, 'plano'::text, r.geral and v_tem_propria;
      return;
    end if;
    if saldo_extra(p_escritorio, r.chave) > 0 then
      return query select r.chave, 'extra'::text, r.geral and v_tem_propria;
      return;
    end if;
  end loop;
end $$;

create or replace function pagamento_online()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from cobranca_config where key = 'asaas_api_key' and length(value) > 0)
$$;

create or replace function mensalidade_de(p_escritorio uuid)
returns numeric
language sql stable security definer
set search_path = public
as $$
  select coalesce(e.mensalidade, p.preco_mensal)
    from escritorios e left join planos p on p.id = e.plano_id
   where e.id = p_escritorio
$$;

-- Retrato para as telas: o período, cada carteira e cada serviço.
create or replace function situacao_creditos(p_escritorio uuid)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'periodo', jsonb_build_object(
      'inicio', inicio_periodo(p_escritorio),
      'renova_em', renovacao_periodo(p_escritorio),
      'dia', (select dia_renovacao from escritorios where id = p_escritorio)),
    'carteiras', coalesce((
      select jsonb_agg(jsonb_build_object(
               'chave', t.chave, 'nome', t.nome, 'descricao', t.descricao, 'servicos', to_jsonb(t.servicos),
               'por_mes', franquia_credito(p_escritorio, t.chave),
               'usado', uso_credito(p_escritorio, t.chave),
               'extra', saldo_extra(p_escritorio, t.chave),
               'precos', tabela_precos(p_escritorio, t.chave)) order by t.ordem)
        from tipos_credito t where t.ativo), '[]'::jsonb),
    'servicos', coalesce((
      select jsonb_object_agg(r.chave, jsonb_build_object(
               'disponivel', f.carteira is not null,
               'carteira', f.carteira,
               'precisa_aceite', coalesce(f.precisa_aceite, false)))
        from recursos r left join lateral fonte_credito(p_escritorio, r.chave) f on true
       where r.ativo and r.chave like 'servico.%'), '{}'::jsonb)
  )
$$;

-- ================================================================== o gasto
create or replace function consumir_credito()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_chave text := chave_recurso_do_servico(new);
  v_f record;
  v_nome text;
  v_carteira text;
begin
  if servico_derivado(new) then return new; end if;
  -- uma empresa por vez: dois envios ao mesmo tempo não passam do limite
  perform 1 from escritorios where id = new.escritorio_id for update;
  select * into v_f from fonte_credito(new.escritorio_id, v_chave);
  if v_f.carteira is null then
    select coalesce(nome, v_chave) into v_nome from recursos where chave = v_chave;
    raise exception 'SEM_CREDITO: os créditos para % acabaram. Compre mais créditos para continuar.', coalesce(v_nome, v_chave)
      using errcode = 'P0001';
  end if;
  if v_f.precisa_aceite and not coalesce(new.usar_credito_geral, false) then
    select t.nome into v_carteira from tipos_credito t
     where t.ativo and t.servicos is not null and v_chave = any (t.servicos) order by t.ordem limit 1;
    raise exception 'ACEITE_CREDITO_GERAL: os % acabaram. Este serviço pode usar 1 crédito geral, se você aceitar.', lower(coalesce(v_carteira, 'créditos próprios'))
      using errcode = 'P0001';
  end if;
  insert into consumos_credito (escritorio_id, servico_id, chave, mes, origem, tipo, com_aceite, user_id)
  values (new.escritorio_id, new.id, v_chave, inicio_periodo(new.escritorio_id), v_f.origem, v_f.carteira,
          v_f.precisa_aceite, coalesce(new.criado_por, auth.uid()));
  return new;
end $$;

-- ================================================================== recurso liberado
-- A ordem de sempre (exceção da empresa > linha do plano > padrão do catálogo),
-- com uma regra a mais: plano que não libera recursos novos bloqueia o que ele
-- ainda não decidiu.
create or replace function recurso_liberado(p_escritorio uuid, p_chave text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select liberado from escritorio_recursos where escritorio_id = p_escritorio and recurso_chave = p_chave),
    (select pr.liberado from escritorios e join plano_recursos pr on pr.plano_id = e.plano_id
      where e.id = p_escritorio and pr.recurso_chave = p_chave),
    (select false from escritorios e join planos p on p.id = e.plano_id
      where e.id = p_escritorio and not p.libera_recursos_novos),
    (select padrao from recursos where chave = p_chave),
    true
  )
$$;

-- ================================================================== o cliente
drop function if exists meus_creditos();
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
    'pagamento_online', pagamento_online(),
    'compras', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'tipo', c.tipo, 'quantidade', c.quantidade, 'valor', c.preco, 'unitario', c.valor_unitario,
               'descricao', c.descricao, 'status', c.status, 'origem', c.origem, 'created_at', c.created_at,
               'link', p.link, 'pagamento', p.status) order by c.created_at desc)
        from (select * from creditos_extras where escritorio_id = v_esc order by created_at desc limit 20) c
        left join lateral (select link, status from pagamentos where credito_id = c.id order by criado_em desc limit 1) p on true
    ), '[]'::jsonb)
  );
end $$;

-- Compra de créditos. Com o Asaas configurado nasce 'compra' + um pagamento a
-- criar (a edge function `cobranca` emite a cobrança e guarda o link); sem ele,
-- nasce um pedido que o superadmin aprova. O preço é sempre o da tabela.
drop function if exists pedir_creditos(uuid, text, int, text);
create or replace function pedir_creditos(p_tipo text, p_quantidade int, p_observacao text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_esc uuid := escritorio_atual();
  v_cot record;
  v_online boolean := pagamento_online();
  v_nome text;
  v_desc text;
  v_id uuid;
  v_pag uuid;
begin
  if v_esc is null then raise exception 'Sua conta não está ligada a uma empresa ativa.' using errcode = '42501'; end if;
  if not sou_dono_de(v_esc) then
    raise exception 'Só o dono da empresa compra créditos.' using errcode = '42501';
  end if;
  select nome into v_nome from tipos_credito where chave = p_tipo and ativo;
  if not found then raise exception 'Tipo de crédito inválido.' using errcode = '22023'; end if;
  if (select count(*) from creditos_extras where escritorio_id = v_esc and status = 'pendente') >= 5 then
    raise exception 'Há compras demais esperando pagamento. Pague ou cancele uma antes de fazer outra.' using errcode = '22023';
  end if;
  select * into v_cot from cotacao_credito(v_esc, p_tipo, p_quantidade);
  -- "10 créditos de CAR": só a primeira letra desce (a sigla fica)
  v_desc := p_quantidade || ' ' || lower(left(v_nome, 1)) || substr(v_nome, 2);
  insert into creditos_extras (escritorio_id, tipo, quantidade, preco, valor_unitario, descricao, origem, observacao, pedido_por)
  values (v_esc, p_tipo, p_quantidade, v_cot.total, v_cot.unitario, v_desc,
          case when v_online then 'compra' else 'pedido' end, nullif(trim(p_observacao), ''), auth.uid())
  returning id into v_id;
  if v_online then
    insert into pagamentos (escritorio_id, finalidade, credito_id, valor) values (v_esc, 'creditos', v_id, v_cot.total)
    returning id into v_pag;
  end if;
  perform registrar_atividade(v_esc, 'creditos.pedido', v_desc);
  return jsonb_build_object('credito_id', v_id, 'pagamento_id', v_pag, 'escritorio_id', v_esc, 'online', v_online,
                            'quantidade', p_quantidade, 'unitario', v_cot.unitario, 'valor', v_cot.total, 'descricao', v_desc);
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
  update pagamentos set status = 'CANCELADO', atualizado_em = now()
   where credito_id = p_id and status in ('CRIANDO', 'PENDING', 'OVERDUE');
end $$;

-- A tela de "falta o pagamento" e o aviso de mensalidade vencida: funciona
-- também para a empresa que ainda não está ativa (é o que ela precisa ver).
create or replace function minha_cobranca()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
           'status', e.status, 'empresa', e.nome, 'plano', p.nome,
           'valor', coalesce(c.valor, mensalidade_de(e.id)),
           'situacao', coalesce(c.situacao, 'sem_assinatura'),
           'link', c.link_pagamento, 'vencimento', c.proximo_vencimento,
           'sou_dono', m.papel = 'dono')
    from membros_escritorio m
    join escritorios e on e.id = m.escritorio_id
    left join planos p on p.id = e.plano_id
    left join cobranca_empresas c on c.escritorio_id = e.id
   where m.user_id = auth.uid()
   limit 1
$$;

-- ================================================================== o webhook (só a edge function)
-- Aplica a situação de uma cobrança do Asaas. Idempotente: o mesmo evento duas
-- vezes não dá crédito duas vezes nem ativa duas vezes. Devolve o que mudou,
-- para a função avisar no WhatsApp.
create or replace function aplicar_pagamento_asaas(p_evento text, p_pagamento jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_id text := p_pagamento ->> 'id';
  v_status text := coalesce(p_pagamento ->> 'status', 'PENDING');
  v_sub text := p_pagamento ->> 'subscription';
  v_venc date := nullif(p_pagamento ->> 'dueDate', '')::date;
  v_pago boolean := p_evento in ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED')
                    or v_status in ('CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH');
  v_estorno boolean := v_status in ('REFUNDED', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS', 'PARTIALLY_REFUNDED',
                                     'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL')
                       or p_evento in ('PAYMENT_REFUNDED', 'PAYMENT_PARTIALLY_REFUNDED', 'PAYMENT_REFUND_IN_PROGRESS',
                                       'PAYMENT_CHARGEBACK_REQUESTED', 'PAYMENT_CHARGEBACK_DISPUTE', 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL');
  v_apagado boolean := p_evento = 'PAYMENT_DELETED' or coalesce((p_pagamento ->> 'deleted')::boolean, false);
  v_pag pagamentos;
  v_cob cobranca_empresas;
  v_esc escritorios;
  v_acao text := 'atualizado';
begin
  if v_id is null then return jsonb_build_object('acao', 'ignorado', 'motivo', 'sem id'); end if;
  select * into v_pag from pagamentos where asaas_id = v_id for update;
  if not found and v_sub is not null then
    -- mensalidade nova de uma assinatura nossa (a do mês seguinte, por exemplo)
    select * into v_cob from cobranca_empresas where asaas_assinatura_id = v_sub;
    if found then
      insert into pagamentos (escritorio_id, finalidade, asaas_id, valor, status, link, vencimento)
      values (v_cob.escritorio_id, 'mensalidade', v_id, coalesce((p_pagamento ->> 'value')::numeric, 0), v_status,
              p_pagamento ->> 'invoiceUrl', v_venc)
      on conflict (asaas_id) do nothing;
      select * into v_pag from pagamentos where asaas_id = v_id for update;
    end if;
  end if;
  if v_pag.id is null then return jsonb_build_object('acao', 'ignorado', 'motivo', 'cobrança desconhecida'); end if;

  update pagamentos set
    status = case when v_apagado then 'DELETED' else v_status end,
    forma = coalesce(p_pagamento ->> 'billingType', forma),
    valor = coalesce((p_pagamento ->> 'value')::numeric, valor),
    link = coalesce(p_pagamento ->> 'invoiceUrl', link),
    vencimento = coalesce(v_venc, vencimento),
    pago_em = case when v_pago then coalesce(pago_em, now()) else pago_em end,
    atualizado_em = now()
  where id = v_pag.id;

  if v_pag.finalidade = 'creditos' then
    if v_pago and not v_estorno then
      update creditos_extras set status = 'aprovado', resolvido_em = now(),
             observacao = coalesce(observacao, 'Pago pelo Asaas')
       where id = v_pag.credito_id and status = 'pendente';
      if found then
        v_acao := 'creditos';
        perform registrar_atividade(v_pag.escritorio_id, 'creditos.pagos',
          (select descricao from creditos_extras where id = v_pag.credito_id));
      else
        v_acao := 'repetido';
      end if;
    elsif v_apagado or (v_estorno and exists (select 1 from creditos_extras where id = v_pag.credito_id and status = 'pendente')) then
      update creditos_extras set status = 'cancelado', resolvido_em = now(),
             observacao = coalesce(observacao, 'Cobrança cancelada no Asaas')
       where id = v_pag.credito_id and status = 'pendente';
      v_acao := 'cancelado';
    elsif v_estorno then
      -- o crédito já entrou (e pode ter sido usado): fica para alguém decidir
      v_acao := 'estorno';
    end if;
  else
    select * into v_cob from cobranca_empresas where escritorio_id = v_pag.escritorio_id for update;
    if v_pago and not v_estorno then
      update cobranca_empresas set situacao = 'em_dia', ultimo_pagamento_em = now(),
             link_pagamento = case when link_pagamento = (select link from pagamentos where id = v_pag.id) then null else link_pagamento end,
             proximo_vencimento = greatest(coalesce(proximo_vencimento, v_venc), (coalesce(v_venc, hoje_brasil()) + interval '1 month')::date),
             atualizado_em = now()
       where escritorio_id = v_pag.escritorio_id;
      select * into v_esc from escritorios where id = v_pag.escritorio_id for update;
      if v_esc.status = 'aguardando_pagamento' then
        update escritorios set status = 'ativo', atualizado_em = now() where id = v_esc.id;
        perform registrar_atividade(v_esc.id, 'empresa.ativada', 'mensalidade paga');
        v_acao := 'ativou';
      else
        v_acao := 'renovou';
      end if;
    elsif v_apagado then
      update cobranca_empresas set link_pagamento = null, atualizado_em = now()
       where escritorio_id = v_pag.escritorio_id and link_pagamento = (select link from pagamentos where id = v_pag.id);
      v_acao := 'cancelado';
    elsif v_estorno then
      v_acao := 'estorno';
    elsif p_evento = 'PAYMENT_OVERDUE' or v_status = 'OVERDUE' then
      update cobranca_empresas set situacao = case when situacao = 'aguardando' then situacao else 'atrasada' end,
             link_pagamento = coalesce(p_pagamento ->> 'invoiceUrl', link_pagamento), atualizado_em = now()
       where escritorio_id = v_pag.escritorio_id;
      v_acao := 'atrasou';
    elsif v_status = 'PENDING' and v_cob.escritorio_id is not null then
      -- fatura nova do mês: é ela que a empresa precisa pagar agora
      update cobranca_empresas set link_pagamento = coalesce(p_pagamento ->> 'invoiceUrl', link_pagamento),
             proximo_vencimento = coalesce(v_venc, proximo_vencimento), atualizado_em = now()
       where escritorio_id = v_pag.escritorio_id;
    end if;
  end if;
  return jsonb_build_object('acao', v_acao, 'escritorio_id', v_pag.escritorio_id, 'finalidade', v_pag.finalidade,
                            'credito_id', v_pag.credito_id, 'pagamento_id', v_pag.id);
end $$;

-- ================================================================== o superadmin
drop function if exists sa_creditos_empresa(uuid);
create or replace function sa_creditos_empresa(p_escritorio uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform exigir_superadmin();
  return situacao_creditos(p_escritorio) || jsonb_build_object(
    -- o que o plano da empresa dá e cobra, carteira a carteira
    'plano', (select jsonb_build_object(
                'id', p.id, 'nome', p.nome, 'preco_mensal', p.preco_mensal,
                'por_mes', coalesce((select jsonb_object_agg(t.chave, (select pc.por_mes from plano_creditos pc
                                        where pc.plano_id = p.id and pc.tipo = t.chave))
                                       from tipos_credito t where t.ativo), '{}'::jsonb),
                'tem_carteira', coalesce((select jsonb_object_agg(t.chave, exists (select 1 from plano_creditos pc
                                        where pc.plano_id = p.id and pc.tipo = t.chave))
                                       from tipos_credito t where t.ativo), '{}'::jsonb),
                'precos', coalesce((select jsonb_object_agg(t.chave, coalesce((select jsonb_agg(jsonb_build_object('a_partir_de', a_partir_de, 'preco', preco) order by a_partir_de)
                                        from precos_credito where plano_id = p.id and tipo = t.chave), '[]'::jsonb))
                                       from tipos_credito t where t.ativo), '{}'::jsonb))
                from escritorios e join planos p on p.id = e.plano_id where e.id = p_escritorio),
    -- o que foi combinado só com ela (chave presente = vence o plano)
    'empresa', jsonb_build_object(
      'mensalidade', (select mensalidade from escritorios where id = p_escritorio),
      'por_mes', coalesce((select jsonb_object_agg(tipo, por_mes) from escritorio_creditos where escritorio_id = p_escritorio), '{}'::jsonb),
      'precos', coalesce((select jsonb_object_agg(tipo, faixas) from (
                  select tipo, jsonb_agg(jsonb_build_object('a_partir_de', a_partir_de, 'preco', preco) order by a_partir_de) faixas
                    from precos_credito where escritorio_id = p_escritorio group by tipo) x), '{}'::jsonb)),
    'mensalidade', mensalidade_de(p_escritorio),
    'extras', coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object('quem', u.email, 'link', pg.link, 'pagamento', pg.status, 'forma', pg.forma)
                                         order by c.created_at desc)
                          from (select * from creditos_extras where escritorio_id = p_escritorio order by created_at desc limit 100) c
                          left join auth.users u on u.id = c.pedido_por
                          left join lateral (select link, status, forma from pagamentos where credito_id = c.id order by criado_em desc limit 1) pg on true),
                       '[]'::jsonb),
    'historico', coalesce((select jsonb_agg(jsonb_build_object('mes', mes, 'por_tipo', por_tipo, 'total', total) order by mes desc)
                             from (select mes, jsonb_object_agg(tipo, n) por_tipo, sum(n)::int total
                                     from (select date_trunc('month', created_at at time zone 'America/Sao_Paulo')::date mes, tipo, count(*)::int n
                                             from consumos_credito where escritorio_id = p_escritorio group by 1, 2) z
                                    group by mes order by mes desc limit 12) h), '[]'::jsonb)
  );
end $$;

-- Créditos por mês só desta empresa. p_seguir_plano = true volta ao plano;
-- senão grava p_por_mes (null = sem limite).
drop function if exists sa_definir_limite_empresa(uuid, text, int, boolean);
create or replace function sa_definir_creditos_empresa(p_escritorio uuid, p_tipo text, p_por_mes int, p_seguir_plano boolean default false)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform exigir_superadmin();
  if p_seguir_plano then
    delete from escritorio_creditos where escritorio_id = p_escritorio and tipo = p_tipo;
  else
    insert into escritorio_creditos (escritorio_id, tipo, por_mes) values (p_escritorio, p_tipo, p_por_mes)
    on conflict (escritorio_id, tipo) do update set por_mes = excluded.por_mes, atualizado_em = now();
  end if;
end $$;

-- Tabela de preço por faixa, de um plano OU de uma empresa. Lista vazia no plano
-- = a carteira não está à venda; null na empresa = volta à tabela do plano.
create or replace function sa_definir_precos(p_plano uuid, p_escritorio uuid, p_tipo text, p_faixas jsonb)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  f jsonb;
  v_ant int := 0;
begin
  perform exigir_superadmin();
  if (p_plano is null) = (p_escritorio is null) then
    raise exception 'Informe o plano ou a empresa.' using errcode = '22023';
  end if;
  if not exists (select 1 from tipos_credito where chave = p_tipo) then
    raise exception 'Tipo de crédito inválido.' using errcode = '22023';
  end if;
  if p_faixas is not null then
    if jsonb_typeof(p_faixas) <> 'array' then raise exception 'Faixas inválidas.' using errcode = '22023'; end if;
    for f in select x from jsonb_array_elements(p_faixas) x order by (x ->> 'a_partir_de')::int loop
      if (f ->> 'a_partir_de')::int is null or (f ->> 'a_partir_de')::int < 1 or (f ->> 'a_partir_de')::int > 1000 then
        raise exception 'A quantidade de cada faixa vai de 1 a 1000.' using errcode = '22023';
      end if;
      if (f ->> 'a_partir_de')::int = v_ant then
        raise exception 'Duas faixas começam em % créditos.', v_ant using errcode = '22023';
      end if;
      if (f ->> 'preco')::numeric is null or (f ->> 'preco')::numeric < 0 then
        raise exception 'Preço inválido na faixa de % créditos.', f ->> 'a_partir_de' using errcode = '22023';
      end if;
      v_ant := (f ->> 'a_partir_de')::int;
    end loop;
  end if;
  if p_plano is not null then
    delete from precos_credito where plano_id = p_plano and tipo = p_tipo;
    insert into precos_credito (plano_id, tipo, a_partir_de, preco)
    select p_plano, p_tipo, (x ->> 'a_partir_de')::int, round((x ->> 'preco')::numeric, 2)
      from jsonb_array_elements(coalesce(p_faixas, '[]'::jsonb)) x;
  else
    delete from precos_credito where escritorio_id = p_escritorio and tipo = p_tipo;
    insert into precos_credito (escritorio_id, tipo, a_partir_de, preco)
    select p_escritorio, p_tipo, (x ->> 'a_partir_de')::int, round((x ->> 'preco')::numeric, 2)
      from jsonb_array_elements(coalesce(p_faixas, '[]'::jsonb)) x;
  end if;
end $$;

-- Aprovar (o crédito passa a valer) ou recusar um pedido feito sem o Asaas, ou
-- dar baixa numa compra paga por fora.
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
  if not p_aprovar then
    update pagamentos set status = 'CANCELADO', atualizado_em = now()
     where credito_id = p_id and status in ('CRIANDO', 'PENDING', 'OVERDUE');
  end if;
end $$;

-- Crédito dado direto pelo superadmin (cortesia, venda fechada por fora).
drop function if exists sa_adicionar_creditos(uuid, text, int, text, numeric);
create or replace function sa_adicionar_creditos(p_escritorio uuid, p_tipo text, p_quantidade int, p_descricao text default null, p_preco numeric default null)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v_id uuid;
begin
  perform exigir_superadmin();
  if not exists (select 1 from tipos_credito where chave = p_tipo) then
    raise exception 'Tipo de crédito inválido.' using errcode = '22023';
  end if;
  if p_quantidade is null or p_quantidade < 1 then raise exception 'Quantidade inválida.' using errcode = '22023'; end if;
  insert into creditos_extras (escritorio_id, tipo, quantidade, preco, descricao, origem, status, pedido_por, resolvido_por, resolvido_em)
  values (p_escritorio, p_tipo, p_quantidade, p_preco, coalesce(nullif(trim(p_descricao), ''), 'Crédito adicionado'),
          'manual', 'aprovado', auth.uid(), auth.uid(), now())
  returning id into v_id;
  return v_id;
end $$;

-- Pedidos esperando o superadmin (sem o Asaas) e compras esperando pagamento.
drop function if exists sa_pedidos_credito_pendentes();
create or replace function sa_pedidos_credito_pendentes()
returns table (id uuid, escritorio_id uuid, empresa text, tipo text, quantidade int, preco numeric, descricao text,
               origem text, link text, created_at timestamptz)
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform exigir_superadmin();
  return query
  select c.id, c.escritorio_id, e.nome, c.tipo, c.quantidade, c.preco, c.descricao, c.origem,
         (select p.link from pagamentos p where p.credito_id = c.id order by p.criado_em desc limit 1), c.created_at
    from creditos_extras c join escritorios e on e.id = c.escritorio_id
   where c.status = 'pendente'
   order by c.created_at;
end $$;

-- A aba Cobrança da empresa: assinatura e pagamentos.
create or replace function sa_cobranca_empresa(p_escritorio uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform exigir_superadmin();
  return jsonb_build_object(
    'mensalidade', mensalidade_de(p_escritorio),
    'pagamento_online', pagamento_online(),
    'assinatura', (select to_jsonb(c) from cobranca_empresas c where c.escritorio_id = p_escritorio),
    'pagamentos', coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object('descricao', ce.descricao) order by p.criado_em desc)
                              from (select * from pagamentos where escritorio_id = p_escritorio order by criado_em desc limit 60) p
                              left join creditos_extras ce on ce.id = p.credito_id), '[]'::jsonb)
  );
end $$;

drop function if exists sa_empresas();
create or replace function sa_empresas()
returns table (
  id uuid, nome text, cnpj text, responsavel text, telefone text, email text, status text,
  plano_id uuid, plano text, observacoes text, created_at timestamptz,
  usuarios int, servicos int, servicos_30d int, ultimo_servico timestamptz, ultimo_acesso timestamptz,
  excecoes int, mensalidade numeric, cobranca text, vencimento date
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
         (select count(*)::int from escritorio_recursos x where x.escritorio_id = e.id),
         coalesce(e.mensalidade, p.preco_mensal),
         c.situacao, c.proximo_vencimento
    from escritorios e
    left join planos p on p.id = e.plano_id
    left join cobranca_empresas c on c.escritorio_id = e.id
   order by e.created_at desc;
end $$;

create or replace function sa_atualizar_empresa(p_escritorio uuid, p_dados jsonb)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform exigir_superadmin();
  if p_dados ? 'status' and p_dados ->> 'status' not in ('ativo', 'aguardando_pagamento', 'suspenso', 'cancelado') then
    raise exception 'Status inválido' using errcode = '22023';
  end if;
  if p_dados ? 'dia_renovacao' and coalesce((p_dados ->> 'dia_renovacao')::int, 0) not between 1 and 31 then
    raise exception 'Dia de renovação inválido' using errcode = '22023';
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
    mensalidade = case when p_dados ? 'mensalidade' then (p_dados ->> 'mensalidade')::numeric else mensalidade end,
    dia_renovacao = case when p_dados ? 'dia_renovacao' then (p_dados ->> 'dia_renovacao')::int else dia_renovacao end,
    atualizado_em = now()
  where id = p_escritorio;
  if not found then raise exception 'Empresa não encontrada' using errcode = 'P0002'; end if;
end $$;

-- ================================================================== os planos novos
-- Autônomo, Profissional e Empresarial liberam todos os serviços; o Só CAR libera
-- só o CAR (e a equipe e a integração com o GPROL). Os planos de antes saem do
-- cadastro de empresa nova, mas quem está neles continua igual (sem limite).
-- A mensalidade fica em branco: o superadmin define em Planos.
do $$
declare
  r record;
  v_id uuid;
begin
  if exists (select 1 from saas_config where key = 'planos_0034') then return; end if;
  for r in select * from (values
      ('Autônomo', 'Todos os serviços, para quem trabalha sozinho.', '#5B6B63', 10, 6, 12, 70.00, false),
      ('Profissional', 'Todos os serviços, para o escritório que cresce.', '#178552', 20, 12, 25, 60.00, false),
      ('Empresarial', 'Todos os serviços, para o escritório de volume alto.', '#0E3B2B', 30, 25, 50, 50.00, false),
      ('Só CAR', 'Só o Cadastro Ambiental Rural (CAR); os outros serviços ficam bloqueados.', '#C99A12', 40, 0, 5, null, true)
    ) as t(nome, descricao, cor, ordem, geral, car, preco_geral, so_car) loop
    select id into v_id from planos where lower(nome) = lower(r.nome);
    if v_id is null then
      insert into planos (nome, descricao, cor, ordem) values (r.nome, r.descricao, r.cor, r.ordem) returning id into v_id;
    else
      update planos set descricao = r.descricao, cor = r.cor, ordem = r.ordem, ativo = true where id = v_id;
    end if;
    update planos set libera_recursos_novos = not r.so_car where id = v_id;
    insert into plano_creditos (plano_id, tipo, por_mes) values (v_id, 'geral', r.geral), (v_id, 'car', r.car)
    on conflict (plano_id, tipo) do update set por_mes = excluded.por_mes;
    insert into plano_recursos (plano_id, recurso_chave, liberado)
    select v_id, chave, case when r.so_car then chave in ('servico.car', 'empresa.equipe', 'integracao.gprol') else true end
      from recursos
    on conflict (plano_id, recurso_chave) do update set liberado = excluded.liberado;
    delete from precos_credito where plano_id = v_id;
    if r.so_car then
      insert into precos_credito (plano_id, tipo, a_partir_de, preco) values
        (v_id, 'car', 2, 19.90), (v_id, 'car', 10, 15.00), (v_id, 'car', 51, 10.00);
    else
      insert into precos_credito (plano_id, tipo, a_partir_de, preco) values
        (v_id, 'geral', 2, r.preco_geral), (v_id, 'car', 2, 9.90);
    end if;
  end loop;
  update planos set ativo = false
   where lower(nome) not in ('autônomo', 'profissional', 'empresarial', 'só car');
  insert into saas_config (key, value) values ('planos_0034', now()::text);
end $$;

-- ================================================================== policies
drop policy if exists tipos_credito_leitura on tipos_credito;
create policy tipos_credito_leitura on tipos_credito for select to authenticated using (true);
drop policy if exists tipos_credito_superadmin on tipos_credito;
create policy tipos_credito_superadmin on tipos_credito for all to authenticated using (sou_superadmin()) with check (sou_superadmin());

drop policy if exists plano_creditos_leitura on plano_creditos;
create policy plano_creditos_leitura on plano_creditos for select to authenticated using (true);
drop policy if exists plano_creditos_superadmin on plano_creditos;
create policy plano_creditos_superadmin on plano_creditos for all to authenticated using (sou_superadmin()) with check (sou_superadmin());

drop policy if exists escritorio_creditos_leitura on escritorio_creditos;
create policy escritorio_creditos_leitura on escritorio_creditos for select to authenticated
  using (escritorio_id = escritorio_atual() or sou_superadmin());
drop policy if exists escritorio_creditos_superadmin on escritorio_creditos;
create policy escritorio_creditos_superadmin on escritorio_creditos for all to authenticated using (sou_superadmin()) with check (sou_superadmin());

drop policy if exists precos_credito_leitura on precos_credito;
create policy precos_credito_leitura on precos_credito for select to authenticated
  using (plano_id is not null or escritorio_id = escritorio_atual() or sou_superadmin());
drop policy if exists precos_credito_superadmin on precos_credito;
create policy precos_credito_superadmin on precos_credito for all to authenticated using (sou_superadmin()) with check (sou_superadmin());

-- cobrança: a empresa lê o que é dela; quem escreve é a edge function (service_role)
drop policy if exists cobranca_empresas_leitura on cobranca_empresas;
create policy cobranca_empresas_leitura on cobranca_empresas for select to authenticated
  using (escritorio_id = escritorio_atual() or sou_superadmin());
revoke insert, update, delete on cobranca_empresas from anon, authenticated;

drop policy if exists pagamentos_leitura on pagamentos;
create policy pagamentos_leitura on pagamentos for select to authenticated
  using (escritorio_id = escritorio_atual() or sou_superadmin());
revoke insert, update, delete on pagamentos from anon, authenticated;

drop policy if exists asaas_eventos_superadmin on asaas_eventos;
create policy asaas_eventos_superadmin on asaas_eventos for select to authenticated using (sou_superadmin());
revoke insert, update, delete on asaas_eventos from anon, authenticated;

-- ================================================================== permissões das funções
drop function if exists mes_credito();
drop function if exists limite_credito(uuid, text);

revoke execute on function hoje_brasil() from public, anon;
revoke execute on function ancora_mes(int, date) from public, anon;
revoke execute on function inicio_periodo(uuid) from public, anon, authenticated;
revoke execute on function renovacao_periodo(uuid) from public, anon, authenticated;
revoke execute on function franquia_credito(uuid, text) from public, anon, authenticated;
revoke execute on function uso_credito(uuid, text) from public, anon, authenticated;
revoke execute on function saldo_extra(uuid, text) from public, anon, authenticated;
revoke execute on function tabela_precos(uuid, text) from public, anon, authenticated;
revoke execute on function cotacao_credito(uuid, text, int) from public, anon, authenticated;
revoke execute on function fonte_credito(uuid, text) from public, anon, authenticated;
revoke execute on function pagamento_online() from public, anon, authenticated;
revoke execute on function mensalidade_de(uuid) from public, anon, authenticated;
revoke execute on function situacao_creditos(uuid) from public, anon, authenticated;
revoke execute on function consumir_credito() from public, anon, authenticated;
revoke execute on function aplicar_pagamento_asaas(text, jsonb) from public, anon, authenticated;
revoke execute on function meus_creditos() from public, anon;
revoke execute on function pedir_creditos(text, int, text) from public, anon;
revoke execute on function cancelar_pedido_credito(uuid) from public, anon;
revoke execute on function minha_cobranca() from public, anon;
revoke execute on function sa_creditos_empresa(uuid) from public, anon;
revoke execute on function sa_definir_creditos_empresa(uuid, text, int, boolean) from public, anon;
revoke execute on function sa_definir_precos(uuid, uuid, text, jsonb) from public, anon;
revoke execute on function sa_resolver_pedido_credito(uuid, boolean, text) from public, anon;
revoke execute on function sa_adicionar_creditos(uuid, text, int, text, numeric) from public, anon;
revoke execute on function sa_pedidos_credito_pendentes() from public, anon;
revoke execute on function sa_cobranca_empresa(uuid) from public, anon;
revoke execute on function sa_empresas() from public, anon;
revoke execute on function sa_atualizar_empresa(uuid, jsonb) from public, anon;
grant execute on function hoje_brasil() to authenticated, service_role;
grant execute on function ancora_mes(int, date) to authenticated, service_role;
grant execute on function inicio_periodo(uuid) to service_role;
grant execute on function renovacao_periodo(uuid) to service_role;
grant execute on function franquia_credito(uuid, text) to service_role;
grant execute on function mensalidade_de(uuid) to service_role;
grant execute on function situacao_creditos(uuid) to service_role;
grant execute on function aplicar_pagamento_asaas(text, jsonb) to service_role;
grant execute on function meus_creditos() to authenticated;
grant execute on function pedir_creditos(text, int, text) to authenticated;
grant execute on function cancelar_pedido_credito(uuid) to authenticated;
grant execute on function minha_cobranca() to authenticated;
grant execute on function sa_creditos_empresa(uuid) to authenticated;
grant execute on function sa_definir_creditos_empresa(uuid, text, int, boolean) to authenticated;
grant execute on function sa_definir_precos(uuid, uuid, text, jsonb) to authenticated;
grant execute on function sa_resolver_pedido_credito(uuid, boolean, text) to authenticated;
grant execute on function sa_adicionar_creditos(uuid, text, int, text, numeric) to authenticated;
grant execute on function sa_pedidos_credito_pendentes() to authenticated;
grant execute on function sa_cobranca_empresa(uuid) to authenticated;
grant execute on function sa_empresas() to authenticated;
grant execute on function sa_atualizar_empresa(uuid, jsonb) to authenticated;
