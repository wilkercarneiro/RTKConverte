-- 0035: leitura universal do arquivo de pontos.
--
-- O arquivo do aparelho deixa de ter um formato só. Cada leitura é descrita por
-- uma RECEITA (JSON) — escrita pelo detector, pela IA ou pelo operador — que o
-- código executa e confere. Aqui ficam:
--
--   vertices.nome_txt / linha_txt — o nome original do ponto ("postp_1", "M-01")
--                          e a linha do arquivo de onde ele saiu (procedência)
--   perfis_leitura       — formato aprendido: impressão digital da estrutura do
--                          arquivo → receita. Do escritório, ou global (null),
--                          promovido pelo superadmin. O próximo arquivo igual
--                          entra sozinho, sem IA.
--   leituras_arquivo     — como cada serviço foi lido (receita, avisos,
--                          confirmações, linhas ignoradas): auditoria/laudo
--   chamadas_ia          — cada chamada à IA (modelo, tokens, custo, aprovada)
--   arquivos_recusados   — o que não foi lido, com o arquivo guardado no bucket
--                          uploads-recusados/<escritório>/…: vira caso de teste
--   escritorios.leitura_ia — a empresa pode desligar a IA
--
-- Depende da 0024 (escritorios, sou_superadmin, escritorio_atual).

alter table vertices add column if not exists nome_txt text;
alter table vertices add column if not exists linha_txt int;
comment on column vertices.nome_txt is 'Nome do ponto como veio no arquivo (o num_txt pode ser sequência quando o nome não é número)';
comment on column vertices.linha_txt is 'Linha do arquivo de onde o ponto foi lido (procedência)';

alter table escritorios add column if not exists leitura_ia boolean not null default true;

