---
{
  "titulo": "Como medir área de terreno pelo celular: quando serve e quando não serve",
  "seoTitulo": "Medir área de terreno pelo celular: o que dá para fazer | Vertces",
  "descricao": "Medir área de terreno pelo celular serve para croqui, orçamento e CAR. Veja os modos Caminhar e Marcar ponto, a precisão real e a diferença para o GNSS RTK.",
  "slug": "medir-area-de-terreno-pelo-celular",
  "data": "2026-11-07",
  "atualizado": "2026-11-07",
  "categoria": "funcionalidades",
  "palavraChave": "medir área de terreno pelo celular",
  "palavrasRelacionadas": ["app para medir terreno", "calcular área pelo gps do celular", "precisão gps celular", "medir hectare pelo celular", "croqui do imóvel rural", "gps celular serve para sigef"],
  "resumo": "Dá para medir a área de um terreno pelo celular caminhando o perímetro ou marcando os cantos com o GPS do aparelho. A precisão fica na faixa de 3 a 10 m, o que serve para croqui, orçamento e CAR, mas não para georreferenciamento no SIGEF, que exige receptor GNSS geodésico.",
  "faq": [
    { "p": "Preciso de internet no campo para medir pelo celular?", "r": "O GPS do aparelho funciona sem internet, mas o mapa de satélite precisa de rede para carregar. No Vertces, cada vértice é gravado na hora no aparelho e a medição sobe sozinha para a conta quando a rede volta." },
    { "p": "Quantos hectares dá para medir caminhando?", "r": "Não há limite de área na medição. O limite prático é a bateria e o tempo de caminhada. O sistema mantém a tela acordada enquanto mede, quando o aparelho permite." },
    { "p": "A medição do celular pode ir no memorial descritivo?", "r": "Não para o memorial do georreferenciamento. O memorial que vai ao SIGEF e ao cartório sai de levantamento com receptor GNSS e técnico credenciado no INCRA. A medição do celular serve para conversa, orçamento e CAR." },
    { "p": "Por que a área muda um pouco quando meço duas vezes?", "r": "Porque cada leitura do GPS do celular tem erro de alguns metros, que varia com o céu aberto, as árvores e o aparelho. Em área pequena, esse erro pesa mais em porcentagem do que em área grande." },
    { "p": "Dá para medir no computador, sem GPS?", "r": "Dá. Sem GPS, a mesma tela deixa colar a coordenada ou o link do Google Maps e desenhar o contorno clicando nos cantos sobre a imagem de satélite." }
  ],
  "fontes": [
    { "titulo": "INCRA: Certificação de imóveis rurais (SIGEF, profissional credenciado)", "url": "https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/certificacao-imoveis" },
    { "titulo": "Cadastro Ambiental Rural (CAR), portal do gov.br", "url": "https://www.gov.br/car/pt-br" }
  ]
}
---

Para medir área de terreno pelo celular, você caminha o perímetro ou para em cada canto e deixa o GPS do aparelho registrar os vértices; o aplicativo fecha o polígono e calcula a área. A precisão do GPS de celular fica, em geral, entre 3 e 10 m. Isso basta para um croqui, um orçamento ou o CAR, mas não para o georreferenciamento certificado no SIGEF.

Medir pelo celular é uma estimativa de campo: rápida, sem equipamento, boa para decidir. Não é levantamento topográfico.

## Para que serve a medição pelo celular?

Ela serve quando o que você precisa é uma ideia boa da área e do formato, não a coordenada oficial do marco.

| Uso | Celular serve? | Por quê |
|---|---|---|
| Croqui para a primeira visita | Sim | Mostra formato, acesso e confrontações aproximadas |
| Orçamento de georreferenciamento | Sim | Área e perímetro na ordem de grandeza certa para dimensionar o campo |
| CAR | Sim, com cuidado | O CAR é declaratório e feito sobre imagem; o contorno precisa ser coerente com ela |
| Conferir se a área da escritura bate | Como triagem | Uma diferença grande acende o alerta; uma pequena não prova nada |
| Georreferenciamento no SIGEF | Não | Exige receptor GNSS, precisão de decímetros e técnico credenciado |
| Locação de obra ou de marco | Não | O erro de metros é maior que a tolerância da obra |

Para o CAR, depois de medir, a área ainda passa pelas camadas de reserva legal, APP e vegetação; veja [como fazer o CAR em shapefile para o SICAR](/blog/car-shapefile-sicar-reserva-legal-app/).

## Qual a precisão do GPS do celular?

A precisão do celular fica na faixa de 3 a 10 m na maior parte das situações de campo. O aparelho informa uma estimativa a cada leitura, e ela muda o tempo todo.

O que piora a leitura:

- **mata fechada e copa de árvore** sobre a cerca;
- **encosta e vale fundo**, que escondem parte do céu;
- **construção e galpão** por perto, que refletem o sinal;
- **aparelho no bolso** ou dentro do carro;
- **poucos segundos parado** no ponto.

