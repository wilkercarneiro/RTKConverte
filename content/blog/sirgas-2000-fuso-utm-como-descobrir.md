---
{
  "titulo": "Qual é o meu fuso UTM em SIRGAS 2000? Tabela dos fusos 18 a 25 por estado",
  "seoTitulo": "Qual meu fuso UTM SIRGAS 2000? Tabela por estado | Vertces",
  "descricao": "Qual meu fuso UTM SIRGAS 2000: fórmula pela longitude, meridianos centrais dos fusos 18 a 25, estados com mais de um fuso, códigos EPSG e erros comuns.",
  "slug": "sirgas-2000-fuso-utm-como-descobrir",
  "data": "2026-11-06",
  "atualizado": "2026-11-06",
  "categoria": "guias-tecnicos",
  "palavraChave": "qual meu fuso utm sirgas 2000",
  "palavrasRelacionadas": ["fuso utm brasil", "meridiano central fuso 23", "fuso 22 ou 23", "fuso utm por estado", "epsg sirgas 2000 utm", "como calcular fuso utm", "zona utm 24s"],
  "resumo": "O fuso UTM de um ponto sai da longitude: fuso = parte inteira de (longitude + 180) ÷ 6, mais 1. No Brasil continental, os fusos vão do 18 ao 25, com meridianos centrais de 75° O a 33° O, e em SIRGAS 2000 correspondem aos códigos EPSG 31978 a 31985. Vários estados, como Bahia, Minas Gerais, São Paulo e Pará, ficam em dois ou mais fusos, então o fuso depende do imóvel, não da UF.",
  "faq": [
    { "p": "Posso usar um fuso só para o estado inteiro?", "r": "Pode haver convenção interna do escritório, mas o fuso correto de um ponto é o que contém a sua longitude. Em estados que atravessam dois fusos, usar o fuso vizinho distorce mais as distâncias em UTM e, se as coordenadas forem lidas no fuso errado, o imóvel aparece em outro lugar." },
    { "p": "O fuso UTM muda a área que o SIGEF calcula?", "r": "Não. Desde a 3ª edição da Norma Técnica, a área para o INCRA é calculada no Sistema Geodésico Local, a partir das coordenadas geodésicas, e não no plano UTM. O fuso afeta as coordenadas E e N da planta e do memorial, não a área certificada." },
    { "p": "Imóvel cortado pelo meridiano que divide dois fusos: qual uso?", "r": "Escolha um fuso para o imóvel inteiro e declare-o na planta e no memorial, em vez de misturar vértices de fusos diferentes. Na prática, muitos profissionais usam o fuso que contém a maior parte do imóvel." },
    { "p": "SIRGAS 2000 e WGS 84 são a mesma coisa?", "r": "São referenciais diferentes, embora próximos. O IBGE publica orientações próprias para a transformação entre WGS 84 e SIRGAS 2000. Para o georreferenciamento, o referencial oficial é o SIRGAS 2000." },
    { "p": "Ainda posso entregar trabalho em SAD 69?", "r": "Não. O IBGE encerrou o período de transição em 25 de fevereiro de 2015. Desde então, todos os usuários no Brasil devem adotar exclusivamente o SIRGAS 2000, e dados antigos em SAD 69 ou Córrego Alegre precisam ser transformados." }
  ],
  "fontes": [
    { "titulo": "IBGE: Resolução PR nº 01/2015 (término da transição para o SIRGAS2000)", "url": "https://geoftp.ibge.gov.br/metodos_e_outros_documentos_de_referencia/normas/rpr_01_2015_sirgas2000.pdf" },
    { "titulo": "IBGE: Resolução PR nº 01/2005 (adoção do SIRGAS2000)", "url": "https://geoftp.ibge.gov.br/metodos_e_outros_documentos_de_referencia/normas/rpr_01_25fev2005.pdf" },
    { "titulo": "IBGE: API de malhas territoriais (limites das UFs)", "url": "https://servicodados.ibge.gov.br/api/docs/malhas?versao=3" },
    { "titulo": "INCRA: Manual Técnico para Georreferenciamento de Imóveis Rurais, 2ª edição (2022)", "url": "https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/Manual_Tecnico_de_Georreferenciamento_2_Edicao.pdf/@@display-file/file" }
  ]
}
---

O seu fuso UTM sai da longitude do imóvel: fuso = parte inteira de (longitude + 180) ÷ 6, mais 1. Uma fazenda a 44° 30′ O, por exemplo, dá (−44,5 + 180) ÷ 6 = 22,58, parte inteira 22, mais 1: fuso 23, meridiano central 45° O. No Brasil continental os fusos vão do 18 ao 25, e muitos estados ficam em dois ou mais deles, então o fuso é do imóvel, não da UF.

