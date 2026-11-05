# Análise de restrições do imóvel — fontes públicas

Pesquisa e testes de 05/11/2026 (frente D). Código em `src/lib/restricoes.ts`,
testes em `tests/restricoes.test.mjs` (respostas gravadas em
`tests/fixtures/restricoes`, regravar com `node scripts/gravar_fixtures_restricoes.mjs`;
teste contra as bases de verdade com `RESTRICOES_AO_VIVO=1 node --test tests/restricoes.test.mjs`).

## Resumo

Todas as fontes usadas respondem ao **navegador** (CORS testado no Chrome real, a
partir de `https://example.com` e com `Origin: https://vertces.com.br`). Por isso a
consulta é feita no navegador, como o DNIT (`src/lib/dnit.ts`): **não foi criada
edge function** e não há proxy. Nada a publicar na VPS para esta frente.

| Tipo | Servidor principal | Cópia (se o principal cair) | Atualização observada |
|---|---|---|---|
| Terras Indígenas | FUNAI GeoServer `Funai:tis_poligonais` | PAMGIA `01_Publicacoes_Bases/lim_terra_indigena_a` (camada 12) | FUNAI: `data_atualizacao` por TI (até 14/04/2026); cópia: 2017 |
| Unidades de Conservação | INDE (MMA) `MMA:cnuc_2026_03` | PAMGIA `BasesSincronizadas/lim_unidades_conservação_mma_a` | CNUC de mar/2026; cópia com `dt_sync` 11/08/2026 |
| Assentamentos | PAMGIA `BasesSincronizadas/lim_assentamentos_incra_a` | PAMGIA `01_Publicacoes_Bases/assentamentos_incra` (camada 1) | `dt_sync` 25/10/2025 |
| Territórios quilombolas | PAMGIA `BasesSincronizadas/lim_quilombos_incra_a` | IBGE `CGMAT:qg_2022_620_territorioquilombola__v02` (Censo 2022) | `dt_sync` da base vem com datas no futuro (2050): ignorado |
| Embargos IBAMA | PAMGIA `01_Publicacoes_Bases/adm_embargos_ibama_a` (camada 0) | — | `dat_ult_alteracao` por embargo; o serviço diz que sincroniza com o SISCOM 2×/dia |
| Embargos ICMBio | PAMGIA `BasesSincronizadas/lim_embargos_icmbio_a` | PAMGIA `01_Publicacoes_Bases/adm_embargo_icmbio_a` (2022) | `dt_sync` |
| Faixa de fronteira | PAMGIA `BasesSincronizadas/lim_faixa_fronteira_ibge_a` | — | IBGE (polígono único) |
| Áreas militares | PAMGIA `01_Publicacoes_Bases/lim_uso_militar_a` (camada 15, SFB) | — | Cadastro de Florestas Públicas, registros de ~2011 |
| Sítios arqueológicos | PAMGIA `BasesSincronizadas/lim_sitios_arqueologicos_iphan_a` (polígonos) + `loc_sitios_arqueologicos_iphan_p` (pontos) | — | `dt_cadastro` por sítio |

PAMGIA = ArcGIS Server do IBAMA, `https://pamgia.ibama.gov.br/server/rest/services`.
A pasta `BasesSincronizadas` é a cópia que o IBAMA mantém em dia das bases de outros
órgãos (FUNAI, MMA, INCRA, IPHAN, IBGE…), cada registro com `dt_sync`.

## Como cada servidor é consultado

### ArcGIS Server (PAMGIA)

```
GET {servico}/{camada}/query?geometry=oeste,sul,leste,norte&geometryType=esriGeometryEnvelope
    &inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=<campos>&outSR=4326
    &returnGeometry=true&f=geojson&resultRecordCount=300
```

- CORS: devolve `Access-Control-Allow-Origin` igual ao `Origin` pedido (testado com
  `localhost:5173`, `vertces.com.br`, `example.com`); OPTIONS 200 com GET/POST.
- `maxRecordCount` 2000; acima do limite vem `exceededTransferLimit: true` (o resultado
  marca "resposta cortada").
- Erro vem como **HTTP 200** com `{"error": {...}}`; tratado como falha.
- Instável: devolveu **500** em ~1 de 30 consultas (camada militar). A lib tenta de novo
  uma vez em erro 5xx antes de ir para a cópia.
- Tempo: 0,4–1 s; algumas camadas (IPHAN, ICMBio) chegam a 6–8 s.
- `spatialRel=esriSpatialRelWithin` = "a geometria da consulta está DENTRO da feição"
  (testado: caixa em Corumbá → 1; em Salvador → 0). É o que permite saber que o imóvel
  está inteiro na faixa de fronteira sem baixar o polígono.

