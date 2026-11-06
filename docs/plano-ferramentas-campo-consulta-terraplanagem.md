# Plano: Consultar imóvel, Medir no campo, Imagem por data e Terraplanagem

06/11/2026. Origem: a análise da MapMetria por dentro (`docs/concorrencia-mapmetrica.md`, seção "Módulos vistos por dentro"). Pedido do Wilker: "o objetivo é sempre facilitar a vida do usuário".

São quatro frentes. Cada uma resolve um problema real do agrimensor ou do escritório, e não é uma cópia de tela. Nenhuma exige serviço aberto: ficam no menu, num grupo novo chamado **Ferramentas**. O resultado de qualquer uma delas vira um serviço com um clique.

## 0. Princípios (valem para as quatro frentes)

1. **Uma pergunta por vez, e a próxima ação sempre à mão.** Cada tela termina com o que o usuário provavelmente quer fazer em seguida: analisar, baixar, criar o serviço ou medir.
2. **Nada de abas para o usuário escolher o tipo de entrada quando o sistema pode adivinhar.** Uma caixa só entende código do CAR, código do SIGEF, coordenada (decimal, GMS, UTM) e link do Google Maps.
3. **Fonte honesta.** CAR é "declarado pelo proprietário" e traz a situação ("aguardando análise"). SIGEF é "certificado pelo INCRA". Base pública é "alerta, não certidão". A MapMetria chama CAR de SIGEF; nós não fazemos isso.
4. **Um motor de área só.** A área de qualquer polígono sai em UTM no fuso do lugar, pela fórmula de Gauss: `fusoDoLon` e `areaUtmM2` em `src/lib/restricoes.ts`, o mesmo cálculo do resto do sistema. O mesmo polígono nunca mostra duas áreas diferentes.
5. **Não perder trabalho.** Medição de campo e terraplanagem gravam sozinhas, no aparelho e na conta.
6. **Regras de design do Vertces**, que valem em toda tela nova:
   - Grade de formulário: use as classes balanceadas por `src/lib/grade.ts` (`.grade`, `.grade-2/3`, `[data-grade]`, `.largo`). Nenhum campo fica sozinho na última linha.
   - Explicação vira um "?": `Dica`, `Rotulo` e `Secao dica=` de `src/components/ui.tsx`. Avisos, pendências e status continuam visíveis.
   - Botões da mesma ação ficam na mesma linha, sem espaço em branco solto.
   - Botão com cor própria leva o hover em `button.X:hover:not(:disabled)`. Senão a regra global do `styles.css` pinta o texto de verde sobre fundo verde.
   - Zoom .8 na raiz: menu `position: fixed` passa por `src/lib/zoom.ts`. A altura usa `var(--vh)`.
   - Mapa de trabalho tem `BotaoTelaCheia` (`src/components/TelaCheia.tsx`) e não fica achatado.
   - Reaproveitar as peças prontas: `CabecalhoPagina`, `Secao`, `EstadoVazio`, `EstadoErro`, `Esqueleto`, `Abas`, `Gaveta`, `avisar`, `confirmar`, `ProximaAcao`.
   - Melhoria aparece ligada por padrão. Opção desligada não existe para o usuário.
   - Português do Brasil, com os termos do agrimensor (vértice, perímetro, cota, corte, aterro, talude).
   - A tela funciona em 1366×768, em 1920×1080 e no celular (390×844).
7. **Sem dependência nova no npm.** O `package.json` tem alterações do Wilker ainda não commitadas. Também não mexer em `index.html`, `app/index.html`, `content/` nem `docs/comercial/`.
8. **Laboratório para cada tela** (`#/lab/<nome>`, só no `npm run dev`), com dados de exemplo gravados em fixture. Ele abre sem login e sem internet, para conferir por captura de tela.

## 1. Consultar imóvel (`#/consulta`)

**Problema:** antes de fechar um serviço, o agrimensor quer saber o que existe naquele lugar: CAR, SIGEF, sobreposição com terra indígena, UC, assentamento, embargo e queimada. Hoje ele precisa abrir um serviço, ou ir ao SICAR, ao SIGEF e ao IBAMA um por um.

