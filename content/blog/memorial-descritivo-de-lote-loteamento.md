---
{
  "titulo": "Memorial descritivo de lote: o que leva e como gerar lote a lote",
  "seoTitulo": "Memorial descritivo de lote: o que leva e como gerar | Vertces",
  "descricao": "Memorial descritivo de lote: frente, laterais, fundos, confrontantes, área e perímetro. Como importar o loteamento do CAD e gerar documentos lote a lote.",
  "slug": "memorial-descritivo-de-lote-loteamento",
  "data": "2026-11-07",
  "atualizado": "2026-11-07",
  "categoria": "funcionalidades",
  "palavraChave": "memorial descritivo de lote",
  "palavrasRelacionadas": ["memorial descritivo lote urbano", "memorial de lote loteamento modelo", "frente lateral fundos lote", "planta do lote a4", "importar loteamento dxf", "memorial descritivo quadra e lote"],
  "resumo": "O memorial descritivo de lote é o texto que identifica um lote do loteamento: quadra e número, área, perímetro, medidas de frente, laterais e fundos, confrontantes e a descrição do perímetro vértice a vértice. No Vertces, o memorial sai de cada lote do projeto, gerado ali ou importado do CAD em DXF, KML ou GeoJSON, junto com a planta do lote em A4, a tabela de coordenadas e a locação dos vértices.",
  "faq": [
    { "p": "Lote de esquina tem memorial diferente?", "r": "Tem um item a mais. O lote de esquina descreve a curva de concordância (ou o chanfro) à parte, e a testada é medida até o cruzamento dos alinhamentos. No perímetro, a curva aparece com raio, desenvolvimento e corda." },
    { "p": "O memorial do lote precisa de coordenadas?", "r": "A lei pede, para imóvel urbano, características, confrontações, localização, área, logradouro e número. As coordenadas não são exigência geral para lote urbano, mas ajudam a locar e a resolver divergência; o memorial do Vertces traz as coordenadas UTM em SIRGAS 2000." },
    { "p": "Dá para gerar o memorial de um lote só?", "r": "Dá. Na lista de lotes das Entregas, o botão de baixar de cada lote gera só aquele, com memorial, planta A4 e locação." },
    { "p": "O arquivo DWG pode ser importado?", "r": "Não diretamente. Salve como DXF ASCII no seu programa de CAD e importe o DXF. O sistema recusa DWG e DXF binário com essa orientação." },
    { "p": "As áreas verdes e institucionais também ganham memorial?", "r": "Ganham. Elas saem como os lotes, em pastas próprias, com a destinação da área e a observação de que passam ao domínio do município com o registro do loteamento." }
  ],
  "fontes": [
    { "titulo": "Lei nº 6.766/1979, arts. 4º, 9º e 22 (lote mínimo, memorial e áreas públicas)", "url": "https://www.planalto.gov.br/ccivil_03/leis/l6766.htm" },
    { "titulo": "Lei nº 6.015/1973, art. 176, §1º, II, 3, b (identificação do imóvel urbano)", "url": "https://www.planalto.gov.br/ccivil_03/leis/l6015compilada.htm" }
  ]
}
---

O memorial descritivo de lote é o texto que identifica um lote do loteamento: quadra e número, área, perímetro, medidas de frente, laterais e fundos, confrontantes e a descrição do perímetro, vértice a vértice. Ele acompanha a planta do lote e é a base da matrícula de cada unidade depois do registro do loteamento. Num loteamento de 200 lotes, são 200 memoriais que precisam bater com a planta geral.

Memorial descritivo de lote não é o memorial do loteamento. O do loteamento, previsto no art. 9º, §2º, da Lei 6.766/79, descreve o empreendimento: zona de uso, condições urbanísticas, restrições, equipamentos e as áreas públicas que passam ao município. O do lote descreve uma unidade só. Para o memorial de imóvel rural georreferenciado, a lógica é outra e está em [memorial descritivo de georreferenciamento](/blog/memorial-descritivo-georreferenciamento/).

## O que o memorial descritivo de lote precisa ter?

Precisa ter o que identifica o lote sem depender da planta. Para imóvel urbano, a Lei 6.015/73, art. 176, §1º, II, 3, "b", pede características e confrontações, localização, área, logradouro, número e designação cadastral, se houver. Na prática, o memorial de lote leva:

1. **Identificação:** lote, quadra, nome do loteamento, município e UF.
2. **Proprietário**, quando informado.
3. **Área e perímetro**, e se é lote de esquina.
4. **Medidas nominais:** frente, lado direito, fundos e lado esquerdo, com o confrontante de cada um.
5. **Curva de concordância**, no lote de esquina.
6. **Descrição do perímetro:** do primeiro vértice da frente, lado a lado, com azimute, distância e confrontante, até voltar ao ponto inicial.
7. **Referência:** sistema geodésico, projeção e fuso, e se as medidas estão no plano UTM ou no plano topográfico.

O lado direito e o esquerdo são contados de quem está na rua, olhando o lote. Parece detalhe, mas inverter os lados é erro comum de memorial feito à mão.

## Como se descrevem frente, laterais e fundos?

Frente é o lado voltado para a rua; laterais são as divisas com os lotes vizinhos; fundos é o lado oposto à frente. Cada medida vem com o confrontante. Um exemplo, num loteamento fictício:

> Lote 07 da Quadra B do loteamento Jardim Boa Esperança. Área: 300,00 m². Frente: 12,00 m para a Rua das Acácias. Lado direito (de quem da rua olha o imóvel): 25,00 m com o Lote 08. Fundos: 12,00 m com o Lote 18. Lado esquerdo: 25,00 m com o Lote 06.

