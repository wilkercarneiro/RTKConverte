-- Leitura universal (supabase/migrations/0035_leitura_universal.sql), numa
-- transação desfeita: perfis aprendidos isolados por empresa (o global é de
-- todos), receita só gravada pelo servidor (a tela só renomeia), leituras e
-- recusados só da própria empresa, chamadas de IA e RPCs só do superadmin.
\set ON_ERROR_STOP 1
begin;

create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FALHOU: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;
grant execute on function pg_temp.ok(boolean, text) to authenticated;

-- cenário: duas empresas com alguém na equipe e um superadmin (dos testes anteriores)
create temp table cena as
select
  (select m.escritorio_id from membros_escritorio m join escritorios e on e.id = m.escritorio_id where e.status = 'ativo' order by m.escritorio_id limit 1) as esc_a,
  (select m.escritorio_id from membros_escritorio m join escritorios e on e.id = m.escritorio_id where e.status = 'ativo' order by m.escritorio_id desc limit 1) as esc_b,
  (select user_id from super_admins limit 1) as sa,
  gen_random_uuid() as perfil_a, gen_random_uuid() as perfil_b, gen_random_uuid() as perfil_global;
alter table cena add column user_a uuid, add column user_b uuid;
update cena set
  user_a = (select m.user_id from membros_escritorio m where m.escritorio_id = cena.esc_a and m.user_id not in (select user_id from super_admins) order by m.user_id limit 1),
  user_b = (select m.user_id from membros_escritorio m where m.escritorio_id = cena.esc_b and m.user_id not in (select user_id from super_admins) order by m.user_id limit 1);
grant select on cena to authenticated;

do $$
declare c cena;
begin
  select * into c from cena;
  perform pg_temp.ok(c.esc_a is not null and c.esc_b is not null and c.esc_a <> c.esc_b and c.user_a is not null and c.user_b is not null and c.sa is not null, 'cenário: duas empresas, um membro em cada, um superadmin');
  insert into perfis_leitura (id, escritorio_id, assinatura, receita, nome, origem) values
    (c.perfil_a, c.esc_a, 'assin-a', '{"origem":"regras"}', 'formato A', 'regras'),
    (c.perfil_b, c.esc_b, 'assin-b', '{"origem":"ia"}', 'formato B', 'ia'),
    (c.perfil_global, null, 'assin-g', '{"origem":"regras"}', 'formato global', 'regras');
  insert into leituras_arquivo (escritorio_id, nome_arquivo, receita, origem) values
    (c.esc_a, 'a.txt', '{}', 'regras'), (c.esc_b, 'b.txt', '{}', 'ia:gpt-6-luna');
  insert into arquivos_recusados (escritorio_id, nome_arquivo, motivo) values (c.esc_a, 'a.dbx', 'binário'), (c.esc_b, 'b.dbx', 'binário');
  insert into chamadas_ia (escritorio_id, modelo, tentativa, aprovada, custo_usd) values (c.esc_a, 'gpt-6-luna', 1, true, 0.0007);
  perform pg_temp.ok((select count(*) from perfis_leitura where assinatura = 'assin-a') = 1, 'o servidor (postgres) grava perfis');
  begin
    insert into perfis_leitura (escritorio_id, assinatura, receita) values (c.esc_a, 'assin-a', '{}');
    perform pg_temp.ok(false, 'assinatura repetida na mesma empresa é recusada');
  exception when unique_violation then perform pg_temp.ok(true, 'assinatura repetida na mesma empresa é recusada');
  end;
end $$;