**Fluxo:**
1. **Encontrar a área.** Uma caixa só ("Cole o código do CAR, uma coordenada ou um link do Google Maps"):
   - **Código do CAR** (`UF-IBGE-HASH`): busca no WFS público do SICAR. `https://geoserver.car.gov.br/geoserver/sicar/wfs`, camada `sicar:sicar_imoveis_<uf>`, filtro `CQL_FILTER=cod_imovel='…'`. O CORS foi conferido em 06/11 e libera o vertces.com.br. Campos: `cod_imovel, status_imovel, condicao, area, municipio, uf, m_fiscal, tipo_imovel, data_atualizacao`.
   - **Coordenada:** decimal, GMS ou UTM com fuso, digitada ou clicada no mapa. Busca o CAR por BBOX/INTERSECTS no ponto e o SIGEF pela base que o sistema já tem (`src/lib/sigef.ts`: parcelas certificadas no PostGIS e o Geoportal).
   - **Link do Google Maps:** o sistema extrai lat/lon e segue como coordenada.
   - **Código/parcela do SIGEF:** se a base do sistema permitir a busca por código.
   - **"Enviar arquivo"** (KML/KMZ/GPX/GeoJSON) com os leitores que já existem (`src/lib/car/kml.ts`, `gpx.ts`).
   - **"Desenhar no mapa".**
2. **Resultados:** lista e mapa juntos. Cada imóvel mostra:
   - o selo da fonte (**CAR · declarado** com a situação, ou **SIGEF · certificado**);
   - a área (no nosso motor e também a declarada, quando forem diferentes);
   - município/UF e a data de atualização.

   Clicar seleciona o imóvel. Quando há um só, ele já vem selecionado.
3. **Ações da área selecionada**, todas na mesma linha:
   - **Analisar** (principal);
   - **Baixar ▾**: KML, KMZ, GeoJSON, SHP, DXF, GPX, CSV, pelo `exportarArea` de `src/lib/exportar`;
   - **Criar serviço de CAR com esta área**: `transferirArea` de `src/lib/area_transferida.ts` e depois `#/novo/car`. O `CarNovo` lê com `pegarAreaTransferida()` e já abre com o perímetro carregado.
4. **Análise** (na mesma tela, sem trocar de página):
   - Restrições, com o motor existente `consultarRestricoes` (`src/lib/restricoes.ts`): TI, UC, assentamento, quilombola, embargos IBAMA/ICMBio, fronteira, militar e arqueológico.
   - **Novas, no "Ambiente":**
     - Clima pelo Open-Meteo (`archive-api.open-meteo.com`, CORS ok): chuva de 12 meses, chuva de 30 dias e temperatura média.
     - Solo pelo SoilGrids (`rest.isric.org/soilgrids/v2.0/classification/query`, CORS ok): a classe WRB **com nome e explicação em português** (Ferralsols → Latossolos).
     - Bioma pelo IBGE.
     - Focos de queimada do INPE nos últimos 12 meses dentro do imóvel e num raio de 1 km. O WFS `terrabrasilis.dpi.inpe.br/queimadas/geoserver` **não tem CORS**, então a consulta passa pela função nova `analise-imovel` (ação `focos`, lista fechada de hosts).
     - Município pela API de localidades do IBGE.
   - **No topo, uma frase:** "Nenhuma restrição encontrada · 2 avisos", ou "Sobrepõe a Terra Indígena X em 3,2 ha". Embaixo vêm os cartões por tema. Cada fonte que falhou diz que falhou, e o resto segue.
   - **PDF** com tudo, estendendo `src/lib/restricoes_pdf.ts`.
   - **Laudo por IA** (botão "Escrever o laudo"): a função `analise-imovel`, ação `laudo`, usa o mesmo provedor do `ler-arquivo` (`supabase/functions/_shared/leitor/ia.ts`) para escrever um parecer técnico só com os dados coletados. Não inventa nada e cita a fonte de cada afirmação. O laudo entra no PDF. O limite é por empresa (20 por dia), contado na tabela da migração **0045_analises_imovel**, que também guarda o histórico de consultas da empresa (com RLS por escritório, no padrão das migrações 0042/0043).
   - A análise fica no histórico: "Consultas recentes" aparece no estado vazio da tela.
5. **Custo:** a consulta e a análise não gastam crédito. O laudo por IA também não, dentro do limite.

**Laboratório:** `#/lab/consulta`, com resultado do CAR e da análise gravados em fixture (o ponto de Lençóis/BA: -12,40 / -41,20). Também mostra os estados: carregando, nada encontrado e fonte fora do ar.

## 2. Medir no campo (`#/campo`), pensada para o celular

**Problema:** na visita ao imóvel, para o CAR, um orçamento ou um croqui, o agrimensor quer o contorno sem levar o GNSS. Hoje ele usa outro app e manda KML pelo WhatsApp.

**Fluxo:**
- **Tela cheia.** Mapa de satélite, o ponto azul do GPS com o círculo de precisão, e uma barra de baixo com botões grandes, alcançáveis com o polegar.
- **Dois modos, um botão cada:**
  - **"Caminhar"**: cria um vértice automaticamente a cada N metros (5 m por padrão) ou quando a direção muda mais de 15°.
  - **"Marcar ponto aqui"**: junta as leituras por alguns segundos e mostra "±2,8 m". Se a precisão for pior que o limite (8 m por padrão), avisa e pergunta se marca assim mesmo.
