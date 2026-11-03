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
     - **Sem divisa invisível** (desde 2026-11-01, caso EDILSON). Onde a rua acaba antes da quina, duas quadras se encontram numa linha que não existe no terreno. Antes, ao apagar os lotes da quina, o rosa vinha em pedaços (um por quadra) e o lote novo só cabia dentro de um pedaço. Agora:
       - a área livre encostada é uma só;
       - o L e o duplo clique fazem um lote por cima dessa linha. Ele toma a terra que cobrir: lotes, área livre ou a quadra que ficou vazia. Nunca toma rua nem área pública. Os lotes cobertos cedem.
       - O lote fica na quadra de que ele tem mais terra (`LoteDesenhado.livre`); a quadra cresce e as vizinhas encolhem. As quadras não mudam de nome.
     - **C** corta lotes com uma linha (clique o início e o fim). **Delete** apaga o lote (a área fica livre).
     - `frente 12` e `area 300` deslizam a divisa lateral até o valor exato (no lote de esquina, vale a frente da rua da fileira). `unir` junta os selecionados (um só: ao vizinho de maior divisa). `dividir 3` divide em partes de área igual, com as divisas na direção das laterais do lote.
     - **Seta e mão** (desde 2026-11-01). A **seta (V)** é a ferramenta padrão:
       - o clique seleciona;
       - arrastar desenha uma **caixa de seleção**, como no CAD. Da esquerda para a direita (azul contínua), pega os lotes inteiros dentro dela. Da direita para a esquerda (verde tracejada), pega os que ela toca. **Shift** soma à seleção;
       - para mover a vista com a seta: botão do meio ou direito, ou **Espaço** segurado.

       A **mão (H)** é o comportamento antigo: arrastar move a vista e o clique seleciona.
     - **Linha de fundo maleável** (quadra de duas fileiras; aparece em laranja com a quadra ou vários lotes selecionados):
       - a **barra** move a linha inteira, paralela a ela mesma. Cada junção corre pela sua divisa lateral, então o fundo com fundo continua alinhado. Uma fileira fica mais funda e a outra mais rasa;
       - os **losangos** dobram a linha num ponto: aquela junção corre pela divisa dela, e só os lotes em volta mudam.

       Código: `linhasDeFundo`, `moverLinhaDeFundo` e `moverPontoDeFundo` em `edicao.ts`. A detecção (`estruturaDeDivisas`) monta o caminho pelas junções de dentro da quadra (3 ou mais divisas chegando), ao longo da quadra (até 50° da rua principal). Por isso o degrau sobre uma divisa lateral não é tomado por linha de fundo.
     - **Igualar áreas** (botão no cartão de vários lotes, ou o comando `igualar`; desde 2026-11-01). Funciona com lotes vizinhos da mesma quadra, selecionados com a caixa da seta ou com Shift + clique.
       - **Fundo com fundo continua fundo com fundo.** A divisa lateral que vai de rua a rua desliza inteira: o trecho da frente e o de trás juntos, com a junção voltando para a linha de fundo.
       - Quando só a frente está selecionada, o lote de trás acompanha a divisa, e a mensagem diz quais lotes acompanharam. Selecione os de trás também para igualar junto.
       - Com as colunas inteiras selecionadas (frente + trás), primeiro a linha de fundo do trecho anda reta. Depois as divisas igualam as colunas. Por fim, um ajuste fino em cada trecho do fundo, que numa quadra regular é zero.
       - Todos ficam com a soma das áreas dividida por igual.
       - Só as divisas **entre** os selecionados deslizam: paralelas a si mesmas, com as pontas correndo pela rua e pela linha de fundo. A ponta vira as dobras do contorno.
       - Os lotes de fora da seleção não mudam de área.
       - A seleção pode ter duas fileiras (fundo com fundo). Lotes que não se encostam, ou de quadras diferentes, são recusados com o motivo.
       - Se a forma da quadra não deixar chegar exato, a mensagem diz entre quais áreas os lotes ficaram.
       - Código: `igualarAreas` em `edicao.ts`. A árvore de divisas entre os selecionados leva cada parte da árvore a n × alvo. Cada passo é recusado se sobrepuser lotes, sair da quadra ou deixar um lote com contorno degenerado.
     - **Fundo com fundo pela linha central** (desde 2026-11-02; plano em [plano-linha-central.md](plano-linha-central.md)). Botão **Ajustar fundo com fundo** no cartão da quadra e no de vários lotes, ou o comando `fundo com fundo [N] [iguais|absorver]`. Sem nada selecionado, **Ajustar fundo com fundo em todas as quadras** faz o projeto inteiro: só fica a quadra que melhora, e as outras não mudam.
       - A quadra de duas fileiras passa a ser gerada da **linha central** (`QuadraCfg.estrutura`, motor em `linhaCentral.ts`). Cada divisa é um par de laterais no esquadro da própria rua que se encontram no mesmo ponto da linha: o fundo com fundo sai alinhado por construção, e os lotes saem com a mesma área.
       - **Cabeceiras:** o sistema testa as opções e escolhe uma para cada ponta:
         - esquina direta;
         - ponta em fileira única (rua a rua), onde a quadra afina;
         - lotes de frente para a rua da ponta ("testa"), quando a ponta é muito inclinada.
       - **Cabeceira inclinada:** a esquina da fileira mais comprida absorve a diferença ou ganha um lote a mais. Com "iguais", todos ficam com a mesma área e as laterais giram um pouco.
       - **Dobra da rua** (12° ou mais) recebe uma divisa: nenhum lote ganha a 5ª quina.
       - **Na prancheta,** a linha central aparece em laranja:
         - cada **losango** numa junção corre pela divisa e dobra a linha ali;
         - a **ponta** corre pela rua da cabeceira e gira a linha;
         - durante o arraste, cada fileira se iguala por si;
         - ao soltar, a linha desliza de lado até todos terem a mesma área;
         - se a quadra não fechar, o ponto vai só até onde ela deixa (100/75/50/25% do puxão), com o motivo na mensagem;
         - **Esc** cancela o arraste.
       - O cartão da quadra mostra a área dos lotes, as cabeceiras e o maior giro das laterais, com ±2 lotes, a regra da cabeceira inclinada, "Linha automática" e "Voltar ao automático". O DXF ganha a camada `LINHA_CENTRAL`.
       - Mexer à mão num lote da quadra estruturada (quina, divisa) volta a quadra para o desenho livre.
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

