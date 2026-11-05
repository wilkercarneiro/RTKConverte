-- Autenticidade das plantas (supabase/migrations/0043_autenticidade.sql):
-- a tabela de emissões é só do servidor; o público confere pela
-- verificar_documento, que devolve só os campos públicos.
\set ON_ERROR_STOP 1

create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FALHOU: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;

select id as esc_a from escritorios where modelos_compartilhados \gset
insert into servicos (escritorio_id, nome_arquivo_txt, denominacao) values (:'esc_a', 'autent.txt', 'FAZENDA SELO') returning id as sid \gset

-- o servidor (service_role) grava: reserva sem hash, depois confirma
set role service_role;
insert into documentos_autenticidade (codigo, servico_id, escritorio_id, tipo, metadados)
values ('7K3M9QXW2ZR4TNBV8C6H', :'sid', :'esc_a', 'planta_sigef',
        '{"titulo": "Planta do imóvel (SIGEF)", "denominacao": "FAZENDA SELO", "municipio": "ARACI", "uf": "BA",
          "area_ha": "84,0638", "perimetro_m": "4.077,80", "folha": "A1", "empresa": "GEO TESTE LTDA",
          "rt_nome": "TECNICO DE TESTE", "rt_registro": "CFTA 0578839458-9", "emitido_em": "05/11/2026",
          "cpf": "111.222.333-44", "proprietario": "MARIA DE TESTE"}');
reset role;

-- reserva sem hash não aparece
set role anon;
select pg_temp.ok((select count(*) = 0 from verificar_documento('7K3M9QXW2ZR4TNBV8C6H')), 'código reservado (sem hash) não aparece na verificação');
reset role;

set role service_role;
update documentos_autenticidade set hash_sha256 = repeat('ab', 32), confirmado_em = now() where codigo = '7K3M9QXW2ZR4TNBV8C6H';
reset role;

-- anon e authenticated não tocam na tabela
set role anon;
do $$
begin
  begin
    perform 1 from documentos_autenticidade;
    raise exception 'FALHOU: anon leu documentos_autenticidade';
  exception when insufficient_privilege then
    raise notice 'ok: anon não lê a tabela de emissões';
  end;
  begin
    insert into documentos_autenticidade (codigo, tipo) values ('AAAAAAAAAAAAAAAAAAAA', 'planta_sigef');
    raise exception 'FALHOU: anon gravou em documentos_autenticidade';
  exception when insufficient_privilege then
    raise notice 'ok: anon não grava emissão';
  end;
end $$;
reset role;

select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000a1', false);
set role authenticated;
do $$
begin
  begin
    perform 1 from documentos_autenticidade;
    raise exception 'FALHOU: authenticated leu documentos_autenticidade';
  exception when insufficient_privilege then
    raise notice 'ok: usuário logado também não lê a tabela direto';
  end;
end $$;
reset role;

-- a verificação pública
set role anon;
select pg_temp.ok((select count(*) = 1 from verificar_documento('7K3M9QXW2ZR4TNBV8C6H')), 'anon confere um código válido');
select pg_temp.ok((select denominacao = 'FAZENDA SELO' and municipio = 'ARACI' and uf = 'BA' and area_ha = '84,0638'
                          and perimetro_m = '4.077,80' and empresa = 'GEO TESTE LTDA' and rt_nome = 'TECNICO DE TESTE'
                          and rt_registro = 'CFTA 0578839458-9' and hash_sha256 = repeat('ab', 32) and versao_mais_nova_em is null
                     from verificar_documento('7K3M9QXW2ZR4TNBV8C6H')), 'devolve imóvel, município/UF, área, perímetro, empresa, RT e hash');
select pg_temp.ok((select position('111.222.333-44' in to_jsonb(v)::text) = 0 and position('MARIA DE TESTE' in to_jsonb(v)::text) = 0
                     from verificar_documento('7K3M9QXW2ZR4TNBV8C6H') v), 'CPF e proprietário gravados por engano em metadados não saem');
select pg_temp.ok((select count(*) = 1 from verificar_documento('7k3m-9qxw-2zr4-tnbv-8c6h')), 'aceita o código em minúsculas e com traços');
select pg_temp.ok((select count(*) = 0 from verificar_documento('7K3M9QXW2ZR4TNBV8C6J')), 'código inexistente não devolve nada');
select pg_temp.ok((select count(*) = 0 from verificar_documento('x'' or ''1''=''1')), 'entrada malformada não devolve nada');
select pg_temp.ok((select count(*) = 0 from verificar_documento(null)), 'código nulo não devolve nada');
reset role;

