-- 0050: dois planos (Profissional e Empresarial) e escritórios adicionais.
--
-- Pedido do Wilker (2026-11-11):
--   Profissional  R$ 299,90/mês — 8 créditos para projetos e 16 para CAR por mês;
--                 crédito adicional de 2 a 5 = R$ 50,00 cada, a partir de 6 = R$ 40,00.
--   Empresarial   R$ 1.000,00/mês — créditos ilimitados e até 2 escritórios
--                 adicionais; cada escritório ativo soma R$ 99,90 à mensalidade.
--   Só esses dois no cadastro: Autônomo e Só CAR saem (quem já está neles fica).
--
-- ESCRITÓRIO ADICIONAL: uma empresa filha (`escritorios.matriz_id`) com espaço
-- próprio — serviços, clientes, cadastros, configurações e equipe separados —
-- que usa o plano e os créditos da matriz e é cobrada na mensalidade dela.
--   - o dono da matriz cria, renomeia, desativa e reativa (até o limite do plano;
--     o desativado não cobra e guarda os dados);
--   - o dono da matriz entra em qualquer escritório dela pelo seletor do topo
--     (`membros_escritorio.escritorio_em_uso`): escritorio_atual() passa a ser o
--     escritório escolhido e toda a RLS acompanha;
--   - o escritório pode ter equipe própria (o dono adiciona estando nele);
--   - créditos: um saldo só para a matriz e os escritórios (franquia, uso, extra);
--   - matriz suspensa/aguardando pagamento = escritórios parados também;
--   - mensalidade_de(matriz) = mensalidade do plano + escritórios ativos × preço;
--     a função `cobranca` (ação escritorios_sincronizar) leva o valor ao Asaas.
--
-- QUEM JÁ É CLIENTE não muda de valor nem de créditos sozinho: empresas nos
-- planos Profissional e Empresarial antes desta migração ficam com a condição
-- antiga gravada na própria empresa (mensalidade, créditos e preço do extra —
-- o "ajuste por empresa" da 0034). A equipe tira o ajuste no painel quando
-- quiser passar a empresa para a regra nova.

-- ================================================================== colunas
alter table planos add column if not exists escritorios_adicionais int not null default 0;
alter table planos drop constraint if exists planos_escritorios_adicionais_validos;
alter table planos add constraint planos_escritorios_adicionais_validos check (escritorios_adicionais between 0 and 50);
alter table planos add column if not exists preco_escritorio numeric(12, 2);
alter table planos drop constraint if exists planos_preco_escritorio_valido;
alter table planos add constraint planos_preco_escritorio_valido check (preco_escritorio is null or preco_escritorio >= 0);

alter table escritorios add column if not exists matriz_id uuid references escritorios(id) on delete cascade;
create index if not exists escritorios_matriz_idx on escritorios (matriz_id) where matriz_id is not null;
-- ajuste por empresa (null = o do plano)
alter table escritorios add column if not exists limite_escritorios int;
alter table escritorios drop constraint if exists escritorios_limite_escritorios_valido;
alter table escritorios add constraint escritorios_limite_escritorios_valido check (limite_escritorios is null or limite_escritorios between 0 and 50);
alter table escritorios add column if not exists preco_escritorio numeric(12, 2);
alter table escritorios drop constraint if exists escritorios_preco_escritorio_valido;
alter table escritorios add constraint escritorios_preco_escritorio_valido check (preco_escritorio is null or preco_escritorio >= 0);
alter table escritorios drop constraint if exists escritorios_origem_valida;
alter table escritorios add constraint escritorios_origem_valida check (origem in ('painel', 'site', 'convite', 'escritorio'));

-- o escritório em que o dono da matriz está trabalhando (null = a própria matriz)
alter table membros_escritorio add column if not exists escritorio_em_uso uuid references escritorios(id) on delete set null;

-- Um nível só: matriz → escritórios. Escritório não tem escritório.
create or replace function validar_matriz()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.matriz_id is null then return new; end if;
  if new.matriz_id = new.id then
    raise exception 'O escritório não pode ser matriz de si mesmo.' using errcode = '23514';
  end if;
  if exists (select 1 from escritorios where id = new.matriz_id and matriz_id is not null) then
    raise exception 'Escritório adicional não tem escritório próprio: use a matriz.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and exists (select 1 from escritorios where matriz_id = new.id) then
    raise exception 'Esta empresa já tem escritórios: ela não pode virar escritório de outra.' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists escritorios_validar_matriz on escritorios;
create trigger escritorios_validar_matriz before insert or update of matriz_id on escritorios
  for each row execute function validar_matriz();

-- ================================================================== quem paga, quem é do grupo
-- A empresa que paga e cujo plano vale: a matriz (ou a própria empresa).
create or replace function empresa_pagante(p_escritorio uuid)
returns uuid
language sql stable security definer
set search_path = public
as $$
  select coalesce(matriz_id, id) from escritorios where id = p_escritorio
$$;

-- A matriz e os escritórios dela (todos, ativos ou não).
create or replace function grupo_empresa(p_escritorio uuid)
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select e.id from escritorios e
   where e.id = empresa_pagante(p_escritorio) or e.matriz_id = empresa_pagante(p_escritorio)
$$;

create or replace function limite_escritorios_de(p_escritorio uuid)
returns int
language sql stable security definer
set search_path = public
as $$
  select coalesce(e.limite_escritorios, p.escritorios_adicionais, 0)
    from escritorios e left join planos p on p.id = e.plano_id
   where e.id = empresa_pagante(p_escritorio)
