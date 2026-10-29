-- Teste da auditoria (supabase/migrations/0026_auditoria.sql).
-- Roda depois de tests/rls/equipe.sql, no mesmo cenário:
--   B = escritório do cadastro: b1 dono, b2 gerente (equipe.gerenciar, servicos.criar),
--   b3 campo (servicos.criar, ativo)
\set ON_ERROR_STOP 1

\set b1 '''b1000000-0000-0000-0000-000000000001'''
\set b2 '''b2000000-0000-0000-0000-000000000002'''
\set b3 '''b3000000-0000-0000-0000-000000000003'''
\set sa '''5a000000-0000-0000-0000-00000000000a'''

create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FALHOU: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;
grant execute on all functions in schema pg_temp to public;

select id as esc_b from escritorios where not modelos_compartilhados \gset

-- ---------------------------------------------------------------- campo cria e edita
select set_config('request.jwt.claim.sub', 'b3000000-0000-0000-0000-000000000003', false);
set role authenticated;
insert into servicos (id, nome_arquivo_txt) values (:sa, 'auditoria.txt');
update servicos set denominacao = 'Fazenda Auditada' where id = :sa;
update servicos set municipio = 'Pombal' where id = :sa;
update servicos set municipio = 'Pombal' where id = :sa;   -- nada muda: não registra
insert into vertices (servico_id, ordem) values (:sa, 0), (:sa, 1), (:sa, 2);
update vertices set ordem = ordem where servico_id = :sa;
select pg_temp.ok((select criado_por from servicos where id = :sa) = :b3, 'serviço guarda quem criou');
select pg_temp.ok((select atualizado_por from servicos where id = :sa) = :b3, 'serviço guarda quem mexeu por último');
select pg_temp.ok((select criado_por from autoria_servicos(array[:sa]::uuid[])) = 'Equipe de Campo',
                  'autoria_servicos mostra o nome de quem criou (qualquer pessoa da empresa)');
reset role;

-- ---------------------------------------------------------------- dono mexe depois
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', false);
set role authenticated;
update servicos set uf = 'PB' where id = :sa;
select pg_temp.ok((select criado_por from servicos where id = :sa) = :b3, 'criado_por não muda com a edição de outro');
select pg_temp.ok((select atualizado_por from servicos where id = :sa) = :b1, 'última alteração passa para o dono');

select pg_temp.ok((select count(*) from listar_atividades(500, :b3::uuid, null, null) where acao = 'servico.alterado') = 1,
                  'edições seguidas da mesma pessoa viram uma linha');
select pg_temp.ok((select vezes from listar_atividades(500, :b3::uuid, null, null) where acao = 'servico.alterado') = 2,
                  'a linha conta as gravações');
select pg_temp.ok((select detalhe->'campos' from listar_atividades(500, :b3::uuid, null, null) where acao = 'servico.alterado')
                  = '["denominacao", "municipio"]'::jsonb, 'campos alterados somados');
select pg_temp.ok((select count(*) from listar_atividades(500, :b3::uuid, null, null) where acao = 'vertices.alterados') = 1,
                  'vértices: um registro por pessoa e serviço, não um por linha');
select pg_temp.ok((select count(*) from listar_atividades(500, null, :sa::uuid, null)) = 4,
                  'filtro por serviço: criado, alterado (campo), vértices, alterado (dono)');
select pg_temp.ok((select quem from listar_atividades(500, null, :sa::uuid, null) where acao = 'servico.criado') = 'Equipe de Campo',
                  'criação no nome de quem fez');
reset role;

-- ---------------------------------------------------------------- service_role (edge functions)
reset role;
select set_config('request.jwt.claim.sub', '', false);
update servicos set status = 'gerado' where id = :sa;
select pg_temp.ok((select atualizado_por from servicos where id = :sa) = :b1, 'escrita da service_role não troca o autor');
insert into documentos_gerados (servico_id, versao, tipo, titulo, path, gerado_por)
values (:sa, 1, 'memorial_docx', 'Memorial', 'x/1.docx', :b3), (:sa, 1, 'planilha_ods', 'Planilha', 'x/1.ods', :b3);
select pg_temp.ok((select count(*) from atividades where servico_id = :sa and acao = 'documento.gerado') = 1,
                  'uma geração com vários arquivos vira uma linha');
select pg_temp.ok((select user_id from atividades where servico_id = :sa and acao = 'documento.gerado') = :b3,
                  'documento gerado pela edge function sai no nome de quem pediu (gerado_por)');
select pg_temp.ok((select count(*) from atividades where servico_id = :sa and acao = 'servico.alterado' and user_id is null) = 0,
                  'service_role não gera "alterado"');

-- ---------------------------------------------------------------- leitura
select set_config('request.jwt.claim.sub', 'b3000000-0000-0000-0000-000000000003', false);
set role authenticated;
select pg_temp.ok((select count(*) from listar_atividades()) = 0, 'sem equipe.gerenciar, não lê a auditoria');
reset role;
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-000000000002', false);
set role authenticated;
select pg_temp.ok((select count(*) from listar_atividades(500, null, :sa::uuid, null)) >= 5, 'gerente lê a auditoria do serviço');
reset role;

\echo 'auditoria: todos os testes passaram'
