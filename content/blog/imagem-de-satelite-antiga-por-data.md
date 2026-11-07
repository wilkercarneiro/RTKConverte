---
{
  "titulo": "Imagem de satélite antiga do imóvel: como ver o histórico por data",
  "seoTitulo": "Imagem de satélite antiga: histórico por data do imóvel | Vertces",
  "descricao": "Imagem de satélite antiga do imóvel para posse, divisa, abertura de área e CAR: de onde vem o histórico, o limite de 2014 e como comparar duas datas.",
  "slug": "imagem-de-satelite-antiga-por-data",
  "data": "2026-11-07",
  "atualizado": "2026-11-07",
  "categoria": "funcionalidades",
  "palavraChave": "imagem de satélite antiga",
  "palavrasRelacionadas": ["histórico de imagens de satélite do imóvel", "imagem de satélite por data", "área consolidada 22 de julho de 2008", "prova de posse imagem de satélite", "comparar imagens de satélite", "esri wayback"],
  "resumo": "A imagem de satélite antiga mostra como o imóvel estava em datas passadas e ajuda a provar posse, a conferir divisa e a datar a abertura de uma área. O Vertces usa o acervo Esri World Imagery Wayback, com versões publicadas desde 2014, mostra só as datas em que a foto mudou naquele lugar e compara duas datas com uma cortina.",
  "faq": [
    { "p": "Tem imagem de satélite de 2008 do meu imóvel?", "r": "Depende do lugar. O acervo da Esri começa nas versões de 2014, mas algumas fotos são mais antigas que a versão em que aparecem. O Vertces confere se há foto anterior a 22/07/2008 no centro da área; se não houver, aponta as imagens Landsat do Google Earth Timelapse, de 1984 em diante, em resolução bem menor." },
    { "p": "A imagem antiga prova a posse sozinha?", "r": "Não. Ela mostra ocupação, cerca, roça ou construção numa data, e entra como um elemento entre outros: testemunhas, documentos, contas, declarações. Quem avalia a prova é o juiz ou o registrador." },
    { "p": "Por que a mesma área aparece com a mesma foto em vários anos?", "r": "Porque o mapa base é atualizado por partes. Num lugar pode passar anos sem foto nova, mesmo com o acervo publicando versões. Por isso o sistema esconde as versões repetidas e mostra só as mudanças." },
    { "p": "Posso usar a imagem antiga no laudo ou no CAR?", "r": "Pode, citando a fonte e a data. O Vertces baixa um PNG da vista com a data e a fonte no rodapé e copia o texto da fonte para colar no laudo, no memorial ou na declaração do CAR." }
  ],
  "fontes": [
    { "titulo": "Lei nº 12.651/2012 (Código Florestal), art. 3º, IV: área rural consolidada antes de 22/07/2008", "url": "https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2012/lei/l12651.htm" },
    { "titulo": "Cadastro Ambiental Rural (CAR), portal do gov.br", "url": "https://www.gov.br/car/pt-br" }
  ]
}
---

Imagem de satélite antiga é a foto aérea ou de satélite de uma data passada, usada para ver como o imóvel estava antes: se havia cerca, roça, pasto, casa ou mata. O jeito mais prático de ter o histórico de um lugar é um acervo que guarda as versões antigas do mapa base. O Vertces usa o Esri World Imagery Wayback, com versões publicadas a partir de 2014, e mostra só as datas em que a foto daquele lugar mudou.

Ver a mesma área em duas datas responde perguntas que a imagem de hoje não responde: quando a área foi aberta, desde quando a cerca está ali, se a construção é recente.

## Para que serve o histórico de imagens do imóvel?

Serve para datar o que está no chão. Quatro usos aparecem o tempo todo no escritório:

1. **Posse e usucapião.** A imagem mostra ocupação contínua: roça, curral, casa, cerca. É um elemento de prova entre outros. Veja [georreferenciamento para usucapião e posse](/blog/georreferenciamento-usucapiao-posse/).
2. **Conflito de divisa.** Uma cerca que aparece numa linha em 2015 e em outra em 2022 conta uma história. A imagem não decide a divisa, mas orienta a conversa com o confrontante.
3. **Abertura de área.** Quando a vegetação foi suprimida, se antes ou depois de uma data, muda a situação ambiental.
4. **CAR e área consolidada.** O Código Florestal chama de área rural consolidada a ocupação humana preexistente a 22 de julho de 2008 (art. 3º, IV, da Lei 12.651/2012). Mostrar a área aberta antes dessa data é a pergunta central.

Em todos, a imagem é indício técnico. Ela não substitui documento, testemunha nem vistoria.

## De onde vêm as imagens antigas?

As imagens vêm do Esri World Imagery Wayback, o acervo das versões antigas do mapa base de satélite da Esri. Cada versão é uma fotografia do mapa base inteiro numa data de publicação.

O acervo tem cerca de 200 versões, desde fevereiro de 2014. Só que, num lugar específico, quase todas repetem a mesma foto: o mapa base é atualizado por partes, e uma fazenda pode passar anos sem foto nova. Mostrar as 200 seria inútil.

