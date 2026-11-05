# Recuo legal ao longo de rodovias (BR e BA): pesquisa para o Vertces

> Pesquisa feita para o recuo automático do sistema (pedido do Wilker, 05/11/2026). O que o sistema aplica está em `src/lib/recuo.ts`; os padrões e o princípio "calcula e desenha sozinho, mas toda largura vem com origem e pede confirmação antes da peça final" saem da seção (b).

Pesquisa feita em 05/11/2026. Todo número abaixo tem fonte (ato, artigo e URL). O que não foi confirmado está marcado.

**Legenda de status**
- ✔ = lido na fonte primária (texto da lei, ato ou documento oficial baixado e conferido).
- ◐ = fonte oficial, mas não normativa (página institucional, dado marcado como "teste"), ou fonte secundária confiável (concessionária, coluna jurídica que transcreve o ato).
- ✖ = **não confirmado**.

---

## Resumo em 8 linhas

1. **Não existe largura nacional única de faixa de domínio.** Em rodovia federal, a largura vem do projeto executivo, do decreto/portaria de utilidade pública (DUP) ou do projeto de desapropriação (Res. DNIT 7/2021, art. 2º, VII ✔). O documento oficial por trecho é o **Termo de Reconhecimento de Faixa de Domínio Existente**, com largura **por lado, a partir do eixo de referência** (IN DNIT 20/2020 e IN DNIT 75/2021 ✔).
2. Os mínimos de projeto (Normas DNER de 1949, reeditadas em 1973, que o DNIT ainda lista como regulamentação vigente) são: Classe I com 60/70/80 m de largura total, Classes II e III com 30/40/50 m (terreno plano/ondulado/montanhoso) ✔.
3. Na base do próprio DNIT (WFS, 3.874 trechos documentados), o valor mais comum por lado é 35 a 40 m, e 46% dos trechos são **assimétricos**. Na Bahia, os valores achados vão de 20 a 53 m por lado ◐ (o DNIT marca a base como "informações teste").
4. **Faixa não edificável:** 15 m de cada lado, **contados a partir do limite da faixa de domínio**. Lei municipal ou distrital pode reduzir até 5 m (Lei 6.766/1979, art. 4º, III, na redação da Lei 13.913/2019 ✔). A Lei 14.285/2021 só mexeu em ferrovias (III-A) e águas (III-B) ✔.
5. A Lei 6.766 é lei de **parcelamento urbano**. O governo federal (Despacho 13/2021/GM/MINFRA, vinculante) trata a faixa como "requisito urbanístico" de loteamento, fiscalizado pelo município ✔. Para **imóvel rural**, a aplicação é **controversa** ✖. Mesmo assim, o DNIT e a SEINFRA-BA a descrevem sem distinguir rural de urbano ◐.
6. **Bahia (SEINFRA/SIT, sucessora do DERBA):** "em geral" 60 m, ou seja, **30 m para cada lado a partir do eixo**, definida pelo projeto final de engenharia, mais 15 m não edificáveis (página oficial ◐). **Não encontrei lei, decreto ou portaria estadual que fixe a largura** ✖.
7. **INCRA:** na confrontação com estrada, o limite do imóvel é o elemento físico que delimita a faixa de domínio, *se houver instrumento jurídico que a defina*. Se não houver, o limite é a própria estrada (MTGIR 2ª ed., item 2.4.1.3 ✔). O confrontante é identificado pelo nome, por exemplo "Rodovia BR-040" (item 2.5 ✔).
8. **Anuência:** o Provimento CNJ 195/2025 (CNN, art. 440-AX, § 3º, II, b) **dispensa a anuência do ente público** na retificação quando o confrontante é estrada ou rodovia, "respeitada a faixa de domínio público e eventual área non aedificandi" ◐. Em BR concedida, a concessionária emite **termo de anuência** em até 30 dias (Res. ANTT 6.000/2022, arts. 111–112 ◐).

---

## (a) Tabela principal

> Convenção: "cada lado" = distância **perpendicular ao eixo** da rodovia. A faixa não edificável é contada **a partir do limite externo da faixa de domínio**. Recuo total a partir do eixo = faixa de domínio (lado) + faixa não edificável.

