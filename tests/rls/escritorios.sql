-- Teste da migração de escritórios (docs/multiescritorio/0020_escritorios.sql).
-- Rodado por scripts/testar-rls.sh em DUAS etapas, com a migração no meio:
--   psql -v etapa=antes  → dados do escritório que já existe (legado)
--   psql -v etapa=depois → isolamento entre dois escritórios
\set ON_ERROR_STOP 1

-- ids fixos para enxergar o cenário
\set a1 '''a1000000-0000-0000-0000-000000000001'''
\set a2 '''a2000000-0000-0000-0000-000000000002'''
\set b1 '''b1000000-0000-0000-0000-000000000001'''
\set b2 '''b2000000-0000-0000-0000-000000000002'''
\set s1 '''51000000-0000-0000-0000-000000000001'''
\set sb '''5b000000-0000-0000-0000-000000000001'''
\set c1 '''c1000000-0000-0000-0000-000000000001'''
\set cb '''cb000000-0000-0000-0000-000000000001'''

\if :{?etapa}
\else
  \echo 'informe -v etapa=antes|depois'
  \quit
\endif

select :'etapa' = 'antes' as eh_antes \gset
\if :eh_antes
-- ====================================================================== ANTES
-- o escritório de hoje: dois operadores, cadastros, um serviço completo
insert into auth.users (id, email, created_at) values
  (:a1, 'dono@legado.test', now() - interval '2 years'),
  (:a2, 'operador@legado.test', now() - interval '1 year');
insert into config_empresa (key, value) values ('razao_social', 'ESCRITORIO LEGADO'), ('desenhista', 'FULANO');
insert into credenciados (id, nome, prefixo_vertice) values (:c1, 'Cred A', 'AAAA');
insert into responsaveis_tecnicos (nome) values ('RT A');
insert into clientes (nome) values ('Cliente A');
insert into servicos (id, credenciado_id, rt_id, cliente_id)
  values (:s1, :c1, (select id from responsaveis_tecnicos limit 1), (select id from clientes limit 1));
insert into vertices (servico_id, ordem) values (:s1, 0), (:s1, 1);
insert into trechos_confrontantes (servico_id, vertice_inicio_ordem) values (:s1, 0);
insert into glebas (servico_id) values (:s1);
insert into documentos_gerados (servico_id, versao, tipo, titulo, path) values (:s1, 1, 'memorial_docx', 'Memorial', 'x');
insert into storage.buckets (id, name) values ('gerados', 'gerados'), ('templates', 'templates'), ('uploads-txt', 'uploads-txt')
  on conflict do nothing;
insert into storage.objects (bucket_id, name) values
  ('gerados', '51000000-0000-0000-0000-000000000001/memorial.docx'),
  ('gerados', '51000000-0000-0000-0000-000000000001/entrada/satelite.jpg'),
  ('templates', 'logo-empresa.png'),
  ('templates', 'memorial-template.docx');
\echo 'etapa antes: ok'
\quit
\endif

-- ====================================================================== DEPOIS
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FALHOU: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;
-- true quando o comando é recusado (erro de RLS, permissão ou validação)
create function pg_temp.recusa(cmd text) returns boolean language plpgsql as $$
begin
  execute cmd;
  return false;
exception when others then
  return true;
end $$;
-- linhas afetadas por um UPDATE/DELETE (RLS filtra em silêncio)
create function pg_temp.afetadas(cmd text) returns int language plpgsql as $$
declare n int;
begin
  execute cmd;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on all functions in schema pg_temp to public;

-- ---------------------------------------------------------------- backfill
select pg_temp.ok((select count(*) from escritorios) = 1, 'um escritório criado para os dados atuais');
select pg_temp.ok((select nome from escritorios) = 'ESCRITORIO LEGADO', 'nome vem da razão social');
select pg_temp.ok((select modelos_compartilhados from escritorios), 'escritório legado usa os modelos da raiz');
select pg_temp.ok((select papel from membros_escritorio where user_id = :a1) = 'dono', 'primeiro usuário vira dono');
select pg_temp.ok((select papel from membros_escritorio where user_id = :a2) = 'membro', 'segundo usuário vira membro');
select pg_temp.ok(not exists (select 1 from servicos where escritorio_id is null)
              and not exists (select 1 from clientes where escritorio_id is null)
              and not exists (select 1 from config_empresa where escritorio_id is null), 'nenhuma linha sem escritório');
select pg_temp.ok((select count(*) from vertices) = 2 and (select count(*) from documentos_gerados) = 1, 'nada apagado');

