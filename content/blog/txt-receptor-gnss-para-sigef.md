---
{
  "titulo": "Como converter o TXT do receptor GNSS para o SIGEF sem redigitar coordenada",
  "seoTitulo": "Converter o TXT do receptor GNSS para o SIGEF | Vertces",
  "descricao": "Converter o TXT do GNSS para o SIGEF: o que o arquivo do receptor RTK traz, o que o INCRA exige das coordenadas e precisões e como ler tudo sem copiar nada.",
  "slug": "txt-receptor-gnss-para-sigef",
  "data": "2026-11-06",
  "atualizado": "2026-11-06",
  "categoria": "funcionalidades",
  "palavraChave": "converter txt do gnss para sigef",
  "palavrasRelacionadas": ["txt receptor rtk", "arquivo de pontos gnss", "importar txt sigef", "converter coordenadas utm sirgas 2000", "csv do receptor gnss", "sigma do ponto gnss"],
  "resumo": "Converter o TXT do receptor GNSS para o SIGEF é transformar a lista de pontos que sai do campo (nome, coordenadas, altitude e desvios) em vértices com código, coordenadas SIRGAS 2000 e precisões em metros, na ordem do perímetro. O jeito seguro é ler o arquivo do jeito que ele sai do receptor, separar pontos de apoio e versões repetidas e conferir o desenho antes de gerar a planilha, sem redigitar nenhum número.",
  "faq": [
    { "p": "Preciso exportar o TXT do receptor num formato específico?", "r": "No Vertces, não. O sistema lê TXT e CSV de aparelhos diferentes, planilhas, KML, GPX, LandXML, DXF e outros formatos de texto. Formato novo é aprendido e o próximo arquivo do mesmo aparelho entra sozinho." },
    { "p": "O TXT do receptor substitui os arquivos brutos do levantamento?", "r": "Não. O Manual Técnico do INCRA manda o credenciado guardar os arquivos brutos GNSS em RINEX e no formato nativo, os arquivos de trabalho do RTK e os relatórios de processamento. O TXT é a saída para o cálculo; o resto fica no arquivo do escritório." },
    { "p": "O arquivo veio com o ponto da base no meio. Isso atrapalha?", "r": "Atrapalha se entrar no perímetro. O Vertces reconhece base e referência (RTCM, base, ref, estação) como apoio e as deixa fora do polígono, pedindo um clique de conferência quando a base cai fora do perímetro." },
    { "p": "Dá para ler arquivo .job ou DBX direto do receptor?", "r": "Não. Formatos binários de fabricante só são lidos com o programa do próprio fabricante. O Vertces reconhece o arquivo e mostra como exportar em texto." },
    { "p": "O sistema gasta crédito só para ler o arquivo?", "r": "Não. A leitura, a conferência do TXT e o esboço acontecem antes; o crédito só é consumido quando você prossegue para criar o serviço." }
  ],
  "fontes": [
    { "titulo": "INCRA: Manual Técnico para Georreferenciamento de Imóveis Rurais, 2ª edição", "url": "https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/Manual_Tecnico_de_Georreferenciamento_2_Edicao.pdf/@@display-file/file" },
    { "titulo": "INCRA: Manual para Gestão da Certificação, 2ª edição", "url": "https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/manualgestaocertificacao2edicao2023.pdf/@@display-file/file" },
    { "titulo": "INCRA: Certificação de Imóvel Rural", "url": "https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/certificacao-imoveis" }
  ]
}
---

Converter o TXT do receptor GNSS para o SIGEF é transformar a lista de pontos que sai do campo em vértices com código, coordenadas SIRGAS 2000 e precisões em metros, na ordem certa do perímetro. O jeito seguro é ler o arquivo como ele sai do receptor, separar a base e as versões repetidas dos pontos e conferir o desenho antes de gerar a planilha. Nenhuma coordenada precisa ser redigitada.

## O que vem no TXT exportado do receptor GNSS?

Vem uma linha por ponto, com o nome, as coordenadas, a altitude e, quase sempre, os desvios. O problema é que cada aparelho e cada coletora exporta de um jeito.

Num mesmo escritório é comum ter:

- separador ponto e vírgula num arquivo e vírgula no outro;
- decimal com ponto ou com vírgula;
- coordenadas UTM (E, N) ou geográficas, em grau decimal ou em graus, minutos e segundos;
- σ em metros, em centímetros ou em milímetros;
- cabeçalho em português, inglês ou nenhum cabeçalho;
- o ponto da base ou da referência RTCM no meio da lista;
- o mesmo marco duas vezes: o levantamento e, embaixo, a versão pós-processada com um prefixo no nome.

O nome do ponto também carrega informação. Muitos técnicos anotam no campo o confrontante no próprio nome, como 3jorge/davino, para marcar o marco onde a divisa muda de vizinho.

## Por que converter o TXT à mão dá errado?

Dá errado porque cada passo manual muda o número de lugar. O roteiro típico: abrir o TXT no Excel, separar colunas, trocar vírgula por ponto, apagar a base, reordenar os pontos, converter UTM para geográfica, colar no modelo da planilha do SIGEF e redigitar os nomes.

Os erros que aparecem depois:

1. Coluna de E e N invertida, e o imóvel vai parar em outro município.
2. σ em centímetros lido como metro, ou o contrário, e a precisão estoura o padrão.
3. Ponto da base dentro do polígono, criando um bico no perímetro.
4. Pós-processado misturado com levantamento, um polígono que cruza sobre si mesmo.
5. Fuso UTM errado quando a UF tem dois fusos.
6. Ordem dos pontos trocada, e o confrontante sai descolado do trecho.

Nenhum desses erros aparece na tela do Excel. Eles aparecem quando o SIGEF recusa a planilha ou, pior, quando a sobreposição surge depois de protocolar.

