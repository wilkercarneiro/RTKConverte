-- Concluir serviço: o fim do trabalho passa a ser uma decisão, não uma dedução.
--
-- Antes, "concluído" era só o progresso calculado pela tela (todos os
-- documentos da modalidade gerados). Agora a equipe clica em "Concluir
-- serviço": grava quando e quem (servicos.concluido_em / concluido_por), o
-- histórico registra "concluiu o serviço" e, se o serviço executa um pedido do
-- GPROL, o pedido vira "entregue" quando TODOS os serviços principais dele estão
-- concluídos (Geo + CAR = os dois). O marco "entregue" vai pela fila e o card
-- anda, no GPROL, para a etapa escolhida para ele (a sugestão de lá procura
-- ENTREG/CONCLU no nome das etapas). Reabrir desfaz aqui; o card não volta (lá
-- o funil só anda para frente).
--
-- Os serviços que a tela já mostrava como concluídos ganham a data do último
-- documento, ANTES de o gatilho existir: nenhum pedido muda por causa disso.
--
-- Idempotente.

alter table public.servicos add column if not exists concluido_em timestamptz;
alter table public.servicos add column if not exists concluido_por uuid references auth.users(id) on delete set null;

-- ------------------------------------------------------------------ legado
-- Mesma regra de src/lib/progresso.ts (progressoDe) que valia até aqui.
with docs as (
  select servico_id,
    bool_or(tipo in ('memorial_docx', 'planilha_ods', 'planta_pdf_sistema', 'gleba_planta_pdf', 'memorial_tabular')) as etapa1,
    bool_or(tipo = 'planta_pdf') as planta,
    bool_or(tipo not in ('memorial_docx', 'planilha_ods', 'planta_pdf_sistema', 'gleba_planta_pdf', 'memorial_tabular',
                         'planta_pdf', 'planta_pdf_editada')) as pecas,
    max(created_at) as ultimo
  from public.documentos_gerados group by servico_id
)
update public.servicos s
   set concluido_em = coalesce(d.ultimo, s.atualizado_em, s.created_at)
  from (select s2.id, d2.etapa1, d2.planta, d2.pecas, d2.ultimo
          from public.servicos s2 left join docs d2 on d2.servico_id = s2.id) d
 where d.id = s.id
   and s.concluido_em is null
   and case
         when s.tipo = 'pecas' then coalesce(d.pecas, false) and coalesce(d.planta, false)
         when s.modalidade in ('loteamento', 'car') then s.status = 'gerado'
         when coalesce(s.modalidade, '') <> 'completo' then coalesce(d.etapa1, false)
         else coalesce(d.etapa1, false) and coalesce(d.planta, false) and coalesce(d.pecas, false)
       end;

-- ------------------------------------------------------------------ quem e quando
-- A hora é a do servidor e o autor é quem está logado (a tela só manda "agora" ou nulo).
create or replace function public.servico_carimbar_conclusao()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.concluido_em is null then
    new.concluido_por := null;
  elsif old.concluido_em is null then
    new.concluido_em := now();
    new.concluido_por := coalesce(auth.uid(), new.concluido_por);
  else
    -- já concluído: data e autor não mudam por uma nova gravação
    new.concluido_em := old.concluido_em;
    new.concluido_por := old.concluido_por;
  end if;
  return new;
end $$;
drop trigger if exists servicos_carimbar_conclusao on public.servicos;
create trigger servicos_carimbar_conclusao before update of concluido_em on public.servicos
  for each row execute function public.servico_carimbar_conclusao();

-- ------------------------------------------------------------------ histórico + GPROL
create or replace function public.servico_conclusao()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare p pedidos_externos;
begin
  perform registrar_auditoria(new.escritorio_id, coalesce(auth.uid(), new.concluido_por),
    case when new.concluido_em is null then 'servico.reaberto' else 'servico.concluido' end,
    nome_do_servico(new), new.id, new.id, null, null);

  -- serviço derivado (gleba, parte) não decide o pedido: quem decide é o principal
  if new.pedido_externo_id is null or new.origem_id is not null then return null; end if;
  select * into p from pedidos_externos where id = new.pedido_externo_id;
  if p.id is null then return null; end if;

  if new.concluido_em is not null then
    if p.status in ('pendente', 'em_execucao') and not exists (
      select 1 from servicos s
       where s.pedido_externo_id = p.id and s.origem_id is null and s.concluido_em is null) then
      update pedidos_externos set status = 'entregue', entregue_em = now(), atualizado_em = now() where id = p.id;
      perform integracao_enfileirar(new.escritorio_id, 'pedido', p.id);
    end if;
  elsif p.status = 'entregue' then
    update pedidos_externos set status = 'em_execucao', entregue_em = null, atualizado_em = now() where id = p.id;
    perform integracao_enfileirar(new.escritorio_id, 'pedido', p.id);
  end if;
  return null;
end $$;
drop trigger if exists servicos_conclusao on public.servicos;
create trigger servicos_conclusao after update of concluido_em on public.servicos
  for each row when (old.concluido_em is distinct from new.concluido_em)
  execute function public.servico_conclusao();

-- O "alterou o serviço" genérico não repete a conclusão (ela tem linha própria).
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
      array['atualizado_por', 'atualizado_em', 'criado_por', 'created_at', 'escritorio_id', 'id',
            'concluido_em', 'concluido_por']);
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
