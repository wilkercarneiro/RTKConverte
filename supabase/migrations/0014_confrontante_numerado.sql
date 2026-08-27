-- Confrontante NUMERADO na planta.
--
-- Em divisa curta o bloco de texto do vizinho fica maior que o vão dele: a
-- largura do rótulo é proporcional ao comprimento da confrontação
-- (max 0,8 × comprimento), então uma divisa de 90pt recebe um bloco alto e
-- estreito. Dois vizinhos assim, lado a lado, empilham um sobre o outro — o
-- motor de posicionamento esgota os 770 candidatos e cai em `menosPior`, que
-- desenha por cima mesmo assim.
--
-- A saída é o operador marcar o confrontante para sair NUMERADO: no desenho
-- fica só o número, dentro de um disco branco, e o texto completo vai para o
-- quadro CONFRONTANTES no rodapé da área de desenho.
--
-- O banco guarda SÓ o booleano. O número em si é calculado no desenho
-- (`numerarConfrontantes` em planta.ts), para que mover ou remover uma
-- confrontação renumere sozinha e para que os dois fluxos — cálculo do sistema
-- e PDF do SIGEF — produzam exatamente a mesma sequência.
--
-- Como a confrontação vive em dois lugares (vértice M no fluxo 'geo', tabela
-- de trechos no fluxo 'pecas'), a coluna entra nos dois. Ver ARQUITETURA-TRECHOS.md.
--
-- Default false = toda planta já existente sai exatamente como saía.
alter table vertices
  add column if not exists numerado boolean not null default false;

alter table trechos_confrontantes
  add column if not exists numerado boolean not null default false;

comment on column vertices.numerado is
  'Confrontação sai NUMERADA na planta: no desenho fica só o número e o texto vai ao quadro CONFRONTANTES do rodapé. Só vale em vértice M.';
comment on column trechos_confrontantes.numerado is
  'Confrontação sai NUMERADA na planta (fluxo pecas). Ver vertices.numerado.';
