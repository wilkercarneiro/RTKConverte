---
{
  "titulo": "Como fazer o CAR: reserva legal, APP e shapefile pronto para o SICAR",
  "seoTitulo": "Como fazer o CAR: reserva legal, APP e shapefile SICAR | Vertces",
  "descricao": "Como fazer o CAR: percentual de reserva legal por bioma, largura da APP de rio pelo Código Florestal e como sair do KML ou GPX para os shapefiles do SICAR.",
  "slug": "car-shapefile-sicar-reserva-legal-app",
  "data": "2026-11-06",
  "atualizado": "2026-11-06",
  "categoria": "funcionalidades",
  "palavraChave": "como fazer o car",
  "palavrasRelacionadas": ["shapefile sicar", "reserva legal percentual", "app de rio largura", "cadastro ambiental rural kml", "car com gpx", "erro 3001 sicar"],
  "resumo": "Para fazer o CAR você delimita o imóvel e, dentro dele, a reserva legal, a APP, a vegetação nativa e a área produtiva, e envia tudo ao sistema do estado ou ao SICAR. A reserva legal é de 20% fora da Amazônia Legal e de 80%, 35% ou 20% dentro dela, conforme floresta, cerrado ou campos gerais; a APP de curso d’água vai de 30 a 500 m, conforme a largura do rio.",
  "faq": [
    { "p": "O CAR serve como documento de propriedade?", "r": "Não. O cadastro é declaratório e não é título para reconhecer propriedade ou posse. Para a terra, o documento é a matrícula, e a descrição precisa do georreferenciamento." },
    { "p": "Dá para fazer o CAR com o GPS de mão?", "r": "Dá. O GPX de um GPS de navegação ou do celular serve para o desenho do CAR. A precisão é menor que a de um levantamento GNSS geodésico, e isso deve ser considerado quando a reserva ou a APP ficam perto da divisa." },
    { "p": "Meu estado usa o SICAR federal?", "r": "Depende. Bahia, Espírito Santo, Mato Grosso do Sul, São Paulo e Tocantins têm sistemas próprios, segundo o Ministério da Agricultura. Nesses casos, confira o formato aceito antes de enviar." },
    { "p": "O que é o erro 3001 do SICAR?", "r": "É a recusa de geometria com aresta cruzada. Costuma aparecer quando um recorte deixa um bico de largura zero ou quando há vértices colados. O Vertces remove esses casos antes de gravar o shapefile." },
    { "p": "Posso usar mata excedente para compensar a reserva de outro imóvel?", "r": "O Código Florestal prevê a compensação de reserva legal com área de outro imóvel, com regras de bioma. O Vertces desenha essa vegetação cedida em camada própria, separada da reserva do imóvel, e gera um KML com os dados do beneficiado." }
  ],
  "fontes": [
    { "titulo": "Lei nº 12.651/2012 (Código Florestal), arts. 3º, 4º, 12 e 29", "url": "https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2012/lei/l12651.htm" },
    { "titulo": "SICAR: o que é o Sistema Nacional de Cadastro Ambiental Rural", "url": "https://www.gov.br/car/pt-br/assuntos/o-que-e-o-sicar" },
    { "titulo": "Ministério da Agricultura: o que é o Cadastro Ambiental Rural", "url": "https://www.gov.br/agricultura/pt-br/assuntos/florestal/cadastro-ambiental-rural-1/o-que-e-o-cadastro-ambiental-rural" }
  ]
}
---

Fazer o CAR é delimitar o imóvel rural e, dentro dele, a reserva legal, as áreas de preservação permanente (APP), a vegetação nativa e a área produtiva, e enviar esse desenho com os dados do proprietário ao sistema do estado ou ao SICAR. O percentual da reserva depende do bioma e da região, e a largura da APP de rio depende da largura do leito. A parte que dá mais retrabalho costuma ser a última: o arquivo geográfico ser recusado pelo sistema.

O Cadastro Ambiental Rural (CAR) é o registro público eletrônico, nacional e obrigatório para todos os imóveis rurais, criado pelo art. 29 da Lei 12.651/2012 (Código Florestal). O SICAR é o sistema eletrônico nacional que integra esses dados, criado pelo Decreto 7.830/2012.

## Quem precisa fazer o CAR e onde se faz?

Todo imóvel rural, de propriedade ou posse. A inscrição é feita no órgão ambiental competente do estado onde o imóvel fica. Segundo o Ministério da Agricultura, Bahia, Espírito Santo, Mato Grosso do Sul, São Paulo e Tocantins têm sistemas próprios; os demais usam o SICAR federal ou aplicações federais instaladas no estado.

Dois pontos que confundem o cliente:

- o CAR não é título de propriedade nem de posse, e a regra está escrita na própria lei do CAR;
- o recibo de inscrição comprova o cadastro, mas não aprova a localização da reserva legal, que passa pela análise do órgão estadual.

Para a terra em si, o documento é a matrícula com descrição georreferenciada; veja [o que é georreferenciamento](/blog/georreferenciamento-o-que-e/).

## Qual o percentual de reserva legal por bioma?

Reserva legal é a área no interior do imóvel, com vegetação nativa, delimitada nos termos do art. 12 do Código Florestal. Os percentuais mínimos sobre a área do imóvel:

| Localização do imóvel | Fitofisionomia | Reserva legal mínima |
|---|---|---|
| Amazônia Legal | Área de florestas | 80% |
| Amazônia Legal | Área de cerrado | 35% |
| Amazônia Legal | Área de campos gerais | 20% |
| Demais regiões do país | Qualquer | 20% |

