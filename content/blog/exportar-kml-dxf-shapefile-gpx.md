---
{
  "titulo": "Exportar a área em KML, DXF, shapefile e GPX: qual formato usar",
  "seoTitulo": "Converter coordenadas para KML, DXF, shapefile e GPX | Vertces",
  "descricao": "Converter coordenadas para KML, DXF, shapefile e GPX: para que serve cada formato, quem pede (banco, prefeitura, CAD, coletora) e como exportar do Vertces.",
  "slug": "exportar-kml-dxf-shapefile-gpx",
  "data": "2026-11-06",
  "atualizado": "2026-11-06",
  "categoria": "funcionalidades",
  "palavraChave": "converter coordenadas para kml dxf shapefile",
  "palavrasRelacionadas": ["exportar kml georreferenciamento", "converter txt para dxf", "gerar shapefile do imóvel", "kmz google earth fazenda", "gpx garmin divisa", "txt para coletora gnss", "geojson qgis"],
  "resumo": "Cada formato atende um destinatário: KML e KMZ para quem vai ver a área no Google Earth, DXF e pacote CAD para o desenhista, SHP e GeoJSON para QGIS e ArcGIS, GPX para o GPS de navegação, CSV para planilha e TXT para a coletora GNSS. No Vertces, a área de qualquer serviço sai em todos esses formatos pelo botão Exportar, a partir das mesmas coordenadas conferidas.",
  "faq": [
    { "p": "O KML sai em UTM ou em latitude e longitude?", "r": "Em latitude e longitude, em grau decimal, porque é o que o Google Earth lê. Os formatos que saem em UTM são o DXF, o pacote CAD, o CSV e o TXT da coletora, com o fuso no nome do arquivo." },
    { "p": "Por que o DXF abre no lugar errado no QGIS?", "r": "Porque o DXF não guarda o sistema de coordenadas. Use o pacote CAD, que traz o .prj do fuso UTM e um LEIAME explicando como definir o SRC da camada." },
    { "p": "O shapefile exportado serve para o CAR?", "r": "O SHP do botão Exportar traz a área do imóvel. Para o CAR, com reserva legal, APP e vegetação nativa separadas, use o serviço de CAR do Vertces, que gera os shapefiles em SIRGAS 2000 no arranjo do SICAR." },
    { "p": "A coletora recusa o arquivo, o que pode ser?", "r": "O motivo mais comum é nome de ponto repetido ou com acento. O TXT do Vertces sai no formato P,E,N,Z,D, sem cabeçalho, com nomes curtos, sem acento e sem repetição." },
    { "p": "Dá para exportar a área do loteamento também?", "r": "Sim. O botão Exportar fica no cabeçalho de todo serviço, inclusive loteamento e CAR, e o DXF separa as camadas (perímetro, lotes, vértices, rótulos)." }
  ],
  "fontes": [
    { "titulo": "Google: KMZ Files (documentação do KML)", "url": "https://developers.google.com/kml/documentation/kmzarchives" },
    { "titulo": "Cadastro Ambiental Rural (gov.br/car)", "url": "https://www.gov.br/car/pt-br" },
    { "titulo": "SICAR: manuais do Módulo de Cadastro", "url": "https://www.gov.br/car/pt-br/central-de-conteudo/manuais" },
    { "titulo": "INCRA: Certificação de Imóvel Rural", "url": "https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/certificacao-imoveis" }
  ]
}
---

Para converter as coordenadas do imóvel em KML, DXF, shapefile ou GPX, escolha o formato pelo destinatário: KML para quem vai abrir no Google Earth, DXF para o CAD, SHP para QGIS e ArcGIS, GPX para o GPS de mão e TXT para a coletora. No Vertces, a área de qualquer serviço sai em nove formatos pelo botão **Exportar**, todos gerados das mesmas coordenadas que você já conferiu. Não há conversão manual nem planilha intermediária.

