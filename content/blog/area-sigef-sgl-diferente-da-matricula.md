---
{
  "titulo": "Área do SIGEF diferente da matrícula: por que acontece e o que fazer",
  "seoTitulo": "Área do SIGEF diferente da matrícula: o que fazer | Vertces",
  "descricao": "Área do SIGEF diferente da matrícula: entenda o cálculo no SGL pela fórmula de Gauss, a diferença para a área em UTM e quando a saída é a retificação.",
  "slug": "area-sigef-sgl-diferente-da-matricula",
  "data": "2026-11-07",
  "atualizado": "2026-11-07",
  "categoria": "guias-tecnicos",
  "palavraChave": "área do SIGEF diferente da matrícula",
  "palavrasRelacionadas": ["área sgl sigef", "área utm x sgl", "fórmula de gauss área sigef", "diferença de área georreferenciamento", "área da matrícula maior que a medida", "retificação de área após georreferenciamento"],
  "resumo": "A área do SIGEF quase sempre difere da matrícula por dois motivos: o SIGEF calcula a área no Sistema Geodésico Local (SGL), pela fórmula de Gauss, e a matrícula costuma trazer uma área antiga, medida com outros métodos ou só estimada. A diferença entre SGL e UTM é pequena, de décimos por cento; a diferença grande vem da descrição antiga e, quando os limites mudam, o caminho é a retificação no cartório.",
  "faq": [
    { "p": "A área em UTM que aparece no meu CAD está errada?", "r": "Não está errada, está em outro sistema. A área em UTM sofre a deformação da projeção, que depende da posição no fuso. Para o SIGEF e para os documentos do georreferenciamento vale a área calculada no SGL." },
    { "p": "Posso arredondar a área do memorial para bater com a matrícula?", "r": "Não. O memorial deve trazer a área calculada a partir das coordenadas certificadas. Ajustar o número para coincidir com a matrícula cria uma descrição que não corresponde aos vértices." },
    { "p": "O cartório aceita área medida maior que a da matrícula?", "r": "Depende da diferença, da situação dos limites e do entendimento do registrador. Diferenças pequenas costumam ser tratadas na averbação do georreferenciamento; diferenças grandes ou com alteração de limites pedem retificação. Confirme no cartório da matrícula." },
    { "p": "A área do CCIR precisa ser atualizada depois da certificação?", "r": "Sim, o cadastro no SNCR deve refletir a área certificada. A atualização é feita pela declaração cadastral, e o CCIR seguinte já sai com a área nova." },
    { "p": "Imóvel grande tem diferença maior entre UTM e SGL?", "r": "Em valor absoluto, sim. O próprio Manual Técnico do INCRA observa que as distorções de área crescem conforme a parcela aumenta de tamanho." }
  ],
  "fontes": [
    { "titulo": "INCRA: Manual Técnico para Georreferenciamento de Imóveis Rurais, 2ª edição (itens 1.4.6 e 3.8.3)", "url": "https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/Manual_Tecnico_de_Georreferenciamento_2_Edicao.pdf/@@display-file/file" },
    { "titulo": "Lei 6.015/1973 (Registros Públicos), arts. 176 e 213", "url": "https://www.planalto.gov.br/ccivil_03/leis/l6015compilada.htm" },
    { "titulo": "INCRA: Certificação de Imóvel Rural", "url": "https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/certificacao-imoveis" }
  ]
}
---

A área do SIGEF quase sempre difere da área da matrícula, e isso tem duas causas diferentes. A primeira é de cálculo: o SIGEF calcula a área no Sistema Geodésico Local (SGL), pela fórmula de Gauss, e não na projeção UTM que muitos ainda usam no CAD. A segunda, quase sempre a maior, é que a matrícula traz uma área antiga, medida com outros métodos, arredondada ou só estimada.

Saber separar as duas evita dois erros comuns: achar que o levantamento está errado por causa de uma diferença de décimos por cento, e tentar “acertar” o número do memorial para coincidir com a matrícula.

## Como o SIGEF calcula a área do imóvel?

O SIGEF calcula a área com as coordenadas cartesianas locais do SGL, pela fórmula de Gauss, e expressa o resultado em hectares. A regra está no Manual Técnico para Georreferenciamento de Imóveis Rurais (2ª ed., 2022), que detalha os procedimentos da NTGIR 3ª edição e diz, no item 3.8.3: “O cálculo de área deve ser realizado pela fórmula de Gauss, com base nas coordenadas cartesianas locais (e, n, u) e expresso em hectares.”

