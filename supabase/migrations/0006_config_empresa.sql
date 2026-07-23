-- Configurações da empresa (logo, desenhista etc.) — editáveis pelo operador
create table if not exists config_empresa (
  key text primary key,
  value text not null default ''
);
alter table config_empresa enable row level security;
create policy autenticado_config_empresa on config_empresa for all to authenticated using (true) with check (true);

-- Logo da empresa: o frontend grava direto no bucket privado `templates`,
-- mas SOMENTE no objeto fixo logo-empresa.*
create policy logo_select on storage.objects for select to authenticated
  using (bucket_id = 'templates' and name like 'logo-empresa.%');
create policy logo_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'templates' and name like 'logo-empresa.%');
create policy logo_update on storage.objects for update to authenticated
  using (bucket_id = 'templates' and name like 'logo-empresa.%')
  with check (bucket_id = 'templates' and name like 'logo-empresa.%');
create policy logo_delete on storage.objects for delete to authenticated
  using (bucket_id = 'templates' and name like 'logo-empresa.%');
