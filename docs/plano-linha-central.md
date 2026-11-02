# Plano: loteamento por linha central

Pedido do Wilker (2026-11-01, depois do igualar v3):

> Em uma área como essa, quero ter o espaço onde eu faça a divisão e os terrenos fiquem fundo com fundo, mesmo que eu faça manualmente. Se tiver errado, ter a opção de ajuste de fundo com fundo, onde ele pode ajustar as linhas do terreno mais o espaço dele para dar a área igual, mais o ajuste correto de fundo com fundo, mantendo proporções parecidas entre fundo, frente e laterais de cada um. O sistema também deve reconhecer o arredondamento das quinas das ruas como uma quina do terreno, para poder identificar a frente, o fundo etc. Tem espaços que podem ficar não tão proporcionais, mas devemos ter como modificar de maneira fácil o fundo com fundo dos terrenos e as angulações da linha central deles.

**Versão visual com demonstração interativa:** [Loteamento por linha central](https://claude.ai/artifact/HY9QcHzdkfLB3hh72gRch4) (artifact privado do Wilker).

**Andamento (2026-11-02, "Pronto, aplique o plano")** — as 6 decisões ficaram com as propostas.

No ar (push → Vercel):

| Etapa | Commit | O que entrou |
|---|---|---|
| 0 | `ca5445f` | quinas, esquina, testada, fundo e memorial com a curva |
| 1 a 3 | `52fcf5e` | motor no sistema, quadra estruturada, botão "Ajustar fundo com fundo" e linha central editável na prancheta |
| (sem número) | `1b298f9` | "em todas as quadras", camada `LINHA_CENTRAL` no DXF, Esc cancela |
| 4, parte | `362e389` | testa em ponta de estrada inclinada |

Ficou para depois:
- regra municipal de esquina (+% ou +m na testada);
- lote travado (área/frente) dentro da quadra estruturada;
- o gerador já sair estruturado (hoje é um clique depois de gerar: "em todas as quadras");
- divisa arrastada à mão andar de rua a rua sem sair da estrutura.

**Protótipo:** `docs/prototipos/linha-central/` (ver "Protótipo", mais abaixo).

## Resumo

Hoje a quadra desenhada à mão vira uma lista de polígonos soltos (`QuadraCfg.lotes`). O sistema adivinha o fundo com fundo a cada clique e, ao igualar áreas, corrige polígono por polígono. Por isso aparecem degraus, laterais tortas e lotes quebrados, e por isso o igualar trava.

A proposta é dar à quadra de duas fileiras uma **estrutura**:
- as duas ruas que se olham (frentes);
- a **linha central** (polilinha editável);
- as **divisas**: cada uma com uma junção sobre a linha e um pé em cada rua;
- as **cabeceiras**: esquina direta, ponta de fileira única ou lotes "de testa".

Os lotes passam a ser **gerados** a partir dessa estrutura. O fundo com fundo sai por construção e as áreas ficam iguais por cálculo exato. A linha central é do operador: ele a vê, arrasta, dobra e trava.

**Prova no EDILSON** (lotes do protótipo gravados no projeto real e medidos pelo `calcular` atual):

| Quadra | Hoje | Linha central |
|---|---|---|
| A | 26 lotes, 245,9–276,4 m²; 3 avisos (A-16 com fundo de 41,30 m, A-19 com frente de 4,07 m, A-26 com 5 quinas) | 26 lotes, 268,65–268,66 m², 0 avisos |
| C | 24 lotes, 150,2–311,0 m², 0 avisos | 22 lotes de 233,21 m² e 2 de esquina com 354,21 m², 0 avisos |
| D | 29 lotes, 220,1–295,5 m²; 1 aviso (D-28 com 5 quinas) | 27 lotes de 233,72 m² e 2 de 224,97 m², 0 avisos |
| Projeto | 136 lotes, 4 avisos de lote | 136 lotes, 0 avisos de lote, mesma área loteada (33.000 m²), sobra 0 |

## 1. Diagnóstico (auditoria de 2026-11-01)

Fontes: leitura do código, scripts do protótipo e três auditorias paralelas (motor, interface, mercado). Os números são de medição; os de "loteamento de teste" vêm de `tests/fixtures/loteamento_gleba.mjs`.

### 1.1 Motor

- **A quadra desenhada perde a estrutura.**
  - `quadraDesenhada` (calculo.ts:1058-1085) devolve `fileiras: 1`, `fundo: null` e `cortes: []`.
  - Ao congelar, também se perdem fileira e índice reais, `dirCorte`/`angCorte`, os ajustes (edicao.ts:102) e o vínculo do arco com a `CurvaEsquina`.
  - Não existe objeto persistente de linha central no `Projeto`. Ela é reencontrada a cada chamada por `estruturaDeDivisas` (edicao.ts:833). As heurísticas são junção com 3 ou mais divisas, até 50° de `q.u` e até 35° de desvio.
  - No estado de produção do EDILSON, a "linha de fundo" da D está em 11 pedaços de 2 pontos, separados por degraus de 0,4–0,5 m. A da A está em 5 pedaços.
- **Igualar sobre polígonos soltos.** O `igualarAreas` (edicao.ts:1072) desliza divisas e remenda anéis (`assentar`, `semPassagens`, `normalizar`). A qualidade depende da forma, e a quadra A do EDILSON só fechou "por partes".
- **Quinas por limiar binário** (`quinasDe`, geom.ts:419, `curto = 2`, `giroMin = 12`):
  - arco de 90° com corda de 2 m ou mais (raio a partir de 12,8 m) conta 0 quinas;
  - estrada levantada com pontos a menos de 2 m funde quinas reais;
  - a soma com sinal apaga dentes (A-19);
  - chanfro conta 2 quinas: no loteamento de teste, 22 de 32 esquinas acusam "5 quinas".
- **A-26 e D-28** têm a 5ª quina porque a dobra da estrada levantada cai dentro da frente: vértice 10 do perímetro com −21,3° e vértice 6 com +18,2°.
- **Esquina errada.**
  - `l.esquina` é verdadeiro com "2 ou mais refs distintas" (calculo.ts:2544), e cada lado do perímetro tem ref própria (`borda9`, `borda10`). Por isso A-22, A-26 e D-28 viram esquina e ganham acréscimo de esquina no VGV.
  - `esquinaDe` (calculo.ts:783) discorda de `l.esquina` em 11 lotes.
  - A frente da esquina soma as duas ruas.
  - A profundidade é medida até a frente mais próxima: na esquina mede a largura (A-17: 6,4 m) e no lote de rua a rua mede meia quadra.
- **Raio pedido não respeitado:** 4 das 14 curvas do EDILSON. O limite de 0,4 × o lado vizinho (calculo.ts:403/415) derruba o raio; abaixo de 0,5 m a curva vira chanfro sem aviso.
- **Memorial:** `ladosNominais` (saidas.ts:387) reparte o arco entre Frente e Lateral (no loteamento de teste, em 35 de 43 esquinas). A regra dos 45° põe a estrada nos "fundos" do A-03.

### 1.2 Interface (prancheta)

- A linha de fundo:
  - só aparece com a quadra selecionada ou com 2 ou mais lotes;
  - não tem ponto novo, apagar ponto, girar trecho, endireitar, centralizar ou cadeado;
  - não tem ângulo nem deslocamento numéricos;
  - as pontas não têm alça (Editor.tsx:334-405).
- Arrastar a lateral, ou digitar Frente/Área, usa `deslizar`: só a frente anda e o lote de trás passa a encostar em dois. Medido na quadra G do loteamento de teste.
- Ações que **apagam o desenho à mão sem avisar:** digitar "Linha de fundo – m da rua", `fundo`, `fileiras` e `iguais` (acoes.ts:80).
- A mensagem do motor ao soltar é descartada (Editor.tsx:596-604), e Esc não cancela o arraste.
- Cada quadro de arraste roda `calcular` inteiro. Medido: ~22 ms numa quadra de 32 lotes.
- A ferramenta Frente (T) usa `ladosRetos`, que quebra no arco: em 35 de 43 esquinas do loteamento de teste não há lado de rua clicável.
- Não existe aviso de fundo com fundo quebrado. Também não existe métrica de fundo com fundo nem de proporção nos testes.

### 1.3 Mercado (pesquisa de 2026-11-01)

| Ferramenta | Lotes | Limite |
|---|---|---|
| Civil 3D (Autodesk) | Slide/swing line, área e testada mínimas, testada no recuo, profundidade, repartir sobra | Fundo desenhado à mão ([boas práticas](https://help.autodesk.com/cloudhelp/2015/ENU/Civil3D-BestPractices/files/GUID-E24C0939-BBF5-4C10-BC1A-3E037D4E5352.htm)); com arco de esquina "no solution will be found" ([tutorial](https://help.autodesk.com/cloudhelp/2017/ENU/Civil3D-Tutorials/files/GUID-35AC8372-274B-4EC0-927E-29B2B8C9D614.htm)) |
| Carlson LotNet | Lateral perpendicular à rua ou ao fundo; fundo mínimo; sobra vira linha de fundo ([manual](https://files.carlsonsw.com/mirror/manuals/Carlson_2022/source/Survey/Area_layout/Lotnet_Subdivide_Area/LotNet_Subdivide_Area.html)) | Esquina com arco não documentada |
| CityEngine (Esri) | Esqueleto da quadra (fundo com fundo automático), escolha da rua da esquina ([doc](https://doc.arcgis.com/en/cityengine/2026.0/help/help-layers-block-parameters.htm)) | Só parâmetro; não é cadastral |
| ParcelFlux (QGIS) | Fila dupla, `hline_offset` da linha central, esquina +% ([manual](https://www.geophilo.com/parcelflux/manual.html)) | Sem edição interativa |
| TestFit, Forma, TraceAir, Giraffe | Estudo de rendimento | Conceitual; sem memorial nem locação |
| Métrica TOPO, Posição, topoGRAPH | CAD de mesa | Geração de lotes não documentada |
| Vimob, m2Corp, Sienge | Mapa de vendas e reserva | Não usam a geometria do projeto |

Regras adotadas:
- **Lateral:** perpendicular à rua reta e radial na curva, com 15°–20° de tolerância ([West Palm Beach](https://wpb.org/files/assets/city/v/1/development-services/documents/code-compliance/standards-for-code-compliance-subdivision-including-major-and-minor.pdf); Mattawa-WA).
- **Profundidade:** até 3 × a frente.
- **Testada da esquina:** medida até a interseção das divisas estendidas, ou seja, o PI ([SP, Res. CPPU 003/2018](https://prefeitura.sp.gov.br/web/licenciamento/w/desenvolvimento_urbano/participacao_social/conselhos_e_orgaos_colegiados/cppu/267723)).
- **Raio do alinhamento:** 6 m ([Blumenau, LC 748/2010](https://geo.blumenau.sc.gov.br/menu-informacoes/informacoesdesmembrar.pdf)).
- **Esquina com testada maior:** 13 m contra 10 m ([Ponta Porã, LC 210/2021](https://pontapora.ms.gov.br/v2/wp-content/uploads/2022/11/Lei-Complementar-210-Lei-de-Parcelamento-do-Solo.pdf)).
- **Lei 6.766, art. 4º II:** 125 m² e 5 m de frente.

**Oportunidade:** ninguém tem a linha central como objeto editável, a esquina com arco tratada como uma quina, o "igualar com forma" depois da edição, nem o mapa de vendas feito com a geometria do projeto.

## 2. Proposta: quadra estruturada

### 2.1 Modelo

```ts
interface EstruturaQuadra {
  /** linha central em UTM (o operador edita); ausente = automática */
  linhaCentral?: Pt[];
  travada?: boolean;                 // cadeado: só o operador mexe na linha
  lotes: number;                     // total da quadra
  /** alvo por lote (área travada) — índice na ordem de numeração */
  alvos?: { indice: number; area: number }[];
  cabeceiras?: ["auto" | "direta" | "ponta" | "testa", "auto" | "direta" | "ponta" | "testa"];
  lotesCabeceira?: [number | null, number | null];
  esquinas?: "absorver" | "iguais";  // sobra da cabeceira inclinada
}
// QuadraCfg ganha `estrutura?: EstruturaQuadra`. Com ela presente, os lotes são
// GERADOS (como hoje no automático); `lotes` (desenho livre) continua para os casos fora do modelo.
```

O projeto continua sendo intenção: nada de lote gravado na quadra estruturada.

### 2.2 Reconhecimento da forma

- **Quinas** (`quinasArco`):
  - vértice "curvo" é o que tem giro ≥ 12° ou curvatura ≥ 1/40 m⁻¹;
  - vértices seguidos viram uma quina só quando formam um **arco** (giros pequenos, corda compatível com raio de até 40 m, PC/PT incluídos) ou um **chanfro** (dois cantos parecidos a até 3,5 m);
  - canto mais dobra vizinha continuam duas quinas;
  - a quina fica no **PI** (cruzamento das tangentes);
  - a curva aberta de estrada não conta.
- **Frentes:** as duas cadeias de rua mais longas que se olham. As cadeias são cortadas nos cantos de 40° ou mais e na troca de rua. A estrada levantada é uma rua só, mesmo com uma ref por lado do perímetro.

### 2.3 Cálculo

1. **Eixo:** linha equidistante das duas frentes, traçada por continuação (passo de 1 m, correção pelo gradiente de d₁ − d₂). Fica onde as fileiras têm a mesma profundidade.
2. **Zonas:**
   - duas fileiras onde a meia largura é de pelo menos `profundidadeMin`;
   - **ponta** (lotes de rua a rua, cortes transversais) onde a quadra afina;
   - **testa** (lotes de frente para a rua da cabeceira) quando a cunha da cabeceira passa de 1 lote;
   - **direta** (lotes de esquina) nos demais casos.
3. **Área acumulada:**
   - a área da fileira 1, do início até a divisa k, só depende da divisa k: `A₁(u,t) = ½[K_B1(u) + P(u)×J(t) − K_C(t) + C₀×B1₀]`, com `K` = soma acumulada dos produtos vetoriais;
   - cada divisa é resolvida sozinha: junção `t` e pés `u` e `v` com `A₁ = τ₁ₖ` e `A₂ = τ₂ₖ` exatos, e `t` escolhido para minimizar o giro das duas laterais (seção áurea);
   - não há propagação de erro, por isso não há escada nem zigue-zague.
4. **Cabeceira inclinada (cunha):** com as laterais no esquadro, as fileiras diferem por uma constante W na ponta. A esquina da fileira mais comprida absorve W, ou ganha 1 lote a mais (todos iguais entre si), conforme a paridade da contagem. Com "todos iguais", W é levado pelo giro das laterais.
5. **Dobras:**
   - dobra de rua de 12° a 40° atrai a divisa mais próxima (entre as duas vizinhas, a que gira menos);
   - dobra da linha central vai para a junção mais próxima (até 3 rodadas) e só depois puxa a divisa.
6. **Linha central automática:**
   - eixo simplificado (Douglas-Peucker, 0,35 m), deslocado de lado até `S₁ − S₂ = W₀ + W₁` (fileiras empatadas);
   - se sobrar giro maior que 6°, um otimizador desloca os pontos para minimizar Σ giro², mantendo as áreas exatas: na A, de 31° para 18,6°;
   - entre as combinações de cabeceira, fica a de melhor nota: 100 × (lotes com 5 quinas) + 60 × desvio de área + 0,8 × giro máximo + 400 × cruzamentos.
7. **Validação** (toda resposta, antes de mostrar): nenhum cruzamento entre contornos, nenhum lote com 5 ou mais quinas, contagem certa, nenhuma divisa aberta, giro de no máximo 30° e desvio de área de no máximo 75%.

**Desempenho do protótipo:**
- quadra com a linha travada: 5–20 ms;
- arraste ao vivo: 7–9 ms;
- equilibrar ao soltar: 8–40 ms;
- ajuste automático: 0,15–0,9 s.

### 2.4 Interface

- **Linha central sempre visível** na quadra estruturada, inclusive com um lote selecionado, com o par fundo com fundo destacado.
- **Alças:**
  - losango no ponto (arrasta e dobra a linha ali);
  - barra no trecho (desloca paralelo);
  - a ponta corre pela rua da cabeceira (gira a linha);
  - duplo clique na linha cria ponto; duplo clique no ponto apaga.
- **Ao arrastar:** cálculo só da quadra e áreas por fileira ao vivo.
- **Ao soltar:** a linha desliza de lado até as fileiras empatarem, mantendo os ângulos. Se não fechar, o ponto vai até onde a quadra deixa (100/75/50/25% do movimento) e a mensagem diz por quê. Esc cancela.
- **Campos:** profundidade de cada fileira, ângulo de cada trecho, cadeado; botões Endireitar, Centralizar e "Ajustar fundo com fundo".
- **Cartão da quadra:** número de lotes; cabeceiras (direta, ponta ou testa, com a sugestão do sistema); esquinas (absorvem ou todos iguais); alvo de área; resumo com área por lote, maior giro, pares fundo com fundo e lotes com 5 quinas.
- **Divisa arrastada à mão:** anda de rua a rua, com a junção. Alt separa as fileiras, e a divisa fica marcada como "fora do fundo com fundo".
- **Aviso novo:** "fundo encosta em 2 lotes".
- **Nada apaga o desenho sem confirmar.**

## 3. Protótipo

Pasta `docs/prototipos/linha-central/` (fora do build; o tsconfig só inclui `src`):

| Arquivo | O que é |
|---|---|
| `espinha.ts` | motor completo: `quinasArco`, `estruturar`, `eixoEquidistante`, `montar`, `montarMelhor`, `otimizarC`, `notaDe`, `cruzamentos` |
| `sintetico.mjs` + `desenho.mjs` | retângulo com R6, trapézio, rua com dobra de 20°, triângulo com ponta (SVG de conferência) |
| `base.mjs`, `edilson.mjs`, `prova.mjs` | aplicam nas quadras reais do EDILSON e gravam no projeto para o `calcular` atual medir (precisam do corpus local `tests/corpus-real/edilson/`, fora do Git) |
| `demo/` | `app.ts` + `modelo.html` + `montar_pagina.mjs`. `dados.mjs` gera `dados.json` a partir do corpus (não versionado) |

Para rodar: `node docs/prototipos/linha-central/sintetico.mjs`; `node docs/prototipos/linha-central/prova.mjs A,C,D`.

Limites conhecidos do protótipo:
- **Cabeceira de estrada curva e muito inclinada** (esquerda da C e da D): a testa cruza divisas e é descartada pelo validador; o sistema fica com a esquina maior (C: 2 lotes de 354,21 m²).
- **Edição na A:** em 308 movimentos de até 5 m nos pontos da linha da quadra A (estreita, com estrada dobrando), 59% fecham na hora; o resto é resolvido pelo "até onde a quadra deixa".
- **Quadra de uma fileira, em L ou com rua no meio:** fora do modelo (continua no desenho livre).

## 4. Execução (cada etapa vai ao ar sozinha)

| Etapa | Entrega | Arquivos | Aceite | Estimativa |
|---|---|---|---|---|
| 0 | Reconhecedor único de quinas (arco, chanfro, dobra, PI) em todo o sistema; esquina pelo ângulo e não pela ref; frente, lateral na rua, laterais e fundos por lote | `geom.ts` (`quinasArco`), `calculo.ts` (lados, esquina, profundidade), `edicao.ts` (`ladosRetos`, `alcasDoLote`), `saidas.ts` (`ladosNominais`), `Editor.tsx` (ferramenta T) | sem falso "5 quinas" no loteamento de teste com chanfro; A-26/D-28 pelo motivo certo; memorial de esquina com Frente / Lateral / Fundos / curva; VGV sem acréscimo indevido | 1–2 dias |
| 1 | Motor da linha central no sistema; `QuadraCfg.estrutura`; `calcular` gera os lotes da estrutura | `linhaCentral.ts` (porta de `espinha.ts`), `modelo.ts`, `calculo.ts` | testes de propriedade (fundo com fundo exato, áreas, nada cruza, nenhuma quina a mais); EDILSON A/C/D sem avisos; IRAN igual ou melhor; quadra abaixo de 16 ms | 3–4 dias |
| 2 | Edição da linha central na prancheta (alças, campos, cadeado, Endireitar/Centralizar, arraste ao vivo só da quadra, equilibrar ao soltar, Esc, divisa de rua a rua) | `Editor.tsx`, `Loteamento.tsx`, `Painel.tsx`, `acoes.ts` | 60 quadros/s em 200 lotes (Chrome, `pw/`); desfazer exato; nenhuma ação apaga o desenho sem confirmar | 3–4 dias |
| 3 | "Ajustar fundo com fundo" para quadra desenhada e para a seleção, com antes e depois | `linhaCentral.ts` (conversão), `Painel.tsx` | aplicado no EDILSON real reproduz a tabela do resumo | 2–3 dias |
| 4 | Cabeceiras difíceis (testa com divisas paralelas, pivô da linha interna, dobra na testa), contagem ímpar, regra municipal de esquina (+% ou +m, testada no PI ou no recuo), quadra de 1 fileira e de esquina | `linhaCentral.ts`, `modelo.ts` (parâmetros) | C e D sem esquina acima de 1,5 lote quando a forma permitir | 3–5 dias |
| 5 | Gerador automático com estrutura; entregas (memorial, quadro, DXF com a linha central em camada); corpus medido a cada mudança | `auto.ts`, `planta.ts`, `saidas.ts`, `tests/` | sem regressão nos 49 testes do loteamento e no corpus | 2 dias |

Total: 3 a 4 semanas focadas. A etapa 0 sozinha já elimina os falsos "5 quinas" e o acréscimo de esquina indevido.

## 5. Decisões do Wilker

1. **Cabeceira inclinada:** esquina maior, todos iguais (laterais giram) ou lotes de testa? *Proposta: o sistema testa as três, escolhe e mostra as outras.*
2. **Contagem ímpar em quadra de duas fileiras:** lote a mais na fileira mais comprida ou propor um número par? *Proposta: lote a mais na cabeceira.*
3. **Dobra de estrada no meio da fileira:** divisa na dobra ou aceitar 5 quinas? *Proposta: divisa na dobra.*
4. **Testada da esquina:** até o PI ou até o PC? *Proposta: PI, com o arco descrito à parte.*
5. **Tolerância de giro da lateral:** 15° ou 20°? *Proposta: 15° (aviso) e 30° (limite da edição).*
6. **Quadras já desenhadas à mão:** converter ao abrir ou no clique? *Proposta: só no clique, com antes e depois.*

## 6. Riscos

- **Mexer na contagem e na escolha de cabeceira muda a numeração dos lotes.** Lote já vendido ou reservado precisa de trava antes da etapa 3 (trava por lote no modelo).
- **Geometria que não é de duas fileiras:** o modelo recusa e a quadra continua no desenho livre (sem regressão).
- **Otimizador da linha central (0,2–1 s):** rodar em Worker com a prévia na tela.
- **Dados reais de cliente:** só no corpus local, nunca no Git (`tests/corpus-real/`).
