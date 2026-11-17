-- Cupons de desconto do cadastro (pedido do Wilker, 17/11/2026): a equipe cria
-- no painel (Configurações → Cupons) e a pessoa digita no cadastro (#/assinar,
-- ou já vem no link: /cadastro/?plano=…&cupom=CODIGO).
--
-- Um cupom vale para a ADESÃO, para a MENSALIDADE ou para as duas:
--   adesão      — percentual (1–100%), valor (R$ a menos) ou isenção;
--   mensalidade — percentual (1–99%) ou valor (R$ a menos em cada cobrança), nas N
--                 primeiras cobranças (null = em todas); ou isenção de N meses (1–24):
--                 a 1ª cobrança só vence N meses depois.
-- E pode ter validade (até o fim do dia, no horário de Brasília), limite de usos
-- e valer só para alguns planos. A conta mora em supabase/functions/_shared/cupons.ts.
--
--   cupons                           — os cupons (só superadmin e service_role)
--   cupons_usos                      — um uso por empresa; a empresa apagada (cadastro
--                                      abandonado) devolve o uso
--   cobranca_empresas.cupom          — a FOTO do cupom no dia do cadastro: mudar ou
--                                      desativar o cupom depois não mexe em quem já usou
--   cobranca_empresas.cupom_id
--   cobranca_empresas.cupom_desconto_ate — o fim do desconto da mensalidade (a 1ª
--                                      cobrança + N períodos); null = ainda não começou
--                                      ou o desconto é em todas
--
-- Quem fala com o Asaas é a função `cobranca`; aqui só a regra (conferir_cupom,
-- reservar_cupom: o limite de usos sob trava) e o painel.
-- Depende da 0034, 0040, 0044, 0049 e 0050 (redefine minha_cobranca). Idempotente.
-- Teste local: `npm run test:rls` (tests/rls/cupons.sql).

-- ================================================================== tabelas
create table if not exists cupons (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (codigo ~ '^[A-Z0-9_-]{3,30}$'),
  -- anotação da equipe (o cliente não vê)
  descricao text check (descricao is null or length(descricao) <= 200),
  adesao_tipo text check (adesao_tipo in ('percentual', 'valor', 'isencao')),
  adesao_valor numeric(12,2),
  mensalidade_tipo text check (mensalidade_tipo in ('percentual', 'valor', 'isencao')),
  mensalidade_valor numeric(12,2),
  mensalidade_vezes int,
  isencao_meses int,
  -- null = todos os planos
  planos uuid[],
  max_usos int check (max_usos is null or max_usos between 1 and 100000),
  -- vale até o fim deste dia (Brasília); null = sem prazo
  valido_ate date,
  ativo boolean not null default true,
  criado_por uuid,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint cupons_algum_alvo check (adesao_tipo is not null or mensalidade_tipo is not null),
  constraint cupons_adesao_valida check (
    adesao_tipo is null or adesao_tipo = 'isencao'
    or (adesao_tipo = 'percentual' and adesao_valor > 0 and adesao_valor <= 100)
    or (adesao_tipo = 'valor' and adesao_valor > 0 and adesao_valor <= 20000)),
  constraint cupons_mensalidade_valida check (
    mensalidade_tipo is null
    or (mensalidade_tipo = 'isencao' and isencao_meses between 1 and 24)
    or (mensalidade_tipo = 'percentual' and mensalidade_valor > 0 and mensalidade_valor < 100
        and (mensalidade_vezes is null or mensalidade_vezes between 1 and 60))
    or (mensalidade_tipo = 'valor' and mensalidade_valor > 0 and mensalidade_valor <= 20000
        and (mensalidade_vezes is null or mensalidade_vezes between 1 and 60)))
);
alter table cupons enable row level security;
revoke all on cupons from anon, authenticated;
grant all on cupons to service_role;

create table if not exists cupons_usos (
  id uuid primary key default gen_random_uuid(),
  cupom_id uuid not null references cupons(id) on delete cascade,
  -- uma empresa usa um cupom só; apagada a empresa, o uso volta
  escritorio_id uuid not null unique references escritorios(id) on delete cascade,
  usado_em timestamptz not null default now()
);
create index if not exists cupons_usos_cupom on cupons_usos (cupom_id);
alter table cupons_usos enable row level security;
revoke all on cupons_usos from anon, authenticated;
grant all on cupons_usos to service_role;

