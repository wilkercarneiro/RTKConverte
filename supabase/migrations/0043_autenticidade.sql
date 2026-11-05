-- 0043 — Autenticidade das plantas (QR) e imagem da assinatura do RT.
--
-- 1. documentos_autenticidade: um registro por EMISSÃO de planta. O código
--    (20 caracteres base32 de Crockford, 100 bits aleatórios) vai impresso na
--    folha como QR e texto; o SHA-256 é o do PDF final. Quem grava são as
--    edge functions (service_role), no momento da geração: reservam o código
--    (sem hash), geram o PDF com o QR e confirmam com o hash.
--    RLS ligada e NENHUM acesso direto de anon/authenticated: a única leitura
--    pública é verificar_documento(), que devolve só os campos públicos — o
--    CPF/RG de ninguém está na tabela, e mesmo que entrasse em `metadados`
--    não sairia (a função escolhe as chaves).
-- 2. verificar_documento(p_codigo): SECURITY DEFINER, executável por anon.
--    Código inexistente, ainda sem hash ou malformado → nenhuma linha. Diz se
--    há emissão mais nova do mesmo documento (mesmo serviço, tipo e unidade).
--    Contra varredura: o código é inadivinhável e, havendo a consumir_limite
--    da 0038, cada IP tem 30 consultas por minuto.
-- 3. responsaveis_tecnicos.assinar_com_imagem: o RT escolhe se a imagem da
--    assinatura (Storage: templates/escritorios/{id}/assinaturas/rt-{rt}.png)
--    entra nos documentos. Padrão: ligado (só vale se houver imagem).
--
-- Idempotente: pode ser reaplicada.

-- ------------------------------------------------------------ 1. registros
create table if not exists documentos_autenticidade (
  codigo text primary key check (codigo ~ '^[0-9A-HJKMNP-TV-Z]{20}$'),
  servico_id uuid references servicos(id) on delete set null,
  escritorio_id uuid references escritorios(id) on delete set null,
  tipo text not null check (tipo in ('planta_sigef', 'planta_sistema', 'planta_previa', 'planta_gleba')),
  -- nome da gleba/parte (planta A3 de cada unidade); null = o imóvel
  unidade text,
  hash_sha256 text check (hash_sha256 is null or hash_sha256 ~ '^[0-9a-f]{64}$'),
  metadados jsonb not null default '{}'::jsonb check (jsonb_typeof(metadados) = 'object'),
  criado_em timestamptz not null default now(),
  confirmado_em timestamptz
);
create index if not exists documentos_autenticidade_versoes
  on documentos_autenticidade (servico_id, tipo, (coalesce(unidade, '')), criado_em);

alter table documentos_autenticidade enable row level security;
revoke all on documentos_autenticidade from public, anon, authenticated;
grant all on documentos_autenticidade to service_role;

-- ------------------------------------------------------------ 2. verificação pública
drop function if exists verificar_documento(text);
create or replace function verificar_documento(p_codigo text)
returns table (
  codigo text,
  tipo text,
  titulo text,
  denominacao text,
  municipio text,
  uf text,
  area_ha text,
  perimetro_m text,
  folha text,
  empresa text,
  rt_nome text,
  rt_registro text,
  emitido_em timestamptz,
  hash_sha256 text,
  versao_mais_nova_em timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_codigo text := translate(upper(regexp_replace(coalesce(p_codigo, ''), '[\s.-]', '', 'g')), 'OIL', '011');
  v_ip text;
begin
  if v_codigo !~ '^[0-9A-HJKMNP-TV-Z]{20}$' then
    return;
  end if;
  -- limite por IP (a 0038 traz a consumir_limite; sem ela, só o código protege)
  if to_regprocedure('consumir_limite(text,integer,integer)') is not null then
    -- o IP pela ip_da_requisicao() da 0029 (prefere cf-connecting-ip/x-real-ip):
    -- o 1º x-forwarded-for vem de quem chama e troca a cada consulta, o que
    -- furava o limite
    begin
      if to_regprocedure('ip_da_requisicao()') is not null then
        execute 'select ip_da_requisicao()' into v_ip;
      else
        v_ip := split_part(coalesce(current_setting('request.headers', true)::json ->> 'cf-connecting-ip',
                                    current_setting('request.headers', true)::json ->> 'x-real-ip',
                                    current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1);
      end if;
    exception when others then
      v_ip := '';
    end;
    if not consumir_limite('verificar:' || coalesce(nullif(trim(v_ip), ''), 'sem-ip'), 30, 60) then
      raise exception 'Muitas consultas seguidas. Aguarde um minuto e tente de novo.' using errcode = 'P0001';
    end if;
  end if;
  return query
    select d.codigo, d.tipo,
           d.metadados ->> 'titulo', d.metadados ->> 'denominacao', d.metadados ->> 'municipio', d.metadados ->> 'uf',
           d.metadados ->> 'area_ha', d.metadados ->> 'perimetro_m', d.metadados ->> 'folha',
           d.metadados ->> 'empresa', d.metadados ->> 'rt_nome', d.metadados ->> 'rt_registro',
           d.criado_em, d.hash_sha256,
           (select min(o.criado_em) from documentos_autenticidade o
             where d.servico_id is not null and o.servico_id = d.servico_id and o.tipo = d.tipo
               and coalesce(o.unidade, '') = coalesce(d.unidade, '')
               and o.criado_em > d.criado_em and o.hash_sha256 is not null)
      from documentos_autenticidade d
     where d.codigo = v_codigo and d.hash_sha256 is not null;
end $$;
revoke execute on function verificar_documento(text) from public;
grant execute on function verificar_documento(text) to anon, authenticated, service_role;

-- ------------------------------------------------------------ 3. assinatura do RT
alter table responsaveis_tecnicos add column if not exists assinar_com_imagem boolean not null default true;