## O que o INCRA exige dos dados que saem do TXT?

Exige coordenadas no SIRGAS 2000 e precisões em metros dentro do padrão de cada tipo de limite. O Manual Técnico para Georreferenciamento de Imóveis Rurais (2ª edição) define:

| Exigência | O que o manual diz | Item |
|---|---|---|
| Precisão em metros | As precisões de latitude e longitude são convertidas para valores lineares | 1.4.5 |
| Precisão posicional | Resultante planimétrica dos desvios de latitude e longitude | 1.4.3 |
| Limite artificial | Melhor ou igual a 0,50 m | 1.4.4 |
| Limite natural | Melhor ou igual a 3,00 m | 1.4.4 |
| Limite inacessível | Melhor ou igual a 7,50 m | 1.4.4 |
| Área | Calculada no Sistema Geodésico Local, fórmula de Gauss, em hectares | 3.8.3 |

Cada vértice também leva o método de posicionamento, um dos atributos de vértice que o Manual para Gestão da Certificação cita ao lado dos sigmas. E o código do vértice segue a regra do credenciado (veja [tipos de vértice M, P e V](/blog/tipos-de-vertice-m-p-v-sigef/)).

Outro ponto: o TXT não é o único arquivo que importa. O capítulo 4 do manual manda guardar os arquivos brutos GNSS em RINEX e no formato nativo, os arquivos de trabalho do RTK e os relatórios de processamento, porque o INCRA pode pedir esse material. O TXT é a entrada do cálculo, não o acervo do serviço.

## Levantamento ou pós-processado: qual versão do ponto usar?

Use uma versão inteira, nunca pedaços de duas. Quando o arquivo traz o mesmo marco duas vezes, por exemplo 7 e postp_7, juntar tudo num polígono só gera um desenho cruzado com área errada.

O Vertces trata assim:

- Nome que começa pelo número do ponto (3jorge/davino, 16estrada, 7) é vértice do perímetro, do levantamento.
- O mesmo nome com prefixo (postp_3jorge/davino, pp_7) é outra versão do mesmo ponto.
- Base e referência (RTCM-Ref, base, ref, estação) ficam como apoio, fora do perímetro.

A escolha automática é a versão mais completa. Se empatar, ganha a de menor σ mediano. A prévia mostra cada versão com o número de pontos, o σ mediano e os pontos que faltam, e você pode trocar ou escolher não separar.

## Como fazer no Vertces

O Vertces lê o arquivo do levantamento do jeito que sai do campo, com apoio de IA para formatos diferentes. A regra é que a IA nunca digita coordenada: ela indica onde estão os números, o sistema copia cada número do arquivo e confere que a cópia bate com o original.

1. **Envie o arquivo.** TXT ou CSV do receptor, planilha xlsx ou ods, KML, KMZ, GPX, LandXML, DXF, GeoJSON, relatório do IBGE-PPP ou memorial em PDF com texto.
2. **Veja a etapa Leitura do arquivo.** Ela mostra como o arquivo foi lido, o desenho do perímetro, a tabela com o papel de cada coluna, as linhas que ficaram de fora com o motivo e os avisos.
3. **Ajuste o que precisar.** Troque o papel de uma coluna, o separador, o decimal, a unidade do σ ou a ordem dos pontos. Exclua um ponto clicando nele ou declare o σ quando o arquivo não traz. Cada mudança relê o arquivo na hora.
4. **Confirme os avisos.** Ordem trocada, desenho que cruza, base fora do perímetro e σ a 95% pedem um clique em conferi.
5. **Confira o fuso.** O sistema detecta o fuso UTM pelas coordenadas, de 18S a 25S. Se a UF tem dois fusos, ele pergunta e sugere o mais usado pelo escritório. Veja [como descobrir o fuso UTM no SIRGAS 2000](/blog/sirgas-2000-fuso-utm-como-descobrir/).
6. **Gere o esboço e prossiga.** A conferência do TXT permite ajustar pontos e gerar a imagem antes de gastar crédito. O crédito só é consumido quando você prossegue.

Formato novo vira perfil do escritório. O próximo arquivo do mesmo aparelho entra sozinho, sem IA. Daí para frente, os mesmos vértices alimentam o [memorial descritivo](/blog/memorial-descritivo-georreferenciamento/), a [planilha ODS do SIGEF](/blog/planilha-ods-sigef-como-preencher/) e a planta.

## O que o sistema não lê?

Há limites, e é melhor saber antes de ir a campo:

- **Arquivo de fabricante ou de observação bruta** (Leica DBX, Trimble .job, RINEX): não traz a lista de coordenadas pronta. O sistema reconhece o arquivo e mostra como exportar os pontos em texto.
- **PDF escaneado ou foto**: é recusado com orientação, porque não dá para garantir os números.
- **Imóvel ao norte do Equador**: o cálculo cobre só o hemisfério sul, fusos 18S a 25S.
- **DXF com pontos muito próximos**: os nomes deduzidos pelo texto vizinho podem trocar, e a leitura marca a dúvida para você conferir.

## Como conferir o resultado antes da planilha?

Confira no mapa, não na tabela. Com o perímetro desenhado sobre a imagem, fica fácil ver um ponto fora da cerca, um bico ou um vértice duplicado. No Vertces, o mapa interativo mostra também as parcelas já certificadas em volta, então uma divisa que invade o vizinho aparece antes do envio. Veja [como evitar sobreposição no SIGEF](/blog/sobreposicao-sigef-como-evitar/).

Depois disso, ainda vale a regra de sempre: o sistema calcula e avisa, mas quem assina é o responsável técnico, e quem valida a planilha é o SIGEF.