7. **Projetos de infraestrutura.** O sistema gera, a partir do traçado e do relevo, as redes de:
   - água (malha resolvida como no EPANET, com reservatório);
   - esgoto (por gravidade até a estação de tratamento ou elevatória);
   - drenagem (método racional, bocas de lobo e galerias);
   - energia (postes, transformadores e média/baixa tensão);
   - iluminação pública.

   Elas aparecem em três lugares: na prancheta (botão **Redes**), na maquete 3D (postes, fios, hidrantes, PVs, reservatório e o modo **Infraestrutura**) e nas Entregas (pranchas PDF, memorial de cálculo, planilhas com quantitativos e DXF). Detalhes, critérios e fontes em [infraestrutura.md](infraestrutura.md).

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
  - **Arco e chanfro da esquina contam como UMA quina, no PI** (`geom.quinasDetalhe`, desde 2026-11-02). O PI é o cruzamento das tangentes.
    - O arco é reconhecido por tangência (raio de até 40 m, com PC e PT), não por corda curta.
    - Chanfro de até ~4 m em cada alinhamento é uma quina.
    - Canto com uma dobra vizinha são duas quinas.
    - Curva aberta de estrada não é quina.
  - O aviso de 5 quinas só aparece quando a regra antiga e a nova concordam; o gerador e o igualar seguem com a antiga.
  - **Esquina** é o encontro de duas ruas numa quina. A estrada levantada que dobra e o lote de rua a rua não são esquina, nem ganham o acréscimo no VGV.
  - O lote de esquina mede a **testada** até o PI (como a Res. CPPU 003/2018 de São Paulo) e o **fundo** a partir da frente principal.
  - O memorial e o quadro trazem frente, laterais, fundos e a **curva de concordância** à parte.
- **Edição livre.** Nada é recusado: o que sair das medidas vira aviso no lote (vermelho no desenho e na coluna da esquerda).