-- edge function antiga (service_role, sem escritório) com UM escritório: segue funcionando
set role service_role;
insert into servicos (nome_arquivo_txt) values ('antiga.txt');
reset role;
select pg_temp.ok((select escritorio_id from servicos where nome_arquivo_txt = 'antiga.txt') = (select id from escritorios),
                  'insert sem escritório cai no escritório único');

-- ---------------------------------------------------------------- cadastro self-service
insert into auth.users (id, email, raw_user_meta_data) values
  (:b1, 'dono@novo.test', '{"escritorio_nome": "Escritório Novo", "termos_versao": "2026-10-08"}'),
  (:b2, 'colega@novo.test', '{}');
select pg_temp.ok((select count(*) from escritorios) = 2, 'cadastro com escritório cria escritório');
select pg_temp.ok((select papel from membros_escritorio where user_id = :b1) = 'dono', 'quem se cadastrou é dono');
select pg_temp.ok(not (select modelos_compartilhados from escritorios where nome = 'Escritório Novo'), 'escritório novo não herda modelos da raiz');
select pg_temp.ok(not exists (select 1 from membros_escritorio where user_id = :b2), 'conta sem escritório não entra em escritório nenhum');
select pg_temp.ok((select versao from aceites_termos where user_id = :b1) = '2026-10-08', 'aceite dos termos registrado');

select id as esc_b from escritorios where nome = 'Escritório Novo' \gset
select id as esc_a from escritorios where nome = 'ESCRITORIO LEGADO' \gset

-- ---------------------------------------------------------------- como B1 (escritório novo)
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok((select count(*) from servicos) = 0, 'B não vê serviços de A');
select pg_temp.ok((select count(*) from clientes) = 0, 'B não vê clientes de A');
select pg_temp.ok((select count(*) from credenciados) = 0, 'B não vê credenciados de A');
select pg_temp.ok((select count(*) from responsaveis_tecnicos) = 0, 'B não vê RTs de A');
select pg_temp.ok((select count(*) from config_empresa) = 0, 'B não vê configurações de A');
select pg_temp.ok((select count(*) from vertices) = 0 and (select count(*) from trechos_confrontantes) = 0
              and (select count(*) from glebas) = 0 and (select count(*) from documentos_gerados) = 0, 'B não vê tabelas filhas de A');
select pg_temp.ok((select count(*) from storage.objects) = 0, 'B não vê arquivos de A no Storage');
select pg_temp.ok((select count(*) from escritorios) = 1, 'B vê só o próprio escritório');
select pg_temp.ok((select nome from meu_escritorio()) = 'Escritório Novo', 'meu_escritorio() de B');

insert into clientes (nome) values ('Cliente B');
insert into credenciados (id, nome, prefixo_vertice) values (:cb, 'Cred B', 'BBBB');
insert into config_empresa (key, value) values ('desenhista', 'CICLANO');
select pg_temp.ok((select escritorio_id from clientes where nome = 'Cliente B') = :'esc_b', 'insert de B ganha o escritório de B');
select pg_temp.ok(pg_temp.recusa(format('insert into servicos (credenciado_id) values (%L)', 'c1000000-0000-0000-0000-000000000001')),
                  'B não usa o credenciado (contador) de A');
insert into servicos (id, credenciado_id) values (:sb, :cb);
select pg_temp.ok(pg_temp.recusa(format('insert into clientes (nome, escritorio_id) values (%L, %L)', 'intruso', :'esc_a')),
                  'B não grava no escritório de A');
select pg_temp.ok(pg_temp.afetadas(format('update servicos set denominacao = %L where id = %L', 'x', '51000000-0000-0000-0000-000000000001')) = 0,
                  'B não altera serviço de A');
select pg_temp.ok(pg_temp.afetadas(format('delete from vertices where servico_id = %L', '51000000-0000-0000-0000-000000000001')) = 0,
                  'B não apaga vértices de A');
select pg_temp.ok(pg_temp.recusa(format('insert into vertices (servico_id, ordem) values (%L, 9)', '51000000-0000-0000-0000-000000000001')),
                  'B não insere vértice em serviço de A');
insert into vertices (servico_id, ordem) values (:sb, 0);
select pg_temp.ok(pg_temp.recusa(format('update servicos set escritorio_id = %L where id = %L', :'esc_a', '5b000000-0000-0000-0000-000000000001')),
                  'B não empurra serviço para o escritório de A');

-- Storage
select pg_temp.ok(pg_temp.recusa($$insert into storage.objects (bucket_id, name) values ('gerados', '51000000-0000-0000-0000-000000000001/entrada/x.jpg')$$),
                  'B não sobe arquivo na pasta de serviço de A');