$$;

create or replace function preco_escritorio_de(p_escritorio uuid)
returns numeric
language sql stable security definer
set search_path = public
as $$
  select coalesce(e.preco_escritorio, p.preco_escritorio, 0)
    from escritorios e left join planos p on p.id = e.plano_id
   where e.id = empresa_pagante(p_escritorio)
$$;

-- Escritórios que entram na mensalidade (os ativos).
create or replace function escritorios_cobrados(p_escritorio uuid)
returns int
language sql stable security definer
set search_path = public
as $$
  select count(*)::int from escritorios where matriz_id = empresa_pagante(p_escritorio) and status = 'ativo'
$$;

-- ================================================================== mensalidade
-- Matriz: a do plano (ou a combinada com a empresa) + escritórios ativos × preço.
-- Empresa sem cobrança (0) continua sem cobrança. Escritório: 0 (paga na matriz).
create or replace function mensalidade_de(p_escritorio uuid)
returns numeric
language sql stable security definer
set search_path = public
as $$
  select case
           when e.matriz_id is not null then 0::numeric
           when coalesce(e.mensalidade, p.preco_mensal) is null then null
           when coalesce(e.mensalidade, p.preco_mensal) = 0 then 0::numeric
           else coalesce(e.mensalidade, p.preco_mensal) + escritorios_cobrados(e.id) * preco_escritorio_de(e.id)
         end
    from escritorios e left join planos p on p.id = e.plano_id
   where e.id = p_escritorio
$$;

-- O mesmo valor, aberto em partes (telas e WhatsApp).
create or replace function mensalidade_detalhe(p_escritorio uuid)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
           'plano', coalesce(e.mensalidade, p.preco_mensal),
           'escritorios', case when coalesce(e.mensalidade, p.preco_mensal, 0) > 0 then escritorios_cobrados(e.id) else 0 end,
           'preco_escritorio', preco_escritorio_de(e.id),
           'limite_escritorios', limite_escritorios_de(e.id),
           'total', mensalidade_de(e.id))
    from escritorios e left join planos p on p.id = e.plano_id
   where e.id = empresa_pagante(p_escritorio)
$$;

-- ================================================================== acesso
-- O escritório do usuário: o que o dono da matriz escolheu no seletor (se ainda
-- for dela e estiver ativo), senão o da equipe. Escritório de matriz parada não vale.
create or replace function escritorio_atual()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select coalesce(f.id, m.escritorio_id)
    from membros_escritorio m
    join escritorios e on e.id = m.escritorio_id
    left join escritorios f on f.id = m.escritorio_em_uso and f.matriz_id = m.escritorio_id
                           and f.status = 'ativo' and m.papel = 'dono'
   where m.user_id = auth.uid() and e.status = 'ativo' and m.ativo
     and (e.matriz_id is null or exists (select 1 from escritorios x where x.id = e.matriz_id and x.status = 'ativo'))
$$;

create or replace function tem_permissao(p text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from membros_escritorio m join escritorios e on e.id = m.escritorio_id
     where m.user_id = auth.uid() and m.ativo and e.status = 'ativo'
       and (e.matriz_id is null or exists (select 1 from escritorios x where x.id = e.matriz_id and x.status = 'ativo'))
       and (m.papel = 'dono' or p = any (m.permissoes))
  )
$$;

-- O dono da matriz também é dono dos escritórios dela.
create or replace function sou_dono_de(p_escritorio uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from membros_escritorio m
                  where m.user_id = auth.uid() and m.papel = 'dono'
                    and (m.escritorio_id = p_escritorio
                         or m.escritorio_id = (select matriz_id from escritorios where id = p_escritorio)))
$$;

-- O escritório em que a pessoa está (o do seletor, para o dono da matriz) e,
-- para o dono da matriz, a lista para trocar. status = o da matriz quando ela parou.
drop function if exists meu_escritorio();
create or replace function meu_escritorio()
returns table (id uuid, nome text, papel text, modelos_compartilhados boolean, status text, plano text,
               ativo boolean, permissoes text[], meu_nome text,
               matriz_id uuid, matriz_nome text, escritorios jsonb)
language sql stable security definer
set search_path = public
as $$
  select a.id, a.nome, m.papel, a.modelos_compartilhados,
         case when mz.id is not null and mz.status <> 'ativo' then mz.status else a.status end,
         p.nome, m.ativo, m.permissoes, m.nome,
         a.matriz_id, mz.nome,
         case when m.papel = 'dono' and e.matriz_id is null
                   and exists (select 1 from escritorios x where x.matriz_id = e.id and x.status = 'ativo')
              then (select jsonb_agg(jsonb_build_object('id', x.id, 'nome', x.nome, 'matriz', x.matriz_id is null)
                                     order by x.matriz_id is not null, x.created_at)
                      from escritorios x where x.id = e.id or (x.matriz_id = e.id and x.status = 'ativo'))
         end
    from membros_escritorio m
    join escritorios e on e.id = m.escritorio_id
    join escritorios a on a.id = coalesce(
           (select f.id from escritorios f
             where f.id = m.escritorio_em_uso and f.matriz_id = m.escritorio_id and f.status = 'ativo' and m.papel = 'dono'),
           m.escritorio_id)
    left join escritorios mz on mz.id = a.matriz_id
    left join planos p on p.id = coalesce(mz.plano_id, a.plano_id)
   where m.user_id = auth.uid()
$$;