O problema que isso resolve é conhecido: o banco pede KML, o desenhista quer DXF, a prefeitura pede shapefile, e cada conversão feita à mão é uma chance de trocar fuso, inverter latitude e longitude ou perder um vértice.

## Qual formato cada destinatário pede?

Cada formato existe porque um programa ou órgão lê aquele arquivo. A tabela resume quem costuma pedir o quê.

| Formato | Programa que abre | Quem costuma pedir | Coordenadas |
|---|---|---|---|
| KML | Google Earth, Google Maps | banco, cliente, comprador, advogado | latitude e longitude (grau) |
| KMZ | Google Earth | quem vai mandar por e-mail ou WhatsApp | latitude e longitude (grau) |
| DXF | AutoCAD e qualquer CAD | desenhista, projetista, engenharia | UTM |
| Pacote CAD (.zip) | CAD e QGIS | quem precisa do DXF já georreferenciado | UTM + .prj do fuso |
| SHP | QGIS, ArcGIS | prefeitura, órgão ambiental, consultoria | latitude e longitude, SIRGAS 2000 |
| GeoJSON | QGIS, mapas na web | desenvolvedor, sistema web | latitude e longitude |
| GPX | GPS de navegação (Garmin e afins) | quem vai andar a divisa | latitude e longitude |
| CSV | Excel, LibreOffice | quem quer a lista de pontos | UTM e geográficas |
| TXT | coletora GNSS | equipe de campo, locação | UTM (P,E,N,Z,D) |

## KML e KMZ: para quem vai ver a área no mapa

O KML é o formato do Google Earth: abre com dois cliques e mostra o polígono sobre a imagem de satélite. É o arquivo que o cliente, o banco e o comprador conseguem abrir sem programa técnico.

O KMZ é o mesmo KML compactado. Pela documentação do Google, um KMZ é um KML principal, com ou sem arquivos de apoio, empacotado num zip. Na prática, sai menor e passa melhor por e-mail e WhatsApp.

O KML do Vertces leva as coordenadas em SIRGAS 2000, em longitude e latitude, que é o que o Google Earth espera. Para imóvel rural, a diferença entre SIRGAS 2000 e WGS 84 não aparece na escala de quem olha a fazenda no mapa.

## DXF e pacote CAD: para o desenhista

O DXF é o formato de troca do CAD: abre no AutoCAD, nos programas de topografia, no QGIS e na maioria das coletoras. O Vertces gera DXF em UTM, com camadas que dizem o que contêm:

- **PERIMETRO, GLEBAS, VERTICES**: a geometria. Polígono como polilinha fechada, vértice como ponto com a altitude no Z.
- **ROTULOS_…**: o nome de cada feição, ao lado do vértice ou no meio do polígono.
- **SEGMENTOS**: azimute e distância no meio de cada lado.
- **CONFRONTANTES**: o nome do confrontante de cada trecho, por fora da divisa.

O desenhista liga e desliga o que quiser. A altura dos textos acompanha o tamanho da área, para que nem um imóvel de 2 km fique ilegível nem um lote pequeno fique coberto de letra.

O DXF tem uma limitação: ele não guarda o sistema de coordenadas. Por isso existe o **pacote CAD**, um .zip com o DXF, o arquivo .prj do fuso UTM e um LEIAME que explica como abrir no CAD e como definir o SRC da camada no QGIS. Se o arquivo vai para alguém que você não conhece, mande o pacote. Se tiver dúvida sobre o fuso, veja [como descobrir o fuso UTM em SIRGAS 2000](/blog/sirgas-2000-fuso-utm-como-descobrir/).

## Shapefile e GeoJSON: para QGIS, ArcGIS e sistemas

O shapefile (SHP) é o formato mais aceito em geoprocessamento e em órgãos públicos. Ele é um conjunto de arquivos (.shp, .shx, .dbf, .prj, .cpg) que só funciona junto, então o Vertces entrega tudo num .zip. As coordenadas saem em grau, SIRGAS 2000, com o .prj indicando o sistema.

