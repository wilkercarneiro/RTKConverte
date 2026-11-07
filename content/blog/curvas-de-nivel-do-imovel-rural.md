---
{
  "titulo": "Curvas de nível do terreno: como gerar as do imóvel rural e até onde confiar",
  "seoTitulo": "Curvas de nível do terreno do imóvel rural | Vertces",
  "descricao": "Curvas de nível do terreno a partir das cotas dos marcos GNSS e do modelo digital público de ~30 m: método, intervalo, DXF e KML, 3D e o limite honesto.",
  "slug": "curvas-de-nivel-do-imovel-rural",
  "data": "2026-11-07",
  "atualizado": "2026-11-07",
  "categoria": "funcionalidades",
  "palavraChave": "curvas de nível do terreno",
  "palavrasRelacionadas": ["gerar curvas de nível", "curvas de nível dxf", "curva de nível kml google earth", "modelo digital de elevação srtm", "curva mestra e intermediária", "relevo do imóvel rural 3d"],
  "resumo": "Curvas de nível são linhas que ligam pontos de mesma cota e mostram o relevo do terreno no papel. No Vertces, elas saem das cotas dos vértices medidos com GNSS e, no miolo do imóvel, do modelo digital de elevação público de cerca de 30 m, ajustado para passar nos marcos. O resultado é indicativo, exporta em DXF e KML e abre em 3D, mas não é levantamento planialtimétrico.",
  "faq": [
    { "p": "Curva de nível do modelo público serve para projeto de obra?", "r": "Não. Para projeto de terraplanagem, drenagem ou estrada, o terreno precisa de levantamento planialtimétrico com pontos no miolo. As curvas do modelo servem para ver o relevo, orientar o campo e conversar com o cliente." },
    { "p": "Por que as curvas não aparecem no meu serviço?", "r": "Porque os vértices precisam ter altitude. Se o arquivo do levantamento veio sem a coluna de altitude (h), não há cota para ajustar o modelo, e o painel avisa isso." },
    { "p": "As curvas exportadas abrem no AutoCAD e no QGIS?", "r": "O DXF é R12, em UTM no fuso do serviço, com as curvas em polilinhas na elevação da cota, nas camadas CURVAS_MESTRAS e CURVAS_INTERMEDIARIAS, além do perímetro e dos marcos. É o formato mais aceito por programas de CAD e GIS." },
    { "p": "Qual a diferença entre altitude do GNSS e a do modelo?", "r": "O GNSS dá altitude elipsoidal; o modelo digital usa altitude próxima da ortométrica. O Vertces absorve essa diferença pela mediana da diferença nos marcos, antes do ajuste fino." },
    { "p": "Em área de mata as curvas ficam piores?", "r": "Ficam menos confiáveis no miolo. O radar que gerou o modelo público mede, em mata fechada, parte da copa das árvores. O ajuste aos marcos corrige a inclinação geral, mas não os detalhes entre eles." }
  ],
  "fontes": [
    { "titulo": "NASA Earthdata: Shuttle Radar Topography Mission (SRTM)", "url": "https://www.earthdata.nasa.gov/data/instruments/srtm" },
    { "titulo": "Tilezen Joerd: fontes dos tiles de elevação (SRTM de 30 m em terra)", "url": "https://github.com/tilezen/joerd/blob/master/docs/data-sources.md" }
  ]
}
---

Curvas de nível do terreno são linhas que ligam pontos de mesma cota, desenhadas a intervalos fixos (por exemplo, de 1 em 1 m), para mostrar o relevo numa planta. Quanto mais juntas, mais íngreme o terreno. O jeito certo de gerar curvas para projeto é o levantamento planialtimétrico, com pontos no miolo; para ver o relevo do imóvel rural sem esse levantamento, dá para combinar as cotas dos marcos GNSS com um modelo digital de elevação público, e é isso que o Vertces faz, com o limite dito claramente.

## Como se lê uma curva de nível?

Cada linha é uma cota. Entre duas curvas vizinhas, o desnível é sempre o mesmo: a **equidistância**, ou intervalo.

- **Curva mestra:** mais grossa e com a cota escrita, a cada cinco intervalos (de 5 em 5 m quando o intervalo é 1 m; de 10 em 10 m quando é 2 m).
- **Curva intermediária:** mais fina, entre as mestras.
- **Curvas juntas:** encosta íngreme. **Curvas espaçadas:** terreno suave.
- **Curvas em "V" apontando para cima do morro:** vale ou grota. Apontando para baixo: espigão.
- **Curvas fechadas concêntricas:** topo de morro (ou depressão).

O intervalo depende do desnível. Num imóvel com 15 m de desnível, curvas de 1 m dão 15 linhas e leem bem. Num com 300 m, curvas de 1 m viram um borrão.

## De onde vêm as cotas para traçar as curvas?

As cotas vêm de pontos medidos ou de um modelo digital de elevação. São fontes com precisões muito diferentes.

| Fonte | Como é | Precisão típica | Serve para |
|---|---|---|---|
| Levantamento planialtimétrico | Pontos com cota medidos no terreno todo | Centímetros a decímetros | Projeto de obra, terraplanagem, drenagem |
| Marcos do georreferenciamento | Cota medida só nos vértices do perímetro | Centímetros, mas só na divisa | Saber a cota da divisa |
| Modelo digital de elevação público | Grade de cotas por satélite ou radar | Metros, com pixel de ~30 m | Ver o relevo, orientar o campo |