alter table cobranca_empresas add column if not exists cupom_id uuid references cupons(id) on delete set null;
alter table cobranca_empresas add column if not exists cupom jsonb;
alter table cobranca_empresas add column if not exists cupom_desconto_ate date;

-- ================================================================== a regra
-- A foto do cupom que vai para a empresa (e para a página de cadastro).
create or replace function cupom_foto(c cupons)
returns jsonb
language sql immutable
set search_path = public
as $$
  select jsonb_build_object(
    'codigo', c.codigo,
    'adesao_tipo', c.adesao_tipo, 'adesao_valor', c.adesao_valor,
    'mensalidade_tipo', c.mensalidade_tipo, 'mensalidade_valor', c.mensalidade_valor,
    'mensalidade_vezes', c.mensalidade_vezes, 'isencao_meses', c.isencao_meses)
$$;

-- Os usos que contam no limite: o cadastro do site que ficou 24 h sem pagar não
-- segura o cupom (some de vez quando der lugar a outro cadastro ou for apagado).
create or replace function cupom_usos(p_cupom uuid)
returns int
language sql stable security definer
set search_path = public
as $$
  select count(*)::int
    from cupons_usos u join escritorios e on e.id = u.escritorio_id
   where u.cupom_id = p_cupom
     and not (e.status = 'aguardando_pagamento' and e.origem = 'site' and u.usado_em < now() - interval '24 hours')
$$;

-- Por que o cupom não vale para este plano agora (null = vale).
create or replace function cupom_problema(c cupons, p_plano uuid)
returns text
language sql stable security definer
set search_path = public
as $$
  select case
    when not c.ativo then 'inativo'
    when c.valido_ate is not null and hoje_brasil() > c.valido_ate then 'expirado'
    when c.max_usos is not null and cupom_usos(c.id) >= c.max_usos then 'esgotado'
    when c.planos is not null and cardinality(c.planos) > 0 and (p_plano is null or not (p_plano = any (c.planos))) then 'plano'
  end
$$;

-- Só a função `cobranca` (service_role): o cupom digitado no cadastro vale?
-- { valido: true, cupom: <foto> } ou { valido: false, motivo }.
create or replace function conferir_cupom(p_codigo text, p_plano uuid default null)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v cupons;
  v_motivo text;
begin
  if coalesce(p_codigo, '') !~ '^[A-Z0-9_-]{3,30}$' then return jsonb_build_object('valido', false, 'motivo', 'inexistente'); end if;
  select * into v from cupons where codigo = p_codigo;
  if not found then return jsonb_build_object('valido', false, 'motivo', 'inexistente'); end if;
  v_motivo := cupom_problema(v, p_plano);
  if v_motivo is not null then return jsonb_build_object('valido', false, 'motivo', v_motivo); end if;
  return jsonb_build_object('valido', true, 'cupom', cupom_foto(v));
end $$;

-- Só a função `cobranca`, no cadastro, depois de criar a empresa: confere de
-- novo SOB TRAVA (dois cadastros ao mesmo tempo não passam do limite), grava o
-- uso e a foto na cobrança da empresa. Não vale: { valido: false, motivo } e
-- nada é gravado (a função desfaz o cadastro).
create or replace function reservar_cupom(p_codigo text, p_plano uuid, p_escritorio uuid)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v cupons;
  v_motivo text;
begin
  if coalesce(p_codigo, '') !~ '^[A-Z0-9_-]{3,30}$' then return jsonb_build_object('valido', false, 'motivo', 'inexistente'); end if;
  select * into v from cupons where codigo = p_codigo for update;
  if not found then return jsonb_build_object('valido', false, 'motivo', 'inexistente'); end if;
  v_motivo := cupom_problema(v, p_plano);
  if v_motivo is not null then return jsonb_build_object('valido', false, 'motivo', v_motivo); end if;
  insert into cupons_usos (cupom_id, escritorio_id) values (v.id, p_escritorio);
  insert into cobranca_empresas (escritorio_id, cupom_id, cupom)
  values (p_escritorio, v.id, cupom_foto(v))
  on conflict (escritorio_id) do update set cupom_id = excluded.cupom_id, cupom = excluded.cupom, atualizado_em = now();
  perform registrar_atividade(p_escritorio, 'cobranca.cupom', v.codigo);
  return jsonb_build_object('valido', true, 'cupom', cupom_foto(v));