Sistema Geodésico Local (SGL) é um sistema cartesiano de três eixos (e, n, u): o eixo n aponta para o norte geodésico, o eixo e para leste, os dois contidos no plano topográfico, e o eixo u segue a normal ao elipsoide no ponto de origem. Para o cálculo de área, o manual manda converter as coordenadas geocêntricas dos vértices para o SGL usando como origem a média das coordenadas da própria parcela.

O passo a passo, em termos práticos:

1. As coordenadas geodésicas dos vértices (latitude, longitude e altitude elipsoidal, em SIRGAS 2000) são convertidas para cartesianas geocêntricas (X, Y, Z).
2. Calcula-se a origem do SGL: a média das coordenadas da parcela.
3. Cada vértice é convertido para coordenadas locais (e, n, u).
4. Aplica-se a fórmula de Gauss (a “fórmula do laço”) sobre os pares e, n, na ordem dos vértices.
5. O resultado, em metros quadrados, é convertido para hectares.

A justificativa do manual é direta: a área no SGL expressa melhor a realidade física do que os valores no sistema UTM, “que era adotado anteriormente”. Por isso a área certificada não é a do seu desenho em UTM, mesmo com os mesmos vértices.

## Por que a área em UTM é diferente da área no SGL?

A área em UTM é diferente porque a projeção deforma as distâncias, e a deformação muda com a posição do imóvel dentro do fuso. No meridiano central o fator de escala da UTM é 0,9996, ou seja, as distâncias projetadas ficam um pouco menores que as reais. Afastando-se do centro, o fator cresce, passa de 1 e chega perto de 1,001 nas bordas do fuso.

Como a área é distância ao quadrado, o efeito dobra. Uma conta de ordem de grandeza:

| Posição no fuso | Fator de escala aproximado | Efeito na área UTM | Imóvel de 1.000 ha |
|---|---|---|---|
| Sobre o meridiano central | 0,9996 | cerca de 0,08% menor | cerca de 0,8 ha a menos |
| Perto das linhas de secante | 1,0000 | praticamente igual | diferença desprezível |
| Na borda do fuso | perto de 1,001 | até cerca de 0,2% maior | até cerca de 2 ha a mais |

Os valores são aproximados e servem para dar a escala do problema. Estudos que compararam áreas em UTM e no SGL encontraram diferenças pequenas, em geral abaixo de alguns décimos por cento, variando com a posição no fuso. O Manual Técnico observa ainda que as distorções de área crescem conforme a parcela aumenta de tamanho.

A lição prática: se a diferença entre o seu CAD e a área do SIGEF está nessa faixa, não há erro de levantamento. É o sistema de cálculo. Para conferir qual fuso o seu imóvel usa e por que isso importa, veja [como descobrir o fuso UTM em SIRGAS 2000](/blog/sirgas-2000-fuso-utm-como-descobrir/).

## Por que a área da matrícula costuma ser tão diferente?

A diferença grande quase nunca vem do SGL: vem da descrição antiga da matrícula. Muitas matrículas e transcrições foram abertas com medições a trena, bússola e corrente, com rumos magnéticos, com área em alqueires convertida e arredondada, ou simplesmente com a área declarada na escritura de compra.

Situações frequentes no escritório:

- **Área “mais ou menos”.** A matrícula diz “com a área de 48 hectares, mais ou menos”. O levantamento encontra 51,3 ha.
- **Unidade antiga.** A área veio em alqueires, e o tamanho do alqueire muda conforme a região. Na conversão, alguém arredondou.
- **Divisas por acidente natural.** O limite segue um córrego que mudou de leito, ou uma estrada que foi alargada.
- **Desmembramentos sem descontar.** Partes vendidas ao longo dos anos não foram abatidas da área do imóvel-mãe.
- **Cerca fora da divisa.** A cerca atual não coincide com o limite do título, e o levantamento seguiu a cerca.

Nesses casos a diferença pode passar de 5%, 10% ou mais. E o problema já não é cálculo: é saber se os limites levantados correspondem aos do título. O Manual Técnico chama isso de exatidão de limites: os limites devem ser identificados, levantados e descritos de forma a contemplar corretamente os limites do imóvel objeto do título de domínio.

