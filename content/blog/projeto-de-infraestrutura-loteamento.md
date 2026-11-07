---
{
  "titulo": "Projeto de infraestrutura de loteamento: água, esgoto, drenagem e energia",
  "seoTitulo": "Projeto de infraestrutura de loteamento | Vertces",
  "descricao": "Projeto de infraestrutura de loteamento: o que a Lei 6.766 exige, como se dimensiona água, esgoto, drenagem, energia e iluminação, e o que conferir.",
  "slug": "projeto-de-infraestrutura-loteamento",
  "data": "2026-11-07",
  "atualizado": "2026-11-07",
  "categoria": "funcionalidades",
  "palavraChave": "projeto de infraestrutura de loteamento",
  "palavrasRelacionadas": ["infraestrutura básica loteamento lei 6766", "dimensionamento rede de água loteamento", "projeto de esgoto loteamento nbr 9649", "drenagem pluvial método racional loteamento", "projeto elétrico loteamento", "memorial de cálculo infraestrutura"],
  "resumo": "O projeto de infraestrutura de loteamento dimensiona as redes que a Lei 6.766/79 chama de infraestrutura básica: escoamento das águas pluviais, iluminação pública, esgotamento sanitário, água potável, energia elétrica e vias. No Vertces, as redes de água, esgoto, drenagem, energia e iluminação são calculadas a partir do traçado e do relevo do loteamento e saem em pranchas PDF, memorial de cálculo, planilhas, quantitativos e DXF, para conferir com concessionária, prefeitura e bombeiros.",
  "faq": [
    { "p": "Dá para aprovar o projeto de rede direto com o arquivo gerado?", "r": "Não conte com isso. O que sai é um anteprojeto calculado com critérios de norma e parâmetros de referência. A concessionária de água, a de energia, a prefeitura e o Corpo de Bombeiros têm exigências próprias, e o responsável técnico revisa e assina o projeto final." },
    { "p": "Se eu mudar uma rua, preciso refazer as redes?", "r": "No Vertces, não. As redes não são gravadas: o sistema guarda só os parâmetros e recalcula água, esgoto, drenagem e energia a cada mudança no traçado, um instante depois de você soltar o arraste." },
    { "p": "Os parâmetros servem para qualquer estado?", "r": "Os de referência foram montados com base na Bahia: Embasa para água, Coelba e a norma da Neoenergia para energia e a chuva de Salvador para drenagem. Em outro estado, ajuste os parâmetros da tela e confira os demais com a concessionária local." },
    { "p": "Loteamento de interesse social tem infraestrutura menor?", "r": "Pode ter. O art. 2º, §6º, da Lei 6.766 prevê uma infraestrutura mínima para zonas habitacionais de interesse social: vias, escoamento das águas pluviais, água potável e soluções para esgoto e energia domiciliar." },
    { "p": "O DXF das redes abre no CAD do escritório?", "r": "Sim. O DXF sai com as redes separadas em camadas, para você detalhar, cotar ou juntar ao projeto urbanístico no programa que já usa." }
  ],
  "fontes": [
    { "titulo": "Lei nº 6.766/1979 (parcelamento do solo urbano), art. 2º §5º, art. 9º e art. 18", "url": "https://www.planalto.gov.br/ccivil_03/leis/l6766.htm" },
    { "titulo": "Lei nº 11.445/2007 (saneamento básico), art. 3º", "url": "https://www.planalto.gov.br/ccivil_03/_ato2007-2010/2007/lei/l11445.htm" }
  ]
}
---

O projeto de infraestrutura de loteamento é o conjunto de projetos das redes que atendem os lotes: água, esgoto, drenagem pluvial, energia e iluminação pública, além das vias. A Lei 6.766/79 chama esse conjunto de infraestrutura básica e exige que o loteador execute as obras dentro de um cronograma aprovado pela prefeitura. Cada rede é dimensionada pela sua norma, a partir do traçado das ruas, do número de lotes e do relevo.

Infraestrutura básica, no texto do art. 2º, §5º, é formada pelos equipamentos de escoamento das águas pluviais, iluminação pública, esgotamento sanitário, abastecimento de água potável, energia elétrica pública e domiciliar e vias de circulação. Sem esses projetos, o loteamento não sai do papel na prefeitura.

## O que a Lei 6.766 exige de infraestrutura?

