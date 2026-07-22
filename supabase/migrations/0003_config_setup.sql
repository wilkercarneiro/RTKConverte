-- Tabela de configuração de setup: RLS habilitado SEM políticas →
-- acessível apenas via service role (Edge Functions). Guarda o segredo usado
-- pela função admin-setup para o upload dos templates oficiais.
create table config_setup (
  key text primary key,
  value text not null
);
alter table config_setup enable row level security;
