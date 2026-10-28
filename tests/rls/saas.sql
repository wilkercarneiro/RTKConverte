-- Teste da migração do SaaS (supabase/migrations/0024_saas.sql).
-- Roda depois de tests/rls/escritorios.sql (etapa depois), sobre o mesmo cenário:
--   A = escritório legado (a1 dono, a2 membro), serviço s1 de loteamento
--   B = escritório do cadastro (b1 dono, b2 membro), serviço sb completo
\set ON_ERROR_STOP 1

\set a1 '''a1000000-0000-0000-0000-000000000001'''
\set b1 '''b1000000-0000-0000-0000-000000000001'''
\set b2 '''b2000000-0000-0000-0000-000000000002'''
\set sb '''5b000000-0000-0000-0000-000000000001'''

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
create function pg_temp.afetadas(cmd text) returns int language plpgsql as $$
declare n int;
begin
  execute cmd;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on all functions in schema pg_temp to public;

select id as esc_a from escritorios where modelos_compartilhados \gset
select id as esc_b from escritorios where not modelos_compartilhados \gset
select id as pl_essencial from planos where nome = 'Essencial' \gset

-- ---------------------------------------------------------------- estado inicial
select pg_temp.ok((select count(*) from planos) = 3, 'três planos de partida');
select pg_temp.ok((select p.nome from escritorios e join planos p on p.id = e.plano_id where e.id = :'esc_a') = 'Completo',
                  'a empresa que já usava fica no plano Completo');
select pg_temp.ok((select plano_id from escritorios where id = :'esc_b') is null, 'empresa sem plano segue o padrão do catálogo');
select pg_temp.ok((select status from escritorios where id = :'esc_a') = 'ativo', 'empresas nascem ativas');
select pg_temp.ok((select value from saas_config where key = 'senha_padrao') is not null, 'senha padrão configurada');

-- ---------------------------------------------------------------- quem não é superadmin
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok(not sou_superadmin(), 'dono de escritório não é superadmin');
select pg_temp.ok(pg_temp.recusa('select * from sa_empresas()'), 'só o superadmin lista as empresas');
select pg_temp.ok(pg_temp.recusa($$select sa_sincronizar_recursos('[{"chave":"x","nome":"x"}]')$$), 'só o superadmin sincroniza o catálogo');
select pg_temp.ok(pg_temp.recusa(format('select sa_atualizar_empresa(%L, %L)', :'esc_b', '{"status":"ativo"}')), 'só o superadmin altera empresa');
select pg_temp.ok(pg_temp.recusa($$insert into planos (nome) values ('Pirata')$$), 'cliente não cria plano');
select pg_temp.ok((select count(*) from plano_recursos) = 0, 'cliente não lê a matriz dos planos');
select pg_temp.ok((select count(*) from saas_config) = 0, 'cliente não lê a senha padrão');
select pg_temp.ok((select count(*) from contatos_site) = 0, 'cliente não lê os contatos do site');
select pg_temp.ok(pg_temp.recusa(format('update escritorios set plano_id = %L', :'pl_essencial')), 'dono não troca o próprio plano');
select pg_temp.ok(pg_temp.recusa($$update escritorios set status = 'ativo'$$), 'dono não mexe no próprio status');
select pg_temp.ok((select count(*) from escritorios) = 1, 'cliente segue vendo só a própria empresa');
select pg_temp.ok((minha_conta() -> 'recursos' ->> 'servico.loteamento')::boolean, 'sem plano, o loteamento segue o padrão (liberado)');
select pg_temp.ok(not (minha_conta() ->> 'superadmin')::boolean, 'minha_conta: não é superadmin');
reset role;

-- ---------------------------------------------------------------- superadmin
insert into super_admins (user_id) values (:a1);
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok(sou_superadmin(), 'a1 é superadmin');
select pg_temp.ok((select count(*) from sa_empresas()) = 2, 'superadmin vê as duas empresas');
select pg_temp.ok((select servicos from sa_empresas() where id = :'esc_b') >= 1, 'contagem de serviços por empresa');
select pg_temp.ok((select count(*) from sa_empresa_usuarios(:'esc_b')) = 2, 'usuários da empresa B');
select pg_temp.ok((select count(*) from servicos where escritorio_id = :'esc_b') = 0, 'superadmin não lê os serviços de outra empresa (só números)');

-- recurso novo vindo do código: aparece no catálogo, inativa o que saiu
select pg_temp.ok(sa_sincronizar_recursos((
  select jsonb_agg(jsonb_build_object('chave', chave, 'nome', nome, 'grupo', grupo)) from recursos where chave like 'servico.%'
) || '[{"chave":"recurso.teste","nome":"Recurso de teste","grupo":"Testes","padrao":false}]'::jsonb) = 1,
  'sincronizar devolve 1 recurso novo');
select pg_temp.ok((select grupo from recursos where chave = 'recurso.teste') = 'Testes', 'recurso novo gravado com o grupo');
select pg_temp.ok(sa_sincronizar_recursos((
  select jsonb_agg(jsonb_build_object('chave', chave, 'nome', nome)) from recursos where chave like 'servico.%'
)) = 0, 'sincronizar de novo não cria nada');
select pg_temp.ok(not (select ativo from recursos where chave = 'recurso.teste'), 'recurso que saiu do código fica inativo');
select sa_sincronizar_recursos((
  select jsonb_agg(jsonb_build_object('chave', chave, 'nome', nome, 'padrao', chave <> 'recurso.teste')) from recursos
));

