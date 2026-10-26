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
   - **Edição livre do lote (como no CAD).** O lote selecionado mostra alças nas **quinas** (quadrados) e em cada **lado reto** (barras verdes; na rua, tracejadas). Toda quina tem alça — também a que ficou quase alinhada ou num lado curto; só o arco da esquina (é da rua), a dobra da rua e o "T" de um vizinho (a alça é do vizinho) não têm.
     - Arrastar a quina move o ponto em todos os lotes que o têm. A borda da quadra é um **ímã** (14 px): perto da rua ou da divisa da gleba a quina corre por ela; mais longe, vai aonde o cursor for (Alt solta de vez).
     - Puxar a quina por cima do vizinho é permitido: o lote arrastado tem a vez, o vizinho fica com o que sobra (e some se for engolido — a mensagem avisa, Ctrl+Z desfaz). O contorno guardado é sempre o desenhado, por isso nenhuma alça "trava"; se o próprio lote se cruzar, ele fica com o pedaço da quina que está na mão (a alça acompanha o cursor). Em zoom afastado, a barra de divisa colada em outra alça some até aproximar (as quinas ficam). Arraste que não muda nada (borda empurrada para a rua) não vira passo no desfazer.
     - Arrastar a divisa a desliza paralela a si mesma ("slide line" do Civil 3D): o lote fica mais largo ou mais fundo e o vizinho cede. As pontas correm pela rua, pela linha de fundo ou pelo lado do lote de trás — sem abrir fresta: o lote cujo lado passa reto pela ponta (ou dobra na quina da rua) fica com a ponta velha e ganha a nova.
     - **Frente escolhida (T).** Com um lote selecionado, a ferramenta Frente (T, ou ☆ na lista de confrontações) marca o lado que é a frente dele: servidão, área verde, outro lote — ou a rua principal de um lote de esquina. Só o lado escolhido conta como frente (medidas, avisos, memorial); clicar de novo tira. Sem lote selecionado, o T marca o lado da quadra que é o **acesso** dela (tracejado laranja): a quadra sem rua passa a ser dividida a partir dele e os lotes que encostam nele têm frente ali.
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
6. **Maquete 3D** (botão **3D** na barra da prancheta ou o cartão no topo das Entregas). O projeto no relevo real, como a apresentação de Civil 3D/InfraWorks + Twinmotion — só que no navegador e em segundos.
   - **Abertura:** o terreno de hoje (satélite) vira o projeto; as ruas são escavadas, as casas sobem em onda a partir do centro e as árvores crescem. "Hoje / Projeto" repete a transição.
   - **O que aparece:** o bloco de terreno com as camadas do solo na lateral (maquete física), satélite em volta, pista com faixa, calçada e meio-fio, lotes com número, casas da simulação de ocupação (recuo de 4 m, telhado de 2 ou 4 águas, 1 ou 2 pavimentos, assentadas no ponto alto do lote com fundação aparente), prédio de laje na área institucional, árvores nas áreas verdes, APP como mata, árvores de calçada e de quintal, ipês floridos, rótulos das quadras.
   - **Modos:** Projeto; Declividade (0–8, 8–15, 15–30 e ≥ 30% — o limite do art. 3º da Lei 6.766 — com o % da área dos lotes em cada faixa); Corte e aterro das ruas (volumes em m³); Curvas de nível (intervalo pelo desnível da gleba, mestras a cada 5).
   - **Controles:** exagero vertical até 3× (as cores e medidas usam a cota real), hora do sol (posição real pela latitude e data, sombras longas, pôr do sol dourado e janelas que acendem), camadas (casas, árvores, meio-fio, sombras), vista geral, de cima (norte para cima), bússola, **voo de drone** (espiral, passeio na rua, subida) e **Apresentar** (tela limpa: o terreno de hoje vira o projeto e o drone sobrevoa; Esc sai). No celular o painel recolhe e a ficha sobe de baixo.
   - **Mexer:** arrastar gira; **botão direito (ou do meio, ou Shift+arrastar) agarra o chão** — o ponto sob o cursor fica sob o cursor, sem atraso; a roda aproxima no ponto do cursor. A sombra só é refeita quando algo muda e a resolução cai sozinha durante o movimento se a placa de vídeo não der conta.
   - **Voo de drone (cinema):** o roteiro é montado a partir do projeto (`cinema3d.ts`): vista alta, descida pela rua de entrada a 10 m do asfalto, órbita na maior área verde, passagem pelo prédio institucional, rasante no miolo e subida final — com faixas de cinema, legendas com os números reais (lotes, ruas, área verde, institucional, quadra), carros andando nas ruas e trilha sonora gerada no navegador (WebAudio, liga/desliga). A câmera fica sempre 9 m acima do chão em todo o caminho.
   - **Apresentar:** o mesmo roteiro começando no terreno de hoje (título do empreendimento, o terreno vira o projeto) e com o sol andando da manhã à "hora azul": no fim as janelas das casas e os postes acendem (brilho/bloom) e entra a cartela com os números.
   - **Clique no lote:** ficha com área, frente, fundo, cotas, desnível, declividade média (com a faixa), valor estimado (se houver preço por m²), confrontações e "Ver de perto".
   - **Para o cliente:** foto em alta (PNG, 2× a tela), **vídeo de apresentação** (~70 s com trilha sonora, MP4 no Chrome/Edge, senão WebM: é o roteiro do Apresentar gravado, com faixas de cinema, legendas e cartelas) e **modelo GLB** em escala real (sem o exagero da tela; terreno com até ~90 mil nós, casas, meio-fio e árvores mescladas com cor por vértice, sem extensão obrigatória) para SketchUp, Blender, Twinmotion ou Lumion.
   - **Como é calculado:** `cena3d.ts` (sem three.js, testado em node) monta a grade (até 300 mil nós; bicúbica sobre o modelo de elevação, buscado de novo cobrindo a margem da maquete), o greide das ruas por convolução normalizada (o terreno suavizado só com os nós da rua, raio ~9 m — o cruzamento sai contínuo), o talude 1:1,5 até o terreno natural, os volumes, a estatística de cada lote, as casas e as árvores. `textura3d.ts` pinta o chão (o desenho É a textura: sem tremido). `maquete3d.ts` (three.js) eleva tudo no shader a partir da cota real, então exagero, transição e crescimento são só uniforms. É uma estimativa de estudo: não substitui o projeto geométrico das vias nem a terraplenagem executiva.

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
- **Ajustes manuais.** São presos à quadra por uma âncora (ponto UTM dentro dela). A quadra desenhada à mão guarda os contornos dos lotes em UTM (`QuadraCfg.lotes`); mover uma rua apara os lotes e o que ficar sem lote aparece como área livre. As quinas compartilhadas são um ponto só em todos os lotes (o "T" de um vizinho é inserido no lado do outro), por isso mover uma quina leva os vizinhos junto. Depois de cada arraste, `assentar` (edicao.ts) grava exatamente o que o desenho mostra: contorno que se cruzou vira o maior pedaço (o resto vai ao vizinho de maior divisa) e o lote arrastado ganha a disputa com quem ele invadiu. A frente escolhida fica em `LoteDesenhado.frente` (acompanha o lado nas edições) e o acesso da quadra em `QuadraCfg.acessos` (UTM).
- **Cache da divisão.** `calcular` guarda a divisão de cada quadra automática (por perímetro, parâmetros, ruas, áreas e configs); arrastar uma quina recalcula só a quadra desenhada (≈10 ms em vez de ≈150 ms).
- **Plano de terreno.** O desenho é feito em UTM ÷ fator de escala combinado (ponto × altitude) no centro da gleba, para que as medidas do papel sejam as da trena. A locação volta para UTM multiplicando pelo fator.
- **Onde roda.** Tudo roda no navegador, inclusive os PDF/DOCX/DXF e a maquete 3D (three.js num pacote à parte, baixado só por quem abre a maquete); o gerador automático roda num Web Worker. Nenhuma edge function nova, e a VPS não ganha carga.
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
  - arraste em cadeia que não trava (quina por cima do vizinho, alinhada, de volta: sempre com alça e indo aonde o cursor vai) e divisa que desliza sem abrir fresta;
  - frente escolhida (lote sem rua, rua principal da esquina, acesso da quadra) e o memorial confrontando com o lote vizinho;
  - maquete 3D: casas dentro dos lotes e fora da rua, árvores fora do asfalto, clique acha o lote, greide que alisa o perfil das ruas, corte e aterro, declividade dos lotes;
  - apagar, desenhar, unir, dividir e cortar lotes à mão;
  - geração com no máximo 4 quinas por lote e fundo com fundo nas quadras entre ruas;
  - comandos (unir, dividir, verde, largura);
  - APP fora dos lotes;
  - ida e volta do plano de terreno;
  - nomes da locação iguais aos do memorial;
  - DXF/KML bem formados;
  - quadra "beliscada" por rua sobre vértice.
- **`npm run test:rls`** cobre o isolamento da tabela `loteamentos` entre escritórios.