### GeoServer WFS (FUNAI, INDE, IBGE)

```
GET {base}?service=WFS&version=1.1.0&request=GetFeature&typeName=<camada>
    &outputFormat=application/json&srsName=EPSG:4326&maxFeatures=300
    &bbox=oeste,sul,leste,norte,EPSG:4326
```

- Com `EPSG:4326` (e não a URN) a caixa vai em lon/lat e as coordenadas voltam em lon/lat.
- O parâmetro `clip` (recorte no servidor) **não** é aceito pela INDE: volta a geometria inteira.
- CORS `*` nos três.

## Fontes, uma a uma

### Terras Indígenas — FUNAI

- `https://geoserver.funai.gov.br/geoserver/ows`, camada `Funai:tis_poligonais`
  (também `tis_amazonia_legal_poligonais`, `tis_poligonais_portarias`, `aldeias_pontos`).
- **Usar `/geoserver/ows`**: o caminho do workspace `/geoserver/Funai/ows` passou a
  responder **403** no meio dos testes (o mesmo pedido em `/geoserver/ows` segue 200).
- A cadeia TLS do servidor está **incompleta** para clientes que não buscam o
  certificado intermediário: Node (OpenSSL) falhou com `UNABLE_TO_VERIFY_LEAF_SIGNATURE`
  em parte das tentativas; o Chrome abre normalmente. Uma edge function em Deno teria o
  mesmo problema — mais um motivo para consultar pelo navegador.
- Campos: `terrai_codigo`, `terrai_nome`, `etnia_nome`, `municipio_nome`, `uf_sigla`,
  `fase_ti` (Em estudo, Delimitada, Declarada, Homologada, Regularizada),
  `modalidade_ti`, `superficie_perimetro_ha`, `data_atualizacao` (dd/mm/aaaa).
- Cópia: a do PAMGIA em `BasesSincronizadas/lim_terra_indigena_funai_a` **não traz as
  TIs só delimitadas** (Barra Velha do Monte Pascoal, delimitada, não aparece). Por isso
  a cópia usada é `01_Publicacoes_Bases/lim_terra_indigena_a` (todas as fases, base de 2017).

### Unidades de Conservação — MMA (CNUC)

- INDE: `https://geoservicos.inde.gov.br/geoserver/ows`, camada `MMA:cnuc_2026_03`.
  O MMA publica uma camada por versão (`cnuc_04_2024`, `cnuc_2025_08`, `cnuc_2026_03`,
  `cnuc_26_07_31`…): a versão está em `CAMADA_CNUC` na lib — **trocar quando sair a próxima**.
- **Não usar `MMA:cnuc_2026_03_atualizado`**: os campos vêm como `n1…n32` e
  desalinhados (o polígono do PARNA Monte Pascoal veio com o nome de uma RPPN de Camamu).
- Campos: `nome_uc`, `cd_cnuc`, `categoria`, `grupo` (Proteção Integral / Uso
  Sustentável), `esfera` (Federal/Estadual/Municipal), `cria_ato`, `municipio`, `org_gestor`.
- Só o limite da UC. **Zona de amortecimento não está na base** (o cartão diz isso).
- `geoservicos.mma.gov.br`, `geoserver.mma.gov.br` não existem; `mapas.mma.gov.br`
  (i3geo) está atrás de desafio do Cloudflare (403 "Just a moment…"): inutilizável.
- ICMBio: `ICMBio:limiteucsfederais_a` (INDE) traz só as federais; `geoservicos.icmbio.gov.br`
  não existe e `sistemas.icmbio.gov.br` está atrás do Cloudflare.

### Assentamentos e territórios quilombolas — INCRA

- O Geoportal do INCRA (`geoportal.incra.gov.br/geoserver/ows`, o mesmo do SIGEF)
  publica **só `geonode:sigef_geo`** no WFS. O acervo fundiário antigo
  (`acervofundiario.incra.gov.br`) saiu do ar (out/2026). O INCRA só oferece os
  shapefiles para baixar (por UF), sem consulta por área.
- Por isso: as cópias do IBAMA/PAMGIA, que sincronizam a base do INCRA:
  - `BasesSincronizadas/lim_assentamentos_incra_a`: `cd_sipra`, `nome_proje`,
    `municipio`, `uf`, `fase`, `data_de_cr`, `num_famili`, `area_hecta`, `dt_sync`;
  - `BasesSincronizadas/lim_quilombos_incra_a`: `nm_comunid`, `nm_municip`, `cd_uf`,
    `fase` (RTID, PORTARIA, DECRETO, TITULADO…), `nr_process`, `st_titulad`, `dt_sync`.