O que ajuda: céu aberto, aparelho na mão, alguns segundos parado em cada canto e a média de várias leituras. Mesmo assim, o erro é de metros. Num terreno de 1 ha, um erro de 5 m em cada vértice pode mudar a área em centenas de metros quadrados, ou mais, se os erros puxarem todos para o mesmo lado.

## Qual a diferença para o GNSS RTK?

A diferença é de ordem de grandeza. O receptor GNSS geodésico com correção RTK (ou com pós-processamento) chega a centímetros. O celular, a metros.

O RTK trabalha com uma base (ou rede de correção) e um receptor móvel. A base manda correções em tempo real e o móvel resolve a posição relativa a ela. O celular, na maioria dos aparelhos, usa a posição autônoma, sem base, com uma antena pequena.

Para o SIGEF, a [precisão posicional](/blog/precisao-posicional-georreferenciamento/) exigida é de 0,50 m em limite artificial (cerca, muro), pela 3ª edição da Norma Técnica do INCRA. O celular não chega lá. Por isso a certificação passa pelo receptor GNSS e pelo profissional credenciado, e o arquivo que sai dele é que entra no fluxo de [conversão do TXT do GNSS](/blog/txt-receptor-gnss-para-sigef/).

## Caminhar ou marcar os cantos?

Os dois modos resolvem situações diferentes. Caminhar é bom para contorno irregular; marcar ponto é melhor para cantos de cerca.

- **Caminhar.** Você anda pela divisa e o sistema põe um vértice sozinho a cada distância (5 m por padrão) ou quando a direção muda mais que um ângulo (15° por padrão), que é o canto da cerca. Rápido, mas gera muitos vértices.
- **Marcar ponto.** Você para no canto, aperta o botão e o aparelho junta as leituras por alguns segundos (5 s por padrão) para tirar a média. A tela mostra a precisão do ponto. Se ela for pior que o limite (8 m por padrão), o sistema pergunta se marca assim mesmo.

Na prática, dá para misturar: caminhar a beira do rio e marcar os cantos da cerca reta.

## Como evitar erro na medição?

Quatro cuidados resolvem a maior parte dos problemas.

1. **Espere o GPS firmar** antes do primeiro vértice. A primeira leitura costuma ser a pior.
2. **Pare nos cantos.** Mesmo caminhando, alguns segundos parado no canto melhoram o vértice que define a área.
3. **Confira o contorno no satélite.** Se a linha atravessa a estrada ou entra no vizinho, um vértice saiu ruim.
4. **Feche a área no ponto de partida** e confira se o contorno não se cruza. Polígono cruzado dá área errada.

## Como fazer no Vertces

**Medir no campo** fica em Ferramentas, no Início, com o selo "GPS do celular". Ele não abre serviço e foi pensado para o celular.

1. **Abra Medir no campo** e toque em **Começar a medir**. O mapa de satélite abre com o ponto azul do GPS e o círculo de precisão.
2. **Escolha o modo.** **Caminhar** põe vértices sozinho; **Marcar ponto aqui** junta leituras e mostra a precisão, por exemplo "±2,8 m". A cor ajuda: verde até 3 m, âmbar até 8 m, vermelho acima.
3. **Acompanhe ao vivo.** Área, perímetro e número de vértices aparecem enquanto você anda, com **Desfazer** e **Pausar** à mão. A tela não apaga enquanto mede, quando o aparelho permite.
4. **Feche a área.** O sistema liga o último vértice ao primeiro e avisa se o contorno se cruza. Depois do Caminhar, **Limpar vértices em linha reta** tira os vértices que estão dentro do ruído do GPS ao longo da cerca reta; os pontos marcados de propósito nunca saem, e a tela mostra o antes e o depois.
5. **Use a medição.** **Criar serviço de CAR com esta área** abre o CAR já com o perímetro; **Consultar** leva a área para a análise de restrições, CAR e SIGEF; **Baixar** gera KML, KMZ, DXF, pacote CAD, GPX, SHP, GeoJSON, CSV ou TXT para a coletora, no próprio aparelho.

Nada se perde. Cada vértice é gravado na hora no aparelho. Se a página fechar, ao voltar o sistema oferece continuar a medição. Com internet, ela sobe para a conta da empresa e aparece em **Medições salvas**, no computador do escritório.

A tela traz um aviso fixo: "GPS do celular: ±3 a 10 m. Serve para croqui, orçamento e CAR, não para georreferenciamento SIGEF." No computador, sem GPS, você cola a coordenada ou o link do Google Maps e desenha o contorno clicando nos cantos. O fundo também pode trocar para [imagens de satélite antigas, por data](/blog/imagem-de-satelite-antiga-por-data/).

## O que fazer depois da medição?

A medição do celular é o começo da conversa, não a entrega. Com a área e o formato, você orça o campo, verifica restrições e decide o tipo de serviço.

Se o imóvel vai ao SIGEF, o próximo passo é o levantamento com receptor GNSS. Se o caso é só de cadastro ambiental, a medição pode seguir para o CAR. E, se o cliente quer saber o que já existe declarado ou certificado naquele lugar, [consulte o imóvel pelo código do CAR ou pela coordenada](/blog/consultar-imovel-rural-car-sigef/) antes de ir a campo.
