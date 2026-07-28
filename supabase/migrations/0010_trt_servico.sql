-- TRT (Termo de Responsabilidade Técnica) por serviço: cada trabalho tem o seu
-- número (ex.: BR20250804764), digitado antes da geração. Tem prioridade sobre
-- o TRT lido do cabeçalho do PDF do SIGEF e sobre o TRT do cadastro do RT.
alter table servicos
  add column if not exists trt text;