Fuso UTM é cada uma das 60 faixas de 6° de longitude em que a projeção Universal Transversa de Mercator divide a Terra. Cada faixa tem o seu meridiano central, e as coordenadas E (leste) e N (norte) só fazem sentido junto com o número do fuso. SIRGAS 2000 é o referencial geodésico oficial do Brasil: o IBGE o adotou pela Resolução PR 01/2005 e, desde 25 de fevereiro de 2015 (Resolução PR 01/2015), ele é o único sistema a ser usado no país, com o elipsoide GRS80.

## Como calcular o fuso UTM pela longitude?

Pegue a longitude em graus decimais, negativa a oeste de Greenwich, e aplique a fórmula. Passo a passo:

1. **Converta a longitude para graus decimais.** 44° 30′ 00″ O vira −44,5.
2. **Some 180.** −44,5 + 180 = 135,5.
3. **Divida por 6 e fique com a parte inteira.** 135,5 ÷ 6 = 22,58, parte inteira 22.
4. **Some 1.** Fuso 23.
5. **Confira o meridiano central:** MC = 6 × fuso − 183. Para o fuso 23, 6 × 23 − 183 = −45, ou seja, 45° O.

O ponto está no fuso certo se a longitude fica a no máximo 3° do meridiano central. Na borda exata entre dois fusos (longitude múltipla de 6), qualquer um dos dois funciona, mas o trabalho inteiro deve ficar num só.

## Quais são os fusos UTM do Brasil e seus meridianos centrais?

São oito fusos no território continental, do 18 (oeste do Acre) ao 25 (litoral leste do Nordeste). A tabela traz o meridiano central, a faixa de longitudes e os estados que cada fuso cobre, a partir dos limites oficiais das UFs publicados pelo IBGE.

| Fuso | Meridiano central | Faixa de longitude | EPSG (SIRGAS 2000 / UTM) | Estados com território no fuso |
|---|---|---|---|---|
| 18S | 75° O | 78° O a 72° O | 31978 | AC, AM |
| 19S | 69° O | 72° O a 66° O | 31979 | AC, AM, RO |
| 20S | 63° O | 66° O a 60° O | 31980 | AM, MT, RO, RR |
| 21S | 57° O | 60° O a 54° O | 31981 | AM, AP, MS, MT, PA, PR, RO, RR, RS |
| 22S | 51° O | 54° O a 48° O | 31982 | AP, DF, GO, MA, MG, MS, MT, PA, PR, RS, SC, SP, TO |
| 23S | 45° O | 48° O a 42° O | 31983 | BA, DF, GO, MA, MG, PA, PI, RJ, SP, TO |
| 24S | 39° O | 42° O a 36° O | 31984 | AL, BA, CE, ES, MA, MG, PB, PE, PI, RJ, RN, SE |
| 25S | 33° O | 36° O a 30° O | 31985 | AL, PB, PE (inclui Fernando de Noronha), RN |

Duas observações. As ilhas de Trindade e Martim Vaz, do Espírito Santo, ficam no fuso 26. E o "S" indica a convenção do hemisfério sul, com falso norte de 10.000.000 m; parte de Roraima, do Amapá, do Amazonas e do Pará fica ao norte do equador, onde a convenção UTM do hemisfério norte usa falso norte zero. Confira qual convenção o receptor e o programa usam antes de misturar dados.

## Quais estados têm dois ou mais fusos?

A maioria. Só Ceará, Sergipe e Espírito Santo (fuso 24) e Santa Catarina (fuso 22) ficam inteiros num fuso, desconsiderando as ilhas oceânicas. A tabela mostra a divisão aproximada do território, calculada sobre a malha das UFs do IBGE.

