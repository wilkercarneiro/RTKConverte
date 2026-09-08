-- Exibir ou não o NOME do confrontante (ou da estrada) na planta.
--
-- Em planta cheia — várias glebas, muitos vizinhos, estradas compridas — o
-- operador quer escolher, um a um, quais nomes saem no desenho. O traço da
-- divisa continua igual (azul, vermelha da estrada, azul do rio): o que some é
-- só o rótulo. O memorial, a planilha e as peças NÃO mudam: a confrontação
-- existe e é descrita; só a planta deixa de escrevê-la.
--
-- Vem marcado por padrão (default true): toda planta já existente sai como
-- saía, e o operador desmarca o que não quer ver.
--
-- Como a confrontação vive em dois lugares (vértice M no fluxo 'geo', tabela
-- de trechos no fluxo 'pecas'), a coluna entra nos dois — igual à `numerado`
-- (0014). Ver ARQUITETURA-TRECHOS.md.
alter table vertices
  add column if not exists exibir_planta boolean not null default true;

alter table trechos_confrontantes
  add column if not exists exibir_planta boolean not null default true;

comment on column vertices.exibir_planta is
  'O nome deste confrontante/estrada sai escrito na planta? false = só o traço da divisa, sem rótulo. Só vale em vértice M.';
comment on column trechos_confrontantes.exibir_planta is
  'O nome deste confrontante/estrada sai escrito na planta (fluxo pecas)? Ver vertices.exibir_planta.';