insert into storage.objects (bucket_id, name) values ('gerados', '5b000000-0000-0000-0000-000000000001/entrada/x.jpg');
select pg_temp.ok(pg_temp.recusa($$insert into storage.objects (bucket_id, name) values ('gerados', '5b000000-0000-0000-0000-000000000001/memorial.docx')$$),
                  'cliente não escreve fora de entrada/ nem no próprio serviço');
select pg_temp.ok(pg_temp.recusa($$insert into storage.objects (bucket_id, name) values ('templates', 'logo-empresa.png')$$),
                  'B não troca a logo da raiz (de A)');
select pg_temp.ok(pg_temp.recusa(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'templates', 'escritorios/' || :'esc_a' || '/logo-empresa.png')),
                  'B não escreve na pasta de modelos de A');
select pg_temp.ok(not pg_temp.recusa(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'templates', 'escritorios/' || :'esc_b' || '/logo-empresa.png')),
                  'B sobe a própria logo');
select pg_temp.ok((select count(*) from storage.objects) = 2, 'B vê só os próprios arquivos');

-- escritório e equipe
select pg_temp.ok(pg_temp.recusa('update escritorios set modelos_compartilhados = true'), 'B não liga modelos_compartilhados');
select pg_temp.ok(pg_temp.afetadas($$update escritorios set nome = 'Escritório Novo Ltda'$$) = 1, 'dono renomeia o escritório');
select pg_temp.ok(pg_temp.recusa(format('insert into membros_escritorio values (%L, %L, %L)', :'esc_a', 'b1000000-0000-0000-0000-000000000001', 'membro')),
                  'ninguém se insere em escritório pela tabela');
select pg_temp.ok(pg_temp.recusa($$select adicionar_membro('operador@legado.test')$$), 'conta de outro escritório não é adicionada');
select pg_temp.ok(pg_temp.recusa($$select adicionar_membro('ninguem@x.test')$$), 'e-mail sem conta é recusado');
select adicionar_membro('colega@novo.test');
select pg_temp.ok((select count(*) from listar_membros()) = 2, 'equipe de B com 2 pessoas');
reset role;

-- ---------------------------------------------------------------- como B2 (membro de B)
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-000000000002', false);
set role authenticated;
select pg_temp.ok((select count(*) from clientes) = 1, 'membro de B vê os clientes de B');
select pg_temp.ok(pg_temp.recusa($$select adicionar_membro('dono@legado.test')$$), 'membro não adiciona pessoas');
select pg_temp.ok(pg_temp.recusa($$select remover_membro('b1000000-0000-0000-0000-000000000001')$$), 'membro não remove o dono');
reset role;

-- ---------------------------------------------------------------- como A2 (escritório legado)
select set_config('request.jwt.claim.sub', 'a2000000-0000-0000-0000-000000000002', false);
set role authenticated;
select pg_temp.ok((select count(*) from servicos) = 2, 'A vê os próprios serviços (inclusive o da função antiga)');
select pg_temp.ok(not exists (select 1 from servicos where id = :sb), 'A não vê o serviço de B');
select pg_temp.ok((select count(*) from vertices) = 2, 'A vê os vértices dele, não os de B');
select pg_temp.ok((select value from config_empresa where key = 'desenhista') = 'FULANO', 'config de A intacta');
-- 2 do serviço + a logo da raiz; memorial-template.docx segue só para a service_role, como hoje
select pg_temp.ok((select count(*) from storage.objects) = 3, 'A vê os arquivos do serviço e a logo da raiz');
select pg_temp.ok(not pg_temp.recusa($$insert into storage.objects (bucket_id, name) values ('templates', 'logo-empresa.jpg')$$),
                  'A continua trocando a logo da raiz');
select pg_temp.ok((select papel from meu_escritorio()) = 'membro', 'meu_escritorio() de A2');
reset role;

-- ---------------------------------------------------------------- service_role e anon
-- a service_role das edge functions não carrega usuário no JWT
select set_config('request.jwt.claim.sub', '', false);
set role service_role;
select pg_temp.ok(pg_temp.recusa($$insert into servicos (nome_arquivo_txt) values ('sem-escritorio.txt')$$),
                  'com dois escritórios, insert sem escritório é recusado');
insert into servicos (nome_arquivo_txt, escritorio_id) values ('com-escritorio.txt', :'esc_b');
reset role;

select set_config('request.jwt.claim.sub', '', false);
set role anon;
select pg_temp.ok((select count(*) from servicos) = 0, 'anônimo não vê nada');
select pg_temp.ok(pg_temp.recusa('select * from meu_escritorio()'), 'anônimo não chama as RPCs');
reset role;

\echo 'etapa depois: todos os testes passaram'
