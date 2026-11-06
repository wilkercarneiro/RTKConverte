# Concorrência: MapMetria (mapmetrica.com) × Vertces

Análise de 05/11/2026, a pedido do Wilker ("verifique o que ele tem que não temos e como podemos aplicar na nossa realidade"), feita navegando a conta do grupo no Edge (plano vencido, sem projetos salvos), em ritmo de uso normal, sem gastar crédito.

> **Termos de uso deles:** a cláusula 10 proíbe "reprodução, cópia ou engenharia reversa sem autorização prévia" e diz que funcionalidades e design são deles. Por isso este documento registra só **ideias de função**. Telas, textos, nomes e código do Vertces continuam próprios.

## O produto

Os módulos são: imóvel rural (memorial SIGEF), imóvel urbano (com edificação e recuos), CAR, análise de terreno, loteamento, dossiê do imóvel e terraplanagem, além de uma ferramenta solta de divisão de área, um GPS de campo no celular e a academia de vídeos.

- **Cobrança:** edita tudo de graça e paga só ao finalizar (1 crédito por projeto sem plano).
- **Preços:** mensal a R$ 149; anual em 12× de R$ 72,29 no cartão ou R$ 699 à vista; empresarial sob consulta.
- **Fluxo rural:** 5 etapas, cerca de 8 cliques até finalizar.
- **Divisão:** 5 cliques, com memorial e KML por parte.

## Onde o Vertces já está na frente

- Leitura de qualquer arquivo de pontos, com IA.
- Conferência do TXT com ajuste de pontos.
- Confrontantes certificados pelo Geoportal do INCRA. Eles perderam o acesso ao SIGEF e usam declarações do CAR.
- Planta A1.
- Sete peças técnicas e declaração de faixa de domínio.
- GEO completo por parte da divisão.
- Loteamento com gerador, prancheta, 3D, redes, memoriais, DXF e locação.
- CAR com reserva legal e APP calculadas. No deles, tudo é desenhado à mão.
- Equipe com permissões e multiempresa.
- Integração com o GPROL.
- **Motor de área único.** Lá, o mesmo KML deu 22,5 ha na divisão e 5,47 ha no CAR.

## O que eles têm e como ficou no Vertces

| Ideia | No Vertces (05/11/2026) |
|---|---|
| Arquivos da área em CAD/SIG no serviço (DXF em camadas, .prj, KML) | **Feito:** "Exportar" em todos os serviços. KML, KMZ, DXF em camadas, pacote CAD (.zip com DXF, .prj e LEIAME), GPX, SHP, GeoJSON, CSV e TXT para a coletora. |
| Divisão por área definida + remanescente, destacar por um lado, linha de corte | **Feito:** desmembramento na etapa Divisão. Remanescente e desmembradas, área digitada, lado escolhido, divisa desenhada à mão e documentos de cada área (memorial, tabular, planta, planilha). |
| Recuo de rodovia (eles têm só a largura do desenho) | **Feito, à frente deles:** faixa de domínio (BR pelo DNIT, BA pela SEINFRA), não edificável pela Lei 6.766 e alerta de invasão da faixa (DNIT). Ver `docs/recuo-rodovias.md`. |
| Mapa: no editor rural ocupa ~42% da tela e não tem tela cheia | **Feito:** telas de trabalho sem mapa achatado e botão de tela cheia em todos os mapas de trabalho (loteamento, divisão, CAR, SIGEF, glebas, leitura do arquivo, seleção na planta); a maquete 3D já abre na tela toda. |
| Plano anual parcelado em 12× | **Feito:** autocadastro com plano e período (mensal, semestral, anual), Pix ou cartão. Até 6× sem juros, até 12× no máximo. |
| Monografia do marco (PDF/DOCX) | Próximo: nova peça técnica, em lote para os marcos M. |
| Prévia da planilha SIGEF + avisos de consistência antes de baixar | Próximo: modal com a tabela e alertas (todos M, σ igual, método ausente). |
| Curvas de nível e 3D do terreno no serviço GEO | Próximo: reaproveitar o relevo e a maquete do loteamento. |
| Análise de restrições (IBAMA, TI, UC, assentamentos) e dossiê com prévia grátis | Próximo (maior): camadas públicas no mapa interativo e uma prévia como isca comercial. |
| Assinatura do RT nos documentos; QR de autenticidade na planta | Próximo (pequeno). |
| Renomear vértices em lote; inserir ponto entre vértices | Próximo (pequeno). |
| Academia com progresso; perguntas sugeridas no chat | Próximo (pequeno). |
| Ortomosaico de drone como fundo | Avaliar depois (arquivos grandes). |

## Módulos vistos por dentro em 06/11/2026

Em 05/11 só os cartões da página inicial foram lidos. Em 06/11 os módulos foram abertos e usados na conta do grupo, com o plano vencido. A consulta e a análise rodaram sem pedir crédito. O ponto de teste foi -12,40 / -41,20, em Lençóis (BA).

### GPS Campo (`/campo`)
- O mapa é Leaflet com satélite do Google. Um seletor de data troca a imagem por datas antigas do Esri World Imagery Wayback (2025-10-29, 2025-09-…, 2025-08-…).
- Há quatro jeitos de criar a área:
  - medição automática pelo GPS do celular, caminhando;
  - modo manual com GPS, marcando o vértice por toque;
  - desenho à mão;
  - importação de arquivo.
