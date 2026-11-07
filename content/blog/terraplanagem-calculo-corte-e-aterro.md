---
{
  "titulo": "Cálculo de corte e aterro: volume, cota de equilíbrio e caminhões",
  "seoTitulo": "Cálculo de corte e aterro: volume e caminhões | Vertces",
  "descricao": "Cálculo de corte e aterro passo a passo: malha e TIN, cota de equilíbrio, taludes 1:1 e 1:1,5, empolamento e número de caminhões, com PDF, DXF e CSV.",
  "slug": "terraplanagem-calculo-corte-e-aterro",
  "data": "2026-11-07",
  "atualizado": "2026-11-07",
  "categoria": "funcionalidades",
  "palavraChave": "cálculo de corte e aterro",
  "palavrasRelacionadas": ["como calcular volume de terraplanagem", "cota de equilíbrio corte e aterro", "empolamento do solo", "quantos caminhões de terra", "talude de corte e aterro", "volume de terra para plataforma"],
  "resumo": "O cálculo de corte e aterro compara o terreno levantado com a plataforma projetada: onde o terreno fica acima, há corte; onde fica abaixo, há aterro. O volume sai da soma de pequenos prismas sobre o modelo do terreno (TIN), mais os taludes da borda. Com o empolamento e a caçamba do caminhão, o volume vira número de viagens.",
  "faq": [
    { "p": "Dá para calcular corte e aterro só com os pontos do perímetro?", "r": "Dá um número, mas ele não serve para orçamento. Sem pontos no miolo, o terreno entre as divisas é uma reta suposta. No Vertces, quando o espaçamento típico entre pontos passa de 40 m, o resultado vem marcado como estimativa grosseira, na tela e no PDF." },
    { "p": "Qual a diferença entre empolamento e compactação?", "r": "Empolamento é o quanto a terra cresce ao ser escavada e solta no caminhão. Compactação é o inverso: quanto de material cortado cada metro cúbico de aterro compactado consome. O primeiro conta viagens; o segundo muda a cota de equilíbrio." },
    { "p": "Talude a prumo, sem inclinação, pode entrar no cálculo?", "r": "Pode, com talude 0, mas isso só faz sentido com muro de arrimo ou contenção. Em solo comum, corte 1:1 e aterro 1:1,5 são os valores usuais de partida, e o projeto geotécnico é que define o definitivo." },
    { "p": "O cálculo de terraplanagem do Vertces gasta crédito?", "r": "Não. A terraplanagem fica no grupo Ferramentas, fora dos serviços, e não abre serviço nem consome crédito. Os projetos ficam gravados na conta da empresa, na lista de projetos recentes." },
    { "p": "Posso fazer a estimativa antes de ir a campo?", "r": "Pode, pelo relevo público (modelo digital de cerca de 30 m). O sistema avisa que é estimativa para a primeira conversa com o cliente; a obra pede o levantamento planialtimétrico." }
  ],
  "fontes": [
    { "titulo": "DNIT 106/2009-ES: Terraplenagem, Cortes, Especificação de serviço", "url": "https://www.gov.br/dnit/pt-br/assuntos/planejamento-e-pesquisa/ipr/coletanea-de-normas/coletanea-de-normas/especificacao-de-servico-es/dnit-106-2009-es" },
    { "titulo": "DNIT 108/2009-ES: Terraplenagem, Aterros, Especificação de serviço", "url": "https://www.gov.br/dnit/pt-br/assuntos/planejamento-e-pesquisa/ipr/coletanea-de-normas/coletanea-de-normas/especificacao-de-servico-es/dnit-108-2009-es" }
  ]
}
---

O cálculo de corte e aterro mede quanto de terra sai e quanto entra para deixar um terreno na cota de projeto. Onde o terreno natural fica acima da plataforma, há corte; onde fica abaixo, há aterro. O volume sai do modelo do terreno feito com os pontos do levantamento, dividido em pequenos prismas, mais o volume dos taludes da borda.

Terraplanagem, aqui, é a obra de movimentar terra para criar uma plataforma: o piso de um galpão, de uma casa, de uma quadra ou de um pátio. A pergunta do cliente quase sempre é a mesma: quanto custa deixar plano e quantos caminhões vão rodar.

