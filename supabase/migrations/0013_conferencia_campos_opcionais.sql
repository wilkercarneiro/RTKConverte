-- Campos que a planta da conferência de área pode omitir.
--
-- A conferência acontece ANTES de o imóvel ter documento: acontece de não haver
-- matrícula nem posse declarada, de a fazenda ainda não ter nome e de o TRT não
-- ter sido emitido. Imprimir "Matrícula do Imóvel:" em branco é pior do que não
-- imprimir — parece dado perdido. Quem decide é o operador, campo a campo.
--
-- Só valem na conferência: num serviço que vai ao SIGEF os três são obrigatórios
-- (ver `exibir` em gerar-documentos). Default true = a planta sai como sempre.
alter table servicos
  add column if not exists conf_exibir_matricula boolean not null default true,
  add column if not exists conf_exibir_denominacao boolean not null default true,
  add column if not exists conf_exibir_trt boolean not null default true;

comment on column servicos.conf_exibir_matricula is
  'Conferência: imprime "(MATR./CNS.)" ou "(POSSE)" na planta. false = o imóvel ainda não tem nenhum dos dois.';
comment on column servicos.conf_exibir_denominacao is
  'Conferência: imprime o nome da fazenda na planta. false = a área ainda não tem denominação.';
comment on column servicos.conf_exibir_trt is
  'Conferência: imprime o TRT na planta. false = o termo ainda não foi emitido.';
