-- Taxa de adesão do autocadastro (pedido do Wilker, 06/11/2026): quem se
-- cadastra pelo site (#/assinar) paga, só no 1º pagamento, a adesão (padrão
-- R$ 500,00) somada ao período escolhido. O valor e a explicação ficam em
-- cobranca_config e o superadmin muda em Configurações → Autocadastro:
--   adesao_valor  — em reais ("500" ; "0" = sem adesão)
--   adesao_texto  — a explicação que a pessoa lê no cadastro e no pagamento
-- A conta é a de supabase/functions/_shared/parcelas.ts (totalComAdesao).
--
-- Como cobra: a assinatura do Asaas não cobra um valor a mais só na 1ª fatura,
-- então o 1º pagamento com adesão é uma compra AVULSA (Pix, cartão à vista ou
-- parcelado) de período + adesão; paga, aplicar_pagamento_asaas devolve
-- criar_assinatura (como já fazia com a compra parcelada) e a função cria a
-- assinatura das renovações, só com o valor do plano, vencendo quando o período
-- pago acaba.
--
--   pagamentos.adesao   — quanto do valor deste pagamento é adesão (null = nada)
--
-- Empresas criadas pelo painel não pagam adesão (o superadmin cobra como quiser).
-- Depende da 0040. Idempotente.

alter table pagamentos add column if not exists adesao numeric(12,2);
alter table pagamentos drop constraint if exists pagamentos_adesao_valida;
alter table pagamentos add constraint pagamentos_adesao_valida check (adesao is null or adesao >= 0);

-- o valor de hoje (R$ 500,00), sem passar por cima do que o superadmin já gravou
insert into cobranca_config (key, value) values ('adesao_valor', '500') on conflict (key) do nothing;

-- ================================================================== as regras (0040 + adesão)
create or replace function regras_cadastro()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_cfg jsonb := coalesce((select jsonb_object_agg(key, value) from cobranca_config
                            where key in ('cadastro_aberto', 'parcelas_sem_juros', 'parcelas_max', 'juros_mes', 'ciclos',
                                          'adesao_valor', 'adesao_texto')), '{}'::jsonb);
  v_ciclos jsonb;
begin
  begin
    v_ciclos := (v_cfg ->> 'ciclos')::jsonb;
  exception when others then
    v_ciclos := null;
  end;
  return jsonb_build_object(
    'cadastro_aberto', coalesce(v_cfg ->> 'cadastro_aberto', 'false') = 'true',
    'parcelas_sem_juros', case when v_cfg ->> 'parcelas_sem_juros' ~ '^[0-9]{1,2}$' then (v_cfg ->> 'parcelas_sem_juros')::int else 6 end,
    'parcelas_max', case when v_cfg ->> 'parcelas_max' ~ '^[0-9]{1,2}$' then (v_cfg ->> 'parcelas_max')::int else 12 end,
    'juros_mes', case when v_cfg ->> 'juros_mes' ~ '^[0-9]{1,2}(\.[0-9]{1,4})?$' then (v_cfg ->> 'juros_mes')::numeric else 2.99 end,
    'ciclos', '{"MONTHLY": {"ativo": true, "desconto": 0}, "SEMIANNUALLY": {"ativo": true, "desconto": 0}, "YEARLY": {"ativo": true, "desconto": 0}}'::jsonb
              || case when jsonb_typeof(v_ciclos) = 'object' then v_ciclos else '{}'::jsonb end,
    -- valor quebrado não derruba a página pública: vale o padrão (500)
    'adesao', case when v_cfg ->> 'adesao_valor' ~ '^[0-9]{1,5}(\.[0-9]{1,2})?$' then (v_cfg ->> 'adesao_valor')::numeric else 500 end,
    'adesao_texto', nullif(btrim(v_cfg ->> 'adesao_texto'), ''));
end $$;

-- ================================================================== a tela de pagamento (0040 + adesão no último pagamento)
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
           'contato', jsonb_build_object('email', e.email, 'telefone', e.telefone, 'cnpj', e.cnpj, 'responsavel', e.responsavel),
           'ciclo', coalesce(c.ciclo, 'MONTHLY'),
           'origem', e.origem,
           'plano_id', e.plano_id,
           'mensalidade', mensalidade_de(e.id),
           'assinatura', c.asaas_assinatura_id is not null,
           'regras', regras_cadastro(),
           'ultimo_pagamento', (
             select jsonb_build_object('status', x.status, 'forma', x.forma, 'parcelas', x.parcelas, 'valor', x.valor,
                                       'ciclo', x.ciclo, 'adesao', x.adesao, 'criado_em', x.criado_em)
               from pagamentos x
              where x.escritorio_id = e.id and x.finalidade = 'mensalidade'
              order by x.criado_em desc limit 1))
    from membros_escritorio m
    join escritorios e on e.id = m.escritorio_id
    left join planos p on p.id = e.plano_id
    left join cobranca_empresas c on c.escritorio_id = e.id
   where m.user_id = auth.uid()
   limit 1
$$;

-- ================================================================== o webhook (0040 + a compra avulsa com adesão)
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
    v_meses := case coalesce(v_pag.ciclo, v_cob.ciclo, 'MONTHLY') when 'SEMIANNUALLY' then 6 when 'YEARLY' then 12 else 1 end;
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
      update cobranca_empresas set link_pagamento = coalesce(p_pagamento ->> 'invoiceUrl', link_pagamento),
             proximo_vencimento = coalesce(v_venc, proximo_vencimento), atualizado_em = now()
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
revoke execute on function regras_cadastro() from public, anon, authenticated;
grant execute on function regras_cadastro() to service_role;
revoke execute on function minha_cobranca() from public, anon;
grant execute on function minha_cobranca() to authenticated;
revoke execute on function aplicar_pagamento_asaas(text, jsonb) from public, anon, authenticated;
grant execute on function aplicar_pagamento_asaas(text, jsonb) to service_role;
