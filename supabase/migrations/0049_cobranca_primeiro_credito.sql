-- Mensalidade que começa no 1º crédito gasto (pedido do Wilker, 10/11/2026):
-- para clientes escolhidos, o acesso é liberado já, sem pagar, e a mensalidade
-- só começa a contar no dia em que a empresa gasta o PRIMEIRO crédito. Vale uma
-- vez: depois disso a cobrança segue como a de qualquer empresa (vence no mesmo
-- dia a cada período, vencida suspende, paga reativa).
--
-- Duas portas, as duas escolhidas pela equipe (o cliente nunca escolhe sozinho):
--   1. Painel → Nova empresa → "Liberar agora; a mensalidade começa no 1º crédito";
--   2. o CONVITE: um link de cadastro com token (/cadastro/?convite=<token>), de
--      uso único e com validade, gerado em Configurações → Autocadastro. O link
--      público (?plano=…) continua cobrando no cadastro: a condição não sai de um
--      parâmetro que qualquer um digita, só do token gravado aqui.
--
--   cobranca_empresas.inicio_no_primeiro_credito — a condição (a escolha da equipe)
--   cobranca_empresas.primeiro_credito_em        — quando o 1º crédito foi gasto (o gatilho grava)
--   cobranca_empresas.mensalidade_iniciada_em    — quando a cobrança foi criada no Asaas
--                                                  (pela função `cobranca`, ação iniciar_mensalidade)
--   escritorios.origem 'convite'                 — empresa criada pelo convite
--   convites_cadastro                            — os convites (só superadmin e service_role)
--
-- Quem fala com o Asaas é a função: o banco só marca o dia (não há pg_net nem
-- pg_cron na VPS). A tela chama iniciar_mensalidade quando minha_cobranca()
-- devolve mensalidade_a_iniciar, e a conferência do superadmin pega o resto.
-- No dia do 1º crédito, o mês dos créditos passa a começar nesse dia
-- (dia_renovacao), para o crédito e a mensalidade andarem juntos.
--
-- Depende da 0034, 0037, 0040 e 0044 (redefine minha_cobranca e precisa_cartao).
-- Idempotente. Teste local: `npm run test:rls` (tests/rls/cobranca_primeiro_credito.sql).

-- ================================================================== colunas
alter table cobranca_empresas add column if not exists inicio_no_primeiro_credito boolean not null default false;
alter table cobranca_empresas add column if not exists primeiro_credito_em timestamptz;
alter table cobranca_empresas add column if not exists mensalidade_iniciada_em timestamptz;
create index if not exists cobranca_empresas_a_iniciar on cobranca_empresas (escritorio_id)
  where inicio_no_primeiro_credito and mensalidade_iniciada_em is null;

alter table escritorios drop constraint if exists escritorios_origem_valida;
alter table escritorios add constraint escritorios_origem_valida check (origem in ('painel', 'site', 'convite'));

-- ================================================================== os convites
create table if not exists convites_cadastro (
  id uuid primary key default gen_random_uuid(),
  -- 64 caracteres hexadecimais (dois uuid aleatórios): não dá para adivinhar
  token text not null unique check (token ~ '^[0-9a-f]{64}$'),
  plano_id uuid not null references planos(id) on delete cascade,
  -- para quem (só a anotação da equipe; não aparece para o cliente)
  nome text check (nome is null or length(nome) <= 120),
  expira_em timestamptz not null,
  criado_por uuid,
  criado_em timestamptz not null default now(),
  usado_em timestamptz,
  escritorio_id uuid references escritorios(id) on delete set null,
  cancelado_em timestamptz
);
alter table convites_cadastro enable row level security;
revoke all on convites_cadastro from anon, authenticated;
grant all on convites_cadastro to service_role;

-- ================================================================== a condição
-- A empresa ainda espera o 1º crédito (ou a cobrança dele): nada a cobrar agora.
create or replace function espera_primeiro_credito(p_escritorio uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from cobranca_empresas
                  where escritorio_id = p_escritorio and inicio_no_primeiro_credito and mensalidade_iniciada_em is null)
$$;

-- O 1º crédito gasto: marca o dia (uma vez) e o mês dos créditos passa a começar nele.
create or replace function marcar_primeiro_credito()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  update cobranca_empresas set primeiro_credito_em = now(), atualizado_em = now()
   where escritorio_id = new.escritorio_id and inicio_no_primeiro_credito
     and primeiro_credito_em is null and mensalidade_iniciada_em is null;
  if found then
    update escritorios set dia_renovacao = extract(day from hoje_brasil())::int, atualizado_em = now()
     where id = new.escritorio_id;
    perform registrar_atividade(new.escritorio_id, 'cobranca.primeiro_credito',
      'o 1º crédito foi gasto: a mensalidade começa em ' || to_char(hoje_brasil(), 'DD/MM/YYYY'));
  end if;
  return new;