## Do que você precisa para calcular?

Você precisa de três coisas: pontos com cota, o contorno da plataforma e a cota (ou a regra para achá-la).

1. **Pontos com cota.** O levantamento planialtimétrico do terreno: nome, E, N e cota de cada ponto. Quanto mais denso no miolo, melhor. Ponto só na cerca não descreve o terreno.
2. **Contorno da plataforma.** O retângulo do galpão, o polígono do pátio, ou a área inteira levantada recuada da borda.
3. **Cota da plataforma.** Fixa (a do projeto arquitetônico ou a da rua) ou a cota de equilíbrio, aquela em que o corte cobre o aterro.

Também entram os taludes (inclinação das bordas) e os fatores do solo: empolamento e compactação.

## Como se calcula o volume de corte e aterro?

O volume é a integral da diferença entre o terreno e o projeto. Na prática, faz-se isso em duas etapas: modelar o terreno e somar prismas.

**Modelar o terreno com TIN.** TIN (rede irregular de triângulos) é a triangulação dos pontos do levantamento. Entre três pontos vizinhos, vale o plano que passa por eles, como no CAD. É assim que se sabe a cota de qualquer lugar entre os pontos medidos.

**Somar prismas numa malha.** Sobre o TIN, monta-se uma malha regular (por exemplo, células de 5 × 5 m). Em cada canto da célula, a altura é terreno menos projeto. Positiva é corte; negativa é aterro. O volume da célula é a área vezes a média das alturas.

Um exemplo. Uma célula de 25 m² tem alturas de +0,8, +0,6, +0,4 e +0,2 m nos cantos. A média é 0,5 m, e o volume de corte da célula é 12,5 m³. Quando uma célula tem cantos positivos e negativos, ela é cortada pela **linha de passagem** (onde corte é zero), e cada parte vai para o seu lado.

A soma de todas as células dá o corte total e o aterro total. A diferença é o **saldo**: sobra de corte vai para bota-fora; falta de material vem de empréstimo.

## O que é a cota de equilíbrio?

Cota de equilíbrio é a cota da plataforma em que o volume de corte iguala o de aterro, sem trazer nem tirar terra do terreno. É a escolha mais barata quando nada obriga outra cota.

Ela se acha por tentativa organizada. Quando a cota sobe, o corte diminui e o aterro aumenta; quando desce, acontece o contrário. Basta testar uma cota no meio do intervalo, ver qual volume é maior e repetir na metade certa (o método da bisseção). Em poucas dezenas de passos a cota fica certa no milímetro.

Se o aterro precisa ser compactado, o equilíbrio muda: cada metro cúbico de aterro pede mais de um metro cúbico de corte. Por isso o fator de compactação entra na conta da cota, e não só no relatório.

A plataforma também pode ter caimento, normalmente de 1% a 2% em pátio e galpão, para a água escorrer. Com caimento, a cota vale no centro e o plano inclina na direção escolhida.

## Como os taludes entram na conta?

Talude é a rampa que liga a borda da plataforma ao terreno natural. Ele tem volume próprio e muda a área ocupada pela obra.

A inclinação se escreve como quantos metros na horizontal para cada metro na vertical:

| Talude | Inclinação usual de partida | Exemplo com 2 m de altura na borda |
|---|---|---|
| Corte | 1:1 | a crista fica a 2 m da borda |
| Aterro | 1:1,5 | o pé fica a 3 m da borda |
| A prumo | 0 | só com muro de arrimo ou contenção |

Nos cantos de fora, o talude vira um quarto de cone. Na borda, a crista (no corte) e o pé (no aterro) marcam onde a obra encosta no terreno. Isso importa para saber se a plataforma cabe no lote: um aterro de 3 m com talude 1:1,5 ocupa 4,5 m além da borda.

Os valores 1:1 e 1:1,5 são pontos de partida para solo comum. O projeto geotécnico define o talude definitivo, e as especificações do DNIT para cortes e aterros tratam da execução.

## Como transformar volume em caminhões?

