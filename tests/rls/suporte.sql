-- Teste da 0029 (suporte, acessos, equipe com descrição, clientes completos).
-- Roda depois de tests/rls/creditos.sql, no mesmo cenário:
--   A = escritório legado (a1 é superadmin)   B = escritório novo (b1 dono)
-- Aqui entram em B: c1 (operador sem gestão) e c2 (operador sem gestão).
\set ON_ERROR_STOP 1

\set b1 '''b1000000-0000-0000-0000-000000000001'''
\set c1 '''c1000000-0000-0000-0000-000000000001'''
\set c2 '''c2000000-0000-0000-0000-000000000002'''

create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FALHOU: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;
create function pg_temp.recusa(cmd text) returns boolean language plpgsql as $$
begin
  execute cmd;
  return false;
exception when others then
  return true;
end $$;
grant execute on all functions in schema pg_temp to public;

select id as esc_a from escritorios where modelos_compartilhados \gset
select id as esc_b from escritorios where not modelos_compartilhados \gset

-- dois operadores novos em B, sem limite de plano no caminho
update planos set limite_usuarios = null;
insert into auth.users (id, email) values (:c1, 'op1@novo.test'), (:c2, 'op2@novo.test');
insert into membros_escritorio (escritorio_id, user_id, papel, nome, permissoes)
values (:'esc_b', :c1, 'membro', 'Operador Um', array['servicos.criar']),
       (:'esc_b', :c2, 'membro', 'Operador Dois', array['servicos.criar']);

-- ---------------------------------------------------------------- equipe: descrição e telefone
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select definir_membro(:c1, 'Operador Um', 'Topógrafo', array['servicos.criar'], true, 'Levantamento de campo e TXT', '(74) 99999-0000');
select pg_temp.ok((select descricao from listar_membros() where user_id = :c1) = 'Levantamento de campo e TXT', 'descrição gravada e listada');
select pg_temp.ok((select telefone from listar_membros() where user_id = :c1) = '(74) 99999-0000', 'telefone gravado e listado');
-- chamada antiga (cinco parâmetros) não apaga a descrição
select definir_membro(:c1, 'Operador Um', 'Topógrafo', array['servicos.criar'], true);
select pg_temp.ok((select descricao from listar_membros() where user_id = :c1) = 'Levantamento de campo e TXT', 'chamada antiga mantém a descrição');
reset role;