O caput do art. 12 ressalva os casos do art. 68 (imóveis que respeitaram os percentuais da época da supressão) e há outras regras especiais na lei, como as de imóveis de até quatro módulos fiscais com área consolidada. A conta, portanto, começa no percentual da tabela, mas o profissional confirma o enquadramento do imóvel.

## Qual a largura da APP de rio?

Depende da largura do curso d’água. O art. 4º, I, do Código Florestal define como APP as faixas marginais de qualquer curso d’água natural perene e intermitente, excluídos os efêmeros, **desde a borda da calha do leito regular**, com largura mínima de:

1. 30 m, para cursos d’água com menos de 10 m de largura;
2. 50 m, para cursos de 10 a 50 m;
3. 100 m, para cursos de 50 a 200 m;
4. 200 m, para cursos de 200 a 600 m;
5. 500 m, para cursos com mais de 600 m.

Repare de onde se mede: da borda da calha, não do meio do rio. Em córrego estreito a diferença é pequena; em rio de 40 m, medir do eixo tira 20 m da faixa. Quem desenha o rio como uma linha precisa decidir se essa linha é a margem ou o eixo, e somar meia largura quando for o eixo.

Há ainda as regras de recomposição em área rural consolidada (art. 61-A), com faixas que variam pelo tamanho do imóvel em módulos fiscais. Elas tratam do que precisa ser recomposto, não da definição da APP, e o enquadramento é do profissional.

## Como sair do KML ou do GPX para o shapefile?

O caminho tem quatro passos, independente do programa:

1. **Perímetro do imóvel**, como polígono fechado, sem vértices colados nem arestas cruzadas.
2. **Hidrografia**, com os rios que geram APP.
3. **Camadas internas**: reserva legal, APP, vegetação nativa, área produtiva, cada uma recortada pelo imóvel.
4. **Exportação** em shapefile (SHP, SHX, DBF e PRJ), uma camada por tema, no sistema de referência aceito.

Os erros mais comuns na recusa: polígono com bico de largura zero depois de um recorte, ponto marcado duas vezes no mesmo lugar, linha em vez de polígono e falta do arquivo PRJ.

## Como fazer no Vertces

O serviço de CAR do Vertces roda no navegador e transforma a área total nas camadas que o SICAR recebe.

1. **Envie o arquivo da área.** KML, KMZ ou GPX. No KML, o perímetro pode vir como polígono ou linha fechada (o jeito que o CAD grava), e uma linha aberta no mesmo arquivo entra como rio.
2. **No GPX do GPS de mão**, há três casos. Pontos marcados na divisa: o sistema testa a ordem por horário, por número e pela ordem do arquivo e fica com a primeira que fecha sem cruzar. Trilha que volta ao começo: vira o perímetro, simplificada com tolerância de 0,5 m. Trilha aberta: o sistema fecha e avisa. Pontos repetidos a menos de 1 m saem, e um clique tira do perímetro o ponto que não é divisa (a sede, um ponto de outro dia).
3. **Desenhe a reserva legal.** Encoste num lado do imóvel com a porcentagem exata e um giro da divisa, ou desenhe à mão. O padrão é 20%; para Amazônia Legal, troque para o percentual do bioma. O botão Ajustar leva a área à porcentagem.
4. **Marque a APP.** Para cada rio, escolha a faixa pela largura do leito, de 30 a 500 m, conforme a tabela do art. 4º. A faixa sai dos dois lados da linha do rio e só dentro do imóvel. Lembre: a lei mede da borda da calha.
5. **Vegetação nativa cedida**, se houver. É o excedente de mata que vai servir de reserva de outro imóvel. Ela nunca entra na reserva do próprio imóvel, e sai em shapefile próprio e num KML com área, imóvel cedente, imóvel beneficiado e o CAR dele.
6. **Área produtiva.** É calculada: imóvel menos reserva menos vegetação cedida; a APP também sai se você marcar a opção.
7. **Baixe os shapefiles**, em SIRGAS 2000, coordenadas em grau, com SHP, SHX, DBF e PRJ de cada camada. O sistema remove o bico de largura zero que vira aresta cruzada em grau (o erro 3001 do SICAR).

Se o imóvel tem levantamento GNSS, use o perímetro dele em vez do GPS de mão; o Vertces exporta a área do georreferenciamento em KML e outros formatos, veja [exportar em KML, DXF, shapefile e GPX](/blog/exportar-kml-dxf-shapefile-gpx/). Antes de desenhar a reserva, vale rodar a [análise de restrições do imóvel](/blog/analise-de-restricoes-imovel-rural/) para saber se há UC, terra indígena ou embargo encostando.

## De quem é a responsabilidade pela delimitação?

Do profissional e do declarante. O sistema desenha o que você define: a porcentagem, a faixa de APP, a linha do rio e o lado onde a reserva encosta. Quem decide o enquadramento (bioma, área consolidada, regime especial), confere a linha do rio contra a borda da calha e assina pela informação é o responsável técnico, junto com o proprietário ou possuidor, que responde pela declaração. A análise e a validação são do órgão ambiental do estado.

## O que conferir antes de enviar?

Uma lista curta, que evita a maior parte das devoluções:

- a área do imóvel no CAR bate com a da matrícula ou do georreferenciamento, dentro da tolerância;
- a reserva legal atinge o percentual e não se sobrepõe à vegetação cedida;
- todos os cursos d’água perenes e intermitentes do imóvel têm APP;
- o sistema do seu estado aceita o formato e o sistema de referência dos arquivos;
- nenhuma camada sai do perímetro.

Para ver o fluxo com um arquivo seu, veja a seção de [CAR](/#car) ou [agende uma demonstração](/#contato).