-- plano e status
select sa_atualizar_empresa(:'esc_b', jsonb_build_object('plano_id', :'pl_essencial', 'cnpj', '12.345.678/0001-90', 'telefone', '(71) 99999-0000'));
select pg_temp.ok((select cnpj from escritorios where id = :'esc_b') = '12345678000190', 'CNPJ gravado só com dígitos');
select pg_temp.ok((select telefone from escritorios where id = :'esc_b') = '71999990000', 'telefone gravado só com dígitos');
select pg_temp.ok(pg_temp.recusa(format('select sa_atualizar_empresa(%L, %L)', :'esc_b', '{"status":"pirata"}')), 'status inválido recusado');
select pg_temp.ok((select count(*) from plano_recursos) > 0, 'superadmin lê a matriz dos planos');
select pg_temp.ok((select value from saas_config where key = 'senha_padrao') is not null, 'superadmin lê a senha padrão');
reset role;

-- ---------------------------------------------------------------- plano Essencial na empresa B
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok(not (minha_conta() -> 'recursos' ->> 'servico.loteamento')::boolean, 'Essencial não libera loteamento');
select pg_temp.ok((minha_conta() -> 'recursos' ->> 'servico.conferencia')::boolean, 'Essencial libera conferência');
select pg_temp.ok(not (minha_conta() -> 'recursos' ->> 'recurso.teste')::boolean, 'recurso novo segue o padrão do catálogo (bloqueado)');
select pg_temp.ok(pg_temp.recusa(format($$update servicos set modalidade = 'loteamento' where id = %L$$, '5b000000-0000-0000-0000-000000000001')),
                  'banco recusa virar loteamento fora do plano');
select pg_temp.ok(pg_temp.afetadas(format($$update servicos set modalidade = 'conferencia' where id = %L$$, '5b000000-0000-0000-0000-000000000001')) = 1,
                  'conferência, que o plano libera, passa');
select pg_temp.ok(pg_temp.afetadas(format($$update servicos set denominacao = 'FAZENDA B' where id = %L$$, '5b000000-0000-0000-0000-000000000001')) = 1,
                  'editar outros campos não passa pela trava');
reset role;

-- exceção para a empresa
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select sa_definir_recurso_empresa(:'esc_b', 'servico.loteamento', true, 'piloto');
select pg_temp.ok((select origem from sa_recursos_empresa(:'esc_b') where chave = 'servico.loteamento') = 'excecao', 'origem da decisão: exceção');
select pg_temp.ok((select origem from sa_recursos_empresa(:'esc_b') where chave = 'servico.car') = 'plano', 'origem da decisão: plano');
reset role;

select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok(pg_temp.afetadas(format($$update servicos set modalidade = 'loteamento' where id = %L$$, '5b000000-0000-0000-0000-000000000001')) = 1,
                  'com a exceção, vira loteamento');
reset role;

select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select sa_definir_recurso_empresa(:'esc_b', 'servico.loteamento', null);
select pg_temp.ok((select count(*) from escritorio_recursos) = 0, 'exceção removida volta a seguir o plano');
-- suspende B
select sa_atualizar_empresa(:'esc_b', '{"status":"suspenso"}');
reset role;

select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-000000000002', false);
set role authenticated;
select pg_temp.ok((select count(*) from servicos) = 0 and (select count(*) from clientes) = 0, 'empresa suspensa não vê os próprios dados');
select pg_temp.ok((select status from meu_escritorio()) = 'suspenso', 'meu_escritorio() diz que está suspensa');
select pg_temp.ok(pg_temp.recusa($$insert into clientes (nome) values ('durante a suspensão')$$), 'empresa suspensa não grava');
reset role;

select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select sa_atualizar_empresa(:'esc_b', '{"status":"ativo"}');
reset role;

-- ---------------------------------------------------------------- senha provisória
insert into senhas_provisorias (user_id) values (:b2);
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-000000000002', false);
set role authenticated;
select pg_temp.ok((select count(*) from clientes) = 1, 'reativada, a empresa volta a ver tudo');
select pg_temp.ok((minha_conta() ->> 'trocar_senha')::boolean, 'senha provisória pede a troca');
select pg_temp.ok(pg_temp.recusa('select * from senhas_provisorias'), 'a tabela de senhas provisórias não é legível');
select marcar_senha_trocada();
select pg_temp.ok(not (minha_conta() ->> 'trocar_senha')::boolean, 'depois da troca não pede mais');
reset role;

-- ---------------------------------------------------------------- página pública
select set_config('request.jwt.claim.sub', '', false);
set role anon;
insert into contatos_site (nome, telefone, empresa, origem) values ('Fulano', '71999990000', 'Topografia X', 'site');
select pg_temp.ok(pg_temp.recusa($$insert into contatos_site (nome, telefone) values ('x', '1')$$), 'contato com dados inválidos recusado');
select pg_temp.ok(pg_temp.recusa($$insert into contatos_site (nome, telefone, status) values ('Fulano', '71999990000', 'fechado')$$), 'anônimo não escolhe o status');
select pg_temp.ok(pg_temp.recusa('select * from contatos_site'), 'anônimo não lê os contatos');
select pg_temp.ok(pg_temp.recusa('select minha_conta()'), 'anônimo não chama minha_conta()');
reset role;

select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok((select count(*) from contatos_site) = 1, 'superadmin lê o pedido de reunião');
select pg_temp.ok(pg_temp.afetadas($$update contatos_site set status = 'reuniao'$$) = 1, 'superadmin muda a etapa do contato');
reset role;

\echo 'saas: todos os testes passaram'