-- ================================================================== créditos do grupo
-- Um saldo só: a franquia, o uso e o extra são da matriz com os escritórios.
create or replace function inicio_periodo(p_escritorio uuid)
returns date
language sql stable security definer
set search_path = public
as $$
  select case when x.h >= ancora_mes(x.d, x.h) then ancora_mes(x.d, x.h)
              else ancora_mes(x.d, (x.h - interval '1 month')::date) end
    from (select coalesce((select dia_renovacao from escritorios where id = empresa_pagante(p_escritorio)), 1) as d,
                 hoje_brasil() as h) x
$$;

create or replace function renovacao_periodo(p_escritorio uuid)
returns date
language sql stable security definer
set search_path = public
as $$
  select ancora_mes(coalesce((select dia_renovacao from escritorios where id = empresa_pagante(p_escritorio)), 1),
                    (inicio_periodo(p_escritorio) + interval '1 month')::date)
$$;

create or replace function franquia_credito(p_escritorio uuid, p_tipo text)
returns int
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_esc uuid := coalesce(empresa_pagante(p_escritorio), p_escritorio);
  v_plano uuid;
  v_por_mes int;
begin
  select por_mes into v_por_mes from escritorio_creditos where escritorio_id = v_esc and tipo = p_tipo;
  if found then return v_por_mes; end if;
  select plano_id into v_plano from escritorios where id = v_esc;
  if v_plano is null then return null; end if;
  select por_mes into v_por_mes from plano_creditos where plano_id = v_plano and tipo = p_tipo;
  if found then return v_por_mes; end if;
  return 0;
end $$;

create or replace function uso_credito(p_escritorio uuid, p_tipo text)
returns int
language sql stable security definer
set search_path = public
as $$
  select count(*)::int from consumos_credito
   where escritorio_id in (select grupo_empresa(p_escritorio)) and tipo = p_tipo and origem = 'plano'
     and created_at >= (inicio_periodo(p_escritorio)::timestamp at time zone 'America/Sao_Paulo')
$$;

create or replace function saldo_extra(p_escritorio uuid, p_tipo text)
returns int
language sql stable security definer
set search_path = public
as $$
  select coalesce((select sum(quantidade) from creditos_extras
                    where escritorio_id in (select grupo_empresa(p_escritorio)) and tipo = p_tipo and status = 'aprovado'), 0)::int
       - (select count(*) from consumos_credito
           where escritorio_id in (select grupo_empresa(p_escritorio)) and origem = 'extra' and tipo = p_tipo)::int
$$;

create or replace function tabela_precos(p_escritorio uuid, p_tipo text)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select jsonb_agg(jsonb_build_object('a_partir_de', a_partir_de, 'preco', preco) order by a_partir_de)
       from precos_credito where escritorio_id = empresa_pagante(p_escritorio) and tipo = p_tipo),
    (select jsonb_agg(jsonb_build_object('a_partir_de', pc.a_partir_de, 'preco', pc.preco) order by pc.a_partir_de)
       from precos_credito pc join escritorios e on e.plano_id = pc.plano_id
      where e.id = empresa_pagante(p_escritorio) and pc.tipo = p_tipo),
    '[]'::jsonb)
$$;

-- O escritório libera o que a matriz libera (exceções da matriz > plano > catálogo).
create or replace function recurso_liberado(p_escritorio uuid, p_chave text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select liberado from escritorio_recursos where escritorio_id = empresa_pagante(p_escritorio) and recurso_chave = p_chave),
    (select pr.liberado from escritorios e join plano_recursos pr on pr.plano_id = e.plano_id
      where e.id = empresa_pagante(p_escritorio) and pr.recurso_chave = p_chave),
    (select false from escritorios e join planos p on p.id = e.plano_id
      where e.id = empresa_pagante(p_escritorio) and not p.libera_recursos_novos),
    (select padrao from recursos where chave = p_chave),
    true
  )
$$;

-- O gasto: igual à 0034, mas trava a matriz (dois envios do grupo ao mesmo
-- tempo não passam do limite).
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
  perform 1 from escritorios where id = coalesce(empresa_pagante(new.escritorio_id), new.escritorio_id) for update;
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

-- O 1º crédito gasto (0049) num escritório conta para a matriz.
create or replace function marcar_primeiro_credito()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare v_esc uuid := coalesce(empresa_pagante(new.escritorio_id), new.escritorio_id);
begin
  update cobranca_empresas set primeiro_credito_em = now(), atualizado_em = now()
   where escritorio_id = v_esc and inicio_no_primeiro_credito
     and primeiro_credito_em is null and mensalidade_iniciada_em is null;
  if found then
    update escritorios set dia_renovacao = extract(day from hoje_brasil())::int, atualizado_em = now()
     where id = v_esc;
    perform registrar_atividade(v_esc, 'cobranca.primeiro_credito',
      'o 1º crédito foi gasto: a mensalidade começa em ' || to_char(hoje_brasil(), 'DD/MM/YYYY'));
  end if;
  return new;
end $$;