-- emissão mais nova do mesmo documento
set role service_role;
insert into documentos_autenticidade (codigo, servico_id, escritorio_id, tipo, hash_sha256, metadados, criado_em)
values ('8C6H7K3M9QXW2ZR4TNBV', :'sid', :'esc_a', 'planta_sigef', repeat('cd', 32), '{"denominacao": "FAZENDA SELO"}', now() + interval '1 hour'),
       ('9QXW2ZR4TNBV8C6H7K3M', :'sid', :'esc_a', 'planta_gleba', repeat('ef', 32), '{"denominacao": "FAZENDA SELO — GLEBA 1"}', now() + interval '2 hours');
reset role;
set role anon;
select pg_temp.ok((select versao_mais_nova_em is not null from verificar_documento('7K3M9QXW2ZR4TNBV8C6H')), 'a emissão antiga avisa que existe versão mais nova');
select pg_temp.ok((select versao_mais_nova_em is null from verificar_documento('8C6H7K3M9QXW2ZR4TNBV')), 'a mais nova não tem aviso (a planta da gleba é outro documento)');
reset role;

-- código fora do formato é recusado pela tabela
set role service_role;
do $$
begin
  begin
    insert into documentos_autenticidade (codigo, tipo) values ('CURTO', 'planta_sigef');
    raise exception 'FALHOU: código curto aceito';
  exception when check_violation then
    raise notice 'ok: código fora do formato (20 base32) é recusado';
  end;
end $$;
reset role;

-- limite contra varredura (consumir_limite da 0038; criada aqui se o banco de teste não tiver PostGIS)
do $$
begin
  if to_regprocedure('consumir_limite(text,integer,integer)') is null then
    create table if not exists limites_uso (chave text not null, janela timestamptz not null, n int not null default 0, primary key (chave, janela));
    create function consumir_limite(p_chave text, p_max int, p_janela_s int) returns boolean
    language plpgsql security definer set search_path = public as $f$
    declare v_n int;
    begin
      insert into limites_uso (chave, janela, n) values (p_chave, date_trunc('minute', now()), 1)
      on conflict (chave, janela) do update set n = limites_uso.n + 1 returning n into v_n;
      return v_n <= p_max;
    end $f$;
  end if;
end $$;
delete from limites_uso where chave like 'verificar:%';
select set_config('request.headers', '{"x-forwarded-for": "203.0.113.9, 10.0.0.1"}', false);
set role anon;
do $$
declare i int;
begin
  for i in 1..30 loop
    perform * from verificar_documento('7K3M9QXW2ZR4TNBV8C6J');
  end loop;
  begin
    perform * from verificar_documento('7K3M9QXW2ZR4TNBV8C6H');
    raise exception 'FALHOU: a 31ª consulta do mesmo IP no minuto passou';
  exception when raise_exception then
    if sqlerrm like 'FALHOU%' then raise; end if;
    raise notice 'ok: 30 consultas por minuto por IP; a 31ª é recusada';
  end;
end $$;
reset role;

-- o IP vem da ip_da_requisicao() (0029): o x-forwarded-for forjado a cada
-- consulta não fura o limite quando o proxy manda cf-connecting-ip
delete from limites_uso where chave like 'verificar:%';
set role anon;
do $$
declare i int;
begin
  for i in 1..30 loop
    perform set_config('request.headers', json_build_object('cf-connecting-ip', '198.51.100.7', 'x-forwarded-for', '10.9.' || i || '.1')::text, false);
    perform * from verificar_documento('7K3M9QXW2ZR4TNBV8C6J');
  end loop;
  perform set_config('request.headers', '{"cf-connecting-ip": "198.51.100.7", "x-forwarded-for": "10.9.99.1"}', false);
  begin
    perform * from verificar_documento('7K3M9QXW2ZR4TNBV8C6H');
    raise exception 'FALHOU: trocar o x-forwarded-for furou o limite por IP';
  exception when raise_exception then
    if sqlerrm like 'FALHOU%' then raise; end if;
    raise notice 'ok: o limite usa o cf-connecting-ip (x-forwarded-for forjado não fura)';
  end;
end $$;
reset role;
select pg_temp.ok((select count(*) = 1 from limites_uso where chave = 'verificar:198.51.100.7'), 'a chave do limite é o IP da ip_da_requisicao()');
select set_config('request.headers', '', false);

-- coluna da assinatura do RT
select pg_temp.ok((select column_default = 'true' and is_nullable = 'NO' from information_schema.columns
                    where table_name = 'responsaveis_tecnicos' and column_name = 'assinar_com_imagem'),
                  'responsaveis_tecnicos.assinar_com_imagem existe, ligada por padrão');

select set_config('request.jwt.claim.sub', '', false);
delete from documentos_autenticidade;
delete from servicos where id = :'sid';