O modelo público mais usado é o da missão SRTM, feita com radar a bordo do ônibus espacial Endeavour em fevereiro de 2000. Em terra, ele tem pixel de cerca de 30 m. Um pixel de 30 m não vê um barranco de 3 m nem uma vala.

## Como o Vertces gera as curvas do imóvel?

O Vertces junta as duas fontes que o georreferenciamento já tem: as cotas medidas nos marcos e o modelo público no miolo. O método tem quatro etapas.

1. **Relevo de fundo.** O sistema lê o modelo digital de elevação público (SRTM/NASADEM, pelos tiles de elevação da AWS, os mesmos do módulo de loteamento) sobre o imóvel e uma margem em volta.
2. **Nivelamento.** O modelo é trazido para o nível do levantamento pela mediana da diferença entre as duas cotas nos marcos. Isso absorve a diferença entre a altitude elipsoidal do GNSS e a do modelo, e o viés do modelo na região.
3. **Tendência.** Um plano ajustado por mínimos quadrados às diferenças que sobram tira a inclinação sistemática do modelo, comum em área de mata.
4. **Correção local.** O resto da diferença é espalhado em volta de cada marco e perde força com a distância. Perto do marco, o terreno passa na cota medida; no miolo, longe de todos, sobra o modelo nivelado e inclinado.

Depois, as curvas são traçadas sobre a grade ajustada e recortadas no perímetro. O intervalo automático é o menor entre 1, 2, 5 e 10 m que dá até 30 curvas no desnível do imóvel. Você também pode escolher 1, 2, 5 ou 10 m.

## Até onde dá para confiar nessas curvas?

Nos marcos, a cota é a do levantamento. No miolo, é a do modelo público corrigido. Isso vale como indicação do relevo, não como levantamento planialtimétrico.

O sistema mostra o quanto o modelo se afastava do levantamento antes do ajuste: a diferença média (RMS) e a máxima nos marcos com altitude. É a ordem de grandeza da incerteza no miolo. Se o modelo errava 4 m nos marcos, não espere precisão de 1 m entre eles.

Três situações pedem ainda mais cuidado:

- **Mata fechada:** o radar mede parte da copa, e o miolo fica "alto".
- **Relevo movimentado entre marcos:** uma grota no meio do imóvel, longe da divisa, depende só do modelo.
- **Sem rede:** sem o modelo público, as curvas saem só da interpolação entre as cotas dos marcos, e o miolo não tem informação de relevo. O painel avisa.

Um exemplo. No Sítio Boa Esperança, de 32 ha, os marcos vão de 412 m a 437 m. As curvas automáticas saem de 1 em 1 m, com mestras a cada 5 m. A nota diz que o modelo diferia do levantamento 2,1 m em média nos marcos: é com essa margem que você lê o miolo.

## Para que servem as curvas do georreferenciamento?

Servem para entender o terreno antes de decidir. Usos comuns:

- **orientar o campo:** onde o terreno é íngreme e o acesso é difícil;
- **conversar com o cliente** sobre onde pôr a casa, o galpão ou a represa;
- **primeira estimativa** de [corte e aterro para uma plataforma](/blog/terraplanagem-calculo-corte-e-aterro/), antes do levantamento planialtimétrico;
- **ilustrar o relatório** com o relevo do imóvel e os marcos;
- **apoiar o estudo de loteamento**, em que o relevo pesa no traçado das ruas; veja [o software de loteamento pela Lei 6.766](/blog/software-loteamento-lei-6766/).

Para projeto executivo, volte ao campo e levante o miolo.

## Como fazer no Vertces

As curvas de nível ficam dentro do serviço de georreferenciamento, na conferência, no mesmo mapa em que você confere os vértices e os confrontantes.

1. **Envie o levantamento** com a altitude dos vértices (o h do receptor). O fluxo de leitura está em [como converter o TXT do GNSS](/blog/txt-receptor-gnss-para-sigef/).
2. **No mapa da conferência, clique em Relevo**, ao lado de Satélite e Esquema. O sistema lê o modelo público e calcula as curvas no navegador.
3. **Escolha o intervalo:** Automático (com o valor sugerido entre parênteses) ou 1, 2, 5 ou 10 m.
4. **Leia a legenda e a nota.** A legenda traz a mestra e a intermediária, os marcos e a faixa de cotas do imóvel com o desnível. A nota explica a fonte, e o "?" mostra o ajuste: RMS e máximo antes, e o que sobrou nos marcos depois.
5. **Baixe.** **Baixar DXF** gera o R12 em UTM com as camadas CURVAS_MESTRAS, CURVAS_INTERMEDIARIAS, PERIMETRO, MARCOS e NOTA_RELEVO, com a cota como elevação e escrita nas mestras. **Baixar KML** leva para o Google Earth, com mestras e intermediárias em pastas separadas.
6. **Veja em 3D.** **Ver em 3D** abre o terreno do imóvel com o satélite como textura, as curvas e os marcos de pé com o código. É a mesma maquete do loteamento, só com a gleba.

A nota de origem vai junto no DXF e no KML: cotas dos vértices pelo levantamento GNSS, miolo pelo modelo público de cerca de 30 m ajustado aos vértices, indicativo, não é levantamento planialtimétrico. Assim, quem abrir o arquivo depois não confunde as curvas com levantamento. Outros formatos da área estão em [exportar KML, DXF, shapefile e GPX](/blog/exportar-kml-dxf-shapefile-gpx/).