Quando a área tem linhas e pontos além do polígono, eles saem em arquivos separados dentro do mesmo zip, como o SHP exige.

O GeoJSON é o formato dos mapas na web e abre direto no QGIS. É o que você manda para um desenvolvedor, para um sistema que vai mostrar o imóvel num mapa ou para quem prefere um arquivo só, em texto.

Atenção ao CAR: o SHP do Exportar traz a área do imóvel. O cadastro no SICAR pede as camadas de reserva legal, APP, vegetação nativa e área produtiva separadas. Para isso existe o serviço de CAR do Vertces, explicado em [como fazer o CAR e o shapefile do SICAR](/blog/car-shapefile-sicar-reserva-legal-app/).

## GPX: para andar a divisa com o GPS

O GPX é o formato do GPS de navegação, o aparelho de mão que o cliente ou o capataz usa para andar a divisa. Cada vértice vira um ponto com nome e altitude (o GPS lista e deixa “ir até”), e o perímetro vira uma trilha fechada, desenhada inteira na tela.

É útil para mostrar ao proprietário por onde passa a divisa, para conferir cerca e para o vizinho acompanhar. Não é ferramenta de locação de precisão: GPS de navegação erra metros. Para implantar marco, use a coletora com o TXT.

## CSV e TXT: para planilha e para a coletora

O CSV traz a lista de pontos para abrir no Excel: nome, E, N, latitude, longitude e altitude. Sai com ponto e vírgula como separador e vírgula decimal, que é como o Excel em português abre sem assistente de importação.

O TXT é para a coletora GNSS, no formato **P,E,N,Z,D** (ponto, leste, norte, cota, descrição), sem cabeçalho. É o formato que as coletoras importam para locação. O Vertces encurta os nomes, tira acento e evita nome repetido, porque a coletora costuma recusar ponto com nome duplicado.

O uso típico é voltar ao campo para reimplantar um marco ou locar uma divisa nova de desmembramento ou de partilha. Sobre isso, veja [divisão de terra entre herdeiros](/blog/divisao-de-terra-entre-herdeiros/), que gera o arquivo de locação dos marcos.

## Como exportar no Vertces

O botão **Exportar** fica no cabeçalho de todo serviço: georreferenciamento, loteamento e CAR. O passo a passo:

1. Abra o serviço com o perímetro conferido (pelo menos três vértices).
2. Clique em **Exportar** no cabeçalho.
3. Escolha o formato. O menu mostra, ao lado de cada um, para que ele serve.
4. O arquivo baixa na hora. Nos formatos em UTM, o nome do arquivo leva o fuso.

Antes de gerar, o sistema grava o que estiver pendente na tela. Assim o arquivo sai com o desenho atual, e não com o do último salvamento automático. O arquivo é montado no servidor a partir do serviço salvo no banco, com o mesmo contorno que vai nos documentos. É a mesma área do memorial, da planilha e da planta.

## Cuidados que valem para qualquer formato

Três cuidados evitam a maior parte dos problemas:

1. **Confira o fuso** antes de mandar qualquer arquivo em UTM. Coordenada certa no fuso errado cai a centenas de quilômetros.
2. **Mande o .prj junto** quando o destinatário vai abrir em SIG. No DXF, use o pacote CAD.
3. **Não reedite o arquivo exportado** para corrigir divisa. Corrija no serviço e exporte de novo; senão o KML do banco e o memorial do cartório deixam de bater.

Os documentos formais do cartório (memorial, planilha ODS, planta) não saem por aqui: eles têm seus próprios botões. Para o que cada um contém, veja [memorial descritivo de georreferenciamento](/blog/memorial-descritivo-georreferenciamento/) e [planta de georreferenciamento A1 e A3](/blog/planta-georreferenciamento-a1-a3/).

Quer ver a exportação com um levantamento seu? [Agende uma demonstração](/#contato).