Depois das medidas, vem a descrição do perímetro com coordenadas: "inicia-se no vértice B-11, de coordenadas E … m e N … m, situado no alinhamento da Rua das Acácias; deste segue confrontando com o Lote 08, com azimute de … e distância de 25,00 m, até o vértice B-12…", até fechar no ponto inicial.

Três situações pedem atenção:

- **Lote de esquina.** A testada é medida até o cruzamento dos alinhamentos, e a curva de concordância entra à parte, com raio, desenvolvimento e corda.
- **Lote de frente escolhida.** O lote que dá para uma servidão ou para uma área verde confronta com ela na frente.
- **Lote com mais de quatro quinas.** Cada dobra é um trecho a mais na descrição. As normas de parcelamento costumam evitar esse formato, e o projeto deve justificar.

A Lei 6.766, art. 4º, II, fixa o lote mínimo em 125 m² e a frente mínima em 5 m, salvo exceções de interesse social. O município pode exigir mais.

## Por que gerar lote a lote em vez de digitar?

Porque o memorial digitado diverge da planta. Num loteamento com centenas de lotes, basta uma divisa ajustada na última hora para dezenas de memoriais ficarem errados. Gerar a partir da geometria garante que a área, as medidas e os nomes dos vértices do memorial são os mesmos da planta e do arquivo de locação.

| | Memorial digitado | Memorial gerado da geometria |
|---|---|---|
| Medidas | Copiadas da planta, uma a uma | Calculadas do contorno do lote |
| Divisa que mudou | Revisar todos os lotes afetados | Gerar de novo |
| Nomes dos vértices | Inventados no texto | Os mesmos da locação |
| Lote de esquina | Curva descrita à mão | Curva com raio e desenvolvimento |
| Esforço | Cresce com cada lote | Uma geração para todos os marcados |

## Como importar um loteamento pronto do CAD?

Importar é trazer para o sistema o loteamento já dividido em outro programa, sem redesenhar. O Vertces lê três formatos:

- **DXF ASCII:** polilinhas fechadas viram polígonos; linhas, arcos, textos e atributos de bloco também são lidos. DWG e DXF binário são recusados, com a orientação de salvar como DXF ASCII.
- **KML ou KMZ:** cada polígono com a pasta dele; a pasta "Quadra A" dá a quadra, e o nome "A-01" ou "Lote 12" dá o número.
- **GeoJSON:** com propriedades como tipo, lote, quadra e nome, em lon/lat ou em UTM SIRGAS 2000.

O sistema reconhece cada coisa pelo nome da camada (lote, quadra, área verde, institucional, APP, rua, eixo, perímetro), sem diferenciar maiúscula nem acento. O texto dentro do lote é o número ("12", "L-12", "QD 01 LT 12"). Camada desconhecida é deduzida pela forma: o que contém outros polígonos é quadra, o que está dentro de uma quadra é lote.

Antes de aplicar, aparece uma prévia com o resumo (quadras, lotes, área dos lotes, viário, áreas públicas) e os avisos: lote fora da gleba, lotes sobrepostos, número repetido ou faltando, perímetro do arquivo diferente da gleba, lote abaixo de 125 m², arquivo sem eixo de rua. Desenho em coordenadas locais ou longe da gleba do serviço é recusado com o motivo. Para os formatos de troca em geral, veja [exportar para KML, DXF e shapefile](/blog/exportar-kml-dxf-shapefile-gpx/).

## Como fazer no Vertces

O memorial de lote sai do serviço de loteamento, com o projeto gerado no sistema ou importado.

1. **Crie o loteamento.** Em Início, Loteamento, envie o TXT do perímetro da gleba.
2. **Traga os lotes.** Nas Perguntas, o cartão Já tem o loteamento pronto? importa o DXF, KML/KMZ ou GeoJSON. Confira a prévia e os avisos e clique em Usar este loteamento. Sem arquivo, responda às perguntas e escolha uma das três propostas automáticas; veja [software para projeto de loteamento](/blog/software-loteamento-lei-6766/).
3. **Ajuste na prancheta,** se precisar: mover quina, deslizar divisa, unir, dividir, igualar áreas. O lote que sair das medidas fica marcado com aviso, sem bloquear.
4. **Vá às Entregas, Lote a lote.** Marque todos, por quadra ou um a um. O botão de baixar de cada lote gera só ele.
5. **Baixe o zip.** Cada lote vem numa pasta (QUADRA_A/LOTE_01/) com o memorial descritivo em DOCX, a planta do lote em A4 (PDF) e a locação dos vértices no formato da coletora.

A planta do lote em A4 traz carimbo (empresa, RT, loteamento, quadra e lote, área, perímetro, município e UF), o lote em escala com os vizinhos em volta, norte e escala, medidas e azimutes dos lados, nomes dos vértices, confrontantes, tabela de coordenadas (vértice, E, N, azimute, distância, confrontante) e a situação, com o lote destacado no loteamento.

As áreas verdes, de lazer e institucionais saem do mesmo jeito, em pastas como AREA_VERDE_01/, com a destinação e a observação do art. 22 da Lei 6.766. Os vértices delas que a locação não tem ganham nomes como AV01-01.

## Como o memorial conversa com a locação?

Pelos nomes dos vértices. O ponto B-11 do memorial é o mesmo B-11 da planta e do arquivo da coletora GNSS, então o técnico de campo crava o marco que o memorial descreve. A locação sai em CSV universal, na variante com o Norte antes do Este, no formato Name,Code,N,E,Z, em PENZD/PNEZD ou em DXF de linhas.

O memorial gerado é um rascunho técnico consistente, não o fim da conferência. Quem assina é o responsável técnico, quem aprova o loteamento é a prefeitura e quem abre as matrículas é o cartório. Para ver a geração lote a lote num projeto seu, [agende uma demonstração](/#contato).