-- A compra é sempre da matriz (quem paga): o crédito comprado vale para o grupo.
create or replace function pedir_creditos(p_tipo text, p_quantidade int, p_observacao text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_esc uuid := empresa_pagante(escritorio_atual());
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
declare v_esc uuid := empresa_pagante(escritorio_atual());
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

create or replace function definir_recarga_automatica(p_tipo text, p_ativo boolean, p_quantidade int, p_limite numeric default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_esc uuid := empresa_pagante(escritorio_atual());
  v_cot record;
begin
  if v_esc is null or not sou_dono_de(v_esc) then
    raise exception 'Só o dono da empresa configura a compra automática.' using errcode = '42501';
  end if;
  if not exists (select 1 from tipos_credito where chave = p_tipo and ativo) then
    raise exception 'Tipo de crédito inválido.' using errcode = '22023';
  end if;
  if p_ativo then
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

-- O retrato dos créditos: o saldo do grupo; compras, cartão e recarga da matriz.
create or replace function meus_creditos()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_esc uuid := escritorio_atual();
  v_pag uuid := empresa_pagante(escritorio_atual());
begin
  if v_esc is null then return null; end if;
  return situacao_creditos(v_esc) || jsonb_build_object(
    'sou_dono', sou_dono_de(v_pag),
    'pagamento_online', pagamento_online(),
    'cartao', cartao_da_empresa(v_pag),
    'recarga', recarga_da_empresa(v_pag),
    'escritorio', v_esc <> v_pag,
    'compras', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'tipo', c.tipo, 'quantidade', c.quantidade, 'valor', c.preco, 'unitario', c.valor_unitario,
               'descricao', c.descricao, 'status', c.status, 'origem', c.origem, 'created_at', c.created_at,
               'link', p.link, 'pagamento', p.status, 'automatica', coalesce(p.automatica, false), 'forma', p.forma)
               order by c.created_at desc)
        from (select * from creditos_extras where escritorio_id = v_pag order by created_at desc limit 20) c
        left join lateral (select link, status, automatica, forma from pagamentos where credito_id = c.id order by criado_em desc limit 1) p on true
    ), '[]'::jsonb)
  );
end $$;

-- ================================================================== a tela de pagamento (0049 + escritórios)
-- Quem é de um escritório vê a cobrança da matriz (é ela que paga); só o dono da matriz mexe.
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

-- ================================================================== o dono da matriz cuida dos escritórios
-- A matriz de quem chama, se for o dono dela (o seletor não muda isto).
create or replace function matriz_do_dono()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select m.escritorio_id
    from membros_escritorio m join escritorios e on e.id = m.escritorio_id
   where m.user_id = auth.uid() and m.papel = 'dono' and m.ativo and e.matriz_id is null
$$;

-- O que a tela "Escritórios" mostra.
create or replace function meus_escritorios()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_mat uuid := matriz_do_dono();
  v_em_uso uuid;
  e escritorios;
begin
  if v_mat is null then return jsonb_build_object('disponivel', false); end if;
  select * into e from escritorios where id = v_mat;
  select escritorio_em_uso into v_em_uso from membros_escritorio where user_id = auth.uid();
  return jsonb_build_object(
    'disponivel', true,
    'matriz', jsonb_build_object('id', e.id, 'nome', e.nome, 'status', e.status,
               'servicos', (select count(*) from servicos s where s.escritorio_id = e.id),
               'servicos_30d', (select count(*) from servicos s where s.escritorio_id = e.id and s.created_at > now() - interval '30 days'),
               'usuarios', (select count(*) from membros_escritorio x where x.escritorio_id = e.id and x.ativo)),
    'plano', (select nome from planos where id = e.plano_id),
    'limite', limite_escritorios_de(v_mat),
    'preco', preco_escritorio_de(v_mat),
    'ativos', escritorios_cobrados(v_mat),
    'mensalidade', mensalidade_detalhe(v_mat),
    'em_uso', coalesce(escritorio_atual(), v_mat),
    'escritorios', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', f.id, 'nome', f.nome, 'status', f.status, 'criado_em', f.created_at,
               'servicos', (select count(*) from servicos s where s.escritorio_id = f.id),
               'servicos_30d', (select count(*) from servicos s where s.escritorio_id = f.id and s.created_at > now() - interval '30 days'),
               'ultimo_servico', (select max(s.created_at) from servicos s where s.escritorio_id = f.id),
               'usuarios', (select count(*) from membros_escritorio x where x.escritorio_id = f.id and x.ativo))
             order by f.status <> 'ativo', f.created_at)
        from escritorios f where f.matriz_id = v_mat), '[]'::jsonb));
end $$;