select set_config('request.jwt.claim.sub', 'c1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select atualizar_meu_perfil('Operador Um da Silva', '(74) 3333-0000');
select pg_temp.ok(pg_temp.recusa($$select atualizar_meu_perfil('', null)$$), 'perfil sem nome é recusado');
select pg_temp.ok(pg_temp.recusa(format('select definir_membro(%L, %L, null, null, true, %L)', 'c2000000-0000-0000-0000-000000000002', 'X', 'y')),
                  'operador sem gestão não descreve colega');
reset role;
select pg_temp.ok((select nome from membros_escritorio where user_id = :c1) = 'Operador Um da Silva', 'operador corrige o próprio nome');

-- ---------------------------------------------------------------- acessos
select set_config('request.headers', '{"x-forwarded-for": "200.1.2.3, 10.0.0.1"}', false);
select set_config('request.jwt.claim.sub', 'c1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select registrar_acesso('Chrome 130', 'Windows', 'computador', 'inicio');
select registrar_acesso('Chrome 130', 'Windows', 'computador', 'servicos');
select registrar_acesso('Safari 18', 'iOS', 'celular', 'inicio');
select pg_temp.ok((select count(*) from acessos) = 0, 'operador não lê a tabela de acessos');
select pg_temp.ok((select count(*) from listar_acessos()) = 0, 'operador sem gestão não lista acessos');
select pg_temp.ok(pg_temp.recusa($$insert into acessos (user_id) values ('c1000000-0000-0000-0000-000000000001')$$), 'acesso não se grava à mão');
reset role;
select pg_temp.ok((select count(*) from acessos where user_id = :c1) = 2, 'mesmo navegador em 30 min = mesma sessão; outro aparelho = sessão nova');
select pg_temp.ok((select telas from acessos where user_id = :c1 and navegador = 'Chrome 130') = 2, 'a sessão soma as telas');
select pg_temp.ok((select ip from acessos where user_id = :c1 limit 1) = '200.1.2.3', 'IP vem do primeiro x-forwarded-for');
select pg_temp.ok((select escritorio_id from acessos where user_id = :c1 limit 1) = :'esc_b', 'sessão fica na empresa da pessoa');

select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok((select count(*) from listar_acessos()) = 2, 'dono lista as sessões da empresa');
select pg_temp.ok((select count(*) from listar_acessos(100, :c2)) = 0, 'filtro por pessoa');
select pg_temp.ok((select sessoes from uso_da_equipe(30) where user_id = :c1) = 2, 'uso da equipe conta as sessões');
select pg_temp.ok((select count(*) from uso_da_equipe(30)) >= 3, 'uso da equipe lista todo mundo');
select pg_temp.ok(pg_temp.recusa(format('select * from sa_acessos(%L)', :'esc_b')), 'só o superadmin vê as sessões pelo painel');
reset role;

-- ---------------------------------------------------------------- clientes completos e histórico
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', false);
set role authenticated;
insert into clientes (nome, tipo_pessoa, rg, estado_civil, profissao, cidade, uf, cep)
values ('JOSÉ TESTE', 'PF', '12.345.678-90', 'casado', 'agricultor', 'Irecê', 'BA', '44900-000');
select pg_temp.ok((select estado_civil from clientes where nome = 'JOSÉ TESTE') = 'casado', 'cliente grava a qualificação');
select pg_temp.ok(pg_temp.recusa($$update clientes set tipo_pessoa = 'XX' where nome = 'JOSÉ TESTE'$$), 'tipo de pessoa só PF ou PJ');
update clientes set profissao = 'produtor rural' where nome = 'JOSÉ TESTE';
reset role;
select id as cli from clientes where nome = 'JOSÉ TESTE' \gset
select set_config('request.jwt.claim.sub', 'c2000000-0000-0000-0000-000000000002', false);
set role authenticated;
select pg_temp.ok((select count(*) from historico_cliente(:'cli')) >= 2, 'operador sem gestão vê o histórico do cliente');
select pg_temp.ok((select count(*) from historico_cliente(:'cli') where acao = 'cliente.alterado') = 1, 'alteração do cliente no histórico');
reset role;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok((select count(*) from historico_cliente(:'cli')) = 0, 'outra empresa não vê o histórico');
reset role;

-- ---------------------------------------------------------------- suporte: a empresa abre
select set_config('request.jwt.claim.sub', 'c1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select abrir_chamado('Erro ao gerar a planta', 'A planta não sai.', 'erro', 'alta',
  jsonb_build_array(jsonb_build_object('path', :'esc_b' || '/x/print.png', 'nome', 'print.png', 'tipo', 'image/png', 'tamanho', 1200),
                    jsonb_build_object('path', :'esc_a' || '/x/alheio.png', 'nome', 'alheio.png')),
  '{"tela": "servico"}') as chamado \gset
select pg_temp.ok((select count(*) from meus_chamados()) = 1, 'quem abriu vê o chamado');
select pg_temp.ok((select jsonb_array_length(anexos) from chamado_mensagens where chamado_id = :'chamado') = 1, 'anexo de outra empresa é descartado');
select pg_temp.ok((select status from chamados where id = :'chamado') = 'aberto', 'chamado nasce aberto');
select pg_temp.ok(pg_temp.recusa($$select abrir_chamado('', 'x')$$), 'chamado sem assunto é recusado');
select pg_temp.ok(pg_temp.recusa(format($$update chamados set status = 'resolvido' where id = %L$$, :'chamado')) or
                  (select status from chamados where id = :'chamado') = 'aberto', 'empresa não muda o status direto na tabela');
select pg_temp.ok(pg_temp.recusa(format($$select sa_responder_chamado(%L, 'oi')$$, :'chamado')), 'empresa não responde como suporte');
reset role;

select set_config('request.jwt.claim.sub', 'c2000000-0000-0000-0000-000000000002', false);
set role authenticated;
select pg_temp.ok((select count(*) from meus_chamados()) = 0, 'colega sem gestão não vê o chamado de outro');
select pg_temp.ok((select count(*) from chamado_mensagens) = 0, 'colega sem gestão não lê as mensagens');
select pg_temp.ok(pg_temp.recusa(format($$select responder_chamado(%L, 'intruso')$$, :'chamado')), 'colega sem gestão não responde');
reset role;

select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok((select count(*) from meus_chamados()) = 1, 'dono vê os chamados da empresa');
select pg_temp.ok(not (select meu from meus_chamados() limit 1), 'dono vê que o chamado não é dele');
reset role;

-- ---------------------------------------------------------------- suporte: o superadmin responde
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok((sa_contagem_suporte() ->> 'esperando')::int = 1, 'painel conta o chamado esperando o suporte');
select pg_temp.ok((select nao_lidas from sa_chamados() where id = :'chamado') = 1, 'mensagem nova para o suporte');
select pg_temp.ok((select empresa from sa_chamados() where id = :'chamado') = (select nome from escritorios where id = :'esc_b'), 'chamado mostra a empresa');
select sa_responder_chamado(:'chamado', 'Nota: reproduzi aqui.', '[]', true);
select sa_responder_chamado(:'chamado', 'Corrigido, pode gerar de novo.');
select pg_temp.ok((select status from chamados where id = :'chamado') = 'aguardando_cliente', 'responder põe "aguardando a empresa"');
select pg_temp.ok((select primeira_resposta_em from chamados where id = :'chamado') is not null, 'primeira resposta registrada');
select pg_temp.ok((sa_contagem_suporte() ->> 'esperando')::int = 0, 'nada mais esperando o suporte');
select pg_temp.ok((select nao_lidas from sa_chamados() where id = :'chamado') = 0, 'responder marca como lido pelo suporte');
reset role;

select set_config('request.jwt.claim.sub', 'c1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok((select nao_lidas from meus_chamados() where id = :'chamado') = 1, 'empresa vê 1 resposta não lida');
select pg_temp.ok((select count(*) from chamado_mensagens where chamado_id = :'chamado') = 2, 'nota interna do suporte não aparece para a empresa');
select marcar_chamado_lido(:'chamado');
select pg_temp.ok((select nao_lidas from meus_chamados() where id = :'chamado') = 0, 'marcar como lido zera');
select responder_chamado(:'chamado', 'Funcionou, obrigado!');
select pg_temp.ok((select status from chamados where id = :'chamado') = 'aberto', 'resposta da empresa reabre o chamado');
select encerrar_chamado(:'chamado', 5, 'Rápido');
select pg_temp.ok((select status || avaliacao from chamados where id = :'chamado') = 'resolvido5', 'empresa encerra e avalia');
reset role;

select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select sa_atualizar_chamado(:'chamado', 'em_atendimento', 'urgente');
select pg_temp.ok((select prioridade || status from chamados where id = :'chamado') = 'urgenteem_atendimento', 'suporte muda status e prioridade');
select pg_temp.ok((select count(*) from chamado_mensagens where chamado_id = :'chamado' and autor_tipo = 'sistema') = 2, 'mudanças de status ficam na conversa');
reset role;

-- ---------------------------------------------------------------- anexos no storage
select set_config('request.jwt.claim.sub', 'c1000000-0000-0000-0000-000000000001', false);
set role authenticated;
insert into storage.objects (bucket_id, name) values ('suporte', :'esc_b' || '/x/print.png');
select pg_temp.ok(pg_temp.recusa(format($$insert into storage.objects (bucket_id, name) values ('suporte', %L)$$, :'esc_a' || '/x/a.png')),
                  'ninguém grava anexo na pasta de outra empresa');
reset role;

-- ---------------------------------------------------------------- tutoriais
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', false);
set role authenticated;
insert into tutoriais (modulo, titulo, publicado) values ('inicio', 'Primeiro serviço', true), ('equipe', 'Rascunho', false);
reset role;
select set_config('request.jwt.claim.sub', 'c1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok((select count(*) from tutoriais) = 1, 'empresa vê só os tutoriais publicados');
select pg_temp.ok(pg_temp.recusa($$insert into tutoriais (modulo, titulo) values ('x', 'y')$$), 'empresa não cadastra tutorial');
reset role;
