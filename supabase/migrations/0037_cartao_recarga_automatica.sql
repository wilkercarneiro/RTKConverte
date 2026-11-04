-- Cartão de crédito da empresa e compra automática de créditos.
--
-- Depende da 0034 (carteiras, cobrança pelo Asaas). O dono cadastra o cartão no
-- sistema: os dados vão da tela à edge function `cobranca` e dela ao Asaas, e
-- nunca são gravados. Aqui fica só o que identifica o cartão (bandeira, final,
-- validade) e o token do Asaas — numa tabela que ninguém lê pelo navegador.
--
--   cobranca_cartoes    — o cartão da empresa. asaas_token null = o Asaas desta
--                         conta não liberou a tokenização: o cartão fica só na
--                         assinatura (mensalidade) e não compra créditos sozinho.
--   recarga_automatica  — por carteira: quando o saldo zerar, comprar N créditos
--                         no cartão (com teto opcional por período).
--   pagamentos.automatica — a compra que a recarga fez (conta para o teto).
--
-- A cobrança em si (Asaas) é da edge function; o banco decide SE pode comprar
-- (reservar_recarga_automatica) num lugar só, com a empresa travada, para dois
-- envios ao mesmo tempo não comprarem duas vezes.
--
-- Teste local: `npm run test:rls` (tests/rls/cartao_recarga.sql).

-- ================================================================== tabelas
create table if not exists cobranca_cartoes (
  escritorio_id uuid primary key references escritorios(id) on delete cascade,
  asaas_token text,
  bandeira text,
  final text check (final is null or final ~ '^[0-9]{4}$'),
  -- 'MM/AAAA'
  validade text check (validade is null or validade ~ '^[0-9]{2}/[0-9]{4}$'),
  titular text,
  cadastrado_em timestamptz not null default now(),
  cadastrado_por uuid,
  -- a última recusa da compra automática: segura novas tentativas por um tempo
  recusa_em timestamptz,
  recusa_motivo text
);
alter table cobranca_cartoes enable row level security;
revoke all on cobranca_cartoes from anon, authenticated;

create table if not exists recarga_automatica (
  escritorio_id uuid not null references escritorios(id) on delete cascade,
  tipo text not null references tipos_credito(chave) on update cascade on delete cascade,
  ativo boolean not null default true,
  quantidade int not null check (quantidade between 1 and 1000),
  -- teto em R$ por período de crédito; null = sem teto
  limite_periodo numeric(12, 2) check (limite_periodo is null or limite_periodo > 0),
  atualizado_em timestamptz not null default now(),
  primary key (escritorio_id, tipo)
);
alter table recarga_automatica enable row level security;
drop policy if exists recarga_automatica_leitura on recarga_automatica;
create policy recarga_automatica_leitura on recarga_automatica for select to authenticated
  using (escritorio_id = escritorio_atual() or sou_superadmin());
revoke insert, update, delete on recarga_automatica from anon, authenticated;

alter table pagamentos add column if not exists automatica boolean not null default false;

-- ================================================================== leitura
-- O cartão como as telas o veem (sem o token). null = sem cartão.
create or replace function cartao_da_empresa(p_escritorio uuid)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object('bandeira', bandeira, 'final', final, 'validade', validade, 'titular', titular,
                            'reutilizavel', asaas_token is not null, 'cadastrado_em', cadastrado_em,
                            'recusa_em', recusa_em, 'recusa_motivo', recusa_motivo)
    from cobranca_cartoes where escritorio_id = p_escritorio
$$;

-- A empresa paga alguma coisa (mensalidade ou crédito à venda) e ainda não tem cartão.
create or replace function precisa_cartao(p_escritorio uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select pagamento_online()
     and not exists (select 1 from cobranca_cartoes where escritorio_id = p_escritorio)
     and (coalesce(mensalidade_de(p_escritorio), 0) > 0
          or exists (select 1 from tipos_credito t where t.ativo and jsonb_array_length(tabela_precos(p_escritorio, t.chave)) > 0))
$$;

-- Créditos que ainda dá para gastar na carteira (null = sem limite).
create or replace function restante_carteira(p_escritorio uuid, p_tipo text)
returns int
language plpgsql stable security definer
set search_path = public
as $$
declare v_franquia int := franquia_credito(p_escritorio, p_tipo);
begin
  if v_franquia is null then return null; end if;
  return greatest(v_franquia - uso_credito(p_escritorio, p_tipo), 0) + saldo_extra(p_escritorio, p_tipo);
end $$;

-- Gasto da recarga automática no período de crédito atual (pendente ou paga).
create or replace function gasto_recarga_periodo(p_escritorio uuid, p_tipo text)
returns numeric
language sql stable security definer
set search_path = public
as $$
  select coalesce(sum(p.valor), 0)
    from pagamentos p join creditos_extras c on c.id = p.credito_id
   where p.escritorio_id = p_escritorio and p.automatica and c.tipo = p_tipo
     and p.status not in ('CANCELADO', 'DELETED', 'REFUNDED')
     and p.criado_em >= (inicio_periodo(p_escritorio)::timestamp at time zone 'America/Sao_Paulo')
$$;

create or replace function recarga_da_empresa(p_escritorio uuid)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(r.tipo, jsonb_build_object(
           'ativo', r.ativo, 'quantidade', r.quantidade, 'limite_periodo', r.limite_periodo,
           'gasto_periodo', gasto_recarga_periodo(p_escritorio, r.tipo))), '{}'::jsonb)
    from recarga_automatica r where r.escritorio_id = p_escritorio