## Como conferir se a diferença é de cálculo ou de limite?

Compare a área em três versões e veja onde está o salto. O roteiro abaixo resolve a maioria dos casos antes de ir ao cartório:

1. **Calcule a área em UTM e no SGL** com os mesmos vértices. Se a diferença estiver em décimos por cento, a causa é o sistema de cálculo.
2. **Compare a área no SGL com a da matrícula.** Se a diferença for grande, a causa está nos limites ou na descrição antiga.
3. **Leia a descrição da matrícula trecho a trecho.** Confira rumos, distâncias e confrontantes citados. Um trecho com distância muito diferente aponta onde está a divergência.
4. **Confira os confrontantes.** Veja se o vizinho já é certificado e se os vértices dele coincidem com os seus. Um limite comum deslocado muda a área dos dois.
5. **Verifique desmembramentos anteriores** na certidão de inteiro teor: averbações de venda de partes explicam muita área “sumida”.
6. **Registre a conclusão** antes de gerar o memorial. Ela vai orientar a conversa com o proprietário e com o cartório.

Antes de consumir a numeração oficial dos vértices, vale fazer uma [conferência de área do imóvel rural](/blog/conferencia-de-area-imovel-rural/): você vê a área e o perímetro e decide o encaminhamento com o cliente antes de seguir.

## O que fazer quando a diferença de área é grande?

Quando a diferença é grande ou os limites mudam, o caminho é a retificação no registro de imóveis. A Lei 6.015/1973, no art. 213, II, prevê a retificação a requerimento do interessado nos casos de inserção ou alteração de medida perimetral, com planta e memorial descritivo assinados por profissional habilitado, com a ART e com a assinatura dos confrontantes.

Pontos que costumam pesar na decisão:

- **Confrontantes que não assinam.** Pelo art. 213, §2º, o confrontante que não assinou é notificado para se manifestar em quinze dias.
- **Averbação do georreferenciamento.** O art. 176, §13, incluído pela Lei 13.838/2019, dispensa a anuência dos confrontantes na averbação do georreferenciamento, bastando a declaração do requerente de que respeitou os limites e as confrontações. Isso não substitui a retificação quando há alteração de medida que dependa dela; o registrador avalia o caso.
- **Certificação não é título.** O Decreto 4.449/2002, art. 9º, §2º, deixa claro que a certificação do INCRA não reconhece domínio. Certificar uma área maior não transfere a área a mais para o proprietário.

O procedimento exato, os documentos e o que o registrador aceita variam. Confirme no cartório da matrícula antes de fechar o orçamento com o cliente. O guia de [retificação de área de imóvel rural](/blog/retificacao-de-area-imovel-rural/) detalha o pedido, e o de [documentos do georreferenciamento para o cartório](/blog/pecas-tecnicas-georreferenciamento-cartorio/) mostra as peças que acompanham.

## Qual área vai no memorial descritivo?

No memorial descritivo vai a área calculada a partir das coordenadas certificadas, no SGL, a mesma que aparece no SIGEF. Memorial descritivo é o documento que descreve o perímetro do imóvel vértice a vértice, com coordenadas, azimutes, distâncias e confrontantes, e termina com a área e o perímetro.

Erros que geram exigência:

- área do memorial copiada do CAD em UTM, diferente da certificada;
- área arredondada “para bater” com a matrícula;
- perímetro calculado em um sistema e área em outro;
- planta com uma área e memorial com outra.

Distância e azimute também seguem regras do manual: a distância horizontal é expressa em metros e o azimute é calculado pelo problema geodésico inverso segundo Puissant, em sexagesimal. Mais detalhes em [memorial descritivo de georreferenciamento](/blog/memorial-descritivo-georreferenciamento/).

## Onde um sistema ajuda nessa conferência?

Um sistema ajuda quando mostra a área e o perímetro no mesmo padrão do SIGEF antes do envio, para você não descobrir a diferença só no relatório da certificação. No Vertces, a conferência no mapa já exibe área e perímetro no padrão do SIGEF, junto com os vértices e o confrontante de cada trecho, e o memorial, a planta e a planilha saem com o mesmo número.

O sistema não decide se a diferença para a matrícula pede retificação. Essa leitura é do responsável técnico, com a certidão na mão, e a palavra final é do cartório.