| Tipo de via | Faixa de domínio (cada lado, a partir do eixo) | Faixa não edificável | Fonte (ato, artigo, URL) | Vale para | Observações |
|---|---|---|---|---|---|
| **Rodovia federal (DNIT): regra jurídica** | **Variável por trecho.** Limites "definidos conforme projeto executivo da rodovia, decretos de utilidade pública, ou em projetos de desapropriação". Valor oficial por segmento, lado esquerdo e lado direito em metros "a partir do Eixo de Referência", no Termo de Reconhecimento de Faixa de Domínio Existente. ✔ | 15 m (ver linha "faixa não edificável") | Res. DNIT nº 7, de 02/03/2021, art. 2º, VII e VIII ([PDF](https://www.gov.br/dnit/pt-br/rodovias/operacoes-rodoviarias/faixa-de-dominio/regulamentacao-atual/copy_of_resolucao72021.pdf)). IN DNIT nº 20/2020, arts. 2º, 4º e 29, e Anexo III ([PDF](https://www.gov.br/dnit/pt-br/assuntos/planejamento-e-pesquisa/desapropriacao-e-reassentamento/profaixa/instrucoes-normativas/IN_20-2020.pdf)). IN DNIT nº 75/2021, arts. 26, 31 e 32 ([PDF](https://www.gov.br/dnit/pt-br/assuntos/planejamento-e-pesquisa/desapropriacao-e-reassentamento/profaixa/instrucoes-normativas/IN_75.pdf)) | Rural e urbano: a faixa é bem público da União | Eixo de referência = "eixo da pista originariamente implantada" (IN 20/2020, art. 2º, III ✔). Em pista duplicada, esse eixo **não** é o canteiro central. A comissão do DNIT pode reconhecer a faixa documentada, a consolidada (cercas e uso) ou uma combinação das duas (IN 75/2021, art. 26 ✔). |
| **Rodovia federal: mínimos de projeto por classe** | Total mínimo: **Classe I** 60 m (plano), 70 m (ondulado) e 80 m (montanhoso), ou seja **30/35/40 m por lado** se for simétrica. **Classes II e III**: 30/40/50 m, ou seja **15/20/25 m por lado**. Classe Especial: definida caso a caso, nunca menor que a Classe I. Além disso, no mínimo **10 m além da crista do corte ou do pé do aterro**, de cada lado. Em melhoramentos de alto custo, pode reduzir até: 2 faixas de tráfego, 30 m total (rural) ou 20 m (urbano); 4 faixas, 60 m (rural) ou 40 m (urbano). ✔ | — | Normas para o Projeto das Estradas de Rodagem (DNER; Portarias MVOP nº 19/1949 e nº 348/1950; reed. 1973), **art. 24 e §§ 1º e 2º e art. 29**. Listadas pelo DNIT como regulamentação atual da faixa de domínio ([página](https://www.gov.br/dnit/pt-br/rodovias/operacoes-rodoviarias/faixa-de-dominio/regulamentacao-atual/normas-para-o-projeto-das-estradas-de-rodagem)) | Projeto de rodovia nova | São **mínimos de projeto**, não a largura legal de uma rodovia existente. A divisão "por lado" é inferência minha para faixa simétrica. As classes de 1949 (Especial, I, II, III) não correspondem oficialmente às do manual de 1999 (0, I-A…) ✖. |
| **Rodovia federal: valores observados (base DNIT)** | Brasil, "faixa documentada" (3.874 trechos): por lado, ponderando pela extensão, **35 m (29,9%)**, **40 m (29,5%)**, 30 m (13,0%), 20 m (12,9%), 50 m (6,6%). Até 40 m cobre 91,4% da extensão; mediana do total, 80 m; 46% assimétricos. **Bahia:** mediana 35 m por lado (84 valores). Tabela por rodovia na seção 1.4. ◐ | — | WFS do DNIT `https://servicos.dnit.gov.br/dnitgeo/geoserver/ows`, camadas `vgeo:vw_faixa_dominio` e `vgeo:vw_faixa_reconhecida` (consultadas em 05/11/2026). Campos: `Codigo_BR`, `Lado_Esquerdo`, `Lado_Direito`, `Largura_Total`, `KmI`, `KmF`, `Tipo_Documento`, `Numero_Documento`. | — | Toda a camada `vw_faixa_dominio` traz `Fonte = "Informacoes teste. CONSULTAR O DNIT SOBRE A FAIXA DE DOMINIO."`. Serve de **sugestão**, não de prova. A camada `vw_faixa_reconhecida` (893 trechos, situação "Definida") vem de Termos de Reconhecimento. |
| **Rodovia federal concedida (ANTT)** | A mesma faixa (bem público da União). É "delimitada por alinhamento estabelecido em cadastro oficial" e, sempre que possível, referenciada por marcos ou materializada pela cerca. ◐ | 15 m (Lei 6.766) | Res. ANTT nº 6.000, de 01/12/2022 (RCR 2), art. 2º, IX (definição) e XXIV (termo de anuência), arts. 95–97 e 111–112 ([LegisWeb, texto consolidado](https://www.legisweb.com.br/legislacao/?id=493520)) | Rural e urbano | A faixa existe "mesmo que não tenha sido devidamente desapropriada" (art. 95, III). O lindeiro pede à concessionária o reconhecimento de limites; ela emite **termo de anuência de retificação de área em 30 dias** (arts. 111–112). Numeração conferida só no texto consolidado da LegisWeb ✖. |
| **Faixa não edificável (rodovias federais e estaduais)** | — | **≥ 15 m de cada lado, "ao longo das faixas de domínio público das rodovias"**, ou seja, a partir do limite da faixa de domínio. Lei municipal ou distrital que aprovar o instrumento de planejamento territorial pode reduzir **até 5 m de cada lado**. Edificações em áreas contíguas, em trechos de rodovia "que atravessem perímetros urbanos ou áreas urbanizadas passíveis de serem incluídas em perímetro urbano", construídas até a promulgação do § 5º (Lei de 25/11/2019), ficam dispensadas, salvo ato fundamentado do município. ✔ | Lei 6.766/1979, **art. 4º, III** (red. Lei 13.913/2019) e **§ 5º** (incl. Lei 13.913/2019) ([compilada](https://www.planalto.gov.br/ccivil_03/leis/l6766.htm)). Igual na Res. DNIT 7/2021, art. 2º, VIII ✔ | **Loteamento urbano: sim** (art. 4º, caput). **Desmembramento: "no que couber"** (art. 11 ✔). **Rural: controverso ✖** (ver 2.2) | É **restrição de construir**: a terra continua privada e não se indeniza (Despacho 13/2021/GM/MINFRA). A fiscalização cabe ao **município** (mesmo despacho, item a ✔). "No mínimo" permite lei local mais exigente. |
| **Ferrovia** (para referência) | Variável (DUP e projeto) | **≥ 15 m de cada lado, obrigatória e sem previsão de redução** | Lei 6.766, art. 4º, III-A (red. Lei 14.285/2021) ✔ | Loteamento | A Lei 14.285/2021 tratou de ferrovias e águas (III-B, APP urbana), **não** de rodovias ✔ |
| **Rodovia estadual BA (SEINFRA/SIT)** | "Em geral, faz-se uma reserva de 60 metros de largura, considerando-se **30 metros para cada lado**, partindo-se do eixo da rodovia". A largura "é definida de acordo com as características técnicas do projeto final de engenharia", "mantendo largura constante e tendo as linhas limites paralelas ao eixo". ◐ | "torna-se obrigatória uma reserva de mais **15 metros para cada lado da faixa de domínio**", na qual "não se pode construir (Lei Federal 6.766/79)" ◐ | SEINFRA-BA, página "Apresentação – Faixa de Domínio" (publ. 18/03/2024, atual. 30/06/2026) ([link](https://www.ba.gov.br/infraestrutura/56/apresentacao-faixa-de-dominio)). Instruções técnicas SEINFRA/SIT: "Limites das faixas de domínio e área 'non aedificandi', cotados em relação ao eixo da via" ([ex.](https://www.ba.gov.br/infraestrutura/12054/instrucoes-tecnicas)) ✔ | Rural e urbano (a página não distingue) | **Nenhuma lei, decreto ou portaria estadual com largura foi encontrada** ✖. A lista oficial de legislação da SEINFRA traz só normas federais e portarias de tarifa (194/1999, 475/2007, 32/2013). A 194/1999 foi lida e **não tem largura** ✔. DERBA extinto pela Lei estadual 13.204/2014; competência hoje na SEINFRA/SIT ◐. |
| **Rodovia estadual BA concedida (AGERBA)** | BA-099 (CLN): limites "da faixa de domínio oficial da rodovia, fornecidos pela Concessionária, conforme decretos e desapropriações efetuadas pelo DERBA". BA-052 (CONCEF): 60 m, 30 m por lado a partir do eixo. ◐ | BA-099: "Quaisquer instalações arquitetônicas deverão estar situadas a uma distância mínima de quinze metros (15,00 m) do limite da faixa de domínio". BA-052: +15 m. ◐ | Manual de Orientação para Uso Especial da Faixa de Domínio BA-099, V2 (CLN/AGERBA) ([PDF](https://clnorte.com.br/pdf/faixa_dominio/+%20Implanta%C3%A7%C3%A3o,%20regulariza%C3%A7%C3%A3o%20ou%20modifica%C3%A7%C3%A3o%20de%20acesso%20rodovi%C3%A1rio.pdf)). CONCEF, 16/02/2021 ([link](https://www.concefsa.com.br/regularizacao-da-faixa-de-dominio-do-sistema-rodoviario-ba-052/)) | Rural e urbano | São documentos de concessionária, não atos normativos. Sistema BA-093 (Bahia Norte): largura não encontrada ✖. |
| **Estrada municipal ou vicinal** | **Sem regra nacional nem estadual (BA) encontrada.** Exemplos de leis municipais **fora da Bahia**: Guaíra/PR, 13,00 m (**6,50 m de cada lado, a partir do eixo central**); Botucatu/SP, novas estradas rurais com **mínimo de 12 m (6 m de cada lado do eixo)** e 14 m quando necessário. ✔ (só esses dois) | Depende da lei municipal. A Lei 6.766 fala só de rodovias. ✖ | Guaíra/PR, Lei 1.215/2002, art. 3º ([PDF](https://ti.guaira.pr.gov.br/dioe/documentos/anexo/LEI_1215_2002.pdf)). Botucatu/SP, Decreto 13.782/2025, art. 1º, I e II ([PDF](https://www.botucatu.sp.gov.br/legislacao/download-lei/31846)) | Depende da lei | INCRA: sem instrumento jurídico que defina a faixa, "o limite será a própria estrada" (MTGIR 2ª ed., 2.4.1.3 ✔). Nenhuma lei municipal baiana foi localizada ✖. |

---

## 1. Rodovias federais (DNIT e ANTT)

### 1.1 Existe largura padrão?
**Não.** Em síntese:
- **Res. DNIT nº 7/2021, art. 2º, VII ✔:** a faixa de domínio é a "base física sobre a qual se assenta uma rodovia, constituída pelas pistas de rolamento, canteiros, obras-de-arte, acostamentos, sinalização e faixa lateral de segurança, com limites definidos conforme projeto executivo da rodovia, decretos de utilidade pública, ou em projetos de desapropriação". A página "Regulamentação Atual" do DNIT (atualizada em 03/06/2025) lista essa resolução como vigente, junto com as Normas DNER de 1949, a Lei 6.766/1979 e o Decreto 84.398/1980 ([link](https://www.gov.br/dnit/pt-br/rodovias/operacoes-rodoviarias/faixa-de-dominio/regulamentacao-atual)).
- **IN DNIT nº 20/2020 ✔** (de 03/06/2020, vigente desde 01/07/2020) e **IN DNIT nº 75/2021 ✔** (de 30/11/2021, Parte II):
  - O DNIT reconhece a "Faixa de Domínio Existente" por segmento, por meio de comissão da Superintendência Regional.
  - O **Termo de Reconhecimento**, assinado pelo Superintendente Regional, traz uma tabela "Segmento (km inicial – km final) | Lado Esquerdo (metros) | Lado Direito (metros)", medida **a partir do Eixo de Referência** (IN 20, Anexo III).
  - Esse termo "será o documento oficial que dispõe sobre as dimensões da Faixa de Domínio Existente no segmento de interesse, substituindo qualquer outro tipo de documentação pretérita" (IN 20, art. 29; IN 75, art. 32).
  - O DNIT registra os limites reconhecidos em "portal web geo" (IN 75, art. 31), que é o VGeo/GeoServer da seção 1.5.
- Conceitos da IN 75/2021, art. 2º ✔:
  - **Faixa Documentada:** consta de projeto, *as built*, portaria de DUP ou projeto de desapropriação.
  - **Faixa Consolidada:** a efetivamente ocupada pela via, "fisicamente delimitada pelas cercas" ou, sem cercas, por benfeitorias lindeiras, limites de roçada etc.
  - **Faixa Projetada:** a de obra futura.
  - O próprio DNIT reconhece que "nas vias federais implantadas pode haver diferença entre a largura da faixa de domínio prevista no projeto geométrico e aquela efetivamente verificada em campo" (IN 20, considerandos ✔).

### 1.2 Larguras usuais por classe (medidas a partir do eixo)
- Normas DNER de 1949/1973, **art. 24** ✔, válido para zonas rurais: largura mínima "limitada pela distância de 10 m, contada a partir das cristas dos cortes ou dos pés dos aterros, para cada um dos lados", e nunca menor que:

| Classe | Plano (total, por lado) | Ondulado (total, por lado) | Montanhoso (total, por lado) |
|---|---|---|---|
| I | 60 m, 30 m | 70 m, 35 m | 80 m, 40 m |
| II | 30 m, 15 m | 40 m, 20 m | 50 m, 25 m |
| III | 30 m, 15 m | 40 m, 20 m | 50 m, 25 m |
| Especial | fixada caso a caso, nunca menor que a da Classe I (§ 1º) | | |

- A coluna "por lado" é inferência para faixa simétrica ✖. Com **pistas duplas independentes**, o critério é aplicado do lado externo de cada pista (§ 2º ✔).
- Art. 29 ✔: em melhoramentos de custo elevado, a faixa pode ser reduzida, com justificativa, até 20 m (urbano) ou 30 m (rural) com 2 faixas de tráfego, e 40 m ou 60 m com 4 faixas.
- Classes de 1949 por tráfego (art. 59 ✔): I com 1.000 ou mais veículos/dia, II entre 500 e 1.000, III até 500.
- O Manual de Projeto Geométrico de Rodovias Rurais (DNER 1999, IPR-706) **não pôde ser lido**: o PDF é imagem ✖.

### 1.3 O que o agrimensor faz quando não sabe a largura de uma BR
Ordem prática, com base nas fontes:
1. **Consultar o DNIT georreferenciado:** WFS `vgeo:vw_faixa_reconhecida` (termos oficiais) e `vgeo:vw_faixa_dominio` (faixa documentada, "teste"). Ver 1.5.
2. **Consultar o arquivo de DUPs do DNIT por UF e rodovia** ([BA](https://www.gov.br/dnit/pt-br/assuntos/planejamento-e-pesquisa/desapropriacao-e-reassentamento/ba)). Há páginas para BR-020, 030, 101, 116, 122, 135, 235, 242, 251, 324, 330, 349, 367, 407, 415, 418, 420, 423, 498 e trechos estaduais. **Não há página da BR-110** ✔.
   - Atenção: as portarias antigas quase nunca trazem a largura no texto. Exemplo: a da BR-116/BA Jequié–Divisa BA/MG (Portaria 01/DES/1979) declara a faixa de domínio "(VARIÁVEL)" conforme desenhos PEET depositados no Arquivo Técnico ✔.
   - As portarias recentes de duplicação declaram uma "**faixa de utilidade pública de 150 metros** contados do eixo", às vezes "para cada lado", e excluem expressamente "a faixa de domínio existente". Exemplos: BR-116/BA, Portarias 111/2017 e 1.778/2018 ✔. **Esses 150 m não são a faixa de domínio**: são o envelope da desapropriação.
3. **Pedir à Superintendência Regional do DNIT na Bahia** o Termo de Reconhecimento do segmento, ou a informação da faixa documentada. Rito para o lindeiro pedir isso: **não confirmado ✖**. A IN 75 cita um "Termo de Reconhecimento de Limites" emitido a lindeiros, mas não achei a norma que o regula.
4. **Se a BR for concedida (ANTT):** requerer à concessionária o **termo de anuência de retificação de área**, com prazo de 30 dias. Se ela não atender, recorrer à Superintendência da ANTT (Res. ANTT 6.000/2022, arts. 111–112 ◐).
5. **Em campo:** levantar o eixo e as cercas (a faixa consolidada) e comparar com a faixa documentada. Por fim, seguir a **recomendação do oficial de registro**: o MTGIR, item 5, manda que "o levantamento das estradas e cursos d'água [...] deverá obedecer à recomendação do oficial de registro da jurisdição" ✔.

### 1.4 Valores encontrados na Bahia, por rodovia
| Rodovia (trecho) | Faixa de domínio, por lado a partir do eixo | Fonte | Status |
|---|---|---|---|
| **BR-020**, Div. GO/BA–Div. BA/PI, km 209,45–231,48 e 291,5–300,39 | Predomina **LE 46,6 m / LD 33,4 m** (80 m). Trechos com 41,6/28,4 (70 m). Entre os km 300,4 e 306,3, de 25,5 a 35 m. Alguns segmentos "variável". | Termo de Reconhecimento **BA 104**, SEI 50600.035620/2023-73, de 04/06/2025 (DNIT, `vw_faixa_reconhecida`) | ◐ oficial no DNIT, conferido só pelo WFS |
| **BR-242**, km 306,272–317,7 (mesmo termo) | 35/35; 20/20; LE 35 / LD 25; LE 35 / LD 45 (conforme o segmento) | idem | ◐ |
| **BR-030**, Brumado–Entr. BR-116 (lote 233.1), km 537,8–587,5 | 30/40 e 40/40 | Projeto Executivo 3702 V3.1, jun/1976 (`vw_faixa_dominio`) | ◐ "teste" |
| **BR-030**, "Entr. BR-101–Ribeirão Água Sumida" (grafia da base: "OGUA"), lote 2, km 759,6–823,1 | de **25 a 53 m** por lado, muito assimétrico; predominam 35–40 m | Projeto Executivo 4570 V2.2, mar/1985 | ◐ "teste" |
| **BR-030**, Div. MG/BA–Campinho, km 847,3–894,4 | 30/30 | Projeto Executivo 5295 V2, dez/1990 | ◐ "teste" |
| **BR-116**, Macururé–Euclides da Cunha (km não informado) | 25; 27; 27,5; 29; 30; 31; 39 m (simétrica, por segmento) | Projeto Executivo 6956 | ◐ "teste" |
| **BR-349**, Div. SE/BA–Div. BA/GO, km 752,8–841,4 | 20/20 | Projeto Executivo 6986 V2, set/2016 | ◐ "teste" |
| **BR-324**, Salvador–Feira de Santana | Semi-faixa de **40 m**: a portaria alarga "semi-faixa direita de 40m para 100m" (km 7,904–7,974) e "semi-faixa esquerda de 40m para 60m" (km 24,880–26,100) | Portaria DNER 37/1973 ([PDF](https://www.gov.br/dnit/pt-br/assuntos/planejamento-e-pesquisa/desapropriacao-e-reassentamento/ba/br-324/portaria_00037_1973_br324ba_salvador-feira-de-santana.pdf)), texto OCR | ✔ no texto; a extensão a outros km é inferência ✖ |
| **BR-101** (ES/BA, ECO101) | Faixa "normalmente em até 40 metros a partir do eixo central"; faixa não edificante de "15 metros após a faixa de domínio" | Apresentação da ECO101 à Câmara dos Deputados ([PDF](https://www2.camara.leg.br/atividade-legislativa/comissoes/comissoes-temporarias/externas/55a-legislatura/fiscalizacao-da-concessionaria-eco-101-br-101-es/documentos/outros-documentos/ApresentaoECO101.pdf)) | ◐ concessionária |
| **BR-101** (demais trechos BA), **BR-407**, **BR-110** | **Não encontrado.** As DUPs remetem a desenhos ou a polígonos de "alargamentos pontuais" (ex.: BR-407, Portaria 966/2013 ✔) | — | ✖ |

Os dados brutos (baixados do WFS do DNIT em 05/11/2026, fora do Git) são as camadas `vw_faixa_dominio` (Bahia e Brasil) e `vw_faixa_reconhecida`; repita a consulta da seção 1.5 para atualizá-los.

### 1.5 Fonte automática: GeoServer do DNIT (testado em 05/11/2026)
- Endpoint: `https://servicos.dnit.gov.br/dnitgeo/geoserver/ows` (WFS 1.1.0 e 2.0.0, saída `application/json`, aceita `CQL_FILTER`). As coordenadas vêm em lon/lat (o CRS declarado é EPSG:404000, genérico; os valores são geográficos).
  - `vgeo:vw_faixa_reconhecida`: polígonos dos Termos de Reconhecimento, com campos `Codigo_BR`, `Lado_Esquerdo`, `Lado_Direito`, `Largura_Total`, `KmI`, `KmF`, `Numero_Documento`, `Ano_Documento` e `Situacao_Faixa`. São 893 trechos no Brasil, **24 na BA**.
  - `vgeo:vw_faixa_dominio`: faixa documentada, com 3.874 trechos, **42 na BA**. Todos com "Informacoes teste. CONSULTAR O DNIT SOBRE A FAIXA DE DOMINIO."
  - `vgeo:vw_snv_rod`: eixos do SNV, com `Codigo_BR`, `Quilometragem_Inicio/Fim`, `Administracao`, `Estadual_Coincidente` etc. Serve para descobrir **qual BR e qual km** e se o trecho é concedido ou delegado. A precisão posicional do SNV não foi verificada ✖.
- Exemplo de consulta: `?service=WFS&version=1.1.0&request=GetFeature&typeName=vgeo:vw_faixa_reconhecida&outputFormat=application/json&CQL_FILTER=Unidade_Federacao='BA'`
- Observação: no SIGEF (WFS `geoportal.incra.gov.br/geoserver/ows`, camada `geonode:sigef_geo`, campo `natureza`), só há **1** parcela com natureza "Estrada" na BA (677 no Brasil, consulta de 05/11/2026). Não serve como fonte de faixa.

---

## 2. Faixa não edificável (Lei 6.766/1979)

### 2.1 Texto vigente ✔ ([Planalto, compilada](https://www.planalto.gov.br/ccivil_03/leis/l6766.htm))
- **Art. 4º, III** (red. Lei 13.913/2019): "ao longo das faixas de domínio público das rodovias, a reserva de faixa não edificável de, no mínimo, 15 (quinze) metros de cada lado poderá ser reduzida por lei municipal ou distrital que aprovar o instrumento do planejamento territorial, até o limite mínimo de 5 (cinco) metros de cada lado."
- **Art. 4º, III-A** (red. Lei 14.285/2021): ferrovias, 15 m obrigatórios. **III-B** (incl. Lei 14.285/2021): águas correntes e dormentes, conforme lei municipal (APP urbana). Nenhum dos dois trata de rodovia: **não confundir**.
- **Art. 4º, § 5º** (incl. Lei 13.913/2019): edificações em áreas contíguas à faixa de domínio de trechos que atravessam perímetro urbano ou área urbanizada passível de inclusão nele, construídas até a promulgação do parágrafo, ficam dispensadas do inciso III, salvo ato fundamentado do município ou do DF. A Lei 13.913 é de 25/11/2019 e foi publicada no DOU em 26/11/2019.
- Nenhuma alteração posterior a 2021 foi encontrada (Planalto consultado em 05/11/2026).

### 2.2 Vale para imóvel rural?
- **Pelo texto, é requisito de loteamento urbano:**
  - art. 1º: "O parcelamento do solo para fins urbanos será regido por esta Lei";
  - art. 3º: parcelamento só em zona urbana, de expansão urbana ou de urbanização específica;
  - art. 4º, caput: "Os loteamentos deverão atender…";
  - art. 11: aplica-se ao desmembramento "no que couber" ✔.
- **Posição federal vinculante:** o Despacho nº 13/2021/GM/MINFRA (DOU de 17/03/2021) dá efeito vinculante ao Parecer 405/2019/CONJUR-MINFRA/CGU/AGU ✔ ([DOU](https://www.in.gov.br/en/web/dou/-/despacho-n-13/2021/gm/minfra-309010172); [IRIB](https://www.irib.org.br/despacho-n-13-2021-gm-minfra/)). Ele diz que:
  - (a) a fiscalização da faixa não edificável é do **município**, e "a faixa não edificável sempre respeitará os limites da faixa de domínio";
  - (b) a União e as concessionárias só fiscalizam ou desapropriam **dentro** da faixa de domínio;
  - (c) chama a faixa de "requisito urbanístico" de loteamento.
- **Em sentido contrário, sem distinguir rural de urbano:**
  - a Res. DNIT 7/2021, art. 2º, VIII, define a faixa de forma genérica ✔;
  - a SEINFRA-BA diz que "torna-se obrigatória" ◐;
  - o Provimento CNJ 195/2025 exige, na retificação (inclusive de imóvel rural), respeito à "eventual área non aedificandi" ◐.
- Há decisões de TRFs mandando demolir construções nessa faixa, mas **não verifiquei número, inteiro teor, nem se os imóveis eram rurais ✖**. Nenhum precedente do STJ específico sobre imóvel rural foi encontrado ✖.
- **Conclusão para o sistema:**
  - em loteamento ou desmembramento urbano, a faixa é **obrigatória**;
  - em imóvel rural (SIGEF), **não altera o perímetro nem a área**. Deve ser representada como restrição, com aviso de que a aplicação é controversa.

### 2.3 Medida a partir de onde?
Do **limite externo da faixa de domínio** para dentro do imóvel, de cada lado. Fontes:
- Lei 6.766, art. 4º, III: "ao longo das faixas de domínio" ✔;
- Res. DNIT 7/2021, art. 2º, VIII ✔;
- Despacho MINFRA, item a ✔;
- SEINFRA-BA: "mais 15 metros para cada lado da faixa de domínio" ◐;
- CLN BA-099: "15,00 m do limite da faixa de domínio" ✔ no manual;
- ECO101: "15 metros após a faixa de domínio" ◐.

Recuo total a partir do eixo = meia faixa de domínio daquele lado + 15 m (ou o valor da lei municipal, nunca menor que 5 m).

---

## 3. Rodovias estaduais da Bahia (SEINFRA/SIT, DERBA, AGERBA)
- **Órgão:** o DERBA foi "extinto pela Lei N° 13.204, de 11 de dezembro de 2014", e a Seinfra "criou a Superintendência de Infraestrutura de Transportes (SIT)" ([histórico SEINFRA](https://www.ba.gov.br/infraestrutura/63/historico) ◐). A gestão da faixa é da **SEINFRA/SIT**, pela Gerência de Faixa de Domínio (GEFAD, `fxd@infra.ba.gov.br`), com pedidos pelo Portal FXD ([como funciona](https://www.ba.gov.br/infraestrutura/57/como-funciona)) ◐. A **AGERBA** autoriza as intervenções nas rodovias estaduais concedidas, como BA-099 e o sistema BA-093 (manual CLN ✔).
- **Largura:** veja a tabela (a). É o **projeto final de engenharia** que define a largura, "em geral" 60 m (30 m de cada lado do eixo), com "linhas limites paralelas ao eixo" (página oficial ◐). **Lei, decreto ou portaria estadual com a largura: não encontrado ✖.** O que foi verificado:
  - a [lista oficial de legislação](https://www.ba.gov.br/infraestrutura/11995/legislacao) da SEINFRA ✔;
  - a Portaria DERBA nº 194, de 26/07/1999 ([arquivo web](http://web.archive.org/web/20130918180111/http://derbajblb02.derba.ba.gov.br:80/modelostermos/Portaria_DERBA_194.pdf)), que é **só de preços de uso**, sem largura ✔;
  - ela cita o Decreto-Lei 816/1946, a Lei estadual 7.314/1998, o Decreto 7.517/1999 e a Lei estadual 4.660/1986, art. 21, § 3º. **Não li esses atos ✖.**
- **Faixa não edificável estadual:** a SEINFRA a fundamenta só na Lei federal 6.766. **Não achei lei estadual própria ✖.** No caso da BA-099 concedida, há a regra contratual e regulatória de 15 m do limite para "instalações arquitetônicas" (manual CLN V2 ✔).
- **Instruções técnicas SEINFRA/SIT (2025) ✔:** os projetos devem apresentar os "Limites das faixas de domínio e área 'non aedificandi', cotados em relação ao eixo da via de transporte de acordo com a sua quilometragem em relação ao PRE". PRE deve ser o Plano Rodoviário Estadual, mas isso é inferência minha ✖.

---

## 4. INCRA e SIGEF: estrada como confrontante

**Atos vigentes:**
- NTGIR 3ª ed. (2013): não menciona estrada nem faixa de domínio; remete os tipos de limite ao Manual de Limites e Confrontações ✔ ([PDF](https://sigef.incra.gov.br/static/documentos/norma_tecnica_georreferenciamento_imoveis_rurais_3ed.pdf)).
- O conteúdo desse manual hoje está no **Manual Técnico para Georreferenciamento de Imóveis Rurais, 2ª ed.** (MTGIR, Portaria INCRA 2.502/2022), capítulo 2 ✔ ([PDF](https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/Manual_Tecnico_de_Georreferenciamento_2_Edicao.pdf)). O texto é igual em substância ao do Manual de Limites e Confrontações, 1ª ed. (2013), item 4.2.1.3 ✔ ([PDF](https://sigef.incra.gov.br/static/documentos/manual_tecnico_limites_confrontacoes_1ed.pdf)).

**O que o MTGIR 2ª ed. diz:**
- **2.4.1.3 Estrada:** "Será considerada como limite entre o imóvel a ser georreferenciado e uma estrada confrontante o elemento físico que delimita a faixa de domínio, se houver instrumento jurídico que a defina. Não preenchido este requisito, o limite será a própria estrada." A versão de 2013 explicita "o elemento (cercas, linhas ideais, dentre outros) que delimita em campo a faixa de domínio".
- **Tabela 1 (tipos de limite):** LA1 Cerca, LA2 Muro, **LA3 Estrada**, LA4 Vala, LA5 Canal, LA6 Linha ideal, LA7 Limite artificial não tipificado; LN1 a LN6 são os naturais.
- **Vértices:**
  - **P** (posicionamento direto, sem marco): o caso de cercas;
  - **V** (posicionamento indireto): inclui os métodos de **geometria analítica**. O item **3.3.1 Paralela (código PA1)** determina vértices "a partir de uma linha paralela a outra [...]. É necessário definir a distância de afastamento". É assim que se traça a linha da faixa a partir do eixo.
- **2.5 Confrontantes:** imóvel sem registro é identificado pela denominação, por exemplo "a) Rodovias e ferrovias. Exemplo: Rodovia BR-040".
- **Nota 14:** para feições fotoidentificáveis, usar "Faixas de domínio materializadas ou eixo/margem para projeção".
- **Item 5:** estradas seguem "a recomendação do oficial de registro".
- No **Manual para Gestão da Certificação, 2ª ed. (2023)**, as naturezas de área incluem "Estrada" e "Ferrovia" ✔ ([PDF](https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/manualgestaocertificacao2edicao2023.pdf)).

**E quando a cerca está dentro da faixa?** O manual não trata do caso expressamente ✖. Pelas fontes:
- se há instrumento que define a faixa, o limite é a **faixa**, e não a cerca que a invade;
- bens públicos não estão sujeitos a usucapião (Código Civil, art. 102 ✔, [Planalto](https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm));
- a faixa federal existe "mesmo que não tenha sido devidamente desapropriada" (Res. ANTT 6.000/2022, art. 95, III ◐);
- a dispensa de anuência do CNJ exige que a faixa seja respeitada;
- o uso das áreas adjacentes obedece às condições de segurança fixadas pelo órgão com circunscrição sobre a via (CTB, art. 50 ✔).

Na prática: a divisa vai na linha da faixa (vértices V, método PA1, quando não materializada), e a área entre a cerca e a linha é tratada como faixa pública.

**Declarações e anuência:**
- **Lei 6.015/1973, art. 176, § 13** (incl. Lei 13.838/2019) ✔: na identificação georreferenciada dos §§ 3º e 4º, "é dispensada a anuência dos confrontantes, bastando para tanto a **declaração do requerente de que respeitou os limites e as confrontações**".
- **Decreto 4.449/2002, art. 9º, §§ 5º e 6º** ✔ ([Planalto](https://www.planalto.gov.br/ccivil_03/decreto/2002/d4449.htm)): o requerimento leva declaração do interessado de que "foram respeitados os direitos dos confrontantes", e o § 6º pede "declaração expressa dos confinantes de que os limites divisórios foram respeitados, com suas respectivas firmas reconhecidas". Como isso convive com o § 13 da Lei 6.015 depende da prática de cada cartório ✖.
- **Retificação de área, Lei 6.015, art. 213:** exige anuência dos confrontantes. Na falta dela, há notificação, e "presumir-se-á a anuência do confrontante que deixar de apresentar impugnação" (§ 4º ✔). O **Provimento CNJ nº 195, de 03/06/2025**, incluiu no CNN o **art. 440-AX, § 3º**: "É dispensada a anuência do confinante: [...] II – se o imóvel confrontante for bem público e consistir em: [...] b) bem público de uso comum, tais como estradas, rodovias, ferrovias e outras vias de circulação, respeitada a faixa de domínio público e eventual área non aedificandi" ◐.
  - Fonte: transcrição na coluna de J. Mallmann, [Migalhas, 22/09/2025](https://www.migalhas.com.br/coluna/migalhas-notariais-e-registrais/440481/retificacao-de-area-e-provimento-cnj-195-25--anuencia-do-confrontante). Texto oficial não conferido ✖.
  - A mesma coluna recomenda que o técnico declare "expressamente a informação de respeito aos limites e das faixas com os bens públicos na planta ou no memorial descritivo ou até mesmo em laudo técnico separado".
- **BR concedida:** termo de anuência de retificação de área emitido pela concessionária (ver 1.3, item 4).
- **BR do DNIT e rodovias da SEINFRA:** não achei modelo nem rito de "declaração de respeito à faixa" ✖.

---

## 5. Estradas municipais e vicinais
- Não existe regra nacional. A largura depende de lei ou decreto municipal.
- Exemplos verificados, **fora da BA**:
  - Guaíra/PR, Lei 1.215/2002, art. 3º: 13 m (6,5 m de cada lado do eixo) ✔;
  - Botucatu/SP, Decreto 13.782/2025: 12 m (6 m de cada lado) e 14 m quando necessário ✔.
- Outros municípios aparecem nas buscas com 10 a 20 m de largura total e faixas não edificáveis municipais de cerca de 5 m (Paraíso/SP, Cajati/SP). **Não verificados ✖.**
- No INCRA, sem instrumento jurídico que defina a faixa, o limite é a própria estrada (MTGIR, 2.4.1.3 ✔).

---

## (b) Padrões para o sistema aplicar sozinho

> Princípio: o sistema **calcula e desenha sozinho**, mas **toda largura vem com origem e status**. Peça final (memorial, planta SIGEF, termo) **não sai com largura "padrão do sistema"** sem confirmação explícita do usuário.

### B1. Detecção do tipo de via
- Nos nomes de confrontante e na descrição do TXT ou CSV, procurar:
  - `\b(BR)\s*[-–]?\s*(\d{3})\b` → **federal**;
  - `\b(BA)\s*[-–]?\s*(\d{3})\b` → **estadual BA**;
  - `estrada (municipal|vicinal)`, `EM-`, `estrada` sem código → **municipal**;
  - `EF-\d{3}`, `ferrovia` → **ferrovia**.
- Opcional: cruzar a geometria do imóvel com `vgeo:vw_snv_rod` (DNIT) num raio de algumas centenas de metros. Isso sugere código BR, km e campo `Administracao` (DNIT, concessão ou delegada). É **só sugestão**, porque a precisão do SNV não foi verificada.

### B2. Parâmetros por rodovia (um registro por rodovia e lado, aceitando trechos por km)

| Campo | Valor padrão | De onde vem o padrão | Editável | Precisa confirmar antes da peça final? |
|---|---|---|---|---|
| Jurisdição e administração | da detecção (B1) | regex e SNV | sim | sim |
| Eixo de referência (linha) | levantado em campo (pontos "EIXO"); senão, desenhado sobre a imagem | — | sim | sim. Em pista duplicada, perguntar qual é a "pista originariamente implantada" (IN DNIT 75/2021) |
| Faixa de domínio, lado esquerdo e lado direito (m a partir do eixo) | **BR:** 1º `vw_faixa_reconhecida` (status "Termo de Reconhecimento DNIT nº…"); 2º `vw_faixa_dominio` ("documentada – DNIT marca como teste"); 3º **40 m por lado** ("padrão do sistema"). **BA:** **30 m por lado** ("padrão SEINFRA 'em geral'"). **Municipal:** **nenhum**; o limite é a própria estrada, e há campo opcional "largura da lei municipal" com o número da lei. | 40 m: sem largura publicada, cobre 91% da extensão documentada no DNIT, é a moda junto com 35 m, é a semi-faixa da BR-324 Salvador–Feira e é o "até 40 m" da ECO101. É **escolha estatística, não legal**. 30 m: página oficial SEINFRA. | sim, por trecho de km | **sim, sempre** que a origem não for um Termo de Reconhecimento ou documento anexado |
| Faixa não edificável (m a partir do limite da faixa) | **15** (BR, BA e ferrovia); **0** (municipal) | Lei 6.766, art. 4º, III e III-A | sim. Abaixo de 15 m, **só rodovia** e com nº da lei municipal; mínimo de 5 m | não para desenho. Sim para reduzir |
| Aplicar faixa não edificável | **Loteamento e desmembramento urbano:** obrigatório. **Georreferenciamento rural (SIGEF):** camada informativa ligada na planta, **sem afetar área nem perímetro**, com aviso "aplicação a imóvel rural é controversa" | 2.2 | sim | — |
| Edificação existente na faixa não edificável | alerta. Se a edificação existir antes de 25/11/2019 e estiver em trecho urbano, indicar a dispensa do art. 4º, § 5º | Lei 6.766, § 5º | — | — |

### B3. Regras geométricas
1. **Linha da faixa** = paralela ao eixo, com afastamento igual ao valor do lado esquerdo ou do lado direito, por trecho de km. Faixas assimétricas e com largura variando por segmento são normais: 46% dos trechos do DNIT são assimétricos.
2. **Comparar a divisa levantada com a linha da faixa:**
   - **Cerca ou divisa dentro da faixa** (invadindo): alerta "perímetro invade a faixa de domínio (bem público, CC art. 102)".
     - No georreferenciamento: **propor** a divisa na linha da faixa, com vértices **V**, método **PA1 (Paralela)**, e mostrar a área antes e depois. O usuário decide.
     - No loteamento: **excluir automaticamente** a faixa da gleba loteável (editável).
   - **Cerca fora da faixa** (recuada): manter a divisa levantada e registrar a distância até a linha da faixa.
   - **Cerca coincidindo com a linha:** usar os vértices da cerca (tipo P). A tolerância deve ser configurável: **não há valor normativo ✖**.
3. **Linha não edificável** = paralela à **linha da faixa** (não à cerca), para dentro do imóvel, com 15 m ou o valor municipal. No loteamento, mantém-se o modelo atual: é **restrição dentro do lote**, não área pública. As casas da maquete e as edificações não podem ficar nela.
4. **Tipo de limite no SIGEF:** LA3 (Estrada) ou o tipo do elemento que materializa a faixa (LA1 cerca, LA6 linha ideal). Deixar escolher, com padrão LA3 para trecho não materializado. A prática varia, e o MTGIR manda seguir o oficial de registro ✖.
5. **Nunca** subtrair a faixa não edificável da área do imóvel, e **nunca** usar a geometria do SNV para traçar a divisa.

### B4. Textos automáticos (planta e memorial)
- **Confrontante:**
  - federal: "Rodovia BR-116 – faixa de domínio (DNIT)", seguindo o modelo do INCRA "Rodovia BR-040";
  - concedida: acrescentar "concessionária …";
  - estadual: "Rodovia BA-xxx – faixa de domínio (SEINFRA/SIT)".
- **Nota na planta** (sugestão, para a dispensa do Prov. CNJ 195/2025): "O perímetro respeita a faixa de domínio da Rodovia BR-xxx (LE __ m / LD __ m do eixo; fonte: __) e a faixa não edificável de __ m (Lei 6.766/1979, art. 4º, III)."
- **Anexos sugeridos:** termo de reconhecimento do DNIT, termo de anuência da concessionária ou resposta da SEINFRA/SIT, quando houver.

### B5. Onde o sistema busca dados sozinho
- **DNIT WFS** (seção 1.5), em ordem: `vw_faixa_reconhecida` → `vw_faixa_dominio` → padrão.
- **Bahia (BA-xxx):** não achei serviço geográfico público. Usar o padrão de 30 m e orientar a confirmação com a SEINFRA/SIT (GEFAD, Portal FXD) ou com a concessionária (BA-099, BA-093 e BA-052).
- **SIGEF:** inútil para faixa na BA (1 parcela "Estrada").

---

## (c) Incertezas e lacunas
1. **Bahia sem ato normativo de largura** ✖. Os 60 m (30 m por lado) são "em geral", segundo a página da SEINFRA. Atos citados na Portaria 194/1999 e não lidos: Lei estadual 4.660/1986, art. 21, § 3º; Decreto 7.517/1999; Lei 7.314/1998; DL 816/1946. Também não li as Portarias SEINFRA 475/2007, 32/2013 e 99/2015 (tarifas).
2. **Faixa não edificável em imóvel rural:** controversa. Não achei precedente do STJ nem parecer específico sobre o tema ✖.
3. **Base do DNIT** (`vw_faixa_dominio`): o próprio DNIT a rotula como "Informacoes teste". `vw_faixa_reconhecida` é oficial, mas eu a conferi só pelo WFS, sem ver o termo BA 104 em PDF ✖.
4. **Padrão de 40 m por lado para BR:** é estatístico, não legal. Rodovias de classes II e III, ou antigas, podem ter 15 a 25 m por lado (BR-349 tem 20 m). Com o padrão, a faixa pode ficar **maior** que a real e tirar área do cliente; por isso a confirmação é obrigatória.
5. **Rito para o lindeiro obter declaração ou termo do DNIT** (rodovia não concedida): não encontrado ✖. A IN 75 só cita um "Termo de Reconhecimento de Limites".
6. **IN DNIT 20/2020 × IN 75/2021:** a 75 reproduz o procedimento. Não confirmei a revogação expressa da 20 ✖.
7. **Res. ANTT 6.000/2022 (RCR 2):** numeração dos artigos conferida no texto consolidado da LegisWeb, com alterações pelas Res. 6.032/2023, 6.053/2024 e 6.079/2026. Conferir no site da ANTT ✖.
8. **Provimento CNJ 195/2025:** texto do art. 440-AX, § 3º lido na transcrição da Migalhas. Data de vigência não confirmada (fontes falam em 90 dias após a publicação) ✖.
9. **Concessões federais na BA hoje** (BR-116/BR-324, BR-101 sul, novo edital ANTT 2026 da BR-116/BA-PE): situação não verificada ✖. Usar o campo `Administracao` do SNV e confirmar.
10. **Larguras da BR-101 (fora do trecho ECO101), BR-407 e BR-110 na BA:** não encontradas ✖. Um estudo ambiental do DNIT citado em busca ("70 m" na BR-101 PE/AL/SE/BA) **não pôde ser aberto** (HTTP 503) e por isso não entrou.
11. **Classes de 1949 × classes de 1999:** sem correspondência oficial. O manual DNER de 1999 não foi lido (PDF em imagem) ✖.
12. **§ 5º da Lei 6.766:** "data de promulgação deste parágrafo" foi tomada como 25/11/2019 (data da Lei 13.913; DOU de 26/11/2019) ✖.
13. **Tipo de limite (LA3 × LA1/LA6) e tolerância "cerca = linha da faixa":** dependem da prática do cartório e do Comitê Regional ✖.
14. **Leis municipais baianas sobre estradas vicinais:** nenhuma localizada ✖.

---

## Fontes consultadas (todas acessadas em 05/11/2026)
- Lei 6.766/1979, compilada: https://www.planalto.gov.br/ccivil_03/leis/l6766.htm
- Lei 13.913/2019: https://planalto.gov.br/ccivil_03/_Ato2019-2022/2019/Lei/L13913.htm
- Lei 6.015/1973, compilada: https://www.planalto.gov.br/ccivil_03/leis/l6015compilada.htm
- Decreto 4.449/2002: https://www.planalto.gov.br/ccivil_03/decreto/2002/d4449.htm
- CTB (Lei 9.503/1997), art. 50: https://www.planalto.gov.br/ccivil_03/leis/l9503compilado.htm
- Código Civil, art. 102: https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm
- DNIT, Regulamentação atual da faixa de domínio: https://www.gov.br/dnit/pt-br/rodovias/operacoes-rodoviarias/faixa-de-dominio/regulamentacao-atual
- Res. DNIT 7/2021: https://www.gov.br/dnit/pt-br/rodovias/operacoes-rodoviarias/faixa-de-dominio/regulamentacao-atual/copy_of_resolucao72021.pdf
- Normas DNER para o Projeto das Estradas de Rodagem (1949/1973): https://www.gov.br/dnit/pt-br/rodovias/operacoes-rodoviarias/faixa-de-dominio/regulamentacao-atual/normas-para-o-projeto-das-estradas-de-rodagem
- IN DNIT 20/2020: https://www.gov.br/dnit/pt-br/assuntos/planejamento-e-pesquisa/desapropriacao-e-reassentamento/profaixa/instrucoes-normativas/IN_20-2020.pdf
- IN DNIT 75/2021: https://www.gov.br/dnit/pt-br/assuntos/planejamento-e-pesquisa/desapropriacao-e-reassentamento/profaixa/instrucoes-normativas/IN_75.pdf
- Arquivo de DUPs do DNIT, Bahia: https://www.gov.br/dnit/pt-br/assuntos/planejamento-e-pesquisa/desapropriacao-e-reassentamento/ba
  - Portaria 37/1973 (BR-324): …/ba/br-324/portaria_00037_1973_br324ba_salvador-feira-de-santana.pdf
  - Portaria 01/1979 (BR-116): …/ba/br-116/portaria_00001_1979_br116ba_jequie_divisa-ba-mg.pdf
  - Portarias 111/2017 e 1.778/2018 (BR-116): …/ba/br-116/portaria_00111_2017_br116ba_div-pe-ba-ibo_entr-br235_lote-1.pdf e …/ba/br-116/portaria_1778_2018_br116ba_entr-br349-teofilandia-entr-ba504-santanopolis.pdf
  - Portaria 966/2013 (BR-407): …/ba/br-407/portaria_00966_2013_br407ba_entr-br122-235-423-petrolina-juazeiro-juremal.pdf
- GeoServer do DNIT (WFS): https://servicos.dnit.gov.br/dnitgeo/geoserver/ows (camadas `vgeo:vw_faixa_reconhecida`, `vgeo:vw_faixa_dominio`, `vgeo:vw_snv_rod`)
- Res. ANTT 6.000/2022 (RCR 2), texto consolidado: https://www.legisweb.com.br/legislacao/?id=493520
- Despacho 13/2021/GM/MINFRA (DOU): https://www.in.gov.br/en/web/dou/-/despacho-n-13/2021/gm/minfra-309010172 (resumo no IRIB: https://www.irib.org.br/despacho-n-13-2021-gm-minfra/)
- Provimento CNJ 195/2025, art. 440-AX, § 3º (transcrição): https://www.migalhas.com.br/coluna/migalhas-notariais-e-registrais/440481/retificacao-de-area-e-provimento-cnj-195-25--anuencia-do-confrontante
- INCRA, MTGIR 2ª ed.: https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/Manual_Tecnico_de_Georreferenciamento_2_Edicao.pdf
- INCRA, Manual Técnico de Limites e Confrontações, 1ª ed. (2013): https://sigef.incra.gov.br/static/documentos/manual_tecnico_limites_confrontacoes_1ed.pdf
- INCRA, NTGIR 3ª ed.: https://sigef.incra.gov.br/static/documentos/norma_tecnica_georreferenciamento_imoveis_rurais_3ed.pdf
- INCRA, Manual para Gestão da Certificação, 2ª ed.: https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/manualgestaocertificacao2edicao2023.pdf
- INCRA, WFS SIGEF: https://geoportal.incra.gov.br/geoserver/ows (camada `geonode:sigef_geo`)
- SEINFRA-BA, Apresentação: https://www.ba.gov.br/infraestrutura/56/apresentacao-faixa-de-dominio · Legislação: https://www.ba.gov.br/infraestrutura/11995/legislacao · Como funciona: https://www.ba.gov.br/infraestrutura/57/como-funciona · Instruções técnicas: https://www.ba.gov.br/infraestrutura/12054/instrucoes-tecnicas · Histórico: https://www.ba.gov.br/infraestrutura/63/historico
- Portaria DERBA 194/1999 (arquivo web): http://web.archive.org/web/20130918180111/http://derbajblb02.derba.ba.gov.br:80/modelostermos/Portaria_DERBA_194.pdf
- CLN, Manual BA-099 V2: https://clnorte.com.br/pdf/faixa_dominio/+%20Implanta%C3%A7%C3%A3o,%20regulariza%C3%A7%C3%A3o%20ou%20modifica%C3%A7%C3%A3o%20de%20acesso%20rodovi%C3%A1rio.pdf
- CONCEF (BA-052): https://www.concefsa.com.br/regularizacao-da-faixa-de-dominio-do-sistema-rodoviario-ba-052/
- ECO101 (Câmara dos Deputados): https://www2.camara.leg.br/atividade-legislativa/comissoes/comissoes-temporarias/externas/55a-legislatura/fiscalizacao-da-concessionaria-eco-101-br-101-es/documentos/outros-documentos/ApresentaoECO101.pdf
- Guaíra/PR, Lei 1.215/2002: https://ti.guaira.pr.gov.br/dioe/documentos/anexo/LEI_1215_2002.pdf
- Botucatu/SP, Decreto 13.782/2025: https://www.botucatu.sp.gov.br/legislacao/download-lei/31846