- **Enquanto mede:**
  - área e perímetro ao vivo, no motor único;
  - número de vértices e cor da precisão (verde ≤ 3 m, âmbar ≤ 8 m, vermelho acima);
  - **Desfazer**, **Pausar** e **Fechar a área**.
- **Tela acordada** (Wake Lock, quando o aparelho permite).
- **Não perde nada:** cada vértice é gravado na hora no aparelho (IndexedDB/localStorage). Se a página fechar, ao voltar aparece "Continuar a medição de hoje 14:32 (23 vértices)?".
- **Salvar na conta:** tabela da migração **0044_medicoes_campo** (RLS por escritório). Assim a medição aparece no computador do escritório e entra na lista "Medições salvas".
- **Depois de fechar a área:**
  - **Criar serviço de CAR com esta área** (`transferirArea`);
  - **Consultar/analisar** (abre `#/consulta` já com a área);
  - **Baixar ▾** (KML, GPX, SHP…);
  - **Renomear**.
- **Aviso fixo, curto e honesto:** "GPS do celular: ±3 a 10 m. Serve para croqui, orçamento e CAR, não para georreferenciamento SIGEF."
- **Fundo:** satélite atual e o seletor de **imagem por data** (frente 3).
- **Sem GPS** (no computador ou sem permissão), a mesma tela permite desenhar à mão. A mensagem explica como liberar a localização.

**Laboratório:** `#/lab/campo`, com um trajeto de GPS simulado de fixture: posições com precisão variável tocadas em sequência, para conferir o modo Caminhar, o Marcar ponto, o Desfazer, a retomada após fechar a página e o Fechar área, no celular e no computador.

## 3. Imagem por data (Wayback)

**Problema:** provar quando uma área foi aberta, construída ou desmatada (consolidação no CAR, conferência de posse, conflito de divisa). Hoje só existe a imagem atual.

- **Fonte:** Esri World Imagery Wayback.
  - Configuração em `https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json` (CORS ok).
  - Tiles em `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/{release}/{z}/{y}/{x}`.
  - Atribuição Esri.
  - As versões começam em 2014: **não prometer 2008**.
- **Biblioteca:** `src/lib/imagem_data.ts`.
  - Lê a configuração, com cache na sessão.
  - **Mostra só as versões em que a imagem mudou naquele lugar.** Compara o tile do centro da área entre as versões (hash do conteúdo), com busca binária e limite de requisições, para não baixar 150 tiles.
  - Quando o serviço de metadados permitir, pega a **data real da captura** ("Imagem de 14/03/2019"). Senão, mostra a data da versão.
- **Componente** `src/components/imagem/SeletorImagemData.tsx`:
  - É um controle de mapa pequeno: "Imagem: atual ▾". A lista é de datas, com miniatura quando der.
  - Contrato: `({ mapa: maplibregl.Map | null, centro: [lon, lat] | null })`. Ele próprio cria e troca a fonte raster por baixo das camadas do imóvel.
  - Botão **"Comparar"**: cortina arrastável entre duas datas.
- **Onde entra:**
  - `MapaInterativo` (painel SIGEF e Consultar imóvel);
  - mapa do Medir no campo;
  - mapa do CAR, se usar MapLibre. Se não usar, anotar a pendência em vez de reescrever o mapa.
  - **Situação (frente Imagem por data, 06/11):** ligado no `MapaInterativo`, o que já cobre o painel SIGEF e o Consultar imóvel. **Pendente: CAR.** O mapa do CAR (`src/components/car/CarEditor.tsx`, `CarNovo.tsx`) é desenhado em SVG, sem MapLibre; o seletor não foi ligado e precisa de um adaptador ou de o CAR passar a usar o `MapaInterativo`. **Pendente: Medir no campo.** O mapa dele está na branch da própria frente; quando juntar, basta `<SeletorImagemData mapa={mapa} centro={centroDaMedicao} />` dentro do contêiner do mapa.
- **Laboratório:** `#/lab/imagem` (o mapa com o seletor; por ser de imagem, este pode depender da rede).

## 4. Terraplanagem (`#/terraplanagem`)

**Problema:** o cliente quer saber quanto custa deixar um terreno plano para galpão, casa ou quadra: o volume de corte e de aterro e quantos caminhões. Hoje o agrimensor faz isso no CAD, à mão.

**Fluxo, numa tela só, com resultado ao vivo:**
1. **Pontos com cota:** enviar o arquivo do levantamento (TXT/CSV com nome, E, N, Z em qualquer ordem e separador). Reusar o leitor do sistema (`supabase/functions/_shared/leitor`, se rodar no navegador; senão, um leitor simples e tolerante). Também aceita **"usar o relevo público"** (o modelo do loteamento, `src/lib/loteamento/terreno.ts`), com o aviso de que é estimativa.
2. **Plataforma:**
   - o contorno dos pontos (padrão), um retângulo desenhado/arrastado no mapa, ou um KML;
   - ajuste opcional de largura e comprimento.
