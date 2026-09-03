# Plano: usar os vértices certificados do vizinho na correção de sobreposição

## 1. Auditoria — como funciona hoje (2026-09-03)

Fluxo (`Conferencia.tsx` → edge function `corrigir-sobreposicao` → `_shared/sobreposicao.ts`):

1. O SIGEF acusa sobreposição e libera o CSV de exportação de cada parcela certificada
   que conflita. O operador envia os CSVs na seção "O SIGEF acusou sobreposição?".
2. `parseCsvSigef` lê **só a geometria** do CSV (`GEOMETRIA_WKT` das linhas `EXTERNO`,
   ordenadas por `INDICE`). Código, método, sigmas, altitude e as coordenadas GMS das
   colunas `X`/`Y` são descartados.
3. `corrigirSobreposicao` classifica cada parcela (`mesma_gleba` >50 %, `interna`,
   `sem_sobreposicao`, `corrigida`) e, para as corrigíveis, entra num laço:
   - calcula o resíduo de sobreposição do **anel publicado** (GMS arredondado a 0,001″);
   - subtrai `buffer(resíduo, afastamento=0,50 m)` + faixa de descolamento de 10 cm
     ao redor das divisas vizinhas próximas;
   - repete até resíduo < 1 cm².
   Os vértices medidos nunca se movem (ficam ou saem). Os pontos que aparecem no
   recorte são **pontos virtuais** afastados 0,5 m da divisa certificada.
4. `corrigir-sobreposicao/index.ts` grava: mantidos = linha original (confrontação
   junto); novos = `tipo V · PA1 · inserido_manual=true`, código `PREFIXO-V-nnnn`
   alocado em `alocar_contadores`, `lat_gms/lon_gms` canônicos. A confrontação de um M
   removido avança até o próximo vértice **original** mantido.
5. `gerar-documentos` reaproveita qualquer vértice `inserido_manual` com código como
   `codigoManual` (não realoca, não marca provisório) e publica as coordenadas pelas
   colunas `lat_gms/lon_gms`. É exatamente o canal que um vértice de outra parcela
   precisa: código dela, GMS dela, sem passar pelos contadores do credenciado.

Linha de base (THEREZA, 5 parcelas corrigíveis + 1 `mesma_gleba`):
64 vértices → 68 (45 mantidos, **23 virtuais**, 19 removidos), área 235,4668 → 235,2693 ha.

Consequência prática: a divisa com o vizinho certificado sai com pontos nossos a 0,5 m
da divisa dele — um "vazio" de meio metro e vértices que não existem em campo — mesmo
quando o vizinho já tem os pontos coletados e certificados no SIGEF.

## 2. O que muda

Quando o CSV traz os vértices certificados (sempre traz), a divisa compartilhada passa
a ser descrita **pelos próprios vértices do vizinho** (mesmo código, mesmas coordenadas
GMS, método, sigma e altitude do CSV):

- **Igualar**: vértice nosso a menos de `tolerância` (padrão 0,50 m) de um vértice
  certificado vira aquele vértice (mantém a linha nossa: confrontação, nº TXT, apelido;
  troca código, coordenadas, método, sigma, altitude).
- **Encaixar**: vértice certificado a menos de `tolerância` de um lado nosso entra no
  anel naquele lado — a divisa passa exatamente por ele.
- **Recortar exato**: diferença geométrica sem afastamento; os vértices do vizinho que
  ficam dentro do nosso polígono entram no anel como compartilhados.
- **Transições**: onde o nosso lado cruza o lado do vizinho nasce um ponto de cruzamento.
  Se ele está ao lado de um vértice compartilhado e o triângulo que some fica dentro do
  polígono original e fora de todas as parcelas, o cruzamento é descartado (o anel vai
  direto ao vértice certificado). Caso contrário ele permanece e cai no tratamento antigo.
- **Fallback**: se, depois disso, o anel publicado ainda sobrepõe (>1 cm²), o laço de
  afastamento atual roda a partir do anel novo — só o trecho problemático recebe
  pontos virtuais. Nada do comportamento atual é removido: com a opção desligada o
  resultado é idêntico ao de hoje (teste de regressão com os números da linha de base).

Invariantes preservadas: gate no anel publicado; `mesma_gleba`/`interna` continuam
ignoradas; vértice medido fora da tolerância nunca se move; códigos novos só para
pontos realmente virtuais; DP só simplifica corridas de pontos virtuais (compartilhados
são âncoras).

## 3. Execução

| # | Arquivo | Mudança |
|---|---------|---------|
| 1 | `_shared/sobreposicao.ts` | `parseCsvSigef` devolve também `vertices` (código, tipo, método, σ, Z, GMS); `ParcelaSigef.vertices?`; `PontoCorrigido.certificado?`; `corrigirSobreposicao(..., opcoes)` com passes igualar/encaixar/recorte exato/transições e fallback no laço atual |
| 2 | `corrigir-sobreposicao/index.ts` | aceita `usar_vertices_certificados` (padrão true) e `tolerancia_igualar` (padrão 0,5); grava compartilhados com código/GMS/método/σ/Z do CSV e `inserido_manual=true`; aloca código só para virtuais; relatório com `compartilhados` |
| 3 | `Conferencia.tsx` | checkbox + tolerância; texto da seção; relatório mostra compartilhados; chip de tipo do vértice inserido mostra a letra do código |
| 4 | `tests/sobreposicao_certificados.test.mjs` | THEREZA: modo antigo reproduz a linha de base; modo novo tem compartilhados com coordenada idêntica ao CSV, menos virtuais, sem sobreposição publicada |

Sem migration: nenhuma coluna nova (σx/σy do CSV entram como `sigma_pos = max(σx, σy)`,
porque a planilha grava um σ só para x e y).

Deploy: só `corrigir-sobreposicao` embarca `sobreposicao.ts`; `gerar-documentos` não
muda de bundle por esta demanda.

## 4. Resultado (THEREZA, 2026-09-03)

| modo | vértices | do vizinho | virtuais | removidos | cedido além da invasão |
|------|----------|------------|----------|-----------|------------------------|
| afastamento (antigo) | 68 | 0 | 23 | 19 | ~850 m² |
| vértices certificados | 73 | 25 (8 igualados) | 6 | 19 | ~66 m² |

Duas descobertas durante a execução, ambas incorporadas:

- A geometria da parcela tem de vir do **WKT** do CSV (o que o SIGEF guarda), não do
  GMS das colunas X/Y, que é a exibição a 0,001" e difere até 2 cm. O GMS vai só para
  `lat_gms/lon_gms` do vértice compartilhado.
- Descartar a transição (cruzamento de lados) ao lado de um certificado entregava o
  triângulo inteiro entre o nosso vértice e o dele — 311 m² a mais que o modo antigo.
  A transição agora **recua 5 cm ao longo do nosso lado** e só some quando o
  triângulo é desprezível (< 0,5 m²).
