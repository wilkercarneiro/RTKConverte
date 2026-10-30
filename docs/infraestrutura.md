# Projetos de infraestrutura do loteamento

O sistema gera, a partir do traçado do loteamento e do relevo, os projetos de:

- abastecimento de água;
- esgotamento sanitário;
- drenagem pluvial;
- distribuição de energia;
- iluminação pública.

Juntos, são a infraestrutura básica do art. 2º, §5º, da Lei 6.766/79. Como quadras e lotes, as redes **não são gravadas**. O projeto guarda só os parâmetros (`projeto.infra`) e `calcularInfra()` refaz tudo a cada mudança: mexeu numa rua, as redes acompanham. O cálculo leva cerca de 50 a 130 ms para 200 lotes.

## Onde aparece

- **Prancheta (Projeto).** O botão **Redes** na barra da esquerda abre o painel das redes.
  - Liga e desliga cada rede e mostra os números principais.
  - Passe o mouse numa peça (tubo, PV, poste, transformador) para ver o cálculo dela.
  - As redes são recalculadas um instante depois de cada mudança, nunca durante o arraste.
- **Maquete 3D.** A camada **Redes** vem ligada.
  - Os postes de iluminação genéricos dão lugar aos postes do projeto elétrico:
    - 12 m com cruzeta na média tensão, 9 m só na baixa tensão;
    - transformador;
    - luminária na altura do projeto.
  - Fios em catenária de média tensão, baixa tensão e ramais até cada lote.
  - Peças no chão:
    - hidrantes;
    - tampas de PV no asfalto;
    - bocas de lobo na guia.
  - O reservatório (torre ou apoiado) fica num canto da área pública, sem cruzar o prédio institucional.
  - A estação de tratamento ou a elevatória de esgoto.
  - As árvores de calçada saem de baixo dos fios: poste no lado não arborizado, como pede a DIS-NOR-012.
  - O modo **Infraestrutura** pinta as redes enterradas no chão, como raio-x, com legenda e números.
- **Entregas.** A seção **Projetos de infraestrutura** traz:
  - os números de cada rede;
  - os parâmetros do empreendimento;
  - **pranchas em PDF**, 4 folhas: água, esgoto, drenagem, energia e iluminação;
  - **memorial descritivo e de cálculo** (DOCX);
  - **planilhas de dimensionamento** trecho a trecho e **quantitativos** (ZIP com 5 CSV);
  - **DXF** das redes em camadas.
  
  Na locação há a opção de mandar para a coletora os PVs, as bocas de lobo, os postes, os hidrantes e o reservatório.

## Como cada rede é projetada

Código em `src/lib/loteamento/infra/`.

- **Grafo das ruas (`grafo.ts`).**
  - Os eixos das ruas, recortados na gleba, e a frente da estrada de acesso (onde há lote) viram arestas.
  - Os nós são as pontas e os cruzamentos (em X e em T).
  - Cada lote é ligado à rua da sua frente; é por ali que entram os ramais.
- **Água (`agua.ts`, NBR 12218:2017).**
  - Demanda: 5 hab./lote e 150 L/hab.dia, com K1 1,2 e K2 1,5. A vazão de cada rua é proporcional aos lotes dela.
  - A rede é malhada e resolvida pelo **gradiente global** (Todini-Pilati, o algoritmo do EPANET), com perda de carga de Hazen-Williams (C 140).
  - Diâmetros: tudo começa em DN 50 e sobe onde a perda passa de 10 m/km.
  - O tubo fica a 0,70 m do alinhamento, no passeio mais baixo. Vias com 15 m ou mais entre alinhamentos recebem rede dupla.
  - Reservatório:
    - na área pública mais alta;
    - nível mínimo fixado pelo ponto crítico (cota + 10 mca + perda até lá);
    - elevado (torre) quando o nível passa do chão;
    - volume de 1/3 do dia de maior consumo.
  - Pressão estática acima de 40 mca recebe VRP na entrada da zona baixa.
  - Peças: registros nas derivações; descargas nos pontos baixos e pontas secas; ventosas nos altos.
  - Hidrantes cobrindo os lotes num raio de 300 m, com DN 100 no caminho até eles.
- **Esgoto (`esgoto.ts`, NBR 9649).**
  - O coletor corre no eixo, por gravidade, até o ponto mais baixo da rede, onde fica a estação de tratamento.
  - Destino "rede pública": a ligação é na estrada. Se o ponto baixo fica abaixo dela, o sistema põe uma **estação elevatória** com linha de recalque.
  - Rua fora do caminho natural da água vira ponta seca (TIL).
  - Critérios:
    - vazões Qi = K2·Qm + Qinf e Qf = K1·K2·Qm + Qinf, com no mínimo 1,5 L/s;
    - declividade mínima 0,0055·Qi^-0,47 (tensão trativa ≥ 1 Pa), nunca abaixo de 0,5%; máxima 4,65·Qf^-0,67;
    - lâmina y/D ≤ 0,75;
    - recobrimento de 0,90 m;
    - PV a cada 80 m no máximo;
    - tubo de queda a partir de 0,50 m.