3. **Cota da plataforma:**
   - **"Equilibrar corte e aterro"** é o padrão: o sistema acha a cota em que corte = aterro × fator de empolamento/contração;
   - ou o usuário digita a cota;
   - **inclinação** opcional (% e direção) para escoar água.
4. **Taludes:** corte 1:1 e aterro 1:1,5 por padrão, editáveis. O pé e a crista entram na conta e no desenho.
5. **Resultado, sempre visível e recalculado ao mexer:**
   - volume de corte, volume de aterro e saldo (bota-fora ou empréstimo), em m³;
   - áreas de corte e de aterro;
   - **"≈ 38 caminhões de 12 m³"**, com empolamento de 25%, editável;
   - **mapa colorido** (corte em tons de vermelho, aterro em azul, isolinhas de 0,5 m) e a **linha de passagem** (corte = 0);
   - **seção** pelo meio, nos dois sentidos.
6. **Saídas:**
   - PDF de relatório com mapa, números, seções e método;
   - DXF com terreno (curvas), plataforma, taludes e mapa de corte/aterro em camadas, usando `src/lib/relevo` e `src/lib/exportar`;
   - CSV da malha.
7. **Gravação:** tabela da migração **0046_terraplanagens** (RLS por escritório), com autossalvamento (`useAutosave`) e a lista "Projetos recentes".

**Método:** malha regular (passo automático pela densidade dos pontos) interpolada por TIN, que é a triangulação dos pontos do levantamento. Os volumes são calculados por prisma em cada célula, com corte parcial nas bordas, e a cota de equilíbrio é achada por bisseção. Os testes cobrem a geometria: caixa conhecida, plano inclinado, pirâmide e conferência de que o volume não muda ao girar os pontos.

**Laboratório:** `#/lab/terraplanagem`, com um levantamento de exemplo (fixture) de cerca de 300 pontos num terreno com declive.

## 5. Servidor

| O quê | Arquivo | Para quê |
|---|---|---|
| Migração 0044 | `supabase/migrations/0044_medicoes_campo.sql` | medições do campo |
| Migração 0045 | `supabase/migrations/0045_analises_imovel.sql` | histórico de consultas + laudos + limite |
| Migração 0046 | `supabase/migrations/0046_terraplanagens.sql` | projetos de terraplanagem |
| Função nova | `supabase/functions/analise-imovel` | `focos` (ponte para o INPE, só hosts da lista) e `laudo` (IA) |

A função nova segue o padrão das que existem: autenticação, CORS, e os **mapas de env** do deploy na VPS (`scripts/deploy-functions.sh` e a nota do SaaS: "função nova precisa dos env maps"). **Nada é publicado sem o aval do Wilker.** A publicação vai num script `scripts/publicar-ferramentas.sh`, com simulação por padrão, no modelo do `publicar-melhorias-1105.sh`.

## 6. Como a qualidade é garantida (revisão entre agentes)

Cada frente tem um agente implementador num worktree próprio (`feat/<frente>`). Depois de cada rodada, entram **dois revisores independentes**, que não veem a conclusão do implementador, só o código e a tela:

1. **Revisor técnico:**
   - lê o diff;
   - roda `npx tsc -b`, `npm test` e `npx vite build`;
   - testa os casos de borda: área em dois fusos, polígono com furo/autointerseção, fonte fora do ar, GPS sem sinal, arquivo estranho;
   - confere o motor de área único e a segurança (RLS, chave de IA só no servidor, ponte só para hosts da lista).
2. **Revisor de experiência:**
   - abre o laboratório em 1366, 1920 e 390 px, tira capturas e usa a tela como um agrimensor com pressa;
   - confere as regras de design da seção 0;
   - aponta qualquer clique a mais, texto confuso, campo sozinho ou ação escondida.

O implementador corrige e a rodada se repete, no máximo três vezes, até os dois aprovarem. Por fim, um **integrador**:
- junta as quatro frentes na `main` local;
- liga o seletor de imagem nos mapas do Campo e da Consulta;
- roda tudo de novo.

Um **juiz final** ("isto surpreende o usuário?") revê o conjunto, e o que ele apontar volta como mais uma rodada.

## 7. Fora deste plano (anotado)

- Fundo GeoTIFF ou ortomosaico de drone: precisa de dependência nova (leitor de GeoTIFF). Avaliar depois.
- Ônus, hipoteca e bloqueio da matrícula: só pelo ONR, que é pago por consulta.
- Busca por SNCR/NIRF e por matrícula: não há base pública aberta. Pode entrar depois pela base dos próprios serviços da empresa.
