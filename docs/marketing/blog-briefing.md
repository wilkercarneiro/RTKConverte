# Briefing do blog Vertces (redação de posts)

Este é o manual de quem escreve um post do blog em `vertces.com.br/blog/`. Vale para os 30 posts de lançamento e para os próximos.

## 1. Formato do arquivo

Cada post é um arquivo `content/blog/<slug>.md`, com **frontmatter em JSON** entre duas linhas `---` e o corpo em Markdown.

```
---
{
  "titulo": "Planilha ODS do SIGEF: como preencher sem rejeição",
  "seoTitulo": "Planilha ODS do SIGEF: como preencher sem rejeição | Vertces",
  "descricao": "Entre 140 e 160 caracteres, com a palavra-chave no começo e uma promessa concreta.",
  "slug": "planilha-ods-sigef-como-preencher",
  "data": "2026-11-06",
  "atualizado": "2026-11-06",
  "categoria": "guias-tecnicos",
  "palavraChave": "planilha ods sigef",
  "palavrasRelacionadas": ["como preencher planilha sigef", "erro planilha sigef", "..."],
  "resumo": "2 a 3 frases que respondem a pergunta principal sozinhas. É o bloco 'Resposta rápida' do topo e o trecho que as IAs citam.",
  "faq": [
    { "p": "Pergunta como a pessoa digitaria?", "r": "Resposta completa em 1 a 3 frases, sem depender do texto." }
  ],
  "fontes": [
    { "titulo": "INCRA: Norma Técnica para Georreferenciamento de Imóveis Rurais", "url": "https://www.gov.br/incra/..." }
  ]
}
---

Corpo em Markdown. Sem H1 (o título vira H1). Comece pelo primeiro parágrafo.
```

- `categoria`, uma de: `funcionalidades`, `guias-tecnicos`, `legislacao-e-prazos`, `para-proprietarios`, `mercado`.
- `seoTitulo`: até 60 caracteres antes do " | Vertces". Se o título já couber, repita.
- `faq`: de 4 a 6 perguntas, **diferentes** das H2 do texto. São as perguntas de cauda longa ("dá para…", "precisa de…", "quanto tempo…").
- `fontes`: de 2 a 5 links oficiais ou de referência (gov.br/incra, planalto.gov.br, car.gov.br, sigef.incra.gov.br, IRIB, DNIT, CNA). **Só cite o que você abriu e confirmou.** Fonte que não abriu, não entra.
- JSON válido: aspas duplas e sem vírgula sobrando. Aspas dentro de texto viram `“ ”`.

## 2. Estrutura do corpo (SEO + GEO)

As IAs (ChatGPT, Gemini, Perplexity, AI Overviews do Google) citam trechos que respondem sozinhos. Escreva para ser citado:

1. **Primeiro parágrafo = resposta direta** à palavra-chave, em até 3 frases. Nada de "Neste artigo vamos ver…".
2. **H2 em forma de pergunta ou de tarefa** ("Quanto tempo leva a certificação?", "Como conferir a sobreposição antes de protocolar"). De 5 a 8 H2. H3 só quando precisar.
3. **Cada seção abre com 1 frase que responde** e depois detalha. Frases curtas. Um assunto por parágrafo.
4. **Pelo menos uma lista numerada ou uma tabela** por post (passo a passo, comparação, checklist). Tabela em Markdown simples.
5. **Definição explícita** do termo principal na primeira vez ("Memorial descritivo é o documento que…").
6. **Números com contexto e fonte** (prazo, artigo de lei, largura de faixa). Sem número inventado.
7. **3 a 6 links internos** para outros posts da lista (seção 6), no meio do texto, com âncora descritiva: `[como evitar sobreposição no SIGEF](/blog/sobreposicao-sigef-como-evitar/)`. Também pode ligar para `/#servicos`, `/#loteamento`, `/#car`, `/#sigef`, `/#documentos`.
8. **Vertces no lugar certo:**
   - posts de `funcionalidades` e `mercado` mostram o Vertces fazendo o trabalho, com uma seção "Como fazer no Vertces" (passos reais da tela, ver seção 4);
   - posts de guia, legislação e proprietários ensinam de verdade primeiro e citam o Vertces em 1 ou 2 momentos naturais (uma seção curta "Onde um sistema ajuda" ou um parágrafo). Nada de propaganda em todo parágrafo.