- Cópia dos quilombos: IBGE `CGMAT:qg_2022_620_territorioquilombola__v02` (territórios do
  Censo 2022, `nm_tq`, `status`), CORS `*`.
- Comunidades só certificadas pela Fundação Palmares, sem território delimitado, não estão.

### Áreas embargadas — IBAMA e ICMBio

- IBAMA: `01_Publicacoes_Bases/adm_embargos_ibama_a/MapServer/0` (base do SISCOM; o
  serviço diz que sincroniza às 11h e 22h). O GeoServer público do SISCOM
  (`siscom.ibama.gov.br/geoserver`) responde 404.
- ICMBio: `BasesSincronizadas/lim_embargos_icmbio_a` (e `ICMBio:embargos_icmbio` na INDE).
- **Dado pessoal**: as camadas trazem nome e CPF/CNPJ do embargado. A lib **não pede**
  esses campos (`outFields` só com número, data, município, área): não chegam ao
  navegador, ao relatório nem às fixtures dos testes.

### Faixa de fronteira — IBGE

- `BasesSincronizadas/lim_faixa_fronteira_ibge_a`: **um polígono só, de 9 MB**.
- A lib primeiro **conta** (`returnCountOnly`) com a caixa do imóvel: 0 = fora;
  `esriSpatialRelWithin` > 0 = imóvel inteiro dentro (100%, sem baixar nada). Só na
  borda dos 150 km baixa a geometria generalizada (`maxAllowableOffset=0.0002`, ~20 m,
  1,2 MB) para o percentual.
- No IBGE também há `CGEO:ANMS2010_02_faixafronteira` (WFS, CORS `*`).

### Áreas militares

- `01_Publicacoes_Bases/lim_uso_militar_a/MapServer/15`: áreas de uso militar do Cadastro
  Nacional de Florestas Públicas (SFB), registros de ~2011 (ex.: CI de Formosa/GO).
  Base antiga e incompleta: o cartão avisa que não exclui consulta às Forças Armadas.
- IBGE `CCAR:area_pub_militar` e `BCIM_Edif_Pub_Militar_A` existem, mas são da base
  cartográfica 1:1.000.000 (edificações), não limites de área.

### Sítios arqueológicos — IPHAN

- O GeoServer do IPHAN (`geoserver.iphan.gov.br/geoserver/ows`, camadas `SICG:sitios`
  e `SICG:sitios_pol`) **não tem CORS** ("Failed to fetch" no Chrome). Em vez de criar um
  proxy, a lib usa as cópias do PAMGIA:
  `BasesSincronizadas/lim_sitios_arqueologicos_iphan_a` (polígonos) e
  `loc_sitios_arqueologicos_iphan_p` (pontos).
- Ponto dentro do imóvel = "sobrepõe" (sem área); ponto a até X m = "encosta".

## Classificação e área

- **Sobrepõe**: área de interseção ≥ 1 m². Abaixo de 0,5% do imóvel o texto avisa que
  pode ser só a diferença de escala da base pública (1:100.000 em muitas delas).
- **Encosta**: sem sobreposição, a até 300 m do perímetro (configurável).
- **Livre**: nada a até 300 m.
- **Não consultado: motivo**: o servidor (e a cópia) não respondeu, deu erro ou passou
  de 25 s. Uma fonte nessa situação não derruba as outras.
- Área: UTM do fuso do serviço (`proj4` + `utmDef`, como `lonLatDoVertice`) e área plana
  das coordenadas UTM (Gauss, como `calcularAreaHa`); a interseção é do clipper
  (`src/lib/loteamento/geom.ts`) num plano transladado para o 1º vértice. O teste
  confere a área do imóvel contra `calcularAreaHa`.
- A consulta olha 1,5 km além do imóvel; as geometrias são recortadas nessa vista
  (uma TI de milhões de hectares vira o pedaço perto do imóvel) — é o que vai ao mapa e
  ao croqui do PDF.

## O que ficou de fora (e por quê)

- **IPHAN direto**: sem CORS (ver acima); a cópia do PAMGIA cobre.
- **Zona de amortecimento de UC**: não há base nacional publicada.
- **Shapefiles do INCRA por UF**: só download, sem filtro por área.
- **ArcGIS de terceiros** (ex.: `services1.arcgis.com/.../Areas_Quilombolas_INCRA_MAB`):
  não oficiais.
- **Áreas de mineração (ANM)**, florestas públicas não destinadas (SFB), cavernas (ICMBio):
  existem no PAMGIA (`lim_processo_minerarios_anm_a`, `lim_ter_pub_n_desti_sfb_a`,
  `loc_cavernas_icmbio_p`) e podem entrar depois com o mesmo padrão.