- Arquivos aceitos na importação: KML, KMZ, XML, GML, GeoJSON, GPX, SHP/ZIP, DXF, CSV, TXT e GPKG.
- Fundo próprio: GeoTIFF, ou JPG/PNG/TIFF com world file (.tfw, .jgw, .pgw) e .prj. O botão "Reconectar arquivo grande" guarda o arquivo no próprio aparelho.
- Configurações:
  - modo alta precisão, para pontos a 1–2 m;
  - precisão máxima aceitável, 8 m por padrão;
  - cálculo em UTM plano ou geodésico (Vincenty e Karney, recomendado para o rural);
  - formato da área.
- Também tem ir até coordenada, UTM ou link do Google Maps, salvar medição e medições salvas.

### Consulta Avançada (`/consulta-avancada`)
- A busca é por nº do CAR, SNCR/NIRF, matrícula ou coordenada (digitada ou clicada no mapa).
- Cada imóvel achado mostra código, área, município, KML e GeoJSON. Há também "Baixar todos" em KML e GeoJSON.
- Tudo passa pela função `terrain-report` deles.
- **Atenção:** os resultados aparecem com a etiqueta "SIGEF/INCRA", mas os códigos (BA-2919306-…) e a fonte (`sicar:ba`) são do **CAR**. Eles vendem declaração do CAR como se fosse SIGEF.

### Análise de Terreno (`/analise-terreno`)
- Define a área de três jeitos:
  - buscar imóvel por CAR, SNCR/SIGEF, matrícula, endereço, link do Google Maps ou coordenada (aceita decimal, GMS e UTM);
  - GPS em tempo real;
  - importar arquivo.
- Do imóvel achado saem "Usar como perímetro" e "Analisar dados ambientais".
- A análise cruza SIGEF/INCRA, embargos do IBAMA, terras indígenas, quilombolas, UC, assentamentos, bioma (IBGE), focos de queimada (INPE), solo (SoilGrids, classe WRB), clima (Open-Meteo) e a localização administrativa. Leva de 20 a 30 s.
- O relatório tem as abas Resumo, Imóveis, Resolver, Alertas e Fontes. Sai em JSON, KML e PDF.
- No resumo do teste vieram:
  - área e centro;
  - chuva de 365, 30 e 7 dias e a temperatura média;
  - solo (Ferralsols);
  - avisos.
- Botão "Gerar Laudo com IA" junta tudo num laudo técnico.
- O bloco "Cartório / ônus / hipoteca / bloqueio judicial" está como "em breve" (depende do ONR, que é pago).

### Terraplanagem (`/terraplanagem`)
- Não deu para abrir: a extensão do navegador caiu antes. Pelo cartão, ela faz levantamento com cotas, plataforma projetada e volumes de corte e aterro. **Pendente.**

### O que isso muda para o Vertces

| Deles | Vertces hoje | Proposta |
|---|---|---|
| GPS de campo no celular (caminhar ou tocar o vértice) | Não existe. Não há `geolocation` no código. | Tela "Campo" de celular: caminhar e marcar M/P com a precisão do GPS e um limite. Serve para croqui e CAR, não para o SIGEF. O resultado vira serviço de CAR ou de loteamento. |
| Imagem por data (Wayback) | Satélite do Mapbox, só a imagem atual | Seletor de data no mapa interativo, útil para provar área consolidada antes de 22/07/2008 no CAR |
| Fundo GeoTIFF ou ortomosaico | Não existe | Já estava em "avaliar depois". O GPS deles mostra que é viável no navegador. |
| Busca por CAR, SNCR, matrícula ou coordenada com KML do resultado | Mapa SIGEF com parcelas certificadas (Geoportal) | Juntar a camada pública do CAR (SICAR/GeoServer) à busca, sempre marcando a fonte certa. CAR é declaração, não certificação: é aí que podemos ser mais honestos do que eles. |
| Clima, solo, queimadas e laudo por IA na análise | A análise de restrições (05/11) cobre TI, UC, assentamento, quilombola, embargos, fronteira, militar e arqueológico, mas não clima, solo nem queimadas | Acrescentar Open-Meteo, SoilGrids e focos do INPE (são públicos) e um laudo por IA opcional, cobrado em crédito |
| Terraplanagem (corte e aterro) | Corte e aterro só dentro da maquete do loteamento (ruas e platô das casas) | Esperar a terraplanagem deles ser vista. O relevo do loteamento (`src/lib/relevo`) já tem a base para volumes de uma plataforma. |

## O que não copiar

- Mapa pequeno que rouba a rolagem da página.
- Barra de desenho genérica em inglês.
- Etapa de passagem que só gasta um clique.
- Avançar etapa sem os dados obrigatórios.
- Recuos só declarativos.
- Chamar DXF de "DWG".
- Dossiê que dispara sozinho (para o que custa crédito, confirmar antes).
- Sobreposição checada contra declarações do CAR.
- Motores de área diferentes por módulo.
- IA só no plano caro: no Vertces ela é parte da leitura do arquivo.