| UF | Fusos | Divisão aproximada do território |
|---|---|---|
| AC | 18 e 19 | 22% no 18, 78% no 19 |
| AL | 24 e 25 | 77% no 24, 23% no 25 |
| AM | 18, 19, 20 e 21 | maior parte no 19 e no 20 |
| AP | 21 e 22 | 96% no 22 |
| BA | 23 e 24 | 42% no 23, 58% no 24 |
| DF | 22 e 23 | 27% no 22, 73% no 23 (Brasília no 23) |
| GO | 22 e 23 | 80% no 22, 20% no 23 |
| MA | 22, 23 e 24 | 99% no 23, faixas mínimas no 22 e no 24 |
| MG | 22, 23 e 24 | 79% no 23, Triângulo no 22, leste no 24 |
| MS | 21 e 22 | 67% no 21, 33% no 22 |
| MT | 20, 21 e 22 | 65% no 21 |
| PA | 21, 22 e 23 | 43% no 21, 52% no 22, 5% no 23 |
| PB | 24 e 25 | 74% no 24, 26% no 25 |
| PE | 24 e 25 | 83% no 24, 17% no 25 |
| PI | 23 e 24 | 70% no 23, 30% no 24 |
| PR | 21 e 22 | 96% no 22, extremo oeste no 21 |
| RJ | 23 e 24 | 70% no 23, 30% no 24 |
| RN | 24 e 25 | 74% no 24, 26% no 25 |
| RO | 19, 20 e 21 | 98% no 20 |
| RR | 20 e 21 | 89% no 20 |
| RS | 21 e 22 | 34% no 21, 66% no 22 |
| SP | 22 e 23 | 65% no 22, 35% no 23 |
| TO | 22 e 23 | 59% no 22, 41% no 23 |

Os percentuais são aproximados e servem para orientar. O que define o fuso de um trabalho é a longitude do imóvel.

## Por que o fuso errado desloca o imóvel?

Porque E e N sozinhos não dizem em que fuso estão. Um par E = 500.000 m, N = 8.600.000 m existe em todos os fusos, cada vez sobre um meridiano central diferente, a 6° de distância um do outro. Na latitude do centro da Bahia, 6° de longitude são mais de 600 km.

É assim que acontecem os erros clássicos: o TXT do receptor sai em E/N do fuso 24, alguém abre no 23, e o KML, a planta de situação e a imagem de satélite caem a centenas de quilômetros do imóvel. Arquivo exportado em latitude e longitude não tem esse problema, porque a longitude já define o fuso.

Três regras práticas evitam o susto:

- **Anote o fuso junto com as coordenadas** em todo arquivo E/N que sair do campo.
- **Use um fuso só por trabalho.** Imóvel cortado pelo limite entre fusos fica inteiro num deles; a escolha comum é o fuso que contém a maior parte da área.
- **Declare o fuso e o meridiano central** na planta e no memorial. Na planta, a malha UTM e o quadro de coordenadas devem indicar SIRGAS 2000 e o fuso usado. Mais detalhes no guia de [planta de georreferenciamento A1 e A3](/blog/planta-georreferenciamento-a1-a3/).

## O fuso UTM muda a área e as coordenadas que vão ao SIGEF?

Não muda a área certificada. O Manual Técnico do INCRA manda descrever os vértices por coordenadas geodésicas (latitude, longitude e altitude elipsoidal) vinculadas ao Sistema Geodésico Brasileiro, e calcular a área no Sistema Geodésico Local, pela fórmula de Gauss, usando a média das coordenadas da parcela como origem. O próprio Manual registra que esses resultados expressam melhor a realidade física do que os valores no sistema UTM, adotado antes da 3ª edição.

O fuso entra nas peças que você produz: coordenadas E/N do memorial e da planta, quadros, exportações para CAD. Por isso a área em UTM do seu desenho pode diferir da área do SIGEF, e a diferença cresce com o tamanho do imóvel e com a distância ao meridiano central. Em documento para o cartório, use a área calculada como o INCRA calcula. A lógica completa está no guia do [memorial descritivo de georreferenciamento](/blog/memorial-descritivo-georreferenciamento/).

## Como descobrir o fuso quando só tenho E e N?

Sem latitude e longitude, você precisa de uma pista externa: o município ou a UF do imóvel. O raciocínio:

1. Veja na tabela de estados quais fusos a UF tem.
2. Se for um só (CE, SE, SC, ES continental), está resolvido.
3. Se forem dois ou mais, converta o par E/N para latitude e longitude em cada fuso candidato e veja qual resultado cai dentro do município do imóvel.
4. Confira sobre imagem de satélite: o perímetro tem de cair em cima da cerca, da estrada ou do rio que você mediu.

## Onde um sistema ajuda?

É uma conferência repetitiva, que um sistema faz no envio do arquivo. No Vertces, o fuso é detectado pelas coordenadas do levantamento; quando o arquivo vem em E/N e a UF tem mais de um fuso possível, o sistema pergunta antes de criar o serviço e sugere o fuso que o escritório mais usa naquela UF. O trabalho segue em SIRGAS 2000, nos fusos 18S a 25S, e a planta sai com malha UTM e imagem de satélite automática, o que deixa um fuso trocado visível na hora. O fluxo completo da leitura está em [como converter o TXT do receptor GNSS para o SIGEF](/blog/txt-receptor-gnss-para-sigef/).