### Igualar áreas e fundo com fundo com lotes selecionados (02/11/2026)

Com vários lotes selecionados, **Igualar áreas** e **Ajustar fundo com fundo · N lotes** redividem a terra dos selecionados só entre eles (`src/lib/loteamento/rearranjo.ts`):

- O contorno da união dos selecionados não muda. Os lotes de fora ficam exatamente como estavam, e todos os selecionados saem com a mesma área.
- **Duas fileiras** (a seleção encosta em duas ruas que se olham). Concorrem dois arranjos:
  - o motor da linha central dentro da seleção, com as pontas nas divisas dos vizinhos ("direta"); a ponta da linha vai para a quina do degrau do vizinho;
  - faixas de rua a rua (paralelas às pontas, em leque ou no esquadro), em que a junção de cada par parte a faixa em duas metades iguais. Esse arranjo é para quando as pontas da seleção são muito inclinadas.
  - Nos dois, cada lote encosta o fundo em um só lote da outra fileira, sem junção em "T".
- **Uma fileira.** Os cortes vão da rua até o fundo, achados pela área acumulada (exata). A direção é a de melhor forma entre esquadro da rua, paralelas (média das pontas) e leque. Se a fileira de trás tem a mesma quantidade de lotes, cada lateral termina numa junção dela, e o fundo com fundo se mantém sem mexer nos de trás.
- **Régua da escolha.** Pesam quinas, desvio do esquadro, laterais não paralelas, proporção fundo/frente, linha central em zigue-zague e lote fora das medidas do projeto.
  - Se todos iguais obrigaria um lote a sair com testada abaixo da mínima (ponta muito inclinada), o comando avisa.
  - Nesse caso, o igualar volta ao jeito antigo: as divisas deslizam, ou iguala por partes.
- A quina a mais que o degrau do vizinho de fora traz vai para algum lote da ponta, e o lote fica com aviso.

### Quadra de três frentes (03/11/2026)

O caso é a quadra E do IRAN: um triângulo entre três ruas (a4 com 286 m, rodovia com 220 m e a3 com 113 m), em que a a4 e a rodovia se encontram numa ponta fina. O igualar só conhecia "duas ruas que se olham com as pontas fechadas" ou "uma fileira". A a3 virava cabeceira sem lotes, e os 8 lotes de frente para ela não cabiam. O comando caía nas divisas que só deslizam e travava em 18 delas, igualando por partes: 319, 336, 353, 380 e 400 m², com degrau no fundo e lote fora das medidas.

Agora, quando a linha central e as faixas não fecham, `blocosTresFrentes` (rearranjo.ts) divide a terra em blocos, cada um com n × T de área exata:
- **Testa:** fileira de frente para a rua da cabeceira, com o fundo numa reta paralela a ela. A reta pode girar até 40°.
- **Ponta:** lotes de rua a rua, separados por uma reta que pode ficar até 30° fora da perpendicular à bissetriz. A transição em diagonal dá fundo aos últimos lotes das duas fileiras sem que o primeiro de rua a rua passe da profundidade máxima.
- **Miolo:** duas fileiras fundo com fundo, numa linha de fundo reta (a bissetriz das duas frentes, deslocada até fechar a conta).
- **Divisão de cada bloco:** a dobra do fundo (onde a reta de um bloco encontra a linha de fundo) vira divisa (`melhorComDobra`). Em pedaço com frente para duas ruas (perto de uma esquina aguda), a frente por cada rua sozinha também concorre: os lotes correm de rua a rua em vez de dar a volta na esquina.
- **Cunha:** onde a reta da testa encontra uma frente em ângulo fechado, a ponta aguda pode passar para a testa, com a descida no esquadro ou até 20° inclinada.
- **Régua:** primeiro, quantos lotes ficariam fora das medidas pela régua da planta (frente pelos lados na rua; fundo até a reta do lado mais comprido na rua; a frente máxima não vale para lote de esquina nem de rua a rua). Depois, o custo de forma.
- **Desempenho:** uma passada rápida sem dobras ordena as combinações, e só as 8 melhores são divididas por inteiro (cerca de 2,5 s na E).
- **Numeração:** segue a ordem do contorno, no sentido e com o começo mais perto dos números antigos. Pelo lote mais perto, os números saíam embaralhados.
- **Resultado na E:** 31 lotes de 353,02 m², nenhum aviso, nenhum lote com 5 quinas.