-- ---------------------------------------------------------------- membro da empresa A
select set_config('request.jwt.claim.sub', (select user_a::text from cena), false);
set role authenticated;
do $$
declare c cena; n int;
begin
  select * into c from cena;
  perform pg_temp.ok((select count(*) from perfis_leitura where id in (c.perfil_a, c.perfil_global)) = 2, 'A vê o próprio perfil e o global');
  perform pg_temp.ok((select count(*) from perfis_leitura where id = c.perfil_b) = 0, 'A não vê o perfil da empresa B');
  perform pg_temp.ok((select count(*) from leituras_arquivo) = 1 and (select nome_arquivo from leituras_arquivo) = 'a.txt', 'A vê só as próprias leituras');
  perform pg_temp.ok((select count(*) from arquivos_recusados) = 1, 'A vê só os próprios arquivos recusados');
  perform pg_temp.ok((select count(*) from chamadas_ia) = 0, 'chamadas de IA: só o superadmin vê');
  update perfis_leitura set nome = 'meu formato' where id = c.perfil_a;
  perform pg_temp.ok((select nome from perfis_leitura where id = c.perfil_a) = 'meu formato', 'A renomeia o próprio perfil');
  update perfis_leitura set nome = 'invasão' where id = c.perfil_b;
  get diagnostics n = row_count;
  perform pg_temp.ok(n = 0, 'A não renomeia o perfil de B');
  begin
    update perfis_leitura set receita = '{"origem":"operador"}' where id = c.perfil_a;
    perform pg_temp.ok(false, 'a receita não muda pela tela');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'a receita não muda pela tela (só o nome)');
  end;
  begin
    insert into perfis_leitura (escritorio_id, assinatura, receita) values (c.esc_a, 'x', '{}');
    perform pg_temp.ok(false, 'a tela não cria perfil');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'a tela não cria perfil (quem grava é o parse-txt)');
  end;
  begin
    insert into chamadas_ia (escritorio_id, modelo, tentativa) values (c.esc_a, 'x', 1);
    perform pg_temp.ok(false, 'a tela não forja chamada de IA');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'a tela não forja chamada de IA');
  end;
  begin
    perform sa_promover_perfil(c.perfil_a);
    perform pg_temp.ok(false, 'membro não promove perfil');
  exception when others then perform pg_temp.ok(sqlerrm = 'apenas superadmin', 'membro não promove perfil a global');
  end;
  begin
    perform sa_formatos_vistos(30);
    perform pg_temp.ok(false, 'membro não abre o painel');
  exception when others then perform pg_temp.ok(sqlerrm = 'apenas superadmin', 'membro não abre o painel de formatos');
  end;
end $$;
reset role;

-- ---------------------------------------------------------------- superadmin
select set_config('request.jwt.claim.sub', (select sa::text from cena), false);
set role authenticated;
do $$
declare c cena; r jsonb;
begin
  select * into c from cena;
  r := sa_formatos_vistos(30);
  perform pg_temp.ok(jsonb_array_length(r->'perfis') >= 3, 'superadmin vê os perfis de todas as empresas');
  perform pg_temp.ok((r->'ia'->>'chamadas')::int >= 1 and (r->'ia'->>'custo_usd')::numeric > 0, 'painel soma as chamadas e o custo da IA');
  perform pg_temp.ok(jsonb_array_length(r->'recusados') >= 2, 'painel lista os recusados');
  perform pg_temp.ok((select count(*) from chamadas_ia) >= 1, 'superadmin lê as chamadas de IA');
  perform sa_promover_perfil(c.perfil_b);
  perform pg_temp.ok((select escritorio_id from perfis_leitura where id = c.perfil_b) is null, 'superadmin torna o perfil de B global');
  begin
    update perfis_leitura set assinatura = 'assin-g' where id = c.perfil_a;  -- sem privilégio de coluna, nem para o superadmin pela tela
    perform pg_temp.ok(false, 'assinatura não muda pela tela');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'assinatura não muda pela tela');
  end;
  perform sa_resolver_recusado((select id from arquivos_recusados where nome_arquivo = 'b.dbx'), true);
  perform pg_temp.ok((select resolvido from arquivos_recusados where nome_arquivo = 'b.dbx'), 'superadmin marca recusado como resolvido');
  perform sa_excluir_perfil(c.perfil_a);
  perform pg_temp.ok((select count(*) from perfis_leitura where id = c.perfil_a) = 0, 'superadmin exclui perfil');
end $$;
reset role;

-- o perfil de B, agora global, aparece para a empresa A
select set_config('request.jwt.claim.sub', (select user_a::text from cena), false);
set role authenticated;
do $$
begin
  perform pg_temp.ok((select count(*) from perfis_leitura where id = (select perfil_b from cena)) = 1, 'perfil promovido a global aparece para as outras empresas');
end $$;
reset role;

rollback;