end $$;

drop trigger if exists consumos_zz_primeiro_credito on consumos_credito;
create trigger consumos_zz_primeiro_credito
  after insert on consumos_credito
  for each row execute function marcar_primeiro_credito();

-- O aviso "Cadastre o cartão" (0037) não aparece enquanto a mensalidade não começou:
-- o cartão cadastrado antes disso criaria uma assinatura antes da hora.
create or replace function precisa_cartao(p_escritorio uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select pagamento_online()
     and not exists (select 1 from cobranca_cartoes where escritorio_id = p_escritorio)
     and not espera_primeiro_credito(p_escritorio)
     and (coalesce(mensalidade_de(p_escritorio), 0) > 0
          or exists (select 1 from tipos_credito t where t.ativo and jsonb_array_length(tabela_precos(p_escritorio, t.chave)) > 0))
$$;

-- ================================================================== a tela de pagamento (0044 + a condição)
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
           -- 0049: a mensalidade começa no 1º crédito gasto
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
    join escritorios e on e.id = m.escritorio_id
    left join planos p on p.id = e.plano_id
    left join cobranca_empresas c on c.escritorio_id = e.id
   where m.user_id = auth.uid()
   limit 1
$$;

-- ================================================================== o convite na página pública
-- O plano no mesmo formato de cadastro_planos() (a página reaproveita o cartão do plano).
create or replace function plano_publico(p_plano uuid)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
           'id', p.id, 'nome', p.nome, 'descricao', p.descricao, 'cor', p.cor,
           'mensalidade', p.preco_mensal, 'limite_usuarios', p.limite_usuarios,
           'creditos', coalesce((
             select jsonb_agg(jsonb_build_object('tipo', t.chave, 'nome', t.nome,
                                                 'por_mes', case when pc.plano_id is null then 0 else pc.por_mes end)
                              order by t.ordem)
               from tipos_credito t
               left join plano_creditos pc on pc.plano_id = p.id and pc.tipo = t.chave
              where t.ativo), '[]'::jsonb),
           'extra', coalesce((
             select jsonb_object_agg(x.tipo, x.faixas)
               from (select pr.tipo, jsonb_agg(jsonb_build_object('a_partir_de', pr.a_partir_de, 'preco', pr.preco)
                                               order by pr.a_partir_de) as faixas
                       from precos_credito pr where pr.plano_id = p.id group by pr.tipo) x), '{}'::jsonb))
    from planos p where p.id = p_plano
$$;

-- PÚBLICA (anon): o que a página de cadastro mostra para um convite. Convite que
-- não existe, usado, cancelado ou vencido: só `valido: false` e o motivo (nunca
-- para quem era nem o plano).
create or replace function convite_cadastro(p_token text)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v convites_cadastro;
  v_plano planos;
begin
  if coalesce(p_token, '') !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('valido', false, 'motivo', 'inexistente');
  end if;
  select * into v from convites_cadastro where token = p_token;
  if not found then return jsonb_build_object('valido', false, 'motivo', 'inexistente'); end if;
  if v.cancelado_em is not null then return jsonb_build_object('valido', false, 'motivo', 'cancelado'); end if;
  if v.usado_em is not null then return jsonb_build_object('valido', false, 'motivo', 'usado'); end if;
  if v.expira_em <= now() then return jsonb_build_object('valido', false, 'motivo', 'expirado'); end if;
  select * into v_plano from planos where id = v.plano_id;
  if not found or not v_plano.ativo or coalesce(v_plano.preco_mensal, 0) <= 0 then
    return jsonb_build_object('valido', false, 'motivo', 'plano');
  end if;
  return jsonb_build_object('valido', true, 'expira_em', v.expira_em, 'inicio_no_primeiro_credito', true,
                            'plano', plano_publico(v.plano_id), 'regras', regras_cadastro());
end $$;