-- Cria um escritório: nasce ativo, com os dados e as configurações da matriz
-- (menos integrações e senhas), no plano dela, e entra na mensalidade.
create or replace function criar_escritorio(p_nome text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_mat uuid := matriz_do_dono();
  v_nome text := left(btrim(coalesce(p_nome, '')), 120);
  e escritorios;
  v_id uuid;
begin
  if v_mat is null then raise exception 'Só o dono da empresa cria escritórios.' using errcode = '42501'; end if;
  select * into e from escritorios where id = v_mat for update;
  if e.status <> 'ativo' then raise exception 'A empresa precisa estar ativa para criar escritórios.' using errcode = '42501'; end if;
  if length(v_nome) < 2 then raise exception 'Dê um nome ao escritório.' using errcode = '22023'; end if;
  if limite_escritorios_de(v_mat) = 0 then
    raise exception 'O plano da empresa não inclui escritórios adicionais. O plano Empresarial inclui.' using errcode = '22023';
  end if;
  if escritorios_cobrados(v_mat) >= limite_escritorios_de(v_mat) then
    raise exception 'O plano permite % escritório(s) adicional(is) ativo(s). Desative um para criar outro.', limite_escritorios_de(v_mat)
      using errcode = '22023';
  end if;
  if lower(v_nome) = lower(e.nome)
     or exists (select 1 from escritorios where matriz_id = v_mat and lower(nome) = lower(v_nome)) then
    raise exception 'Já existe um escritório com este nome.' using errcode = '23505';
  end if;
  insert into escritorios (nome, matriz_id, plano_id, status, mensalidade, dia_renovacao, responsavel, telefone, email,
                           modelos_compartilhados, origem, leitura_ia)
  values (v_nome, v_mat, e.plano_id, 'ativo', 0, e.dia_renovacao, e.responsavel, e.telefone, e.email,
          false, 'escritorio', e.leitura_ia)
  returning id into v_id;
  insert into config_empresa (escritorio_id, key, value)
  select v_id, c.key, c.value from config_empresa c
   where c.escritorio_id = v_mat and c.key !~* '(gprol|token|segredo|secret|senha|chave|api)';
  perform registrar_atividade(v_mat, 'escritorio.criado', v_nome, jsonb_build_object('escritorio_id', v_id));
  return jsonb_build_object('id', v_id, 'nome', v_nome, 'mensalidade', mensalidade_detalhe(v_mat));
end $$;

-- Renomeia, desativa (sai da mensalidade; os dados ficam) ou reativa (dentro do limite).
create or replace function definir_escritorio(p_id uuid, p_nome text default null, p_ativo boolean default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_mat uuid := matriz_do_dono();
  f escritorios;
  v_nome text := nullif(left(btrim(coalesce(p_nome, '')), 120), '');
begin
  if v_mat is null then raise exception 'Só o dono da empresa cuida dos escritórios.' using errcode = '42501'; end if;
  perform 1 from escritorios where id = v_mat for update;
  select * into f from escritorios where id = p_id and matriz_id = v_mat;
  if not found then raise exception 'Escritório não encontrado.' using errcode = 'P0002'; end if;
  if f.status = 'cancelado' then raise exception 'Este escritório foi encerrado pelo suporte.' using errcode = '42501'; end if;
  if v_nome is not null and v_nome <> f.nome then
    if length(v_nome) < 2 then raise exception 'Dê um nome ao escritório.' using errcode = '22023'; end if;
    if exists (select 1 from escritorios where (id = v_mat or matriz_id = v_mat) and id <> p_id and lower(nome) = lower(v_nome)) then
      raise exception 'Já existe um escritório com este nome.' using errcode = '23505';
    end if;
    update escritorios set nome = v_nome, atualizado_em = now() where id = p_id;
    perform registrar_atividade(v_mat, 'escritorio.renomeado', f.nome || ' → ' || v_nome, jsonb_build_object('escritorio_id', p_id));
  end if;
  if p_ativo is true and f.status <> 'ativo' then
    if (select status from escritorios where id = v_mat) <> 'ativo' then
      raise exception 'A empresa precisa estar ativa para reativar escritórios.' using errcode = '42501';
    end if;
    if escritorios_cobrados(v_mat) >= limite_escritorios_de(v_mat) then
      raise exception 'O plano permite % escritório(s) adicional(is) ativo(s).', limite_escritorios_de(v_mat) using errcode = '22023';
    end if;
    update escritorios set status = 'ativo', atualizado_em = now() where id = p_id;
    perform registrar_atividade(v_mat, 'escritorio.reativado', coalesce(v_nome, f.nome), jsonb_build_object('escritorio_id', p_id));
  elsif p_ativo is false and f.status = 'ativo' then
    update escritorios set status = 'suspenso', atualizado_em = now() where id = p_id;
    update membros_escritorio set escritorio_em_uso = null where escritorio_em_uso = p_id;
    perform registrar_atividade(v_mat, 'escritorio.desativado', coalesce(v_nome, f.nome), jsonb_build_object('escritorio_id', p_id));
  end if;
  return jsonb_build_object('id', p_id, 'mensalidade', mensalidade_detalhe(v_mat));
end $$;

-- O seletor do topo: o dono da matriz passa a trabalhar no escritório (null = matriz).
create or replace function usar_escritorio(p_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_mat uuid := matriz_do_dono();
begin
  if v_mat is null then raise exception 'Só o dono da empresa troca de escritório.' using errcode = '42501'; end if;
  if p_id is not null and p_id <> v_mat
     and not exists (select 1 from escritorios where id = p_id and matriz_id = v_mat and status = 'ativo') then
    raise exception 'Escritório não encontrado ou desativado.' using errcode = 'P0002';
  end if;
  update membros_escritorio set escritorio_em_uso = case when p_id = v_mat then null else p_id end
   where user_id = auth.uid() and escritorio_id = v_mat;
end $$;

-- ================================================================== a equipe do escritório
-- A regra da 0029, com o dono da matriz valendo como dono no escritório em que entrou.
create or replace function definir_membro(p_user uuid, p_nome text, p_cargo text, p_permissoes text[], p_ativo boolean,
                                          p_descricao text default null, p_telefone text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_esc uuid := escritorio_atual();
  v_sou_dono boolean := sou_dono_de(escritorio_atual());
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

create or replace function pode_adicionar_membro()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_esc uuid := escritorio_atual();
  v_limite int;
  v_total int;
begin
  if v_esc is null then return jsonb_build_object('ok', false, 'motivo', 'Sua conta não está ligada a uma empresa ativa.'); end if;
  if not tem_permissao('equipe.gerenciar') then
    return jsonb_build_object('ok', false, 'motivo', 'Você não tem permissão para gerenciar a equipe.');
  end if;
  if not recurso_liberado(v_esc, 'empresa.equipe') then
    return jsonb_build_object('ok', false, 'motivo', 'O plano da empresa não inclui equipe. Fale com o suporte do Vértice.');
  end if;
  select p.limite_usuarios into v_limite from escritorios e left join planos p on p.id = e.plano_id where e.id = v_esc;
  select count(*) into v_total from membros_escritorio where escritorio_id = v_esc and ativo;
  if v_limite is not null and v_total >= v_limite then
    return jsonb_build_object('ok', false, 'motivo', format('O plano da empresa permite %s usuário(s) ativo(s). Desative alguém ou fale com o suporte para ampliar.', v_limite));
  end if;
  return jsonb_build_object('ok', true, 'escritorio_id', v_esc, 'sou_dono', sou_dono_de(v_esc),
    'limite', v_limite, 'ativos', v_total);
end $$;

-- ================================================================== a matriz muda, os escritórios acompanham
-- Plano e dia de renovação seguem a matriz; se o limite cair, os escritórios
-- mais novos além dele são desativados (a mensalidade nunca cobra além do plano).
create or replace function ajustar_escritorios(p_matriz uuid)
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_mat escritorios;
  v_sobra int;
  v_n int := 0;
begin
  select * into v_mat from escritorios where id = p_matriz and matriz_id is null;
  if not found then return 0; end if;
  update escritorios set plano_id = v_mat.plano_id, dia_renovacao = v_mat.dia_renovacao, atualizado_em = now()
   where matriz_id = p_matriz
     and (plano_id is distinct from v_mat.plano_id or dia_renovacao is distinct from v_mat.dia_renovacao);
  v_sobra := escritorios_cobrados(p_matriz) - limite_escritorios_de(p_matriz);
  if v_sobra > 0 then
    with fora as (
      select id from escritorios where matriz_id = p_matriz and status = 'ativo' order by created_at desc limit v_sobra)
    update escritorios set status = 'suspenso', atualizado_em = now() where id in (select id from fora);
    get diagnostics v_n = row_count;
    update membros_escritorio set escritorio_em_uso = null
     where escritorio_em_uso in (select id from escritorios where matriz_id = p_matriz and status <> 'ativo');
    perform registrar_atividade(p_matriz, 'escritorio.desativado',
      v_n || ' escritório(s) desativado(s): o plano permite ' || limite_escritorios_de(p_matriz));
  end if;
  return v_n;
end $$;

create or replace function escritorios_seguir_matriz()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.matriz_id is null then perform ajustar_escritorios(new.id); end if;
  return null;
end $$;
drop trigger if exists escritorios_seguir_matriz on escritorios;
create trigger escritorios_seguir_matriz
  after update of plano_id, dia_renovacao, limite_escritorios on escritorios
  for each row when (new.matriz_id is null) execute function escritorios_seguir_matriz();

create or replace function planos_ajustar_escritorios()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare r record;
begin
  if new.escritorios_adicionais < old.escritorios_adicionais then
    for r in select distinct e.matriz_id as id from escritorios e join escritorios m on m.id = e.matriz_id
              where m.plano_id = new.id and m.limite_escritorios is null loop
      perform ajustar_escritorios(r.id);
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists planos_ajustar_escritorios on planos;
create trigger planos_ajustar_escritorios after update of escritorios_adicionais on planos
  for each row execute function planos_ajustar_escritorios();

-- ================================================================== o superadmin
drop function if exists sa_empresas();
create or replace function sa_empresas()
returns table (
  id uuid, nome text, cnpj text, responsavel text, telefone text, email text, status text,
  plano_id uuid, plano text, observacoes text, created_at timestamptz,
  usuarios int, servicos int, servicos_30d int, ultimo_servico timestamptz, ultimo_acesso timestamptz,
  excecoes int, mensalidade numeric, cobranca text, vencimento date, inicio_cobranca text,
  matriz_id uuid, matriz text, escritorios int, limite_escritorios int, preco_escritorio numeric
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
         mensalidade_de(e.id),
         c.situacao, c.proximo_vencimento,
         case when c.inicio_no_primeiro_credito and c.mensalidade_iniciada_em is null
              then case when c.primeiro_credito_em is null then 'esperando' else 'a_iniciar' end end,
         e.matriz_id, mz.nome,
         (select count(*)::int from escritorios f where f.matriz_id = e.id and f.status = 'ativo'),
         e.limite_escritorios, e.preco_escritorio
    from escritorios e
    left join escritorios mz on mz.id = e.matriz_id
    left join planos p on p.id = e.plano_id
    left join cobranca_empresas c on c.escritorio_id = e.id
   order by coalesce(mz.created_at, e.created_at) desc, e.matriz_id is not null, e.created_at;
end $$;

-- 0034 + o ajuste dos escritórios por empresa ('' = o do plano). O escritório
-- segue o plano da matriz: não troca de plano nem tem mensalidade própria.
create or replace function sa_atualizar_empresa(p_escritorio uuid, p_dados jsonb)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_matriz uuid;
begin
  perform exigir_superadmin();
  select matriz_id into v_matriz from escritorios where id = p_escritorio;
  if p_dados ? 'status' and p_dados ->> 'status' not in ('ativo', 'aguardando_pagamento', 'suspenso', 'cancelado') then
    raise exception 'Status inválido' using errcode = '22023';
  end if;
  if p_dados ? 'dia_renovacao' and coalesce((p_dados ->> 'dia_renovacao')::int, 0) not between 1 and 31 then
    raise exception 'Dia de renovação inválido' using errcode = '22023';
  end if;
  if v_matriz is not null and (p_dados ? 'plano_id' or p_dados ? 'mensalidade' or p_dados ? 'dia_renovacao'
                               or p_dados ? 'limite_escritorios' or p_dados ? 'preco_escritorio') then
    raise exception 'Este é um escritório adicional: plano, mensalidade e renovação são os da matriz.' using errcode = '22023';
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
    limite_escritorios = case when p_dados ? 'limite_escritorios' then nullif(p_dados ->> 'limite_escritorios', '')::int else limite_escritorios end,
    preco_escritorio = case when p_dados ? 'preco_escritorio' then nullif(p_dados ->> 'preco_escritorio', '')::numeric else preco_escritorio end,
    atualizado_em = now()
  where id = p_escritorio;
  if not found then raise exception 'Empresa não encontrada' using errcode = 'P0002'; end if;
end $$;

-- ================================================================== a página de cadastro
create or replace function cadastro_planos()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'aberto', (regras_cadastro() ->> 'cadastro_aberto')::boolean and pagamento_online(),
    'regras', regras_cadastro(),
    'planos', coalesce((
      select jsonb_agg(plano_publico(p.id) order by p.ordem, p.nome)
        from planos p
       where p.ativo and p.vende_no_site and coalesce(p.preco_mensal, 0) > 0), '[]'::jsonb))
$$;

create or replace function plano_publico(p_plano uuid)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
           'id', p.id, 'nome', p.nome, 'descricao', p.descricao, 'cor', p.cor,
           'mensalidade', p.preco_mensal, 'limite_usuarios', p.limite_usuarios,
           'escritorios_adicionais', p.escritorios_adicionais,
           'preco_escritorio', p.preco_escritorio,
           -- créditos por mês de cada carteira (null = sem limite; sem linha = 0)
           'creditos', coalesce((
             select jsonb_agg(jsonb_build_object('tipo', t.chave, 'nome', t.nome,
                                                 'por_mes', case when pc.plano_id is null then 0 else pc.por_mes end)
                              order by t.ordem)
               from tipos_credito t
               left join plano_creditos pc on pc.plano_id = p.id and pc.tipo = t.chave
              where t.ativo), '[]'::jsonb),
           -- preço do crédito extra por faixa, por carteira
           'extra', coalesce((
             select jsonb_object_agg(x.tipo, x.faixas)
               from (select pr.tipo, jsonb_agg(jsonb_build_object('a_partir_de', pr.a_partir_de, 'preco', pr.preco)
                                               order by pr.a_partir_de) as faixas
                       from precos_credito pr where pr.plano_id = p.id group by pr.tipo) x), '{}'::jsonb))
    from planos p where p.id = p_plano
$$;

-- ================================================================== os dois planos
-- Uma vez só (saas_config 'planos_0050'): o que o superadmin mudar depois no
-- painel não é desfeito por reaplicar a migração.
do $$
declare
  v_prof uuid;
  v_emp uuid;
  r record;
  v_antigo record;
begin
  if exists (select 1 from saas_config where key = 'planos_0050') then return; end if;

  select id into v_prof from planos where lower(nome) = 'profissional';
  select id into v_emp from planos where lower(nome) = 'empresarial';
  if v_prof is null then
    insert into planos (nome, cor, ordem) values ('Profissional', '#178552', 10) returning id into v_prof;
    insert into plano_recursos (plano_id, recurso_chave, liberado) select v_prof, chave, true from recursos
    on conflict (plano_id, recurso_chave) do nothing;
  end if;
  if v_emp is null then
    insert into planos (nome, cor, ordem) values ('Empresarial', '#0E3B2B', 20) returning id into v_emp;
    insert into plano_recursos (plano_id, recurso_chave, liberado) select v_emp, chave, true from recursos
    on conflict (plano_id, recurso_chave) do nothing;
  end if;

  -- quem já é cliente fica com a condição de hoje, gravada na empresa
  for r in select e.id, e.plano_id, e.mensalidade from escritorios e
            where e.plano_id in (v_prof, v_emp) and e.matriz_id is null loop
    select p.preco_mensal into v_antigo from planos p where p.id = r.plano_id;
    if r.mensalidade is null and v_antigo.preco_mensal is not null then
      update escritorios set mensalidade = v_antigo.preco_mensal where id = r.id;
    end if;
    insert into escritorio_creditos (escritorio_id, tipo, por_mes)
    select r.id, pc.tipo, pc.por_mes from plano_creditos pc where pc.plano_id = r.plano_id
    on conflict (escritorio_id, tipo) do nothing;
    insert into precos_credito (escritorio_id, tipo, a_partir_de, preco)
    select r.id, pc.tipo, pc.a_partir_de, pc.preco from precos_credito pc
     where pc.plano_id = r.plano_id
       and not exists (select 1 from precos_credito x where x.escritorio_id = r.id and x.tipo = pc.tipo);
    -- quem não tinha extra à venda continua sem (tabela vazia na empresa não existe: fica a do plano novo)
  end loop;

  update planos set
    descricao = 'Todos os serviços: 8 créditos para projetos e 16 para CAR por mês.',
    cor = '#178552', ordem = 10, ativo = true, vende_no_site = true, libera_recursos_novos = true,
    preco_mensal = 299.90, escritorios_adicionais = 0, preco_escritorio = null
   where id = v_prof;
  update planos set
    descricao = 'Créditos ilimitados e até 2 escritórios adicionais.',
    cor = '#0E3B2B', ordem = 20, ativo = true, vende_no_site = true, libera_recursos_novos = true,
    preco_mensal = 1000.00, escritorios_adicionais = 2, preco_escritorio = 99.90
   where id = v_emp;

  insert into plano_creditos (plano_id, tipo, por_mes) values
    (v_prof, 'geral', 8), (v_prof, 'car', 16), (v_emp, 'geral', null), (v_emp, 'car', null)
  on conflict (plano_id, tipo) do update set por_mes = excluded.por_mes;

  delete from precos_credito where plano_id in (v_prof, v_emp);
  insert into precos_credito (plano_id, tipo, a_partir_de, preco) values
    (v_prof, 'geral', 2, 50.00), (v_prof, 'geral', 6, 40.00), (v_prof, 'car', 2, 9.90);

  -- só os dois no cadastro; quem está nos outros continua igual
  update planos set ativo = false, vende_no_site = false where id not in (v_prof, v_emp);

  insert into saas_config (key, value) values ('planos_0050', now()::text);
end $$;

-- ================================================================== permissões
revoke execute on function validar_matriz() from public, anon, authenticated;
revoke execute on function empresa_pagante(uuid) from public, anon, authenticated;
revoke execute on function grupo_empresa(uuid) from public, anon, authenticated;
revoke execute on function limite_escritorios_de(uuid) from public, anon, authenticated;
revoke execute on function preco_escritorio_de(uuid) from public, anon, authenticated;
revoke execute on function escritorios_cobrados(uuid) from public, anon, authenticated;
revoke execute on function mensalidade_de(uuid) from public, anon, authenticated;
revoke execute on function mensalidade_detalhe(uuid) from public, anon, authenticated;
revoke execute on function inicio_periodo(uuid) from public, anon, authenticated;
revoke execute on function renovacao_periodo(uuid) from public, anon, authenticated;
revoke execute on function franquia_credito(uuid, text) from public, anon, authenticated;
revoke execute on function uso_credito(uuid, text) from public, anon, authenticated;
revoke execute on function saldo_extra(uuid, text) from public, anon, authenticated;
revoke execute on function tabela_precos(uuid, text) from public, anon, authenticated;
revoke execute on function consumir_credito() from public, anon, authenticated;
revoke execute on function marcar_primeiro_credito() from public, anon, authenticated;
revoke execute on function matriz_do_dono() from public, anon, authenticated;
revoke execute on function ajustar_escritorios(uuid) from public, anon, authenticated;
revoke execute on function escritorios_seguir_matriz() from public, anon, authenticated;
revoke execute on function planos_ajustar_escritorios() from public, anon, authenticated;
revoke execute on function sou_dono_de(uuid) from public, anon, authenticated;
revoke execute on function plano_publico(uuid) from public, anon, authenticated;
grant execute on function empresa_pagante(uuid) to service_role;
grant execute on function mensalidade_de(uuid) to service_role;
grant execute on function mensalidade_detalhe(uuid) to service_role;
grant execute on function inicio_periodo(uuid) to service_role;
grant execute on function renovacao_periodo(uuid) to service_role;
grant execute on function franquia_credito(uuid, text) to service_role;
grant execute on function uso_credito(uuid, text) to service_role;
grant execute on function saldo_extra(uuid, text) to service_role;
grant execute on function tabela_precos(uuid, text) to service_role;
grant execute on function ajustar_escritorios(uuid) to service_role;
grant execute on function plano_publico(uuid) to service_role;

revoke execute on function escritorio_atual() from public, anon;
grant execute on function escritorio_atual() to authenticated, service_role;
revoke execute on function tem_permissao(text) from public, anon;
grant execute on function tem_permissao(text) to authenticated, service_role;
revoke execute on function meu_escritorio() from public, anon;
grant execute on function meu_escritorio() to authenticated;
revoke execute on function pedir_creditos(text, int, text) from public, anon;
grant execute on function pedir_creditos(text, int, text) to authenticated;
revoke execute on function cancelar_pedido_credito(uuid) from public, anon;
grant execute on function cancelar_pedido_credito(uuid) to authenticated;
revoke execute on function definir_recarga_automatica(text, boolean, int, numeric) from public, anon;
grant execute on function definir_recarga_automatica(text, boolean, int, numeric) to authenticated;
revoke execute on function meus_creditos() from public, anon;
grant execute on function meus_creditos() to authenticated;
revoke execute on function minha_cobranca() from public, anon;
grant execute on function minha_cobranca() to authenticated;
revoke execute on function meus_escritorios() from public, anon;
grant execute on function meus_escritorios() to authenticated;
revoke execute on function criar_escritorio(text) from public, anon;
grant execute on function criar_escritorio(text) to authenticated;
revoke execute on function definir_escritorio(uuid, text, boolean) from public, anon;
grant execute on function definir_escritorio(uuid, text, boolean) to authenticated;
revoke execute on function usar_escritorio(uuid) from public, anon;
grant execute on function usar_escritorio(uuid) to authenticated;
revoke execute on function sa_empresas() from public, anon;
grant execute on function sa_empresas() to authenticated;
revoke execute on function sa_atualizar_empresa(uuid, jsonb) from public, anon;
grant execute on function sa_atualizar_empresa(uuid, jsonb) to authenticated;
revoke execute on function cadastro_planos() from public;
grant execute on function cadastro_planos() to anon, authenticated, service_role;
