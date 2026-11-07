---
{
  "titulo": "Como consultar imóvel rural pelo código do CAR, coordenada ou link do mapa",
  "seoTitulo": "Consultar imóvel rural pelo código do CAR e SIGEF | Vertces",
  "descricao": "Consultar imóvel rural pelo código do CAR, por coordenada ou link do Google Maps: CAR declarado, SIGEF certificado, restrições, queimadas, solo e clima.",
  "slug": "consultar-imovel-rural-car-sigef",
  "data": "2026-11-07",
  "atualizado": "2026-11-07",
  "categoria": "funcionalidades",
  "palavraChave": "consultar imóvel rural pelo código do CAR",
  "palavrasRelacionadas": ["consulta car pelo código", "consultar imóvel no sigef", "car declarado e sigef certificado", "consultar imóvel rural por coordenada", "focos de queimada no imóvel", "o que existe neste ponto car sigef"],
  "resumo": "Para consultar um imóvel rural pelo código do CAR, você busca o código na base pública do SICAR e vê o perímetro declarado, a situação e a área. No Vertces, uma caixa só aceita o código do CAR, uma coordenada (decimal, GMS ou UTM) ou o link do Google Maps, mostra o CAR declarado e as parcelas certificadas do SIGEF e analisa restrições, queimadas, bioma, solo e clima, sem gastar crédito.",
  "faq": [
    { "p": "O código do CAR mostra quem é o dono do imóvel?", "r": "Não. A base pública do CAR traz o perímetro, a situação, a área, o município e o tipo do imóvel, não o nome do proprietário. E o próprio Código Florestal diz que o cadastro não é título de propriedade ou posse." },
    { "p": "Posso consultar sem ter o código do CAR?", "r": "Pode. Uma coordenada de um ponto dentro do imóvel, ou o link do Google Maps, basta para achar o CAR e as parcelas do SIGEF que contêm aquele ponto. Também dá para enviar o KML da área ou desenhar no mapa." },
    { "p": "O laudo escrito pela IA pode ir direto para o cliente?", "r": "Revise antes. O laudo é um parecer preliminar escrito só com os dados da consulta, citando a fonte de cada afirmação, e o que uma base não respondeu aparece como pendência. A responsabilidade técnica continua sendo de quem assina." },
    { "p": "A consulta mostra a área embargada pelo nome do embargado?", "r": "Não. Nas camadas de embargo do IBAMA e do ICMBio, o sistema lê número, data, município e área, não nome nem CPF ou CNPJ. O cruzamento é pela geometria." },
    { "p": "Por que a área do CAR e a área calculada podem ser diferentes?", "r": "Porque a área declarada é a que o declarante informou, e a calculada sai do polígono, em UTM no fuso do lugar. Quando as duas diferem, o Vertces mostra as duas." }
  ],
  "fontes": [
    { "titulo": "Lei nº 12.651/2012 (Código Florestal), art. 29: CAR obrigatório e não é título", "url": "https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2012/lei/l12651.htm" },
    { "titulo": "O que é o SICAR (gov.br/car)", "url": "https://www.gov.br/car/pt-br/assuntos/o-que-e-o-sicar" },
    { "titulo": "SIGEF: Sistema de Gestão Fundiária do INCRA", "url": "https://sigef.incra.gov.br/" },
    { "titulo": "INPE: Programa Queimadas", "url": "https://terrabrasilis.dpi.inpe.br/queimadas/portal/" }
  ]
}
---

Para consultar um imóvel rural pelo código do CAR, você procura o código na base pública do SICAR e recebe o perímetro declarado, a situação do cadastro, a área e o município. Sem o código, uma coordenada de um ponto dentro do imóvel ou o link do Google Maps também acham o CAR e as parcelas certificadas do SIGEF naquele lugar. O cuidado é não confundir as duas coisas: CAR é declarado, SIGEF é certificado.

O código do CAR é o número de inscrição no Cadastro Ambiental Rural, no formato UF, código IBGE do município e um identificador, como no recibo de inscrição.

## CAR e SIGEF: qual a diferença?

CAR é declaração ambiental; SIGEF é certificação fundiária. Os dois desenham o imóvel no mapa, mas não têm o mesmo peso.

| | CAR (SICAR) | SIGEF (INCRA) |
|---|---|---|
| O que é | Registro ambiental eletrônico, obrigatório para todo imóvel rural | Certificação dos limites do imóvel georreferenciado |
| Quem desenha | O proprietário ou possuidor, muitas vezes sobre imagem | Profissional credenciado, com levantamento GNSS |
| Valor jurídico do limite | Não é título de propriedade ou posse (art. 29, § 2º, da Lei 12.651/2012) | Garante que os limites não se sobrepõem a outras parcelas certificadas |
| Sobreposição | Comum, e o SICAR aponta | Impede a certificação |
| Situação | A que o SICAR informa, por exemplo "aguardando análise" | Certificada |

Por isso, quando a consulta mostra um CAR sobre o imóvel do seu cliente, a pergunta é "quem declarou e por quê". Quando mostra uma parcela do SIGEF, a pergunta é mais séria: há certificação ali, e o seu perímetro vai ter de respeitá-la. Veja [como evitar sobreposição no SIGEF](/blog/sobreposicao-sigef-como-evitar/).

## O que dá para informar na busca?

Dá para começar por qualquer dado que o cliente tenha na mão. Os mais comuns:

1. **Código do CAR**, do recibo de inscrição, com ou sem os pontos.
2. **Coordenada** de um ponto do imóvel: decimal (-12,6915, -39,1262), GMS (12°41'29"S 39°07'34"W) ou UTM com o fuso (24L 500000 8600000).
3. **Link do Google Maps** que o cliente mandou pelo WhatsApp.
4. **Código de parcela do SIGEF**, quando o imóvel já é certificado.
5. **Arquivo da área**: KML, KMZ, GPX ou GeoJSON.
6. **Desenho no mapa**, quando ninguém tem nada além de "é depois da ponte".

Com coordenada, a busca é pelo ponto: aparecem os imóveis declarados e certificados que contêm aquele ponto. Se nenhum contém, ainda dá para analisar o entorno.

## O que a análise do imóvel mostra?

A análise junta, na mesma tela, o que hoje exige abrir vários portais um por um. Ela se divide em quatro blocos.

**Restrições.** O perímetro é cruzado com nove bases: terras indígenas (FUNAI), unidades de conservação (MMA), assentamentos e territórios quilombolas (INCRA), embargos do IBAMA e do ICMBio, faixa de fronteira (IBGE), áreas militares e sítios arqueológicos (IPHAN). O detalhe de cada tema está em [como consultar restrições do imóvel rural](/blog/analise-de-restricoes-imovel-rural/).

**Vizinhos.** Parcelas certificadas do SIGEF e outros CAR que cruzam a área ou estão a até 100 m. A base de parcelas do sistema é atualizada na hora pelo INCRA quando ele responde.

**Queimadas.** Focos de calor detectados por satélite pelo INPE nos últimos 12 meses, dentro da área e num raio de 1 km. Um mesmo incêndio pode aparecer em mais de um satélite, então foco não é igual a incêndio.

**Ambiente.** Bioma (IBGE) e se o imóvel está na Amazônia Legal, com a reserva legal mínima de referência do Código Florestal; solo provável pelo SoilGrids (modelo global de 250 m, estimativa); chuva de 12 meses e temperatura pelo Open-Meteo (reanálise, não estação); e o município pelo IBGE.

Cada fonte que falha diz que falhou, e o resto segue. Nada disso é certidão: é triagem para orçar, planejar o campo e fazer as perguntas certas.

## Para que serve consultar antes de fechar o serviço?

Serve para orçar com o que existe no chão, e não com o que o cliente lembra. Três situações típicas:

- **Orçamento de georreferenciamento.** Uma parcela certificada encostando muda o trabalho: os vértices do vizinho entram na sua divisa. Uma sobreposição com UC ou terra indígena muda prazo e conversa.
- **Compra de terra.** Antes do sinal, junto com a matrícula e as certidões. Veja [o que conferir para vender ou comprar imóvel rural](/blog/georreferenciamento-para-vender-imovel-rural/).
- **CAR.** Um CAR já declarado sobre a área, por outra pessoa, aparece antes de você fazer o seu.

Um exemplo. O cliente manda pelo WhatsApp o link do Google Maps da Fazenda Santa Luzia e diz que tem "uns 80 hectares". Colado na caixa, o link acha um CAR declarado de 76,4 ha, aguardando análise, e uma parcela certificada do vizinho encostando na divisa leste. A análise mostra o imóvel livre de restrições e dois focos de calor a menos de 1 km no último ano. Com isso, o orçamento já prevê os vértices certificados do vizinho na divisa e a conversa sobre a área começa pelo número declarado, não pelo de memória.

## Como fazer no Vertces

**Consultar imóvel** fica em Ferramentas, no Início, com o selo "Sem crédito". Não precisa abrir serviço.

1. **Cole na caixa** o código do CAR, a coordenada ou o link do Google Maps. A caixa entende sozinha o que é. Em **Outras formas de informar a área**, você envia o arquivo ou desenha no mapa; **Onde estou** usa o GPS do aparelho.
2. **Escolha o imóvel.** A lista e o mapa aparecem juntos, cada imóvel com o selo da fonte ("CAR · declarado", com a situação, ou "SIGEF · certificado"), a área, o município e a data de atualização. Com um imóvel só, ele já vem selecionado.
3. **Clique em Analisar.** Restrições, vizinhos, queimadas e ambiente aparecem em cartões, com uma frase de resumo no topo.
4. **Peça o laudo, se quiser.** **Escrever o laudo** gera um parecer preliminar em cinco seções, escrito por IA só com os dados da consulta e com a fonte de cada afirmação. São até 20 laudos por dia por empresa, sem crédito. Revise antes de enviar.
5. **Leve o resultado adiante.** **Baixar PDF** com tudo, o croqui e as fontes; **Copiar** o resumo para o WhatsApp do cliente, o link da consulta para a equipe ou a lista de confrontantes (parcelas e CAR encostando) para o memorial ou a carta de anuência; **Baixar a área** em KML, SHP, DXF e outros formatos; **Criar serviço de CAR com esta área**.

As consultas ficam em **Consultas recentes**. A área é calculada pelo mesmo motor do resto do sistema, em UTM no fuso do lugar, e a área declarada aparece ao lado quando difere.

## O que a consulta não substitui?

A consulta é uma fotografia das bases públicas naquele momento. Ela não substitui:

- a matrícula atualizada e as certidões;
- o levantamento GNSS, quando o assunto é limite;
- a análise do órgão ambiental sobre o CAR;
- a consulta ao órgão quando a sobreposição é pequena ou está na borda.

Se o próximo passo é medir, comece pelo [croqui com o GPS do celular](/blog/medir-area-de-terreno-pelo-celular/) e confira, no mesmo mapa, a [imagem de satélite antiga por data](/blog/imagem-de-satelite-antiga-por-data/).
