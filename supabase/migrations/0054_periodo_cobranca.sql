-- Período em meses e valor fechado na empresa criada pelo painel (pedido do
-- Wilker, 26/11/2026).
--
-- O cliente pode fechar com a equipe um valor bimestral, trimestral, semestral
-- ou anual. Em Nova empresa a equipe escolhe a quantidade de meses (1, 2, 3, 6
-- ou 12 — os períodos que a assinatura do Asaas aceita) e o valor combinado do
-- período. O autocadastro do site continua só com mensal, semestral e anual.
--
--   cobranca_empresas.ciclo         — passa a aceitar BIMONTHLY e QUARTERLY
--   pagamentos.ciclo                — idem
--   cobranca_empresas.valor_periodo — o valor fechado do período (R$); null =
--                                     mensalidade × meses (com o desconto do
--                                     autocadastro no semestral/anual, como antes)
--
-- A 5ª forma de liberar ("liberar agora e cobrar no próximo mês") não precisa de
-- coluna: a função `cobranca` cria a assinatura com o 1º vencimento um mês depois
-- do cadastro e a empresa fica em dia até lá.
--
-- Idempotente.

alter table cobranca_empresas drop constraint if exists cobranca_empresas_ciclo_valido;
alter table cobranca_empresas add constraint cobranca_empresas_ciclo_valido
  check (ciclo in ('MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUALLY', 'YEARLY'));

alter table pagamentos drop constraint if exists pagamentos_ciclo_valido;
alter table pagamentos add constraint pagamentos_ciclo_valido
  check (ciclo is null or ciclo in ('MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUALLY', 'YEARLY'));

alter table cobranca_empresas add column if not exists valor_periodo numeric(12, 2);
alter table cobranca_empresas drop constraint if exists cobranca_empresas_valor_periodo_valido;
alter table cobranca_empresas add constraint cobranca_empresas_valor_periodo_valido
  check (valor_periodo is null or valor_periodo > 0);

comment on column cobranca_empresas.valor_periodo is
  '0054: valor fechado do período com a equipe (R$); null = mensalidade × meses';

-- ================================================================== o webhook
-- aplicar_pagamento_asaas (0052) empurrava o vencimento 1 mês em tudo que não
-- fosse semestral/anual: bimestral = 2 e trimestral = 3. Fora essa linha, é a
-- mesma função da 0052.
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
                    else case coalesce(v_pag.ciclo, v_cob.ciclo, 'MONTHLY') when 'BIMONTHLY' then 2 when 'QUARTERLY' then 3 when 'SEMIANNUALLY' then 6 when 'YEARLY' then 12 else 1 end end;
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

revoke execute on function aplicar_pagamento_asaas(text, jsonb) from public, anon, authenticated;
grant execute on function aplicar_pagamento_asaas(text, jsonb) to service_role;
