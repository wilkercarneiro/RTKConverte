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
   - **Edição livre do lote (como no CAD).** O lote selecionado mostra alças só nas **quinas** (quadrados) e nas **divisas** (barras verdes).
     - Arrastar a quina move o ponto em todos os lotes que o têm; a quina que está na rua ou na divisa da gleba **corre por ela** (Alt solta).
     - Arrastar a divisa a desliza paralela a si mesma ("slide line" do Civil 3D): o lote fica mais largo ou mais fundo e o vizinho cede. As pontas da divisa correm pela rua e pela linha de fundo.
     - **L** desenha um lote (clique as quinas, Enter fecha): o contorno manda e os vizinhos se ajustam a ele. Duplo clique numa **área livre** (rosa) com o L transforma a área inteira em lote.
     - **C** corta lotes com uma linha (clique o início e o fim). **Delete** apaga o lote (a área fica livre).
     - `frente 12` e `area 300` deslizam a divisa lateral até o valor exato (no lote de esquina, vale a frente da rua da fileira). `unir` junta os selecionados (um só: ao vizinho de maior divisa). `dividir 3` divide em partes de área igual, com as divisas na direção das laterais do lote.
     - A primeira mexida geométrica torna a quadra **desenhada à mão**: o sistema não a redivide mais. `automatico` (ou "Voltar ao automático" no painel) descarta o desenho; `preencher` faz lote de cada área livre da quadra.
     - **Nada é bloqueado.** O lote que sair das medidas (frente, fundo, área, mais de 4 quinas, sem frente) fica vermelho com ⚠ e aparece na **coluna de avisos, à esquerda**, com as medidas e o motivo. Clique leva ao lote.
   - **Ferramentas:** R desenha rua (Shift trava o ângulo; os pontos grudam em vértices e eixos), A desenha área pública e M mede.
   - **Linha de comando.** Exemplos: `frente 12`, `area 300`, `unir`, `dividir 2`, `apagar`, `desenhar lote`, `cortar`, `preencher`, `automatico`, `verde`, `institucional`, `qtd 8`, `iguais`, `sobra esquinas`, `fileiras 1`, `fundo 25`, `largura 14`, `balao 10`, `nome Rua das Flores`, `esquina raio 6`, `ir A-12`, `preco 180`, `desfazer`. Para ver tudo, digite `ajuda` ou clique em "?".
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
- **Divisão da quadra por linhas transversais (revisão 10, 25/10/2026).**
  - Na quadra entre duas ruas de frente (até 40° fora do paralelo), as divisas são linhas que atravessam a quadra de rua a rua; a linha de fundo (paralela ou na bissetriz, se as ruas se abrem) parte cada faixa em dois lotes. **Fundo com fundo por construção**: cada lote encosta o fundo em exatamente um lote da outra fileira.
  - As linhas são perpendiculares à rua (à bissetriz). Se as pontas da quadra são oblíquas, giram de uma ponta à outra (leque) até 45°; na fileira única, seguem paralelas (até 30°).
  - A fileira de frentes menores é a régua: ela recebe a frente padrão e a do outro lado sai um pouco mais larga (nunca abaixo da mínima).
  - **Toda quina do contorno vira divisa** (dobra da divisa da gleba, fim da rua do outro lado, rua que dobra em arco no meio da quadra): o lote não ganha a 5ª quina. O arco da esquina conta como uma quina e fica inteiro no lote de esquina.
  - Onde a quadra afina (ruas que se encontram), o par de lotes vira um lote de rua a rua (ponta, 3 ou 4 quinas).
  - Quadra em que as ruas se encontram num canto (esquina, não de frente): cada fileira é dividida perpendicular à sua rua e as duas se encontram na bissetriz.
  - Quadra que alarga: o lote que passaria do fundo máximo cede a parte de trás ao lote de costas para ele (a divisa de fundo daquele par anda; os dois seguem com 4 quinas).
  - **Pontas:** os 1 a 4 lotes da ponta são redivididos — nas duas fileiras juntas, pelas mesmas linhas — em mais, menos ou o mesmo número de lotes, com as divisas na direção da fileira ou da ponta, ficando com o arranjo de menor "custo" (sem frente e abaixo da área pesam mais que qualquer excesso; fundo além do máximo, frente demais, mais de 4 quinas e ângulo agudo também contam).
  - Quadrinha de 2 ou 3 lotes vira um lote de ponta se couber.
  - Lote de rua a rua (frente para duas ruas) é o que as normas mandam evitar: a quadra entre duas ruas só fica com uma fileira se a de duas for bem pior.
