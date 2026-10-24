# Serviço de loteamento

Divide a gleba levantada em quadras, lotes, ruas e áreas públicas. Gera a planta do loteamento para o cliente e o arquivo de locação para a coletora do técnico de campo.

## Como o operador usa

1. **Início → Loteamento → Enviar TXT.** O TXT é o mesmo do levantamento do perímetro. O `parse-txt` cria o serviço com fuso, UF e vértices, e a confrontação de cada lado vem dos vértices M.
2. **Perguntas.** Cada resposta vira parâmetro do projeto e pode ser mudada depois.
   - **Lados do terreno.** Para cada lado, diga se é divisa, estrada existente, rio (com faixa de APP) ou rodovia/ferrovia (com faixa non aedificandi). Trechos marcados como estrada no levantamento já chegam marcados.
   - **Lotes.** Escolha um perfil (Lei 6.766, popular, padrão, médio, chácaras) e ajuste as medidas em três colunas — **mínima, padrão e máxima** — para frente, profundidade e área. As faixas que o operador não digitou acompanham o padrão (frente até 2×, fundo de 60% a 160%, área até 2× o lote padrão). Diga também para onde vai a sobra da fileira e como ficam os lotes da divisa (padronizados ou em áreas iguais).
   - **Ruas.** Informe a largura e a pista, as esquinas (raio ou chanfro) e o comprimento máximo da quadra. Escolha quem traça: o sistema, ruas paralelas a um lado escolhido, ou desenho à mão.
   - **Áreas públicas.** Metas de % verde, institucional e total.
   - **Numeração e medidas.** Quadras por letra ou número, sentido dos lotes e "medidas de terreno".
3. **Gerar o loteamento.** O sistema testa as direções do terreno e as defasagens da malha, reserva área verde e institucional onde custa menos lote e mostra as 3 propostas com mais lotes. Escolha uma.
4. **Projeto (prancheta).** Um clique seleciona o lote, duplo clique seleciona a quadra e Shift+clique soma lotes.
   - **Arrastar a bolinha verde** entre dois lotes muda a frente; os lotes seguintes se ajustam.
   - **Arrastar o losango** move a linha de fundo da quadra.
   - **Ferramentas:** R desenha rua (Shift trava o ângulo; os pontos grudam em vértices e eixos), A desenha área pública e M mede.
   - **Linha de comando.** Exemplos: `frente 12`, `area 300`, `unir`, `dividir 2`, `verde`, `institucional`, `qtd 8`, `iguais`, `sobra esquinas`, `fileiras 1`, `fundo 25`, `largura 14`, `balao 10`, `nome Rua das Flores`, `esquina raio 6`, `ir A-12`, `preco 180`, `desfazer`. Para ver tudo, digite `ajuda` ou clique em "?".
   - **Painel à direita.** Mostra o item selecionado com campos editáveis, o quadro de áreas ao vivo (e o VGV, se houver preço por m²) e as pendências, que são clicáveis.
5. **Entregas.**
   - **Para o cliente e a prefeitura:**
     - Planta do loteamento em PDF (A0/A1/A2/A3), com escala normalizada automática e o quadro de lotes nas folhas seguintes.
     - Memorial descritivo do loteamento (DOCX).
     - Memoriais de todos os lotes (DOCX, um por página).
     - Quadro de lotes em CSV, que abre no Excel.
     - KML para o Google Earth.
     - DXF em camadas.
   - **Para o técnico de campo:** arquivo de locação no formato da coletora.
     - CSV universal `Name,Easting,Northing,Elevation,Code`.
     - Variante com o Norte antes do Este.
     - Formato `Name,Code,N,E,Z` (aparelhos chineses).
     - PENZD/PNEZD sem cabeçalho.
     - DXF de linhas.
   - **O que entra na locação:** cantos de lote e de quadra, PC/meio/PT das curvas de esquina, estacas do eixo das ruas (a cada 20 m, configurável) e, se pedido, os marcos do perímetro.
   - **Nome dos pontos:** curto, sem acento e o mesmo da planta e dos memoriais (A-07 = ponto 7 da quadra A). O código do ponto traz os lotes que ele divide (`QA L03/04`).

## Regras de projeto que o gerador segue

- **Acesso.**
  - Rua só encosta no perímetro onde há estrada existente (lado marcado como "rua/estrada existente").
  - Na divisa com vizinho, rio ou rodovia, a rua termina num cruzamento ou num balão de retorno.
  - O gerador testa duas soluções: a malha simples aparada nos cruzamentos e a malha com **rua de contorno**, a uma profundidade de lote da divisa (e a duas da estrada). Fica com a que rende mais lote bom.
  - Rua desenhada à mão contra a divisa vira pendência, e só sobra a malha ligada a algum acesso.
- **Fundo com fundo.**
  - Na quadra de duas fileiras, a fileira de frente mais longa manda e a outra segue os mesmos cortes, de modo que as divisas laterais se encontram na linha de fundo.
  - As pontas são a exceção, quando o ângulo exige redistribuir.
- **Ângulo e divisa torta.**
  - Numa fileira em que a profundidade varia, o lote raso fica mais largo até atingir a área de referência.
  - As pontas desproporcionais (menos de 80% ou mais de 145% do padrão, ou frente curta) são refeitas em áreas iguais, com até 3 lotes vizinhos dividindo a diferença.
  - Retalho com frente e área de lote vira lote; retalho grande é dividido.