9. **Não escreva o CTA final** (o gerador põe um bloco de chamada no fim). Pode haver uma chamada curta no meio do texto, em texto normal com link para `/#contato`.
10. **Tamanho:** de 1.100 a 1.800 palavras no corpo. O pilar (`georreferenciamento-o-que-e`) pode passar de 2.000.

## 3. Voz

- Português do Brasil, direto, de colega de profissão para colega. Concreto: arquivo, tela, documento, cartório.
- Tratamento por "você". Termos técnicos certos (vértice, azimute, confrontante, SIRGAS 2000, NTGIR, ODS, credenciado, RT, CCIR, SNCR, matrícula, averbação).
- Proibido: "no mundo de hoje", "revolucionário", "transformar a forma como", "descubra", "mergulhe", "jornada", "game changer", "solução completa e inovadora", emoji, exclamação em série, travessão longo como muleta (use vírgula, dois-pontos ou ponto).
- Sem superlativo vazio. "O melhor sistema" só com o motivo do lado (o que ele faz que os outros não fazem).
- **Nunca prometa aprovação no SIGEF, prazo do INCRA ou do cartório.** O Vertces confere e avisa; quem certifica é o INCRA e quem registra é o cartório.
- **Sem preço do Vertces** (planos e valores estão no sistema e mudam). Pode dizer que há planos para autônomo, escritório e empresa, e que dá para assinar pelo site ou agendar uma demonstração.
- Exemplos com nomes fictícios (Sítio Boa Esperança, Fazenda Santa Luzia, VRTX-M-0001). Nunca cliente real.
- Não fale mal de concorrente pelo nome. Compare categorias (planilha + CAD, plugin de QGIS, programa de desktop, sistema web).

## 4. O que o Vertces faz (só afirme isto)

Sistema web (navegador, sem instalar), para escritórios de georreferenciamento, agrimensores, topógrafos e engenheiros credenciados no INCRA. SIRGAS 2000, UTM fusos 18S a 25S, fuso detectado pelas coordenadas (quando a UF tem dois fusos, o sistema pergunta e sugere o mais usado pelo escritório).

**Fluxo base (3 passos):** 1) envia o arquivo do levantamento; 2) confere no mapa (vértices, área, perímetro no padrão do SIGEF, confrontante de cada trecho) e ajusta; 3) baixa os documentos com logo e modelos do escritório.

**Leitura do arquivo:** lê o TXT/CSV exportado do receptor GNSS/RTK "do jeito que sai do campo", com apoio de IA para formatos diferentes; separa versões do mesmo ponto (ex.: levantamento × pós-processado) e deixa escolher; conferência do TXT com ajuste de pontos e esboço antes de gastar crédito (o crédito só é consumido ao prosseguir).