$$;

-- A tela de "falta o pagamento", o aviso de mensalidade e o aviso do cartão.
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
           'sou_dono', m.papel = 'dono',
           'pagamento_online', pagamento_online(),
           'cartao', cartao_da_empresa(e.id),
           'precisa_cartao', precisa_cartao(e.id),
           'contato', jsonb_build_object('email', e.email, 'telefone', e.telefone, 'cnpj', e.cnpj, 'responsavel', e.responsavel))
    from membros_escritorio m
    join escritorios e on e.id = m.escritorio_id
    left join planos p on p.id = e.plano_id
    left join cobranca_empresas c on c.escritorio_id = e.id
   where m.user_id = auth.uid()
   limit 1
$$;

-- O retrato dos créditos ganha o cartão e a recarga automática.
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
    'cartao', cartao_da_empresa(v_esc),
    'recarga', recarga_da_empresa(v_esc),
    'compras', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'tipo', c.tipo, 'quantidade', c.quantidade, 'valor', c.preco, 'unitario', c.valor_unitario,
               'descricao', c.descricao, 'status', c.status, 'origem', c.origem, 'created_at', c.created_at,
               'link', p.link, 'pagamento', p.status, 'automatica', coalesce(p.automatica, false), 'forma', p.forma)
               order by c.created_at desc)
        from (select * from creditos_extras where escritorio_id = v_esc order by created_at desc limit 20) c
        left join lateral (select link, status, automatica, forma from pagamentos where credito_id = c.id order by criado_em desc limit 1) p on true
    ), '[]'::jsonb)
  );
end $$;