-- Só a função `cobranca` (service_role), no cadastro: reserva o convite (uso
-- único, sob trava). Devolve null se não vale mais. Falhou a criação da conta,
-- a função devolve o convite (usado_em = null).
create or replace function reservar_convite(p_token text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare v convites_cadastro;
begin
  if coalesce(p_token, '') !~ '^[0-9a-f]{64}$' then return null; end if;
  update convites_cadastro set usado_em = now()
   where token = p_token and usado_em is null and cancelado_em is null and expira_em > now()
  returning * into v;
  if not found then return null; end if;
  return jsonb_build_object('id', v.id, 'plano_id', v.plano_id, 'nome', v.nome);
end $$;

-- ================================================================== o superadmin
create or replace function sa_criar_convite(p_plano uuid, p_nome text default null, p_dias int default 30)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_plano planos;
  v convites_cadastro;
begin
  perform exigir_superadmin();
  select * into v_plano from planos where id = p_plano;
  if not found or not v_plano.ativo then raise exception 'Escolha um plano ativo.' using errcode = '22023'; end if;
  if coalesce(v_plano.preco_mensal, 0) <= 0 then
    raise exception 'O plano % não tem mensalidade: defina o preço em Planos.', v_plano.nome using errcode = '22023';
  end if;
  if p_dias is null or p_dias not between 1 and 90 then raise exception 'Validade do convite: de 1 a 90 dias.' using errcode = '22023'; end if;
  insert into convites_cadastro (token, plano_id, nome, expira_em, criado_por)
  values (replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), p_plano,
          nullif(left(btrim(coalesce(p_nome, '')), 120), ''), now() + make_interval(days => p_dias), auth.uid())
  returning * into v;
  return jsonb_build_object('id', v.id, 'token', v.token, 'expira_em', v.expira_em);
end $$;

create or replace function sa_convites()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform exigir_superadmin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', c.id, 'token', c.token, 'nome', c.nome, 'plano_id', c.plano_id, 'plano', p.nome,
             'criado_em', c.criado_em, 'expira_em', c.expira_em, 'usado_em', c.usado_em, 'cancelado_em', c.cancelado_em,
             'escritorio_id', c.escritorio_id, 'empresa', e.nome,
             'situacao', case when c.cancelado_em is not null then 'cancelado'
                              when c.usado_em is not null then 'usado'
                              when c.expira_em <= now() then 'expirado'
                              else 'aberto' end)
           order by c.criado_em desc)
      from (select * from convites_cadastro order by criado_em desc limit 50) c
      left join planos p on p.id = c.plano_id
      left join escritorios e on e.id = c.escritorio_id), '[]'::jsonb);
end $$;

create or replace function sa_cancelar_convite(p_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform exigir_superadmin();
  update convites_cadastro set cancelado_em = now() where id = p_id and usado_em is null and cancelado_em is null;
  if not found then raise exception 'Convite já usado ou cancelado.' using errcode = '22023'; end if;
end $$;

-- A lista de empresas ganha o estado da condição: 'esperando' (ainda sem o 1º
-- crédito) ou 'a_iniciar' (gastou, falta a cobrança no Asaas); null = nada.
drop function if exists sa_empresas();
create or replace function sa_empresas()
returns table (
  id uuid, nome text, cnpj text, responsavel text, telefone text, email text, status text,
  plano_id uuid, plano text, observacoes text, created_at timestamptz,
  usuarios int, servicos int, servicos_30d int, ultimo_servico timestamptz, ultimo_acesso timestamptz,
  excecoes int, mensalidade numeric, cobranca text, vencimento date, inicio_cobranca text
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
         c.situacao, c.proximo_vencimento,
         case when c.inicio_no_primeiro_credito and c.mensalidade_iniciada_em is null
              then case when c.primeiro_credito_em is null then 'esperando' else 'a_iniciar' end end
    from escritorios e
    left join planos p on p.id = e.plano_id
    left join cobranca_empresas c on c.escritorio_id = e.id
   order by e.created_at desc;
end $$;

-- ================================================================== permissões
revoke execute on function espera_primeiro_credito(uuid) from public, anon, authenticated;
grant execute on function espera_primeiro_credito(uuid) to service_role;
revoke execute on function marcar_primeiro_credito() from public, anon, authenticated;
revoke execute on function precisa_cartao(uuid) from public, anon, authenticated;
grant execute on function precisa_cartao(uuid) to service_role;
revoke execute on function minha_cobranca() from public, anon;
grant execute on function minha_cobranca() to authenticated;
revoke execute on function plano_publico(uuid) from public, anon, authenticated;
grant execute on function plano_publico(uuid) to service_role;
revoke execute on function convite_cadastro(text) from public;
grant execute on function convite_cadastro(text) to anon, authenticated, service_role;
revoke execute on function reservar_convite(text) from public, anon, authenticated;
grant execute on function reservar_convite(text) to service_role;
revoke execute on function sa_criar_convite(uuid, text, int) from public, anon;
grant execute on function sa_criar_convite(uuid, text, int) to authenticated;
revoke execute on function sa_convites() from public, anon;
grant execute on function sa_convites() to authenticated;
revoke execute on function sa_cancelar_convite(uuid) from public, anon;
grant execute on function sa_cancelar_convite(uuid) to authenticated;
revoke execute on function sa_empresas() from public, anon;
grant execute on function sa_empresas() to authenticated;