end $$;

-- ================================================================== o superadmin
create or replace function sa_cupons()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform exigir_superadmin();
  return coalesce((
    select jsonb_agg(to_jsonb(c) || jsonb_build_object(
             'usos', cupom_usos(c.id),
             'situacao', case when not c.ativo then 'inativo'
                              when c.valido_ate is not null and hoje_brasil() > c.valido_ate then 'expirado'
                              when c.max_usos is not null and cupom_usos(c.id) >= c.max_usos then 'esgotado'
                              else 'ativo' end,
             'nomes_planos', (select coalesce(jsonb_agg(p.nome order by p.ordem, p.nome), '[]'::jsonb) from planos p where p.id = any (coalesce(c.planos, '{}'))),
             'empresas', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'nome', e.nome, 'status', e.status, 'usado_em', u.usado_em)
                                                    order by u.usado_em desc), '[]'::jsonb)
                            from (select * from cupons_usos where cupom_id = c.id order by usado_em desc limit 30) u
                            join escritorios e on e.id = u.escritorio_id))
           order by c.ativo desc, c.criado_em desc)
      from cupons c), '[]'::jsonb);
end $$;

-- Cria (p_id null) ou altera um cupom. Mudar o cupom não mexe em quem já usou
-- (a empresa guarda a foto do dia do cadastro).
create or replace function sa_salvar_cupom(p_id uuid, p_dados jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_codigo text := upper(regexp_replace(coalesce(p_dados ->> 'codigo', ''), '[^A-Za-z0-9_-]', '', 'g'));
  v_planos uuid[];
  v cupons;
begin
  perform exigir_superadmin();
  if v_codigo !~ '^[A-Z0-9_-]{3,30}$' then
    raise exception 'O código tem de 3 a 30 letras ou números (pode usar - e _).' using errcode = '22023';
  end if;
  if exists (select 1 from cupons where codigo = v_codigo and id is distinct from p_id) then
    raise exception 'Já existe um cupom com o código %.', v_codigo using errcode = '23505';
  end if;
  if jsonb_typeof(p_dados -> 'planos') = 'array' and jsonb_array_length(p_dados -> 'planos') > 0 then
    select array_agg(x::uuid) into v_planos from jsonb_array_elements_text(p_dados -> 'planos') x;
    if exists (select 1 from unnest(v_planos) x where not exists (select 1 from planos p where p.id = x)) then
      raise exception 'Plano desconhecido na lista do cupom.' using errcode = '22023';
    end if;
  end if;
  begin
    if p_id is null then
      insert into cupons (codigo, descricao, adesao_tipo, adesao_valor, mensalidade_tipo, mensalidade_valor,
                          mensalidade_vezes, isencao_meses, planos, max_usos, valido_ate, ativo, criado_por)
      values (v_codigo, nullif(left(btrim(coalesce(p_dados ->> 'descricao', '')), 200), ''),
              nullif(p_dados ->> 'adesao_tipo', ''), nullif(p_dados ->> 'adesao_valor', '')::numeric,
              nullif(p_dados ->> 'mensalidade_tipo', ''), nullif(p_dados ->> 'mensalidade_valor', '')::numeric,
              nullif(p_dados ->> 'mensalidade_vezes', '')::int, nullif(p_dados ->> 'isencao_meses', '')::int,
              v_planos, nullif(p_dados ->> 'max_usos', '')::int, nullif(p_dados ->> 'valido_ate', '')::date,
              coalesce((p_dados ->> 'ativo')::boolean, true), auth.uid())
      returning * into v;
    else
      update cupons set
        codigo = v_codigo,
        descricao = nullif(left(btrim(coalesce(p_dados ->> 'descricao', '')), 200), ''),
        adesao_tipo = nullif(p_dados ->> 'adesao_tipo', ''),
        adesao_valor = nullif(p_dados ->> 'adesao_valor', '')::numeric,
        mensalidade_tipo = nullif(p_dados ->> 'mensalidade_tipo', ''),
        mensalidade_valor = nullif(p_dados ->> 'mensalidade_valor', '')::numeric,
        mensalidade_vezes = nullif(p_dados ->> 'mensalidade_vezes', '')::int,
        isencao_meses = nullif(p_dados ->> 'isencao_meses', '')::int,
        planos = v_planos,
        max_usos = nullif(p_dados ->> 'max_usos', '')::int,
        valido_ate = nullif(p_dados ->> 'valido_ate', '')::date,
        ativo = coalesce((p_dados ->> 'ativo')::boolean, ativo),
        atualizado_em = now()
      where id = p_id
      returning * into v;
      if not found then raise exception 'Cupom não encontrado.' using errcode = 'P0002'; end if;
    end if;
  exception when check_violation then
    raise exception 'Confira o cupom: escolha onde ele vale (adesão e/ou mensalidade) e os valores (percentual de 1 a 100 na adesão e de 1 a 99 na mensalidade; isenção de 1 a 24 meses; de 1 a 60 cobranças).' using errcode = '22023';
  end;
  -- o tipo que não usa um campo não guarda lixo nele
  update cupons set
    adesao_valor = case when adesao_tipo in ('percentual', 'valor') then adesao_valor end,
    mensalidade_valor = case when mensalidade_tipo in ('percentual', 'valor') then mensalidade_valor end,
    mensalidade_vezes = case when mensalidade_tipo in ('percentual', 'valor') then mensalidade_vezes end,
    isencao_meses = case when mensalidade_tipo = 'isencao' then isencao_meses end
  where id = v.id
  returning * into v;
  return to_jsonb(v);
end $$;

-- Liga ou desliga sem apagar (o cupom usado não pode ser apagado: o histórico fica).
create or replace function sa_ativar_cupom(p_id uuid, p_ativo boolean)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform exigir_superadmin();
  update cupons set ativo = coalesce(p_ativo, false), atualizado_em = now() where id = p_id;
  if not found then raise exception 'Cupom não encontrado.' using errcode = 'P0002'; end if;
end $$;

create or replace function sa_excluir_cupom(p_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform exigir_superadmin();
  if exists (select 1 from cupons_usos where cupom_id = p_id) then
    raise exception 'Este cupom já foi usado: desative-o em vez de excluir (o histórico das empresas fica).' using errcode = '22023';
  end if;
  delete from cupons where id = p_id;
  if not found then raise exception 'Cupom não encontrado.' using errcode = 'P0002'; end if;
end $$;

-- ================================================================== a tela de pagamento (0050 + o cupom)
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
           'sou_dono', m.papel = 'dono' and m.escritorio_id = e.id,
           'pagamento_online', pagamento_online(),
           'cartao', cartao_da_empresa(e.id),
           'precisa_cartao', precisa_cartao(e.id),
           'contato', jsonb_build_object('email', e.email, 'telefone', e.telefone, 'cnpj', e.cnpj, 'responsavel', e.responsavel),
           'ciclo', coalesce(c.ciclo, 'MONTHLY'),
           'origem', e.origem,
           'plano_id', e.plano_id,
           'mensalidade', mensalidade_de(e.id),
           'mensalidade_detalhe', mensalidade_detalhe(e.id),
           'assinatura', c.asaas_assinatura_id is not null,
           'regras', regras_cadastro(),
           'inicio_no_primeiro_credito', coalesce(c.inicio_no_primeiro_credito, false),
           'primeiro_credito_em', c.primeiro_credito_em,
           'mensalidade_iniciada_em', c.mensalidade_iniciada_em,
           'mensalidade_a_iniciar', coalesce(c.inicio_no_primeiro_credito and c.primeiro_credito_em is not null
                                             and c.mensalidade_iniciada_em is null, false),
           -- 0052: o cupom usado no cadastro (a foto) e o fim do desconto da mensalidade
           'cupom', c.cupom,
           'cupom_desconto_ate', c.cupom_desconto_ate,
           'ultimo_pagamento', (
             select jsonb_build_object('status', x.status, 'forma', x.forma, 'parcelas', x.parcelas, 'valor', x.valor,
                                       'ciclo', x.ciclo, 'adesao', x.adesao, 'criado_em', x.criado_em)
               from pagamentos x
              where x.escritorio_id = e.id and x.finalidade = 'mensalidade'
              order by x.criado_em desc limit 1))
    from membros_escritorio m
    join escritorios e on e.id = coalesce((select matriz_id from escritorios where id = m.escritorio_id), m.escritorio_id)
    left join planos p on p.id = e.plano_id
    left join cobranca_empresas c on c.escritorio_id = e.id
   where m.user_id = auth.uid()
   limit 1
$$;

-- ================================================================== o webhook (0044 + o pagamento só da adesão)
-- pagamentos.sem_periodo — o 1º pagamento com os meses grátis do cupom: só a
-- adesão, sem período. Pago, ativa a empresa e pede a assinatura (como a compra
-- avulsa com adesão), mas não empurra o vencimento um período.
alter table pagamentos add column if not exists sem_periodo boolean not null default false;

create or replace function aplicar_pagamento_asaas(p_evento text, p_pagamento jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_id text := p_pagamento ->> 'id';
  v_status text := coalesce(p_pagamento ->> 'status', 'PENDING');
  v_sub text := p_pagamento ->> 'subscription';
  v_inst text := nullif(p_pagamento ->> 'installment', '');
  v_venc date := nullif(p_pagamento ->> 'dueDate', '')::date;
  v_recusa boolean := p_evento in ('PAYMENT_REPROVED_BY_RISK_ANALYSIS', 'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED');
  v_analise boolean;
  v_pago boolean;
  v_estorno boolean := v_status in ('REFUNDED', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS', 'PARTIALLY_REFUNDED',
                                     'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL')
                       or p_evento in ('PAYMENT_REFUNDED', 'PAYMENT_PARTIALLY_REFUNDED', 'PAYMENT_REFUND_IN_PROGRESS',
                                       'PAYMENT_CHARGEBACK_REQUESTED', 'PAYMENT_CHARGEBACK_DISPUTE', 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL');
  v_apagado boolean := p_evento = 'PAYMENT_DELETED' or coalesce((p_pagamento ->> 'deleted')::boolean, false);
  v_pag pagamentos;
  v_principal pagamentos;
  v_cob cobranca_empresas;
  v_esc escritorios;
  v_acao text := 'atualizado';
  v_primeira boolean;
  v_meses int;
  v_criar_assinatura boolean := false;
begin
  if v_id is null then return jsonb_build_object('acao', 'ignorado', 'motivo', 'sem id'); end if;
  -- aprovada na análise: é pagamento confirmado, mesmo que o aviso ainda traga o status antigo
  if p_evento = 'PAYMENT_APPROVED_BY_RISK_ANALYSIS' and v_status = 'AWAITING_RISK_ANALYSIS' then v_status := 'CONFIRMED'; end if;
  v_analise := not v_recusa and (p_evento = 'PAYMENT_AWAITING_RISK_ANALYSIS' or v_status = 'AWAITING_RISK_ANALYSIS');
  v_pago := not v_recusa and not v_analise
            and (p_evento in ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_APPROVED_BY_RISK_ANALYSIS')
                 or v_status in ('CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'));

  select * into v_pag from pagamentos where asaas_id = v_id for update;
  if not found and v_sub is not null then
    -- mensalidade nova de uma assinatura nossa (a do período seguinte, por exemplo)
    select * into v_cob from cobranca_empresas where asaas_assinatura_id = v_sub;
    if found then
      insert into pagamentos (escritorio_id, finalidade, asaas_id, valor, status, link, vencimento, ciclo)
      values (v_cob.escritorio_id, 'mensalidade', v_id, coalesce((p_pagamento ->> 'value')::numeric, 0), v_status,
              p_pagamento ->> 'invoiceUrl', v_venc, v_cob.ciclo)
      on conflict (asaas_id) do nothing;
      select * into v_pag from pagamentos where asaas_id = v_id for update;
    end if;
  end if;
  if v_pag.id is null and v_inst is not null then
    -- (b) parcela 2..N de uma compra parcelada nossa (só a 1ª tem o id gravado)
    select * into v_principal from pagamentos
     where asaas_parcelamento = v_inst and finalidade = 'mensalidade' order by criado_em limit 1;
    if found then
      insert into pagamentos (escritorio_id, finalidade, asaas_id, valor, status, forma, link, vencimento,
                              asaas_parcelamento, parcela, ciclo)
      values (v_principal.escritorio_id, 'parcela', v_id, coalesce((p_pagamento ->> 'value')::numeric, 0), v_status,
              p_pagamento ->> 'billingType', p_pagamento ->> 'invoiceUrl', v_venc, v_inst,
              case when p_pagamento ->> 'installmentNumber' ~ '^[0-9]{1,2}$'
                   then least((p_pagamento ->> 'installmentNumber')::int, 24) end,
              v_principal.ciclo)
      on conflict (asaas_id) do nothing;
      select * into v_pag from pagamentos where asaas_id = v_id for update;
    end if;
  end if;
  if v_pag.id is null then return jsonb_build_object('acao', 'ignorado', 'motivo', 'cobrança desconhecida'); end if;

  v_primeira := v_pago and v_pag.pago_em is null;
  update pagamentos set
    status = case when v_apagado then 'DELETED'
                  when p_evento = 'PAYMENT_REPROVED_BY_RISK_ANALYSIS' then 'REPROVADO'
                  else v_status end,
    forma = coalesce(p_pagamento ->> 'billingType', forma),
    -- (d) a compra parcelada guarda o total: o aviso traz o valor de uma parcela
    valor = case when coalesce(v_pag.parcelas, 1) > 1 then valor else coalesce((p_pagamento ->> 'value')::numeric, valor) end,
    link = coalesce(p_pagamento ->> 'invoiceUrl', link),
    vencimento = coalesce(v_venc, vencimento),
    pago_em = case when v_pago then coalesce(pago_em, now()) else pago_em end,
    atualizado_em = now()
  where id = v_pag.id;

  if v_pag.finalidade = 'parcela' then
    -- (b) o período foi pago (e ativado) na 1ª parcela: aqui nada liga nem desliga
    if v_estorno or v_apagado then
      perform registrar_atividade(v_pag.escritorio_id, 'pagamento.parcela_estornada',
        'parcela ' || coalesce(v_pag.parcela::text, '?') || ' de ' || coalesce(v_pag.asaas_parcelamento, '?') || ': '
        || case when v_apagado then 'DELETED' else v_status end);
      v_acao := 'estorno_parcela';
    else
      v_acao := 'parcela';
    end if;
  elsif v_analise then
    -- (c) o Asaas está analisando o cartão: espera a aprovação (ou a recusa)
    v_acao := 'em_analise';
  elsif v_recusa then
    if v_pag.finalidade = 'creditos' and p_evento = 'PAYMENT_REPROVED_BY_RISK_ANALYSIS' then
      update creditos_extras set status = 'cancelado', resolvido_em = now(),
             observacao = coalesce(observacao, 'Pagamento reprovado na análise de risco')
       where id = v_pag.credito_id and status = 'pendente';
    end if;
    v_acao := 'recusado';
  elsif v_pag.finalidade = 'creditos' then
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
    -- (a) o período que este pagamento cobre (o da compra; senão o da assinatura)
    -- 0052: o pagamento só da adesão (o cupom isentou os primeiros meses) não cobre
    -- período: o próximo vencimento fica o que a função gravou (o fim da isenção)
    v_meses := case when coalesce(v_pag.sem_periodo, false) then 0
                    else case coalesce(v_pag.ciclo, v_cob.ciclo, 'MONTHLY') when 'SEMIANNUALLY' then 6 when 'YEARLY' then 12 else 1 end end;
    if v_pago and not v_estorno then
      update cobranca_empresas set situacao = 'em_dia', ultimo_pagamento_em = now(),
             link_pagamento = case when link_pagamento = (select link from pagamentos where id = v_pag.id) then null else link_pagamento end,
             proximo_vencimento = greatest(coalesce(proximo_vencimento, v_venc),
                                           (coalesce(v_venc, hoje_brasil()) + make_interval(months => v_meses))::date),
             atualizado_em = now()
       where escritorio_id = v_pag.escritorio_id;
      -- (d) compra parcelada paga agora pela 1ª vez e a empresa sem assinatura no Asaas
      --     (0044) ou a compra avulsa do 1º período com a adesão (Pix ou cartão)
      v_criar_assinatura := v_primeira and v_pag.finalidade = 'mensalidade' and v_sub is null
                            and ((v_pag.asaas_parcelamento is not null and coalesce(v_pag.parcelas, 1) > 1)
                                 or coalesce(v_pag.adesao, 0) > 0)
                            and v_cob.escritorio_id is not null and v_cob.asaas_assinatura_id is null;
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
      -- mensalidade vencida suspende o acesso (pedido do Wilker, 2026-10-30): a
      -- empresa volta a "aguardando pagamento" e o pagamento a reativa sozinho.
      -- Suspensão manual ('suspenso') não é tocada aqui nem pelo pagamento.
      select * into v_esc from escritorios where id = v_pag.escritorio_id for update;
      if v_esc.status = 'ativo' then
        update escritorios set status = 'aguardando_pagamento', atualizado_em = now() where id = v_esc.id;
        perform registrar_atividade(v_esc.id, 'empresa.suspensa', 'mensalidade vencida');
        v_acao := 'suspendeu';
      else
        v_acao := 'atrasou';
      end if;
    elsif v_status = 'PENDING' and v_cob.escritorio_id is not null then
      -- fatura nova do período: é ela que a empresa precisa pagar agora
      -- (0052: a fatura só da adesão não é a mensalidade: o vencimento gravado é o do fim da isenção)
      update cobranca_empresas set link_pagamento = coalesce(p_pagamento ->> 'invoiceUrl', link_pagamento),
             proximo_vencimento = case when coalesce(v_pag.sem_periodo, false) then proximo_vencimento
                                       else coalesce(v_venc, proximo_vencimento) end, atualizado_em = now()
       where escritorio_id = v_pag.escritorio_id;
    end if;
  end if;
  return jsonb_build_object('acao', v_acao, 'escritorio_id', v_pag.escritorio_id, 'finalidade', v_pag.finalidade,
                            'credito_id', v_pag.credito_id, 'pagamento_id', v_pag.id)
         || case when v_criar_assinatura
                 then jsonb_build_object('criar_assinatura', true, 'ciclo', coalesce(v_pag.ciclo, v_cob.ciclo),
                        'proximo_vencimento', (select proximo_vencimento from cobranca_empresas where escritorio_id = v_pag.escritorio_id))
                 else '{}'::jsonb end;
end $$;

-- ================================================================== permissões
revoke execute on function cupom_foto(cupons) from public, anon, authenticated;
grant execute on function cupom_foto(cupons) to service_role;
revoke execute on function cupom_usos(uuid) from public, anon, authenticated;
grant execute on function cupom_usos(uuid) to service_role;
revoke execute on function cupom_problema(cupons, uuid) from public, anon, authenticated;
grant execute on function cupom_problema(cupons, uuid) to service_role;
revoke execute on function conferir_cupom(text, uuid) from public, anon, authenticated;
grant execute on function conferir_cupom(text, uuid) to service_role;
revoke execute on function reservar_cupom(text, uuid, uuid) from public, anon, authenticated;
grant execute on function reservar_cupom(text, uuid, uuid) to service_role;
revoke execute on function sa_cupons() from public, anon;
grant execute on function sa_cupons() to authenticated;
revoke execute on function sa_salvar_cupom(uuid, jsonb) from public, anon;
grant execute on function sa_salvar_cupom(uuid, jsonb) to authenticated;
revoke execute on function sa_ativar_cupom(uuid, boolean) from public, anon;
grant execute on function sa_ativar_cupom(uuid, boolean) to authenticated;
revoke execute on function sa_excluir_cupom(uuid) from public, anon;
grant execute on function sa_excluir_cupom(uuid) to authenticated;
revoke execute on function minha_cobranca() from public, anon;
grant execute on function minha_cobranca() to authenticated;
revoke execute on function aplicar_pagamento_asaas(text, jsonb) from public, anon, authenticated;
grant execute on function aplicar_pagamento_asaas(text, jsonb) to service_role;