-- ================================================================== o dono configura
create or replace function definir_recarga_automatica(p_tipo text, p_ativo boolean, p_quantidade int, p_limite numeric default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_esc uuid := escritorio_atual();
  v_cot record;
begin
  if v_esc is null or not sou_dono_de(v_esc) then
    raise exception 'Só o dono da empresa configura a compra automática.' using errcode = '42501';
  end if;
  if not exists (select 1 from tipos_credito where chave = p_tipo and ativo) then
    raise exception 'Tipo de crédito inválido.' using errcode = '22023';
  end if;
  if p_ativo then
    -- a quantidade tem de ser vendável (mínimo da tabela, máximo de 1000)
    select * into v_cot from cotacao_credito(v_esc, p_tipo, p_quantidade);
    if p_limite is not null and p_limite < v_cot.total then
      raise exception 'O limite por mês (R$ %) é menor que uma compra (R$ %).', p_limite, v_cot.total using errcode = '22023';
    end if;
  end if;
  insert into recarga_automatica (escritorio_id, tipo, ativo, quantidade, limite_periodo)
  values (v_esc, p_tipo, p_ativo, greatest(coalesce(p_quantidade, 1), 1), p_limite)
  on conflict (escritorio_id, tipo) do update
    set ativo = excluded.ativo, quantidade = excluded.quantidade, limite_periodo = excluded.limite_periodo, atualizado_em = now();
  perform registrar_atividade(v_esc, 'creditos.recarga',
    case when p_ativo then 'compra automática ligada: ' || p_quantidade || ' ' || p_tipo else 'compra automática desligada: ' || p_tipo end);
  return recarga_da_empresa(v_esc);
end $$;

-- ================================================================== a edge function reserva
-- Decide se a recarga pode comprar agora e, se pode, cria o pedido e o
-- pagamento (automatica) — a função cobra o cartão em seguida. Devolve
-- {pode:false, motivo} quando não compra. Uma empresa por vez (for update).
create or replace function reservar_recarga_automatica(p_escritorio uuid, p_tipo text, p_user uuid)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_cfg recarga_automatica;
  v_cartao cobranca_cartoes;
  v_restante int;
  v_cot record;
  v_nome text;
  v_desc text;
  v_id uuid;
  v_pag uuid;
begin
  perform 1 from escritorios where id = p_escritorio and status = 'ativo' for update;
  if not found then return jsonb_build_object('pode', false, 'motivo', 'empresa_inativa'); end if;
  if not pagamento_online() then return jsonb_build_object('pode', false, 'motivo', 'sem_asaas'); end if;
  select * into v_cfg from recarga_automatica where escritorio_id = p_escritorio and tipo = p_tipo;
  if not found or not v_cfg.ativo then return jsonb_build_object('pode', false, 'motivo', 'desligada'); end if;
  select * into v_cartao from cobranca_cartoes where escritorio_id = p_escritorio;
  if not found or v_cartao.asaas_token is null then return jsonb_build_object('pode', false, 'motivo', 'sem_cartao'); end if;
  if v_cartao.recusa_em is not null and v_cartao.recusa_em > now() - interval '6 hours' then
    return jsonb_build_object('pode', false, 'motivo', 'recusado', 'recusa_motivo', v_cartao.recusa_motivo);
  end if;
  v_restante := restante_carteira(p_escritorio, p_tipo);
  if v_restante is null or v_restante > 0 then return jsonb_build_object('pode', false, 'motivo', 'tem_saldo', 'restante', v_restante); end if;
  -- outra recarga desta carteira ainda em curso (a função cobra e confirma em segundos)
  if exists (select 1 from pagamentos p join creditos_extras c on c.id = p.credito_id
              where p.escritorio_id = p_escritorio and p.automatica and c.tipo = p_tipo and c.status = 'pendente'
                and p.criado_em > now() - interval '10 minutes') then
    return jsonb_build_object('pode', false, 'motivo', 'em_andamento');
  end if;
  select * into v_cot from cotacao_credito(p_escritorio, p_tipo, v_cfg.quantidade);
  if v_cfg.limite_periodo is not null and gasto_recarga_periodo(p_escritorio, p_tipo) + v_cot.total > v_cfg.limite_periodo then
    return jsonb_build_object('pode', false, 'motivo', 'limite', 'limite', v_cfg.limite_periodo,
                              'gasto', gasto_recarga_periodo(p_escritorio, p_tipo));
  end if;
  select nome into v_nome from tipos_credito where chave = p_tipo;
  v_desc := v_cfg.quantidade || ' ' || lower(left(v_nome, 1)) || substr(v_nome, 2);
  insert into creditos_extras (escritorio_id, tipo, quantidade, preco, valor_unitario, descricao, origem, observacao, pedido_por)
  values (p_escritorio, p_tipo, v_cfg.quantidade, v_cot.total, v_cot.unitario, v_desc, 'compra', 'Compra automática no cartão', p_user)
  returning id into v_id;
  insert into pagamentos (escritorio_id, finalidade, credito_id, valor, automatica)
  values (p_escritorio, 'creditos', v_id, v_cot.total, true)
  returning id into v_pag;
  perform registrar_atividade(p_escritorio, 'creditos.recarga', v_desc || ' (compra automática)');
  return jsonb_build_object('pode', true, 'credito_id', v_id, 'pagamento_id', v_pag, 'escritorio_id', p_escritorio,
                            'quantidade', v_cfg.quantidade, 'unitario', v_cot.unitario, 'valor', v_cot.total, 'descricao', v_desc);
end $$;

-- ================================================================== o superadmin vê o cartão
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
    'cartao', cartao_da_empresa(p_escritorio),
    'recarga', recarga_da_empresa(p_escritorio),
    'pagamentos', coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object('descricao', ce.descricao) order by p.criado_em desc)
                              from (select * from pagamentos where escritorio_id = p_escritorio order by criado_em desc limit 60) p
                              left join creditos_extras ce on ce.id = p.credito_id), '[]'::jsonb)
  );
end $$;

-- ================================================================== permissões
revoke execute on function cartao_da_empresa(uuid) from public, anon, authenticated;
revoke execute on function precisa_cartao(uuid) from public, anon, authenticated;
revoke execute on function restante_carteira(uuid, text) from public, anon, authenticated;
revoke execute on function gasto_recarga_periodo(uuid, text) from public, anon, authenticated;
revoke execute on function recarga_da_empresa(uuid) from public, anon, authenticated;
revoke execute on function reservar_recarga_automatica(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function definir_recarga_automatica(text, boolean, int, numeric) from public, anon;
revoke execute on function minha_cobranca() from public, anon;
revoke execute on function meus_creditos() from public, anon;
grant execute on function cartao_da_empresa(uuid) to service_role;
grant execute on function precisa_cartao(uuid) to service_role;
grant execute on function restante_carteira(uuid, text) to service_role;
grant execute on function gasto_recarga_periodo(uuid, text) to service_role;
grant execute on function recarga_da_empresa(uuid) to service_role;
grant execute on function reservar_recarga_automatica(uuid, text, uuid) to service_role;
grant execute on function definir_recarga_automatica(text, boolean, int, numeric) to authenticated;
grant execute on function minha_cobranca() to authenticated;
grant execute on function meus_creditos() to authenticated;
grant select, insert, update, delete on cobranca_cartoes to service_role;
grant select, insert, update, delete on recarga_automatica to service_role;