- **Faixa da beirada.** A faixa entre o contorno e a divisa é partida nos cantos, pela bissetriz, e cada trecho reto é loteado na direção da sua rua.
- **Área verde.**
  - Vai para a terra menos valorizada.
  - O relevo vem do modelo digital de elevação (tiles terrarium da AWS), calibrado pelas cotas do TXT e guardado no projeto. Contam cota baixa, declividade, depressão (buraco) e distância do acesso.
  - Lote de frente para a estrada **nunca** vira área pública. Retalho nessa posição é somado ao lote vizinho ou vira passeio.
  - A escolha é sempre um trecho contínuo de lotes em volta da quadra.
- **Institucional.** Fica na quadra mais central e, se ela não bastar, continua na vizinha.
- **Medidas do lote (harmonia).** Nenhum lote sai fora das faixas mínima–máxima:
  - lote fundo demais (ponta aguda da gleba, quadra triangular) é aparado na profundidade máxima, medida como a maior distância até a frente — o fundo cortado vira retalho;
  - lote acima da área ou da frente máxima é dividido em partes iguais, perpendiculares à frente, cada uma com as mínimas;
  - quadra entre ruas que se abrem em ângulo tem o fundo na bissetriz, e as duas fileiras ficam com a mesma profundidade;
  - na ponta da fileira, cunha (menos de 30°), lote raso ou triângulo largo junta-se ao vizinho se couber nas máximas; se não couber, vira retalho — menos na beira da estrada de acesso, onde fica lote com aviso;
  - há folga de 3% sobre as máximas para absorver a nesga da ponta sem criar lote nanico;
  - quadra difícil é refeita testando outras frentes e uma ou duas fileiras, e a malha de ruas que deixa menos lote fora das faixas ou torto ganha a nota.
- **Área verde 0%.** Com a meta de verde em zero, nenhum retalho vira área pública: fica como **área remanescente** (do proprietário), desenhada e cotada na planta. O mesmo vale para institucional 0%.
- **Edição dentro das regras.** Frente e área digitadas fora das faixas, unir acima da área máxima, dividir abaixo da mínima e arrastar a divisa além da frente máxima são recusados com o motivo. Toda edição de lote ou quadra é recalculada antes de entrar: se deixar lote fora das regras, não é aplicada.

## Como funciona por dentro

- **Projeto = intenção.** A tabela `loteamentos` (migração 0021) guarda só parâmetros, ruas, áreas e ajustes. Quadras e lotes **nunca** são gravados: `calcular()` (`src/lib/loteamento/calculo.ts`) refaz tudo a cada mudança, em cerca de 10 ms para 200 lotes e 130 ms para 2.000. É isso que faz o resto se ajustar quando um lote, uma rua ou um parâmetro muda.
- **Divisão da quadra.**
  - A frente principal é o maior lado voltado para a rua.
  - Com uma frente oposta, a quadra tem duas fileiras costas com costas; sem ela, uma fileira só.
  - Os lotes são cortados perpendicularmente à rua.
  - Lotes travados (frente ou área) entram primeiro, e os livres dividem o comprimento que sobra pela regra da quadra.
  - Ponta menor que o mínimo soma-se ao vizinho; pedaço sem frente vira sobra, que o gerador transforma em área verde.
- **Ajustes manuais.** São presos à quadra por uma âncora (ponto UTM dentro dela) e ao lote pela posição na fileira. Mover uma rua não perde os ajustes da quadra.
- **Plano de terreno.** O desenho é feito em UTM ÷ fator de escala combinado (ponto × altitude) no centro da gleba, para que as medidas do papel sejam as da trena. A locação volta para UTM multiplicando pelo fator.
- **Onde roda.** Tudo roda no navegador, inclusive os PDF/DOCX/DXF; o gerador automático roda num Web Worker. Nenhuma edge function nova, e a VPS não ganha carga.
- **Laboratório local.** Em `npm run dev`, a rota `#/lab/loteamento` abre a tela com uma gleba sintética de ~9,4 ha, sem login e sem banco.

## Para colocar no ar

1. **Banco.** Aplique `supabase/migrations/0021_loteamento.sql`. Ela amplia o check de `servicos.modalidade` e cria a tabela `loteamentos` com RLS. A migração funciona antes e depois da de escritórios (`docs/multiescritorio/0020_escritorios.sql`, que agora também inclui a tabela nova). Enquanto ela não estiver aplicada, o cartão Loteamento avisa no upload e não cria serviço.
2. **Frontend.** É o build normal (`npm run build`), sem variável nova.

## Testes

- **`tests/loteamento.test.mjs`** cobre:
  - proposta automática sem pendências;
  - quadro de áreas fechando na gleba;
  - lotes sem sobreposição;
  - lote 10×25 com 250,00 m²;
  - cascata ao travar a frente e ao arrastar a divisa;
  - comandos (unir, dividir, verde, largura);
  - APP fora dos lotes;
  - ida e volta do plano de terreno;
  - nomes da locação iguais aos do memorial;
  - DXF/KML bem formados;
  - quadra "beliscada" por rua sobre vértice.
- **`npm run test:rls`** cobre o isolamento da tabela `loteamentos` entre escritórios.