**Documentos:** memorial descritivo, memorial tabular, planilha SIGEF (ODS) com prévia e avisos de consistência antes de baixar (regras da NTGIR 3ª ed., ex.: precisão de 0,50 m em limite artificial), planta A1 ou A3 em PDF com malha UTM, norte, quadro analítico, carimbo com logo, planta de situação com imagem de satélite automática; editor de planta (mover, trocar texto e cor, apagar, acrescentar texto ou linha; o traçado do terreno fica travado). Na **matrícula**, 7 peças técnicas: memorial descritivo, memorial tabular, cartas de anuência (uma por confrontante), declaração do técnico, declaração do proprietário, requerimento, declaração de faixa de domínio. Na **posse**, 4 peças e planta em A3. Monografia dos marcos (DOCX, uma página por marco, só marcos do próprio credenciado). Imagem da assinatura do RT nos documentos. QR Code de autenticidade na planta, com página pública de verificação (sem dados do proprietário). Renomear vértices em lote e inserir ponto num lado. Documentos com o logo e os modelos do escritório; sem modelo próprio, timbre automático (logo, marca d'água e rodapé com os dados da empresa). Histórico de versões de cada documento.

**SIGEF e vizinhos:** mapa interativo com as parcelas já certificadas em volta (base pública do INCRA); a sobreposição aparece antes de protocolar; os vértices certificados do vizinho entram na sua divisa (modo vértices certificados), e dá para trazer o CSV do vizinho certificado. Imóvel já certificado: envia o PDF do SIGEF e o sistema monta as peças e a planta.

**Modalidades de serviço:** serviço completo (matrícula ou posse); conferência de área (prévia de área e perímetro sem consumir a numeração oficial dos vértices); serviço com glebas (divide pela seleção na planta, cada gleba com sua aba e o confrontante interno preenchido); divisão em partes iguais (partilha e herança: partes de mesma área, divisas retas, frente para a estrada a todos, GEO do total, um GEO por herdeiro, arquivo de locação dos marcos); desmembramento (remanescente + áreas desmembradas, área digitada, lado escolhido ou divisa desenhada, documentos de cada área: memorial, tabular, planta, planilha); loteamento; CAR; peças a partir do PDF do SIGEF.

**Restrições:** análise de restrições do imóvel em bases públicas (terra indígena, unidade de conservação, assentamento, território quilombola, embargos do IBAMA e do ICMBio, faixa de fronteira, área militar, sítio arqueológico), com prévia grátis antes do crédito e relatório em PDF. Faixa de domínio de rodovia (federais pelo DNIT; estaduais da BA pela SEINFRA) e faixa não edificável de 15 m (Lei 6.766) tracejada na planta. Curvas de nível e 3D do terreno no serviço de georreferenciamento (DXF/KML).

**Exportar:** a área em KML, KMZ, DXF em camadas, pacote CAD (.zip com DXF, .prj e LEIAME), GPX, SHP, GeoJSON, CSV e TXT para a coletora.

**Loteamento:** perguntas sobre o terreno (acesso, lote mínimo, largura das ruas, áreas públicas); três propostas automáticas seguindo as regras da Lei 6.766; prancheta editável estilo CAD (seta e caixa de seleção, desenhar lote, unir, dividir, cortar, arrastar divisas); linha central de quadra (fundo com fundo por construção, laterais no esquadro); botão Igualar áreas; avisos de lote fora das medidas; projetos de infraestrutura gerados (água, esgoto, drenagem, energia e iluminação, com pranchas, memorial de cálculo, quantitativos e DXF, a conferir com a concessionária); importar loteamento pronto (DXF/KML/GeoJSON) e documentos lote a lote. Entregas: planta PDF, memoriais dos lotes, quadro de lotes, KML, DXF, locação para a coletora GNSS. **Maquete 3D** no navegador sobre o satélite: ruas, casas, sol e sombra por hora, voo de drone, vídeo MP4 e GLB.

**CAR:** KML ou GPX da área → reserva legal, APP de rios, área produtiva e vegetação nativa, em shapefiles SIRGAS 2000 prontos para o SICAR.

**Escritório:** cadastro de clientes, imóveis e confrontantes reaproveitados; equipe com vários operadores, cada um com seu acesso; auditoria (quem criou e quem alterou); dados de cada escritório isolados no banco; integração com o CRM GPROL (pedido vendido vira serviço, o card anda sozinho no funil); tutoriais em vídeo dentro do sistema; planos com créditos por serviço; assinatura pelo site (Pix ou cartão) ou demonstração.

**Não afirme** (não existe ou não está confirmado): protocolo automático no SIGEF, assinatura digital ICP-Brasil, app de celular para campo, ortomosaico de drone, integração com cartório, cálculo de ITR, preço, número de clientes, "aprovação garantida".

Detalhe técnico, se precisar: `docs/loteamento.md`, `docs/car.md`, `docs/recuo-rodovias.md`, `docs/restricoes-fontes.md`, `docs/leitura-universal.md`, `docs/guia-primeiros-passos.md`, `docs/infraestrutura.md`.

## 5. Fatos do setor já checados (06/11/2026)

- Prazo: o **Decreto 12.689/2025** (21/10/2025) adiou para **21/10/2029** a exigência do georreferenciamento certificado para todos os imóveis rurais, sem escalonamento por área (antes, até 25 ha venceria em 20/11/2025). Tramita o PL 1664/2025 (proposta de 2030). **Atenção:** em 07/05/2026, uma liminar da 3ª Vara Federal Cível do Maranhão (ação popular 1086967-47.2025.4.01.3700) suspendeu o decreto em parte e restabeleceu a exigência para os imóveis cujo prazo já tinha vencido (na prática, os acima de 100 ha). Para os menores, por enquanto, vale 2029. A decisão é provisória: sempre escreva "confirme no cartório" e não afirme que foi derrubada ou mantida sem fonte. O georreferenciamento continua exigido em desmembramento, parcelamento e remembramento, e o registrador pode exigir quando a descrição é precária. Base: Lei 10.267/2001, art. 176 da Lei 6.015/73, Decreto 4.449/2002.
- SIGEF: julho de 2026, o INCRA automatizou o deferimento de pedidos de cancelamento de certificação que cumpram as regras (ex.: diferença de área da nova parcela < 10% e < 25 ha; ODS da nova certificação obrigatória na maioria dos casos; indeferimento automático se a nova parcela sobrepõe área fora do pedido). Fonte: gov.br/incra, notícia de 06/07/2026.
- 3ª edição da NTGIR e Manual Técnico: unifica procedimentos e admite sensoriamento remoto em limites naturais.
- Fração mínima de parcelamento: Lei 5.868/72 (art. 8º) impede desmembrar abaixo da FMP; o CCIR traz a FMP do município.
- CAR: Lei 12.651/2012 (Código Florestal), SICAR em car.gov.br.
- Loteamento: Lei 6.766/1979 (faixa non aedificandi de 15 m ao longo de rodovias e águas, com as alterações da Lei 13.913/2019; aprovação na prefeitura; profissional com CREA/CAU).

Confira antes de usar qualquer outro número. Se não achar a fonte, escreva sem o número.

## 6. Os 30 posts (slugs para links internos)

| # | slug | categoria | palavra-chave principal |
|---|---|---|---|
| 1 | georreferenciamento-o-que-e | guias-tecnicos | o que é georreferenciamento de imóvel rural (pilar) |
| 2 | prazo-georreferenciamento-2029 | legislacao-e-prazos | prazo georreferenciamento |
| 3 | quanto-custa-georreferenciamento | para-proprietarios | quanto custa georreferenciamento |
| 4 | georreferenciamento-para-vender-imovel-rural | para-proprietarios | preciso de georreferenciamento para vender fazenda |
| 5 | georreferenciamento-usucapiao-posse | para-proprietarios | georreferenciamento para usucapião / posse |
| 6 | memorial-descritivo-georreferenciamento | funcionalidades | memorial descritivo georreferenciamento |
| 7 | planilha-ods-sigef-como-preencher | guias-tecnicos | planilha ods sigef |
| 8 | txt-receptor-gnss-para-sigef | funcionalidades | converter txt do gnss para sigef |
| 9 | sobreposicao-sigef-como-evitar | funcionalidades | sobreposição sigef |
| 10 | planta-georreferenciamento-a1-a3 | funcionalidades | planta de georreferenciamento |
| 11 | pecas-tecnicas-georreferenciamento-cartorio | funcionalidades | documentos do georreferenciamento para o cartório |
| 12 | carta-de-anuencia-confrontantes | guias-tecnicos | carta de anuência confrontante |
| 13 | pecas-a-partir-do-pdf-sigef | funcionalidades | imóvel certificado sigef refazer planta e memorial |
| 14 | software-loteamento-lei-6766 | funcionalidades | software para projeto de loteamento |
| 15 | maquete-3d-loteamento | funcionalidades | maquete 3d de loteamento |
| 16 | divisao-de-terra-entre-herdeiros | funcionalidades | divisão de terra entre herdeiros |
| 17 | desmembramento-imovel-rural | legislacao-e-prazos | desmembramento de imóvel rural |
| 18 | car-shapefile-sicar-reserva-legal-app | funcionalidades | como fazer o car / shapefile sicar |
| 19 | analise-de-restricoes-imovel-rural | funcionalidades | consultar restrições do imóvel rural (TI, UC, embargo) |
| 20 | monografia-de-marco-e-qr-de-autenticidade | funcionalidades | monografia de marco georreferenciamento |
| 21 | exportar-kml-dxf-shapefile-gpx | funcionalidades | converter coordenadas para kml dxf shapefile |
| 22 | gestao-de-escritorio-de-georreferenciamento | mercado | gestão de escritório de topografia |
| 23 | ntgir-3-edicao-o-que-mudou | legislacao-e-prazos | ntgir 3ª edição |
| 24 | tipos-de-vertice-m-p-v-sigef | guias-tecnicos | vértice tipo M P V sigef |
| 25 | sirgas-2000-fuso-utm-como-descobrir | guias-tecnicos | qual meu fuso utm sirgas 2000 |
| 26 | precisao-posicional-georreferenciamento | guias-tecnicos | precisão posicional georreferenciamento 0,50 m |
| 27 | atualizacao-sigef-2026-cancelamento-automatico | legislacao-e-prazos | sigef cancelamento de certificação 2026 |
| 28 | faixa-de-dominio-rodovia-recuo | guias-tecnicos | faixa de domínio rodovia / faixa non aedificandi |
| 29 | melhor-software-de-georreferenciamento | mercado | melhor software de georreferenciamento |
| 30 | vertces-sistema-de-georreferenciamento | mercado | vertces / sistema web de georreferenciamento |