A lei exige as seis redes do §5º e um cronograma de obras com garantia. O art. 9º manda apresentar à prefeitura o projeto com desenhos, memorial descritivo e cronograma de execução das obras com duração máxima de quatro anos. No registro, o art. 18, V, pede o comprovante de que as obras foram verificadas ou a aprovação desse cronograma, prorrogável por mais quatro anos, com instrumento de garantia.

Dois detalhes que costumam pegar o projetista:

- **Interesse social.** Em zona habitacional de interesse social, o §6º do art. 2º admite uma infraestrutura mínima: vias, escoamento pluvial, água potável e soluções para esgoto e energia domiciliar.
- **Áreas públicas.** O reservatório, a estação de tratamento ou a elevatória de esgoto ocupam terreno. Esse terreno precisa estar previsto no projeto urbanístico, e as áreas públicas passam ao domínio do município com o registro (art. 22).

Para o desenho urbanístico em si (quadras, lotes, ruas e percentuais de áreas públicas), veja [software para projeto de loteamento pela Lei 6.766](/blog/software-loteamento-lei-6766/).

## Como se dimensiona a rede de água?

A rede de água é dimensionada pela demanda dos lotes e pela perda de carga nos tubos, de modo que todo lote receba pressão mínima. A referência é a NBR 12218. O cálculo segue esta ordem:

1. **Demanda.** Habitantes por lote vezes consumo per capita, com os coeficientes do dia e da hora de maior consumo (K1 e K2).
2. **Distribuição.** A vazão de cada rua acompanha o número de lotes ligados a ela.
3. **Resolução da malha.** Em rede malhada, a água chega por mais de um caminho, e a vazão em cada trecho só sai por um método iterativo, como o usado no EPANET.
4. **Diâmetros.** Os tubos começam no menor diâmetro e sobem onde a perda passa do limite adotado.
5. **Reservatório.** Fica no ponto público mais alto, com nível suficiente para o ponto crítico da rede e volume proporcional ao dia de maior consumo. Se o nível precisa ficar acima do chão, vira torre.
6. **Pressões e peças.** Pressão estática alta pede válvula redutora na zona baixa; registros nas derivações, descargas nos pontos baixos e ventosas nos altos.
7. **Hidrantes.** Cobrem os lotes dentro de um raio definido, com diâmetro maior no caminho até eles.

O número de habitantes por lote e o per capita vêm, na prática, da carta de viabilidade da concessionária para aquele empreendimento. Não há tabela pública que sirva para todo caso.

## Como se dimensiona o esgoto?

O esgoto é uma rede em árvore, por gravidade, que leva a vazão de cada lote até o ponto mais baixo, onde fica a estação de tratamento ou a ligação com a rede pública. A referência é a NBR 9649. Os critérios que mandam no desenho são:

- **Vazão mínima** por trecho, para o cálculo não sair com tubo vazio.
- **Declividade mínima** pela tensão trativa, para o tubo se limpar sozinho, e declividade máxima para não haver velocidade excessiva.
- **Lâmina** de no máximo 75% do diâmetro.
- **Recobrimento** mínimo sobre o tubo e poço de visita em distância máxima entre si.
- **Tubo de queda** quando a diferença de cota no poço passa do limite.

Quando o destino é a rede pública e o ponto baixo do loteamento fica abaixo dela, a gravidade não resolve: entra uma estação elevatória com linha de recalque. Rua que fica fora do caminho natural da água termina em ponta seca.

## Como se dimensiona a drenagem pluvial?

A drenagem é calculada pelo método racional: vazão igual ao coeficiente de escoamento vezes a intensidade da chuva vezes a área contribuinte. A intensidade sai da curva de chuva (IDF) da região, para o período de retorno que a prefeitura adota.

Na rua, a água corre primeiro pela sarjeta. Quando a sarjeta enche além da faixa alagada aceitável, entra uma boca de lobo. Os pontos clássicos de boca de lobo são três: onde a sarjeta esgota, antes de um cruzamento carregado e no ponto baixo. Das bocas, a água entra nas galerias, que têm diâmetro mínimo, limite de lâmina, faixa de velocidade e poços de visita. O emissário leva tudo até a divisa mais baixa ou até o curso d'água.

O coeficiente de escoamento muda com o uso: a via impermeável escoa quase tudo, a área verde absorve boa parte, e o lote fica no meio, conforme o tamanho.

## Como se dimensiona energia e iluminação?

A rede de energia é dimensionada pela demanda dos lotes e pela queda de tensão até o último consumidor, seguindo a norma de distribuição da concessionária. Os passos são:

| Etapa | O que se decide | O que limita |
|---|---|---|
| Postes | Posição no passeio, na divisa de lotes, e vão entre eles | Norma da distribuidora, lado das árvores |
| Demanda | Carga por lote conforme o padrão das casas | Tabelas da norma da concessionária |
| Transformadores | Potência e posição no centro de carga | Carga máxima, alcance do circuito, queda de tensão |
| Média tensão | Caminho da entrada até cada transformador | Traçado das ruas |
| Iluminação | Potência da luminária por classe da via | Iluminância exigida para a classe |

A tensão secundária (220/127 V ou 380/220 V) muda de município para município e muda o alcance do circuito. Por isso ela é parâmetro, e não constante.

## Como fazer no Vertces

No Vertces, as redes são geradas a partir do loteamento que você já desenhou na prancheta. Elas acompanham o projeto: mexeu numa rua, as redes são recalculadas.

1. **Abra o loteamento na prancheta (Projeto).** O traçado pode ter vindo das propostas automáticas ou de um [loteamento pronto importado do CAD](/blog/memorial-descritivo-de-lote-loteamento/).
2. **Clique em Redes**, na barra da esquerda. O painel liga e desliga cada rede (água, esgoto, drenagem, energia e iluminação) e mostra os números principais.
3. **Ajuste os parâmetros da tela:** habitantes por lote, consumo per capita, raio do hidrante, destino do esgoto (estação própria ou rede pública), período de retorno da chuva, tensão da distribuidora, padrão das casas e classe da iluminação.
4. **Confira peça por peça.** Passe o mouse num tubo, num poço de visita, num poste ou num transformador para ver o cálculo daquela peça.
5. **Veja na maquete.** Na [maquete 3D do loteamento](/blog/maquete-3d-loteamento/), a camada Redes mostra postes, fios, hidrantes, tampas de PV e bocas de lobo; o modo Infraestrutura pinta as redes enterradas, como raio-x.
6. **Baixe nas Entregas**, seção Projetos de infraestrutura: pranchas em PDF (4 folhas: água, esgoto, drenagem, energia e iluminação), memorial descritivo e de cálculo em DOCX, planilhas de dimensionamento trecho a trecho e quantitativos (ZIP com CSV) e DXF das redes em camadas.
7. **Mande para o campo.** Na locação, dá para incluir PVs, bocas de lobo, postes, hidrantes e reservatório no arquivo da coletora.

Os critérios usados no cálculo, resumidos:

- **Água:** NBR 12218, rede malhada resolvida pelo gradiente global (o algoritmo do EPANET), perda de carga por Hazen-Williams.
- **Esgoto:** NBR 9649, por gravidade, com elevatória quando necessário.
- **Drenagem:** método racional, sarjeta por Izzard, bocas de lobo e galerias.
- **Energia e iluminação:** norma DIS-NOR-012 da Neoenergia, transformadores no centro de carga e LED pelo método dos lúmens.

O relevo vem do modelo digital de elevação, calibrado pelas cotas do levantamento. Ele também é a base das [curvas de nível do imóvel](/blog/curvas-de-nivel-do-imovel-rural/) e do [cálculo de corte e aterro](/blog/terraplanagem-calculo-corte-e-aterro/).

## O que conferir antes de protocolar?

Confira tudo o que depende do órgão, porque nenhum desses valores é publicado de forma única. O memorial gerado já traz esse aviso.

Os parâmetros de referência do sistema foram montados para a Bahia: Embasa para água, Coelba e a norma da Neoenergia para energia e a curva de chuva de Salvador para drenagem. Em outro estado, ou mesmo em outro município baiano, eles são ponto de partida. Antes de levar o projeto adiante:

- **Concessionária de água:** per capita, ocupação por lote e padrão de ligação, que vêm da carta de viabilidade.
- **Distribuidora de energia:** tensão secundária do município e padrão de rede.
- **Corpo de Bombeiros:** exigência de hidrante, que pode pedir rede de diâmetro maior.
- **Prefeitura:** período de retorno da drenagem e exigências do código local.

O Vertces calcula e entrega um anteprojeto consistente e rastreável, com a fonte de cada número no memorial. Quem aprova é a concessionária, a prefeitura e o Corpo de Bombeiros, e quem assina é o responsável técnico com CREA ou CAU. Se quiser ver as redes num loteamento seu, [agende uma demonstração](/#contato).