- **Drenagem (`drenagem.ts`).**
  - Método racional, com a chuva de Salvador (SGB/CPRM 2015; confere 120,3 mm/h para T = 10 anos e t = 10 min).
  - C pelo tamanho do lote, 0,90 na via e 0,25 na área verde.
  - Sarjeta por Izzard, com faixa alagada de até 2 m.
  - Bocas de lobo em três lugares: onde a sarjeta esgota, antes do cruzamento carregado e no ponto baixo.
  - Galerias:
    - Ø400 no mínimo, lâmina ≤ 0,85, velocidade de 0,75 a 6 m/s;
    - PV a cada 60 m no máximo, recobrimento de 1 m.
  - Emissário até a divisa mais baixa, ou até o rio quando a gleba tem um.
- **Energia e iluminação (`eletrica.ts`, Neoenergia DIS-NOR-012 rev. 08).**
  - Postes no passeio e na divisa de lotes, com vão de 35 m. Um lado só nas vias de até 20 m: o lado com mais lotes ou, no empate, a face norte/oeste.
  - Demanda da Tab. 17 (tipo A/B/C, decrescente com o número de unidades) × 1,28.
  - Transformadores de 45, 75 e 112,5 kVA no centro de carga, escolhidos por k-medoides no grafo dos postes, com três limites verificados:
    - a carga da Tab. 19;
    - o circuito até 200 m (220/127 V) ou 500 m (380/220 V);
    - a queda de tensão até 3,5%, calculada vão a vão (multiplexado 70 ou 120 mm²).
  - Média tensão compacta da entrada na estrada até cada transformador.
  - Iluminação: LED no poste, com a potência escolhida pelo método dos lúmens para a classe V5 (ou V4).

## Parâmetros

`infra/parametros.ts` guarda os parâmetros, com a fonte de cada número. Os que aparecem na tela são:

- habitantes por lote;
- consumo per capita;
- raio do hidrante;
- destino do esgoto;
- período de retorno;
- tensão da Coelba;
- padrão das casas;
- classe da iluminação.

Os demais (K1, K2, C, recobrimentos, vão etc.) estão no código e no memorial.

## A confirmar por empreendimento

Ninguém publica estes valores, por isso o memorial avisa que devem ser conferidos:

- **Embasa:** per capita, ocupação por lote e padrão de ligação. Vêm da carta de viabilidade de cada empreendimento.
- **Coelba:** tensão secundária do município (220/127 ou 380/220 V).
- **Corpo de Bombeiros da Bahia:** exigência de hidrante, que pode pedir rede DN 150.
- **Prefeitura:** período de retorno da drenagem.

## Fontes da pesquisa (30/10/2026)

- **Energia:**
  - Neoenergia DIS-NOR-012 rev. 08 e DIS-NOR-030 rev. 04;
  - REN ANEEL 1.000/2021.
- **Lei 6.766/79:** art. 2º §5º, art. 9º e art. 18.
- **Água e esgoto:**
  - UFPR TH028 (rede e reservatórios);
  - DAE Jundiaí (normas de água 2022, esgoto NT-005 e drenagem 2025);
  - DAE Bauru (caderno de normas 2010);
  - Sanepar (MPHS 2025 e MPS 11.3);
  - Saneago IT00.0723;
  - SAMAE Caxias NI-100-01.
- **Chuva:** SGB/CPRM, equação IDF de Salvador (Furtunato et al. 2015).
- **Iluminação:** tabelas da NBR 5101 citadas em memorial municipal, e Rioluz NPI R07.
- **Hidrantes:** GO NT 34 e AGR-GO (NBR 12218, item 5.3.1).

## Testes

`tests/infra.test.mjs` confere as redes:

- **Água:** continuidade em cada nó, perda de Hazen-Williams, pressão mínima, volume do reservatório e cobertura dos hidrantes.
- **Esgoto:** recobrimento, declividade mínima, lâmina, tensão trativa, rede em árvore, vazão no lançamento e elevatória.
- **Drenagem:** chuva de Salvador, lâmina da galeria, recobrimento, ramais curtos e vazão de lançamento.
- **Energia:** carga e queda dos transformadores, alcance, média tensão chegando a todos, ramais até 40 m e iluminação na classe.

Também verifica a maquete (postes do projeto, fios, tampas, árvores fora dos fios e reservatório fora do prédio) e as saídas (planilhas, quantitativos com 4% de sobra nos condutores, memorial, DXF, PDF de 4 folhas e locação).
