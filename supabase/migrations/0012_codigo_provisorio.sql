-- Marca de código de prévia no próprio vértice.
--
-- A conferência de área passou a numerar com o prefixo do credenciado (o cliente
-- lê o código real na peça) sem consumir os contadores do Anexo A. Como o código
-- deixou de ser reconhecível pelo prefixo "PROV-", quem diz "isto não vale para
-- protocolar" é esta coluna — e é ela que manda os códigos serem realocados
-- quando a conferência vira serviço completo.
alter table vertices
  add column if not exists codigo_provisorio boolean not null default false;

comment on column vertices.codigo_provisorio is
  'true = código exibido na prévia da conferência: tem o prefixo do credenciado mas NÃO foi alocado nos contadores. É refeito ao promover o serviço a completo.';

-- Serviços de conferência já gerados carregam o prefixo legado: marca-os para
-- que a promoção a serviço completo continue realocando os códigos deles.
update vertices set codigo_provisorio = true where codigo like 'PROV-%';