- **Fundo com fundo.**
  - Garantido pelas linhas transversais; as únicas exceções são o lote de rua a rua na ponta e a quadra em esquina.
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
- **Regras de projetista (pesquisa de 23/10/2026).**
  - Divisa lateral do lote perpendicular à rua (radial na curva); tolerância de 15° a 20° (códigos de Mattawa e Durham, EUA).
  - Sobra abaixo do mínimo não é lote: é anexada aos vizinhos (Sherburne County, §11.1.5). Na ponta da fileira, a cunha e 1 a 3 lotes vizinhos são redivididos em um lote a menos, dentro das faixas.
  - Fileira funda é aparada numa linha só, paralela à rua. O fundo vira um retalho único, e retalhos encostados se unem.
  - Área verde só onde cabe um círculo de 10 m de raio, num perímetro único, sem fragmentos (Lei 9.413/81 de SP, art. 2º, IV, b). Retalho que não cumpre isso não vira verde; o que encosta numa área pública entra nela.
  - Quadrinha de ponta (2 ou 3 lotes) vira um lote de ponta, com frente de até 1,5 vez a máxima: é o lote maior que ajusta a linha da propriedade.
  - Junto à estrada ou rodovia, o gerador testa também a via paralela (minuta do código de parcelamento de Goiânia, 2014, art. 13, XVI): faixa de duas fileiras, uma de frente para a estrada.
- **Área verde 0%.** Com a meta de verde em zero, nenhum retalho vira área pública: fica como **área remanescente** (do proprietário), desenhada e cotada na planta. O mesmo vale para institucional 0%.
- **Forma do lote.** No máximo 4 quinas (o de ponta pode ter 3); lote com 5 ou mais quinas é erro na planta gerada e aviso no lote desenhado à mão — 5 quinas ou mais só com aprovação específica do órgão (Milton, WA; Cupertino chama de "pie-shaped" o lote com 5 divisas).
- **Edição livre.** Nada é recusado: o que sair das medidas vira aviso no lote (vermelho no desenho e na coluna da esquerda).

## Como funciona por dentro

- **Projeto = intenção.** A tabela `loteamentos` (migração 0021) guarda só parâmetros, ruas, áreas e ajustes. Quadras e lotes **nunca** são gravados: `calcular()` (`src/lib/loteamento/calculo.ts`) refaz tudo a cada mudança, em cerca de 10 ms para 200 lotes e 130 ms para 2.000. É isso que faz o resto se ajustar quando um lote, uma rua ou um parâmetro muda.
- **Divisão da quadra.**
  - A frente principal é o maior lado voltado para a rua.
  - Com uma frente oposta, a quadra tem duas fileiras costas com costas; sem ela, uma fileira só.
  - Os lotes são cortados perpendicularmente à rua.
  - Lotes travados (frente ou área) entram primeiro, e os livres dividem o comprimento que sobra pela regra da quadra.
  - Ponta menor que o mínimo soma-se ao vizinho; pedaço sem frente vira sobra, que o gerador transforma em área verde.
- **Ajustes manuais.** São presos à quadra por uma âncora (ponto UTM dentro dela). A quadra desenhada à mão guarda os contornos dos lotes em UTM (`QuadraCfg.lotes`); mover uma rua apara os lotes e o que ficar sem lote aparece como área livre. As quinas compartilhadas são um ponto só em todos os lotes (o "T" de um vizinho é inserido no lado do outro), por isso mover uma quina leva os vizinhos junto.
- **Cache da divisão.** `calcular` guarda a divisão de cada quadra automática (por perímetro, parâmetros, ruas, áreas e configs); arrastar uma quina recalcula só a quadra desenhada (≈10 ms em vez de ≈150 ms).
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
  - frente digitada: a divisa lateral desliza, o vizinho cede, a quadra se conserva;
  - arrastar quina e divisa (a quina da rua corre pela rua; sem sobreposição);
  - apagar, desenhar, unir, dividir e cortar lotes à mão;
  - geração com no máximo 4 quinas por lote e fundo com fundo nas quadras entre ruas;
  - comandos (unir, dividir, verde, largura);
  - APP fora dos lotes;
  - ida e volta do plano de terreno;
  - nomes da locação iguais aos do memorial;
  - DXF/KML bem formados;
  - quadra "beliscada" por rua sobre vértice.
- **`npm run test:rls`** cobre o isolamento da tabela `loteamentos` entre escritórios.