Volume no chão não é volume no caminhão. A terra escavada se solta e cresce. Esse crescimento é o **empolamento**.

Com empolamento de 25%, 1 m³ cortado vira 1,25 m³ na caçamba. A conta das viagens é:

1. pegue o volume a transportar (o saldo de bota-fora, o empréstimo, ou o corte que vai para o aterro);
2. multiplique por 1 + empolamento;
3. divida pela capacidade da caçamba e arredonde para cima.

Um exemplo. Na plataforma de um galpão na Fazenda Santa Luzia sobram 360 m³ de corte. Com 25% de empolamento, são 450 m³ soltos. Em caçamba de 12 m³, dá 37,5, ou seja, 38 viagens de bota-fora.

Empolamento varia com o material. Argila, areia e rocha se comportam diferente; use o valor que o terraplenador conhece da região.

## Quando o resultado não serve para orçamento?

O cálculo é tão bom quanto os pontos. Três sinais de alerta:

- **Pontos esparsos.** Com espaçamento grande entre pontos, o terreno entre eles é reta suposta. O volume vira ordem de grandeza.
- **Plataforma fora do levantamento.** Se a plataforma ou o talude sai da área com pontos, aquela parte não tem terreno conhecido.
- **Arquivo sem altitude.** Todas as cotas iguais quase sempre são exportação sem a coluna Z, não terreno plano.

Para o levantamento em si, a mesma lógica de leitura vale: veja [como converter o TXT do GNSS](/blog/txt-receptor-gnss-para-sigef/). E, se o terreno ainda não foi a campo, as [curvas de nível do terreno](/blog/curvas-de-nivel-do-imovel-rural/) ajudam a ter uma ideia do desnível.

## Como fazer no Vertces

A terraplanagem fica em **Ferramentas**, no Início, com o selo "Corte e aterro". Ela não abre serviço: é um projeto de obra dentro do imóvel, com a própria lista de projetos recentes.

1. **Envie os pontos.** TXT ou CSV com nome, E, N e cota, em qualquer ordem e separador. O leitor também aceita GSI, XML da coletora e DXF com pontos. Sem levantamento, use **Usar o relevo**: cole a coordenada ou o link do Google Maps (área de 60 × 60 m) ou envie o KML da área. O sistema avisa que é estimativa pelo modelo público de cerca de 30 m.
2. **Defina a plataforma.** Contorno dos pontos (recuado da borda para o talude caber), retângulo arrastado e girado no mapa, ou um KML.
3. **Escolha a cota.** "Equilibrar corte e aterro" é o padrão; ou digite a cota do centro. Se quiser, ponha o caimento em % e a direção de escoamento.
4. **Ajuste taludes e solo.** Corte 1:1 e aterro 1:1,5 vêm por padrão; empolamento de 25% e caçamba de 12 m³ também, todos editáveis, com a compactação.
5. **Leia o resultado ao vivo.** Corte, aterro, saldo (bota-fora ou empréstimo), áreas, caminhões, mapa colorido com corte em vermelho e aterro em azul, isolinhas e linha de passagem, e as seções pelo meio nos dois sentidos. A cada mudança, os números se refazem.
6. **Baixe as saídas.** Relatório em PDF (números, mapa, seções e método), DXF em camadas com polilinhas 3D (pontos, curvas do terreno, plataforma, crista e pé do talude, linha de passagem, corte, aterro, isolinhas e seções) e o CSV da malha.

O terreno é o TIN dos pontos. O volume dentro da plataforma é calculado triângulo a triângulo, e o dos taludes pela malha com corte parcial nas células da borda. Se os pontos estão esparsos, o cartão diz "Estimativa grosseira: poucos pontos" antes de o cliente receber o número.

O projeto grava sozinho na conta. A plataforma não vira um serviço de georreferenciamento com um clique: ela é obra, não área a certificar. Se o mesmo imóvel precisa da planta e do memorial, o caminho é o serviço normal; veja [a planta de georreferenciamento](/blog/planta-georreferenciamento-a1-a3/) e [os formatos de exportação](/blog/exportar-kml-dxf-shapefile-gpx/).