-- ------------------------------------------------------------------ perfis
create table if not exists perfis_leitura (
  id uuid primary key default gen_random_uuid(),
  escritorio_id uuid references escritorios(id) on delete cascade,
  assinatura text not null,
  receita jsonb not null,
  nome text,
  origem text not null default 'regras' check (origem in ('regras', 'ia', 'operador')),
  usos int not null default 0,
  confirmacoes_sem_edicao int not null default 0,
  ultimo_uso timestamptz,
  criado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists perfis_leitura_unico
  on perfis_leitura (coalesce(escritorio_id, '00000000-0000-0000-0000-000000000000'::uuid), assinatura);
alter table perfis_leitura enable row level security;
drop policy if exists perfis_leitura_ler on perfis_leitura;
create policy perfis_leitura_ler on perfis_leitura for select to authenticated
  using (sou_superadmin() or escritorio_id is null or escritorio_id = escritorio_atual());
-- a receita é gravada pela função (service role); pela tela, só o nome muda
drop policy if exists perfis_leitura_renomear on perfis_leitura;
create policy perfis_leitura_renomear on perfis_leitura for update to authenticated
  using (sou_superadmin() or escritorio_id = escritorio_atual())
  with check (sou_superadmin() or escritorio_id = escritorio_atual());
revoke insert, update, delete on perfis_leitura from authenticated, anon;
grant select on perfis_leitura to authenticated;
grant update (nome) on perfis_leitura to authenticated;

-- superadmin: promover a global (todas as empresas passam a ler o formato) e excluir
create or replace function sa_promover_perfil(p_perfil uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare a text;
begin
  if not sou_superadmin() then raise exception 'apenas superadmin'; end if;
  select assinatura into a from perfis_leitura where id = p_perfil;
  if a is null then raise exception 'perfil não encontrado'; end if;
  if exists (select 1 from perfis_leitura where escritorio_id is null and assinatura = a and id <> p_perfil) then
    raise exception 'já existe um perfil global para este formato';
  end if;
  update perfis_leitura set escritorio_id = null, updated_at = now() where id = p_perfil;
end $$;
create or replace function sa_excluir_perfil(p_perfil uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not sou_superadmin() then raise exception 'apenas superadmin'; end if;
  delete from perfis_leitura where id = p_perfil;
end $$;
create or replace function sa_resolver_recusado(p_id uuid, p_resolvido boolean)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not sou_superadmin() then raise exception 'apenas superadmin'; end if;
  update arquivos_recusados set resolvido = p_resolvido where id = p_id;
end $$;
revoke all on function sa_promover_perfil(uuid), sa_excluir_perfil(uuid), sa_resolver_recusado(uuid, boolean) from public, anon;
grant execute on function sa_promover_perfil(uuid), sa_excluir_perfil(uuid), sa_resolver_recusado(uuid, boolean) to authenticated;

-- ------------------------------------------------------------------ leituras
create table if not exists leituras_arquivo (
  id uuid primary key default gen_random_uuid(),
  servico_id uuid references servicos(id) on delete cascade,
  escritorio_id uuid references escritorios(id) on delete set null,
  nome_arquivo text,
  formato text,
  codificacao text,
  assinatura text,
  perfil_id uuid references perfis_leitura(id) on delete set null,
  origem text,
  receita jsonb not null,
  criterio_ordem text,
  avisos jsonb not null default '[]',
  ignoradas jsonb not null default '[]',
  confirmados text[] not null default '{}',
  excluidas int[] not null default '{}',
  criado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists leituras_arquivo_servico on leituras_arquivo (servico_id);
create index if not exists leituras_arquivo_perfil on leituras_arquivo (perfil_id);
alter table leituras_arquivo enable row level security;
drop policy if exists leituras_arquivo_ler on leituras_arquivo;
create policy leituras_arquivo_ler on leituras_arquivo for select to authenticated
  using (sou_superadmin() or escritorio_id = escritorio_atual());

-- ------------------------------------------------------------------ IA
create table if not exists chamadas_ia (
  id uuid primary key default gen_random_uuid(),
  escritorio_id uuid references escritorios(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  nome_arquivo text,
  assinatura text,
  modelo text not null,
  tentativa int not null,
  tokens_entrada int not null default 0,
  tokens_saida int not null default 0,
  custo_usd numeric(12, 6),
  aprovada boolean not null default false,
  motivo text,
  ms int,
  created_at timestamptz not null default now()
);
create index if not exists chamadas_ia_escritorio_dia on chamadas_ia (escritorio_id, created_at);
alter table chamadas_ia enable row level security;
drop policy if exists chamadas_ia_superadmin on chamadas_ia;
create policy chamadas_ia_superadmin on chamadas_ia for select to authenticated using (sou_superadmin());

-- ------------------------------------------------------------------ recusados
create table if not exists arquivos_recusados (
  id uuid primary key default gen_random_uuid(),
  escritorio_id uuid references escritorios(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  nome_arquivo text,
  caminho text,
  tamanho int,
  formato text,
  assinatura text,
  motivo text,
  resolvido boolean not null default false,
  perfil_id uuid references perfis_leitura(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table arquivos_recusados enable row level security;
drop policy if exists arquivos_recusados_ler on arquivos_recusados;
create policy arquivos_recusados_ler on arquivos_recusados for select to authenticated
  using (sou_superadmin() or escritorio_id = escritorio_atual());
revoke insert, update, delete on arquivos_recusados, leituras_arquivo, chamadas_ia from authenticated, anon;
grant select on arquivos_recusados, leituras_arquivo, chamadas_ia to authenticated;

insert into storage.buckets (id, name, public) values ('uploads-recusados', 'uploads-recusados', false) on conflict (id) do nothing;
drop policy if exists recusados_ler on storage.objects;
create policy recusados_ler on storage.objects for select to authenticated
  using (bucket_id = 'uploads-recusados' and (sou_superadmin() or (storage.foldername(name))[1] = escritorio_atual()::text));

-- ------------------------------------------------------------------ painel
-- Formatos vistos (superadmin): perfis com uso, recusas e o custo da IA.
create or replace function sa_formatos_vistos(p_dias int default 30)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare r jsonb;
begin
  if not sou_superadmin() then raise exception 'apenas superadmin'; end if;
  select jsonb_build_object(
    'perfis', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'nome', p.nome, 'origem', p.origem, 'global', p.escritorio_id is null,
        'escritorio', e.nome, 'usos', p.usos, 'sem_edicao', p.confirmacoes_sem_edicao,
        'ultimo_uso', p.ultimo_uso, 'explicacao', p.receita->>'explicacao', 'assinatura', p.assinatura,
        'created_at', p.created_at) order by p.usos desc, p.created_at desc)
      from perfis_leitura p left join escritorios e on e.id = p.escritorio_id), '[]'),
    'recusados', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'escritorio', e.nome, 'nome_arquivo', a.nome_arquivo, 'caminho', a.caminho,
        'formato', a.formato, 'motivo', a.motivo, 'resolvido', a.resolvido, 'created_at', a.created_at) order by a.created_at desc)
      from arquivos_recusados a left join escritorios e on e.id = a.escritorio_id
      where a.created_at > now() - make_interval(days => p_dias)), '[]'),
    'ia', (select jsonb_build_object(
        'chamadas', count(*), 'aprovadas', count(*) filter (where aprovada),
        'custo_usd', coalesce(sum(custo_usd), 0),
        'por_modelo', coalesce((select jsonb_object_agg(modelo, n) from (select modelo, count(*) n from chamadas_ia where created_at > now() - make_interval(days => p_dias) group by modelo) m), '{}'))
      from chamadas_ia where created_at > now() - make_interval(days => p_dias)),
    'leituras', (select jsonb_object_agg(coalesce(origem, '?'), n) from (
        select split_part(origem, ':', 1) origem, count(*) n from leituras_arquivo
         where created_at > now() - make_interval(days => p_dias) group by 1) x)
  ) into r;
  return r;
end $$;
revoke all on function sa_formatos_vistos(int) from public, anon;
grant execute on function sa_formatos_vistos(int) to authenticated;