Limite que a conta mostra: com T = 353 m², frente máxima de 15 m e fundo máximo de 42 m (3% de folga), duas fileiras pedem pelo menos 45,7 m de largura, e o lote de rua a rua aceita no máximo 43,3 m. Com a reta da ponta perpendicular sobra sempre um lote fora; por isso a reta gira.

**Sem travar a tela (03/11, tarde).** O igualar rodava na thread da tela, que congelava de 10 a 17 s (13 s na E). Agora:
- o "Igualar áreas" e o "fundo com fundo" nos lotes selecionados rodam num Web Worker (`comando.worker.ts`, `executarEmSegundoPlano` em acoes.ts), com recuo para a própria thread se o navegador não deixar;
- a barra de comando mostra "Igualando os lotes…" com spinner, um segundo comando espera, e se o projeto mudar no meio o resultado é descartado;
- na quadra de três frentes os blocos rodam antes da linha central, que só entra se sobrar lote fora (E: de 13 s para 3 s);
- a medida de cada lote nos blocos fica guardada entre os candidatos.
Medido no laboratório: a maior pausa da tela durante o cálculo foi de 120 a 133 ms.

### Linha de fundo reta (03/11/2026, noite)

**Regra do Wilker:** a linha de fundo é uma reta única entre todos os lotes fundo com fundo. Se a divisão em áreas iguais não fecha, a diferença fica nos últimos lotes (a esquina que absorve) ou numa pequena diferença entre lotes. O fundo nunca vira zigue-zague.

O que deixava o fundo torto, medido nas quadras B, C e D do IRAN (de 7 a 17 dobras, com giros de até 24°):
- **Igualar antigo:** quando a linha central não dava áreas exatas, o "Igualar" caía nas divisas que deslizam. Ele empurrava cada trecho do fundo para um lado e formava um serrote.
- **Linha central automática:** seguia a equidistante das ruas, que dobra com elas. O otimizador ainda punha uma dobra em cada junção para endireitar as laterais.

Como ficou (`linhaCentral.ts`, `rearranjo.ts`):
- **A linha automática é uma reta** (`retaDasFrentes`): fica na direção média das duas ruas e passa pelo centro da equidistante. As fileiras se empatam deslocando a reta de lado.
  - A reta pode girar até 12° em volta do meio. O otimizador que dobrava a linha (`otimizarC`) saiu da escolha.
  - A linha que acompanha as ruas só entra quando nenhuma reta fecha (quadra dobrada em "L").
- **Laterais em leque:** a linha central também divide com as laterais acompanhando a inclinação das divisas das pontas. O modo "meio" fica a meio caminho entre esse leque e o esquadro.
  - Nas quadras de pontas a 30–45° (B, C e D do IRAN), o esquadro deixava lotes em cunha na ponta, com testada de 4,6 m. O leque divide tudo igual, como o gerador original fazia.
  - O modo escolhido fica gravado na quadra (`estrutura.laterais`). Sem ele, o recálculo com a linha gravada voltava ao esquadro e dava outro desenho.
- **Medidas como a planta mede:**
  - o lote da ponta ou da testa passou a ter a testada medida pelos lados na rua (antes ficava sem testada e o lote com 7,6 m de rua passava);
  - a profundidade é a maior distância até a reta da frente;
  - a frente máxima vale para os lotes do meio da fileira.
  - Lote fora das medidas pesa mais que o lote comprido na escolha do arranjo.