Por isso o sistema faz a busca pelo lugar: para o centro da área, ele descobre de qual versão veio a foto em cada data e junta as versões que trazem a mesma imagem. O que sobra é uma lista curta de fotos realmente diferentes.

## Data da versão ou data da foto?

São datas diferentes, e confundir as duas é o erro mais comum. A data da versão é quando a Esri publicou o mapa base. A data da foto é quando o satélite ou o avião passou.

| Data | O que significa | Quando usar |
|---|---|---|
| Data da captura | Dia em que a foto foi tirada naquele ponto | Sempre que existir: é a que prova algo |
| Data da versão | Dia em que o mapa base foi publicado | Só como limite: a foto é dessa data ou anterior |

Quando o serviço de metadados da Esri informa, o sistema mostra a data da captura, com o fornecedor e a resolução, no formato "Imagem de 17/06/2018 · Maxar · 0,5 m". Quando não informa, mostra a data da versão e deixa claro que a data exata da foto não foi confirmada.

Uma consequência: uma versão de 2014 pode trazer uma foto de anos antes. Por isso o limite de 2014 é da publicação, não necessariamente da foto.

## E se eu precisar de antes de 2014?

O acervo da Esri não garante nada antes de 2014, e o sistema não promete imagem de 2008. Ele confere, no centro da área, se alguma foto do acervo tem data de captura anterior a 22/07/2008.

- **Se tiver,** avisa que há foto anterior ao marco do CAR e qual é.
- **Se a Esri não informar a data exata** de alguma foto, diz que não dá para afirmar.
- **Se não tiver,** oferece o link para as imagens Landsat do Google Earth Timelapse, de 1984 até hoje, já no ponto do imóvel. A resolução do Landsat é bem menor, mas mostra mata, pasto e lavoura em escala de talhão.

## Como comparar duas datas?

O jeito mais claro é a cortina: duas imagens sobrepostas no mesmo mapa, com uma divisa que você arrasta para um lado e para o outro. A cerca, a estrada ou a borda da mata mudam de lugar bem na linha da cortina.

Três cuidados na comparação:

- **Mesma escala e mesmo enquadramento.** A cortina resolve isso, porque as duas datas estão no mesmo mapa.
- **Estação do ano.** Pasto seco em setembro e verde em março parecem coisas diferentes e não são.
- **Deslocamento entre fotos.** Fotos de satélites diferentes podem ter alguns metros de diferença de posição. Para divisa fina, vale o levantamento GNSS, não a imagem.

## Como fazer no Vertces

O seletor de imagem por data aparece como um controle pequeno no mapa: "Imagem: atual ▾". Ele está no mapa interativo do serviço (o mesmo das parcelas do SIGEF em volta), em **Consultar imóvel** e em **Medir no campo**.

1. **Abra o mapa da área.** No serviço, na conferência; ou pelas Ferramentas, em Consultar imóvel ou Medir no campo.
2. **Clique em "Imagem: atual ▾".** O sistema abre o acervo e lista as fotos diferentes daquele lugar, com a data da captura quando a Esri informa.
3. **Escolha uma data.** A foto troca por baixo do perímetro do imóvel, que continua desenhado por cima.
4. **Compare.** O botão **Comparar** abre a cortina com "Antes" e "Depois", cada lado com a sua lista de datas.
5. **Veja a evolução.** **Ver a evolução** passa as fotos da mais antiga até hoje, no mapa.
6. **Guarde a prova.** **Baixar PNG** gera a imagem da vista com a data e a fonte no rodapé; **Copiar fonte** copia o texto para colar no laudo, no memorial ou na declaração do CAR.

A atribuição da Esri acompanha a imagem. No mapa do CAR, que é desenhado de outro jeito, o seletor ainda não está ligado; para o CAR, use a imagem pela consulta ou pelo campo e leve a área ao serviço. Os passos do cadastro estão em [como fazer o CAR e o shapefile do SICAR](/blog/car-shapefile-sicar-reserva-legal-app/).

## Quais os limites da imagem antiga?

A imagem antiga mostra o que estava visível, numa data e com uma resolução. Ela não mostra quem ocupava, nem a linha jurídica da divisa.

- **Resolução.** Uma foto de 0,5 m mostra cerca e casa; uma de vários metros, não.
- **Nuvem e sombra** podem esconder justamente o trecho que interessa.
- **Copa de árvore** esconde cerca e construção pequena.
- **Posição.** A foto não tem a precisão de um levantamento GNSS. Para a divisa no SIGEF, valem os vértices medidos e os [vértices certificados do vizinho](/blog/sobreposicao-sigef-como-evitar/).

Use a imagem para contar a história da área e o levantamento para medir. Antes de ir a campo, a [consulta do imóvel pelo código do CAR](/blog/consultar-imovel-rural-car-sigef/) junta, no mesmo mapa, a imagem, o CAR declarado e as parcelas certificadas.