- **Seleção ("Igualar" e "Fundo com fundo"):**
  - Linha dobrada não entra. As faixas de rua a rua só concorrem se as junções caem numa reta. A linha de fundo atual em serrote vira a reta mais próxima.
  - **A linha que continua nos lotes vizinhos** (a seleção pega só um trecho dela) fica reta e no lugar.
    - Deslocada só ali, ela faria um degrau no encontro com os vizinhos.
    - Cada fileira se iguala por dentro, e a mensagem explica que, para todos ficarem com a mesma área, é preciso selecionar o trecho inteiro da linha.
    - Quando a seleção pega a linha toda, ela desliza de lado até todos ficarem iguais.
  - Os lotes da linha central são recortados pelo contorno da seleção, e a terra tem de fechar em 5 cm².
    - Antes, a tolerância era de 0,2%, e a fresta que a reta deixava no degrau do vizinho ia para o lote de fora.
    - A escolha também pesa o lote que a planta acusaria (testada, fundo, 5 quinas).
  - **Igualar sem jeito de todos iguais:**
    - o deslizamento das divisas que entortaria a linha de fundo não é gravado;
    - no lugar dele vale o fundo com fundo numa reta, se a diferença for pequena: até 10%, ou no máximo 2 lotes (os da ponta) diferentes dos outros;
    - se a diferença for maior, o igualar recusa e explica.
    - Na quadra A do EDILSON, a versão anterior entortava o fundo e igualava "por partes". Agora dá 18 lotes de 278,8 m² e 2 de 245,6 m² na ponta, com o fundo reto.
- **"Fundo com fundo" da quadra inteira em segundo plano:** a escolha das variantes (`melhorEstrutura`) também roda no worker. Antes, eram cerca de 2 s de tela parada; agora, 0,18 s.
- **Quadra inteira:** se nenhuma variante fecha sem perder lote, cruzar divisa ou deixar sobra (a quadra de três frentes), a prancheta não troca a quadra por um arranjo pior. Antes, a E do IRAN ia para 17 lotes com 8 avisos.
- **Geração:** a quadra que, com a reta, ainda deixa lote fora das medidas tenta um lote a mais e um a menos. Antes, isso só acontecia com quantidade ímpar. Na quadra A do EDILSON, por exemplo, a reta deixava um lote com 42 m de fundo, e com 27 lotes ficou sem aviso.

Resultado no IRAN:
- "Igualar" da quadra inteira: C com 32 × 292,90 m² e D com 24 × 304,01 m². O fundo ficou reto, sem aviso.
- "Fundo com fundo": B com 40 × 286,04 m², pela linha central reta.

### Geração já ajustada (02/11/2026)

- Depois de traçar as ruas, `estruturarQuadras` (auto.ts) refaz cada quadra de duas fileiras pela linha central.
  - Fica só a que não perde lote, não ganha aviso e não deixa sobra.
  - Com quantidade ímpar de lotes, tenta um lote a mais.
- A nota da linha central (`notaDe`) pesa o lote comprido demais (`alongamento` acima de 3×, ao quadrado). Isso tira os lotes-tira da "testa" na cabeceira.
  - Lote faltando pesa mais que qualquer forma.
  - Com 5 quinas na linha automática, tenta a linha mais reta.
- **Área verde:** sempre no ponto do terreno mais afastado das estradas (`valorDosLotes`: a distância manda, o relevo só desempata). O retalho perto da estrada não vira verde: é somado aos lotes vizinhos.
- **Institucional:** cresce a partir do lote mais perto do centro da gleba (centroide, ou ponto interno se a gleba for em "L"), sempre pelo vizinho mais central, num terreno só.
- Lote com frente acima do máximo (a cunha na ponta da fileira) é igualado com os vizinhos da fileira pelo mesmo rearranjo, e só fica se a planta melhora. Antes ele "sumia" virando área verde.

### Rodada de QA no sistema real (02/11/2026, noite)

Testado no vertces.com.br com um serviço de teste e, no motor, com 8 glebas (EDILSON, IRAN, IRAN com os parâmetros da equipe, a do laboratório, IBERA parte 2, retângulo, trapézio e uma em "L"), 3 propostas cada, e com as ferramentas de ajuste aplicadas em seleções sorteadas de todas as quadras. Regras que passaram a valer:

- **Seleção em quadra da linha central.** A posição de um lote no desenho vem da numeração (o índice dele é por fileira e se repete). Antes, igualar A-03…A-06 mexia em A-08, A-09, A-23 e A-24.
- **Lotes de fora não mudam.** Igualar só a fileira da frente não arrasta mais o lote de trás: a divisa desliza até a linha de fundo e a linha fica onde está. Duas fileiras desencontradas se igualam cada uma por dentro (a mensagem diz). Lotes que só se encostam pelo fundo são recusados com explicação.
- **Igualar não gira lotes.** No igualar a cabeceira fica "direta" (a "testa" redesenhava a ponta com lotes de pé e cunha). Lotes já iguais: "nada mudou".
- **Nenhum lote quebrado.** O rearranjo descarta o arranjo que deixa mais lotes com 5+ quinas do que havia, ou fundo acima do máximo. No fundo com fundo de fileiras desencontradas concorre a **linha de fundo atual travada**: cada fileira por igual, os degraus das pontas ficam sobre ela e os lotes da ponta seguem com 4 quinas.
- **Fundo com fundo da quadra inteira** testa a quantidade atual (e ±1 se precisar), com a esquina absorvendo ou todos iguais, e fica com o de menos avisos. A nota da linha central conhece as medidas do projeto (`foraDasMedidas`). Se mesmo o melhor piora, a quadra fica como estava e a mensagem diz como forçar (`fundo com fundo N`). Quadra com área pública feita dos lotes dela não é refeita inteira (a reserva se perderia); os lotes selecionados ainda podem.
- **O arranjo avaliado é o gravado.** A escolha confere a linha central fixada (a que fica no projeto). O recálculo com a linha gravada realoca as junções e chegava a cruzar divisas.
- **Congelar a quadra** (qualquer edição de lote) recorta cada lote pelo contorno dela e pega as áreas públicas pela geometria. Antes, o retalho absorvido de fora virava sobra por baixo do lote, e o pedaço de verde de uma quadra sumia quando a área estava registrada na vizinha.
- **Geração.** A divisa que morre a poucos metros da quina do contorno vai até a quina (`encaixarNasQuinas`), e o lote não fica com a 5ª quina. A ponta fina da gleba que encosta no verde, longe da estrada, entra no verde. A planta com lote em pendência perde na nota. Passo final `consertarPendencias`: cada lote fora das medidas tenta dividir, igualar com 1 a 3 vizinhos ou unir, e fica o que diminui as pendências.
- **Quadro de lotes:** o lado que o lote não tem (o triângulo da ponta) sai "—", não 0,00.
- **Fundo com fundo por seleção** (2ª a 5ª rodada, no ar): lotes já fundo com fundo (sem junção em "T") e iguais respondem "nada mudou". A frente de cada lote novo é medida pelos lados dele na rua, como a planta mede. Se o arranjo só fecha com áreas mais de 25% diferentes (4 lotes de um lado e 3 do outro), o comando pede os lotes em pares. O igualar que desliza as divisas não deixa testada abaixo da mínima do projeto.
- **Fundo com fundo em todas** explica cada quadra que ficou: já pela linha central, de duas fileiras com lotes desenhados um a um, com área pública de lotes ou que ficaria pior.
- **Perguntas do loteamento:** o marco do TXT com rótulo "estrada/" encerra a estrada. Os lados depois dele não vêm mais marcados como estrada.
- **Fuso UTM ao criar o serviço.** Com E/N, a longitude cabe em qualquer fuso, e a Bahia atravessa o 23S e o 24S. O "mais perto do centro da UF" punha o leste baiano no 23S, a 600 km. Agora, se o arquivo cabe em mais de um fuso na UF e o fuso está no automático, a tela pergunta antes de criar e sugere o que a empresa mais usa naquela UF.

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
- **`tests/rearranjo.test.mjs`** cobre:
  - igualar e fundo com fundo nos lotes selecionados: iguais, de fora intactos, sem junção em "T";
  - recusa de seleção solta;
  - geração com as quadras pela linha central e sem erro;
  - verde longe da estrada e institucional no centro;
  - os casos reais do EDILSON (pontas inclinadas na C, cabeceira da D sem lote-tira).
  - quadra de três frentes: triângulo sintético (áreas exatas, sem 5 quinas, fundo dentro do máximo) e a quadra E real do IRAN (`tests/corpus-real/iran/`, fora do Git: 31 iguais, sem aviso, numeração em sequência).
- **`npm run test:rls`** cobre o isolamento da tabela `loteamentos` entre escritórios.
